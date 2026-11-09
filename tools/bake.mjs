// Offline lightmap bake: node tools/bake.mjs  (writes bake/<zone>.bin)
// The game bakes in a Web Worker when these files are missing or stale.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectorB } from '../src/world/level.js';
import { buildSector, sectorHash, encodeZoneBake } from '../src/world/sector.js';
import { bakeSector } from '../src/world/bake.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sector = sectorB();
const t0 = performance.now();
const S = buildSector(sector);
const t1 = performance.now();
let last = -1;
const res = bakeSector(S.built, S.grid, S.lights, sector.doors, S.doorPrims, {
  onProgress: p => { const q = Math.floor(p * 10); if (q !== last) { last = q; process.stdout.write(`\r  bake ${q * 10}%`); } },
});
const t2 = performance.now();
const hash = sectorHash(sector);
mkdirSync(join(root, 'bake'), { recursive: true });
let bytes = 0;
for (const b of S.built) {
  const buf = encodeZoneBake(hash, res[b.id]);
  writeFileSync(join(root, 'bake', b.id + '.bin'), buf);
  bytes += buf.length;
  const tris = b.geo.index.length / 3;
  console.log(`\n  ${b.id}: atlas ${b.W}x${b.H} x${res[b.id].states} state(s), charts ${b.rects.length}, verts ${b.geo.count}, tris ${tris}, decals ${b.decals.count / 4}, lights ${b.zone.lights.length}`);
}
console.log(`  prims ${S.prims.n}, build ${(t1 - t0).toFixed(0)} ms, bake ${(t2 - t1).toFixed(0)} ms, ${(bytes / 1024).toFixed(0)} KB, hash ${hash.toString(16)}`);
