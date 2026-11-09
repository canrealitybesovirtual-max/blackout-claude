// Zone builder: turns zone data into merged render geometry, lightmap charts,
// decals, light glows and physics prims. Pure JS (no three.js), deterministic,
// shared by the runtime and the offline baker so lightmaps always line up.
import { MATERIALS, BANDS, matDef, matAlbedo } from '../config/materials.js';
import { cellUV } from '../config/decals.js';
import { PrimSet, F_OCCLUDE, F_COLLIDE, F_SHOOT, F_DOOR } from './grid.js';

export const MAT_KEYS = Object.keys(MATERIALS);
const MAT_INDEX = Object.fromEntries(MAT_KEYS.map((k, i) => [k, i]));
export const FACE_N = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
const FACE_KEY = ['nx', 'px', 'ny', 'py', 'nz', 'pz'];
export const CYL_SIDES = 8;

function faceFrame(mn, mx, f) {
  const [x0, y0, z0] = mn, [x1, y1, z1] = mx, dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  switch (f) {
    case 0: return { o: [x0, y0, z0], U: [0, 0, dz], V: [0, dy, 0] };
    case 1: return { o: [x1, y0, z1], U: [0, 0, -dz], V: [0, dy, 0] };
    case 2: return { o: [x0, y0, z0], U: [dx, 0, 0], V: [0, 0, dz] };
    case 3: return { o: [x0, y1, z1], U: [dx, 0, 0], V: [0, 0, -dz] };
    case 4: return { o: [x1, y0, z0], U: [-dx, 0, 0], V: [0, dy, 0] };
    default: return { o: [x0, y0, z1], U: [dx, 0, 0], V: [0, dy, 0] };
  }
}

// resolve a box material spec for one face -> { key } or { band }
function faceMat(spec, f) {
  let s = typeof spec === 'string' ? spec : (spec[FACE_KEY[f]] ?? spec.all);
  if (BANDS[s]) return FACE_N[f][1] === 0 ? { band: BANDS[s], key: BANDS[s].high } : { key: BANDS[s].high };
  matDef(s);
  return { key: s };
}

