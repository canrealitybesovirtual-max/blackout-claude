// Low-poly first-person weapons and hands. Each model is a handful of merged meshes
// (body, magazine, bolt/slide, left arm) sharing the dynamic uber-material: 4-5 draw calls.
import * as THREE from 'three';

const L = { polymer: 6, steel: 4, gunmetal: 8, brass: 9, diffuser: 10, fabric: 11, paintsteel: 3 };
const GLOVE = [0.42, 0.36, 0.27], SLEEVE = [0.29, 0.31, 0.23];

function tag(geo, layer, tint = [1, 1, 1], emit = 0, uvs = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  if (uvs !== 1) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvs, uv.getY(i) * uvs); }
  g.setAttribute('aLayer', new THREE.BufferAttribute(new Uint8Array(n).fill(layer), 1));
  const t = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { t[i * 3] = Math.min(255, tint[0] * 127.5); t[i * 3 + 1] = Math.min(255, tint[1] * 127.5); t[i * 3 + 2] = Math.min(255, tint[2] * 127.5); }
  g.setAttribute('aTint', new THREE.BufferAttribute(t, 3, true));
  g.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n).fill(emit), 1));
  return g;
}
function merge(parts) {
  const names = ['position', 'normal', 'uv', 'aLayer', 'aTint', 'aEmit'];
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const nm of names) {
    const a0 = parts[0].attributes[nm], arr = new a0.array.constructor(total * a0.itemSize);
    let o = 0; for (const g of parts) { arr.set(g.attributes[nm].array, o); o += g.attributes[nm].array.length; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  out.computeBoundingSphere();
  return out;
}
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return g; };
// inner wall of a tube (inverted winding so it is visible from inside)
const tubeIn = (r, len, x, y, z, seg = 12) => { const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true).toNonIndexed(); const P = g.attributes.position.array, N = g.attributes.normal.array; for (let i = 0; i < P.length; i += 9) for (let k = 0; k < 3; k++) { const a = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = a; const b = N[i + 3 + k]; N[i + 3 + k] = N[i + 6 + k]; N[i + 6 + k] = b; } for (let i = 0; i < N.length; i++) N[i] = -N[i]; const U2 = g.attributes.uv.array; for (let i = 0; i < U2.length; i += 6) for (let k = 0; k < 2; k++) { const a = U2[i + 2 + k]; U2[i + 2 + k] = U2[i + 4 + k]; U2[i + 4 + k] = a; } g.rotateX(Math.PI / 2); g.translate(x, y, z); return g; };
const cylZ = (r, len, x, y, z, seg = 10, open = false) => { const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g; };
function limb(a, b, r0, r1, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

function rightHandRifle(P) {
  P.push(tag(box(0.046, 0.085, 0.07, 0.0, -0.078, 0.064, 0.3), L.fabric, GLOVE));
  P.push(tag(box(0.05, 0.07, 0.026, 0.0, -0.083, 0.026, 0.3), L.fabric, GLOVE));
  P.push(tag(box(0.018, 0.018, 0.062, -0.023, -0.024, 0.04), L.fabric, GLOVE));
  P.push(tag(box(0.016, 0.016, 0.05, 0.02, -0.036, 0.0), L.fabric, GLOVE));
  P.push(tag(limb([0.015, -0.11, 0.1], [0.11, -0.27, 0.42], 0.034, 0.042), L.fabric, SLEEVE, 0, 2));
  P.push(tag(limb([0.006, -0.1, 0.085], [0.025, -0.13, 0.135], 0.036, 0.036), L.fabric, GLOVE));
}

export function buildRifle() {
  const B = [];
  const gm = (g, s = 2) => B.push(tag(g, L.gunmetal, [1, 1, 1], 0, s));
  gm(box(0.032, 0.05, 0.26, 0, 0.045, -0.03));                 // upper receiver
  gm(box(0.022, 0.008, 0.31, 0, 0.074, -0.065));               // top rail
  for (let i = 0; i < 22; i++) gm(box(0.025, 0.004, 0.006, 0, 0.08, 0.085 - i * 0.0142), 1);
  gm(box(0.03, 0.045, 0.2, 0, 0.0, 0.0));                      // lower receiver
  gm(box(0.033, 0.052, 0.072, 0, -0.035, -0.05));              // magwell
  gm(box(0.006, 0.006, 0.07, 0, -0.047, 0.02));                // trigger guard
  B.push(tag(box(0.004, 0.02, 0.006, 0, -0.03, 0.02, 0.2), L.steel));
  B.push(tag(box(0.029, 0.1, 0.038, 0, -0.072, 0.064, 0.32), L.polymer, [1, 1, 1], 0, 2)); // grip
  gm(cylZ(0.015, 0.18, 0, 0.032, 0.17));                        // buffer tube
  B.push(tag(box(0.04, 0.075, 0.14, 0, 0.018, 0.25), L.polymer, [1, 1, 1], 0, 2));  // stock
  B.push(tag(box(0.032, 0.022, 0.1, 0, 0.06, 0.245), L.polymer));
  B.push(tag(box(0.042, 0.11, 0.02, 0, 0.0, 0.325), L.polymer, [0.6, 0.6, 0.6]));    // butt pad
  gm(cylZ(0.023, 0.27, 0, 0.045, -0.295, 8));                   // free-float handguard
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) B.push(tag(box(0.002, 0.009, 0.03, s * 0.0215, 0.042, -0.2 - i * 0.055), L.polymer, [0.3, 0.3, 0.3]));
  gm(cylZ(0.0085, 0.13, 0, 0.045, -0.495));                     // barrel
  gm(cylZ(0.0115, 0.056, 0, 0.045, -0.585, 8));                 // flash hider
  gm(box(0.002, 0.018, 0.05, 0.0165, 0.045, -0.02));            // ejection port cover
  gm(box(0.012, 0.012, 0.012, 0.018, 0.035, 0.05));             // forward assist
  gm(box(0.03, 0.02, 0.046, 0, 0.088, -0.04));                  // optic mount
  gm(cylZ(0.019, 0.058, 0, 0.118, -0.04, 12, true));            // optic tube (open: see-through)
  gm(tubeIn(0.0175, 0.058, 0, 0.118, -0.04));                  // optic tube inside
  gm(cylZ(0.0215, 0.006, 0, 0.118, -0.068, 12, true));          // objective ring
  gm(tubeIn(0.0195, 0.006, 0, 0.118, -0.068));
  gm(box(0.012, 0.01, 0.012, 0.022, 0.118, -0.04));             // turret
  B.push(tag(cylZ(0.012, 0.08, 0.034, 0.045, -0.36), L.polymer)); // weapon light
  B.push(tag(cylZ(0.0108, 0.003, 0.034, 0.045, -0.401), L.diffuser, [1, 0.97, 0.9], -3));
  rightHandRifle(B);
  const mag = merge([
    tag(box(0.022, 0.07, 0.06, 0, -0.085, -0.052), L.polymer, [1.2, 1.2, 1.2], 0, 2),
    tag(box(0.022, 0.07, 0.058, 0, -0.148, -0.06, -0.14), L.polymer, [1.2, 1.2, 1.2], 0, 2),
    tag(box(0.022, 0.07, 0.056, 0, -0.208, -0.076, -0.28), L.polymer, [1.2, 1.2, 1.2], 0, 2),
    tag(box(0.026, 0.012, 0.064, 0, -0.245, -0.089, -0.28), L.polymer),
    tag(box(0.01, 0.006, 0.04, 0, -0.051, -0.052), L.brass),
  ]);
  const bolt = merge([tag(box(0.04, 0.01, 0.024, 0, 0.064, 0.092), L.gunmetal), tag(box(0.008, 0.01, 0.02, 0.022, 0.064, 0.098), L.gunmetal)]);
  const left = merge([
    tag(box(0.06, 0.026, 0.09, 0, 0.01, -0.3), L.fabric, GLOVE),
    tag(box(0.02, 0.042, 0.085, 0.027, 0.036, -0.3), L.fabric, GLOVE),
    tag(box(0.018, 0.018, 0.07, -0.024, 0.062, -0.315, 0, 0.15), L.fabric, GLOVE),
    tag(limb([-0.012, -0.004, -0.265], [-0.13, -0.24, 0.02], 0.031, 0.038), L.fabric, SLEEVE, 0, 2),
    tag(limb([-0.006, -0.002, -0.28], [-0.035, -0.04, -0.215], 0.034, 0.034), L.fabric, GLOVE),
  ]);
  return { body: merge(B), mag, bolt, left, muzzle: [0, 0.045, -0.615], sight: [0, 0.118, -0.04], eject: [0.03, 0.05, -0.02], light: [0.034, 0.045, -0.41], leftGrip: [0, 0.01, -0.3], magwell: [0, -0.06, -0.05] };
}

