// Player hands (guns off): the rigged low-poly FPS arms with the Flash-Lite flashlight in the
// left (support) hand, where the rifle's handguard sat. The right arm and rifle stay in the file,
// hidden, for when the user's guns go in. Desktop: own view-model scene and camera (like a gun).
// VR: separate copies hang on the controllers (makeVR).
import * as THREE from 'three';
import { U } from '../render/shaders.js';
import { loadGLB, convert, tagArmParts } from '../render/models.js';

const HANDS_URL = 'models/hands.glb', TORCH_URL = 'models/flashlight.glb';
const TORCH_LENS_Z = 0.148; // flashlight lens on its +z end (model metres)

// measure the rig once: which arm is which, the handguard axis under the support hand
function analyse(scene) {
  scene.updateMatrixWorld(true);
  const arms = [], props = [];
  scene.traverse(m => { if (m.isSkinnedMesh) arms.push(m); else if (m.isMesh) props.push(m); });
  const box = m => new THREE.Box3().setFromObject(m);
  // support arm reaches furthest forward (+z in the source file)
  arms.sort((a, b) => box(b).max.z - box(a).max.z);
  const support = arms[0], firing = arms[1];
  const hand = tagArmParts(support), fhand = firing ? tagArmParts(firing) : null;
  const palm = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
  // rifle cross-section at the palm: centre and radius of the handguard
  let n = 0; const c = new THREE.Vector3(), v = new THREE.Vector3(), pts = [];
  for (const m of props) {
    const P = m.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.z - palm.z) < 0.03) { c.add(v); n++; pts.push(v.clone()); }
    }
  }
  if (n) c.multiplyScalar(1 / n); else c.set(0, palm.y + 0.03, palm.z);
  let r = 0; for (const p of pts) r += Math.hypot(p.x - c.x, p.y - c.y); r = n ? r / n : 0.025;
  return { support, firing, props, palm, axis: c, radius: r, hand, fhand };
}

function placeTorch(torch, info) {
  const s = THREE.MathUtils.clamp(info.radius * 1.05 / 0.0285, 0.75, 1.1);
  torch.scale.setScalar(s);
  torch.position.set(info.axis.x, info.axis.y, info.axis.z - 0.02);
}

// close the fingers and thumb round the torch body: each joint, base to tip, turns about the torch's axis
// until the next joint or the tip would go inside the glove-padded surface (or it reaches 1.5 rad)
const _a = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
function wrapFingers(info, holder, radius) {
  holder.updateWorldMatrix(true, false);
  _a.setFromMatrixPosition(holder.matrixWorld); _t.set(0, 0, 1).transformDirection(holder.matrixWorld);
  const rad = p => { _p.copy(p).sub(_a); return _p.addScaledVector(_t, -_p.dot(_t)).length(); };
  const fore = info.hand.parent && info.hand.parent.isBone ? info.hand.parent : info.hand;
  const chains = [];
  for (const root of [...info.hand.children, ...fore.children]) {
    if (!root.isBone || root === info.hand) continue;
    const c = []; let b = root; while (b && b.isBone) { c.push(b); b = b.children.find(k => k.isBone); }
    if (c.length >= 2) chains.push(c);
  }
  const pts = c => c.map(b => b.getWorldPosition(new THREE.Vector3()));
  // flexion: turn the bone so its direction bends toward the torch axis (about the axis across the finger)
  const _ax = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _j = new THREE.Vector3(), _c = new THREE.Vector3();
  const curl = (b, child, ang) => {
    b.getWorldPosition(_j); child.getWorldPosition(_c);
    _d.copy(_c).sub(_j).normalize();
    _n.copy(_a).sub(_j); _n.addScaledVector(_t, -_n.dot(_t)).normalize();          // from the joint to the axis
    _ax.crossVectors(_d, _n); if (_ax.lengthSq() < 1e-8) return false; _ax.normalize();
    b.getWorldQuaternion(_wq); b.parent.getWorldQuaternion(_pq);
    _q.setFromAxisAngle(_ax, ang);
    b.quaternion.copy(_pq.invert().multiply(_q).multiply(_wq)); b.updateWorldMatrix(false, true);
    return true;
  };
  for (const c of chains) {
    for (let j = 0; j < c.length - 1; j++) {
      const saved = c.map(b => b.quaternion.clone());
      for (let a = 0; a < 1.6; a += 0.05) {
        const before = c.map(b => b.quaternion.clone());
        if (!curl(c[j], c[j + 1], 0.05)) break;
        if (pts(c.slice(j + 1)).some(q => rad(q) < radius)) { c.forEach((b, i) => b.quaternion.copy(before[i])); c[0].parent.updateWorldMatrix(false, true); break; }
      }
      void saved;
    }
  }
}

