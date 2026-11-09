// Performance monitor: CPU/GPU frame time, FPS + 1% low, draw calls, triangles, programs,
// memory, timers per system. GPU time uses EXT_disjoint_timer_query_webgl2 when available.
export class Perf {
  constructor(renderer, el) {
    this.r = renderer; this.el = el; this.visible = false;
    this.frames = new Float32Array(240); this.fi = 0;
    this.cpu = 0; this.gpu = -1; this.timers = {}; this.counters = {};
    this.info = { calls: 0, tris: 0, points: 0, lines: 0 };
    this.notes = {};
    const gl = renderer.getContext();
    this.gl = gl; this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = []; this.active = null;
    this.acc = 0; this.texBytes = 0;
  }
  beginGPU() { if (!this.ext || this.active || this.queries.length > 3) return; const q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.active = q; }
  endGPU() {
    const gl = this.gl;
    if (this.active) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.queries.push(this.active); this.active = null; }
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.gpu = this.gpu < 0 ? ms : this.gpu * 0.9 + ms * 0.1; }
      gl.deleteQuery(q); this.queries.shift();
    }
  }
  time(name, ms) { this.timers[name] = (this.timers[name] ?? ms) * 0.9 + ms * 0.1; }
  frame(dtMs, cpuMs) {
    this.frames[this.fi++ % this.frames.length] = dtMs;
    this.cpu = this.cpu * 0.9 + cpuMs * 0.1;
    const ri = this.r.info.render; this.info.calls = ri.calls; this.info.tris = ri.triangles; this.info.points = ri.points; this.info.lines = ri.lines;
  }
  stats() {
    const n = Math.min(this.fi, this.frames.length), arr = Array.from(this.frames.subarray(0, n)).sort((a, b) => a - b);
    const avg = arr.reduce((s, v) => s + v, 0) / Math.max(1, n);
    const low = arr[Math.floor(n * 0.99)] || avg;
    return { fps: 1000 / Math.max(avg, 0.001), low1: 1000 / Math.max(low, 0.001), avgMs: avg };
  }
  snapshot() {
    const s = this.stats(), m = this.r.info.memory;
    const heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1;
    return { ...s, cpu: this.cpu, gpu: this.gpu, ...this.info, programs: this.r.info.programs ? this.r.info.programs.length : 0, geometries: m.geometries, textures: m.textures, texMB: this.texBytes / 1048576, heapMB: heap, timers: { ...this.timers }, counters: { ...this.counters }, notes: { ...this.notes } };
  }
  draw(dt) {
    this.acc += dt;
    if (!this.visible || this.acc < 0.25) return;
    this.acc = 0;
    const s = this.snapshot(), f = v => v.toFixed(1);
    const t = Object.entries(s.timers).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ');
    const c = Object.entries(s.counters).map(([k, v]) => `${k} ${v}`).join('  ');
    const nt = Object.entries(s.notes).map(([k, v]) => `${k}: ${v}`).join('\n');
    this.el.textContent =
      `FPS ${f(s.fps)}  1% low ${f(s.low1)}  frame ${f(s.avgMs)} ms\n` +
      `CPU ${s.cpu.toFixed(2)} ms  GPU ${s.gpu < 0 ? 'n/a' : s.gpu.toFixed(2) + ' ms'}\n` +
      `draw calls ${s.calls}  tris ${s.tris}  pts ${s.points}  lines ${s.lines}\n` +
      `programs ${s.programs}  geometries ${s.geometries}  textures ${s.textures}  tex ${s.texMB.toFixed(1)} MB  heap ${s.heapMB < 0 ? 'n/a' : s.heapMB.toFixed(0) + ' MB'}\n` +
      `ms: ${t}\n${c}\n${nt}`;
  }
}
