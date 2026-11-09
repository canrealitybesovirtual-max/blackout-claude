// Sector assembly shared by runtime, Web Worker and the offline baker.
import { buildZone, buildPrims } from './build.js';
import { Grid } from './grid.js';
import { BAKE_VERSION } from './level.js';

export const LM_DENSITY = 8; // texels per metre (12.5 cm)

export function buildSector(sector, ids = null, density = LM_DENSITY) {
  const byId = Object.fromEntries(sector.zones.map(z => [z.id, z]));
  const list = ids ? ids.map(i => byId[i]) : sector.zones;
  const built = list.map(z => buildZone(z, z.neighbors.map(n => byId[n]).filter(Boolean), { density }));
  const index = Object.fromEntries(built.map((b, i) => [b.id, i]));
  const { prims, dyn, doorPrims } = buildPrims(built, sector.doors, id => index[id]);
  const grid = new Grid(prims, 1.0, dyn);
  const lights = built.flatMap(b => b.zone.lights);
  return { built, index, prims, grid, doorPrims, lights };
}

// FNV-1a over the level description: a changed level never uses a stale lightmap
export function sectorHash(sector, density = LM_DENSITY) {
  const s = JSON.stringify({ v: BAKE_VERSION, d: density, z: sector.zones, doors: sector.doors });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// binary format per zone: 'BSLM' u32 hash u16 W u16 H u8 states, then [lm, dir] x states (RGBA8)
export function encodeZoneBake(hash, z) {
  const n = z.W * z.H * 4, buf = new Uint8Array(16 + n * 2 * z.states), dv = new DataView(buf.buffer);
  buf.set([66, 83, 76, 77]);
  dv.setUint32(4, hash, true); dv.setUint16(8, z.W, true); dv.setUint16(10, z.H, true); dv.setUint8(12, z.states);
  for (let s = 0; s < z.states; s++) { buf.set(z.lm[s], 16 + n * 2 * s); buf.set(z.dir[s], 16 + n * (2 * s + 1)); }
  return buf;
}
export function decodeZoneBake(ab) {
  const buf = new Uint8Array(ab), dv = new DataView(buf.buffer, buf.byteOffset);
  if (buf[0] !== 66 || buf[1] !== 83 || buf[2] !== 76 || buf[3] !== 77) return null;
  const hash = dv.getUint32(4, true), W = dv.getUint16(8, true), H = dv.getUint16(10, true), states = dv.getUint8(12);
  const n = W * H * 4, z = { hash, W, H, states, lm: [], dir: [] };
  if (buf.length < 16 + n * 2 * states) return null;
  for (let s = 0; s < states; s++) { z.lm.push(buf.subarray(16 + n * 2 * s, 16 + n * (2 * s + 1))); z.dir.push(buf.subarray(16 + n * (2 * s + 1), 16 + n * (2 * s + 2))); }
  return z;
}