// a controllable hand: per finger chain its rest pose and a flexion axis (in the bone's own frame, bending toward
// the torch / handguard axis the palm faces). pose(curl per finger) = rest turned by curl x joint weight.
function fingerRig(info, holder) {
  holder.updateWorldMatrix(true, false);
  const A = new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld), T = new THREE.Vector3(0, 0, 1).transformDirection(holder.matrixWorld);
  const fore = info.hand.parent && info.hand.parent.isBone ? info.hand.parent : info.hand;
  const chains = [];
  for (const root of [...info.hand.children, ...fore.children]) {
    if (!root.isBone || root === info.hand) continue;
    const c = []; let b = root; while (b && b.isBone) { c.push(b); b = b.children.find(k => k.isBone); }
    if (c.length >= 2) chains.push({ bones: c, palm: root.parent === info.hand });
  }
  const P = b => b.getWorldPosition(new THREE.Vector3()), q = new THREE.Quaternion();
  for (const ch of chains) {
    ch.rest = ch.bones.map(b => b.quaternion.clone());
    ch.axis = ch.bones.slice(0, -1).map((b, j) => {
      const jp = P(b), d = P(ch.bones[j + 1]).sub(jp).normalize(), n = A.clone().sub(jp); n.addScaledVector(T, -n.dot(T)).normalize();
      const ax = new THREE.Vector3().crossVectors(d, n); if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0);
      return ax.normalize().applyQuaternion(b.getWorldQuaternion(q).invert());
    });
    ch.root = P(ch.bones[0]);
  }
  // roles: the forearm chain whose root sits furthest from the palm fingers is the thumb; the palm finger nearest it is the index
  const palmC = chains.filter(c => c.palm), mean = palmC.reduce((s, c) => s.add(c.root), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, palmC.length));
  let thumb = null; for (const c of chains) if (!c.palm && (!thumb || c.root.distanceTo(mean) > thumb.root.distanceTo(mean))) thumb = c;
  let index = null; if (thumb) for (const c of palmC) if (!index || c.root.distanceTo(thumb.root) < index.root.distanceTo(thumb.root)) index = c;
  for (const c of chains) c.role = c === thumb ? 'thumb' : c === index ? 'index' : 'grip';
  const W = { thumb: [0.55, 0.65, 0.5], index: [0.9, 1.15, 0.85, 0.5], grip: [0.95, 1.2, 0.9, 0.55] }, qq = new THREE.Quaternion();
  return {
    chains,
    // k = curl 0 open .. 1 fist per role; open is a little straighter than the pack's pose
    pose(k) {
      for (const c of chains) {
        const t = THREE.MathUtils.lerp(-0.35, 1, k[c.role]), w = W[c.role];
        c.bones.forEach((b, j) => { if (j < c.axis.length) b.quaternion.copy(c.rest[j]).multiply(qq.setFromAxisAngle(c.axis[j], t * (w[j] ?? 0.5))); });
      }
    },
    save() { for (const c of chains) c.hold = c.bones.map(b => b.quaternion.clone()); },
    hold() { for (const c of chains) c.bones.forEach((b, j) => b.quaternion.copy(c.hold[j])); },
  };
}

async function build(fresh) {
  const [h, f] = await Promise.all([loadGLB(HANDS_URL, fresh), loadGLB(TORCH_URL, fresh)]);
  const arms = h.scene, info = analyse(arms);
  convert(arms, { glove: true });
  for (const p of info.props) p.visible = false;          // rifle: kept for the user's guns
  const torch = f.scene;
  convert(torch, { emitFor: m => (m.name || '').toLowerCase().includes('glass') ? 7 : 0 });
  // the file's own transforms point the torch along +z with its lens at +z: centre it on the handguard axis
  const tb = new THREE.Box3().setFromObject(torch), tc = tb.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(); torch.position.sub(tc); holder.add(torch);
  placeTorch(holder, info);
  arms.add(holder);
  arms.updateMatrixWorld(true);
  const fingers = fingerRig(info, holder);
  wrapFingers(info, holder, 0.0285 * holder.scale.x + 0.012);   // body radius + glove
  fingers.save();                                               // the torch grip
  return { arms, torch: holder, info, len: tb.max.z - tb.min.z, fingers };
}

