// Interactive props: the motorised sliding door and the swinging steel targets.
import * as THREE from 'three';
import { makeDynamicMaterial } from '../render/shaders.js';

function tagBox(w, h, d, x, y, z, layer, tint, emit = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z);
  const n = g.attributes.position.count;
  g.setAttribute('aLayer', new THREE.BufferAttribute(new Uint8Array(n).fill(layer), 1));
  const t = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { t[i * 3] = tint[0] * 127.5; t[i * 3 + 1] = tint[1] * 127.5; t[i * 3 + 2] = tint[2] * 127.5; }
  g.setAttribute('aTint', new THREE.BufferAttribute(t, 3, true));
  g.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n).fill(emit), 1));
  // world-ish UVs so textures keep their scale
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d), uv.getY(i) * h);
  return g;
}
function mergeGeo(list) {
  const out = new THREE.BufferGeometry();
  for (const nm of ['position', 'normal', 'uv', 'aLayer', 'aTint', 'aEmit']) {
    const a0 = list[0].attributes[nm], tot = list.reduce((s, g) => s + g.attributes[nm].array.length, 0), arr = new a0.array.constructor(tot);
    let o = 0; for (const g of list) { arr.set(g.attributes[nm].array, o); o += g.attributes[nm].array.length; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  out.computeBoundingSphere();
  return out;
}

export class SlidingDoor {
  constructor(def, scene, arrays, zm, audio) {
    this.def = def; this.zm = zm; this.audio = audio;
    this.open = 0; this.target = 0; this.vel = 0; this.moving = false; this.loop = null;
    const [x0, y0, z0] = def.min, [x1, y1, z1] = def.max, w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const OLIVE = [0.34, 0.38, 0.29], DARK = [0.2, 0.21, 0.22];
    // built thin along x, long along z; a door that spans x is the same slab turned a quarter (leading edge toward +x)
    const alongX = w > d, T = alongX ? d : w, Lg = alongX ? w : d;
    const parts = [tagBox(T, h, Lg, 0, 0, 0, 3, OLIVE)];
    for (const y of [-0.7, 0, 0.7]) parts.push(tagBox(T + 0.03, 0.08, Lg - 0.1, 0, y, 0, 3, OLIVE));
    parts.push(tagBox(T + 0.01, h, 0.12, 0, 0, Lg / 2 - 0.06, 5, [1, 1, 1]));            // hazard leading edge
    parts.push(tagBox(T + 0.04, 0.3, 0.035, 0, -0.1, Lg / 2 - 0.25, 3, DARK));            // pull handle bar
    parts.push(tagBox(T + 0.005, 0.3, 0.42, 0, 0.55, 0.05, 6, [1, 1, 1]));               // vision panel (dark wired glass)
    this.mesh = new THREE.Mesh(mergeGeo(parts), makeDynamicMaterial(arrays));
    if (alongX) this.mesh.rotation.y = Math.PI / 2;
    this.alongX = alongX;
    this.base = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.mesh.position.copy(this.base);
    scene.add(this.mesh);
    // status LEDs on both panels (two tiny unlit quads, one draw each)
    this.leds = def.panels.map(p => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff2010 }));
      m.position.set(p.pos[0] + p.n[0] * 0.011, p.pos[1] + 0.1, p.pos[2] + p.n[2] * 0.011); m.lookAt(m.position.x + p.n[0], m.position.y, m.position.z + p.n[2]);
      scene.add(m); return m;
    });
    this.center = [this.base.x, 1.2, this.base.z];
  }
  toggle() {
    this.target = this.target > 0.5 ? 0 : 1;
    this.audio.play3D('beep', this.def.panels[0].pos, { gain: 0.6, maxDist: 12 });
    this.audio.play3D('doorStart', this.center, { gain: 1, maxDist: 30 });
    this.moving = true;
  }
  blockedBy(p) { // safety sensor: never close on the player
    const d = this.def;
    const ax = this.alongX ? 0.1 : 0.45, az = this.alongX ? 0.45 : 0.1;
    return p.x > d.min[0] - ax && p.x < d.max[0] + ax && p.z > d.min[2] - az && p.z < d.max[2] + az;
  }
  update(dt, playerPos) {
    if (this.target === 0 && this.open > 0 && this.blockedBy(playerPos)) { this.target = 1; this.audio.play3D('deny', this.def.panels[0].pos, { gain: 0.6, maxDist: 12 }); }
    const prev = this.open;
    const dir = Math.sign(this.target - this.open);
    if (dir) {
      // heavy door: accelerate, cruise, decelerate
      const remain = Math.abs(this.target - this.open);
      const vmax = 1 / this.def.time * 1.35;
      this.vel = Math.min(vmax, this.vel + dt * 1.6, Math.sqrt(2 * 1.6 * remain) + 0.02);
      this.open += dir * Math.min(remain, this.vel * dt);
      if (Math.abs(this.target - this.open) < 1e-4) {
        this.open = this.target; this.vel = 0; this.moving = false;
        this.audio.play3D('doorStop', this.center, { gain: 1, maxDist: 30 });
      }
    }
    if (this.open !== prev) {
      const s = this.def.slide, o = this.open;
      this.mesh.position.set(this.base.x + s[0] * o, this.base.y + s[1] * o, this.base.z + s[2] * o);
      const pi = this.zm.doorPrims[this.def.id];
      if (pi !== undefined) this.zm.prims.setBox(pi, [this.def.min[0] + s[0] * o, this.def.min[1], this.def.min[2] + s[2] * o], [this.def.max[0] + s[0] * o, this.def.max[1], this.def.max[2] + s[2] * o]);
      // light through the opening grows with the visible gap
      this.zm.setDoor(this.def.id, Math.min(1, o / 0.94));
    }
    const col = this.moving ? 0xffa000 : this.open > 0.5 ? 0x20ff40 : 0xff2010;
    for (const l of this.leds) l.material.color.setHex(col);
    // motor loop while moving
    if (this.moving && !this.loop && this.audio.ready) this.loop = this.audio._loop('doorLoop', this.audio.sfx, 0.5, this.center);
    if (!this.moving && this.loop) { try { this.loop.src.stop(); } catch (e) { /* stopped */ } this.loop.g.disconnect(); this.loop = null; }
  }
  // re-apply the door's collider after the zone grid was rebuilt
  sync() {
    const s = this.def.slide, v = this.open, pi = this.zm.doorPrims[this.def.id];
    if (pi !== undefined) this.zm.prims.setBox(pi, [this.def.min[0] + s[0] * v, this.def.min[1], this.def.min[2] + s[2] * v], [this.def.max[0] + s[0] * v, this.def.max[1], this.def.max[2] + s[2] * v]);
    this.zm.setDoor(this.def.id, Math.min(1, v / 0.94));
  }
}

