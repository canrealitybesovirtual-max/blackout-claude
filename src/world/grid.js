// Uniform-grid acceleration for boxes and capped-less cylinders (pipes).
// Pure JS, zero allocation per query. Used by the lightmap baker, bullets,
// light probes, audio occlusion, interaction and player collision.

export const F_OCCLUDE = 1;  // blocks light in the bake
export const F_COLLIDE = 2;  // blocks the player
export const F_SHOOT = 4;    // stops bullets
export const F_DOOR = 8;     // dynamic door (bake state dependent)

export class PrimSet {
  constructor() {
    this.n = 0; this.cap = 0;
    this._grow(256);
  }
  _grow(cap) {
    const re = (A, k, old) => { const a = new A(cap * k); if (old) a.set(old); return a; };
    this.type = re(Uint8Array, 1, this.type);   // 0 box, 1 cylinder
    this.flags = re(Uint8Array, 1, this.flags);
    this.mn = re(Float32Array, 3, this.mn);
    this.mx = re(Float32Array, 3, this.mx);
    this.ca = re(Float32Array, 3, this.ca);
    this.cb = re(Float32Array, 3, this.cb);
    this.cr = re(Float32Array, 1, this.cr);
    this.zone = re(Int16Array, 1, this.zone);   // index into the zone list of the owner
    this.local = re(Int32Array, 1, this.local); // box / cylinder index inside its zone
    this.sid = re(Int16Array, 1, this.sid);     // surface id (material lookup)
    this.cap = cap;
  }
  addBox(mn, mx, flags, zone, local, sid) {
    if (this.n === this.cap) this._grow(this.cap * 2);
    const i = this.n++, k = i * 3;
    this.type[i] = 0; this.flags[i] = flags; this.zone[i] = zone; this.local[i] = local; this.sid[i] = sid;
    this.mn[k] = mn[0]; this.mn[k + 1] = mn[1]; this.mn[k + 2] = mn[2];
    this.mx[k] = mx[0]; this.mx[k + 1] = mx[1]; this.mx[k + 2] = mx[2];
    return i;
  }
  addCyl(a, b, r, flags, zone, local, sid) {
    if (this.n === this.cap) this._grow(this.cap * 2);
    const i = this.n++, k = i * 3;
    this.type[i] = 1; this.flags[i] = flags; this.zone[i] = zone; this.local[i] = local; this.sid[i] = sid;
    for (let j = 0; j < 3; j++) {
      this.ca[k + j] = a[j]; this.cb[k + j] = b[j];
      this.mn[k + j] = Math.min(a[j], b[j]) - r; this.mx[k + j] = Math.max(a[j], b[j]) + r;
    }
    this.cr[i] = r;
    return i;
  }
  setBox(i, mn, mx) {
    const k = i * 3;
    this.mn[k] = mn[0]; this.mn[k + 1] = mn[1]; this.mn[k + 2] = mn[2];
    this.mx[k] = mx[0]; this.mx[k + 1] = mx[1]; this.mx[k + 2] = mx[2];
  }
}

