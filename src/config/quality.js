// Hardware profiles. Everything that costs GPU/CPU/RAM is a field here.
export const PROFILES = {
  ultralow: { name: 'ULTRA LOW', tex: 128, aniso: 1, msaa: false, scaleMin: 0.45, scaleMax: 0.7, maxDpr: 1, targetMs: 33.3,
    grain: 0, vignette: 0, dust: 0, glows: true, voices: 8, hrtf: false, decalScale: 0.5, sparks: 32, holes: 32, bob: 1, fov: 72 },
  low: { name: 'LOW', tex: 256, aniso: 1, msaa: false, scaleMin: 0.55, scaleMax: 0.85, maxDpr: 1, targetMs: 16.7,
    grain: 0, vignette: 0.15, dust: 0, glows: true, voices: 12, hrtf: false, decalScale: 0.5, sparks: 48, holes: 64, bob: 1, fov: 72 },
  medium: { name: 'MEDIUM', tex: 256, aniso: 4, msaa: false, scaleMin: 0.7, scaleMax: 1.0, maxDpr: 1.5, targetMs: 16.7,
    grain: 0.018, vignette: 0.25, dust: 200, glows: true, voices: 16, hrtf: true, decalScale: 1, sparks: 96, holes: 96, bob: 1, fov: 74 },
  high: { name: 'HIGH', tex: 512, aniso: 8, msaa: true, scaleMin: 0.8, scaleMax: 1.0, maxDpr: 2, targetMs: 16.7,
    grain: 0.02, vignette: 0.28, dust: 400, glows: true, voices: 24, hrtf: true, decalScale: 1, sparks: 128, holes: 128, bob: 1, fov: 75 },
  // stereo: no grain/vignette/bob (comfort), fixed scale, foveation in the XR layer
  vr: { name: 'VR', tex: 256, aniso: 4, msaa: true, scaleMin: 1, scaleMax: 1, maxDpr: 1, targetMs: 13.9,
    grain: 0, vignette: 0, dust: 120, glows: true, voices: 16, hrtf: true, decalScale: 0.5, sparks: 64, holes: 64, bob: 0, fov: 90 },
};

export function detectProfile() {
  const url = new URLSearchParams(location.search).get('q');
  if (url && PROFILES[url]) return url;
  try { const s = localStorage.getItem('bs.quality'); if (s && PROFILES[s]) return s; } catch (e) { /* storage blocked */ }
  let gpu = '';
  try {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c && c.getExtension('WEBGL_debug_renderer_info');
    gpu = (ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '') || '';
    const lose = c && c.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  } catch (e) { /* no webgl2 */ }
  if (/OculusBrowser|Quest|Pico/i.test(navigator.userAgent)) return 'vr'; // standalone headsets: stereo profile, MSAA on
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|Mobile|CrOS/i.test(navigator.userAgent);
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return 'ultralow';
  if (mem <= 2 || cores <= 2) return 'ultralow';
  if (/Mali-4|Mali-T|Adreno \(TM\) [345]\d\d|PowerVR|HD Graphics [2-5]\d\d\b|Bay ?Trail/i.test(gpu)) return 'low';
  if (mobile || /Intel|Iris|UHD|Adreno|Mali|Apple GPU/i.test(gpu)) return mem >= 8 && !mobile ? 'medium' : 'low';
  if (/NVIDIA|GeForce|RTX|GTX|Radeon|AMD/i.test(gpu)) return 'high';
  return 'medium';
}
