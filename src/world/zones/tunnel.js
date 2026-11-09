// Maintenance tunnel B-T1 (streamed). Interior x[-1,1] z[28.3,50] h 2.6
import { zone, cableTray } from '../kit.js';

const SODIUM = [1.0, 0.63, 0.32];

export default function tunnel() {
  const z = zone('tunnel', 'MAINTENANCE TUNNEL B-T1', [-1.0, 0, 28.3], [1.0, 2.6, 50], {
    neighbors: ['corridor'], reverb: 'tunnel', ambience: 'tunnel', fog: [0.012, 0.009, 0.007], fogDensity: 0.05,
  });
  z.shell({
    min: [-1.0, 0, 28.3], max: [1.0, 2.6, 50], t: { '-z': 0.15 }, floor: 'plate', wall: 'concDark', ceil: 'concDark',
    open: [{ side: '-z', a: -0.6, b: 0.6, h: 2.2 }],
  });
  z.portals.push({ to: 'corridor', min: [-0.6, 0, 28], max: [0.6, 2.2, 28.3] });

  // main water main on saddles, two service lines above
  z.pipe([0.72, 0.45, 28.3], [0.72, 0.45, 50], 0.16, 'steelGrey', { collide: true, flange: 4 });
  z.pipe([0.8, 1.1, 28.3], [0.8, 1.1, 50], 0.08, 'pipeGreen', { flange: 3 });
  z.pipe([0.83, 1.45, 28.3], [0.83, 1.45, 50], 0.055, 'pipeYellow', { flange: 3 });
  for (let c = 29.5; c < 50; c += 2) {
    z.box([0.54, 0, c - 0.05], [0.9, 0.3, c + 0.05], 'steelDark');
    z.box([0.94, 0.95, c - 0.025], [1.0, 1.6, c + 0.025], 'steelDark', { collide: false });
    z.box([0.7, 1.0, c - 0.02], [1.0, 1.02, c + 0.02], 'steelDark', { collide: false, occlude: false });
    z.box([0.74, 1.37, c - 0.02], [1.0, 1.39, c + 0.02], 'steelDark', { collide: false, occlude: false });
  }
  cableTray(z, 28.3, 50, 2.2, -0.95, -0.6);
  z.pipe([-0.9, 1.9, 28.3], [-0.9, 1.9, 50], 0.025, 'steel', { collide: false });

  for (const c of [31, 37, 43, 48.6]) z.light(0, 2.6, c, { len: 0.16, wid: 0.16, color: SODIUM, power: 150, on: c !== 37, housing: 'steelDark', depth: 0.1, cage: true });

  // service lift at the end (expansion hook: future vertical link)
  z.box([-0.9, 0, 49.85], [-0.75, 2.3, 50], 'hazard');
  z.box([0.75, 0, 49.85], [0.9, 2.3, 50], 'hazard');
  z.box([-0.9, 2.15, 49.85], [0.9, 2.3, 50], 'hazard');
  z.box([-0.75, 0, 49.92], [-0.004, 2.15, 50], 'steelGrey');
  z.box([0.004, 0, 49.92], [0.75, 2.15, 50], 'steelGrey');
  z.box([-1.0, 1.2, 49.15], [-0.94, 1.5, 49.42], 'steelDark');
  z.box([-0.941, 1.42, 49.27], [-0.935, 1.44, 49.3], 'diffuser', { collide: false, occlude: false, emit: { face: 1, color: [1, 0.12, 0.05], power: 8 } });
  z.decal([0, 1.55, 49.919], [0, 0, -1], 0.95, 0.38, 'sign_lift');
  z.decal([-0.999, 1.7, 30.4], [1, 0, 0], 0.62, 0.5, 'sign_tunnel');

  z.decal([-0.3, 0.002, 34.2], [0, 1, 0], 1.2, 0.9, 'puddle', { wet: 1 });
  z.decal([0.0, 0.002, 45.2], [0, 1, 0], 1.4, 1.0, 'puddle', { wet: 1 });
  z.decal([-0.999, 1.6, 41], [1, 0, 0], 0.6, 2.0, 'stain_water', { wet: 0.6 });
  z.decal([-0.999, 0.17, 39], [1, 0, 0], 20, 0.34, 'grime');

  z.emitters.push({ kind: 'drip', pos: [-0.3, 2.5, 34.2], gain: 0.5 });
  z.emitters.push({ kind: 'drip', pos: [0.0, 2.5, 45.2], gain: 0.4 });
  z.emitters.push({ kind: 'rumble', pos: [0, 1.2, 49.5], gain: 0.5 });
  return z;
}
