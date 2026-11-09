// Guns from the user's animated FPS rigs (arms + gun + clips: idle, walk, fire, reloads).
// One rig instance per gun for the screen (view-model camera at the rig's Head_Cam bone) and,
// in VR, a second instance on the right controller. Slot 3 = the flashlight hands.
import * as THREE from 'three';
import { loadGLB, convert, findBone } from '../render/models.js';
import { makeFlashMaterial, U } from '../render/shaders.js';
import { Hands } from './hands.js';

export const GUNS = {
  saiga: {
    url: 'models/fps_saiga.glb', name: 'SAIGA 7.62', sound: 'rifle', sfx: '_r', modes: ['semi', 'auto'], rpm: 600, cap: 30, reserve: 120,
    spreadHip: 0.022, spreadAds: 0.0015, recoil: { pitch: 0.024, yaw: 0.008, kick: 0.03, rise: 0.04 }, adsFov: 0.75, len: 1.0, eyeH: 0.004, eyeZ: 0.22,
    clips: { idle: /Idle/, walk: /Walk/, fire: /Fire/, tac: /Reload_Fast/, empty: /Reload_Full/ },
    events: { tac: { out: 0.22, in: 0.62 }, empty: { out: 0.18, in: 0.55, bolt: 0.84 } }, flash: 0.15,
  },
  pistol: {
    url: 'models/fps_pistol.glb', name: 'PISTOL 9MM', sound: 'pistol', sfx: '_p', modes: ['semi'], rpm: 420, cap: 15, reserve: 60,
    spreadHip: 0.03, spreadAds: 0.003, recoil: { pitch: 0.03, yaw: 0.01, kick: 0.022, rise: 0.09 }, adsFov: 0.88, len: 0.2, eyeH: 0.002, eyeZ: 0.24,
    clips: { idle: /Idle/, walk: /Walk/, fire: /Fire/, tac: /Reload_easy/, empty: /Reload_full/ },
    events: { tac: { out: 0.2, in: 0.62 }, empty: { out: 0.16, in: 0.55, bolt: 0.85 } }, flash: 0.1,
  },
};
const ORDER = ['saiga', 'pistol', 'torch'];

// mark arm vertices: +10 = left arm, +2 = shoulder / upper arm (VR shows forearms only)
function tagArms(mesh) {
  const bones = mesh.skeleton.bones, g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const code = bones.map(b => {
    const n = b.name; let c = 0;
    if (/_L(\d|_|$)|\dL(_|$)|\.L/.test(n)) c += 10;            // Hand_L, Bone_L004, BoneTwist_03L
    if (/^(Arm|UpArm|Root)/.test(n) || /BoneTwist_0[3]/.test(n)) c += 2;
    return c;
  });
  const a = new Float32Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let j = 0, w = -1;
    for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; j = si.getComponent(i, k); } }
    a[i] = code[j];
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(a, 1));
}

