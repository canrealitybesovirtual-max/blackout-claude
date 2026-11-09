// First-person body: walk/sprint/crouch/jump, stamina, AABB collision with step-up,
// surface-aware footsteps, subtle head motion (desktop only), wake-up intro.
import * as THREE from 'three';
import { F_COLLIDE } from '../world/grid.js';
import { MATERIALS } from '../config/materials.js';
import { MAT_KEYS } from '../world/build.js';

const R = 0.28, H_STAND = 1.78, H_CROUCH = 1.15, EYE = 0.11; // eye below head top
const SPEED = { walk: 2.5, sprint: 5.3, crouch: 1.25 };

export class Player {
  constructor(zm, audio, profile, spawn) {
    this.zm = zm; this.audio = audio; this.profile = profile;
    this.pos = new THREE.Vector3(...spawn.pos); this.vel = new THREE.Vector3();
    this.yaw = spawn.yaw; this.pitch = 0; this.roll = 0;
    this.h = H_STAND; this.onGround = true; this.stamina = 100; this.staminaWait = 0; this.sprinting = false;
    this.stride = 0; this.bobPhase = 0; this.bob = new THREE.Vector3(); this.land = 0; this.landV = 0;
    this.intro = profile.bob ? 0 : 1; this.fatigue = 0; this.shake = 0;
    this.recoilPitch = 0; this.recoilYaw = 0; this.recoilVel = 0;
    this._hits = []; this.speed2d = 0; this.moving = false;
  }
  get crouching() { return this.h < H_STAND - 0.05; }
  get eyeHeight() { return this.h - EYE; }

  update(dt, input, aiming) {
    // wake-up: lying on the floor, sitting up, standing
    if (this.intro < 1) { this.intro = Math.min(1, this.intro + dt / 4.5); }
    const ctl = this.intro > 0.55;
    const look = input.consumeLook();
    const ads = aiming ? 0.62 : 1;
    if (ctl) { this.yaw += look.x * ads; this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * ads, -1.5, 1.5); }

    // crouch with head-room check
    const wantH = input.crouch ? H_CROUCH : H_STAND;
    if (wantH > this.h && this._blocked(this.pos.x, this.pos.y, this.pos.z, wantH)) { /* stay low */ }
    else this.h += (wantH - this.h) * Math.min(1, dt * 10);

