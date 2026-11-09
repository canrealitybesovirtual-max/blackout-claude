// Silo 7: a launch shaft crossed by a gantry bridge. The top 26 m are real, baked geometry;
// below that the "abyss" (render/abyss.js) carries the shaft down 320 m with light dying off
// and warning lamps receding, so the bottom is never seen. Shaft axis x 0, z 59.3, radius 6.
import { zone } from '../kit.js';

export const SILO = { c: [0, 59.3], r: 6, top: 12, base: -14 };
const SODIUM = [1.0, 0.63, 0.32], COOL = [0.9, 0.97, 1.0];

export default function silo() {
  const { c: [cx, cz], r: R } = SILO;
  const z = zone('silo', 'SILO 7 — LAUNCH SHAFT', [-R, SILO.base, 50.15], [R, SILO.top, cz + R], {
    neighbors: ['tunnel'], reverb: 'silo', ambience: 'silo', fog: [0.008, 0.009, 0.011], fogDensity: 0.012,
  });
  z.portals.push({ to: 'tunnel', min: [-0.8, 0, 50.0], max: [0.52, 2.4, 50.3] });
  z.abyss = { c: [cx, cz], r: R, top: SILO.base, depth: 320, sides: 56, mat: 'concDark' };

  // ---- passage from the tunnel (blast-door frame at the shaft end)
  z.box([-1.1, -0.3, 50.15], [1.1, 0, 53.6], 'plate');
  z.box([-1.1, 2.7, 50.15], [1.1, 3.0, 53.6], 'concDark');
  z.box([-1.1, 0, 50.15], [-0.8, 2.7, 53.6], 'concDark');
  z.box([0.8, 0, 50.15], [1.1, 2.7, 53.6], 'concDark');
  z.box([-0.8, 2.4, 50.15], [0.8, 2.7, 50.3], 'concDark');
  z.box([-0.8, 0, 53.2], [-0.62, 2.4, 53.6], 'hazard');
  z.box([0.62, 0, 53.2], [0.8, 2.4, 53.6], 'hazard');
  z.box([-0.8, 2.22, 53.2], [0.8, 2.4, 53.6], 'hazard');
  z.light(0, 2.7, 51.9, { len: 0.16, wid: 0.16, color: SODIUM, power: 110, housing: 'steelDark', depth: 0.1, cage: true });
  z.decal([-0.799, 1.55, 52.3], [1, 0, 0], 0.9, 0.38, 'sign_drop');
  z.decal([0, 0.002, 52.9], [0, 1, 0], 1.5, 0.6, 'hazardFloor');

  // ---- shaft wall: full ring below the deck, a doorway gap at the passage, full ring above it
  const gap = Math.asin(1.1 / R);
  z.pipe([cx, SILO.base, cz], [cx, 0, cz], R, 'concDark', { inward: true, sides: 56, seg: 0.5, collide: false });
  z.pipe([cx, 0, cz], [cx, 2.7, cz], R, 'concDark', { inward: true, sides: 56, seg: 0.45, arc: [gap, 2 * Math.PI - gap], collide: false });
  z.pipe([cx, 2.7, cz], [cx, SILO.top, cz], R, 'concDark', { inward: true, sides: 56, seg: 0.5, collide: false });
  // closed silo lid overhead, seam down the middle
  z.box([-R - 0.4, SILO.top, cz - R - 0.4], [-0.01, SILO.top + 0.6, cz + R + 0.4], 'steelDark');
  z.box([0.01, SILO.top, cz - R - 0.4], [R + 0.4, SILO.top + 0.6, cz + R + 0.4], 'steelDark');

  // ---- gantry: entry landing, bridge across the axis, far landing
  const decks = [[-1.6, 53.2, 1.6, 55.2], [-0.65, 55.2, 0.65, 63.4], [-1.6, 63.4, 1.6, 65.4]];
  for (const [x0, z0, x1, z1] of decks) z.box([x0, -0.25, z0], [x1, 0, z1], 'plate');
  z.box([-0.68, -0.6, 55.2], [-0.56, -0.25, 63.4], 'steelDark');
  z.box([0.56, -0.6, 55.2], [0.68, -0.6 + 0.35, 63.4], 'steelDark');
  for (const zz of [55.2, 59.3, 63.4]) z.box([-0.68, -0.5, zz - 0.06], [0.68, -0.25, zz + 0.06], 'steelDark');
  // railings: yellow posts / rails (visual) + one invisible blocker per run
  const rail = (ax, az, bx, bz) => {
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az), L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / 1.5));
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, zz = az + (bz - az) * i / n;
      z.box([x - 0.025, 0, zz - 0.025], [x + 0.025, 1.1, zz + 0.025], 'pipeYellow', { collide: false, occlude: false });
    }
    const t = 0.022;
    for (const y of [1.05, 0.55]) {
      if (alongX) z.box([Math.min(ax, bx), y, az - t], [Math.max(ax, bx), y + 0.05, az + t], 'pipeYellow', { collide: false, occlude: false });
      else z.box([ax - t, y, Math.min(az, bz)], [ax + t, y + 0.05, Math.max(az, bz)], 'pipeYellow', { collide: false, occlude: false });
    }
    if (alongX) z.box([Math.min(ax, bx), 0, az - 0.008], [Math.max(ax, bx), 0.12, az + 0.008], 'steelDark', { collide: false, occlude: false });
    else z.box([ax - 0.008, 0, Math.min(az, bz)], [ax + 0.008, 0.12, Math.max(az, bz)], 'steelDark', { collide: false, occlude: false });
    if (alongX) z.box([Math.min(ax, bx), 0, az - 0.05], [Math.max(ax, bx), 1.3, az + 0.05], 'steel', { render: false, occlude: false });
    else z.box([ax - 0.05, 0, Math.min(az, bz)], [ax + 0.05, 1.3, Math.max(az, bz)], 'steel', { render: false, occlude: false });
  };
  rail(-0.62, 55.2, -0.62, 63.4); rail(0.62, 55.2, 0.62, 63.4);          // bridge
  rail(-1.57, 53.2, -1.57, 55.17); rail(1.57, 53.2, 1.57, 55.17);        // entry landing sides
  rail(-1.57, 55.17, -0.62, 55.17); rail(0.62, 55.17, 1.57, 55.17);
  rail(-1.57, 63.43, -1.57, 65.4); rail(1.57, 63.43, 1.57, 65.4);        // far landing sides
  rail(-1.57, 63.43, -0.62, 63.43); rail(0.62, 63.43, 1.57, 63.43);
  z.decal([0, 0.002, 55.05], [0, 1, 0], 1.2, 0.28, 'hazardFloor');

  // far side: sealed launch control door
  z.box([-1.0, 0, 65.0], [1.0, 2.4, 65.4], 'steelGrey');
  z.box([-1.25, 0, 64.92], [-1.0, 2.65, 65.4], 'hazard');
  z.box([1.0, 0, 64.92], [1.25, 2.65, 65.4], 'hazard');
  z.box([-1.25, 2.4, 64.92], [1.25, 2.65, 65.4], 'hazard');
  for (const y of [0.75, 1.65]) z.box([-0.85, y, 64.92], [0.85, y + 0.1, 65.0], 'steelDark');
  z.decal([0, 2.05, 64.999], [0, 0, -1], 1.1, 0.48, 'sign_silo');

  // ---- light: work lights under the lid, floods under the decks (they light the drop), wall bulkheads
  for (const [x, zz] of [[-3.2, cz], [3.2, cz], [0, cz - 3.4], [0, cz + 3.4]]) z.light(x, SILO.top, zz, { axis: 'z', color: COOL, power: 115, drop: 0.5, housing: 'steelDark' });
  for (const zz of [54.2, 59.3, 64.4]) z.light(0, -0.25, zz, { len: 0.5, wid: 0.3, color: COOL, power: 70, housing: 'steelDark', depth: 0.1 });
  for (const ph of [0.55, 2.6, 3.7, 5.75]) {
    const lx = cx + Math.cos(ph) * (R - 0.45), lz = cz + Math.sin(ph) * (R - 0.45);
    z.light(lx, 3.3, lz, { len: 0.16, wid: 0.16, color: SODIUM, power: 120, housing: 'steelDark', depth: 0.12, cage: true });
    z.pipe([lx, 3.32, lz], [cx + Math.cos(ph) * (R + 0.02), 3.32, cz + Math.sin(ph) * (R + 0.02)], 0.025, 'steelDark', { occlude: false });
  }

  // ---- services down the wall: two pipes and a ladder (the abyss continues them)
  for (const [px, pz, pr, mat] of [[-5.68, 58.6, 0.12, 'steelGrey'], [-5.7, 60.05, 0.08, 'pipeGreen']]) z.pipe([px, SILO.base, pz], [px, SILO.top, pz], pr, mat, { flange: 3, occlude: false });
  z.box([5.8, SILO.base, 59.03], [5.84, 3.0, 59.07], 'steel', { collide: false, occlude: false });
  z.box([5.8, SILO.base, 59.53], [5.84, 3.0, 59.57], 'steel', { collide: false, occlude: false });
  for (let y = SILO.base + 0.3; y < 3.0; y += 0.3) z.box([5.79, y, 59.07], [5.83, y + 0.025, 59.53], 'steel', { collide: false, occlude: false });

  z.emitters.push({ kind: 'groan', pos: [cx, -60, cz], gain: 0.9 });
  z.emitters.push({ kind: 'drip', pos: [-3, -25, cz + 2], gain: 0.35 });
  return z;
}
