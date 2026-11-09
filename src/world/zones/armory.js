// Armory / former test lane: emptied (shell, lights, duct, door panel only). Interior x[1.9,21.9] z[7,21] h 3.6
import { zone } from '../kit.js';

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
  z.decal([7.5, 3.159, 10.6], [0, -1, 0], 0.52, 0.32, 'vent', { up: [1, 0, 0] });
  z.decal([7.5, 3.159, 16.6], [0, -1, 0], 0.52, 0.32, 'vent', { up: [1, 0, 0] });

  // signage and wear
  z.box([1.9, 1.12, 12.55], [1.98, 1.46, 12.92], 'steelDark');
  z.decal([1.901, 1.75, 11.2], [1, 0, 0], 0.9, 0.3, 'sign_auth');
  z.decal([6.7, 0.002, 13.6], [0, 1, 0], 2.4, 2.0, 'stain_oil', { wet: 0.2 });
  for (const [p, n, w] of [[[11.9, 0.17, 7.001], [0, 0, 1], 6], [[17, 0.17, 20.999], [0, 0, -1], 8], [[21.199, 0.17, 14], [-1, 0, 0], 13.5]])
    z.decal(p, n, w, 0.34, 'grime');

  z.emitters.push({ kind: 'hvac', pos: [7.5, 3.3, 14], gain: 0.35 });
  return z;
}
