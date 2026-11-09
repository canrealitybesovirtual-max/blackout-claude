// Ceiling troffers: the user's photo of a lit grid diffuser (spine shadow of the tube between the cells) on every
// rectangular fixture, one instanced draw per zone. Each tube has its own age (slightly dimmer or warmer).
// A fixture marked flicker (not baked) is a failing tube: it stutters, drops out, restarts with a tick, and its
// light on the room is one of the dynamic lights while you are near it.
import * as THREE from 'three';
import { U } from '../render/shaders.js';

export class Fixtures {
  constructor(scene, sector, zm, audio) {
    this.zm = zm; this.audio = audio; this.groups = []; this.fail = [];
    const tex = new THREE.TextureLoader().load('textures/troffer.webp'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);          // faces down; u across, v along
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const z of sector.zones) {
      const F = z.fixtures; if (!F || !F.length) continue;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false });
      const im = new THREE.InstancedMesh(geo, mat, F.length); im.frustumCulled = false; im.visible = false;
      F.forEach((f, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.axis === 'x' ? Math.PI / 2 : 0);
        s.set(f.axis === 'x' ? f.hz * 2 : f.hx * 2, 1, f.axis === 'x' ? f.hx * 2 : f.hz * 2);
        p.set(f.c[0], f.c[1] - 0.0015, f.c[2]);
        im.setMatrixAt(i, m.compose(p, q, s));
        const age = 0.86 + rnd() * 0.14, warm = rnd() * 0.04;               // tubes age differently
        f.base = [Math.min(1, f.color[0] * age + warm), f.color[1] * age, Math.max(0, f.color[2] * age - warm)];
        im.setColorAt(i, f.on ? c.setRGB(...f.base) : c.setRGB(0.05, 0.05, 0.05));
        if (f.flicker) this.fail.push({ im, i, f, k: 1, t: 0, next: 1 + rnd() * 2, out: 0, pos: [f.c[0], f.c[1] - 0.05, f.c[2]] });
      });
      im.instanceColor.needsUpdate = true;
      scene.add(im); this.groups.push({ id: z.id, im });
    }
  }
  update(dt, camPos) {
    for (const g of this.groups) { const rz = this.zm.loaded.get(g.id); g.im.visible = !!(rz && rz.visible); }
    let n = U.uDynCount.value;
    for (const F of this.fail) {
      // a failing ballast: long good spells, then bursts of stutter, now and then out for a second and a restart
      F.t += dt;
      if (F.out > 0) { F.out -= dt; F.k = 0; if (F.out <= 0) { this.audio.play3D('click', F.pos, { gain: 0.25, maxDist: 12, rate: 1.8 }); F.burst = 0.5; } }
      else if (F.burst > 0) { F.burst -= dt; F.k = Math.random() < 0.45 ? 0.08 + Math.random() * 0.25 : 1; }
      else { F.k = 0.97 + Math.random() * 0.03; if ((F.next -= dt) <= 0) { F.next = 2.5 + Math.random() * 7; if (Math.random() < 0.3) F.out = 0.4 + Math.random() * 1.6; else F.burst = 0.15 + Math.random() * 0.9; } }
      const b = F.f.base, k = F.k; F.im.setColorAt(F.i, new THREE.Color(b[0] * k + 0.04, b[1] * k + 0.04, b[2] * k + 0.04)); F.im.instanceColor.needsUpdate = true;
      // its light on the room: a downward spot, only while near and visible
      const d = Math.hypot(camPos.x - F.f.c[0], camPos.y - F.f.c[1], camPos.z - F.f.c[2]);
      if (k > 0.02 && d < 22 && n < U.uDynPos.value.length && F.im.visible) {
        const P = F.f.power * 4 * F.f.hx * F.f.hz * 1.15 * k;
        U.uDynPos.value[n].set(F.f.c[0], F.f.c[1] - 0.02, F.f.c[2], 9);
        U.uDynCol.value[n].set(F.f.color[0] * P, F.f.color[1] * P, F.f.color[2] * P, 1);
        U.uDynDir.value[n].set(0, -1, 0, Math.cos(1.45)); n++;
      }
    }
    U.uDynCount.value = n;
  }
}
