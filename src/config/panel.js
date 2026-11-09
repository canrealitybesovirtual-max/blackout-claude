// Corridor electrical panel layout (plain data: the zone, the baker and game/panel.js share it).
// layout (metres, corridor space); the photo's door sits at u 0.093..0.913, v 0.062..0.939 of the front
export const PANEL = { x: -1.43, back: -1.6, z0: 15.55, z1: 16.15, y0: 1.10, y1: 1.968, du: [0.093, 0.913], dv: [0.062, 0.939] };
const W = PANEL.z1 - PANEL.z0, H = PANEL.y1 - PANEL.y0;
export const zAt = u => PANEL.z1 - u * W, yAt = v => PANEL.y1 - v * H;
export const PANEL_DOOR = { zh: zAt(PANEL.du[0]), z2: zAt(PANEL.du[1]), ya: yAt(PANEL.dv[1]), yb: yAt(PANEL.dv[0]) };   // hinge z, latch z, bottom, top

