// Data-driven weapons + the first-person weapon controller: fire modes, chamber logic,
// reloads (tactical / empty), ADS, recoil, sway, inertia, sprint pose, wall push-back,
// inspection, switching, hitscan with spread, muzzle flash + light, ejected cases.
import * as THREE from 'three';
import { buildRifle, buildPistol } from './viewmodels.js';
import { makeDynamicMaterial, makeFlashMaterial, makeReticleMaterial, U } from '../render/shaders.js';
import { F_SHOOT } from '../world/grid.js';
import { MATERIALS } from '../config/materials.js';
import { MAT_KEYS } from '../world/build.js';

export const WEAPONS = {
  rifle: {
    name: 'CARBINE 5.56', build: buildRifle, sound: 'rifle', modes: ['auto', 'semi'], rpm: 800, cap: 30, reserve: 150,
    damage: 34, spreadHip: 0.026, spreadAds: 0.0012, recoil: { pitch: 0.021, yaw: 0.007, kick: 0.028, rise: 0.05 },
    reload: { tac: 2.15, empty: 2.65 }, hip: [0.125, -0.15, -0.33], adsZ: -0.2, adsFov: 0.78, adsTime: 0.22, mass: 1.0,
  },
  pistol: {
    name: 'PISTOL 9MM', build: buildPistol, sound: 'pistol', modes: ['semi'], rpm: 450, cap: 17, reserve: 68,
    damage: 25, spreadHip: 0.03, spreadAds: 0.003, recoil: { pitch: 0.03, yaw: 0.01, kick: 0.022, rise: 0.11 },
    reload: { tac: 1.55, empty: 1.9 }, hip: [0.11, -0.13, -0.4], adsZ: -0.36, adsFov: 0.9, adsTime: 0.16, mass: 0.6,
  },
};

const ease = t => t * t * (3 - 2 * t);
// keyframe track: [[t, value], ...] -> eased value
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, a] = keys[i - 1], [t1, b] = keys[i]; const u = ease((t - t0) / (t1 - t0)); return Array.isArray(a) ? a.map((v, j) => v + (b[j] - v) * u) : a + (b - a) * u; }
  return keys[keys.length - 1][1];
}

class Spring { constructor(k, d) { this.k = k; this.d = d; this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); this.t = new THREE.Vector3(); }
  step(dt) { const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; for (let i = 0; i < n; i++) { this.v.x += ((this.t.x - this.x.x) * this.k - this.v.x * this.d) * h; this.v.y += ((this.t.y - this.x.y) * this.k - this.v.y * this.d) * h; this.v.z += ((this.t.z - this.x.z) * this.k - this.v.z * this.d) * h; this.x.addScaledVector(this.v, h); } } }