const len3 = v => Math.hypot(v[0], v[1], v[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = v => { const l = len3(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function inBox(p, b, eps = 1e-4) {
  return p[0] > b.min[0] + eps && p[0] < b.max[0] - eps && p[1] > b.min[1] + eps && p[1] < b.max[1] - eps &&
    p[2] > b.min[2] + eps && p[2] < b.max[2] - eps;
}
function inVol(p, v, pad) {
  return p[0] > v.min[0] - pad && p[0] < v.max[0] + pad && p[1] > v.min[1] - pad && p[1] < v.max[1] + pad &&
    p[2] > v.min[2] - pad && p[2] < v.max[2] + pad;
}

// grow-able typed geometry writer
class GeoWriter {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.lm = []; this.layer = []; this.tint = []; this.emit = []; this.idx = []; this.n = 0; }
  v(p, n, u, v, lu, lv, layer, tint, emit) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(u, v); this.lm.push(lu, lv);
    this.layer.push(layer);
    this.tint.push(Math.min(255, Math.round(tint[0] * 127.5)), Math.min(255, Math.round(tint[1] * 127.5)), Math.min(255, Math.round(tint[2] * 127.5)));
    this.emit.push(emit);
    return this.n++;
  }
  finish() {
    return {
      position: new Float32Array(this.pos), normal: new Float32Array(this.nrm), uv: new Float32Array(this.uv),
      lmuv: new Float32Array(this.lm), layer: new Uint8Array(this.layer), tint: new Uint8Array(this.tint),
      emit: new Float32Array(this.emit), index: this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), count: this.n,
    };
  }
}

export function buildZone(z, neighbors, opts = {}) {
  const density = opts.density ?? 8; // lightmap texels per metre
  const own = z.boxes, others = neighbors.flatMap(n => n.boxes);
  const vols = [z.volume, ...neighbors.map(n => n.volume)];
  const solid = [...own.map((b, i) => ({ b, i, own: true })), ...others.map(b => ({ b, i: -1, own: false }))].filter(e => e.b.render);
  const rects = [];        // lightmap charts
  const faceRect = new Int32Array(own.length * 6).fill(-1);
  const faceMatIdx = new Int16Array(own.length * 6).fill(-1);
  const faces = [];        // planar records for decal lookup

  own.forEach((b, bi) => {
    for (let f = 0; f < 6; f++) {
      if (b.skip && b.skip.includes(f)) continue;
      const fm = faceMat(b.mat, f);
      faceMatIdx[bi * 6 + f] = MAT_INDEX[fm.key];
      if (!b.render) continue;
      const { o, U, V } = faceFrame(b.min, b.max, f), n = FACE_N[f];
      const lu = len3(U), lv = len3(V);
      if (lu < 1e-3 || lv < 1e-3) continue;
      const at = (s, t, off) => [o[0] + U[0] * s + V[0] * t + n[0] * off, o[1] + U[1] * s + V[1] * t + n[1] * off, o[2] + U[2] * s + V[2] * t + n[2] * off];
      // never visible from any playable volume -> drop
      let vis = false;
      for (const [s, t] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) {
        const p = at(s, t, 0.01);
        if (vols.some(v => inVol(p, v, 0.2))) { vis = true; break; }
      }
      if (!vis) continue;
      // fully covered by touching geometry -> drop
      let covered = true;
      for (let a = 0; a < 3 && covered; a++) for (let c = 0; c < 3 && covered; c++) {
        const p = at(0.05 + a * 0.45, 0.05 + c * 0.45, 0.005);
        if (!solid.some(e => !(e.own && e.i === bi) && inBox(p, e.b))) covered = false;
      }
      if (covered) continue;
      const nx = Math.max(2, Math.min(512, Math.ceil(lu * density))), ny = Math.max(2, Math.min(512, Math.ceil(lv * density)));
      const emit = b.emit && b.emit.face === f ? b.emit : null;
      const alb = fm.band ? matAlbedo(fm.band.high) : matAlbedo(fm.key);
      const r = { kind: 0, nx, ny, o, U, V, n, albedo: emit ? [0, 0, 0] : alb, box: bi, face: f, fm, emit, x: 0, y: 0 };
      faceRect[bi * 6 + f] = rects.length;
      rects.push(r);
      faces.push(r);
    }
  });

  const cylRect = new Int32Array(z.cyls.length).fill(-1);
  z.cyls.forEach((c, ci) => {
    const d0 = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], len = len3(d0), d = norm3(d0);
    const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = norm3(cross3(d, ref)), e2 = cross3(d, e1);
    // sides / arc / inward: shafts are big inside-facing cylinders, optionally with a gap (a doorway)
    const S = c.sides || CYL_SIDES, L = Math.max(1, Math.ceil(len / (c.seg || 0.6)));
    const t0 = c.arc ? c.arc[0] : 0, t1 = c.arc ? c.arc[1] : 2 * Math.PI, sg = c.inward ? -1 : 1;
    const pts = new Float32Array((S + 1) * (L + 1) * 3), nrm = new Float32Array((S + 1) * (L + 1) * 3);
    for (let m = 0; m <= L; m++) for (let k = 0; k <= S; k++) {
      const th = t0 + (t1 - t0) * k / S, cs = Math.cos(th), sn = Math.sin(th), q = (m * (S + 1) + k) * 3;
      const nn = [cs * e1[0] + sn * e2[0], cs * e1[1] + sn * e2[1], cs * e1[2] + sn * e2[2]];
      for (let j = 0; j < 3; j++) { nrm[q + j] = nn[j] * sg; pts[q + j] = c.a[j] + d[j] * len * m / L + c.r * nn[j]; }
    }
    cylRect[ci] = rects.length;
    rects.push({ kind: 1, nx: S + 1, ny: L + 1, pts, nrm, albedo: c.emit ? [0, 0, 0] : matAlbedo(c.mat), cyl: ci, len, S, L, t0, t1, d, x: 0, y: 0 });
  });

  // shelf-pack charts (1 texel padding each side)
  const area = rects.reduce((s, r) => s + (r.nx + 2) * (r.ny + 2), 0);
  const maxW = rects.reduce((s, r) => Math.max(s, r.nx + 2), 0);
  let W = 256; while (W * W < area * 1.25 || W < maxW) W *= 2;
  const order = rects.map((r, i) => i).sort((a, b) => (rects[b].ny - rects[a].ny) || (rects[b].nx - rects[a].nx));
  let cx = 0, cy = 0, rowH = 0;
  for (const i of order) {
    const r = rects[i], w = r.nx + 2, h = r.ny + 2;
    if (cx + w > W) { cx = 0; cy += rowH; rowH = 0; }
    r.x = cx; r.y = cy; cx += w; rowH = Math.max(rowH, h);
  }
  const H = Math.max(4, Math.ceil((cy + rowH) / 4) * 4);

  // ---- render geometry ----
  const g = new GeoWriter();
  const lmUV = (r, s, t) => [(r.x + 1 + s * r.nx) / W, (r.y + 1 + t * r.ny) / H];
  for (const r of faces) {
    const { o, U, V, n, fm, emit } = r;
    const Uh = norm3(U), vertical = n[1] === 0;
    const quads = [];
    if (fm.band) {
      const y0 = o[1], y1 = o[1] + V[1], bh = fm.band.h;
      if (y1 <= bh + 1e-4) quads.push([0, 1, fm.band.low]);
      else if (y0 >= bh - 1e-4) quads.push([0, 1, fm.band.high]);
      else { const ts = (bh - y0) / (y1 - y0); quads.push([0, ts, fm.band.low], [ts, 1, fm.band.high]); }
    } else quads.push([0, 1, fm.key]);
    for (const [t0, t1, key] of quads) {
      const m = matDef(key), sc = 1 / m.scale;
      const tint = emit ? emit.color : m.tint, ev = emit ? emit.power : 0;
      const base = g.n;
      for (const [s, t] of [[0, t0], [1, t0], [1, t1], [0, t1]]) {
        const p = [o[0] + U[0] * s + V[0] * t, o[1] + U[1] * s + V[1] * t, o[2] + U[2] * s + V[2] * t];
        const u = vertical ? dot3(p, Uh) * sc : p[0] * sc, v = vertical ? p[1] * sc : p[2] * sc;
        const [a, b2] = lmUV(r, s, t);
        g.v(p, n, u, v, a, b2, m.layer, tint, ev);
      }
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  for (const r of rects) if (r.kind === 1) {
    const c = z.cyls[r.cyl], m = matDef(c.mat), sc = 1 / m.scale, S = r.S, L = r.L, base = g.n;
    for (let mm = 0; mm <= L; mm++) for (let k = 0; k <= S; k++) {
      const q = (mm * (S + 1) + k) * 3;
      g.v([r.pts[q], r.pts[q + 1], r.pts[q + 2]], [r.nrm[q], r.nrm[q + 1], r.nrm[q + 2]],
        (r.t0 + (r.t1 - r.t0) * k / S) * c.r * sc, dot3([r.pts[q], r.pts[q + 1], r.pts[q + 2]], r.d) * sc, // v along the axis: co-axial pieces line up
        (r.x + 1 + k + 0.5) / W, (r.y + 1 + mm + 0.5) / H, m.layer, c.emit ? c.emit.color : m.tint, c.emit ? c.emit.power : 0);
    }
    for (let mm = 0; mm < L; mm++) for (let k = 0; k < S; k++) {
      const a = base + mm * (S + 1) + k, b = a + 1, cc = b + S + 1, d = a + S + 1;
      if (c.inward) g.idx.push(a, cc, b, a, d, cc); else g.idx.push(a, b, cc, a, cc, d);
    }
  }
  const geo = g.finish();

  // ---- decals (one merged mesh per zone) ----
  const dp = [], duv = [], dlm = [], dt = [], dw = [], didx = [];
  let dn = 0;
  for (const d of z.decals) {
    const n = d.n, right = norm3(cross3(d.up, n)), up = cross3(n, right);
    const c = [d.p[0] + n[0] * 0.003, d.p[1] + n[1] * 0.003, d.p[2] + n[2] * 0.003];
    const [u0, v0, u1, v1] = cellUV(d.cell);
    const face = findFace(faces, d.p, n);
    const corners = [[-1, -1, u0, v1], [1, -1, u1, v1], [1, 1, u1, v0], [-1, 1, u0, v0]];
    for (const [sx, sy, u, v] of corners) {
      const p = [c[0] + right[0] * sx * d.w / 2 + up[0] * sy * d.h / 2, c[1] + right[1] * sx * d.w / 2 + up[1] * sy * d.h / 2, c[2] + right[2] * sx * d.w / 2 + up[2] * sy * d.h / 2];
      dp.push(...p); duv.push(u, v);
      if (face) {
        const s = Math.min(1, Math.max(0, dot3([p[0] - face.o[0], p[1] - face.o[1], p[2] - face.o[2]], face.U) / dot3(face.U, face.U)));
        const t = Math.min(1, Math.max(0, dot3([p[0] - face.o[0], p[1] - face.o[1], p[2] - face.o[2]], face.V) / dot3(face.V, face.V)));
        dlm.push(...lmUV(face, s, t));
      } else dlm.push(-1, -1);
      dt.push(d.tint[0], d.tint[1], d.tint[2], d.alpha); dw.push(d.wet);
    }
    didx.push(dn, dn + 1, dn + 2, dn, dn + 2, dn + 3); dn += 4;
  }
  const decals = { position: new Float32Array(dp), uv: new Float32Array(duv), lmuv: new Float32Array(dlm), tint: new Float32Array(dt), wet: new Float32Array(dw), index: new Uint16Array(didx), count: dn };

  // ---- light glows (billboards) ----
  const gp = [], gc = [], gcol = [], gs = [], gi = [];
  z.lights.forEach((L, i) => {
    for (const [cx2, cy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      gp.push(L.c[0], L.c[1] - 0.01, L.c[2]); gc.push(cx2, cy2);
      const gpw = L.type === 'point' ? L.power * 14 : L.power; // a bare bulb glows hard for its output
      gcol.push(L.color[0] * gpw, L.color[1] * gpw, L.color[2] * gpw);
      gs.push(Math.max(L.hx, L.hz) + 0.3, i);
    }
    gi.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const glows = { position: new Float32Array(gp), corner: new Float32Array(gc), color: new Float32Array(gcol), size: new Float32Array(gs), index: new Uint16Array(gi), count: z.lights.length };

  return { id: z.id, zone: z, W, H, rects, faces, faceRect, faceMatIdx, cylRect, geo, decals, glows };
}

function findFace(faces, p, n) {
  let best = null, bd = 0.03;
  for (const f of faces) {
    if (dot3(f.n, n) < 0.99) continue;
    const d = Math.abs(dot3([p[0] - f.o[0], p[1] - f.o[1], p[2] - f.o[2]], f.n));
    if (d > bd) continue;
    const s = dot3([p[0] - f.o[0], p[1] - f.o[1], p[2] - f.o[2]], f.U) / dot3(f.U, f.U);
    const t = dot3([p[0] - f.o[0], p[1] - f.o[1], p[2] - f.o[2]], f.V) / dot3(f.V, f.V);
    if (s < -0.001 || s > 1.001 || t < -0.001 || t > 1.001) continue;
    best = f; bd = d;
  }
  return best;
}

// lightmap UV of a hit on a built zone face (bullet holes, probes)
export function faceTexel(bz, rectIndex, p) {
  const r = bz.rects[rectIndex];
  if (r.kind !== 0) return [r.x + 1 + (r.nx >> 1), r.y + 1 + (r.ny >> 1)];
  const q = [p[0] - r.o[0], p[1] - r.o[1], p[2] - r.o[2]];
  const s = Math.min(0.999, Math.max(0, dot3(q, r.U) / dot3(r.U, r.U)));
  const t = Math.min(0.999, Math.max(0, dot3(q, r.V) / dot3(r.V, r.V)));
  return [r.x + 1 + Math.floor(s * r.nx), r.y + 1 + Math.floor(t * r.ny)];
}

// physics / bake prims for a set of built zones (+ doors)
export function buildPrims(built, doors, zoneIndexOf) {
  const P = new PrimSet(), dyn = [], doorPrims = {};
  built.forEach((bz) => {
    const zi = zoneIndexOf(bz.id);
    bz.zone.boxes.forEach((b, i) => {
      const flags = (b.occlude ? F_OCCLUDE : 0) | (b.collide ? F_COLLIDE : 0) | (b.render ? F_SHOOT : 0);
      if (flags) P.addBox(b.min, b.max, flags, zi, i, bz.faceMatIdx[i * 6 + 3]);
    });
    bz.zone.cyls.forEach((c, i) => {
      const flags = (c.occlude ? F_OCCLUDE : 0) | (c.collide ? F_COLLIDE : 0) | F_SHOOT;
      const pi = P.addCyl(c.a, c.b, c.r, flags, zi, i, MAT_INDEX[c.mat]);
      if (c.arc) { P.arc0[pi] = c.arc[0]; P.arc1[pi] = c.arc[1]; }
    });
  });
  for (const d of doors) {
    const i = P.addBox(d.min, d.max, F_OCCLUDE | F_COLLIDE | F_SHOOT | F_DOOR, -1, -1, MAT_INDEX.steelGrey);
    dyn.push(i); doorPrims[d.id] = i;
  }
  return { prims: P, dyn, doorPrims };
}
