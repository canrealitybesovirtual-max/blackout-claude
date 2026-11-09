// Empty hands (guns off until the user's own GLB weapons go in): a handheld flashlight that
// lags the view a little, like a hand following the head. Same interface main.js uses for weapons.
import * as THREE from 'three';
import { U } from '../render/shaders.js';

export class Hands {
  constructor(audio) {
    this.audio = audio;
    this.aiming = false; this.ads = 0; this.def = { adsFov: 1, cap: 1 };
    this.flashOn = false; this.scene = null; this.cam = { aspect: 1 };
    this.q = new THREE.Quaternion(); this.init = false;
    this._off = new THREE.Vector3(0.16, -0.14, -0.15);
  }
  ammoText() { return null; }
  update(dt, input, cam) {
    if (input.has && input.has('light')) { this.flashOn = !this.flashOn; this.audio.play2D('dry', { gain: 0.5, rate: 1.6 }); }
    // the beam trails the view (hand inertia), ~8 Hz
    if (!this.init) { this.q.copy(cam.quaternion); this.init = true; }
    this.q.slerp(cam.quaternion, Math.min(1, dt * 8));
    U.uFlashOn.value = this.flashOn ? 1 : 0;
    return cam;
  }
  lightPose(outPos, outDir, cam) {
    outPos.copy(this._off).applyQuaternion(this.q).add(cam.position);
    outDir.set(0, 0, -1).applyQuaternion(this.q);
  }
}
