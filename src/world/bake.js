// Lightmap baker: area lights with soft ray-traced shadows + one diffuse bounce,
// plus a dominant light direction per texel (directional lightmap) so normal maps
// and specular highlights still react to baked light. Runs offline (node) or in a
// Web Worker. Two states are baked for zones next to a door (closed / open) and
// blended at runtime by the door's opening.
import { F_OCCLUDE } from './grid.js';
import { faceTexel } from './build.js';
import { matAlbedo } from '../config/materials.js';

const RGBM_RANGE = 4;

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
function radInv(i) {
  i = ((i << 16) | (i >>> 16)) >>> 0;
  i = (((i & 0x55555555) << 1) | ((i & 0xaaaaaaaa) >>> 1)) >>> 0;
  i = (((i & 0x33333333) << 2) | ((i & 0xcccccccc) >>> 2)) >>> 0;
  i = (((i & 0x0f0f0f0f) << 4) | ((i & 0xf0f0f0f0) >>> 4)) >>> 0;
  i = (((i & 0x00ff00ff) << 8) | ((i & 0xff00ff00) >>> 8)) >>> 0;
  return i / 4294967296;
}

export function bakeSector(built, grid, lights, doors, doorPrims, opts = {}) {
  const R = opts.rays ?? 40, range = 16, boost = opts.boost ?? 1.35;
  const progress = opts.onProgress || (() => {});
  const P = grid.p;
  const zoneStates = built.map(bz => doors.some(d => d.zones.includes(bz.id)) ? 2 : 1);
  const zoneDoor = built.map(bz => Math.max(0, doors.findIndex(d => d.zones.includes(bz.id))));   // each zone blends with its own door
  const doorCenters = doors.map(d => [(d.min[0] + d.max[0]) / 2, (d.min[1] + d.max[1]) / 2, (d.min[2] + d.max[2]) / 2]);

  // ---- texel setup ----
  const Z = built.map((bz) => {
    const n = bz.W * bz.H;
    const T = { bz, n, valid: new Uint8Array(n), owner: new Int32Array(n).fill(-1), p: new Float32Array(n * 3), nr: new Float32Array(n * 3), alb: new Float32Array(n * 3), E: [], ind: [], dirs: [], rectAvg: [] };
    bz.rects.forEach((r, ri) => {
      let lowAlb = null, bandH = 0;
      if (r.kind === 0 && r.fm.band) { lowAlb = matAlbedo(r.fm.band.low); bandH = r.fm.band.h; }
      for (let j = 0; j < r.ny; j++) for (let i = 0; i < r.nx; i++) {
        const idx = (r.y + 1 + j) * bz.W + (r.x + 1 + i), k = idx * 3;
        let px, py, pz, nx, ny, nz;
        if (r.kind === 0) {
          const s = (i + 0.5) / r.nx, t = (j + 0.5) / r.ny;
          px = r.o[0] + r.U[0] * s + r.V[0] * t; py = r.o[1] + r.U[1] * s + r.V[1] * t; pz = r.o[2] + r.U[2] * s + r.V[2] * t;
          nx = r.n[0]; ny = r.n[1]; nz = r.n[2];
        } else {
          const q = (j * r.nx + i) * 3;
          px = r.pts[q]; py = r.pts[q + 1]; pz = r.pts[q + 2]; nx = r.nrm[q]; ny = r.nrm[q + 1]; nz = r.nrm[q + 2];
        }
        T.p[k] = px + nx * 0.02; T.p[k + 1] = py + ny * 0.02; T.p[k + 2] = pz + nz * 0.02;
        T.nr[k] = nx; T.nr[k + 1] = ny; T.nr[k + 2] = nz;
        const a = lowAlb && py < bandH ? lowAlb : r.albedo;
        T.alb[k] = a[0]; T.alb[k + 1] = a[1]; T.alb[k + 2] = a[2];
        T.owner[idx] = ri;
        T.valid[idx] = grid.inside(T.p[k], T.p[k + 1], T.p[k + 2], F_OCCLUDE) ? 0 : 1;
      }
    });
    return T;
  });

  const Ls = lights.map(L => {
    const sx = Math.max(1, Math.min(4, Math.round(L.hx * 2 / 0.3))), sz = Math.max(1, Math.min(4, Math.round(L.hz * 2 / 0.3)));
    return { ...L, sx, sz, A: 4 * L.hx * L.hz, Le: L.color.map(c => c * L.power) };
  });

  const totalTex = Z.reduce((s, T) => s + T.n, 0) * 2;
  let done = 0;

  // ---- direct light ----
  function direct(state) {
    for (let zi = 0; zi < Z.length; zi++) {
      const T = Z[zi];
      if (state >= zoneStates[zi]) { T.E[state] = T.E[0]; T.dirs[state] = T.dirs[0]; continue; }
      grid.skip = state === 1 && doors.length ? doorPrims[doors[zoneDoor[zi]].id] : -1;
      const E = new Float32Array(T.n * 3), D = new Float32Array(T.n * 4);
      for (let idx = 0; idx < T.n; idx++) {
        if (!T.valid[idx]) continue;
        const k = idx * 3, px = T.p[k], py = T.p[k + 1], pz = T.p[k + 2], nx = T.nr[k], ny = T.nr[k + 1], nz = T.nr[k + 2];
        if (state === 1) { // outside the door's reach the open state equals the closed one
          const c = doorCenters[zoneDoor[zi]];
          if ((px - c[0]) ** 2 + (py - c[1]) ** 2 + (pz - c[2]) ** 2 > 144) {
            E[k] = T.E[0][k]; E[k + 1] = T.E[0][k + 1]; E[k + 2] = T.E[0][k + 2];
            D.set(T.dirs[0].subarray(idx * 4, idx * 4 + 4), idx * 4); continue;
          }
        }
        let er = 0, eg = 0, eb = 0, dx = 0, dy = 0, dz = 0, dw = 0;
        for (let li = 0; li < Ls.length; li++) {
          const L = Ls[li];
          if (L.type === 'point') { // small sphere, brightest out along the cup's axis
            const lx = L.c[0] - px, ly = L.c[1] - py, lz = L.c[2] - pz;
            if (lx * lx + ly * ly + lz * lz > range * range) continue;
            for (let a = 0; a < 4; a++) {
              const j = hash(idx, a * 13 + li * 7) * 2 - 1, k = hash(idx + 77, a * 5 + li) * 2 - 1;
              const qx = L.c[0] + j * L.rad, qy = L.c[1] + k * L.rad, qz = L.c[2] + (a < 2 ? 1 : -1) * L.rad * 0.5;
              const wx = qx - px, wy = qy - py, wz = qz - pz, d2 = wx * wx + wy * wy + wz * wz, d = Math.sqrt(d2);
              const ux = wx / d, uy = wy / d, uz = wz / d, cs = nx * ux + ny * uy + nz * uz;
              if (cs <= 0) continue;
              const fwd = -(ux * L.n[0] + uy * L.n[1] + uz * L.n[2]); // light leaving along the axis
              if (fwd < -0.15) continue;                              // behind the cup
              if (grid.ray(px, py, pz, ux, uy, uz, d - 0.03, F_OCCLUDE, true)) continue;
              const e = cs * (0.35 + 0.65 * Math.max(0, fwd)) / (4 * Math.max(d2, L.rad * L.rad * 4));
              er += L.Le[0] * e; eg += L.Le[1] * e; eb += L.Le[2] * e;
              const w = (L.Le[0] * 0.2126 + L.Le[1] * 0.7152 + L.Le[2] * 0.0722) * e;
              dx += ux * w; dy += uy * w; dz += uz * w; dw += w;
            }
            continue;
          }
          const ly = L.c[1] - py;
          if (ly <= 0.002) continue;
          const lx = L.c[0] - px, lz = L.c[2] - pz;
          if (lx * lx + ly * ly + lz * lz > range * range) continue;
          if (nx * lx + ny * ly + nz * lz < -Math.max(L.hx, L.hz)) continue;
          const ns = L.sx * L.sz;
          for (let a = 0; a < L.sx; a++) for (let b = 0; b < L.sz; b++) {
            const qx = L.c[0] + ((a + hash(idx, a * 7 + b + li * 31)) / L.sx * 2 - 1) * L.hx;
            const qz = L.c[2] + ((b + hash(idx + 1013, a * 5 + b + li * 17)) / L.sz * 2 - 1) * L.hz;
            const wx = qx - px, wy = L.c[1] - py, wz = qz - pz;
            const d2 = wx * wx + wy * wy + wz * wz, d = Math.sqrt(d2);
            const ux = wx / d, uy = wy / d, uz = wz / d;
            const cs = nx * ux + ny * uy + nz * uz;
            if (cs <= 0 || uy <= 0) continue;
            if (grid.ray(px, py, pz, ux, uy, uz, d - 0.015, F_OCCLUDE, true)) continue;
            const e = cs * uy * L.A / (ns * Math.max(d2, L.A));
            er += L.Le[0] * e; eg += L.Le[1] * e; eb += L.Le[2] * e;
            const w = (L.Le[0] * 0.2126 + L.Le[1] * 0.7152 + L.Le[2] * 0.0722) * e;
            dx += ux * w; dy += uy * w; dz += uz * w; dw += w;
          }
        }
        E[k] = er; E[k + 1] = eg; E[k + 2] = eb;
        D[idx * 4] = dx; D[idx * 4 + 1] = dy; D[idx * 4 + 2] = dz; D[idx * 4 + 3] = dw;
        if ((++done & 4095) === 0) progress(done / totalTex * 0.4);
      }
      T.E[state] = E; T.dirs[state] = D;
    }
    // per-chart average (used when a bounce ray lands on a pipe or an invalid texel)
    for (const T of Z) {
      const avg = T.bz.rects.map(() => [0, 0, 0, 0]), E = T.E[state];
      for (let idx = 0; idx < T.n; idx++) if (T.valid[idx] && T.owner[idx] >= 0) {
        const a = avg[T.owner[idx]], k = idx * 3; a[0] += E[k]; a[1] += E[k + 1]; a[2] += E[k + 2]; a[3]++;
      }
      T.rectAvg[state] = avg.map(a => a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : [0, 0, 0]);
    }
  }

  // ---- one diffuse bounce ----
  function indirect(state) {
    const H = grid.hit;
    for (let zi = 0; zi < Z.length; zi++) {
      const T = Z[zi];
      if (state >= zoneStates[zi]) { T.ind[state] = T.ind[0]; continue; }
      grid.skip = state === 1 && doors.length ? doorPrims[doors[zoneDoor[zi]].id] : -1;
      const I = new Float32Array(T.n * 3), D = T.dirs[state];
      for (let idx = 0; idx < T.n; idx++) {
        if (!T.valid[idx]) continue;
        const k = idx * 3, px = T.p[k], py = T.p[k + 1], pz = T.p[k + 2], nx = T.nr[k], ny = T.nr[k + 1], nz = T.nr[k + 2];
        if (state === 1) {
          const c = doorCenters[zoneDoor[zi]];
          if ((px - c[0]) ** 2 + (py - c[1]) ** 2 + (pz - c[2]) ** 2 > 196) { I[k] = T.ind[0][k]; I[k + 1] = T.ind[0][k + 1]; I[k + 2] = T.ind[0][k + 2]; D.set(T.dirs[0].subarray(idx * 4, idx * 4 + 4), idx * 4); continue; }
        }
        // tangent frame (Duff et al. 2017)
        const sg = nz >= 0 ? 1 : -1, a0 = -1 / (sg + nz), b0 = nx * ny * a0;
        const t1x = 1 + sg * nx * nx * a0, t1y = sg * b0, t1z = -sg * nx;
        const t2x = b0, t2y = sg + ny * ny * a0, t2z = -ny;
        const r1 = hash(idx, 991), r2 = hash(idx, 577);
        let sr = 0, sgc = 0, sb = 0, dx = 0, dy = 0, dz = 0, dw = 0;
        for (let i = 0; i < R; i++) {
          let u1 = (i + 0.5) / R + r1; u1 -= Math.floor(u1);
          let u2 = radInv(i) + r2; u2 -= Math.floor(u2);
          const rr = Math.sqrt(u1), ph = 2 * Math.PI * u2, lx = rr * Math.cos(ph), ly = rr * Math.sin(ph), lz = Math.sqrt(Math.max(0, 1 - u1));
          const ux = t1x * lx + t2x * ly + nx * lz, uy = t1y * lx + t2y * ly + ny * lz, uz = t1z * lx + t2z * ly + nz * lz;
          const t = grid.ray(px, py, pz, ux, uy, uz, 40, F_OCCLUDE, false);
          if (t <= 0) continue;
          const zj = P.zone[H.prim];
          if (zj < 0) continue; // the door slab itself (unlit dynamic object)
          const Tj = Z[zj], loc = P.local[H.prim];
          let rgb = null, ar = 0, ag = 0, ab = 0;
          if (P.type[H.prim] === 0) {
            if (H.face < 0) continue;
            const ri = Tj.bz.faceRect[loc * 6 + H.face];
            if (ri < 0) continue;
            const [tx, ty] = faceTexel(Tj.bz, ri, [px + ux * t, py + uy * t, pz + uz * t]);
            const j = ty * Tj.bz.W + tx;
            if (Tj.valid[j]) { const E = Tj.E[state]; rgb = [E[j * 3], E[j * 3 + 1], E[j * 3 + 2]]; ar = Tj.alb[j * 3]; ag = Tj.alb[j * 3 + 1]; ab = Tj.alb[j * 3 + 2]; }
            else { rgb = Tj.rectAvg[state][ri]; const al = Tj.bz.rects[ri].albedo; ar = al[0]; ag = al[1]; ab = al[2]; }
          } else {
            const ri = Tj.bz.cylRect[loc];
            if (ri < 0) continue;
            rgb = Tj.rectAvg[state][ri]; const al = Tj.bz.rects[ri].albedo; ar = al[0]; ag = al[1]; ab = al[2];
          }
          const lr = rgb[0] * ar, lg = rgb[1] * ag, lb = rgb[2] * ab;
          sr += lr; sgc += lg; sb += lb;
          const w = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
          dx += ux * w; dy += uy * w; dz += uz * w; dw += w;
        }
        const inv = boost / R;
        I[k] = sr * inv; I[k + 1] = sgc * inv; I[k + 2] = sb * inv;
        // fold bounce into the direction estimate (it lowers directionality)
        const q = idx * 4;
        D[q] += dx * inv; D[q + 1] += dy * inv; D[q + 2] += dz * inv; D[q + 3] += dw * inv * 1.6;
        if ((++done & 2047) === 0) progress(0.4 + done / totalTex * 0.3);
      }
      T.ind[state] = I;
    }
  }

  const st = Math.max(...zoneStates);
  for (let s = 0; s < st; s++) direct(s);
  done = totalTex * 0.5;
  for (let s = 0; s < st; s++) indirect(s);
  grid.skip = -1;

  // ---- filter, dilate, encode ----
  const out = {};
  Z.forEach((T, zi) => {
    const { bz } = T, W = bz.W, Hh = bz.H;
    const res = { W, H: Hh, states: zoneStates[zi], lm: [], dir: [] };
    for (let s = 0; s < zoneStates[zi]; s++) {
      const ind = blurCharts(T, T.ind[s], W);
      const col = new Float32Array(T.n * 3), D = T.dirs[s], E = T.E[s];
      for (let i = 0; i < T.n * 3; i++) col[i] = (E[i] + ind[i]) / Math.PI;
      const dirv = new Float32Array(T.n * 4);
      for (let idx = 0; idx < T.n; idx++) {
        const q = idx * 4, l = Math.hypot(D[q], D[q + 1], D[q + 2]);
        if (D[q + 3] > 1e-8 && l > 1e-8) { dirv[q] = D[q] / l; dirv[q + 1] = D[q + 1] / l; dirv[q + 2] = D[q + 2] / l; dirv[q + 3] = Math.min(1, l / D[q + 3]); }
        else { const k = idx * 3; dirv[q] = T.nr[k]; dirv[q + 1] = T.nr[k + 1]; dirv[q + 2] = T.nr[k + 2]; dirv[q + 3] = 0; }
      }
      dilate(T, col, 3); dilate(T, dirv, 4);
      pad(T, col, 3); pad(T, dirv, 4);
      const lm = new Uint8Array(T.n * 4), dr = new Uint8Array(T.n * 4);
      for (let idx = 0; idx < T.n; idx++) {
        const k = idx * 3, q = idx * 4;
        const r = Math.sqrt(Math.max(0, col[k])), g = Math.sqrt(Math.max(0, col[k + 1])), b = Math.sqrt(Math.max(0, col[k + 2]));
        let m = Math.min(1, Math.max(r, g, b, 1e-6) / RGBM_RANGE);
        m = Math.ceil(m * 255) / 255;
        const sc = 1 / (m * RGBM_RANGE);
        lm[q] = Math.min(255, Math.round(r * sc * 255)); lm[q + 1] = Math.min(255, Math.round(g * sc * 255)); lm[q + 2] = Math.min(255, Math.round(b * sc * 255)); lm[q + 3] = Math.round(m * 255);
        dr[q] = Math.round((dirv[q] * 0.5 + 0.5) * 255); dr[q + 1] = Math.round((dirv[q + 1] * 0.5 + 0.5) * 255); dr[q + 2] = Math.round((dirv[q + 2] * 0.5 + 0.5) * 255); dr[q + 3] = Math.round(dirv[q + 3] * 255);
      }
      res.lm.push(lm); res.dir.push(dr);
    }
    out[bz.id] = res;
  });
  progress(1);
  return out;
}

