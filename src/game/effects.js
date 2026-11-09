// Pooled effects: sparks (1 draw), smoke/dust (1 draw), bullet holes (1 instanced draw),
// spent cases (1 instanced draw). Nothing is created or destroyed during play.
import * as THREE from 'three';
import { makeSmokeMaterial, makeSparkMaterial, makeHoleMaterial, makeDynamicMaterial } from '../render/shaders.js';
import { cellUV } from '../config/decals.js';
import { buildCasing } from './viewmodels.js';
import { F_COLLIDE, F_SHOOT } from '../world/grid.js';

export class Effects {
  constructor(scene, profile, arrays, atlas, zm, audio) {
    this.zm = zm; this.audio = audio;
    // sparks: line segments (head/tail)
    const NS = profile.sparks;
    this.sp = { n: NS, pos: new Float32Array(NS * 3), vel: new Float32Array(NS * 3), life: new Float32Array(NS), i: 0 };
    const sg = new THREE.BufferGeometry();
    this.spPos = new THREE.BufferAttribute(new Float32Array(NS * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.spHeat = new THREE.BufferAttribute(new Float32Array(NS * 2), 1).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.spPos); sg.setAttribute('aHeat', this.spHeat);
    this.sparks = new THREE.LineSegments(sg, makeSparkMaterial()); this.sparks.frustumCulled = false; this.sparks.renderOrder = 4;
    scene.add(this.sparks);
    // smoke / dust points
    const NM = 96 + profile.dust;
    this.sm = { n: NM, vel: new Float32Array(NM * 3), life: new Float32Array(NM), max: new Float32Array(NM), grow: new Float32Array(NM), a0: new Float32Array(NM), i: 0, dust0: 96 };
    const mg = new THREE.BufferGeometry();
    this.smPos = new THREE.BufferAttribute(new Float32Array(NM * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.smSize = new THREE.BufferAttribute(new Float32Array(NM), 1).setUsage(THREE.DynamicDrawUsage);
    this.smAlpha = new THREE.BufferAttribute(new Float32Array(NM), 1).setUsage(THREE.DynamicDrawUsage);
    this.smLit = new THREE.BufferAttribute(new Float32Array(NM).fill(1), 1);
    mg.setAttribute('position', this.smPos); mg.setAttribute('aSize', this.smSize); mg.setAttribute('aAlpha', this.smAlpha); mg.setAttribute('aLit', this.smLit);
    this.smoke = new THREE.Points(mg, makeSmokeMaterial()); this.smoke.frustumCulled = false; this.smoke.renderOrder = 2;
    scene.add(this.smoke);
    // ambient dust motes drifting around the player (visible in the flashlight beam)
    this.dustN = profile.dust;
    for (let i = 0; i < this.dustN; i++) { const k = this.sm.dust0 + i; this.smSize.array[k] = 0.006 + Math.random() * 0.008; this.smLit.array[k] = 0.35; this.sm.vel[k * 3] = (Math.random() - 0.5) * 0.04; this.sm.vel[k * 3 + 1] = (Math.random() - 0.5) * 0.02; this.sm.vel[k * 3 + 2] = (Math.random() - 0.5) * 0.04; }
    this.dustInit = false;
    // bullet holes: instanced quads lit by the baked light sampled at the hit point
    const NH = profile.holes;
    const hq = new THREE.PlaneGeometry(1, 1);
    hq.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(4 * 4).fill(1), 4));
    hq.setAttribute('aWet', new THREE.BufferAttribute(new Float32Array(4), 1));
    this.holes = new THREE.InstancedMesh(hq, makeHoleMaterial(atlas), NH);
    this.hLight = new THREE.InstancedBufferAttribute(new Float32Array(NH * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.hCell = new THREE.InstancedBufferAttribute(new Float32Array(NH * 4), 4).setUsage(THREE.DynamicDrawUsage);
    hq.setAttribute('aLight', this.hLight); hq.setAttribute('aCell', this.hCell);
    this.holes.count = 0; this.holes.frustumCulled = false; this.holes.renderOrder = 1; this.hi = 0; this.nh = NH;
    scene.add(this.holes);
    // spent cases
    const NC = 24;
    this.cases = new THREE.InstancedMesh(buildCasing(), makeDynamicMaterial(arrays), NC);
    this.cases.count = NC; this.cases.frustumCulled = false;
    this.cs = Array.from({ length: NC }, () => ({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 0, bounces: 0 }));
    this.ci = 0;
    scene.add(this.cases);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1); this._l = [0, 0, 0];
    this.cellC = cellUV('hole_concrete'); this.cellM = cellUV('hole_metal');
    this._syncCases(true);
  }
  spark(p, n, count, speed = 6) {
    const S = this.sp;
    for (let j = 0; j < count; j++) {
      const i = S.i++ % S.n, k = i * 3;
      S.pos[k] = p[0]; S.pos[k + 1] = p[1]; S.pos[k + 2] = p[2];
      const s = speed * (0.3 + Math.random());
      S.vel[k] = (n[0] + (Math.random() - 0.5) * 1.6) * s; S.vel[k + 1] = (n[1] + (Math.random() - 0.2) * 1.6) * s; S.vel[k + 2] = (n[2] + (Math.random() - 0.5) * 1.6) * s;
      S.life[i] = 0.15 + Math.random() * 0.35;
    }
  }
  puff(p, v, count, size, alpha, life, spread = 0.3) {
    const M = this.sm;
    for (let j = 0; j < count; j++) {
      const i = M.i++ % M.dust0, k = i * 3;
      this.smPos.array[k] = p[0] + (Math.random() - 0.5) * 0.04; this.smPos.array[k + 1] = p[1] + (Math.random() - 0.5) * 0.04; this.smPos.array[k + 2] = p[2] + (Math.random() - 0.5) * 0.04;
      M.vel[k] = v[0] + (Math.random() - 0.5) * spread; M.vel[k + 1] = v[1] + (Math.random() - 0.3) * spread; M.vel[k + 2] = v[2] + (Math.random() - 0.5) * spread;
      M.life[i] = M.max[i] = life * (0.7 + Math.random() * 0.6); M.grow[i] = size * (0.6 + Math.random() * 0.8); M.a0[i] = alpha;
      this.smSize.array[i] = size * 0.3;
    }
  }
  hole(p, n, metal, prim, face) {
    const i = this.hi++ % this.nh;
    const N = new THREE.Vector3(...n);
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), N);
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    const s = metal ? 0.05 : 0.07 + Math.random() * 0.03;
    this._s.set(s, s, s);
    this._m.compose(new THREE.Vector3(p[0] + n[0] * 0.002, p[1] + n[1] * 0.002, p[2] + n[2] * 0.002), this._q, this._s);
    this.holes.setMatrixAt(i, this._m);
    this.zm.lightAtHit(prim, face, p, this._l);
    this.hLight.setXYZ(i, this._l[0], this._l[1], this._l[2]);
    const c = metal ? this.cellM : this.cellC;
    this.hCell.setXYZW(i, c[0], c[3], c[2], c[1]);
    this.holes.count = Math.min(this.nh, Math.max(this.holes.count, i + 1));
    this.holes.instanceMatrix.needsUpdate = true; this.hLight.needsUpdate = true; this.hCell.needsUpdate = true;
  }
  clearHoles() { this.holes.count = 0; this.hi = 0; }
  eject(p, v, pistol) {
    const c = this.cs[this.ci++ % this.cs.length];
    c.p.set(...p); c.v.set(...v); c.life = 6; c.bounces = 0; c.pistol = pistol;
    c.q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.PI / 2));
    c.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
  }
  _syncCases(force) {
    for (let i = 0; i < this.cs.length; i++) { const c = this.cs[i]; this._s.set(1, 1, 1); this._m.compose(c.p, c.q, this._s); this.cases.setMatrixAt(i, this._m); }
    this.cases.instanceMatrix.needsUpdate = true;
  }
  update(dt, cam) {
    // sparks
    const S = this.sp, pa = this.spPos.array, ha = this.spHeat.array;
    for (let i = 0; i < S.n; i++) {
      const k = i * 3;
      if (S.life[i] <= 0) { ha[i * 2] = ha[i * 2 + 1] = 0; pa[i * 6] = pa[i * 6 + 3] = 0; pa[i * 6 + 1] = pa[i * 6 + 4] = -50; continue; }
      S.life[i] -= dt;
      S.vel[k + 1] -= 9.81 * dt;
      S.pos[k] += S.vel[k] * dt; S.pos[k + 1] += S.vel[k + 1] * dt; S.pos[k + 2] += S.vel[k + 2] * dt;
      const tl = 0.012;
      pa[i * 6] = S.pos[k]; pa[i * 6 + 1] = S.pos[k + 1]; pa[i * 6 + 2] = S.pos[k + 2];
      pa[i * 6 + 3] = S.pos[k] - S.vel[k] * tl; pa[i * 6 + 4] = S.pos[k + 1] - S.vel[k + 1] * tl; pa[i * 6 + 5] = S.pos[k + 2] - S.vel[k + 2] * tl;
      const h = Math.max(0, S.life[i] * 3); ha[i * 2] = h; ha[i * 2 + 1] = h * 0.3;
    }
    this.spPos.needsUpdate = true; this.spHeat.needsUpdate = true;
    // smoke
    const M = this.sm, mp = this.smPos.array;
    for (let i = 0; i < M.dust0; i++) {
      if (M.life[i] <= 0) { this.smAlpha.array[i] = 0; continue; }
      M.life[i] -= dt;
      const t = 1 - M.life[i] / M.max[i], k = i * 3;
      const drag = Math.exp(-dt * 3);
      M.vel[k] *= drag; M.vel[k + 1] = M.vel[k + 1] * drag + 0.08 * dt; M.vel[k + 2] *= drag;
      mp[k] += M.vel[k] * dt; mp[k + 1] += M.vel[k + 1] * dt; mp[k + 2] += M.vel[k + 2] * dt;
      this.smSize.array[i] = M.grow[i] * (0.3 + t * 0.9);
      this.smAlpha.array[i] = M.a0[i] * Math.min(1, t * 8) * (1 - t);
    }
    // dust motes wrap around the camera
    if (this.dustN) {
      const R = 3;
      for (let j = 0; j < this.dustN; j++) {
        const i = M.dust0 + j, k = i * 3;
        if (!this.dustInit || Math.abs(mp[k] - cam.x) > R || Math.abs(mp[k + 1] - cam.y) > 1.6 || Math.abs(mp[k + 2] - cam.z) > R) {
          mp[k] = cam.x + (Math.random() * 2 - 1) * R; mp[k + 1] = cam.y + (Math.random() * 2 - 1) * 1.5; mp[k + 2] = cam.z + (Math.random() * 2 - 1) * R;
        }
        mp[k] += M.vel[k] * dt; mp[k + 1] += M.vel[k + 1] * dt; mp[k + 2] += M.vel[k + 2] * dt;
        this.smAlpha.array[i] = 0.5;
      }
      this.dustInit = true;
    }
    this.smPos.needsUpdate = true; this.smSize.needsUpdate = true; this.smAlpha.needsUpdate = true;
    // spent cases: simple ballistic + bounce against the world
    const g = this.zm.grid;
    let any = false;
    for (const c of this.cs) {
      if (c.life <= 0) continue;
      any = true; c.life -= dt;
      if (c.bounces > 3 && c.v.lengthSq() < 0.01) continue;
      c.v.y -= 9.81 * dt;
      const sp = c.v.length(), step = sp * dt;
      if (step > 0 && g) {
        const t = g.ray(c.p.x, c.p.y, c.p.z, c.v.x / sp, c.v.y / sp, c.v.z / sp, step + 0.006, F_COLLIDE | F_SHOOT, false);
        if (t >= 0 && g.hit.face >= 0) {
          const n = new THREE.Vector3(g.hit.nx, g.hit.ny, g.hit.nz);
          c.p.addScaledVector(c.v, Math.max(0, t - 0.006) / sp);
          c.v.reflect(n).multiplyScalar(0.32); c.v.addScaledVector(n, 0.05);
          c.w.multiplyScalar(0.5);
          if (c.bounces++ === 0) this.audio.play3D(c.pistol ? 'casing_p' : 'casing_r', [c.p.x, c.p.y, c.p.z], { gain: 0.55, maxDist: 15, pri: 0 }); // recording holds the whole bounce
          if (n.y > 0.7 && c.v.length() < 0.25) { c.v.set(0, 0, 0); c.w.set(0, 0, 0); c.bounces = 9; c.q.setFromEuler(new THREE.Euler(0, Math.random() * 6, Math.PI / 2)); }
        } else c.p.addScaledVector(c.v, dt);
      }
      this._q.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt)); c.q.multiply(this._q);
    }
    if (any) this._syncCases();
  }
}
