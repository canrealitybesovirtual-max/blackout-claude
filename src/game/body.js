// VR body: the soldier model under your headset. Feet stay planted and step after you, legs bend when you
// crouch (two-bone IK), the arms reach your real hands (two-bone IK, elbows down and out), the head is hidden
// (you are inside it) and so are its hands: your animated gloves sit on its wrists.
import * as THREE from 'three';
import { loadGLB, convert, findBone } from '../render/models.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
// turn a bone (about its own origin) so the direction to its child points at a world point
function aim(bone, child, target) {
  bone.updateWorldMatrix(true, true);
  _a.setFromMatrixPosition(bone.matrixWorld); _b.setFromMatrixPosition(child.matrixWorld);
  const cur = _b.sub(_a).normalize(), want = _c.copy(target).sub(_a); if (want.lengthSq() < 1e-8) return; want.normalize();
  _q.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(_wq); bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_q).multiply(_wq));
  bone.updateWorldMatrix(false, true);
}
// two-bone IK: root A, mid B, end C reach T, the mid joint bends toward the pole point
function ik2(A, B, C, T, pole) {
  A.updateWorldMatrix(true, true);
  const pa = new THREE.Vector3().setFromMatrixPosition(A.matrixWorld), pb = new THREE.Vector3().setFromMatrixPosition(B.matrixWorld), pc = new THREE.Vector3().setFromMatrixPosition(C.matrixWorld);
  const la = pa.distanceTo(pb), lb = pb.distanceTo(pc), dv = T.clone().sub(pa), d = THREE.MathUtils.clamp(dv.length(), 0.05, (la + lb) * 0.999);
  const dir = dv.normalize(), along = (la * la - lb * lb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, la * la - along * along));
  const pd = pole.clone().sub(pa); pd.addScaledVector(dir, -pd.dot(dir)); if (pd.lengthSq() < 1e-6) pd.set(0, -1, 0); pd.normalize();
  const mid = pa.clone().addScaledVector(dir, along).addScaledVector(pd, h);
  aim(A, B, mid); aim(B, C, pa.addScaledVector(dir, d));
}

export class VRBody {
  constructor(scene) {
    this.scene = scene; this.ready = false; this.feet = null;
    loadGLB('models/soldier.glb', true).then(g => {
      const root = this.root = g.scene; root.visible = false;
      convert(root, {});
      const B = n => findBone(root, new RegExp('^' + n + '(_\\d+)?$'));
      this.b = {};
      for (const n of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'])
        this.b[n] = B(n);
      scene.add(root); root.updateMatrixWorld(true);
      // measure at rest (model units): eye height, feet beside the pelvis, ankle height
      const P = b => new THREE.Vector3().setFromMatrixPosition(this.b[b].matrixWorld);
      this.eye = P('head').y + 0.06 * (P('head').y / 1.6);
      this.rest = new Map(); root.traverse(o => { if (o.isBone) this.rest.set(o, { q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone() }); });
      const pel = P('pelvis'); this.footOff = ['l', 'r'].map(s => P('foot_' + s).sub(pel).setY(0)); this.ankle = P('foot_l').y; this.pelvisY = pel.y;
      // hide what you are inside of (head) and what your gloves replace (hands)
      for (const n of ['head', 'hand_l', 'hand_r']) this.hide = (this.hide || []).concat(this.b[n]);
      this.ready = true;
    }).catch(e => console.error('vr body', e));
  }
  // head: world head position + body yaw; floor y; standing head height; wrists (world) for both arms (null = hang)
  update(dt, head, yaw, floor, stand, wristL, wristR) {
    if (!this.ready) return;
    const R = this.root; R.visible = true;
    for (const [o, r] of this.rest) { o.quaternion.copy(r.q); o.position.copy(r.p); o.scale.copy(r.s); }
    for (const o of this.hide) o.scale.setScalar(0.001);
    const k = stand / this.eye, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    R.scale.setScalar(k); R.rotation.set(0, yaw + Math.PI, 0);              // the model faces +z
    const drop = Math.max(0, stand - (head.y - floor));                    // crouching: the hips go down, knees bend
    R.position.set(head.x - fx * 0.11, floor - drop * 0.92, head.z - fz * 0.11);   // neck ~11 cm behind the eyes; feet stay on the floor (IK)
    // feet: planted, step after the body
    const home = s => new THREE.Vector3(R.position.x, floor + this.ankle * k, R.position.z).add(this.footOff[s].clone().multiplyScalar(k).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw + Math.PI));
    if (!this.feet) this.feet = [0, 1].map(s => ({ p: home(s), from: null, t: 1 }));
    const stepping = this.feet.some(f => f.t < 1);
    this.feet.forEach((f, s) => {
      const h = home(s);
      if (f.t >= 1 && !stepping && Math.hypot(h.x - f.p.x, h.z - f.p.z) > 0.24) { f.from = f.p.clone(); f.to = h; f.t = 0; }
      if (f.t < 1) { f.t = Math.min(1, f.t + dt / 0.26); f.to.copy(h); f.p.lerpVectors(f.from, f.to, f.t); f.p.y = f.to.y + Math.sin(f.t * Math.PI) * 0.07; }
      else f.p.y = h.y;
    });
    R.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(fx, 0, fz);
    ['l', 'r'].forEach((s, i) => {
      const knee = new THREE.Vector3().setFromMatrixPosition(this.b['calf_' + s].matrixWorld).addScaledVector(fwd, 1).add(_d.set(0, 0.3, 0));
      ik2(this.b['thigh_' + s], this.b['calf_' + s], this.b['foot_' + s], this.feet[i].p, knee);
    });
    // arms to the wrists; elbows down, out and a little back
    const side = new THREE.Vector3(-fz, 0, fx);                             // +right
    [['l', wristL, -1], ['r', wristR, 1]].forEach(([s, w, sg]) => {
      if (!w) return;
      const sh = new THREE.Vector3().setFromMatrixPosition(this.b['upperarm_' + s].matrixWorld);
      const pole = sh.clone().add(_d.set(0, -0.6, 0)).addScaledVector(side, 0.35 * sg).addScaledVector(fwd, -0.25);
      ik2(this.b['upperarm_' + s], this.b['lowerarm_' + s], this.b['hand_' + s], w, pole);
    });
  }
  hideAll() { if (this.root) this.root.visible = false; this.feet = null; }
}