export class WeaponSystem {
  constructor(arrays, ctx) {
    this.ctx = ctx; // { zm, player, effects, audio, targets, camera, hud }
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.root = new THREE.Group(); this.cam.add(this.root); this.scene.add(this.cam);
    this.mat = makeDynamicMaterial(arrays);
    this.flashMat = makeFlashMaterial();
    this.models = {};
    for (const id in WEAPONS) this.models[id] = this._model(id);
    this.state = {}; for (const id in WEAPONS) { const w = WEAPONS[id]; this.state[id] = { mag: w.cap, chamber: true, reserve: w.reserve, mode: 0 }; }
    this.cur = 'rifle'; this.models.rifle.group.visible = true;
    this.ads = 0; this.sprint = 0; this.cool = 0; this.semiLock = false; this.burst = 0;
    this.action = null; // { type, t, dur, ... }
    this.sway = new Spring(120, 14); this.kick = new Spring(260, 22); this.kickR = new Spring(220, 18);
    this.lastYaw = 0; this.lastPitch = 0; this.push = 0; this.pushT = 0;
    this.flashT = 0; this.flashOn = false; this.flashIntensity = 0;
    this.muzzleW = new THREE.Vector3(); this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.shots = 0; this.raise = 0.5; this.time = 0;
  }
  _model(id) {
    const m = WEAPONS[id].build();
    const group = new THREE.Group(); group.visible = false;
    const mk = (g) => { const x = new THREE.Mesh(g, this.mat); x.frustumCulled = false; group.add(x); return x; };
    const body = mk(m.body), mag = mk(m.mag), bolt = mk(m.bolt), left = mk(m.left);
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat);
    flash.position.set(m.muzzle[0], m.muzzle[1], m.muzzle[2] - 0.05); flash.visible = false; flash.frustumCulled = false; flash.renderOrder = 5;
    const flashSide = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat);
    flashSide.rotation.y = Math.PI / 2; flash.add(flashSide);
    group.add(flash);
    let reticle = null;
    if (id === 'rifle') {
      reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.036), makeReticleMaterial());
      reticle.position.set(m.sight[0], m.sight[1], m.sight[2] - 0.01); reticle.renderOrder = 6; reticle.frustumCulled = false;
      group.add(reticle);
    }
    this.root.add(group);
    return { ...m, group, bodyMesh: body, magMesh: mag, boltMesh: bolt, leftMesh: left, flash, reticle };
  }
  get def() { return WEAPONS[this.cur]; }
  get st() { return this.state[this.cur]; }
  get aiming() { return this.ads > 0.5; }
  ammoText() { const s = this.st; return { inMag: s.mag + (s.chamber ? 1 : 0), reserve: s.reserve, mode: this.def.modes[s.mode].toUpperCase(), name: this.def.name }; }

  _start(type, dur, extra = {}) { this.action = { type, t: 0, dur, ...extra }; }

  update(dt, input, mainCam) {
    this.time += dt;
    const P = this.ctx.player, w = this.def, st = this.st, m = this.models[this.cur];
    const busy = !!this.action;
    // ---- input ----
    if (input.has('reload') && !busy && st.reserve > 0 && st.mag < w.cap) {
      const empty = !st.chamber;
      this._start('reload', empty ? w.reload.empty : w.reload.tac, { empty, done: false, ev: new Set() });
    }
    let want = null;
    if (input.has('slot1')) want = 'rifle'; if (input.has('slot2')) want = 'pistol';
    if (input.has('swap') || input.has('next') || input.has('prev')) want = this.cur === 'rifle' ? 'pistol' : 'rifle';
    if (want && want !== this.cur && (!busy || this.action.type === 'inspect')) { this._start('switch', 0.62, { to: want, swapped: false }); this.ctx.audio.play2D('cloth', { gain: 0.5 }); }
    if (input.has('mode') && w.modes.length > 1 && !busy) { st.mode = (st.mode + 1) % w.modes.length; this.ctx.audio.play2D('dry', { gain: 0.6, rate: 1.3 }); }
    if (input.has('inspect') && !busy) this._start('inspect', 2.6);
    if (input.has('light')) { this.flashOn = !this.flashOn; this.ctx.audio.play2D('dry', { gain: 0.5, rate: 1.6 }); }

    // ---- poses ----
    const sprinting = P.sprinting && P.moving;
    this.sprint += ((sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    const canAim = !sprinting && (!busy || this.action.type === 'switch' && this.action.swapped && this.action.t > 0.5);
    this.ads += ((input.held.aim && canAim ? 1 : 0) - this.ads) * Math.min(1, dt / w.adsTime * 2.2);

    // wall push-back: pull the weapon in when something is right in front of the muzzle
    this.pushT -= dt;
    if (this.pushT <= 0 && this.ctx.zm.grid) {
      this.pushT = 0.06;
      mainCam.getWorldDirection(this._d);
      const t = this.ctx.zm.grid.ray(mainCam.position.x, mainCam.position.y, mainCam.position.z, this._d.x, this._d.y, this._d.z, 0.85, F_SHOOT, false);
      this.pushTarget = t >= 0 ? Math.min(1, (0.85 - t) / 0.5) : 0;
    }
    this.push += ((this.pushTarget || 0) - this.push) * Math.min(1, dt * 10);

    // ---- firing ----
    this.cool -= dt;
    const mode = w.modes[st.mode];
    if (!input.held.fire) this.semiLock = false;
    const canFire = !busy && this.sprint < 0.25 && this.raise >= 1 && P.intro >= 1;
    if ((input.held.fire || input.has('fireTap')) && canFire && this.cool <= 0 && !(mode === 'semi' && this.semiLock)) {
      if (st.chamber) this._fire(mainCam);
      else if (!this.semiLock) { this.ctx.audio.play2D('dry', { gain: 0.7 }); this.cool = 0.25; }
      this.semiLock = true;
    }

    // ---- actions ----
    let rx = 0, ry = 0, rz = 0, px = 0, py = 0, pz = 0;
    const magOff = [0, 0, 0], leftOff = [0, 0, 0];
    let boltZ = 0;
    if (this.action) {
      const a = this.action; a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      if (a.type === 'reload') {
        const T = a.t, D = a.dur, R = this.cur === 'rifle';
        const ev = (t, fn) => { if (T >= t && !a.ev.has(t)) { a.ev.add(t); fn(); } };
        rz = track([[0, 0], [0.25, R ? 0.45 : 0.3], [D - 0.35, R ? 0.42 : 0.3], [D, 0]], T);
        rx = track([[0, 0], [0.25, 0.18], [D - 0.35, 0.16], [D, 0]], T);
        py = track([[0, 0], [0.25, -0.02], [D - 0.35, -0.02], [D, 0]], T);
        const inT = R ? 1.45 : 1.0;
        const mo = track([[0, [0, 0, 0]], [0.32, [0, 0, 0]], [0.55, [0, -0.2, 0.04]], [0.7, [0.05, -0.6, 0.1]], [inT - 0.35, [0, -0.35, 0.05]], [inT - 0.05, [0, -0.012, 0]], [inT, [0, 0, 0]]], T);
        magOff.splice(0, 3, ...mo);
        const lg = this.models[this.cur].leftGrip, mw = this.models[this.cur].magwell;
        const toWell = [mw[0] - lg[0] - 0.01, mw[1] - lg[1] - 0.04, mw[2] - lg[2] + 0.02];
        const keys = [[0, [0, 0, 0]], [0.28, toWell], [0.55, [toWell[0], toWell[1] - 0.2, toWell[2] + 0.04]], [0.75, [0.05, -0.55, 0.1]], [inT - 0.35, [toWell[0], toWell[1] - 0.35, toWell[2] + 0.05]], [inT, toWell], [inT + 0.18, toWell]];
        if (a.empty) keys.push([inT + 0.4, R ? [0.02, toWell[1] + 0.07, toWell[2] - 0.03] : [0, 0.09, 0.02]], [inT + 0.6, R ? [0.02, toWell[1] + 0.07, toWell[2] - 0.03] : [0, 0.09, 0.02]]);
        keys.push([D - 0.15, [0, 0, 0]]);
        leftOff.splice(0, 3, ...track(keys, T));
        ev(0.3, () => this.ctx.audio.play2D('magout', { gain: 0.8 }));
        ev(inT - 0.02, () => {
          this.ctx.audio.play2D('magin', { gain: 0.85 });
          const need = this.def.cap - st.mag; const take = Math.min(need, st.reserve);
          st.mag += take; st.reserve -= take;
        });
        if (a.empty) {
          ev(inT + 0.45, () => { this.ctx.audio.play2D('bolt', { gain: 0.9 }); if (st.mag > 0) { st.mag--; st.chamber = true; } });
          boltZ = T > inT + 0.45 ? 0 : (R ? 0 : 0.035);
          if (T > inT + 0.45 && T < inT + 0.6) { rx += 0.03; pz += 0.008; }
        }
        if (u >= 1) this.action = null;
      } else if (a.type === 'inspect') {
        const T = a.t;
        ry = track([[0, 0], [0.5, 0.75], [1.4, 0.65], [1.9, -0.25], [2.6, 0]], T);
        rz = track([[0, 0], [0.5, -0.35], [1.4, -0.42], [1.9, 0.5], [2.6, 0]], T);
        rx = track([[0, 0], [0.5, 0.12], [1.9, 0.08], [2.6, 0]], T);
        px = track([[0, 0], [0.5, -0.06], [1.9, -0.04], [2.6, 0]], T);
        pz = track([[0, 0], [0.5, 0.05], [1.9, 0.04], [2.6, 0]], T);
        if (T > 0.45 && !a.c1) { a.c1 = 1; this.ctx.audio.play2D('cloth', { gain: 0.4 }); }
        if (T > 1.9 && !a.c2) { a.c2 = 1; this.ctx.audio.play2D('cloth', { gain: 0.35 }); }
        if (u >= 1) this.action = null;
      } else if (a.type === 'switch') {
        if (!a.swapped && a.t >= 0.28) {
          this.models[this.cur].group.visible = false; this.cur = a.to; this.models[this.cur].group.visible = true; a.swapped = true;
          this.ctx.audio.play2D(this.cur === 'rifle' ? 'bolt' : 'magin', { gain: 0.4, rate: 1.2 });
        }
        const dn = a.swapped ? 1 - ease(Math.min(1, (a.t - 0.28) / 0.34)) : ease(a.t / 0.28);
        py = -0.22 * dn; rx = -0.6 * dn; rz = 0.3 * dn;
        if (u >= 1) this.action = null;
      }
    }
    if (this.raise < 1) { this.raise = Math.min(1, this.raise + dt * 1.2); }

    // ---- procedural motion ----
    const dyaw = P.yaw - this.lastYaw, dpitch = P.pitch - this.lastPitch;
    this.lastYaw = P.yaw; this.lastPitch = P.pitch;
    const heavy = w.mass, adsK = 1 - this.ads * 0.85;
    this.sway.t.set(THREE.MathUtils.clamp(-dyaw * 1.6 * heavy, -0.09, 0.09) * adsK, THREE.MathUtils.clamp(dpitch * 1.2 * heavy, -0.07, 0.07) * adsK, 0);
    this.sway.step(dt); this.kick.step(dt); this.kickR.step(dt);
    const ph = P.bobPhase, mv = Math.min(1, P.speed2d / 2.5) * (P.onGround ? 1 : 0.2);
    const breathe = Math.sin(this.time * (1.4 + P.fatigue * 1.6)) * (0.0012 + P.fatigue * 0.004);
    const bx = Math.cos(ph) * 0.006 * mv * adsK, by = -Math.abs(Math.sin(ph)) * 0.007 * mv * adsK + breathe * (1 - this.ads * 0.6);
    const def = this.def, s = this.sprint, ads = ease(this.ads), push = this.push;
    const hip = def.hip, sight = this.models[this.cur].sight;
    const base = [hip[0] * (1 - ads), hip[1] * (1 - ads) + (-sight[1]) * ads, hip[2] * (1 - ads) + def.adsZ * ads];
    this.root.position.set(
      base[0] + bx + this.sway.x.x * 0.25 + px + s * -0.03 - push * 0.02,
      base[1] + by + this.sway.x.y * 0.2 + py + s * -0.05 - P.land * 0.04 - push * 0.04 - (1 - this.raise) * 0.25,
      base[2] + this.kick.x.z + pz + s * 0.02 + push * 0.1);
    this.root.rotation.set(
      this.sway.x.y + this.kickR.x.x + rx + s * -0.42 + push * 0.35 - (1 - this.raise) * 0.8,
      this.sway.x.x + this.kickR.x.y + ry + s * 0.62 - push * 0.1,
      this.sway.x.x * 1.5 + rz + s * 0.28 + P.roll * 2 * (1 - ads), 'YXZ');
    m.magMesh.position.set(...magOff);
    m.leftMesh.position.set(...leftOff);
    m.boltMesh.position.z = Math.max(boltZ, this.boltZ || 0);
    this.boltZ = Math.max(0, (this.boltZ || 0) - dt * 0.9);
    if (this.cur === 'pistol' && !st.chamber && !this.action) m.boltMesh.position.z = 0.035; // slide locked back
    if (m.reticle) m.reticle.material.uniforms.uB.value = 0.4 + ads * 0.8;
    this.kick.t.set(0, 0, 0); this.kickR.t.set(0, 0, 0);

    // ---- muzzle flash decay + weapon light ----
    this.flashT -= dt;
    m.flash.visible = this.flashT > 0;
    U.uFlashOn.value = this.flashOn ? 1 : 0;
    // view model camera mirrors the main camera (lighting is computed in world space)
    this.cam.position.copy(mainCam.position); this.cam.quaternion.copy(mainCam.quaternion);
    this.cam.fov = 52 - ads * 8; this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);
    return mainCam;
  }

  _fire(mainCam) {
    const w = this.def, st = this.st, P = this.ctx.player, m = this.models[this.cur];
    this.cool = 60 / w.rpm;
    // chamber / magazine
    if (st.mag > 0) { st.mag--; st.chamber = true; } else st.chamber = false;
    this.shots++;
    // spread: hip vs ADS, movement and air make it worse
    const moveK = 1 + Math.min(1, P.speed2d / 3) * 1.6 + (P.onGround ? 0 : 2) + (P.crouching ? -0.25 : 0);
    const spread = (w.spreadHip * (1 - this.ads) + w.spreadAds * this.ads) * moveK;
    mainCam.getWorldDirection(this._d);
    const r = Math.sqrt(Math.random()) * spread, a = Math.random() * Math.PI * 2;
    const right = this._v.set(1, 0, 0).applyQuaternion(mainCam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mainCam.quaternion);
    this._d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    this.ctx.onShot(mainCam.position, this._d, w);
    // recoil
    const rc = w.recoil, adsR = 1 - this.ads * 0.35;
    P.kick(rc.pitch * (0.85 + Math.random() * 0.3) * adsR, (Math.random() - 0.5) * 2 * rc.yaw * adsR);
    this.kick.v.z += rc.kick * 40; this.kickR.v.x += rc.rise * 40 * (1 - this.ads * 0.5); this.kickR.v.y += (Math.random() - 0.5) * rc.rise * 12;
    this.boltZ = this.cur === 'pistol' ? 0.03 : 0.0;
    // flash: 1-2 frames, random rotation and size
    this.flashT = 0.045;
    m.flash.rotation.z = Math.random() * Math.PI;
    const sc = (this.cur === 'rifle' ? 0.16 : 0.1) * (0.8 + Math.random() * 0.4) * (1 - this.ads * 0.4);
    m.flash.scale.set(sc, sc, sc);
    this.flashMat.uniforms.uSeed.value = Math.random(); this.flashMat.uniforms.uI.value = 1;
    // world-space muzzle and ejection port (approximation of the view model offsets)
    this.root.updateMatrixWorld(true);
    this.muzzleW.set(...m.muzzle).applyMatrix4(this.root.matrixWorld);
    // the view model is drawn closer than real scale: start the case where it would appear in the world
    const ej = new THREE.Vector3(0.16, -0.06, -0.42).applyMatrix4(this.cam.matrixWorld);
    const ev = new THREE.Vector3(1.6 + Math.random() * 0.8, 1.2 + Math.random() * 0.8, 0.3 + Math.random() * 0.4).applyQuaternion(mainCam.quaternion);
    this.ctx.effects.eject([ej.x, ej.y, ej.z], [ev.x + P.vel.x, ev.y, ev.z + P.vel.z], this.cur === 'pistol');
    this.ctx.audio.play2D(w.sound, { gain: 1, send: 0.75, pri: 3, rate: 0.96 + Math.random() * 0.08 });
    this.ctx.flashLight(this.muzzleW);
    this.ctx.effects.puff([this.muzzleW.x, this.muzzleW.y, this.muzzleW.z], [this._d.x * 0.6, this._d.y * 0.6 + 0.1, this._d.z * 0.6], 2, 0.12, 0.12, 1.2, 0.15);
  }

  // world-space flashlight origin/direction (mounted on the rifle's rail, follows the sway)
  lightPose(outPos, outDir) {
    const m = this.models[this.cur];
    this.root.updateMatrixWorld(true);
    const lp = m.light || [0.03, 0.02, -0.2];
    outPos.set(...lp).applyMatrix4(this.root.matrixWorld);
    outDir.set(0, 0, -1).transformDirection(this.root.matrixWorld);
  }
}

export function impactClass(zm, prim, face) {
  const m = zm.matAtHit(prim, face);
  return (MATERIALS[MAT_KEYS[m]] || MATERIALS.floor).impact;
}
