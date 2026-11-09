// Wall electrical panel (corridor): the user's door and breaker photos, rusted and grimed (tools/prep_panel.py).
// The steel housing is baked with the room; the frame, the hinged door and the breaker plate are lit by their own
// light probes. E / X / VR trigger opens it (door swings out on its left hinges) and shuts it.
import * as THREE from 'three';
import { makeModelMaterial } from '../render/shaders.js';

import { PANEL, PANEL_DOOR, yAt } from '../config/panel.js';

const loader = new THREE.TextureLoader();
function tex(url, srgb) {
  const t = loader.load(url); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; return t;
}
function mat(name, o = {}) {
  return makeModelMaterial(new THREE.MeshStandardMaterial({ map: tex(`textures/${name}.webp`, true), roughnessMap: tex(`textures/${name}_orm.webp`, false), roughness: 1, metalness: 1, ...o }), { ownProbe: true });
}
// a quad facing +x spanning z [za, zb] (zb < za), y [ya, yb], uv from the photo's normalised u, v
function quad(x, za, zb, ya, yb, u0, u1, v0, v1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x, ya, za, x, ya, zb, x, yb, zb, x, yb, za], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 1 - v1, u1, 1 - v1, u1, 1 - v0, u0, 1 - v0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
function merge(list) {
  const out = new THREE.BufferGeometry(), idx = []; let base = 0;
  for (const nm of ['position', 'normal', 'uv']) out.setAttribute(nm, new THREE.Float32BufferAttribute(list.flatMap(g => [...g.attributes[nm].array]), nm === 'uv' ? 2 : 3));
  for (const g of list) { for (const i of g.index.array) idx.push(i + base); base += g.attributes.position.count; }
  out.setIndex(idx); out.computeBoundingSphere(); return out;
}

export class ElectricPanel {
  constructor(scene, audio) {
    this.audio = audio; this.open = 0; this.target = 0; this.vel = 0; this.probed = 0;
    const P = PANEL, D = PANEL_DOOR, [u0, u1] = P.du, [v0, v1] = P.dv, fx = P.x + 0.002;
    // frame ring round the door opening (the photo's outer border, screws and hinge leaves)
    const front = mat('panel_door');
    const ring = merge([
      quad(fx, P.z1, P.z0, yAt(v0), P.y1, 0, 1, 0, v0), quad(fx, P.z1, P.z0, P.y0, yAt(v1), 0, 1, v1, 1),
      quad(fx, P.z1, D.zh, D.ya, D.yb, 0, u0, v0, v1), quad(fx, D.z2, P.z0, D.ya, D.yb, u1, 1, v0, v1),
    ]);
    this.ring = new THREE.Mesh(ring, front); scene.add(this.ring);
    // breaker plate at the back
    this.inside = mat('panel_inside', { metalness: 0.8 });
    this.plate = new THREE.Mesh(quad(P.back + 0.012, D.zh, D.z2, D.ya, D.yb, 0, 1, 0, 1), this.inside); scene.add(this.plate);
    // the door: the photo's door face, a 1.5 mm steel skin behind it with a folded edge, on a hinge at its left (+z) edge
    const dw = D.zh - D.z2, dh = D.yb - D.ya;
    this.hinge = new THREE.Group(); this.hinge.position.set(P.x, (D.ya + D.yb) / 2, D.zh); scene.add(this.hinge);
    const face = new THREE.Mesh(quad(0.0015, 0, -dw, -dh / 2, dh / 2, u0, u1, v0, v1), front);
    const skinMat = makeModelMaterial(new THREE.MeshStandardMaterial({ color: 0x6d6f6c, roughness: 0.55, metalness: 0.8 }), { ownProbe: true });
    const skin = new THREE.Mesh(new THREE.BoxGeometry(0.018, dh, dw), skinMat); skin.position.set(-0.008, 0, -dw / 2);
    this.hinge.add(face, skin);
    this.mats = [front, this.inside, skinMat];
    this.center = [P.x, (D.ya + D.yb) / 2, (D.zh + D.z2) / 2];
  }
  toggle() {
    this.target = this.target > 0.5 ? 0 : 1;
    if (this.target) { this.audio.play3D('click', this.center, { gain: 0.5, maxDist: 10, rate: 0.8 }); this.audio.play3D('panelOpen', this.center, { gain: 0.45, maxDist: 14, rate: 1.55 + Math.random() * 0.1 }); }
  }
  // own light probes: the face from just in front, the breakers from inside the box (sampleProbe from main.js)
  probe(sample) {
    if (this.probed > 0) return;
    const c = this.center;
    const ok = sample(c[0] + 0.25, c[1], c[2], this.mats[0].uniforms.uAmb.value, this.mats[0].uniforms.uPrbPos.value, this.mats[0].uniforms.uPrbCol.value, 8);
    if (!ok) return;
    sample(c[0] + 0.25, c[1], c[2], this.mats[2].uniforms.uAmb.value, this.mats[2].uniforms.uPrbPos.value, this.mats[2].uniforms.uPrbCol.value, 8);
    sample(PANEL.back + 0.08, c[1], c[2], this.inside.uniforms.uAmb.value, this.inside.uniforms.uPrbPos.value, this.inside.uniforms.uPrbCol.value, 8);
    this.probed = 1;
  }
  update(dt) {
    // a light steel door on two hinges: swings open with a little bounce at the stop, shuts with a slam
    const prev = this.open, k = this.target ? 26 : 34, c = this.target ? 7 : 9;
    this.vel += ((this.target - this.open) * k - this.vel * c) * dt;
    this.open += this.vel * dt;
    if (this.open > 1.04) { this.open = 1.04; this.vel = -Math.abs(this.vel) * 0.25; }
    if (this.open < 0) {
      this.open = 0;
      if (this.vel < -0.4) { this.audio.play3D('doorStop', this.center, { gain: Math.min(0.55, -this.vel * 0.18), maxDist: 16, rate: 1.75 + Math.random() * 0.1 }); this.audio.play3D('click', this.center, { gain: 0.4, maxDist: 8, rate: 0.7 }); }
      this.vel = 0;
    }
    if (this.open !== prev) this.hinge.rotation.y = -1.85 * this.open;
  }
}
