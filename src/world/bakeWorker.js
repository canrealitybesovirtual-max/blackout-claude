// Fallback bake in a Web Worker (used only when shipped lightmaps are missing or stale).
import { sectorB } from './level.js';
import { buildSector, sectorHash, encodeZoneBake } from './sector.js';
import { bakeSector } from './bake.js';

self.onmessage = (e) => {
  const sector = sectorB();
  const S = buildSector(sector, null, e.data.density);
  const res = bakeSector(S.built, S.grid, S.lights, sector.doors, S.doorPrims, {
    rays: e.data.rays, onProgress: p => self.postMessage({ progress: p }),
  });
  const hash = sectorHash(sector, e.data.density), out = {}, transfer = [];
  for (const id in res) { const b = encodeZoneBake(hash, res[id]); out[id] = b; transfer.push(b.buffer); }
  self.postMessage({ done: true, zones: out }, transfer);
};
