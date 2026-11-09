// WebXR (Quest browser / PC VR): rig that carries the headset, smooth locomotion and turning,
// real walking kept out of walls; gun rigs in the right hand, the torch in the left (both aim along the ray). Comfort: the head is never moved
// by the game except to stop it going through a wall; no bob, no forced rotation.
import * as THREE from 'three';
import { makeModelMaterial } from '../render/shaders.js';
import { F_COLLIDE } from '../world/grid.js';

const TURN = 1.92;      // rad/s at full stick (smooth turning)
const DEAD = 0.15;

export class XR {
  constructor(renderer, scene, camera, player, input) {
    Object.assign(this, { renderer, scene, camera, player, input });
    this.supported = false; this.on = false; this.session = null;
    this.rig = new THREE.Group(); this.rig.name = 'xr-rig'; scene.add(this.rig);
    this.hands = { left: null, right: null }; this.prev = { left: [], right: [] };
    this.view = new THREE.PerspectiveCamera();   // world-space stand-in for the head (zones, audio, probes)
    this._h = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._lp = new THREE.Vector3(); this._hp = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._q2 = new THREE.Quaternion(); this._e = new THREE.Euler(); this._rp = new THREE.Vector3(); this._rv = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    renderer.xr.enabled = true;
    // hand models arrive later (setModels): left = arm holding the torch, right = the gun rigs
    this.models = { left: null, right: null }; this.torch = null; this.torchLen = 0.3;
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i), ray = renderer.xr.getController(i);
      this.rig.add(grip); this.rig.add(ray);
      ray.addEventListener('connected', e => { const h = e.data.handedness; if (h !== 'left' && h !== 'right') return; this.hands[h] = { grip, ray, src: e.data }; if (this.models[h]) ray.add(this.models[h]); if (h === 'right' && this.rightHand) ray.add(this.rightHand); });
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
    if (m.torch) { this.torch = m.torch; this.torchLen = m.len; this._buildHolster(); }
    if (m.guns) this.guns = m.guns;
    if (m.fingers) this.fingers = m.fingers;
    if (m.rightHand) { this.rightHand = m.rightHand; this.rFingers = m.rFingers; if (this.hands.right) this.hands.right.ray.add(m.rightHand); }
  }
  // flashlight pouch on the left thigh: a slim open sleeve, nothing above the torch's head
  _buildHolster() {
    const t = this.torch;
    this.torchHome = { parent: t.parent, pos: t.position.clone(), quat: t.quaternion.clone() };
    const b = new THREE.Box3().setFromObject(t), r = Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 0.5 * 1.08;
    const H = this.holster = new THREE.Group(); H.visible = false; this.scene.add(H);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.055, 20, 1, true).rotateX(Math.PI / 2),
      makeModelMaterial(new THREE.MeshStandardMaterial({ color: 0x15170f, roughness: 0.92, side: THREE.DoubleSide })));
    sleeve.position.z = -this.torchLen * 0.08;                    // round the body, below the head
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, 0.09), sleeve.material);
    strap.position.set(r + 0.002, 0, -this.torchLen * 0.08 - 0.03);   // belt strap on the leg side, out of the hand's way
    H.add(sleeve, strap);
    this.inHolster = false; this.support = false; this.bodyYaw = null; this.headTop = 1.7;
  }
  _holsterTorch(on) {
    const t = this.torch; if (!t || on === this.inHolster) return;
    this.inHolster = on;
    if (on) { this.holster.add(t); t.position.set(0, 0, 0); t.quaternion.identity(); }
    else { const h = this.torchHome; h.parent.add(t); t.position.copy(h.pos); t.quaternion.copy(h.quat); }
    this._pulse('left', 0.5, 40);
  }
  _pulse(side, k, ms) { const H = this.hands[side], a = H && H.src.gamepad && H.src.gamepad.hapticActuators; if (a && a[0] && a[0].pulse) a[0].pulse(k, ms); }
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
    this.placeRig(true); this.needCenter = true;
    const ref = r.xr.getReferenceSpace(); if (ref && ref.addEventListener) ref.addEventListener('reset', () => { this.needCenter = true; });
    session.addEventListener('end', () => {
      this.on = false; this.session = null;
      if (this.gunHeld === false && this.hands.right && this.models.right) { this.hands.right.ray.add(this.models.right); this.models.right.quaternion.identity(); }
      this.gunHeld = undefined; this._gripUsed = false; this.drop = null; this.rack = null;
      if (this.torch) { this._holsterTorch(false); this.holster.visible = false; }
      this._setSupport(false);
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
      const H = this.hands[h], M = this.models[h]; if (!H || !M || (h === 'right' && this.gunHeld === false)) continue;
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
      // first frame, a recentre or a jump: bring the headset back over the body (never move the body without collision)
      if ((this.needCenter && this.camera.position.lengthSq() > 0.25) || dx * dx + dz * dz > 0.36) { this.needCenter = false; rig.position.x -= dx; rig.position.z -= dz; rig.updateMatrixWorld(true); this.headWorld(h); }
      else P.walkTo(dx, dz);
      rig.position.x += P.pos.x - h.x; rig.position.z += P.pos.z - h.z;
      rig.updateMatrixWorld(true);
    }
    this._leftHand(); this._rightHand(dt);
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
  _setSupport(on) {
    if (this.support === on) return;
    this.support = on;                                              // your own left hand stays: it closes on the handguard
    if (!on && this.models.right) this.models.right.quaternion.identity();
    if (on) this._pulse('left', 0.35, 30);
  }
  // left hand: holster / draw the torch at the thigh, grip the gun's handguard, aim with both hands
  _leftHand() {
    if (!this.holster) return;
    const L = this.hands.left, R = this.hands.right;
    // body yaw follows the head past a dead zone (the thigh does not swing with every glance)
    this.camera.getWorldQuaternion(this._q);
    const f = this._s.set(0, 0, -1).applyQuaternion(this._q), hy = Math.atan2(-f.x, -f.z);
    if (this.bodyYaw === null) this.bodyYaw = hy;
    let dy = Math.atan2(Math.sin(hy - this.bodyYaw), Math.cos(hy - this.bodyYaw));
    if (Math.abs(dy) > 0.6) this.bodyYaw += dy - Math.sign(dy) * 0.6;
    // thigh from the head height above the floor (tracks crouching)
    const h = this.headWorld(this._h), floor = this.rig.position.y, hh = h.y - floor;
    this.headTop = Math.max(hh, this.headTop - 0.0005);
    const ty = floor + Math.max(0.3, this.headTop * 0.47 - Math.max(0, this.headTop - hh) * 0.55);
    const cy = Math.cos(this.bodyYaw), sy = Math.sin(this.bodyYaw);
    const lx = -0.19, fz = 0.02, back = 0.09;                   // left, slightly forward of the leg's centre
    const H = this.holster; H.visible = true;
    H.position.set(h.x + sy * back + cy * lx - sy * fz, ty, h.z + cy * back - sy * lx - cy * fz);
    H.quaternion.setFromEuler(this._e.set(Math.PI / 2 + 0.12, this.bodyYaw, 0, 'YXZ'));   // lens down, tipped forward
    H.updateMatrixWorld(true);
    if (!L) return;
    const gp = L.src.gamepad, down = !!(gp && gp.buttons[1] && gp.buttons[1].pressed);
    L.grip.updateMatrixWorld(true); const lp = this._lp.setFromMatrixPosition(L.grip.matrixWorld);
    const gun = this.guns && this.guns.vrGun();
    if (down && !this._lgPrev) {
      const nearHolster = lp.distanceTo(this._hp.setFromMatrixPosition(H.matrixWorld)) < 0.2;
      if (nearHolster) this._holsterTorch(!this.inHolster);
      else if (this.inHolster && gun && gun.handL) {
        gun.handL.getWorldPosition(this._hp);
        if (lp.distanceTo(this._hp) < 0.17) { this._setSupport(true); this._supGun = gun; }
      }
    }
    // rack: left grip on the charging handle / slide and pull it back along the bore
    if (down && !this._lgPrev && gun && this.gunHeld && this.inHolster && gun.rif) {
      gun.rif.getWorldPosition(this._hp);
      if (lp.distanceTo(this._hp) < 0.11) { this.rack = { start: lp.dot(gun.boreWorld()), back: false }; this._setSupport(false); this._pulse('left', 0.3, 20); }
    }
    if (this.rack) {
      const pull = gun ? Math.max(0, Math.min(gun.rackTravel, this.rack.start - lp.dot(gun.boreWorld()))) : 0;
      this.guns.rackPull = pull;
      if (!this.rack.back && gun && pull > gun.rackTravel * 0.85) { this.rack.back = true; this._pulse('left', 0.6, 30); this.guns.rackBack(); }
      if (!down || !gun || !this.gunHeld) { if (this.rack.back) { this.guns.rackHome(); this._pulse('right', 0.7, 40); } this.rack = null; this.guns.rackPull = 0; }
    }
    if (!down || !gun || gun !== this._supGun || !this.inHolster || !this.gunHeld || this.rack) this._setSupport(false);
    this._lgPrev = down;
    // fingers: the torch grip while you hold it, else trigger -> index, grip -> the rest, a touched button -> thumb
    if (this.fingers) {
      if (!this.inHolster) this.fingers.hold();
      else {
        const b = gp ? gp.buttons : [], v = i => (b[i] ? b[i].value || (b[i].pressed ? 1 : 0) : 0), tch = [3, 4, 5].some(i => b[i] && (b[i].touched || b[i].pressed));
        const f = this._fk || (this._fk = { index: 0, grip: 0, thumb: 0 });
        const tg = { index: Math.max(v(0), this.support ? 0.75 : 0), grip: Math.max(v(1), this.rack ? 1 : 0), thumb: tch || this.support || this.rack ? 0.8 : 0.1 };
        for (const k in f) f[k] += (tg[k] - f[k]) * 0.45;
        this.fingers.pose(f);
      }
    }
    // two hands: the gun turns so the line from its grip hand to its support hand runs to the real left hand
    if (this.support && R) {
      const M = this.models.right, g = R.ray;
      g.getWorldQuaternion(this._q);
      const a = this._a.copy(gun.supportRest).applyQuaternion(this._q).normalize();
      R.grip.updateMatrixWorld(true);
      const gpos = this._hp.setFromMatrixPosition(R.grip.matrixWorld), want = this._b.copy(lp).sub(gpos);
      if (want.lengthSq() > 0.01) {
        const Q = this._q2.setFromUnitVectors(a, want.normalize()).multiply(this._q);
        M.quaternion.copy(this._q.invert()).multiply(Q);
        if (lp.distanceTo(gpos) > gun.supportRest.length() + 0.25) this._setSupport(false);   // let go: hands too far apart
      }
    }
  }
  // right hand: the gun stays in the hand while the grip is squeezed (after the first squeeze); let go and it falls,
  // thrown with the hand's speed; squeeze near it to pick it up
  _rightHand(dt) {
    const R = this.hands.right, M = this.models.right; if (!R || !M) return;
    const gp = R.src.gamepad, down = !!(gp && gp.buttons[1] && gp.buttons[1].pressed);
    R.grip.updateMatrixWorld(true); const hp = this._rp.setFromMatrixPosition(R.grip.matrixWorld);
    const hv = this._rv; if (this._rpPrev) hv.subVectors(hp, this._rpPrev).multiplyScalar(1 / Math.max(dt, 1e-3)); (this._rpPrev || (this._rpPrev = new THREE.Vector3())).copy(hp);
    if (this.gunHeld === undefined) this.gunHeld = true;
    if (down) this._gripUsed = true;
    if (this.gunHeld && this._gripUsed && !down && !this.support && this.guns && this.guns.vrGun()) {
      M.updateWorldMatrix(true, false); M.matrixWorld.decompose(M.position, M.quaternion, this._s);
      this.scene.add(M); this.gunHeld = false; this._setSupport(false);
      this.drop = { v: hv.clone().multiplyScalar(1.1), w: new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4), rest: false, t: 0 };
    }
    if (!this.gunHeld && down && !this._rgPrev) {
      M.getWorldPosition(this._hp);
      if (hp.distanceTo(this._hp) < 0.3) { R.ray.add(M); M.quaternion.identity(); this.gunHeld = true; this.drop = null; this._pulse('right', 0.4, 30); }
    }
    this._rgPrev = down;
    if (this.drop) this._fall(dt);
    // the empty hand: shown while the gun is out of it, on the grip, fingers from the controller
    const E = this.rightHand;
    if (E) {
      E.visible = !this.gunHeld;
      if (E.visible) {
        R.ray.updateMatrixWorld(true); this._m.copy(R.ray.matrixWorld).invert().multiply(R.grip.matrixWorld); E.position.setFromMatrixPosition(this._m);
        if (this.rFingers) {
          const b = gp ? gp.buttons : [], v = i => (b[i] ? b[i].value || (b[i].pressed ? 1 : 0) : 0), tch = [3, 4, 5].some(i => b[i] && (b[i].touched || b[i].pressed));
          const f = this._rk || (this._rk = { index: 0, grip: 0, thumb: 0 });
          const tg = { index: v(0), grip: v(1), thumb: tch ? 0.8 : 0.1 };
          for (const k in f) f[k] += (tg[k] - f[k]) * 0.45;
          this.rFingers.pose(f);
        }
      }
    }
    if (this.guns) this.guns.vrArms(this.gunHeld !== false);
  }
  _fall(dt) {
    const D = this.drop, M = this.models.right, g = this.player.zm.grid; if (D.rest || !g) return;
    D.t += dt; D.v.y -= 9.81 * dt;
    const p = M.position, step = D.v.length() * dt;
    if (step > 1e-4) {                                       // walls: bounce off along the travel
      const d = this._b.copy(D.v).normalize(), t = g.ray(p.x, p.y, p.z, d.x, d.y, d.z, step + 0.06, F_COLLIDE, false);
      if (t >= 0 && d.y > -0.7) { D.v.x *= -0.3; D.v.z *= -0.3; }
    }
    p.addScaledVector(D.v, dt);
    const t = g.ray(p.x, p.y + 0.3, p.z, 0, -1, 0, 2.5, F_COLLIDE, false), fy = t >= 0 ? p.y + 0.3 - t : -1e9;
    if (p.y < fy + 0.04) {
      p.y = fy + 0.04;
      if (D.v.y < -1.2 && this.guns) this.guns.dropSound(p);
      D.v.y = -D.v.y * 0.22; D.v.x *= 0.55; D.v.z *= 0.55; D.w.multiplyScalar(0.5);
      // settles on its side
      const yaw = Math.atan2(-this._b.set(0, 0, -1).applyQuaternion(M.quaternion).x, -this._b.z);
      M.quaternion.slerp(this._q2.setFromEuler(this._e.set(0, yaw, Math.PI / 2, 'YXZ')), 0.35);
      if (Math.abs(D.v.y) < 0.15 && Math.hypot(D.v.x, D.v.z) < 0.08) D.rest = true;
    } else {
      const w = D.w, a = w.length() * dt;
      if (a > 0) M.quaternion.premultiply(this._q2.setFromAxisAngle(this._b.copy(w).normalize(), a));
    }
    if (D.t > 12) D.rest = true;
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
        if (edge(5) && this.gunHeld !== false) I.pressed.add('swap');   // B: next gun / torch (not while the gun is on the floor)
        if (edge(3)) I.pressed.add('jump');           // stick click
      }
      this.prev[side] = bt.map((b, i) => down(i));
    }
  }
  // flashlight in the right hand (null = none)
  // the torch in the left hand (its lens is on its +z end)
  lightPose(outPos, outDir) {
    if (!this.torch || (!this.hands.left && !this.inHolster)) return false;
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
