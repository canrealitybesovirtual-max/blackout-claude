// Wall fire extinguisher (corridor), shaped after the user's photos: 6 kg stored-pressure ABC can, domed top,
// chrome valve with pressure gauge, carry handle and squeeze lever, pull pin ring, black hose down the left side to
// a horn nozzle clipped in the strap, wall bracket. Body texture: tools/prep_extinguisher.py (the photo's label side).
import * as THREE from 'three';
import { makeModelMaterial } from '../render/shaders.js';

const R = 0.078, HB = 0.40;                   // can radius, straight body height
const STRAP = HB * (1 - 0.627);               // the photo's strap row

function M(o) { return makeModelMaterial(new THREE.MeshStandardMaterial(o), { ownProbe: true }); }

export class Extinguisher {
  constructor(scene, pos, yaw) {
    const tex = new THREE.TextureLoader().load('textures/extinguisher.webp'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const body = M({ map: tex, roughness: 0.55, metalness: 0.15 }), paint = M({ color: 0x5a1210, roughness: 0.5, metalness: 0.15 });
    const chrome = M({ color: 0xc4c6c8, roughness: 0.22, metalness: 1 }), rubber = M({ color: 0x141414, roughness: 0.85, metalness: 0 });
    const black = M({ color: 0x1b1c1c, roughness: 0.5, metalness: 0.7 }), face = M({ color: 0xd8d4c8, roughness: 0.4, metalness: 0 });
    this.mats = [body, paint, chrome, rubber, black, face];
    const g = this.group = new THREE.Group(); g.position.set(...pos); g.rotation.y = yaw;   // local -z = front (label side)
    const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
    // can: rolled bottom rim, straight body (textured), shoulder dome, neck
    add(new THREE.LatheGeometry([[0.0, 0], [R - 0.012, 0], [R - 0.002, 0.006], [R, 0.016]].map(p => new THREE.Vector2(...p)), 32), paint);
    add(new THREE.CylinderGeometry(R, R, HB, 40, 1, true).translate(0, HB / 2 + 0.016, 0), body);
    const dome = []; for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; dome.push(new THREE.Vector2(Math.max(0.019, R * Math.cos(a)), HB + 0.016 + Math.sin(a) * 0.055)); }
    add(new THREE.LatheGeometry(dome, 32), paint);
    const top = HB + 0.016 + 0.055;
    add(new THREE.CylinderGeometry(0.02, 0.021, 0.028, 20), chrome, 0, top + 0.012);
    // valve head, gauge (facing front), carry handle and lever (to the right), pin and ring, hose port (left)
    add(new THREE.BoxGeometry(0.05, 0.034, 0.036), chrome, 0, top + 0.042);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 20).rotateX(Math.PI / 2), chrome, 0, top + 0.042, -0.024);
    add(new THREE.CircleGeometry(0.014, 20).rotateY(Math.PI), face, 0, top + 0.042, -0.0305);
    add(new THREE.BoxGeometry(0.003, 0.012, 0.001), black, 0.002, top + 0.044, -0.031, 0, 0, -0.7);   // needle in the green
    add(new THREE.BoxGeometry(0.13, 0.008, 0.024), chrome, 0.075, top + 0.03, 0, 0, 0, -0.06);       // carry handle
    add(new THREE.BoxGeometry(0.15, 0.008, 0.022), chrome, 0.07, top + 0.07, 0, 0, 0, 0.22);         // squeeze lever
    add(new THREE.CylinderGeometry(0.0025, 0.0025, 0.05, 6).rotateX(Math.PI / 2), chrome, 0.012, top + 0.05, 0);   // pin through the head
    add(new THREE.TorusGeometry(0.012, 0.0022, 6, 16), chrome, 0.012, top + 0.05, -0.034);              // pull ring
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.026, 10).rotateZ(Math.PI / 2), chrome, -0.035, top + 0.038);
    // hose: out of the head, round the shoulder and down the left side to the strap; horn nozzle below it
    const hp = [[-0.045, top + 0.038, 0], [-0.075, top + 0.03, 0], [-0.098, top - 0.02, 0.004], [-0.103, HB * 0.6, 0.006], [-0.104, STRAP + 0.05, 0.006]].map(p => new THREE.Vector3(...p));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), 40, 0.0085, 10), rubber);
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 12), chrome, -0.104, STRAP + 0.045, 0.006);      // ferrule
    add(new THREE.CylinderGeometry(0.012, 0.019, 0.1, 14), rubber, -0.104, STRAP - 0.02, 0.006);        // horn
    // strap round the can (holds the horn), wall bracket behind (band, back plate, hook at the neck)
    add(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.022, 40, 1, true), black, 0, STRAP + 0.016);
    add(new THREE.BoxGeometry(0.03, 0.022, 0.04), black, -0.09, STRAP + 0.016, 0.004);                    // horn clip
    add(new THREE.BoxGeometry(0.06, 0.34, 0.006), black, 0, 0.2, R + 0.012);
    add(new THREE.BoxGeometry(0.05, 0.012, 0.03), black, 0, top - 0.004, R + 0.0);                         // hook under the neck
    for (const o of g.children) { o.castShadow = false; }
    scene.add(g);
    this.center = [pos[0], pos[1] + 0.25, pos[2]];
  }
  probe(sample) {
    if (this.probed) return;
    const c = this.center, U0 = this.mats[0].uniforms;
    if (!sample(c[0] + 0.25, c[1], c[2], U0.uAmb.value, U0.uPrbPos.value, U0.uPrbCol.value, 8)) return;
    for (const m of this.mats.slice(1)) { m.uniforms.uAmb = U0.uAmb; m.uniforms.uPrbPos = U0.uPrbPos; m.uniforms.uPrbCol = U0.uPrbCol; }
    this.probed = true;
  }
}