async function loadRig(def, fresh) {
  const g = await loadGLB(def.url, fresh);
  const root = g.scene;
  const meshes = []; root.traverse(m => { if (m.isMesh) meshes.push(m); });
  const isArm = m => /arm/i.test(m.name) || /arm/i.test((m.material && m.material.name) || '');
  for (const m of meshes) { m.userData.arm = isArm(m); if (m.isSkinnedMesh && m.userData.arm) tagArms(m); }
  const mats = convert(root, {});
  const mixer = new THREE.AnimationMixer(root), A = {};
  for (const k in def.clips) {
    const c = g.animations.find(a => def.clips[k].test(a.name));
    if (!c) continue;
    const act = mixer.clipAction(c);
    if (k === 'idle' || k === 'walk') { act.play(); act.setEffectiveWeight(k === 'idle' ? 1 : 0); }
    else { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
    A[k] = act;
  }
  mixer.update(0); root.updateMatrixWorld(true);
  // measure in the idle pose: eye (Head_Cam), bore axis and muzzle from the gun's posed vertices
  const cam = findBone(root, /^Head_Cam(?!.*end)/);
  const eye = new THREE.Vector3(); if (cam) eye.setFromMatrixPosition(cam.matrixWorld);
  const gun = meshes.filter(m => !m.userData.arm), P = [], v = new THREE.Vector3();
  for (const m of gun) for (let i = 0; i < m.geometry.attributes.position.count; i += 2) { m.getVertexPosition(i, v); P.push(v.clone().applyMatrix4(m.matrixWorld)); }
  const mean = P.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length);
  let d = new THREE.Vector3(0, 0, 1);
  for (let it = 0; it < 24; it++) { // principal axis (power iteration)
    const n = new THREE.Vector3();
    for (const p of P) { const q = p.clone().sub(mean); n.addScaledVector(q, q.dot(d)); }
    d = n.normalize();
  }
  if (d.dot(mean.clone().sub(eye)) < 0) d.negate();
  // sight line: upper hull of the gun's top profile (front sight post -> rear sight / slide top),
  // the hull edge over 45 % of the length from the muzzle. PCA alone tilts a pistol by its grip.
  const up0 = new THREE.Vector3(0, 1, 0), u0 = up0.clone().addScaledVector(d, -up0.dot(d)).normalize();
  let tMin = Infinity, tMax = -Infinity; for (const p of P) { const t = p.dot(d); tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
  const L = tMax - tMin, NS = 48, top = new Array(NS).fill(null);
  for (const p of P) { const t = p.dot(d), h = p.dot(u0), k = Math.min(NS - 1, ((t - tMin) / L * NS) | 0); if (!top[k] || h > top[k].h) top[k] = { t, h, p }; }
  const pts = top.filter(Boolean), hull = [];
  for (const q of pts) { // upper hull, increasing t
    while (hull.length >= 2) { const A = hull[hull.length - 2], B = hull[hull.length - 1]; if ((B.t - A.t) * (q.h - A.h) - (B.h - A.h) * (q.t - A.t) >= 0) hull.pop(); else break; }
    hull.push(q);
  }
  const tc = tMax - 0.45 * L; let rear = hull[0], front = hull[hull.length - 1];
  for (let i = 0; i + 1 < hull.length; i++) if (hull[i].t <= tc && hull[i + 1].t >= tc) { rear = hull[i]; front = hull[i + 1]; break; }
  const s = front.p.clone().sub(rear.p); s.addScaledVector(new THREE.Vector3().crossVectors(d, u0), -s.dot(new THREE.Vector3().crossVectors(d, u0))).normalize();
  let mx = -Infinity; for (const p of P) mx = Math.max(mx, p.dot(s));
  const tip = new THREE.Vector3(); let nt = 0;
  for (const p of P) if (p.dot(s) > mx - 0.012 * L) { tip.add(p); nt++; }
  tip.multiplyScalar(1 / nt);
  d = s;
  // the muzzle rides the bone the gun hangs on (the gun moves in reloads)
  let host = root;
  const sk = gun.find(m => m.isSkinnedMesh);
  if (sk) {
    let bi = 0, best = -1, near = 1e9;
    for (let i = 0; i < sk.geometry.attributes.position.count; i += 3) { sk.getVertexPosition(i, v); v.applyMatrix4(sk.matrixWorld); const dd = v.distanceTo(tip); if (dd < near) { near = dd; best = i; } }
    const si = sk.geometry.attributes.skinIndex, sw = sk.geometry.attributes.skinWeight; let w = -1;
    for (let k = 0; k < 4; k++) { const wk = sw.getComponent(best, k); if (wk > w) { w = wk; bi = si.getComponent(best, k); } }
    host = sk.skeleton.bones[bi];
  } else if (gun[0]) host = gun[0];
  const muzzle = new THREE.Object3D(); host.add(muzzle); host.updateWorldMatrix(true, false);
  muzzle.position.copy(host.worldToLocal(tip.clone()));
  const handR = findBone(root, /^Hand_R(?!.*end)/), handL = findBone(root, /^Hand_L(?!.*end)/);
  // the gun's own up: from the bore at the muzzle to the front sight post (the pack holds its guns canted a little;
  // shown upright, as a shooter holds one)
  const up = front.p.clone().sub(tip); up.addScaledVector(d, -up.dot(d));
  if (up.length() < 0.01 * L || up.dot(u0) < 0.3 * up.length()) up.copy(u0); else up.normalize();
  const r = new THREE.Vector3().crossVectors(d, up).normalize(), u = new THREE.Vector3().crossVectors(r, d);
  const basis = new THREE.Matrix4().makeBasis(r, u, d.clone().negate()); // camera axes in the file
  const toCam = new THREE.Quaternion().setFromRotationMatrix(basis).invert();
  // the pack's own camera: Head_Cam's local axis nearest the bore is its view, nearest file-up its up
  let hipQ = toCam.clone();
  if (cam) {
    const cq = cam.getWorldQuaternion(new THREE.Quaternion()), ax = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(a => new THREE.Vector3(...a).applyQuaternion(cq));
    const best = (dir, skip) => ax.reduce((b, a, i) => (skip && Math.abs(a.dot(skip)) > 0.5) || a.dot(dir) <= (b < 0 ? -2 : ax[b].dot(dir)) ? b : i, -1);
    const fi = best(d), F = ax[fi], ui = best(new THREE.Vector3(0, 1, 0), F), Uv = ax[ui];
    const Rv = new THREE.Vector3().crossVectors(F, Uv);
    hipQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Rv, Uv, F.clone().negate())).invert();
  }
  const scale = def.len / L;                 // the packs are not at real size (the Saiga is ~2x)
  return { root, mixer, A, eye, bore: d, muzzle, handR, handL, toCam, hipQ, mats, meshes, scale, rearSight: rear.p.clone() };
}

