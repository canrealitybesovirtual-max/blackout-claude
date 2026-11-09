// Sector B: the bake unit. Zones are the streaming unit; a sector is baked together
// so light crosses zone borders. A future world is a list of sectors, each with its own
// zone files and baked lightmaps; nothing here assumes a fixed world size.
import corridor from './zones/corridor.js';
import armory from './zones/armory.js';
import tunnel from './zones/tunnel.js';
import silo from './zones/silo.js';

export const BAKE_VERSION = 3;

export function sectorB() {
  const zones = [corridor(), armory(), tunnel(), silo()];
  return {
    id: 'sectorB',
    zones,
    doors: [{
      id: 'armoryDoor', zones: ['corridor', 'armory'],
      min: [1.69, 0, 13.15], max: [1.81, 2.32, 14.85], slide: [0, 0, -1.72], time: 1.6,
      panels: [{ pos: [1.5, 1.29, 12.74], n: [-1, 0, 0] }, { pos: [2.0, 1.29, 12.74], n: [1, 0, 0] }],
    }],
    start: 'corridor',
  };
}
