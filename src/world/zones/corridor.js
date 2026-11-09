// Sector B main corridor (start zone). Interior x[-1.6,1.6] z[0,28] h 3.0
import { zone, cableTray } from '../kit.js';
import { PANEL, PANEL_DOOR } from '../../config/panel.js';

const COOL = [0.93, 1.0, 0.95];

export default function corridor() {
  const z = zone('corridor', 'SECTOR B — MAIN CORRIDOR', [-1.6, 0, 0], [1.6, 3.0, 28], {
    neighbors: ['armory', 'tunnel'], reverb: 'corridor', ambience: 'vent', fogDensity: 0.03,
  });
  z.spawn = { pos: [0, 0, 2.7], yaw: Math.PI };

  z.shell({
    min: [-1.6, 0, 0], max: [1.6, 3.0, 28], t: { '+x': 0.15, '+z': 0.15 },
    open: [
      { side: '+x', a: 13.2, b: 14.8, h: 2.3, trim: 'steelDark' },
      { side: '+z', a: -0.6, b: 0.6, h: 2.2, trim: 'hazard' },
    ],
  });
  z.portals.push({ to: 'armory', min: [1.6, 0, 13.2], max: [1.9, 2.3, 14.8], door: 'armoryDoor' });
  z.portals.push({ to: 'tunnel', min: [-0.6, 0, 28], max: [0.6, 2.2, 28.3] });

  // structural rhythm: pilasters + ceiling beams every 4 m
  for (const c of [2, 6, 10, 18, 22, 26]) {
    z.box([-1.6, 0, c - 0.2], [-1.36, 3.0, c + 0.2], 'wall');
    z.box([1.36, 0, c - 0.2], [1.6, 3.0, c + 0.2], 'wall');
    z.box([-1.6, 2.76, c - 0.18], [1.6, 3.0, c + 0.18], 'conc');
    z.box([-1.6, 2.63, c - 0.03], [-0.97, 2.66, c + 0.03], 'steelGrey', { collide: false, occlude: false });
  }
  // lights between the beams; the last one has a failing tube (flickers)
  for (const c of [4, 8, 12, 16, 20, 24]) z.light(0, 3.0, c, { axis: 'z', color: COOL, power: 34, flicker: c === 24 });

  // services along the ceiling
  z.pipe([-1.25, 2.53, 0], [-1.25, 2.53, 28], 0.07, 'pipeGreen', { flange: 3 });
  z.pipe([-1.04, 2.57, 0], [-1.04, 2.57, 28], 0.04, 'pipeYellow', { flange: 4 });
  z.pipe([-1.27, 2.3, 0], [-1.27, 2.3, 28], 0.045, 'steelGrey', { flange: 3 });
  cableTray(z, 0, 28, 2.5, 1.02, 1.42);

  // south end: sealed blast door B1
  z.box([-1.32, 0, 0], [-0.006, 2.7, 0.18], 'steelGrey');
  z.box([0.006, 0, 0], [1.32, 2.7, 0.18], 'steelGrey');
  z.box([-1.6, 0, 0], [-1.32, 2.96, 0.26], 'hazard');
  z.box([1.32, 0, 0], [1.6, 2.96, 0.26], 'hazard');
  z.box([-1.32, 2.7, 0], [1.32, 2.96, 0.26], 'hazard');
  for (const y of [0.95, 1.85]) z.box([-1.05, y, 0.18], [1.05, y + 0.12, 0.25], 'steelDark');
  z.pipe([-1.2, 0.3, 0.32], [-1.2, 2.4, 0.32], 0.05, 'steel', { collide: false });
  z.pipe([1.2, 0.3, 0.32], [1.2, 2.4, 0.32], 0.05, 'steel', { collide: false });
  z.decal([0, 2.32, 0.255], [0, 0, 1], 1.5, 0.5, 'sign_blast');
  z.decal([0, 0.001, 0.75], [0, 1, 0], 3.0, 0.9, 'hazardFloor');

  // wall equipment
  // fire extinguisher: modelled in game/extinguisher.js; a collision box only here
  z.box([-1.6, 0.6, 11.31], [-1.39, 1.13, 11.49], 'steel', { render: false, occlude: false });
  z.decal([-1.599, 1.55, 11.4], [1, 0, 0], 0.36, 0.26, 'sign_fire');
  // electrical panel: the steel housing is baked here; frame, hinged door and breakers are game/panel.js (PANEL)
  const P = PANEL, D = PANEL_DOOR;
  z.box([P.back, P.y0, D.zh], [P.x, P.y1, P.z1], 'steelGrey');      // hinge side
  z.box([P.back, P.y0, P.z0], [P.x, P.y1, D.z2], 'steelGrey');      // latch side
  z.box([P.back, D.yb, D.z2], [P.x, P.y1, D.zh], 'steelGrey');      // top
  z.box([P.back, P.y0, D.z2], [P.x, D.ya, D.zh], 'steelGrey');      // bottom
  z.box([-1.6, 1.3, 16.5], [-1.48, 1.8, 16.95], 'steelGrey');
  z.box([-1.59, P.y1, 15.82], [-1.53, 3.0, 15.88], 'steel', { collide: false });
  z.box([-1.59, 1.8, 16.7], [-1.53, 3.0, 16.76], 'steel', { collide: false });
  z.box([-1.481, 1.71, 16.71], [-1.469, 1.73, 16.73], 'diffuser', { collide: false, occlude: false, emit: { face: 0, color: [0.2, 1.0, 0.3], power: 6 } });
  // bench
  z.box([-1.6, 0.42, 6.4], [-1.24, 0.47, 7.8], 'steelOlive');
  z.box([-1.55, 0, 6.5], [-1.3, 0.42, 6.56], 'steelOlive');
  z.box([-1.55, 0, 7.64], [-1.3, 0.42, 7.7], 'steelOlive');
  // door control panel (corridor side)
  z.box([1.52, 1.12, 12.55], [1.6, 1.46, 12.92], 'steelDark');

  // markings & signage
  z.decal([-1.15, 0.001, 14], [0, 1, 0], 0.08, 27, 'line');
  z.decal([1.15, 0.001, 6.4], [0, 1, 0], 0.08, 12.2, 'line');
  z.decal([1.15, 0.001, 21.4], [0, 1, 0], 0.08, 12.6, 'line');
  z.decal([1.05, 0.001, 14], [0, 1, 0], 1.1, 1.6, 'hazardFloor');
  z.decal([0, 0.001, 5.0], [0, 1, 0], 0.9, 0.9, 'stencil_b2');
  z.decal([-1.599, 1.95, 3.6], [1, 0, 0], 1.1, 0.36, 'sign_sectorb');
  z.decal([1.599, 2.62, 14.0], [-1, 0, 0], 1.0, 0.24, 'sign_armory');
  z.decal([1.599, 1.7, 12.0], [-1, 0, 0], 0.62, 0.24, 'sign_auth');
  z.decal([1.1, 1.75, 27.999], [0, 0, -1], 0.62, 0.5, 'sign_tunnel');
  z.decal([1.599, 1.9, 22.3], [-1, 0, 0], 0.5, 1.9, 'stain_water', { wet: 0.5 });
  z.decal([0.35, 0.002, 18.4], [0, 1, 0], 1.3, 1.1, 'stain_oil', { wet: 0.25 });
  z.decal([-0.2, 0.002, 25.6], [0, 1, 0], 1.6, 1.0, 'puddle', { wet: 1 });
  for (const [x, n, a, b] of [[-1.599, [1, 0, 0], 2.4, 5.6], [-1.599, [1, 0, 0], 10.4, 13.6], [-1.599, [1, 0, 0], 18.4, 21.6], [1.599, [-1, 0, 0], 6.4, 9.6], [1.599, [-1, 0, 0], 22.4, 25.6]])
    z.decal([x, 0.17, (a + b) / 2], n, b - a, 0.34, 'grime');

  z.emitters.push({ kind: 'hum', pos: [-1.5, 1.6, 15.9], gain: 0.25 });
  return z;
}