export class Grid {
  constructor(prims, cell = 1.0, dynamic = []) {
    this.p = prims; this.cs = cell; this.inv = 1 / cell;
    // dynamic prims (doors) are tested on every query instead of living in cells
    this.dyn = Int32Array.from(dynamic);
    const P = prims, n = P.n;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      x0 = Math.min(x0, P.mn[k]); y0 = Math.min(y0, P.mn[k + 1]); z0 = Math.min(z0, P.mn[k + 2]);
      x1 = Math.max(x1, P.mx[k]); y1 = Math.max(y1, P.mx[k + 1]); z1 = Math.max(z1, P.mx[k + 2]);
    }
    if (!n) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 1; }
    this.o = [x0 - 0.01, y0 - 0.01, z0 - 0.01];
    this.nx = Math.max(1, Math.ceil((x1 - x0 + 0.02) * this.inv));
    this.ny = Math.max(1, Math.ceil((y1 - y0 + 0.02) * this.inv));
    this.nz = Math.max(1, Math.ceil((z1 - z0 + 0.02) * this.inv));
    this.max = [this.o[0] + this.nx * cell, this.o[1] + this.ny * cell, this.o[2] + this.nz * cell];
    const nc = this.nx * this.ny * this.nz;
    const count = new Uint32Array(nc + 1);
    const isDyn = new Uint8Array(n); for (const d of this.dyn) isDyn[d] = 1;
    const range = (i, cb) => {
      const k = i * 3;
      const ax = this._c(P.mn[k], 0), bx = this._c(P.mx[k], 0);
      const ay = this._c(P.mn[k + 1], 1), by = this._c(P.mx[k + 1], 1);
      const az = this._c(P.mn[k + 2], 2), bz = this._c(P.mx[k + 2], 2);
      for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++)
        cb((z * this.ny + y) * this.nx + x);
    };
    for (let i = 0; i < n; i++) if (!isDyn[i]) range(i, c => count[c + 1]++);
    for (let c = 0; c < nc; c++) count[c + 1] += count[c];
    this.start = count;
    this.items = new Uint32Array(count[nc]);
    const fill = count.slice(0, nc);
    for (let i = 0; i < n; i++) if (!isDyn[i]) range(i, c => { this.items[fill[c]++] = i; });
    this.stamp = new Uint32Array(n); this.sv = 1;
    this.hit = { t: 0, prim: -1, face: -1, nx: 0, ny: 0, nz: 0 };
    this.skip = -1; // prim index ignored by queries (used by the door bake states)
  }
  _c(v, a) {
    const c = Math.floor((v - this.o[a]) * this.inv);
    const m = a === 0 ? this.nx : a === 1 ? this.ny : this.nz;
    return c < 0 ? 0 : c >= m ? m - 1 : c;
  }
  _next() { if (++this.sv === 0xffffffff) { this.stamp.fill(0); this.sv = 1; } return this.sv; }

  // ray/prim test; returns t or -1. writes face/normal for boxes into this.hit when closest
  _test(i, ox, oy, oz, dx, dy, dz, ix, iy, iz, tmax, fill) {
    const P = this.p, k = i * 3;
    if (P.type[i] === 0) {
      let t0x = (P.mn[k] - ox) * ix, t1x = (P.mx[k] - ox) * ix;
      let fx = 0; if (t0x > t1x) { const s = t0x; t0x = t1x; t1x = s; fx = 1; }
      let t0y = (P.mn[k + 1] - oy) * iy, t1y = (P.mx[k + 1] - oy) * iy;
      let fy = 2; if (t0y > t1y) { const s = t0y; t0y = t1y; t1y = s; fy = 3; }
      let t0z = (P.mn[k + 2] - oz) * iz, t1z = (P.mx[k + 2] - oz) * iz;
      let fz = 4; if (t0z > t1z) { const s = t0z; t0z = t1z; t1z = s; fz = 5; }
      let tn = t0x, f = fx;
      if (t0y > tn) { tn = t0y; f = fy; }
      if (t0z > tn) { tn = t0z; f = fz; }
      const tf = Math.min(t1x, t1y, t1z);
      if (tn > tf || tf <= 0 || tn > tmax) return -1;
      if (tn < 0) { if (fill) { this.hit.face = -1; } return 0; }
      if (fill) {
        this.hit.face = f;
        this.hit.nx = f === 0 ? -1 : f === 1 ? 1 : 0;
        this.hit.ny = f === 2 ? -1 : f === 3 ? 1 : 0;
        this.hit.nz = f === 4 ? -1 : f === 5 ? 1 : 0;
      }
      return tn;
    }
    // cylinder body (no caps): Inigo Quilez formulation
    const ax = P.ca[k], ay = P.ca[k + 1], az = P.ca[k + 2];
    const bax = P.cb[k] - ax, bay = P.cb[k + 1] - ay, baz = P.cb[k + 2] - az;
    const ocx = ox - ax, ocy = oy - ay, ocz = oz - az, r = P.cr[i];
    const baba = bax * bax + bay * bay + baz * baz;
    const bard = bax * dx + bay * dy + baz * dz;
    const baoc = bax * ocx + bay * ocy + baz * ocz;
    const k2 = baba - bard * bard;
    if (k2 < 1e-9) return -1;
    const k1 = baba * (ocx * dx + ocy * dy + ocz * dz) - baoc * bard;
    const k0 = baba * (ocx * ocx + ocy * ocy + ocz * ocz) - baoc * baoc - r * r * baba;
    let h = k1 * k1 - k2 * k0;
    if (h < 0) return -1;
    h = Math.sqrt(h);
    const t = (-k1 - h) / k2;
    if (t < 0 || t > tmax) return -1;
    const y = baoc + t * bard;
    if (y < 0 || y > baba) return -1;
    if (fill) {
      const s = y / baba;
      let nx = ocx + t * dx - bax * s, ny = ocy + t * dy - bay * s, nz = ocz + t * dz - baz * s;
      const l = 1 / Math.max(1e-6, Math.hypot(nx, ny, nz));
      this.hit.face = 6; this.hit.nx = nx * l; this.hit.ny = ny * l; this.hit.nz = nz * l;
    }
    return t;
  }

  // any = true: shadow query, returns true on first hit. mask: required flag bits.
  // Returns boolean (any) or hit distance / -1 (closest, details in this.hit).
  ray(ox, oy, oz, dx, dy, dz, tmax, mask, any) {
    const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
    const P = this.p, sv = this._next(), skip = this.skip;
    let best = tmax, bestPrim = -1;
    const H = this.hit;
    let bf = -1, bnx = 0, bny = 0, bnz = 0;
    for (let j = 0; j < this.dyn.length; j++) {
      const i = this.dyn[j];
      if (i === skip || !(P.flags[i] & mask)) continue;
      const t = this._test(i, ox, oy, oz, dx, dy, dz, ix, iy, iz, best, !any);
      if (t >= 0) { if (any) return true; best = t; bestPrim = i; bf = H.face; bnx = H.nx; bny = H.ny; bnz = H.nz; }
    }
    // clip to grid bounds
    let t0 = 0, t1 = best;
    for (let a = 0; a < 3; a++) {
      const o = a === 0 ? ox : a === 1 ? oy : oz, inv = a === 0 ? ix : a === 1 ? iy : iz;
      let ta = (this.o[a] - o) * inv, tb = (this.max[a] - o) * inv;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    }
    if (t0 <= t1) {
      const cs = this.cs;
      const px = ox + dx * t0, py = oy + dy * t0, pz = oz + dz * t0;
      let cx = this._c(px, 0), cy = this._c(py, 1), cz = this._c(pz, 2);
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const nbx = this.o[0] + (cx + (sx > 0 ? 1 : 0)) * cs;
      const nby = this.o[1] + (cy + (sy > 0 ? 1 : 0)) * cs;
      const nbz = this.o[2] + (cz + (sz > 0 ? 1 : 0)) * cs;
      let tmx = dx !== 0 ? (nbx - ox) * ix : Infinity;
      let tmy = dy !== 0 ? (nby - oy) * iy : Infinity;
      let tmz = dz !== 0 ? (nbz - oz) * iz : Infinity;
      const tdx = dx !== 0 ? Math.abs(cs * ix) : Infinity;
      const tdy = dy !== 0 ? Math.abs(cs * iy) : Infinity;
      const tdz = dz !== 0 ? Math.abs(cs * iz) : Infinity;
      for (;;) {
        const c = (cz * this.ny + cy) * this.nx + cx;
        for (let q = this.start[c], e = this.start[c + 1]; q < e; q++) {
          const i = this.items[q];
          if (this.stamp[i] === sv) continue;
          this.stamp[i] = sv;
          if (i === skip || !(P.flags[i] & mask)) continue;
          const t = this._test(i, ox, oy, oz, dx, dy, dz, ix, iy, iz, best, !any);
          if (t >= 0 && (any || t < best || bestPrim < 0)) {
            if (any) return true;
            best = t; bestPrim = i; bf = H.face; bnx = H.nx; bny = H.ny; bnz = H.nz;
          }
        }
        const tExit = Math.min(tmx, tmy, tmz);
        if (tExit > best || tExit > t1) break;
        if (tmx <= tmy && tmx <= tmz) { cx += sx; if (cx < 0 || cx >= this.nx) break; tmx += tdx; }
        else if (tmy <= tmz) { cy += sy; if (cy < 0 || cy >= this.ny) break; tmy += tdy; }
        else { cz += sz; if (cz < 0 || cz >= this.nz) break; tmz += tdz; }
      }
    }
    if (any) return false;
    if (bestPrim < 0) return -1;
    H.t = best; H.prim = bestPrim; H.face = bf; H.nx = bnx; H.ny = bny; H.nz = bnz;
    return best;
  }

  // is the point strictly inside any box with the mask?
  inside(x, y, z, mask, exclude = -1) {
    const P = this.p;
    const test = i => {
      if (i === exclude || i === this.skip || P.type[i] !== 0 || !(P.flags[i] & mask)) return false;
      const k = i * 3;
      return x > P.mn[k] && x < P.mx[k] && y > P.mn[k + 1] && y < P.mx[k + 1] && z > P.mn[k + 2] && z < P.mx[k + 2];
    };
    for (let j = 0; j < this.dyn.length; j++) if (test(this.dyn[j])) return true;
    if (x < this.o[0] || y < this.o[1] || z < this.o[2] || x >= this.max[0] || y >= this.max[1] || z >= this.max[2]) return false;
    const c = (this._c(z, 2) * this.ny + this._c(y, 1)) * this.nx + this._c(x, 0);
    for (let q = this.start[c], e = this.start[c + 1]; q < e; q++) if (test(this.items[q])) return true;
    return false;
  }

  // collect prims whose AABB overlaps the box into out (array), returns count
  query(x0, y0, z0, x1, y1, z1, mask, out) {
    const P = this.p, sv = this._next();
    let n = 0;
    const push = i => {
      if (i === this.skip || !(P.flags[i] & mask)) return;
      const k = i * 3;
      if (P.mx[k] <= x0 || P.mn[k] >= x1 || P.mx[k + 1] <= y0 || P.mn[k + 1] >= y1 || P.mx[k + 2] <= z0 || P.mn[k + 2] >= z1) return;
      out[n++] = i;
    };
    for (let j = 0; j < this.dyn.length; j++) push(this.dyn[j]);
    const ax = this._c(x0, 0), bx = this._c(x1, 0), ay = this._c(y0, 1), by = this._c(y1, 1), az = this._c(z0, 2), bz = this._c(z1, 2);
    for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const c = (z * this.ny + y) * this.nx + x;
      for (let q = this.start[c], e = this.start[c + 1]; q < e; q++) {
        const i = this.items[q];
        if (this.stamp[i] === sv) continue;
        this.stamp[i] = sv; push(i);
      }
    }
    out.length = n;
    return n;
  }
}