export class Hands {
  constructor(audio) {
    this.audio = audio;
    this.aiming = false; this.ads = 0; this.def = { adsFov: 1, cap: 1 };
    this.flashOn = false;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(58, 1, 0.01, 10); this.scene.add(this.cam);
    this.root = new THREE.Group(); this.cam.add(this.root);
    this.root.rotation.y = Math.PI;                        // the file looks down +z
    this.ready = false; this.q = new THREE.Quaternion(); this.init = false;
    this.sway = new THREE.Vector2(); this.swayV = new THREE.Vector2(); this.t = 0;
    this.lastYaw = null; this.lastPitch = 0;
    // hip pose: torch ~0.42 m ahead, 0.2 m down, 0.13 m left of the eye (the file's grip sits near its origin)
    this.base = new THREE.Vector3(-0.11, -0.135, -0.38);
    build(false).then(r => {
      this.model = r; if (r.info.firing) r.info.firing.visible = false;   // right arm waits for a gun
      const a = r.torch.position;                                           // torch centre in the file
      r.arms.position.copy(a).negate();                                      // torch centre at the root origin
      this.root.add(r.arms); this.ready = true; if (this.onReady) this.onReady(this);
    })
      .catch(e => console.error('hands', e));
  }
  ammoText() { return null; }
  update(dt, input, cam, player) {
    if (input.has && input.has('light')) { this.flashOn = !this.flashOn; this.audio.play2D('dry', { gain: 0.5, rate: 1.6 }); }
    U.uFlashOn.value = this.flashOn ? 1 : 0;
    this.t += dt;
    // view model follows the main camera; arms lag the look a little and bob with the stride
    this.cam.position.copy(cam.position); this.cam.quaternion.copy(cam.quaternion);
    if (player) {
      if (this.lastYaw === null) { this.lastYaw = player.yaw; this.lastPitch = player.pitch; }
      const dyaw = player.yaw - this.lastYaw, dp = player.pitch - this.lastPitch;
      this.lastYaw = player.yaw; this.lastPitch = player.pitch;
      const tx = THREE.MathUtils.clamp(-dyaw * 1.4, -0.08, 0.08), ty = THREE.MathUtils.clamp(dp * 1.1, -0.06, 0.06);
      this.swayV.x += ((tx - this.sway.x) * 140 - this.swayV.x * 16) * dt; this.swayV.y += ((ty - this.sway.y) * 140 - this.swayV.y * 16) * dt;
      this.sway.addScaledVector(this.swayV, dt);
      const mv = Math.min(1, player.speed2d / 2.5) * (player.onGround ? 1 : 0.2), ph = player.bobPhase;
      const br = Math.sin(this.t * (1.3 + player.fatigue * 1.5)) * (0.0015 + player.fatigue * 0.004);
      const B = this.base;
      this.root.position.set(B.x + Math.cos(ph) * 0.007 * mv + this.sway.x * 0.3, B.y - Math.abs(Math.sin(ph)) * 0.008 * mv + br + this.sway.y * 0.25 - player.land * 0.03, B.z);
      this.root.rotation.set(this.sway.y + 0.05, Math.PI + this.sway.x + 0.12, this.sway.x * 1.2 + player.roll * 2 - 0.1);
    }
    this.cam.updateMatrixWorld(true);
    return cam;
  }
  // beam from the torch lens (falls back to the camera before the model loads)
  lightPose(outPos, outDir, cam) {
    if (!this.ready) { outPos.set(0.16, -0.14, -0.15).applyQuaternion(cam.quaternion).add(cam.position); outDir.set(0, 0, -1).applyQuaternion(cam.quaternion); return; }
    const t = this.model.torch; t.updateWorldMatrix(true, false);
    outPos.set(0, 0, this.model.len * 0.5 + 0.01).applyMatrix4(t.matrixWorld);
    outDir.set(0, 0, 1).transformDirection(t.matrixWorld);
  }
  // VR copies: left = support arm + torch (torch centred on the grip, beam along the controller),
  // right = firing arm with its palm on the grip. Upper arms cut (they would hang from nowhere).
  async makeVR() {
    // left controller: the support arm holding the torch (torch centred on the grip, beam along it)
    const a = await build(true);
    for (const m of [a.info.support, a.info.firing]) if (m) m.material.uniforms.uCutUpper.value = 1;
    if (a.info.firing) a.info.firing.visible = false;
    const g = new THREE.Group(), inner = new THREE.Group();
    inner.rotation.y = Math.PI; g.add(inner); inner.add(a.arms);   // the file looks down +z, the grip down -z
    a.arms.position.copy(a.torch.position).negate();
    // right controller, shown while the gun is out of the hand: the pack's firing arm, palm on the grip
    const b = await build(true);
    for (const m of [b.info.support, b.info.firing]) if (m) m.material.uniforms.uCutUpper.value = 1;
    b.info.support.visible = false; b.torch.visible = false;
    const rh = b.info.fhand;
    let rFingers = null;
    const r = new THREE.Group(), rin = new THREE.Group(); rin.rotation.y = Math.PI; r.add(rin); rin.add(b.arms);
    if (rh) {
      b.arms.updateMatrixWorld(true);
      const palm = new THREE.Vector3().setFromMatrixPosition(rh.matrixWorld);
      b.arms.position.copy(palm).negate();
      // the rifle grip it closes on: rifle vertices round the palm (the axis runs roughly up through the fist)
      const grip = new THREE.Object3D(); let n = 0; const c = new THREE.Vector3(), v = new THREE.Vector3();
      for (const m of b.info.props) { const P = m.geometry.attributes.position; for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); if (v.distanceTo(palm) < 0.06) { c.add(v); n++; } } }
      grip.position.copy(n ? c.multiplyScalar(1 / n) : palm.clone().add(new THREE.Vector3(0, 0.02, 0.03)));
      grip.lookAt(grip.position.clone().add(new THREE.Vector3(0, 1, 0)));
      b.arms.add(grip); b.arms.updateMatrixWorld(true);
      rFingers = fingerRig({ hand: rh }, grip); rFingers.save();
    }
    r.visible = false;
    return { left: g, torch: a.torch, len: a.len, fingers: a.fingers, rightHand: r, rFingers };
  }
}
