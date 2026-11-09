// Modular construction kit. Zone files describe spaces with these helpers; the
// output is plain data (boxes, pipes, lights, decals) shared by the runtime and
// the offline baker. Every module reuses the same few materials.

export function zone(id, name, min, max, o = {}) {
  const z = {
    id, name, volume: { min, max }, neighbors: o.neighbors || [], portals: [],
    boxes: [], cyls: [], lights: [], decals: [], targets: [], emitters: [], fixtures: [],
    reverb: o.reverb || 'corridor', ambience: o.ambience || 'vent',
    fog: o.fog || [0.010, 0.011, 0.012], fogDensity: o.fogDensity ?? 0.035,
  };
  z.box = (mn, mx, mat, opt = {}) => {
    z.boxes.push({ min: mn, max: mx, mat, collide: opt.collide ?? true, occlude: opt.occlude ?? true,
      render: opt.render ?? true, emit: opt.emit || null, skip: opt.skip || null });
    return z.boxes.length - 1;
  };
  z.pipe = (a, b, r, mat, opt = {}) => {
    z.cyls.push({ a, b, r, mat, collide: opt.collide ?? false, occlude: opt.occlude ?? true,
      inward: opt.inward || false, sides: opt.sides, seg: opt.seg, arc: opt.arc });
    const fl = opt.flange;
    if (fl) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
      for (let s = fl * 0.5; s < len - 0.1; s += fl) {
        const p0 = a.map((v, i) => v + d[i] * (s - 0.025)), p1 = a.map((v, i) => v + d[i] * (s + 0.025));
        z.cyls.push({ a: p0, b: p1, r: r * 1.32, mat, collide: false, occlude: false });
        z.cyls.push({ a: p0, b: p1, r: r * 1.32 - 0.002, mat, collide: false, occlude: false, inward: true });   // its inside: no see-through ring
        z.cyls.push({ a: p0, b: p1, r: r * 1.005, mat, collide: false, occlude: false, sides: 12 });             // the gasket face it closes on
      }
    }
  };
  z.decal = (p, n, w, h, cell, opt = {}) => {
    z.decals.push({ p, n, w, h, cell, up: opt.up || (Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]),
      tint: opt.tint || [1, 1, 1], alpha: opt.alpha ?? 1, wet: opt.wet ?? 0 });
  };
  // ceiling light fixture (downward rectangular emitter) with its housing
  z.light = (x, y, zz, opt = {}) => {
    const len = opt.len ?? 1.2, wid = opt.wid ?? 0.2, axis = opt.axis || 'z', drop = opt.drop ?? 0;
    const hx = axis === 'x' ? len / 2 : wid / 2, hz = axis === 'x' ? wid / 2 : len / 2;
    const top = y - drop, bot = top - (opt.depth ?? 0.07);
    const color = opt.color || [1, 1, 1], power = opt.power ?? 35, flicker = !!opt.flicker, on = (opt.on ?? true) && !flicker;   // a failing tube is not baked: game/fixtures.js lights it
    z.box([x - hx - 0.03, bot, zz - hz - 0.03], [x + hx + 0.03, top, zz + hz + 0.03],
      { all: opt.housing || 'steelGrey', ny: 'diffuser' },
      { emit: { face: 2, color, power: on ? power : 0 }, occlude: true });
    if (drop > 0.02) for (const s of [-1, 1]) {
      const px = axis === 'x' ? x + s * hx * 0.7 : x, pz = axis === 'x' ? zz : zz + s * hz * 0.7;
      z.box([px - 0.006, top, pz - 0.006], [px + 0.006, y, pz + 0.006], 'steel', { occlude: false, collide: false });
    }
    if (opt.cage) { // wire cage around a bulkhead lamp, render only
      for (const s of [-1, 1]) {
        z.box([x - hx - 0.05, bot - 0.09, zz + s * (hz + 0.04) - 0.004], [x + hx + 0.05, bot - 0.085, zz + s * (hz + 0.04) + 0.004], 'steelDark', { occlude: false, collide: false });
        z.box([x + s * (hx + 0.04) - 0.004, bot - 0.09, zz - hz - 0.05], [x + s * (hx + 0.04) + 0.004, bot - 0.085, zz + hz + 0.05], 'steelDark', { occlude: false, collide: false });
      }
    }
    if (on) z.lights.push({ c: [x, bot - 0.012, zz], hx, hz, color, power });
    if (len >= 0.4) z.fixtures.push({ c: [x, bot, zz], hx, hz, axis, on: on || flicker, flicker, color, power });   // photo diffuser (game/fixtures.js)
    return z;
  };

  // bulb in a reflector cup on a wall (n = out of the wall); a baked point light
  z.wallLamp = (p, n, opt = {}) => {
    const color = opt.color || [1, 0.07, 0.03], power = opt.power ?? 2.2, cup = opt.cup || 'steelRed';
    const at = d => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
    z.cyls.push({ a: at(0), b: at(0.012), r: 0.085, mat: cup, collide: false, occlude: false, sides: 12 });   // base plate
    z.cyls.push({ a: at(0.012), b: at(0.07), r: 0.07, mat: cup, collide: false, occlude: false, sides: 12 });   // cup
    z.cyls.push({ a: at(0.02), b: at(0.11), r: 0.024, mat: 'diffuser', collide: false, occlude: false, sides: 8, emit: { color: [1, 0.55, 0.4], power: 26 } }); // bulb
    z.lights.push({ type: 'point', c: at(0.09), n, rad: 0.03, hx: 0.04, hz: 0.04, color, power, wall: true });
  };

  // room / corridor shell: floor slab, ceiling slab, four walls with openings.
  // t: wall thickness per side ('-x','+x','-z','+z'); shared walls use half thickness.
  z.shell = (o2) => {
    const [x0, , z0] = o2.min, [x1, h, z1] = o2.max;
    const T = { '-x': 0.3, '+x': 0.3, '-z': 0.3, '+z': 0.3, ...(o2.t || {}) };
    const wallMat = o2.wall || 'wall';
    const fx0 = x0 - T['-x'], fx1 = x1 + T['+x'], fz0 = z0 - T['-z'], fz1 = z1 + T['+z'];
    z.box([fx0, -0.3, fz0], [fx1, 0, fz1], o2.floor || 'floor');
    z.box([fx0, h, fz0], [fx1, h + 0.3, fz1], o2.ceil || 'ceiling');
    const opens = o2.open || [];
    for (const side of ['-x', '+x', '-z', '+z']) {
      if (o2.none && o2.none.includes(side)) continue;
      const t = T[side], alongX = side[1] === 'z';
      const lo = alongX ? fx0 : z0, hi = alongX ? fx1 : z1;
      const mk = (a, b, y0, y1) => {
        if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
        if (alongX) {
          const zA = side === '-z' ? z0 - t : z1, zB = side === '-z' ? z0 : z1 + t;
          z.box([a, y0, zA], [b, y1, zB], wallMat);
        } else {
          const xA = side === '-x' ? x0 - t : x1, xB = side === '-x' ? x0 : x1 + t;
          z.box([xA, y0, a], [xB, y1, b], wallMat);
        }
      };
      const os = opens.filter(q => q.side === side).sort((p, q) => p.a - q.a);
      let cur = lo;
      for (const q of os) {
        mk(cur, q.a, 0, h);
        mk(q.a, q.b, q.h, h);
        if (q.trim) z.frame(side, alongX ? (side === '-z' ? z0 : z1) : (side === '-x' ? x0 : x1), q.a, q.b, q.h, q.trim);
        cur = q.b;
      }
      mk(cur, hi, 0, h);
    }
  };
  // door frame trim on the inner face of a wall opening
  z.frame = (side, plane, a, b, oh, mat) => {
    const w = 0.07, d = 0.025, s = side[0] === '-' ? 1 : -1;
    const p0 = plane, p1 = plane + s * d;
    const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
    if (side[1] === 'x') {
      z.box([lo, 0, a - w], [hi, oh + w, a], mat);
      z.box([lo, 0, b], [hi, oh + w, b + w], mat);
      z.box([lo, oh, a], [hi, oh + w, b], mat);
    } else {
      z.box([a - w, 0, lo], [a, oh + w, hi], mat);
      z.box([b, 0, lo], [b + w, oh + w, hi], mat);
      z.box([a, oh, lo], [b, oh + w, hi], mat);
    }
  };
  return z;
}