export function buildPistol() {
  const B = [];
  B.push(tag(box(0.03, 0.028, 0.17, 0, 0.0, -0.035), L.polymer, [1, 1, 1], 0, 2));      // frame
  B.push(tag(box(0.03, 0.11, 0.045, 0, -0.066, 0.025, 0.24), L.polymer, [1, 1, 1], 0, 2)); // grip
  B.push(tag(box(0.006, 0.006, 0.06, 0, -0.03, -0.01), L.polymer));                     // trigger guard
  B.push(tag(box(0.004, 0.018, 0.006, 0, -0.018, -0.01, 0.2), L.steel));
  // hands: two-handed grip
  B.push(tag(box(0.046, 0.08, 0.06, 0.003, -0.07, 0.03, 0.24), L.fabric, GLOVE));
  B.push(tag(box(0.05, 0.065, 0.025, 0.003, -0.075, -0.005, 0.24), L.fabric, GLOVE));
  B.push(tag(limb([0.015, -0.1, 0.06], [0.11, -0.27, 0.4], 0.034, 0.042), L.fabric, SLEEVE, 0, 2));
  B.push(tag(limb([0.006, -0.095, 0.05], [0.02, -0.12, 0.1], 0.035, 0.035), L.fabric, GLOVE));
  const mag = merge([tag(box(0.022, 0.1, 0.034, 0, -0.07, 0.03, 0.24), L.gunmetal), tag(box(0.027, 0.012, 0.042, 0, -0.123, 0.044, 0.24), L.polymer)]);
  const bolt = merge([
    tag(box(0.028, 0.03, 0.18, 0, 0.028, -0.045), L.gunmetal, [1, 1, 1], 0, 2),
    tag(box(0.004, 0.008, 0.004, 0, 0.047, -0.128), L.steel),
    tag(box(0.016, 0.008, 0.006, 0, 0.047, 0.04), L.gunmetal),
    tag(box(0.002, 0.016, 0.03, 0.0145, 0.03, -0.01), L.steel),
  ]);
  const left = merge([
    tag(box(0.05, 0.075, 0.06, -0.034, -0.075, 0.025, 0.24, 0, 0.15), L.fabric, GLOVE),
    tag(limb([-0.03, -0.1, 0.05], [-0.15, -0.27, 0.36], 0.033, 0.04), L.fabric, SLEEVE, 0, 2),
  ]);
  return { body: merge(B), mag, bolt, left, muzzle: [0, 0.028, -0.14], sight: [0, 0.051, 0.04], eject: [0.02, 0.035, -0.02], light: null, leftGrip: [-0.034, -0.075, 0.025], magwell: [0, -0.12, 0.04] };
}

// spent case for the shell pool
export function buildCasing(pistol = false) {
  return tag(new THREE.CylinderGeometry(0.0048, 0.0048, pistol ? 0.019 : 0.045, 6), L.brass);
}
