// Procedural audio: every sound is synthesised at load (no downloads), played through a
// fixed voice pool, positioned with HRTF/equal-power panners, filtered for distance and
// occlusion, and sent to a per-zone convolution reverb generated from room acoustics.
const TAU = Math.PI * 2;

function mkRng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; }; }
function lp(x, fc, sr) { const a = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; } return x; }
function hp(x, fc, sr) { const a = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = x[i] - y; } return x; }
function bp(x, f, q, sr) { // RBJ band-pass (constant 0 dB peak)
  const w = TAU * f / sr, al = Math.sin(w) / (2 * q), cs = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i]; const y = (b0 * xi + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
function noise(n, seed) { const r = mkRng(seed), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r(); return a; }

export class AudioEngine {
  constructor(profile) {
    this.profile = profile; this.ctx = null; this.ready = false;
    this.listener = { x: 0, y: 0, z: 0 };
    this.occlusion = () => 1; // set by the game: 1 = clear, 0 = fully occluded
    this.loops = {}; this.emitters = []; this.ambKind = null; this.revKind = null;
    this.nextBoom = 70; this.onBoom = null; this.breathGain = 0;
  }
  async init() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.sr = ctx.sampleRate;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.7; this.amb.connect(this.master);
    // two convolvers for crossfading between room acoustics
    this.send = ctx.createGain();
    this.rev = [0, 1].map(() => { const c = ctx.createConvolver(), g = ctx.createGain(); g.gain.value = 0; this.send.connect(c); c.connect(g); g.connect(this.master); return { c, g, kind: null }; });
    this.revIdx = 0;
    this._synth();
    await this._samples();
    // voice pools
    this.v2 = Array.from({ length: 6 }, () => this._voice(false));
    this.v3 = Array.from({ length: this.profile.voices }, () => this._voice(true));
    this.ready = true;
    this.breath = this._loop('breath', this.master, 0);
    if (ctx.state !== 'running') await ctx.resume();
  }
  _voice(spatial) {
    const ctx = this.ctx, f = ctx.createBiquadFilter(), g = ctx.createGain(), s = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 20000; f.Q.value = 0.5;
    let out = g;
    if (spatial) {
      const p = ctx.createPanner();
      p.panningModel = this.profile.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 1.1; p.maxDistance = 60;
      g.connect(p); p.connect(this.sfx); out = p; this._pan = true;
      f.connect(g); g.connect(s); s.connect(this.send);
      return { f, g, s, p, src: null, end: 0, pri: 0 };
    }
    f.connect(g); g.connect(this.sfx); g.connect(s); s.connect(this.send);
    return { f, g, s, p: null, src: null, end: 0, pri: 0, out };
  }
  _pick(pool, pri) {
    const t = this.ctx.currentTime;
    let best = null;
    for (const v of pool) if (v.end <= t) return v;
    for (const v of pool) if (v.pri <= pri && (!best || v.end < best.end)) best = v;
    return best;
  }
  _start(v, name, gain, rate, send, pri) {
    const list = this.buf[name]; if (!list) return null;
    const b = list[(Math.random() * list.length) | 0];
    if (v.src) { try { v.src.stop(); } catch (e) { /* already stopped */ } }
    const src = this.ctx.createBufferSource();
    src.buffer = b; src.playbackRate.value = rate;
    src.connect(v.f);
    v.g.gain.value = gain; v.s.gain.value = send;
    src.start();
    v.src = src; v.end = this.ctx.currentTime + b.duration / rate; v.pri = pri;
    return v;
  }
  play2D(name, o = {}) {
    if (!this.ready) return;
    const v = this._pick(this.v2, o.pri ?? 1); if (!v) return;
    v.f.frequency.value = o.lp ?? 20000;
    this._start(v, name, o.gain ?? 1, o.rate ?? (0.97 + Math.random() * 0.06), o.send ?? 0.15, o.pri ?? 1);
  }
  play3D(name, pos, o = {}) {
    if (!this.ready) return;
    const L = this.listener, d = Math.hypot(pos[0] - L.x, pos[1] - L.y, pos[2] - L.z);
    if (d > (o.maxDist ?? 40)) return;           // culled: inaudible
    const v = this._pick(this.v3, o.pri ?? 1); if (!v) return;
    const occ = this.occlusion(pos);
    const p = v.p;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
    // air absorption + occlusion as one low-pass
    v.f.frequency.value = Math.max(300, 18000 * Math.exp(-d / 45) * (0.06 + 0.94 * occ * occ));
    this._start(v, name, (o.gain ?? 1) * (0.35 + 0.65 * occ), o.rate ?? (0.95 + Math.random() * 0.1), (o.send ?? 0.3) * (0.5 + 0.5 * occ), o.pri ?? 1);
  }
  setListener(pos, fwd, up) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    if (!this.ready) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.01); l.positionY.setTargetAtTime(pos.y, t, 0.01); l.positionZ.setTargetAtTime(pos.z, t, 0.01);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.01); l.forwardY.setTargetAtTime(fwd.y, t, 0.01); l.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      l.upX.setTargetAtTime(up.x, t, 0.01); l.upY.setTargetAtTime(up.y, t, 0.01); l.upZ.setTargetAtTime(up.z, t, 0.01);
    } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  // room acoustics + ambience bed for the zone the player is in
  setZone(reverb, ambience) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (reverb !== this.revKind) {
      this.revKind = reverb;
      const cur = this.rev[this.revIdx], nxt = this.rev[1 - this.revIdx];
      if (nxt.kind !== reverb) { nxt.c.buffer = this.ir[reverb]; nxt.kind = reverb; }
      cur.g.gain.setTargetAtTime(0, t, 0.4); nxt.g.gain.setTargetAtTime(0.8, t, 0.4);
      this.revIdx = 1 - this.revIdx;
    }
    if (ambience !== this.ambKind) {
      this.ambKind = ambience;
      for (const k in this.loops) this.loops[k].g.gain.setTargetAtTime(0, t, 0.8);
      if (!this.loops[ambience]) this.loops[ambience] = this._loop(ambience, this.amb, 0);
      this.loops[ambience].g.gain.setTargetAtTime(ambience === 'silo' ? 0.75 : ambience === 'tunnel' ? 0.55 : 0.4, t, 0.8);
    }
  }
  _loop(name, dest, gain, pos) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = this.buf[name][0]; src.loop = true;
    g.gain.value = gain;
    src.connect(g);
    let p = null;
    if (pos) {
      p = ctx.createPanner(); p.panningModel = this.profile.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 1.4;
      if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(...pos);
      g.connect(p); p.connect(dest);
    } else g.connect(dest);
    src.start(0, Math.random() * src.buffer.duration);
    return { src, g, p };
  }
  // positional emitters belong to loaded zones only (streamed with them)
  addEmitters(zoneId, list) {
    if (!this.ready) { this._pendingEm = (this._pendingEm || []).concat(list.map(e => ({ ...e, zoneId }))); return; }
    for (const e of list) {
      const em = { ...e, zoneId, next: 1 + Math.random() * 3 };
      if (e.kind !== 'drip' && e.kind !== 'groan') em.loop = this._loop(e.kind, this.sfx, e.gain, e.pos);
      this.emitters.push(em);
    }
  }
  removeEmitters(zoneId) {
    this.emitters = this.emitters.filter(e => {
      if (e.zoneId !== zoneId) return true;
      if (e.loop) { try { e.loop.src.stop(); } catch (x) { /* noop */ } e.loop.g.disconnect(); }
      return false;
    });
  }
  update(dt, fatigue) {
    if (!this.ready) return;
    if (this._pendingEm) { const p = this._pendingEm; this._pendingEm = null; const by = {}; for (const e of p) (by[e.zoneId] = by[e.zoneId] || []).push(e); for (const k in by) this.addEmitters(k, by[k]); }
    const t = this.ctx.currentTime;
    for (const e of this.emitters) {
      if (e.loop) { e.loop.g.gain.setTargetAtTime(e.gain * (0.3 + 0.7 * this.occlusion(e.pos)), t, 0.2); continue; }
      e.next -= dt;
      if (e.next <= 0) {
        if (e.kind === 'groan') { e.next = 9 + Math.random() * 16; this.play3D('groan', e.pos, { gain: e.gain, maxDist: 160, send: 0.9, pri: 0, rate: 0.85 + Math.random() * 0.3 }); }
        else { e.next = 1.2 + Math.random() * 4; this.play3D('drip', e.pos, { gain: e.gain, maxDist: 40, send: 0.6, pri: 0 }); }
      }
    }
    this.breath.g.gain.setTargetAtTime(fatigue * 0.35, t, 0.5);
    this.nextBoom -= dt;
    if (this.nextBoom <= 0) { this.nextBoom = 55 + Math.random() * 70; this.play2D('boom', { gain: 0.9, send: 0.5, pri: 2, lp: 380, rate: 0.75 + Math.random() * 0.15 }); if (this.onBoom) this.onBoom(); } // far away: only the low end survives
  }

  // recorded samples replace synthesized ones when they load (synth stays as offline fallback)
  async _samples() {
    const n = (base, k) => Array.from({ length: k }, (_, i) => `${base}${i + 1}`);
    const M = {
      rifle: n('ak', 5), pistol: ['pistol1'], dry: n('dry', 4),
      magout_r: n('akMagOut', 3), magin_r: ['akMagIn1'], bolt_r: n('akRackFwd', 2),
      magout_p: n('glkMagOut', 2), magin_p: n('glkMagIn', 2), bolt_p: ['glkSlideRel'],
      casing_r: n('brassM', 8), casing_p: n('brassS', 5), cloth: n('cloth', 7),
      doorStop: n('doorShut', 3), hvac: ['ambServer'], breath: ['breaths'], boom: n('nadeBoom', 2), magdrop: n('magDrop', 3),
    };
    const t0 = performance.now(), dec = {};
    const load = async f => { try { const r = await fetch(`sounds/${f}.mp3`); if (!r.ok) return null; return await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { return null; } };
    const files = [...new Set(Object.values(M).flat())];
    const all = Promise.all(files.map(async f => { dec[f] = await load(f); }));
    await Promise.race([all, new Promise(r => setTimeout(r, 5000))]);
    let used = 0;
    for (const k in M) { const list = M[k].map(f => dec[f]).filter(Boolean); if (list.length) { this.buf[k] = list; used += list.length; } }
    this.sampleInfo = `${used}/${files.length} samples, ${(performance.now() - t0).toFixed(0)} ms`;
  }

  // ------------------------------------------------------------------ synthesis
  _synth() {
    const sr = this.sr, ctx = this.ctx;
    const B = this.buf = {};
    const mk = (secs, fn, ch = 1) => { const n = Math.ceil(secs * sr), b = ctx.createBuffer(ch, n, sr); for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); fn(d, n, c); } return b; };
    const env = (t, a, d) => (1 - Math.exp(-t / Math.max(a, 1e-5))) * Math.exp(-t / d);
    const add = (out, src, at, g) => { const o = Math.round(at * sr); for (let i = 0; i < src.length && o + i < out.length; i++) out[o + i] += src[i] * g; };
    const shaped = (n, seed, f, q, a, d, kind = 'bp') => { const x = noise(n, seed); if (kind === 'bp') bp(x, f, q, sr); else if (kind === 'lp') lp(x, f, sr); else hp(x, f, sr); for (let i = 0; i < n; i++) x[i] *= env(i / sr, a, d); return x; };
    const sine = (n, f0, f1, d, ph = 0) => { const x = new Float32Array(n); let p = ph; for (let i = 0; i < n; i++) { const t = i / sr; const f = f1 + (f0 - f1) * Math.exp(-t / 0.03); p += TAU * f / sr; x[i] = Math.sin(p) * Math.exp(-t / d); } return x; };
    const modes = (n, fr, taus, amps) => { const x = new Float32Array(n); for (let k = 0; k < fr.length; k++) for (let i = 0; i < n; i++) { const t = i / sr; x[i] += Math.sin(TAU * fr[k] * t + k) * amps[k] * Math.exp(-t / taus[k]); } return x; };
    const norm = (d, peak = 0.95) => { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; return d; };
    const sat = (d, k) => { const tk = Math.tanh(k); for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * k) / tk; return d; };
    const fadeLoop = (d, n) => { const x = Math.floor(n * 0.1); for (let i = 0; i < x; i++) { const a = i / x; d[i] = d[i] * a + d[n - x + i] * (1 - a); } return d.subarray(0, n - x); };
    const loopBuf = (secs, fn) => { const n = Math.ceil(secs * sr * 1.1), tmp = new Float32Array(n); fn(tmp, n); const d = fadeLoop(tmp, n); const b = ctx.createBuffer(1, d.length, sr); b.getChannelData(0).set(d); return b; };

    const shot = (seed, heavy) => mk(0.55, (d, n) => {
      const crack = Math.round(0.0007 * sr);
      for (let i = 0; i < crack; i++) d[i] += (1 - 2 * i / crack) * 1.2;
      add(d, shaped(n, seed, heavy ? 3200 : 4200, 0, 0.0003, heavy ? 0.024 : 0.016, 'lp'), 0, 1.6);
      add(d, sine(n, heavy ? 120 : 160, heavy ? 48 : 70, heavy ? 0.07 : 0.045), 0, heavy ? 1.1 : 0.7);
      add(d, shaped(n, seed + 1, 1100, 1.5, 0.001, 0.05), 0, 0.5);
      add(d, shaped(Math.round(0.03 * sr), seed + 2, 4500, 3, 0.0003, 0.004), heavy ? 0.026 : 0.018, 0.35);
      add(d, shaped(Math.round(0.05 * sr), seed + 3, 2600, 4, 0.0003, 0.008), heavy ? 0.072 : 0.05, 0.22);
      hp(d, 35, sr); sat(d, 2.2); norm(d);
    });
    B.rifle = [1, 2, 3, 4].map(s => shot(s * 11, true));
    B.pistol = [1, 2, 3].map(s => shot(s * 17 + 5, false));
    B.dry = [mk(0.06, d => { add(d, shaped(d.length, 31, 3200, 3, 0.0002, 0.003), 0, 1); add(d, shaped(d.length, 32, 2400, 3, 0.0002, 0.004), 0.009, 0.6); norm(d, 0.5); })];
    B.magout = [mk(0.25, d => { add(d, shaped(d.length, 41, 2600, 4, 0.0002, 0.005), 0, 1); add(d, shaped(d.length, 42, 3000, 1, 0.01, 0.05), 0.015, 0.45); norm(d, 0.55); })];
    B.magin = [mk(0.3, d => { add(d, shaped(d.length, 51, 2800, 1, 0.03, 0.03), 0, 0.3); add(d, shaped(d.length, 52, 2000, 4, 0.0002, 0.006), 0.07, 1); add(d, shaped(d.length, 53, 3600, 5, 0.0002, 0.004), 0.085, 0.8); add(d, sine(d.length, 180, 140, 0.015), 0.07, 0.5); norm(d, 0.65); })];
    B.bolt = [mk(0.35, d => { add(d, shaped(d.length, 61, 3000, 4, 0.0002, 0.005), 0, 1); add(d, modes(d.length, [2600, 4100], [0.03, 0.02], [0.3, 0.2]), 0, 1); add(d, shaped(d.length, 62, 1800, 2, 0.003, 0.03), 0.06, 0.5); add(d, shaped(d.length, 63, 2400, 5, 0.0002, 0.006), 0.12, 1.1); add(d, sine(d.length, 220, 150, 0.02), 0.12, 0.5); norm(d, 0.7); })];
    B.cloth = [mk(0.45, d => { add(d, shaped(d.length, 71, 1400, 0, 0.08, 0.12, 'lp'), 0, 1); add(d, shaped(d.length, 72, 2500, 3, 0.0003, 0.005), 0.3, 0.4); norm(d, 0.35); })];
    const step = (seed, kind) => mk(0.22, d => {
      const n = d.length;
      add(d, shaped(n, seed, kind === 'metal' ? 1400 : 900, 0.7, 0.001, 0.022), 0, 1);
      add(d, sine(n, 110, 70, 0.025), 0, 0.7);
      add(d, shaped(n, seed + 1, 2200, 0.8, 0.002, 0.014), 0.05 + (seed % 3) * 0.008, 0.45);
      if (kind === 'metal') add(d, modes(n, [380, 950, 1720, 2600], [0.07, 0.05, 0.04, 0.03], [0.25, 0.3, 0.2, 0.1]), 0, 1);
      if (kind === 'wood') add(d, modes(n, [190, 520], [0.03, 0.02], [0.4, 0.2]), 0, 1);
      const r = mkRng(seed + 9); for (let i = 0; i < 18; i++) { const at = 0.01 + Math.abs(r()) * 0.09, k = Math.round(at * sr); if (k < n) d[k] += r() * 0.15; }
      norm(d, 0.5);
    });
    for (const k of ['concrete', 'metal', 'wood']) B['step_' + k] = [1, 2, 3, 4, 5].map(s => step(s * 13 + k.length, k));
    B.land = [mk(0.3, d => { add(d, shaped(d.length, 81, 700, 0.6, 0.002, 0.04), 0, 1); add(d, sine(d.length, 90, 55, 0.05), 0, 1); add(d, shaped(d.length, 82, 1500, 1, 0.01, 0.06), 0.03, 0.3); norm(d, 0.7); })];
    B.imp_concrete = [1, 2, 3].map(s => mk(0.4, d => { const n = d.length; add(d, shaped(n, s, 3000, 0, 0.0002, 0.003, 'hp'), 0, 1); add(d, shaped(n, s + 1, 1500, 1, 0.0005, 0.02), 0, 0.8); const r = mkRng(s * 7); for (let i = 0; i < 60; i++) { const at = Math.abs(r()) * 0.3, k = Math.round(at * sr); const g = Math.exp(-at / 0.08) * 0.3; for (let j = 0; j < 30 && k + j < n; j++) d[k + j] += r() * g * Math.exp(-j / 6); } norm(d, 0.8); }));
    B.imp_metal = [1, 2, 3].map(s => mk(0.5, d => { add(d, shaped(d.length, s + 20, 4000, 2, 0.0002, 0.003), 0, 1); add(d, modes(d.length, [2100 + s * 130, 3400 + s * 90, 5200], [0.18, 0.12, 0.08], [0.5, 0.35, 0.2]), 0, 1); norm(d, 0.8); }));
    B.imp_soft = [mk(0.2, d => { add(d, shaped(d.length, 91, 450, 1, 0.001, 0.02), 0, 1); add(d, sine(d.length, 120, 80, 0.02), 0, 0.5); norm(d, 0.6); })];
    B.imp_wood = [mk(0.25, d => { add(d, shaped(d.length, 92, 900, 1, 0.0005, 0.02), 0, 1); add(d, modes(d.length, [420, 980], [0.04, 0.03], [0.4, 0.25]), 0, 1); norm(d, 0.7); })];
    B.ring = [540, 600].map(f => mk(1.6, d => { add(d, shaped(d.length, 101, 3000, 1, 0.0002, 0.004), 0, 0.6); add(d, modes(d.length, [f, f * 2.32, f * 4.25, f * 6.63, f * 1.007], [1.3, 0.75, 0.42, 0.25, 1.2], [1, 0.55, 0.32, 0.18, 0.5]), 0, 1); norm(d, 0.85); }));
    B.casing = [1, 2, 3].map(s => mk(0.4, d => { const m = modes(Math.round(0.06 * sr), [4700 + s * 211, 7300 + s * 97, 9900], [0.05, 0.035, 0.025], [0.5, 0.35, 0.2]); add(d, m, 0, 1); add(d, m, 0.11 + s * 0.01, 0.45); add(d, m, 0.19 + s * 0.015, 0.2); norm(d, 0.4); }));
    B.doorStart = [mk(0.6, d => { add(d, sine(d.length, 70, 45, 0.1), 0, 1); add(d, shaped(d.length, 111, 1100, 4, 0.0005, 0.07), 0, 0.6); add(d, shaped(d.length, 112, 600, 1, 0.001, 0.12), 0.02, 0.4); norm(d, 0.8); })];
    B.doorStop = [mk(0.9, d => { add(d, sine(d.length, 60, 38, 0.16), 0, 1.2); add(d, shaped(d.length, 113, 900, 3, 0.0005, 0.1), 0, 0.8); add(d, modes(d.length, [310, 720, 1260], [0.3, 0.2, 0.12], [0.3, 0.2, 0.12]), 0, 1); norm(d, 0.95); })];
    B.doorLoop = [loopBuf(1.0, (d, n) => { for (let i = 0; i < n; i++) { const t = i / sr; d[i] = 0.35 * Math.sin(TAU * 100 * t) + 0.18 * Math.sin(TAU * 200 * t + 1) + 0.1 * Math.sin(TAU * 300 * t) + 0.06 * Math.sin(TAU * 900 * t) * (0.6 + 0.4 * Math.sin(TAU * 3 * t)); } const x = noise(n, 114); bp(x, 700, 0.8, sr); for (let i = 0; i < n; i++) d[i] += x[i] * 0.5; norm(d, 0.5); })];
    B.beep = [mk(0.12, d => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(TAU * 1450 * t) * Math.min(1, t / 0.004) * Math.min(1, (0.1 - t) / 0.01); } norm(d, 0.3); })];
    B.deny = [mk(0.3, d => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sign(Math.sin(TAU * 220 * t)) * 0.3 * (t < 0.12 || t > 0.16 ? 1 : 0); } lp(d, 2000, sr); norm(d, 0.3); })];
    B.drip = [1, 2, 3].map(s => mk(0.25, d => { let p = 0; for (let i = 0; i < d.length; i++) { const t = i / sr, f = 900 + 1400 * (1 - Math.exp(-t / 0.012)) + s * 120; p += TAU * f / sr; d[i] = Math.sin(p) * Math.exp(-t / 0.025); } add(d, shaped(d.length, 120 + s, 600, 1, 0.0005, 0.01), 0, 0.3); norm(d, 0.5); }));
    const bed = (secs, seed, fn) => loopBuf(secs, (d, n) => { const w = noise(n, seed); let b = 0; for (let i = 0; i < n; i++) { b = b * 0.995 + w[i] * 0.05; d[i] = b; } fn(d, n, w); norm(d, 0.5); });
    B.vent = [bed(4, 131, (d, n, w) => { lp(d, 260, sr); const h = noise(n, 132); bp(h, 1500, 0.6, sr); for (let i = 0; i < n; i++) d[i] = d[i] * 3 + h[i] * 0.08 + 0.02 * Math.sin(TAU * 120 * i / sr); })];
    B.hvac = [bed(4, 141, (d, n) => { lp(d, 400, sr); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = d[i] * 3 + 0.05 * Math.sin(TAU * 60 * t) + 0.04 * Math.sin(TAU * 120 * t) + 0.02 * Math.sin(TAU * 180 * t) * (0.7 + 0.3 * Math.sin(TAU * 0.5 * t)); } })];
    B.tunnel = [bed(6, 151, (d, n) => { lp(d, 90, sr); const h = noise(n, 152); bp(h, 300, 0.5, sr); for (let i = 0; i < n; i++) d[i] = d[i] * 5 + h[i] * 0.05; })];
    B.hum = [loopBuf(1.0, (d, n) => { for (let i = 0; i < n; i++) { const t = i / sr; d[i] = 0.5 * Math.sin(TAU * 120 * t) + 0.25 * Math.sin(TAU * 240 * t) + 0.12 * Math.sign(Math.sin(TAU * 120 * t)) * 0.3 + 0.05 * Math.sin(TAU * 360 * t); } norm(d, 0.3); })];
    B.rumble = [bed(4, 161, (d, n) => { lp(d, 120, sr); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = d[i] * 6 * (0.7 + 0.3 * Math.sin(TAU * 0.75 * t)) + 0.04 * Math.sin(TAU * 47 * t); } })];
    B.boom = [mk(4.0, d => { const n = d.length, x = noise(n, 171); lp(x, 70, sr); lp(x, 120, sr); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = x[i] * env(t, 0.06, 1.1) * 40; } add(d, sine(n, 45, 28, 0.8), 0, 0.6); const r = noise(n, 172); lp(r, 300, sr); for (let i = 0; i < n; i++) d[i] += r[i] * env(i / sr - 0.4 > 0 ? i / sr - 0.4 : 0, 0.3, 1.2) * 0.8; norm(d, 0.9); })];
    B.breath = [loopBuf(3.2, (d, n) => { const x = noise(n, 181), y = noise(n, 182); bp(x, 1300, 0.7, sr); bp(y, 800, 0.8, sr); for (let i = 0; i < n; i++) { const t = i / sr; const inh = t < 1.1 ? Math.sin(Math.PI * t / 1.1) ** 2 : 0; const exh = t > 1.3 && t < 2.6 ? Math.sin(Math.PI * (t - 1.3) / 1.3) ** 2 : 0; d[i] = x[i] * inh * 0.6 + y[i] * exh; } norm(d, 0.5); })];

    for (const [a, b] of [['magout_r', 'magout'], ['magout_p', 'magout'], ['magin_r', 'magin'], ['magin_p', 'magin'], ['bolt_r', 'bolt'], ['bolt_p', 'bolt'], ['casing_r', 'casing'], ['casing_p', 'casing'], ['magdrop', 'imp_soft']]) B[a] = B[b];
    // room impulse responses
    const ir = (rt, damp, pre, er, seed) => mk(rt * 1.2, (d, n, c) => {
      const x = noise(n, seed + c * 7), lo = Float32Array.from(x); lp(lo, damp, sr);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (lo[i] * Math.exp(-6.9 * t / rt) + (x[i] - lo[i]) * Math.exp(-6.9 * t / (rt * 0.45))) * Math.min(1, t / pre); }
      const r = mkRng(seed + 99 + c); for (const at of er) { const k = Math.round((at + Math.abs(r()) * 0.002) * sr); if (k < n) d[k] += 0.6 * Math.sign(r()); }
      norm(d, 0.6);
    }, 2);
    B.silo = [bed(8, 221, (d, n) => { lp(d, 70, sr); const w = noise(n, 222); bp(w, 420, 2.2, sr); const w2 = noise(n, 223); bp(w2, 760, 3, sr);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = d[i] * 6 + w[i] * 0.07 * (0.55 + 0.45 * Math.sin(TAU * t / 8 * 3 + 1)) + w2[i] * 0.035 * (0.5 + 0.5 * Math.sin(TAU * t / 8 * 2)); } })];
    // far-off metal groan from deep down the shaft (stress in the structure)
    B.groan = [1, 2, 3].map(s => mk(3.2, d => { const n = d.length; let p = 0, p2 = 0;
      const x = noise(n, 230 + s); lp(x, 900, sr);
      for (let i = 0; i < n; i++) { const t = i / sr, e = Math.sin(Math.PI * Math.min(1, t / 3.0)) ** 2;
        const f = 52 + s * 9 + 14 * Math.sin(t * 1.7 + s) + 6 * Math.sin(t * 7.3); p += TAU * f / sr; p2 += TAU * f * 2.71 / sr;
        d[i] = (Math.sin(p + 0.8 * Math.sin(p * 0.5)) * 0.6 + Math.sin(p2) * 0.25 + x[i] * 0.4 * (0.5 + 0.5 * Math.sin(t * 23))) * e; }
      bp(d, 180, 0.7, sr); norm(d, 0.8); }));
    this.ir = { silo: ir(4.6, 1600, 0.012, [0.035, 0.07, 0.11, 0.16, 0.24], 241), corridor: ir(1.35, 3500, 0.004, [0.006, 0.011, 0.019, 0.028, 0.041], 191), armory: ir(1.0, 4500, 0.006, [0.012, 0.021, 0.034, 0.047], 201), tunnel: ir(1.9, 2200, 0.003, [0.005, 0.009, 0.014, 0.022, 0.031, 0.044], 211) };
  }
}
