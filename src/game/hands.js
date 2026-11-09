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
  const hand = tagArmParts(support); if (firing) tagArmParts(firing);
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
  return { support, firing, props, palm, axis: c, radius: r, hand };
}

function placeTorch(torch, info) {
  const s = THREE.MathUtils.clamp(info.radius * 1.05 / 0.0285, 0.75, 1.1);
  torch.scale.setScalar(s);
  torch.position.set(info.axis.x, info.axis.y, info.axis.z - 0.02);
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
  return { arms, torch: holder, info, len: tb.max.z - tb.min.z };
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
    this.base = new THREE.Vector3(-0.12, -0.165, -0.4);
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
    return { left: g, torch: a.torch, len: a.len };
  }
}
