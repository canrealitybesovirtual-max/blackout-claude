// CQC's VR hands and body in Blackout (stage 1 of the CQC port). src/cqc/port.js is CQC's own code, copied verbatim by
// tools/port_cqc.py; this file gives it what it reads from the CQC game (camera, rig, floor, controllers) and drives it
// each frame in CQC's order: body (hips, legs, feet) -> hands (pose from the controllers) -> arms (reach the hands).
// The guns are still Blackout's (stage 2 brings CQC's grips): the right hand closes round the grip of the gun you hold,
// the left on the handguard when you support it, round the flashlight while you carry it.
import * as THREE from 'three';
import * as C from '../cqc/port.js';
import { U } from '../render/shaders.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
export class CqcBody {
  constructor(xr) {
    this.xr = xr; this.ready = false;
    this.level = { floor: 0 };
    this.vrHands = [];
    C.cqcSet({
      camera: xr.camera, renderer: xr.renderer, scene: xr.scene, rig: xr.rig, level: this.level,
      comfort: { bodyFwd: 8, bodyUp: 0, bodyShow: true, stance: 'standing' },
      vrHands: this.vrHands, deskHand: {}, stream: { current: null },
      inv: { smg: [], rifle: [], akm: [], pistol: [], ppk: [], fn509: [], shells: 0, med: 0 },
      JUMP: { air: false, vy: 0, landAt: 0 }, KICK: { on: false }, CONTACT: { frame: 0 },
      headWorld: o => o.setFromMatrixPosition(xr.camera.matrixWorld),
      xrHeadOk: () => true,
      handPose: (vh, P, Q) => { vh.grip.updateWorldMatrix(true, false); vh.grip.matrixWorld.decompose(P, Q, _s); },
      roomContaining: () => null, roomFloorAt: () => 0, stairFloor: () => 0, rLX: (r, x) => x, rLZ: (r, z) => z, rWX: (r, x) => x,
      gunOf: vh => (vh && vh.gun) || null, lhBusy: () => false, gunBodyBoxes: () => null,
      vmLoad: () => Promise.reject(new Error('no viewmodel pack')), vmPackWrist: () => null, wearApply: () => {}, glove104Start: () => {},
      handsGloveShader: m => m, ownStep: () => {}, underfoot: () => {}, goreStep: () => {}, splashStep: () => {}, bodyKickJump: () => {},
      maxAniso: 4, audio: { ctx: null }, soundAt: () => {}, nBurst: () => {}, pulseSoft: () => {}, mechPulse: () => {},
      vmhTake: () => false, vmhFrameStart: () => {}, vmGun: () => null,
    });
  }
  build() {
    if (this.ready) return;
    try {
      C.handsBuild(); C.bodyBuild(); this.ready = !!(C.HANDS.ready && C.BODY.ready);
      // CQC's materials are three.js standard ones: light them from Blackout's baked-light probe (sky / ground ambient,
      // the two fixtures it picks) and the flashlight; the world's own shaders ignore these lights
      const sc = this.xr.scene;
      this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); sc.add(this.hemi);
      this.pts = [0, 1].map(() => { const l = new THREE.PointLight(0xffffff, 0, 12, 2); sc.add(l); return l; });
      this.spot = new THREE.SpotLight(0xffffff, 0, 28, 0.42, 0.5, 2); sc.add(this.spot, this.spot.target);
    }
    catch (e) { console.error('cqc body', e); this.failed = true; }
  }
  // hands: { left, right } XR hand records; state: what each hand holds
  update(dt, st) {
    if (!this.ready) { if (!this.failed) this.build(); if (!this.ready) return false; }
    const xr = this.xr, H = C.HANDS.list;
    this.level.floor = xr.rig.position.y;
    // the controllers as CQC's vrHands (bodyHandsFacing reads them)
    this.vrHands.length = 0;
    for (const side of ['right', 'left']) {
      const X = xr.hands[side]; if (!X) continue;
      X.ray.userData.handedness = side; X.ray.userData.gamepad = X.src.gamepad;
      this.vrHands.push({ ctrl: X.ray, grip: X.grip, source: X.grip, gun: side === 'right' && st.gun ? st.gun : null });
    }
    // lights for the standard materials, from the probe (uAmb: +x -x +y -y +z -z) and the dynamic flashlight
    if (this.hemi) {
      const A = U.uAmb.value, k = Math.PI;
      this.hemi.color.setRGB(A[2].x * k, A[2].y * k, A[2].z * k); this.hemi.groundColor.setRGB(A[3].x * k, A[3].y * k, A[3].z * k);
      for (let i = 0; i < 2; i++) { const P = U.uPrbPos.value[i], c = U.uPrbCol.value[i], L = this.pts[i]; L.position.set(P.x, P.y, P.z); L.color.setRGB(c.x, c.y, c.z).multiplyScalar(0.05); L.intensity = c.x + c.y + c.z > 0 ? 6 : 0; }
      const n = U.uDynCount.value; let on = false;
      for (let i = 0; i < n; i++) if (U.uDynCol.value[i].w > 0.5) { const P = U.uDynPos.value[i], D = U.uDynDir.value[i]; this.spot.position.set(P.x, P.y, P.z); this.spot.target.position.set(P.x + D.x, P.y + D.y, P.z + D.z); this.spot.intensity = 18; on = true; break; }
      if (!on) this.spot.intensity = 0;
    }
    C.bodyPre(dt);
    for (const vh of this.vrHands) {
      const side = vh.ctrl.userData.handedness, h = H[side === 'left' ? 1 : 0], gp = vh.ctrl.userData.gamepad;
      const s = gp ? C.padState(gp) : null;
      if (side === 'right' && st.gun) {                                   // round the grip, index on / pulling the trigger
        const G = h.grips[st.long ? 'smg' : 'pistol'];
        C.poseFromGrip(h, G);
        if (G.on && G.pull && s) C.setFinger(h, 1, s.trigT > 0.05 ? G.pull : G.on);
      } else if (side === 'left' && st.support) C.poseCurl(h, 0.62, C.HPOSE.thumbRest);
      else if (side === 'left' && st.torch) { C.poseFromGrip(h, h.grips.pistol); C.setFinger(h, 1, h.grips.pistol.p.middle); }   // wrapped round it
      else if (s) C.poseFromPad(h, s, performance.now() / 1000);
      // where: as if round a pistol grip at the controller (CQC's free hand); the support hand on the handguard
      if (side === 'left' && st.support && st.supportAt) { C.freeFrame(vh, h, _p, _q); _p.copy(st.supportAt); }
      else C.freeFrame(vh, h, _p, _q);
      C.placeHand(h, 'free', _p, _q, dt);
      C.applyFingers(h, dt);
    }
    for (let i = 0; i < 2; i++) if (!this.vrHands.some(v => (v.ctrl.userData.handedness === 'left' ? 1 : 0) === i)) H[i].root.visible = false;
    C.bodyArms(dt);
    return true;
  }
  // the CQC right hand's wrist (world): the gun is shifted so its own hand bone sits there
  rightWrist(out) { const h = C.HANDS.list && C.HANDS.list[0]; if (!h || !h.root.visible) return null; return out.setFromMatrixPosition(h.root.matrix); }
  hide() { if (!this.ready) return; for (const h of C.HANDS.list) h.root.visible = false; if (C.BODY.root) C.BODY.root.visible = false; C.BODY.init = false; }
}
