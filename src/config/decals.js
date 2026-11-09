// Decal atlas layout (1024 x 1024 px, top-left origin). Pure data shared with the builder.
export const DECAL_ATLAS = 1024;
export const DECAL_CELLS = {
  line:          [0, 0, 32, 256],
  hazardFloor:   [32, 0, 224, 224],
  sign_sectorb:  [256, 0, 384, 128],
  sign_armory:   [256, 128, 384, 96],
  sign_tunnel:   [640, 0, 192, 160],
  sign_fire:     [640, 160, 192, 128],
  stencil_b2:    [832, 0, 192, 192],
  sign_auth:     [0, 288, 384, 144],
  sign_blast:    [384, 288, 384, 128],
  sign_lift:     [768, 288, 256, 104],
  vent:          [896, 392, 128, 128],
  locker_vent:   [896, 520, 128, 64],
  sign_range:    [0, 432, 480, 160],
  firing_line:   [480, 432, 320, 64],
  sign_armorybig:[480, 496, 416, 128],
  grime:         [0, 624, 512, 96],
  hole_concrete: [512, 624, 96, 96],
  hole_metal:    [608, 624, 96, 96],
  arrow:         [704, 624, 96, 96],
  stain_water:   [0, 720, 128, 304],
  stain_oil:     [128, 720, 256, 256],
  puddle:        [384, 720, 320, 200],
  scorch:        [704, 720, 320, 304],
  sign_silo:     [832, 192, 192, 96],
  sign_drop:     [800, 624, 224, 96],
};
export function cellUV(name) {
  const c = DECAL_CELLS[name];
  if (!c) throw new Error('Unknown decal ' + name);
  const s = 1 / DECAL_ATLAS, e = 0.5 * s; // half-texel inset against bleeding
  return [c[0] * s + e, c[1] * s + e, (c[0] + c[2]) * s - e, (c[1] + c[3]) * s - e];
}