export class GunSystem {
  constructor(arrays, ctx) {
    this.ctx = ctx;
    this.hands = new Hands(ctx.audio);                       // flashlight hands + the view-model scene/camera
    this.scene = this.hands.scene; this.cam = this.hands.cam;
    this.state = {}; for (const id in GUNS) this.state[id] = { mag: GUNS[id].cap, chamber: true, reserve: GUNS[id].reserve, mode: 0 };
    this.rigs = {}; this.vr = {}; this.cur = 'saiga'; this.ready = false;
    this.ads = 0; this.sprint = 0; this.cool = 0; this.semiLock = false; this.action = null; this.raise = 0.4;
    this.flashMat = makeFlashMaterial();
    this.kick = 0; this.kickV = 0; this.rise = 0; this.riseV = 0; this.sway = new THREE.Vector2(); this.swayV = new THREE.Vector2();
    this.lastYaw = null; this.lastPitch = 0; this.t = 0; this.overlay = 0; this.walkW = 0;
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._e = new THREE.Euler();
    Promise.all(Object.keys(GUNS).map(async id => { this.rigs[id] = this._mount(await loadRig(GUNS[id], false), id); }))
      .then(() => { this.ready = true; this._show(); }).catch(e => console.error('guns', e));
  }
  _mount(rig, id) {
    const holder = new THREE.Group(), inner = new THREE.Group();
    holder.add(inner); inner.add(rig.root);
    inner.quaternion.copy(rig.toCam); inner.scale.setScalar(rig.scale);
    inner.position.copy(rig.eye).multiplyScalar(rig.scale).applyQuaternion(rig.toCam).negate();     // Head_Cam at the camera
    holder.visible = false; this.cam.add(holder);
    // aimed pose: rear sight onto the eye line (the sight line already runs along -z)
    const R = rig.rearSight.clone().multiplyScalar(rig.scale).applyQuaternion(rig.toCam).add(inner.position);
    rig.adsOff = new THREE.Vector3(-R.x, -R.y - GUNS[id].eyeH, Math.min(0, -GUNS[id].eyeZ - R.z));
    rig.hipRot = new THREE.Quaternion();   // hip: bore straight ahead, gun upright (the pack's own framing was canted)
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat); f.visible = false; f.frustumCulled = false; f.renderOrder = 5;
    rig.muzzle.add(f); rig.flash = f; rig.holder = holder; rig.id = id;
    // where the muzzle sits in camera space (for the aimed pose)
    rig.root.updateMatrixWorld(true); holder.updateMatrixWorld(true);
    return rig;
  }
  get def() { return GUNS[this.cur] || { adsFov: 1, cap: 1 }; }
  get st() { return this.state[this.cur]; }
  get aiming() { return this.ads > 0.5; }
  get flashOn() { return this.hands.flashOn; }
  set flashOn(v) { this.hands.flashOn = v; }
  ammoText() { if (this.cur === 'torch') return null; const s = this.st, d = GUNS[this.cur]; return { inMag: s.mag + (s.chamber ? 1 : 0), reserve: s.reserve, mode: d.modes[s.mode].toUpperCase(), name: d.name }; }
  _show() {
    for (const id in this.rigs) this.rigs[id].holder.visible = id === this.cur;
    this.hands.root.visible = this.cur === 'torch';
    for (const id in this.vr) this.vr[id].holder.visible = id === this.cur;
  }
  // play a one-shot clip on the screen rig and its VR twin
  _play(k, speed = 1) {
    for (const r of [this.rigs[this.cur], this.vr[this.cur]]) {
      if (!r || !r.A[k]) continue;
      for (const o of ['fire', 'tac', 'empty']) if (o !== k && r.A[o]) r.A[o].stop();
      const a = r.A[k]; a.reset(); a.timeScale = speed; a.setEffectiveWeight(1); a.play();
    }
    const r = this.rigs[this.cur];
    return r && r.A[k] ? r.A[k].getClip().duration / speed : 0.3;
  }
  _start(type, dur, extra = {}) { this.action = { type, t: 0, dur, ...extra }; }

  update(dt, input, cam, player) {
    this.t += dt;
    const P = this.ctx.player || player;
    // the hands handle the flashlight toggle and their own pose (slot 3)
    this.hands.update(dt, input, cam, player);
    if (!this.ready) return cam;
    const st = this.st, w = GUNS[this.cur], busy = !!this.action;
    // ---- input ----
    let want = null;
    if (input.has('slot1')) want = 'saiga'; if (input.has('slot2')) want = 'pistol'; if (input.has('slot3')) want = 'torch';
    if (input.has('swap') || input.has('next')) want = ORDER[(ORDER.indexOf(this.cur) + 1) % ORDER.length];
    if (input.has('prev')) want = ORDER[(ORDER.indexOf(this.cur) + ORDER.length - 1) % ORDER.length];
    if (want) this.want = want;
    if (this.want && !busy) { want = this.want; this.want = null; } else want = null;
    if (want && want !== this.cur) { this._start('switch', 0.5, { to: want, swapped: false }); this.ctx.audio.play2D('cloth', { gain: 0.6 }); }
    if (w && input.has('reload') && !busy && st.reserve > 0 && st.mag < w.cap) {
      const empty = !st.chamber, dur = this._play(empty ? 'empty' : 'tac');
      this._start('reload', dur, { empty, ev: new Set() });
    }
    if (w && input.has('mode') && w.modes.length > 1 && !busy) { st.mode = (st.mode + 1) % w.modes.length; this.ctx.audio.play2D('dry', { gain: 0.6, rate: 1.3 }); }

    // ---- poses ----
    const sprinting = P.sprinting && P.moving;
    this.sprint += ((sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    const canAim = w && !sprinting && !busy;
    this.ads += ((input.held.aim && canAim ? 1 : 0) - this.ads) * Math.min(1, dt * 9);

    // ---- firing ----
    this.cool -= dt;
    if (!input.held.fire) this.semiLock = false;
    if (w && (input.held.fire || input.has('fireTap')) && !busy && this.sprint < 0.3 && this.raise >= 1 && P.intro >= 1 && this.cool <= 0
      && !(w.modes[st.mode] === 'semi' && this.semiLock) && !(this.ctx.blockFire && this.ctx.blockFire())) {
      if (st.chamber) this._fire(cam, P);
      else if (!this.semiLock) { this.ctx.audio.play2D('dry', { gain: 0.7 }); this.cool = 0.25; }
      this.semiLock = true;
    }

    // ---- actions ----
    let lower = 0;
    if (this.action) {
      const a = this.action; a.t += dt;
      if (a.type === 'reload') {
        const E = w.events[a.empty ? 'empty' : 'tac'], f = a.t / a.dur, ev = (k, fn) => { if (E[k] !== undefined && f >= E[k] && !a.ev.has(k)) { a.ev.add(k); fn(); } };
        ev('out', () => this.ctx.audio.play2D('magout' + w.sfx, { gain: 0.8 }));
        ev('in', () => { this.ctx.audio.play2D('magin' + w.sfx, { gain: 0.85 }); const take = Math.min(w.cap - st.mag, st.reserve); st.mag += take; st.reserve -= take; });
        if (a.empty) ev('bolt', () => { this.ctx.audio.play2D('bolt' + w.sfx, { gain: 0.9 }); if (st.mag > 0) { st.mag--; st.chamber = true; } });
        if (a.t >= a.dur) this.action = null;
      } else if (a.type === 'switch') {
        if (!a.swapped && a.t >= 0.22) { this.cur = a.to; a.swapped = true; this._show(); this.raise = 0; }
        lower = a.swapped ? 0 : a.t / 0.22;
        if (a.t >= a.dur) this.action = null;
      }
    }
    this.raise = Math.min(1, this.raise + dt * 2.2);

    // ---- clip weights: idle <-> walk by speed, one-shots on top ----
    const rig = this.rigs[this.cur];
    if (rig) {
      const mv = Math.min(1, P.speed2d / 2.4) * (P.onGround ? 1 : 0.3);
      this.walkW += (mv - this.walkW) * Math.min(1, dt * 6);
      const oneShot = ['fire', 'tac', 'empty'].some(k => rig.A[k] && rig.A[k].isRunning());
      this.overlay += ((oneShot ? 1 : 0) - this.overlay) * Math.min(1, dt * (oneShot ? 30 : 10));
      for (const r of [rig, this.vr[this.cur]]) {
        if (!r) continue;
        r.A.idle && r.A.idle.setEffectiveWeight((1 - this.overlay) * (1 - this.walkW));
        r.A.walk && r.A.walk.setEffectiveWeight((1 - this.overlay) * this.walkW);
        r.A.walk && (r.A.walk.timeScale = 0.7 + P.speed2d / 4);
        r.mixer.update(dt);
      }
      // procedural layer: look lag, recoil kick, sprint lower, aim (bore onto the eye line), switching
      if (this.lastYaw === null) { this.lastYaw = P.yaw; this.lastPitch = P.pitch; }
      const dyaw = P.yaw - this.lastYaw, dp = P.pitch - this.lastPitch; this.lastYaw = P.yaw; this.lastPitch = P.pitch;
      const adsK = 1 - this.ads * 0.85;
      const tx = THREE.MathUtils.clamp(-dyaw * 1.4, -0.07, 0.07) * adsK, ty = THREE.MathUtils.clamp(dp * 1.1, -0.05, 0.05) * adsK;
      this.swayV.x += ((tx - this.sway.x) * 140 - this.swayV.x * 16) * dt; this.swayV.y += ((ty - this.sway.y) * 140 - this.swayV.y * 16) * dt;
      this.sway.addScaledVector(this.swayV, dt);
      const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
      for (let i = 0; i < n; i++) { this.kickV += (-this.kick * 300 - this.kickV * 24) * h; this.kick += this.kickV * h; this.riseV += (-this.rise * 240 - this.riseV * 20) * h; this.rise += this.riseV * h; }
      // aimed: the rest-pose offset that puts the rear sight under the eye (clips still move the gun)
      const O = rig.adsOff, ads = this.ads * this.ads * (3 - 2 * this.ads), s = this.sprint;
      rig.holder.position.set(O.x * ads + this.sway.x * 0.25 - s * 0.03, O.y * ads + this.sway.y * 0.2 - s * 0.06 - P.land * 0.03 - (1 - this.raise) * 0.25 - lower * 0.25, O.z * ads + this.kick);
      this._e.set(this.sway.y + this.rise - s * 0.35 - (1 - this.raise) * 0.6 - lower * 0.6, this.sway.x - s * 0.5 * (1 - ads), this.sway.x * 1.4 + s * 0.2 + P.roll * 2 * (1 - ads), 'YXZ');
      rig.holder.quaternion.slerpQuaternions(rig.hipRot, this._q.identity(), ads).multiply(this._q2.setFromEuler(this._e));
    }
    // flash
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) for (const r of [this.rigs[this.cur], this.vr[this.cur]]) if (r) r.flash.visible = false; }
    this.cam.updateMatrixWorld(true);
    return cam;
  }

  _fire(cam, P) {
    const w = GUNS[this.cur], st = this.st;
    this.cool = 60 / w.rpm;
    if (st.mag > 0) { st.mag--; st.chamber = true; } else st.chamber = false;
    this._play('fire');
    // the shot: VR from the gun in the hand, screen from the camera centre
    const vr = this.vrOn && this.vr[this.cur];
    const spread = (w.spreadHip * (1 - this.ads) + w.spreadAds * this.ads) * (1 + Math.min(1, P.speed2d / 3) * 1.6 + (P.onGround ? 0 : 2));
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    if (vr) { vr.muzzle.getWorldPosition(o); d.copy(vr.boreWorld()); } else { o.copy(cam.position); cam.getWorldDirection(d); }
    const rr = Math.sqrt(Math.random()) * spread, a = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    d.addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr).normalize();
    this.ctx.onShot(o, d, w);
    if (!vr) {
      const rc = w.recoil, k = 1 - this.ads * 0.35;
      P.kick(rc.pitch * (0.85 + Math.random() * 0.3) * k, (Math.random() - 0.5) * 2 * rc.yaw * k);
      this.kickV += rc.kick * 16; this.riseV += rc.rise * 14 * (1 - this.ads * 0.5);
    }
    // muzzle flash: sprite on the rig, point light in the world
    const rig = vr || this.rigs[this.cur];
    rig.flash.visible = true; this.flashT = 0.045;
    const sc = w.flash * (0.8 + Math.random() * 0.4); rig.flash.scale.set(sc, sc, sc); rig.flash.rotation.z = Math.random() * 3;
    rig.flash.lookAt(cam.getWorldPosition(this._v));
    this.flashMat.uniforms.uSeed.value = Math.random(); this.flashMat.uniforms.uI.value = 1;
    const mw = rig.muzzle.getWorldPosition(new THREE.Vector3());
    this.ctx.flashLight(mw);
    const ej = new THREE.Vector3(0.16, -0.06, -0.42).applyMatrix4(this.cam.matrixWorld);
    const ev = new THREE.Vector3(1.6 + Math.random() * 0.8, 1.2 + Math.random() * 0.8, 0.3 + Math.random() * 0.4).applyQuaternion(cam.quaternion);
    this.ctx.effects.eject([ej.x, ej.y, ej.z], [ev.x + P.vel.x, ev.y, ev.z + P.vel.z], this.cur === 'pistol');
    this.ctx.audio.play2D(w.sound, { gain: 1, send: 0.45, pri: 3, rate: 0.96 + Math.random() * 0.08 });
    this.ctx.effects.puff([mw.x, mw.y, mw.z], [d.x * 0.6, d.y * 0.6 + 0.1, d.z * 0.6], 2, 0.12, 0.12, 1.2, 0.15);
  }

  // weapon light: from under the muzzle along the bore; the torch slot uses the hand torch
  lightPose(outPos, outDir, cam) {
    const rig = this.rigs[this.cur];
    if (this.cur === 'torch' || !rig) return this.hands.lightPose(outPos, outDir, cam);
    rig.muzzle.getWorldPosition(outPos);
    cam.getWorldDirection(outDir);
    outPos.addScaledVector(outDir, -0.18);
  }

  // VR: second rigs on the right controller, gun along the controller, its right hand on the grip.
  // Upper arms are not drawn; the left arm shows only while the real left hand grips the handguard.
  vrGun() { return this.cur !== 'torch' && this.vr[this.cur] || null; }
  setSupport(on) { const r = this.vrGun(); for (const id in this.vr) for (const m of this.vr[id].mats) m.uniforms.uHideLeft.value = on && this.vr[id] === r ? 0 : 1; }
  async makeVR() {
    const group = new THREE.Group();
    for (const id in GUNS) {
      const rig = await loadRig(GUNS[id], true);
      for (const m of rig.mats) { m.uniforms.uCutUpper.value = 1; m.uniforms.uHideLeft.value = 1; }
      const holder = new THREE.Group(), inner = new THREE.Group();
      holder.add(inner); inner.add(rig.root);
      inner.quaternion.copy(rig.toCam); inner.scale.setScalar(rig.scale);
      const hand = new THREE.Vector3(); if (rig.handR) hand.setFromMatrixPosition(rig.handR.matrixWorld); else hand.copy(rig.eye);
      inner.position.copy(hand).multiplyScalar(rig.scale).applyQuaternion(rig.toCam).negate();
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat); f.visible = false; f.frustumCulled = false;
      rig.muzzle.add(f); rig.flash = f; rig.holder = holder;
      rig.boreWorld = () => this._d.set(0, 0, -1).transformDirection(holder.matrixWorld);
      holder.visible = id === this.cur; group.add(holder);
      // the animations' support hand on the handguard, in the gun's frame (rest pose): where the
      // real left hand grabs, and the line the two hands aim along
      holder.updateMatrixWorld(true);
      rig.supportRest = rig.handL ? new THREE.Vector3().setFromMatrixPosition(rig.handL.matrixWorld) : new THREE.Vector3(0, 0, -0.3);
      this.vr[id] = rig;
    }
    return group;
  }
}