// ---- reusable props (all boxes / pipes, shared materials) ----

export function crate(z, x, y, zz, w, h, d, mat = 'woodOlive') {
  z.box([x - w / 2, y, zz - d / 2], [x + w / 2, y + h, zz + d / 2], mat);
  // rim battens give the silhouette and baked contact shadows
  z.box([x - w / 2 - 0.012, y + h - 0.06, zz - d / 2 - 0.012], [x + w / 2 + 0.012, y + h - 0.01, zz + d / 2 + 0.012], mat, { occlude: false });
  z.box([x - w / 2 - 0.012, y + 0.01, zz - d / 2 - 0.012], [x + w / 2 + 0.012, y + 0.06, zz + d / 2 + 0.012], mat, { occlude: false });
}

export function ammoCan(z, x, y, zz, rotX = false) {
  const w = rotX ? 0.29 : 0.15, d = rotX ? 0.15 : 0.29;
  z.box([x - w / 2, y, zz - d / 2], [x + w / 2, y + 0.18, zz + d / 2], 'steelOlive', { collide: false });
  z.box([x - w / 2 + 0.02, y + 0.18, zz - d / 2 + 0.02], [x + w / 2 - 0.02, y + 0.195, zz + d / 2 - 0.02], 'steelOlive', { collide: false, occlude: false });
}

