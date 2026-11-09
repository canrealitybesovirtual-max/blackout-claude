// The bottomless shaft: one merged mesh, one draw. Nothing below the baked top is lit for real:
// light falls off exponentially with depth from the level the bake left at the bottom of the
// real shaft, surfaces sink into black, and the red warning lamps (every 20 m) fade slower than
// the walls, so they recede long after the walls are gone. Real parallax, no texture tricks.
import * as THREE from 'three';
import { U, ABYSS_FRAG, ABYSS_VERT, makeHaloMaterial } from './shaders.js';
import { matDef } from '../config/materials.js';

function push(G, p, n, u, v, layer, tint, emit) {
  G.pos.push(p[0], p[1], p[2]); G.nrm.push(n[0], n[1], n[2]); G.uv.push(u, v); G.layer.push(layer);
  G.tint.push(Math.min(255, tint[0] * 127.5), Math.min(255, tint[1] * 127.5), Math.min(255, tint[2] * 127.5)); G.emit.push(emit);
  return G.n++;
}
// vertical cylinder (inward or outward), uv: around in metres, along = world y (lines up with the baked shaft)
function cyl(G, cx, cz, r, y0, y1, sides, seg, inward, matKey) {
  const m = matDef(matKey), sc = 1 / m.scale, L = Math.max(1, Math.ceil((y1 - y0) / seg)), base = G.n;
  for (let j = 0; j <= L; j++) for (let k = 0; k <= sides; k++) {
    const th = 2 * Math.PI * k / sides, ox = -Math.sin(th), oz = -Math.cos(th), y = y0 + (y1 - y0) * j / L, s = inward ? -1 : 1;
    push(G, [cx + ox * r, y, cz + oz * r], [ox * s, 0, oz * s], th * r * sc, y * sc, m.layer, m.tint, 0);
  }
  for (let j = 0; j < L; j++) for (let k = 0; k < sides; k++) {
    const a = base + j * (sides + 1) + k, b = a + 1, c = b + sides + 1, d = a + sides + 1;
    // outward winding is (a, b, c); inward reverses it
    if (inward) G.idx.push(a, c, b, a, d, c); else G.idx.push(a, b, c, a, c, d);
  }
}
function box(G, mn, mx, matKey, emit = 0, tint) {
  const m = matDef(matKey), t = tint || m.tint, sc = 1 / m.scale;
  const F = [[[1, 0, 0], [mx[0], mn[1], mx[2]], [0, 0, -(mx[2] - mn[2])], [0, mx[1] - mn[1], 0]],
    [[-1, 0, 0], [mn[0], mn[1], mn[2]], [0, 0, mx[2] - mn[2]], [0, mx[1] - mn[1], 0]],
    [[0, 0, 1], [mn[0], mn[1], mx[2]], [mx[0] - mn[0], 0, 0], [0, mx[1] - mn[1], 0]],
    [[0, 0, -1], [mx[0], mn[1], mn[2]], [-(mx[0] - mn[0]), 0, 0], [0, mx[1] - mn[1], 0]],
    [[0, 1, 0], [mn[0], mx[1], mx[2]], [mx[0] - mn[0], 0, 0], [0, 0, -(mx[2] - mn[2])]],
    [[0, -1, 0], [mn[0], mn[1], mn[2]], [mx[0] - mn[0], 0, 0], [0, 0, mx[2] - mn[2]]]];
  for (const [n, o, Uv, Vv] of F) {
    const b = G.n;
    for (const [s, t2] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = [o[0] + Uv[0] * s + Vv[0] * t2, o[1] + Uv[1] * s + Vv[1] * t2, o[2] + Uv[2] * s + Vv[2] * t2];
      push(G, p, n, (p[0] + p[2]) * sc, p[1] * sc, m.layer, t, emit);
    }
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

// a: zone.abyss { c, r, top, depth, sides, mat }; topLight: linear diffuse factor left at the top
export function buildAbyss(arrays, a, topLight) {
  const G = { pos: [], nrm: [], uv: [], layer: [], tint: [], emit: [], idx: [], n: 0 };
  const [cx, cz] = a.c, R = a.r, top = a.top, bot = top - a.depth;
  cyl(G, cx, cz, R, bot, top, a.sides, 2.0, true, a.mat);
  // the wall pipes carry on (they line up with the baked ones)
  cyl(G, -5.68, 58.6, 0.12, bot, top, 8, 4, false, 'steelGrey');
  cyl(G, -5.7, 60.05, 0.08, bot, top, 8, 4, false, 'pipeGreen');
  // ladder: rails all the way, rungs for the first 90 m (unreadable beyond)
  box(G, [5.8, bot, 59.03], [5.84, top, 59.07], 'steel');
  box(G, [5.8, bot, 59.53], [5.84, top, 59.57], 'steel');
  for (let y = top - 0.3; y > top - 90; y -= 0.3) box(G, [5.79, y, 59.07], [5.83, y + 0.025, 59.53], 'steel');
  // maintenance landings every 40 m (half rings of grating on brackets): strong depth cues
  for (let y = top - 18; y > bot + 10; y -= 40) {
    for (let k = 0; k < 10; k++) {
      const th = Math.PI * 0.15 + k * Math.PI * 0.07, x = cx + Math.cos(th) * (R - 0.55), z = cz + Math.sin(th) * (R - 0.55);
      box(G, [x - 0.36, y - 0.06, z - 0.36], [x + 0.36, y, z + 0.36], 'plate');
      box(G, [x - 0.03, y - 0.5, z - 0.03], [x + 0.03, y - 0.06, z + 0.03], 'steelDark');
    }
  }
  // warning lamps: 4 per level every 20 m, red, emissive (+ halo points below)
  const halos = [], LAMP_TOP = top - 6, LAMP_STEP = 20;
  for (let y = LAMP_TOP; y > bot + 4; y -= LAMP_STEP) for (const th of [0.4, 2.0, 3.6, 5.2]) {
    const x = cx + Math.cos(th) * (R - 0.12), z = cz + Math.sin(th) * (R - 0.12);
    box(G, [x - 0.1, y - 0.1, z - 0.1], [x + 0.1, y + 0.1, z + 0.1], 'diffuser', 9, [1, 0.12, 0.05]);
    halos.push(cx + Math.cos(th) * (R - 0.3), y, cz + Math.sin(th) * (R - 0.3));
  }
  // the floor nobody sees (black)
  const b0 = G.n;
  push(G, [cx, bot, cz], [0, 1, 0], 0, 0, 6, [0, 0, 0], 0);
  for (let k = 0; k <= a.sides; k++) { const th = 2 * Math.PI * k / a.sides; push(G, [cx - Math.sin(th) * R, bot, cz - Math.cos(th) * R], [0, 1, 0], 0, 0, 6, [0, 0, 0], 0); }
  for (let k = 0; k < a.sides; k++) G.idx.push(b0, b0 + 1 + k, b0 + 1 + k + 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
  g.setAttribute('aLayer', new THREE.BufferAttribute(new Uint8Array(G.layer), 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(new Uint8Array(G.tint), 3, true));
  g.setAttribute('aEmit', new THREE.Float32BufferAttribute(G.emit, 1));
  g.setIndex(G.n > 65535 ? new THREE.Uint32BufferAttribute(G.idx, 1) : new THREE.Uint16BufferAttribute(G.idx, 1));
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uAlb: { value: arrays.albedo }, uNrm: { value: arrays.normal }, uTop: { value: top },
      uTopLight: { value: new THREE.Vector3(...topLight) }, uFall: { value: 12 },
      uLampTop: { value: LAMP_TOP }, uLampStep: { value: LAMP_STEP }, uR: { value: R }, uC: { value: new THREE.Vector2(cx, cz) },
      uLampCol: { value: new THREE.Vector3(1.0, 0.12, 0.05).multiplyScalar(0.35) } },
    vertexShader: ABYSS_VERT, fragmentShader: ABYSS_FRAG,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.matrixAutoUpdate = false; mesh.name = 'abyss';
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(halos, 3));
  const halo = new THREE.Points(hg, makeHaloMaterial());
  halo.frustumCulled = false; halo.renderOrder = 3; halo.matrixAutoUpdate = false;
  mesh.add(halo);
  return mesh;
}