// 2x 3x3 blur restricted to valid texels of the same chart (indirect light is low-frequency)
function blurCharts(T, src, W) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    b.set(a);
    for (let idx = 0; idx < T.n; idx++) {
      if (!T.valid[idx]) continue;
      const o = T.owner[idx];
      if (T.bz.rects[o].kind !== 0) continue;
      let r = 0, g = 0, bl = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = idx + dy * W + dx;
        if (j < 0 || j >= T.n || !T.valid[j] || T.owner[j] !== o) continue;
        r += a[j * 3]; g += a[j * 3 + 1]; bl += a[j * 3 + 2]; c++;
      }
      b[idx * 3] = r / c; b[idx * 3 + 1] = g / c; b[idx * 3 + 2] = bl / c;
    }
    const t = a; a = b; b = t;
  }
  return a;
}

// fill invalid texels (inside touching geometry) from valid neighbours of the same chart
function dilate(T, buf, ch) {
  const W = T.bz.W;
  const ok = Uint8Array.from(T.valid);
  for (let pass = 0; pass < 4; pass++) {
    const next = Uint8Array.from(ok);
    for (let idx = 0; idx < T.n; idx++) {
      if (ok[idx] || T.owner[idx] < 0) continue;
      const o = T.owner[idx];
      const acc = [0, 0, 0, 0]; let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = idx + dy * W + dx;
        if (j < 0 || j >= T.n || !ok[j] || T.owner[j] !== o) continue;
        for (let q = 0; q < ch; q++) acc[q] += buf[j * ch + q];
        c++;
      }
      if (c) { for (let q = 0; q < ch; q++) buf[idx * ch + q] = acc[q] / c; next[idx] = 1; }
    }
    ok.set(next);
  }
  // charts with nothing valid nearby: chart mean
  const rs = T.bz.rects.map(() => ({ s: new Float32Array(ch), c: 0 }));
  for (let idx = 0; idx < T.n; idx++) if (ok[idx] && T.owner[idx] >= 0) { const r = rs[T.owner[idx]]; for (let q = 0; q < ch; q++) r.s[q] += buf[idx * ch + q]; r.c++; }
  for (let idx = 0; idx < T.n; idx++) if (!ok[idx] && T.owner[idx] >= 0) { const r = rs[T.owner[idx]]; for (let q = 0; q < ch; q++) buf[idx * ch + q] = r.c ? r.s[q] / r.c : 0; }
}

// copy chart borders into the 1-texel padding so bilinear filtering never bleeds
function pad(T, buf, ch) {
  const W = T.bz.W;
  for (const r of T.bz.rects) {
    const x0 = r.x, y0 = r.y, x1 = r.x + r.nx + 1, y1 = r.y + r.ny + 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x > x0 && x < x1 && y > y0 && y < y1) continue;
      const sx = Math.min(Math.max(x, x0 + 1), x1 - 1), sy = Math.min(Math.max(y, y0 + 1), y1 - 1);
      const d = (y * W + x) * ch, s = (sy * W + sx) * ch;
      for (let q = 0; q < ch; q++) buf[d + q] = buf[s + q];
    }
  }
}

export { RGBM_RANGE };
