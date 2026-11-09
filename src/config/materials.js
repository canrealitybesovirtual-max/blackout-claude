// Shared material catalogue. Pure data (no three.js) so the offline baker can use it.
// One texture-array layer per physical surface type; colour variants are vertex tints,
// so the whole static world renders with ONE shader program and ONE material per zone.

export const LAYERS = [
  'concrete',   // 0 polished floor slab (2 m joints)
  'block',      // 1 painted concrete block wall (white base, tinted)
  'ceiling',    // 2 raw formed concrete
  'paintsteel', // 3 painted steel with chips (white base, tinted)
  'steel',      // 4 bare / galvanised steel
  'hazard',     // 5 yellow-black worn stripes
  'polymer',    // 6 black polymer / rubber
  'wood',       // 7 plywood crate
  'gunmetal',   // 8 phosphate finish
  'brass',      // 9 cartridge brass
  'diffuser',   // 10 light diffuser
  'fabric',     // 11 canvas / nylon (white base, tinted)
  'plate',      // 12 diamond checker plate
];

// average linear albedo of each untinted layer (used by the bake for light bounce)
export const LAYER_ALBEDO = [
  [0.40, 0.39, 0.37], [0.80, 0.80, 0.78], [0.36, 0.35, 0.33], [0.74, 0.74, 0.72],
  [0.50, 0.51, 0.52], [0.36, 0.30, 0.10], [0.05, 0.05, 0.05], [0.42, 0.31, 0.19],
  [0.07, 0.07, 0.07], [0.62, 0.45, 0.20], [0.85, 0.85, 0.85], [0.60, 0.60, 0.58],
  [0.31, 0.31, 0.32],
];

// key -> { layer, tint (linear multiplier), scale (metres per texture tile), step, impact }
// step: footstep surface, impact: bullet impact class
export const MATERIALS = {
  floor:      { layer: 0, tint: [1, 1, 1],          scale: 1.4, step: 'concrete', impact: 'concrete' },
  floorDark:  { layer: 0, tint: [0.78, 0.78, 0.8],  scale: 1.4, step: 'concrete', impact: 'concrete' },
  wallLower:  { layer: 1, tint: [0.36, 0.42, 0.35], scale: 1.6, step: 'concrete', impact: 'concrete' },
  wallUpper:  { layer: 1, tint: [0.82, 0.82, 0.78], scale: 1.6, step: 'concrete', impact: 'concrete' },
  wallGrey:   { layer: 1, tint: [0.52, 0.54, 0.55], scale: 1.6, step: 'concrete', impact: 'concrete' },
  ceiling:    { layer: 2, tint: [1, 1, 1],          scale: 2.0, step: 'concrete', impact: 'concrete' },
  conc:       { layer: 2, tint: [1.1, 1.1, 1.08],   scale: 2.0, step: 'concrete', impact: 'concrete' },
  concDark:   { layer: 2, tint: [0.78, 0.77, 0.75], scale: 2.0, step: 'concrete', impact: 'concrete' },
  steelOlive: { layer: 3, tint: [0.34, 0.38, 0.29], scale: 1.0, step: 'metal', impact: 'metal' },
  steelGrey:  { layer: 3, tint: [0.48, 0.5, 0.51],  scale: 1.0, step: 'metal', impact: 'metal' },
  steelDark:  { layer: 3, tint: [0.2, 0.21, 0.22],  scale: 1.0, step: 'metal', impact: 'metal' },
  steelBlue:  { layer: 3, tint: [0.2, 0.27, 0.34],  scale: 1.0, step: 'metal', impact: 'metal' },
  steelRed:   { layer: 3, tint: [0.55, 0.06, 0.04], scale: 1.0, step: 'metal', impact: 'metal' },
  pipeYellow: { layer: 3, tint: [0.8, 0.6, 0.08],   scale: 1.0, step: 'metal', impact: 'metal' },
  pipeGreen:  { layer: 3, tint: [0.2, 0.35, 0.22],  scale: 1.0, step: 'metal', impact: 'metal' },
  steel:      { layer: 4, tint: [1, 1, 1],          scale: 1.0, step: 'metal', impact: 'metal' },
  hazard:     { layer: 5, tint: [1, 1, 1],          scale: 0.6, step: 'metal', impact: 'metal' },
  polymer:    { layer: 6, tint: [1, 1, 1],          scale: 0.5, step: 'concrete', impact: 'soft' },
  wood:       { layer: 7, tint: [1, 1, 1],          scale: 1.2, step: 'wood', impact: 'wood' },
  woodOlive:  { layer: 7, tint: [0.45, 0.5, 0.33],  scale: 1.2, step: 'wood', impact: 'wood' },
  gunmetal:   { layer: 8, tint: [1, 1, 1],          scale: 0.3, step: 'metal', impact: 'metal' },
  brass:      { layer: 9, tint: [1, 1, 1],          scale: 0.1, step: 'metal', impact: 'metal' },
  diffuser:   { layer: 10, tint: [1, 1, 1],         scale: 0.5, step: 'metal', impact: 'metal' },
  fabricOlive:{ layer: 11, tint: [0.36, 0.38, 0.27],scale: 0.6, step: 'concrete', impact: 'soft' },
  rubberTrap: { layer: 11, tint: [0.09, 0.09, 0.09],scale: 0.8, step: 'concrete', impact: 'soft' },
  plate:      { layer: 12, tint: [1, 1, 1],         scale: 1.0, step: 'metal', impact: 'metal' },
};

// two-tone wall: lower band + upper paint split at h metres (vertical faces only)
export const BANDS = {
  wall:     { h: 1.2, low: 'wallLower', high: 'wallUpper' },
  wallGreyBand: { h: 1.0, low: 'steelDark', high: 'wallGrey' },
};

export function matDef(key) {
  const m = MATERIALS[key];
  if (!m) throw new Error('Unknown material ' + key);
  return m;
}

export function matAlbedo(key) {
  const m = matDef(key), a = LAYER_ALBEDO[m.layer];
  return [a[0] * m.tint[0], a[1] * m.tint[1], a[2] * m.tint[2]];
}