export class Targets {
  constructor(scene, arrays, audio, effects) {
    this.audio = audio; this.effects = effects; this.list = []; this.scene = scene;
    const plate = tagBox(0.012, 0.45, 0.3, 0, -0.225 - 0.02, 0, 3, [0.86, 0.86, 0.82]);
    this.mesh = new THREE.InstancedMesh(mergeGeo([plate, tagBox(0.02, 0.04, 0.26, 0, -0.01, 0, 4, [1, 1, 1])]), makeDynamicMaterial(arrays), 8);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._inv = new THREE.Matrix4(); this._o = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  setZone(zoneId, defs) { // targets stream with their zone
    this.list = this.list.filter(t => t.zone !== zoneId);
    for (const d of defs) this.list.push({ zone: zoneId, pivot: new THREE.Vector3(...d.pivot), w: d.w, h: d.h, a: 0, v: 0, hits: 0 });
    this._sync();
  }
  removeZone(zoneId) { this.list = this.list.filter(t => t.zone !== zoneId); this._sync(); }
  _sync() {
    this.mesh.count = this.list.length;
    this.list.forEach((t, i) => { this._m.makeRotationZ(t.a).setPosition(t.pivot); this.mesh.setMatrixAt(i, this._m); });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  // ray vs swinging plates (oriented boxes), returns { t, target, point, normal } or null
  raycast(o, d, tmax) {
    let best = null;
    for (const t of this.list) {
      this._m.makeRotationZ(t.a).setPosition(t.pivot); this._inv.copy(this._m).invert();
      this._o.copy(o).applyMatrix4(this._inv); this._d.copy(d).transformDirection(this._inv);
      const mn = [-0.006, -0.47, -t.w / 2], mx = [0.006, -0.02, t.w / 2];
      let t0 = 0, t1 = tmax, nAx = 0;
      for (let a = 0; a < 3; a++) {
        const oa = this._o.getComponent(a), da = this._d.getComponent(a);
        if (Math.abs(da) < 1e-9) { if (oa < mn[a] || oa > mx[a]) { t0 = 1; t1 = 0; break; } continue; }
        let ta = (mn[a] - oa) / da, tb = (mx[a] - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) { t0 = ta; nAx = a; } t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && t0 > 0 && (!best || t0 < best.t)) {
        const n = new THREE.Vector3(); n.setComponent(nAx, -Math.sign(this._d.getComponent(nAx))); n.transformDirection(this._m);
        best = { t: t0, target: t, point: o.clone().addScaledVector(d, t0), normal: n };
      }
    }
    return best;
  }
  hit(h, dir) {
    const t = h.target;
    t.v += dir.x * 2.6 * (0.8 + Math.random() * 0.4); t.hits++;
    this.audio.play3D('ring', [h.point.x, h.point.y, h.point.z], { gain: 0.9, maxDist: 45, send: 0.5, pri: 2, rate: 0.97 + Math.random() * 0.06 });
    this.effects.spark([h.point.x, h.point.y, h.point.z], [h.normal.x, h.normal.y, h.normal.z], 8, 4);
    this.effects.puff([h.point.x, h.point.y, h.point.z], [h.normal.x * 0.4, 0.1, h.normal.z * 0.4], 2, 0.14, 0.18, 1.0);
  }
  update(dt) {
    if (!this.list.length) return;
    let moving = false;
    for (const t of this.list) {
      if (Math.abs(t.a) < 1e-4 && Math.abs(t.v) < 1e-4) continue;
      const n = Math.ceil(dt / 0.004), h = dt / n;
      for (let i = 0; i < n; i++) { t.v += (-9.81 / 0.24 * Math.sin(t.a) - t.v * 0.9) * h; t.a += t.v * h; }
      moving = true;
    }
    if (moving) this._sync();
  }
}
