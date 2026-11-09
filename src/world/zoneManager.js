// Zone streaming + portal visibility. A zone is loaded (geometry, lightmaps, decals,
// glows, emitters) only while it is the current zone or a neighbour of it; everything
// else is disposed. Portals decide which loaded zones are drawn each frame.
import * as THREE from 'three';
import { buildZone, buildPrims, faceTexel } from './build.js';
import { Grid, F_SHOOT } from './grid.js';
import { sectorHash, decodeZoneBake, LM_DENSITY } from './sector.js';
import { makeWorldMaterial, makeDecalMaterial, makeGlowMaterial } from '../render/shaders.js';

const IDB = 'blacksite-bake';
function idb() { return new Promise((res) => { try { const r = indexedDB.open(IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore('lm'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }); }
async function idbGet(key) { const db = await idb(); if (!db) return null; return new Promise(res => { try { const q = db.transaction('lm').objectStore('lm').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
async function idbPut(key, val) { const db = await idb(); if (!db) return; try { db.transaction('lm', 'readwrite').objectStore('lm').put(val, key); } catch (e) { /* quota */ } }

function lmTex(data, W, H) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

export class ZoneManager {
  constructor(sector, o) {
    this.sector = sector; this.o = o; // { scene, arrays, decalAtlas, perf, audio, glows:boolean, onStatus }
    this.byId = Object.fromEntries(sector.zones.map(z => [z.id, z]));
    this.hash = sectorHash(sector);
    this.loaded = new Map(); // id -> runtime zone
    this.list = [];          // loaded zones in prim order
    this.current = sector.start;
    this.loading = new Set();
    this.doorOpen = {}; for (const d of sector.doors) this.doorOpen[d.id] = 0;
    this.frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._b = new THREE.Box3();
    this.onGrid = null; this._bake = null; this.glowTick = 0;
  }

  async init(onProgress) {
    const ids = [this.sector.start, ...this.byId[this.sector.start].neighbors];
    let n = 0;
    for (const id of ids) { await this.load(id); onProgress && onProgress(++n / ids.length); }
  }

  // ---- lightmaps: shipped file -> IndexedDB cache -> worker bake ----
  async lightmapFor(id) {
    try {
      const r = await fetch(`bake/${id}.bin`, { cache: 'no-cache' });
      if (r.ok) { const z = decodeZoneBake(await r.arrayBuffer()); if (z && z.hash === this.hash) return z; }
    } catch (e) { /* offline or missing */ }
    const cached = await idbGet(`${this.hash}:${id}`);
    if (cached) { const z = decodeZoneBake(cached); if (z && z.hash === this.hash) return z; }
    const all = await this.workerBake();
    return decodeZoneBake(all[id]);
  }
  workerBake() {
    if (this._bake) return this._bake;
    this.o.onStatus && this.o.onStatus('Baking lighting (first run only)…');
    this._bake = new Promise((res, rej) => {
      const w = new Worker(new URL('./bakeWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        if (e.data.progress !== undefined) { this.o.onStatus && this.o.onStatus(`Baking lighting ${Math.round(e.data.progress * 100)}%`); return; }
        for (const id in e.data.zones) idbPut(`${this.hash}:${id}`, e.data.zones[id].buffer);
        w.terminate(); res(e.data.zones);
      };
      w.onerror = (e) => { w.terminate(); rej(e); };
      w.postMessage({ density: LM_DENSITY, rays: 24 });
    });
    return this._bake;
  }

  async load(id) {
    if (this.loaded.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    const t0 = performance.now();
    const z = this.byId[id];
    const bz = buildZone(z, z.neighbors.map(n => this.byId[n]).filter(Boolean), { density: LM_DENSITY });
    const lm = await this.lightmapFor(id);
    if (!lm || lm.W !== bz.W || lm.H !== bz.H) throw new Error(`Lightmap for ${id} does not match its geometry`);
    const tex = { lm0: lmTex(lm.lm[0], lm.W, lm.H), dir0: lmTex(lm.dir[0], lm.W, lm.H) };
    tex.lm1 = lm.states > 1 ? lmTex(lm.lm[1], lm.W, lm.H) : tex.lm0;
    tex.dir1 = lm.states > 1 ? lmTex(lm.dir[1], lm.W, lm.H) : tex.dir0;

    const g = new THREE.BufferGeometry(), G = bz.geo;
    g.setAttribute('position', new THREE.BufferAttribute(G.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(G.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(G.uv, 2));
    g.setAttribute('lmuv', new THREE.BufferAttribute(G.lmuv, 2));
    g.setAttribute('aLayer', new THREE.BufferAttribute(G.layer, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(G.tint, 3, true));
    g.setAttribute('aEmit', new THREE.BufferAttribute(G.emit, 1));
    g.setIndex(new THREE.BufferAttribute(G.index, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mat = makeWorldMaterial(this.o.arrays, tex);
    const mesh = new THREE.Mesh(g, mat); mesh.matrixAutoUpdate = false; mesh.name = 'zone:' + id;

    const D = bz.decals, dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(D.position, 3));
    const dn = new Float32Array(D.count * 3);
    for (let i = 0; i < z.decals.length; i++) for (let k = 0; k < 4; k++) dn.set(z.decals[i].n, (i * 4 + k) * 3);
    dg.setAttribute('normal', new THREE.BufferAttribute(dn, 3));
    dg.setAttribute('uv', new THREE.BufferAttribute(D.uv, 2));
    dg.setAttribute('lmuv', new THREE.BufferAttribute(D.lmuv, 2));
    dg.setAttribute('aTint', new THREE.BufferAttribute(D.tint, 4));
    dg.setAttribute('aWet', new THREE.BufferAttribute(D.wet, 1));
    dg.setIndex(new THREE.BufferAttribute(D.index, 1));
    dg.computeBoundingSphere();
    const dmat = makeDecalMaterial(this.o.decalAtlas, tex);
    const decals = new THREE.Mesh(dg, dmat); decals.matrixAutoUpdate = false; decals.renderOrder = 1;

    let glow = null;
    if (this.o.glows && bz.glows.count) {
      const Gl = bz.glows, gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(Gl.position, 3));
      gg.setAttribute('corner', new THREE.BufferAttribute(Gl.corner, 2));
      gg.setAttribute('gcol', new THREE.BufferAttribute(Gl.color, 3));
      gg.setAttribute('gsize', new THREE.BufferAttribute(Gl.size, 2));
      gg.setIndex(new THREE.BufferAttribute(Gl.index, 1));
      gg.computeBoundingSphere(); gg.boundingSphere.radius += 1;
      glow = new THREE.Mesh(gg, makeGlowMaterial()); glow.matrixAutoUpdate = false; glow.renderOrder = 3; glow.frustumCulled = true;
    }

    const rz = { id, z, bz, mesh, decals, glow, tex, lm, mat, dmat, visible: false, glowVis: new Float32Array(32).fill(0) };
    this.o.scene.add(mesh); this.o.scene.add(decals); if (glow) this.o.scene.add(glow);
    this.loaded.set(id, rz);
    this.loading.delete(id);
    this.o.audio && this.o.audio.addEmitters(id, z.emitters);
    this.o.perf.texBytes += lm.W * lm.H * 4 * 2 * lm.states;
    this.applyDoors();
    this.rebuildGrid();
    this.o.perf.notes['load ' + id] = (performance.now() - t0).toFixed(0) + ' ms';
    this.o.onLoad && this.o.onLoad(rz);
  }

  unload(id) {
    const rz = this.loaded.get(id); if (!rz) return;
    this.o.scene.remove(rz.mesh, rz.decals); if (rz.glow) { this.o.scene.remove(rz.glow); rz.glow.geometry.dispose(); rz.glow.material.dispose(); }
    rz.mesh.geometry.dispose(); rz.mat.dispose(); rz.decals.geometry.dispose(); rz.dmat.dispose();
    for (const t of new Set(Object.values(rz.tex))) t.dispose();
    this.o.perf.texBytes -= rz.lm.W * rz.lm.H * 4 * 2 * rz.lm.states;
    this.o.audio && this.o.audio.removeEmitters(id);
    this.loaded.delete(id);
    delete this.o.perf.notes['load ' + id];
    this.rebuildGrid();
    this.o.onUnload && this.o.onUnload(id);
  }

  rebuildGrid() {
    this.list = [...this.loaded.values()];
    const { prims, dyn, doorPrims } = buildPrims(this.list.map(r => r.bz), this.sector.doors, id => this.list.findIndex(r => r.id === id));
    this.prims = prims; this.doorPrims = doorPrims;
    this.grid = new Grid(prims, 1.0, dyn);
    this.lights = this.list.flatMap(r => r.z.lights.map((L, i) => ({ ...L, zone: r.id, idx: i })));
    this.onGrid && this.onGrid(this);
  }

  zoneAt(p) {
    for (const z of this.sector.zones) {
      const v = z.volume;
      if (p.x >= v.min[0] && p.x <= v.max[0] && p.z >= v.min[2] && p.z <= v.max[2] && p.y >= v.min[1] - 0.5 && p.y <= v.max[1] + 0.5) return z.id;
    }
    return null;
  }

  setDoor(id, f) { this.doorOpen[id] = f; this.applyDoors(); }
  applyDoors() {
    for (const d of this.sector.doors) for (const zid of d.zones) {
      const rz = this.loaded.get(zid); if (!rz) continue;
      rz.mat.uniforms.uDoor.value = this.doorOpen[d.id]; rz.dmat.uniforms.uDoor.value = this.doorOpen[d.id];
    }
  }

  // streaming + visibility, call every frame
  update(camera) {
    const p = camera.position, here = this.zoneAt(p);
    if (here && here !== this.current) { this.current = here; this.o.onZone && this.o.onZone(this.byId[here]); }
    const want = new Set([this.current, ...this.byId[this.current].neighbors]);
    for (const id of want) if (!this.loaded.has(id)) this.load(id).catch(e => console.error(e));
    for (const id of [...this.loaded.keys()]) if (!want.has(id)) {
      // hysteresis: keep until 6 m away from that zone's volume
      const v = this.byId[id].volume, dx = Math.max(v.min[0] - p.x, 0, p.x - v.max[0]), dz = Math.max(v.min[2] - p.z, 0, p.z - v.max[2]);
      if (Math.hypot(dx, dz) > 6) this.unload(id);
    }
    // portal visibility: current zone + neighbours seen through an open, on-screen portal
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    let calls = 0;
    for (const rz of this.loaded.values()) {
      let vis = rz.id === this.current;
      if (!vis) for (const pt of this.byId[this.current].portals) {
        if (pt.to !== rz.id) continue;
        if (pt.door && this.doorOpen[pt.door] <= 0.001) continue;
        this._b.min.set(...pt.min); this._b.max.set(...pt.max);
        if (this.frustum.intersectsBox(this._b)) vis = true;
      }
      // standing inside a doorway: draw both sides
      if (!vis && !this.zoneAt(p)) vis = true;
      rz.visible = vis; rz.mesh.visible = rz.decals.visible = vis; if (rz.glow) rz.glow.visible = vis;
      if (vis) calls++;
    }
    this.o.perf.counters.zones = `${this.loaded.size} loaded / ${calls} drawn`;
    this.updateGlows(camera);
  }

  // halos fade when the fixture is occluded (one ray per visible light, round-robin)
  updateGlows(camera) {
    if (!this.grid) return;
    const c = camera.position;
    this.glowTick++;
    for (const rz of this.loaded.values()) {
      if (!rz.glow || !rz.visible) continue;
      const L = rz.z.lights, vis = rz.glow.material.uniforms.uVis.value;
      for (let i = 0; i < L.length; i++) {
        if ((i + this.glowTick) % 3) { vis[i] += (rz.glowVis[i] - vis[i]) * 0.3; continue; }
        const lx = L[i].c[0], ly = L[i].c[1] - 0.03, lz = L[i].c[2];
        let dx = lx - c.x, dy = ly - c.y, dz = lz - c.z; const d = Math.hypot(dx, dy, dz); dx /= d; dy /= d; dz /= d;
        // fixtures face down: invisible from above their plane
        const facing = Math.max(0, Math.min(1, -dy * 4 + 0.15));
        const blocked = this.grid.ray(c.x, c.y, c.z, dx, dy, dz, d - 0.05, F_SHOOT, true);
        rz.glowVis[i] = blocked ? 0 : facing;
        vis[i] += (rz.glowVis[i] - vis[i]) * 0.3;
      }
    }
  }

  // baked lighting (diffuse factor) at a surface point; used by bullet holes and probes
  lightAtHit(prim, face, p, out) {
    const P = this.prims, zi = P.zone[prim];
    out[0] = out[1] = out[2] = 0.05;
    if (zi < 0) return out;
    const rz = this.list[zi]; if (!rz) return out;
    const loc = P.local[prim];
    const ri = P.type[prim] === 0 ? (face >= 0 ? rz.bz.faceRect[loc * 6 + face] : -1) : rz.bz.cylRect[loc];
    if (ri < 0) return out;
    const [tx, ty] = faceTexel(rz.bz, ri, p);
    return this.texel(rz, tx, ty, out);
  }
  texel(rz, tx, ty, out) {
    const W = rz.lm.W, i = (ty * W + tx) * 4, f = this.doorOpen.armoryDoor ?? 0;
    const dec = (arr, k) => { const v = arr[i + k] / 255 * arr[i + 3] / 255 * 4; return v * v; };
    const a = rz.lm.lm[0], b = rz.lm.lm[rz.lm.states > 1 ? 1 : 0];
    for (let k = 0; k < 3; k++) out[k] = dec(a, k) * (1 - f) + dec(b, k) * f;
    return out;
  }
  // material index of a hit face
  matAtHit(prim, face) {
    const P = this.prims, zi = P.zone[prim];
    if (zi < 0) return P.sid[prim];
    const rz = this.list[zi]; if (!rz) return P.sid[prim];
    if (P.type[prim] === 1) return P.sid[prim];
    const m = face >= 0 ? rz.bz.faceMatIdx[P.local[prim] * 6 + face] : -1;
    return m >= 0 ? m : P.sid[prim];
  }
}
