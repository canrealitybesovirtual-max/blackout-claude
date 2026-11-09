// Armory + 9 m test lane. Interior x[1.9,21.9] z[7,21] h 3.6
import { zone, crate, ammoCan, table, rifleRack, lockers } from '../kit.js';

const WARM = [1.0, 0.93, 0.83];

export default function armory() {
  const z = zone('armory', 'ARMORY / TEST LANE B-4', [1.9, 0, 7], [21.9, 3.6, 21], {
    neighbors: ['corridor'], reverb: 'armory', ambience: 'hvac', fogDensity: 0.022,
  });
  z.shell({
    min: [1.9, 0, 7], max: [21.9, 3.6, 21], t: { '-x': 0.15 }, floor: 'floorDark', wall: 'wallGreyBand',
    open: [{ side: '-x', a: 13.2, b: 14.8, h: 2.3, trim: 'steelDark' }],
  });
  z.portals.push({ to: 'corridor', min: [1.6, 0, 13.2], max: [1.9, 2.3, 14.8], door: 'armoryDoor' });

  for (const x of [5, 10]) for (const c of [10, 14, 18]) z.light(x, 3.6, c, { axis: 'x', color: WARM, power: 44 });
  for (const c of [11, 17]) z.light(17.2, 3.6, c, { axis: 'z', color: WARM, power: 44 });

  // supply duct along the ceiling
  z.box([7.2, 3.16, 7], [7.8, 3.6, 21], 'steel', { collide: false });
  for (let c = 8.5; c < 21; c += 1.5) z.box([7.17, 3.13, c - 0.02], [7.83, 3.6, c + 0.02], 'steel', { collide: false, occlude: false });
  z.decal([7.5, 3.159, 10.6], [0, -1, 0], 0.5, 0.5, 'vent', { up: [0, 0, 1] });
  z.decal([7.5, 3.159, 16.6], [0, -1, 0], 0.5, 0.5, 'vent', { up: [0, 0, 1] });

  // weapon racks on the north wall, lockers on the south wall
  for (const cx of [4.0, 6.8, 9.6]) rifleRack(z, cx, 21);
  lockers(z, 2.3, 12, 7);

  // workbench with ammo cans
  table(z, 5.2, 12.9, 8.2, 14.3, 0.92);
  ammoCan(z, 5.6, 0.92, 13.3, true); ammoCan(z, 5.95, 0.92, 13.3, true); ammoCan(z, 7.6, 0.92, 13.9);
  crate(z, 6.6, 0.23, 13.6, 0.9, 0.42, 0.55);
  // crate stacks
  crate(z, 11.8, 0, 20.3, 1.1, 0.6, 0.8); crate(z, 11.75, 0.6, 20.3, 1.0, 0.55, 0.75);
  crate(z, 12.0, 0, 19.2, 0.8, 0.5, 0.7, 'wood');
  crate(z, 12.6, 0, 7.6, 1.0, 0.7, 0.7); crate(z, 11.5, 0, 7.55, 0.7, 0.45, 0.6, 'wood');

  // firing line counters with a gap in the middle
  for (const [a, b] of [[9.0, 12.6], [15.4, 19.0]]) {
    z.box([13.0, 0.88, a], [13.62, 0.93, b], 'wood');
    z.box([13.0, 0, a], [13.08, 0.88, b], 'steelDark');
    z.box([13.54, 0, a], [13.62, 0.88, b], 'steelDark', { occlude: false });
  }
  z.decal([12.75, 0.001, 14], [0, 1, 0], 0.1, 13.8, 'line', { tint: [1, 0.25, 0.2] });
  z.decal([12.5, 0.002, 14], [0, 1, 0], 1.3, 0.26, 'firing_line', { up: [1, 0, 0] });

  // targets: posts are static, plates are dynamic
  for (const c of [11, 14, 17]) {
    z.box([20.35, 0, c - 0.46], [20.42, 1.76, c - 0.4], 'steelDark');
    z.box([20.35, 0, c + 0.4], [20.42, 1.76, c + 0.46], 'steelDark');
    z.box([20.35, 1.7, c - 0.46], [20.42, 1.76, c + 0.46], 'steelDark');
    z.box([20.375, 1.6, c - 0.12], [20.395, 1.7, c - 0.11], 'steel', { collide: false, occlude: false });
    z.box([20.375, 1.6, c + 0.11], [20.395, 1.7, c + 0.12], 'steel', { collide: false, occlude: false });
    z.targets.push({ pivot: [20.385, 1.6, c], w: 0.3, h: 0.45 });
  }
  // bullet trap and deflector
  z.box([21.2, 0, 7], [21.9, 2.6, 21], 'rubberTrap');
  z.box([20.8, 2.6, 7], [21.9, 2.72, 21], 'steelDark');

  // signage and wear
  z.box([1.9, 1.12, 12.55], [1.98, 1.46, 12.92], 'steelDark');
  z.decal([1.901, 1.75, 11.2], [1, 0, 0], 0.9, 0.3, 'sign_auth');
  z.decal([17.2, 2.35, 20.999], [0, 0, -1], 1.5, 0.5, 'sign_range');
  z.decal([1.901, 2.0, 16.6], [1, 0, 0], 1.3, 0.42, 'sign_armorybig');
  z.decal([6.7, 0.002, 13.6], [0, 1, 0], 2.4, 2.0, 'stain_oil', { wet: 0.2 });
  z.decal([16.5, 0.002, 14], [0, 1, 0], 2.0, 1.2, 'scorch', { alpha: 0.6 });
  for (const [p, n, w] of [[[11.9, 0.17, 7.001], [0, 0, 1], 6], [[17, 0.17, 20.999], [0, 0, -1], 8], [[21.199, 0.17, 14], [-1, 0, 0], 13.5]])
    z.decal(p, n, w, 0.34, 'grime');

  z.emitters.push({ kind: 'hvac', pos: [7.5, 3.3, 14], gain: 0.35 });
  return z;
}
