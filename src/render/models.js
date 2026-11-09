// GLB models: loading, conversion to the game's lighting, hands part tags, simple bone posing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeModelMaterial } from './shaders.js';

const loader = new GLTFLoader();
const cache = new Map();
export function loadGLB(url, fresh = false) {
  const go = () => new Promise((res, rej) => loader.load(url, g => res(g), undefined, rej));
  if (fresh) return go();                       // a separate instance (skinned meshes can't be shared)
  if (!cache.has(url)) cache.set(url, go());
  return cache.get(url);
}

// replace every material with the game's model shader (one program for all of them)
export function convert(root, o = {}) {
  const made = new Map();
  root.traverse(m => {
    if (!m.isMesh) return;
    const src = m.material;
    if (!made.has(src)) made.set(src, makeModelMaterial(src, { ...o, emit: o.emitFor ? o.emitFor(src) : 0 }));
    m.material = made.get(src);
    m.frustumCulled = !m.isSkinnedMesh; // skinned bounds are the bind pose; keep them drawn
  });
  return [...made.values()];
}

// hands: tag each vertex glove (0) / forearm (1) / upper arm (2) from its strongest bone
export function tagArmParts(mesh) {
  const bones = mesh.skeleton.bones;
  const kids = b => b.children.filter(c => c.isBone);
  // the palm: deepest bone with 3+ bone children (finger roots)
  let hand = null, best = -1;
  for (const b of bones) {
    if (kids(b).length < 3) continue;
    let d = 0, p = b; while (p.parent && p.parent.isBone) { d++; p = p.parent; }
    if (d > best) { best = d; hand = b; }
  }
  // everything past the wrist is glove (palm, fingers and the thumb / pinky chains that hang off
  // the forearm bone in some rigs); the forearm bone itself is sleeve; anything above it upper arm
  const part = new Map();
  if (hand) {
    const fore = hand.parent && hand.parent.isBone ? hand.parent : hand;
    fore.traverse(b => { if (b.isBone) part.set(b, 0); });
    if (fore !== hand) part.set(fore, 1);
  }
  const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = si.count;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let j = 0, w = -1;
    for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; j = si.getComponent(i, k); } }
    a[i] = part.has(bones[j]) ? part.get(bones[j]) : 2;
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(a, 1));
  return hand;
}

// turn a bone so its child points along a world direction (rest-pose posing without animations)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
export function aimBone(bone, child, dirWorld, k = 1) {
  bone.updateWorldMatrix(true, true);
  _a.setFromMatrixPosition(bone.matrixWorld); _b.setFromMatrixPosition(child.matrixWorld);
  const cur = _b.sub(_a).normalize();
  _q.setFromUnitVectors(cur, _a.copy(dirWorld).normalize());
  if (k !== 1) _q.slerp(new THREE.Quaternion(), 1 - k);
  bone.getWorldQuaternion(_wq);
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_q).multiply(_wq));
  bone.updateWorldMatrix(false, true);
}
export function findBone(root, re) { let f = null; root.traverse(o => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; }