    // movement intent
    let mx = ctl ? input.move.x : 0, my = ctl ? input.move.y : 0;
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    const wantSprint = input.held.sprint && my > 0.5 && !this.crouching && !aiming && this.stamina > 4;
    this.sprinting = wantSprint && (this.sprinting || this.stamina > 15);
    let sp = this.crouching ? SPEED.crouch : this.sprinting ? SPEED.sprint : SPEED.walk;
    if (aiming) sp *= 0.6;
    if (this.fatigue > 0.6) sp *= 0.92;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const tx = (mx * c - my * s) * sp, tz = (-mx * s - my * c) * sp;
    const acc = this.onGround ? (ml > 0.01 ? 11 : 14) : 1.8;
    this.vel.x += (tx - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (tz - this.vel.z) * Math.min(1, acc * dt);
    if (input.has('jump') && this.onGround && ctl && !this.crouching && this.stamina > 8) { this.vel.y = 3.5; this.onGround = false; this.stamina -= 8; }
    this.vel.y -= 9.81 * dt;

    // stamina
    if (this.sprinting && ml > 0.1) { this.stamina = Math.max(0, this.stamina - 11 * dt); this.staminaWait = 1.1; }
    else if ((this.staminaWait -= dt) <= 0) this.stamina = Math.min(100, this.stamina + 16 * dt);
    this.fatigue += ((1 - this.stamina / 100) ** 1.5 - this.fatigue) * Math.min(1, dt * 1.5);

    // integrate with collision (sub-stepped)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const wasGround = this.onGround, vyBefore = this.vel.y;
    for (let i = 0; i < steps; i++) this._move(dt / steps);
    if (this.onGround && !wasGround) {
      const impact = Math.min(1, -vyBefore / 6);
      this.landV -= impact * 1.6;
      if (impact > 0.15) this.audio.play2D('land', { gain: 0.3 + impact * 0.5, send: 0.2 });
    }

    // footsteps from distance travelled
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed2d = hs; this.moving = hs > 0.4;
    if (this.onGround && hs > 0.3) {
      const strideLen = this.sprinting ? 1.25 : this.crouching ? 0.55 : 0.78;
      this.stride += hs * dt;
      this.bobPhase += hs * dt / strideLen * Math.PI;
      if (this.stride > strideLen) {
        this.stride = 0;
        const surf = this._surface();
        const g = this.crouching ? 0.18 : this.sprinting ? 0.75 : 0.42;
        this.audio.play2D('step_' + surf, { gain: g, lp: this.crouching ? 2500 : 16000, send: 0.12 });
        this.audio.stepSurface = surf;
      }
    } else this.stride *= 0.9;

    // head motion (none in VR)
    const k = this.profile.bob;
    const amp = (this.sprinting ? 0.034 : this.crouching ? 0.01 : 0.018) * Math.min(1, hs / 2) * k;
    this.bob.set(Math.cos(this.bobPhase) * amp * 0.5, -Math.abs(Math.sin(this.bobPhase)) * amp, 0);
    this.landV += (-this.land * 160 - this.landV * 18) * dt; this.land += this.landV * dt;
    this.roll += ((-mx * 0.006 + Math.cos(this.bobPhase) * amp * 0.3) * k - this.roll) * Math.min(1, dt * 6);

    // recoil recovery (spring back toward the aim point)
    this.recoilVel += (-this.recoilPitch * 90 - this.recoilVel * 16) * dt;
    this.recoilPitch += this.recoilVel * dt;
    this.recoilYaw *= Math.exp(-dt * 10);
    this.shake *= Math.exp(-dt * 3);
  }
  kick(pitch, yaw) {
    this.pitch = Math.min(1.5, this.pitch + pitch * 0.35); // part of the climb stays
    this.recoilVel += pitch * 0.65 * 38;
    this.recoilYaw += yaw;
  }
  applyCamera(cam) {
    const t = this.intro;
    let eye = this.eyeHeight + this.bob.y + this.land * 0.05;
    let pitch = this.pitch + this.recoilPitch, roll = this.roll;
    if (t < 1) { // lying on the back -> sitting -> standing
      const sit = THREE.MathUtils.smoothstep(t, 0.0, 0.45), stand = THREE.MathUtils.smoothstep(t, 0.5, 0.95);
      eye = THREE.MathUtils.lerp(0.25, THREE.MathUtils.lerp(0.95, eye, stand), sit);
      pitch = THREE.MathUtils.lerp(1.2, THREE.MathUtils.lerp(-0.25, pitch, stand), sit);
      roll += (1 - sit) * 0.25 + Math.sin(t * 9) * 0.01 * (1 - stand);
    }
    const sh = this.shake;
    cam.position.set(this.pos.x + this.bob.x * Math.cos(this.yaw), this.pos.y + eye, this.pos.z - this.bob.x * Math.sin(this.yaw));
    cam.rotation.set(pitch + (Math.random() - 0.5) * sh * 0.01, this.yaw + this.recoilYaw + (Math.random() - 0.5) * sh * 0.01, roll, 'YXZ');
  }
  _blocked(x, y, z, h) {
    const n = this.zm.grid.query(x - R, y + 0.05, z - R, x + R, y + h, z + R, F_COLLIDE, this._hits);
    return n > 0;
  }
  _move(dt) {
    const g = this.zm.grid, P = this.zm.prims, p = this.pos;
    // horizontal axes with step-up
    for (const ax of ['x', 'z']) {
      const d = this.vel[ax] * dt; if (!d) continue;
      p[ax] += d;
      const n = g.query(p.x - R, p.y + 0.01, p.z - R, p.x + R, p.y + this.h, p.z + R, F_COLLIDE, this._hits);
      for (let i = 0; i < n; i++) {
        const k = this._hits[i] * 3, top = P.mx[k + 1];
        // low obstacle: climb it if there is head-room
        if (this.onGround && top - p.y < 0.36 && !this._blocked(p.x, top, p.z, this.h)) { p.y = top; continue; }
        const a = ax === 'x' ? 0 : 2;
        if (d > 0) p[ax] = Math.min(p[ax], P.mn[k + a] - R - 1e-4); else p[ax] = Math.max(p[ax], P.mx[k + a] + R + 1e-4);
        this.vel[ax] = 0;
      }
    }
    // vertical
    p.y += this.vel.y * dt;
    this.onGround = false;
    const n = g.query(p.x - R + 0.02, p.y - 0.001, p.z - R + 0.02, p.x + R - 0.02, p.y + this.h, p.z + R - 0.02, F_COLLIDE, this._hits);
    for (let i = 0; i < n; i++) {
      const k = this._hits[i] * 3;
      if (this.vel.y <= 0 && P.mx[k + 1] - p.y < 0.4) { p.y = P.mx[k + 1]; this.vel.y = 0; this.onGround = true; }
      else if (this.vel.y > 0 && P.mn[k + 1] > p.y + 0.3) { p.y = P.mn[k + 1] - this.h - 1e-4; this.vel.y = 0; } // only things overhead stop a rise
    }
    if (p.y < -5) { p.y = 0.5; this.vel.set(0, 0, 0); } // safety net
  }
  _surface() {
    const g = this.zm.grid, p = this.pos;
    const t = g.ray(p.x, p.y + 0.2, p.z, 0, -1, 0, 0.6, F_COLLIDE, false);
    if (t < 0) return 'concrete';
    const m = this.zm.matAtHit(g.hit.prim, g.hit.face);
    return (MATERIALS[MAT_KEYS[m]] || MATERIALS.floor).step;
  }
}
