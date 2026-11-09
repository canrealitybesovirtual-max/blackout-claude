// BLACKSITE bootstrap + frame loop.
import * as THREE from 'three';
import { PROFILES, detectProfile } from './config/quality.js';
import { sectorB } from './world/level.js';
import { ZoneManager } from './world/zoneManager.js';
import { F_SHOOT } from './world/grid.js';
import { makeMaterialArrays, makeDecalAtlas, loadPhotoLayers, loadImage } from './render/textures.js';
import { U } from './render/shaders.js';
import { Input } from './core/input.js';
import { Perf } from './core/perf.js';
import { AudioEngine } from './audio/audio.js';
import { Player } from './game/player.js';
import { Effects } from './game/effects.js';
import { WeaponSystem, impactClass } from './game/weapon.js';
import { Hands } from './game/hands.js';
import { SlidingDoor, Targets } from './game/props.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const status = t => { $('loadtxt').textContent = t; };

async function boot() {
  const T0 = performance.now();
  const qid = detectProfile(), Q = PROFILES[qid];
  $('quality').value = qid;
  const canvas = $('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.msaa, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: params.has('shots') });
  } catch (e) { status('WebGL2 is not available on this device/browser.'); throw e; }
  renderer.autoClear = false; renderer.info.autoReset = false;
  renderer.toneMapping = THREE.NoToneMapping;
  const dpr = Math.min(devicePixelRatio || 1, Q.maxDpr);
  let scale = Q.scaleMax;
  const perf = new Perf(renderer, $('perf'));
  perf.notes.profile = `${Q.name} (${qid})`;

  status('Generating materials…');
  await new Promise(r => setTimeout(r, 0));
  let t = performance.now();
  const photos = await loadPhotoLayers(Q.tex);
  const arrays = makeMaterialArrays(Q.tex, Q.aniso, photos);
  perf.notes.photos = Object.keys(photos).join(', ') || 'none';
  const atlas = makeDecalAtlas(Q.decalScale, { vent: await loadImage('textures/vent.webp'), door_yellow: await loadImage('textures/door_yellow.webp') });
  perf.texBytes += arrays.bytes + atlas.bytes;
  perf.notes.materials = `${(performance.now() - t).toFixed(0)} ms (${Q.tex}px x13 layers)`;
  U.uGrain.value = Q.grain; U.uVignette.value = Q.vignette;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Q.fov, 1, 0.05, 120);
  scene.add(camera);
  const audio = new AudioEngine(Q);
  const sector = sectorB();
  const input = new Input(canvas, $('touch'));
  try { input.sens = +(localStorage.getItem('bs.sens') || 1); } catch (e) { /* storage blocked */ }
  $('sens').value = input.sens;

  let targets = null, door = null;
  const zm = new ZoneManager(sector, {
    scene, arrays, decalAtlas: atlas.texture, perf, audio, glows: Q.glows, onStatus: status,
    onZone: z => { toast(z.name); audio.setZone(z.reverb, z.ambience); U.uFogColor.value.setRGB(...z.fog); fogTarget = z.fogDensity; },
    onLoad: rz => { if (targets && rz.z.targets.length) targets.setZone(rz.id, rz.z.targets); },
    onUnload: id => { if (targets) targets.removeZone(id); },
  });
  zm.onGrid = () => { if (door) door.sync(); };
  status('Loading Sector B…');
  t = performance.now();
  await zm.init(p => status(`Loading Sector B… ${Math.round(p * 100)}%`));
  perf.notes.zones = `${(performance.now() - t).toFixed(0)} ms`;

  const z0 = sector.zones[0];
  const player = new Player(zm, audio, Q, z0.spawn);
  if (params.has('nointro')) player.intro = 1;
  const effects = new Effects(scene, Q, arrays, atlas.texture, zm, audio);
  targets = new Targets(scene, arrays, audio, effects);
  for (const rz of zm.loaded.values()) if (rz.z.targets.length) targets.setZone(rz.id, rz.z.targets);
  door = new SlidingDoor(sector.doors[0], scene, arrays, zm, audio);
  door.sync();
  let fogTarget = z0.fogDensity; U.uFogDensity.value = fogTarget; U.uFogColor.value.setRGB(...z0.fog);

  let muzzleT = 0; const muzzlePos = new THREE.Vector3();
  // guns stay off until the user's own GLB weapons go in (?guns=on = the placeholder set)
  const weapons = params.get('guns') === 'on' ? new WeaponSystem(arrays, {
    zm, player, effects, audio, targets,
    flashLight: p => { muzzlePos.copy(p); muzzleT = 0.06; },
    onShot: (o, d, w) => shoot(o, d, w),
  }) : new Hands(audio);

  // ---- hitscan ----
  function shoot(o, d) {
    const g = zm.grid;
    const tw = g.ray(o.x, o.y, o.z, d.x, d.y, d.z, 150, F_SHOOT, false);
    const th = targets.raycast(o, d, tw >= 0 ? tw : 150);
    if (th) { targets.hit(th, d); return; }
    if (tw < 0) return;
    const H = g.hit, p = [o.x + d.x * tw, o.y + d.y * tw, o.z + d.z * tw], n = [H.nx, H.ny, H.nz];
    const prim = H.prim, face = H.face;
    const cls = impactClass(zm, prim, face);
    audio.play3D('imp_' + cls, p, { gain: 0.9, maxDist: 35, send: 0.4, pri: 1 });
    if (cls === 'metal') { effects.spark(p, n, 10, 6); effects.puff(p, [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5], 1, 0.08, 0.12, 0.6); }
    else if (cls === 'concrete') { effects.spark(p, n, 3, 4); effects.puff(p, [n[0] * 0.9, n[1] * 0.9 + 0.1, n[2] * 0.9], 4, 0.16, 0.32, 1.6); }
    else effects.puff(p, [n[0] * 0.6, n[1] * 0.6, n[2] * 0.6], 3, 0.12, 0.25, 1.0);
    if (zm.prims.zone[prim] >= 0 && face >= 0 && zm.prims.type[prim] === 0) effects.hole(p, n, cls === 'metal', prim, face);
  }

  // ---- interaction ----
  const useTargets = [...sector.doors[0].panels.map(p => ({ pos: p.pos, r: 0.6 })), { pos: door.center, r: 1.1 }];
  function interactPrompt() {
    const c = camera.position, f = new THREE.Vector3(); camera.getWorldDirection(f);
    for (const u of useTargets) {
      const dx = u.pos[0] - c.x, dy = u.pos[1] - c.y, dz = u.pos[2] - c.z, d = Math.hypot(dx, dy, dz);
      if (d > 2.2) continue;
      const along = dx * f.x + dy * f.y + dz * f.z, perp = Math.sqrt(Math.max(0, d * d - along * along));
      if (along > 0 && perp < u.r) return door.target > 0.5 ? 'CLOSE DOOR' : 'OPEN DOOR';
    }
    return null;
  }

  // ---- light probe for moving objects (weapon, door, plates, cases) ----
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const amb = DIRS.map(() => new THREE.Vector3(0.05, 0.05, 0.05)), ambT = DIRS.map(() => new THREE.Vector3());
  const l3 = [0, 0, 0];
  let probeTick = 0;
  const { MATERIALS, LAYER_ALBEDO } = await import('./config/materials.js');
  const { MAT_KEYS } = await import('./world/build.js');
  function probe(dt) {
    const g = zm.grid; if (!g) return;
    const c = camera.position, py = c.y - 0.25;
    if ((probeTick++ % 3) === 0) {
      for (let i = 0; i < 6; i++) {
        const v = ambT[i].set(0, 0, 0);
        for (let s = 0; s < 3; s++) {
          let dx = DIRS[i][0] + (Math.random() - 0.5) * 0.9, dy = DIRS[i][1] + (Math.random() - 0.5) * 0.9, dz = DIRS[i][2] + (Math.random() - 0.5) * 0.9;
          const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
          const tt = g.ray(c.x, py, c.z, dx, dy, dz, 25, F_SHOOT, false);
          if (tt < 0) continue;
          const p = [c.x + dx * tt, py + dy * tt, c.z + dz * tt];
          zm.lightAtHit(g.hit.prim, g.hit.face, p, l3);
          const mk = MAT_KEYS[zm.matAtHit(g.hit.prim, g.hit.face)], md = MATERIALS[mk] || MATERIALS.floor, a = LAYER_ALBEDO[md.layer];
          v.x += l3[0] * a[0] * md.tint[0]; v.y += l3[1] * a[1] * md.tint[1]; v.z += l3[2] * a[2] * md.tint[2];
        }
        v.multiplyScalar(1 / 3);
      }
      // two strongest visible fixtures as soft point lights
      const best = [];
      for (const L of zm.lights) {
        const dx = L.c[0] - c.x, dy = L.c[1] - py, dz = L.c[2] - c.z, d2 = dx * dx + dy * dy + dz * dz;
        const I = (L.type === 'point' ? L.power * 0.25 : L.power * 4 * L.hx * L.hz) / Math.max(d2, 0.5);
        if ((dy <= 0 && L.type !== 'point') || I < 0.05) continue;
        best.push({ L, I, d: Math.sqrt(d2), dx, dy, dz });
      }
      best.sort((a, b) => b.I - a.I);
      let k = 0;
      for (const b of best) {
        if (k >= 2) break;
        if (g.ray(c.x, py, c.z, b.dx / b.d, b.dy / b.d, b.dz / b.d, b.d - 0.1, F_SHOOT, true)) continue;
        U.uPrbPos.value[k].set(b.L.c[0], b.L.c[1], b.L.c[2], 4 * b.L.hx * b.L.hz + 0.3);
        U.uPrbCol.value[k].set(...b.L.color).multiplyScalar(b.L.type === 'point' ? b.L.power * 0.25 : b.L.power * 4 * b.L.hx * b.L.hz);
        k++;
      }
      for (; k < 2; k++) U.uPrbCol.value[k].set(0, 0, 0);
    }
    const a = Math.min(1, dt * 8), avg = U.uAmbAvg.value.set(0, 0, 0);
    for (let i = 0; i < 6; i++) { amb[i].lerp(ambT[i], a); U.uAmb.value[i].copy(amb[i]); avg.add(amb[i]); }
    avg.multiplyScalar(1 / 6);
  }

  // ---- HUD ----
  let toastT = 0;
  function toast(txt) { $('toast').textContent = txt; $('toast').style.opacity = 1; toastT = 3.5; }
  function hud(dt) {
    const a = weapons.ammoText();
    $('ammo').style.display = a ? '' : 'none';
    if (a) {
    $('ammo').innerHTML = `<b>${a.inMag}</b><span>/ ${a.reserve}</span><i>${a.name} · ${a.mode}</i>`;
    $('ammo').classList.toggle('low', a.inMag <= Math.ceil(weapons.def.cap * 0.2));
    }
    $('xhair').style.opacity = weapons.ads > 0.3 || player.sprinting ? 0 : 0.85;
    const pr = interactPrompt();
    $('prompt').textContent = pr ? `[${input.device === 'pad' ? 'RB' : input.device === 'touch' ? 'USE' : 'E'}] ${pr}` : '';
    $('stam').style.opacity = player.stamina < 99 ? 1 : 0; $('stamfill').style.width = player.stamina + '%';
    if ((toastT -= dt) < 0) $('toast').style.opacity = 0;
    return pr;
  }

  // ---- sizing / dynamic resolution ----
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(dpr * scale); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    weapons.cam.aspect = w / h;
    const b = renderer.getDrawingBufferSize(new THREE.Vector2()); U.uRes.value.copy(b);
    perf.notes.res = `${b.x}x${b.y} (scale ${scale.toFixed(2)})`;
  }
  addEventListener('resize', resize); resize();
  let drAcc = 0, drFrames = 0, drMs = 0;
  function dynRes(dt, frameMs) {
    drAcc += dt; drFrames++; drMs += frameMs;
    if (drAcc < 1) return;
    const avg = Math.max(drMs / drFrames, perf.gpu > 0 ? perf.gpu : 0);
    drAcc = drFrames = drMs = 0;
    let ns = scale;
    if (avg > Q.targetMs * 1.08) ns = Math.max(Q.scaleMin, scale - 0.1);
    else if (avg < Q.targetMs * 0.7) ns = Math.min(Q.scaleMax, scale + 0.05);
    if (Math.abs(ns - scale) > 1e-3) { scale = ns; resize(); }
  }

  // ---- distant explosions: rumble, dust from the ceiling, a little shake ----
  audio.onBoom = () => {
    player.shake = Q.bob ? 1 : 0;
    const c = camera.position;
    for (let i = 0; i < 6; i++) effects.puff([c.x + (Math.random() - 0.5) * 4, 2.8, c.z + (Math.random() - 0.5) * 4], [0, -0.3, 0], 2, 0.25, 0.2, 3.5, 0.1);
  };

  // occlusion for 3D audio: sources in another zone behind the closed door are muffled
  audio.occlusion = (p) => {
    const L = audio.listener;
    const zs = zm.zoneAt({ x: p[0], y: p[1], z: p[2] }), zl = zm.zoneAt({ x: L.x, y: L.y, z: L.z });
    if (!zs || !zl || zs === zl) return 1;
    const thru = sector.doors.find(d => d.zones.includes(zs) && d.zones.includes(zl));
    if (thru) return 0.15 + 0.85 * zm.doorOpen[thru.id];
    return 0.6;
  };

  // ---- menu / pause ----
  let running = false;
  const menu = $('menu');
  async function start() {
    menu.classList.add('hide');
    await audio.init();
    perf.notes.audio = audio.sampleInfo || 'synth only';
    audio.setZone(zm.byId[zm.current].reverb, zm.byId[zm.current].ambience);
    input.enabled = true; running = true;
    if (!input.dragLook && !('ontouchstart' in window)) input.requestLock();
    last = performance.now();
  }
  function pause() { if (!running) return; running = false; input.enabled = false; menu.classList.remove('hide'); $('start').textContent = 'RESUME'; if (audio.ctx) audio.ctx.suspend(); }
  input.onUnlock = () => { if (!input.dragLook) pause(); };
  $('start').onclick = start;
  $('quality').onchange = e => { try { localStorage.setItem('bs.quality', e.target.value); } catch (x) { /* blocked */ } location.search = '?q=' + e.target.value; };
  $('sens').oninput = e => { input.sens = +e.target.value; try { localStorage.setItem('bs.sens', e.target.value); } catch (x) { /* blocked */ } };
  addEventListener('keydown', e => { if (e.code === 'Escape' && input.dragLook) pause(); });
  $('loading').classList.add('hide');
  perf.notes.boot = `${(performance.now() - T0).toFixed(0)} ms`;

  // ---- frame ----
  let last = performance.now();
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), lp = new THREE.Vector3(), ld = new THREE.Vector3();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; // rAF time can precede the start() stamp
    const c0 = performance.now();
    U.uTime.value = now / 1000;
    renderer.info.reset();
    if (running) {
      input.update(dt);
      if (input.has('perf')) { perf.visible = !perf.visible; $('perf').style.display = perf.visible ? 'block' : 'none'; }
      if (input.has('pause')) pause();
      let t1 = performance.now();
      player.update(dt, input, weapons.aiming);
      perf.time('player', performance.now() - t1);
      if (input.has('use') && interactPrompt()) door.toggle();
    }
    player.applyCamera(camera);
    camera.fov = Q.fov * (1 - weapons.ads * (1 - weapons.def.adsFov)); camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let t1 = performance.now();
    zm.update(camera);
    perf.time('zones', performance.now() - t1);
    door.update(dt, player.pos);
    targets.update(dt);
    if (running) weapons.update(dt, input, camera); else weapons.update(0, { held: {}, has: () => false }, camera);
    t1 = performance.now();
    effects.update(dt, camera.position);
    perf.time('fx', performance.now() - t1);
    t1 = performance.now();
    probe(dt);
    perf.time('probe', performance.now() - t1);
    U.uFogDensity.value += (fogTarget - U.uFogDensity.value) * Math.min(1, dt);

    // dynamic lights: rail flashlight + muzzle flash
    let n = 0;
    if (weapons.flashOn) {
      weapons.lightPose(lp, ld, camera);
      U.uDynPos.value[n].set(lp.x, lp.y, lp.z, 28); U.uDynCol.value[n].set(42, 40, 36, 1); U.uDynDir.value[n].set(ld.x, ld.y, ld.z, Math.cos(0.42)); n++;
    }
    muzzleT -= dt;
    if (muzzleT > 0) { const k = muzzleT / 0.06; U.uDynPos.value[n].set(muzzlePos.x, muzzlePos.y, muzzlePos.z, 9); U.uDynCol.value[n].set(30 * k, 17 * k, 7 * k, 0); n++; }
    U.uDynCount.value = n;

    camera.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    audio.setListener(camera.position, fwd, up);
    audio.update(dt, running ? player.fatigue : 0);
    const cpu = performance.now() - c0;

    perf.beginGPU();
    renderer.setRenderTarget(null);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    if (weapons.scene) { renderer.clearDepth(); renderer.render(weapons.scene, weapons.cam); }
    perf.endGPU();
    const total = performance.now() - c0;
    perf.time('render', total - cpu);
    perf.frame(dt * 1000, total);
    perf.draw(dt);
    hud(dt);
    dynRes(dt, total);
    input.endFrame();
  }
  requestAnimationFrame(frame);

  // test / debug hooks
  window.__bs = { perf, player, zm, weapons, door, camera, input, renderer, start, Q, ready: true,
    snap: () => perf.snapshot(),
    tp: (x, y, z, yaw, pitch = 0) => { player.pos.set(x, y, z); player.vel.set(0, 0, 0); player.yaw = yaw; player.pitch = pitch; } };
  if (params.has('autostart')) start();
}

boot().catch(e => { console.error(e); status('Error: ' + (e && e.message || e)); });