export function table(z, x0, z0, x1, z1, top = 0.9, mat = 'steelGrey', topMat = 'wood') {
  z.box([x0, top - 0.05, z0], [x1, top, z1], topMat);
  for (const [lx, lz] of [[x0 + 0.05, z0 + 0.05], [x1 - 0.05, z0 + 0.05], [x0 + 0.05, z1 - 0.05], [x1 - 0.05, z1 - 0.05]])
    z.box([lx - 0.025, 0, lz - 0.025], [lx + 0.025, top - 0.05, lz + 0.025], mat);
  z.box([x0 + 0.08, 0.2, z0 + 0.08], [x1 - 0.08, 0.23, z1 - 0.08], mat);
}

// gun rack against a wall facing -z (back at zb)
export function rifleRack(z, cx, zb) {
  const f = zb - 0.5;
  z.box([cx - 1.2, 0, f], [cx + 1.2, 0.15, zb], 'steelOlive');
  z.box([cx - 1.2, 0.15, f], [cx + 1.2, 0.25, f + 0.12], 'steelOlive');
  z.box([cx - 1.2, 1.12, zb - 0.2], [cx + 1.2, 1.17, zb], 'steelOlive');
  z.box([cx - 1.2, 1.55, f + 0.05], [cx + 1.2, 1.6, zb], 'steelOlive');
  z.box([cx - 1.2, 0, f], [cx - 1.15, 1.6, zb], 'steelOlive');
  z.box([cx + 1.15, 0, f], [cx + 1.2, 1.6, zb], 'steelOlive');
  for (let i = 0; i < 6; i++) {
    const x = cx - 1.0 + i * 0.4;
    z.box([x - 0.022, 0.25, f + 0.1], [x + 0.022, 0.95, f + 0.2], 'polymer', { collide: false });
    z.box([x - 0.02, 0.95, f + 0.16], [x + 0.02, 1.08, f + 0.3], 'gunmetal', { collide: false });
    z.box([x - 0.009, 1.08, f + 0.27], [x + 0.009, 1.38, f + 0.3], 'gunmetal', { collide: false, occlude: false });
    z.box([x - 0.014, 0.6, f + 0.02], [x + 0.014, 0.8, f + 0.1], 'polymer', { collide: false, occlude: false });
  }
}

// bank of steel lockers against a wall facing +z (back at zb)
export function lockers(z, x0, n, zb, mat = 'steelGrey') {
  z.box([x0, 0, zb], [x0 + n * 0.5, 0.08, zb + 0.52], 'steelDark');
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 0.5;
    z.box([x + 0.01, 0.08, zb], [x + 0.49, 1.9, zb + 0.5], mat);
    z.box([x + 0.39, 0.95, zb + 0.5], [x + 0.42, 1.12, zb + 0.53], 'steel', { collide: false, occlude: false });
    z.decal([x + 0.25, 1.62, zb + 0.5], [0, 0, 1], 0.32, 0.16, 'locker_vent');
    z.decal([x + 0.25, 0.32, zb + 0.5], [0, 0, 1], 0.32, 0.16, 'locker_vent');
  }
}

export function cableTray(z, a, b, y, xA, xB) { // tray running along z between a and b
  z.box([xA, y, a], [xB, y + 0.01, b], 'steel', { collide: false });
  z.box([xA, y, a], [xA + 0.01, y + 0.08, b], 'steel', { collide: false, occlude: false });
  z.box([xB - 0.01, y, a], [xB, y + 0.08, b], 'steel', { collide: false, occlude: false });
  const w = xB - xA;
  z.box([xA + w * 0.12, y + 0.01, a], [xA + w * 0.3, y + 0.05, b], 'polymer', { collide: false, occlude: false });
  z.box([xA + w * 0.38, y + 0.01, a], [xA + w * 0.6, y + 0.06, b], 'steelDark', { collide: false, occlude: false });
  z.box([xA + w * 0.68, y + 0.01, a], [xA + w * 0.86, y + 0.045, b], 'polymer', { collide: false, occlude: false });
}
