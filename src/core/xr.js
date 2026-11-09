// WebXR (Quest browser / PC VR): rig that carries the headset, smooth locomotion and turning,
// real walking kept out of walls; gun rigs in the right hand, the torch in the left (both aim along the ray). Comfort: the head is never moved
// by the game except to stop it going through a wall; no bob, no forced rotation.
import * as THREE from 'three';

const TURN = 1.92;      // rad/s at full stick (smooth turning)
const DEAD = 0.15;

export class XR {
  constructor(renderer, scene, camera, player, input) {
    Object.assign(this, { renderer, scene, camera, player, input });
    this.supported = false; this.on = false; this.session = null;
    this.rig = new THREE.Group(); this.rig.name = 'xr-rig'; scene.add(this.rig);
    this.hands = { left: null, right: null }; this.prev = { left: [], right: [] };
    this.view = new THREE.PerspectiveCamera();   // world-space stand-in for the head (zones, audio, probes)
    this._h = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    renderer.xr.enabled = true;
    // hand models arrive later (setModels): left = arm holding the torch, right = the gun rigs
    this.models = { left: null, right: null }; this.torch = null; this.torchLen = 0.3;
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i), ray = renderer.xr.getController(i);
      this.rig.add(grip); this.rig.add(ray);
      ray.addEventListener('connected', e => { const h = e.data.handedness; if (h !== 'left' && h !== 'right') return; this.hands[h] = { grip, ray, src: e.data }; if (this.models[h]) ray.add(this.models[h]); });
      ray.addEventListener('disconnected', e => { const h = e.data && e.data.handedness; if (this.hands[h] && this.hands[h].ray === ray) this.hands[h] = null; });
    }
    if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then(ok => { this.supported = ok; if (this.onSupport) this.onSupport(ok); }).catch(() => {});
  }
  setModels(m) {
    for (const h of ['left', 'right']) {
      if (!m[h]) continue;
      this.models[h] = m[h];
      if (this.hands[h]) this.hands[h].ray.add(m[h]);
    }
    if (m.torch) { this.torch = m.torch; this.torchLen = m.len; }
  }
  async enter() {
    if (!this.supported || this.on) return;
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    const r = this.renderer;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFramebufferScaleFactor(1.0);
    await r.xr.setSession(session);
    r.xr.setFoveation(1);
    this.session = session; this.on = true;
    // the camera rides in the rig; the headset drives its local pose
    this.rig.add(this.camera); this.camera.position.set(0, 0, 0); this.camera.quaternion.identity();
    this.player.intro = 1; this.player.pitch = 0;
    this.input.device = 'xr';
    this.placeRig(true);
    session.addEventListener('end', () => {
      this.on = false; this.session = null;
      this.scene.add(this.camera); this.input.device = 'kbm';
      if (this.onEnd) this.onEnd();
    });
  }
  headWorld(out) { this.camera.updateMatrixWorld(true); return out.setFromMatrixPosition(this.camera.matrixWorld); }
  // rig under the player's feet, turned by the player's yaw
  placeRig(snap) {
    const P = this.player;
    if (snap) { this.rig.position.set(P.pos.x, P.pos.y, P.pos.z); this.rig.rotation.set(0, P.yaw, 0); this.rig.updateMatrixWorld(true); }
  }
  // stick turning about the head, physical walking resolved against walls
  update(dt) {
    if (!this.on) return;
    const P = this.player, rig = this.rig;
    this._poll(dt);
    // models ride the aim ray (guns point where the controller points), the hand sits on the grip
    for (const h of ['left', 'right']) {
      const H = this.hands[h], M = this.models[h]; if (!H || !M) continue;
      H.ray.updateMatrixWorld(true); H.grip.updateMatrixWorld(true);
      this._m.copy(H.ray.matrixWorld).invert().multiply(H.grip.matrixWorld); M.position.setFromMatrixPosition(this._m);
    }
    // turn about the head, not the rig origin
    const turn = this.turn * TURN * dt;
    if (turn) {
      const h = this.headWorld(this._h);
      rig.position.sub(h).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(h);
      rig.rotation.y += turn; P.yaw += turn;
    }
    rig.position.y = P.pos.y;
    rig.updateMatrixWorld(true);
    // physical walking: move the body to the head through the collision code, push the rig back if blocked
    const h = this.headWorld(this._h);
    const dx = h.x - P.pos.x, dz = h.z - P.pos.z;
    if (dx * dx + dz * dz > 1e-6) {
      if (dx * dx + dz * dz > 1) { P.pos.x = h.x; P.pos.z = h.z; } // recentre / teleport: follow
      else P.walkTo(dx, dz);
      rig.position.x += P.pos.x - h.x; rig.position.z += P.pos.z - h.z;
      rig.updateMatrixWorld(true);
    }
    // the head's facing drives stick movement
    this.camera.getWorldQuaternion(this._q);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this._q);
    P.moveYaw = Math.atan2(-f.x, -f.z);
    // world-space view for the rest of the frame
    const v = this.view, xc = this.renderer.xr.getCamera();
    this.camera.matrixWorld.decompose(v.position, v.quaternion, this._s);
    v.matrixWorld.compose(v.position, v.quaternion, new THREE.Vector3(1, 1, 1)); v.matrixWorldInverse.copy(v.matrixWorld).invert();
    if (xc && xc.projectionMatrix) v.projectionMatrix.copy(xc.projectionMatrix);
  }
  _poll() {
    const I = this.input;
    this.turn = 0; I.move.x = I.move.y = 0; I.held.sprint = false;
    for (const side of ['left', 'right']) {
      const H = this.hands[side]; if (!H || !H.src || !H.src.gamepad) continue;
      const gp = H.src.gamepad, ax = gp.axes, bt = gp.buttons, prev = this.prev[side];
      const sx = ax.length >= 4 ? ax[2] : ax[0] || 0, sy = ax.length >= 4 ? ax[3] : ax[1] || 0;
      const dz = v => Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD);
      const down = i => !!(bt[i] && bt[i].pressed), edge = i => down(i) && !prev[i];
      if (side === 'left') {
        I.move.x = dz(sx); I.move.y = -dz(sy);
        I.held.sprint = down(3);                      // stick click
        if (edge(0)) I.pressed.add('light');          // trigger: the torch in this hand
        if (edge(4)) I.crouch = !I.crouch;            // X
        if (edge(5)) I.pressed.add('perf');           // Y
      } else {
        this.turn = -dz(sx);
        I.held.fire = down(0);                        // trigger: fire (or use, pointing at a panel)
        if (edge(0)) I.pressed.add('use');
        if (edge(4)) I.pressed.add('reload');         // A
        if (edge(5)) I.pressed.add('swap');           // B: next gun / torch
        if (edge(3)) I.pressed.add('jump');           // stick click
      }
      this.prev[side] = bt.map((b, i) => down(i));
    }
  }
  // flashlight in the right hand (null = none)
  // the torch in the left hand (its lens is on its +z end)
  lightPose(outPos, outDir) {
    if (!this.torch || !this.hands.left) return false;
    this.torch.updateWorldMatrix(true, false);
    outPos.set(0, 0, this.torchLen * 0.5 + 0.01).applyMatrix4(this.torch.matrixWorld);
    outDir.set(0, 0, 1).transformDirection(this.torch.matrixWorld);
    return true;
  }
  // what the right hand points at (for doors and panels)
  rightRay(o, d) {
    const H = this.hands.right; if (!H) return false;
    H.ray.updateMatrixWorld(true);
    o.setFromMatrixPosition(H.ray.matrixWorld); d.set(0, 0, -1).transformDirection(H.ray.matrixWorld);
    return true;
  }
}
