// Procedural PBR texture arrays (albedo+roughness, normal+tintmask+metal) and the decal atlas.
// Generated at load: no texture downloads, size chosen by the quality profile.
import * as THREE from 'three';
import { LAYERS } from '../config/materials.js';
import { DECAL_CELLS, DECAL_ATLAS, DECAL_ATLAS_H } from '../config/decals.js';

// ---------- tileable value noise ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lattices = new Map();
function lattice(P, seed) {
  const k = P * 1000 + seed;
  let L = lattices.get(k);
  if (!L) { const r = rng(seed * 7919 + P); L = new Float32Array(P * P); for (let i = 0; i < L.length; i++) L[i] = r(); lattices.set(k, L); }
  return L;
}
// periodic value noise, u,v in [0,1), period P cells
function vnoise(u, v, P, seed) {
  const L = lattice(P, seed);
  const x = u * P, y = v * P;
  let xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  xi = ((xi % P) + P) % P; yi = ((yi % P) + P) % P;
  const x1 = (xi + 1) % P, y1 = (yi + 1) % P;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = L[yi * P + xi], b = L[yi * P + x1], c = L[y1 * P + xi], d = L[y1 * P + x1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u, v, P, oct, seed, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(u, v, P << o, seed + o * 13); n += a; a *= gain; }
  return s / n;
}
const sat = x => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);

// per-layer generator: (u,v) -> fills o: h (height), r,g,b (linear albedo), ro (roughness), me (metal), tm (tint mask)
const GEN = {
  concrete(u, v, o) {
    const m = fbm(u, v, 3, 4, 11), g = vnoise(u, v, 128, 12), st = sstep(0.56, 0.78, fbm(u, v, 4, 4, 13));
    const pore = sstep(0.82, 0.92, vnoise(u, v, 96, 14)) * sstep(0.4, 0.6, vnoise(u, v, 8, 15));
    const jx = Math.min(u, 1 - u), jy = Math.min(v, 1 - v), joint = 1 - sstep(0.002, 0.006, Math.min(jx, jy));
    const a = 0.40 + (m - 0.5) * 0.14 + (g - 0.5) * 0.04 - st * 0.09 - pore * 0.12 - joint * 0.12;
    o.r = a * 1.0; o.g = a * 0.985; o.b = a * 0.955;
    o.h = fbm(u, v, 16, 4, 16) * 0.35 + g * 0.08 - pore * 0.5 - joint * 0.9;
    o.ro = 0.62 + (fbm(u, v, 8, 3, 17) - 0.5) * 0.3 - st * 0.18 + joint * 0.2; o.me = 0; o.tm = 0;
  },
  block(u, v, o) {
    const rows = 8, cols = 4, ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const fx = fract(u * cols + (row % 2) * 0.5);
    const jm = Math.min(fx * 0.4, (1 - fx) * 0.4, fy * 0.2, (1 - fy) * 0.2); // metres to joint
    const joint = 1 - sstep(0.003, 0.0065, jm);
    const blockN = vnoise(Math.floor(u * cols + (row % 2) * 0.5) / cols + 0.01, (row + 0.5) / rows, 4, 21);
    const pit = sstep(0.78, 0.9, vnoise(u, v, 64, 22));
    const chips = sstep(0.72, 0.8, vnoise(u, v, 40, 23)) * sstep(0.62, 0.75, fbm(u, v, 4, 3, 24));
    const dirt = fbm(u, v, 4, 3, 25);
    const paint = 0.8 - (dirt - 0.5) * 0.08 - joint * 0.12 - pit * 0.05 + (blockN - 0.5) * 0.03;
    const conc = 0.42 + (vnoise(u, v, 64, 26) - 0.5) * 0.1;
    o.r = o.g = o.b = paint * (1 - chips) + conc * chips; o.b *= 0.985;
    o.h = -joint * 0.9 - pit * 0.25 + fbm(u, v, 32, 3, 27) * 0.18 - chips * 0.25 + (blockN - 0.5) * 0.1;
    o.ro = 0.48 + joint * 0.3 + chips * 0.35 + (dirt - 0.5) * 0.1; o.me = 0; o.tm = 1 - chips;
  },
  ceiling(u, v, o) {
    const m = fbm(u, v, 3, 5, 31), bug = sstep(0.83, 0.93, vnoise(u, v, 80, 32));
    const px = fract(u * 3.333), py = fract(v * 1.666), seam = 1 - sstep(0.0, 0.006, Math.min(px, 1 - px, py, 1 - py));
    const tie = (() => { const dx = (fract(u * 3.333 + 0.5) - 0.5) * 0.6, dy = (fract(v * 1.666 + 0.5) - 0.5) * 1.2; return 1 - sstep(0.008, 0.013, Math.hypot(dx, dy)); })();
    const a = 0.36 + (m - 0.5) * 0.16 - bug * 0.1 - tie * 0.15 + seam * 0.03;
    o.r = a; o.g = a * 0.985; o.b = a * 0.96;
    o.h = m * 0.4 - bug * 0.6 - tie * 0.8 + seam * 0.3; o.ro = 0.88 + (m - 0.5) * 0.1; o.me = 0; o.tm = 1;
  },
  paintsteel(u, v, o) {
    const peel = vnoise(u, v, 96, 41), dirt = fbm(u, v, 4, 4, 42);
    let scratch = 0;
    for (let i = 0; i < 3; i++) { const a = fract((u * (1 + i * 0.37) + v * (0.6 - i * 0.21)) * (9 + i * 5) + vnoise(u, v, 6, 43 + i) * 2); scratch = Math.max(scratch, (1 - sstep(0.0, 0.012, Math.abs(a - 0.5))) * sstep(0.62, 0.8, vnoise(u, v, 5, 46 + i))); }
    const chip = Math.max(sstep(0.76, 0.84, vnoise(u, v, 36, 49)) * sstep(0.55, 0.7, fbm(u, v, 3, 3, 50)), scratch);
    const rust = chip * sstep(0.5, 0.8, vnoise(u, v, 12, 51));
    const paint = 0.76 - (dirt - 0.5) * 0.14;
    o.r = paint * (1 - chip) + (0.5 * (1 - rust) + 0.32 * rust) * chip;
    o.g = paint * (1 - chip) + (0.5 * (1 - rust) + 0.17 * rust) * chip;
    o.b = paint * (1 - chip) * 0.99 + (0.52 * (1 - rust) + 0.1 * rust) * chip;
    o.h = peel * 0.08 - chip * 0.35; o.ro = 0.5 + (dirt - 0.5) * 0.2 + chip * (rust ? 0.3 : -0.15);
    o.me = chip * (1 - rust); o.tm = 1 - chip;
  },
  steel(u, v, o) {
    const br = vnoise(u * 3, v * 0.02 + vnoise(u, v, 4, 61) * 0.05, 256, 62), smudge = fbm(u, v, 3, 4, 63);
    const a = 0.5 + (br - 0.5) * 0.1 + (smudge - 0.5) * 0.08;
    o.r = a; o.g = a * 1.01; o.b = a * 1.03; o.h = br * 0.05; o.ro = 0.32 + (br - 0.5) * 0.12 + (smudge - 0.5) * 0.2; o.me = 1; o.tm = 0;
  },
  hazard(u, v, o) {
    const s = fract((u + v) * 2), yel = s < 0.5 ? 1 : 0, edge = Math.min(Math.abs(s - 0.5), s, 1 - s);
    const wear = sstep(0.62, 0.76, fbm(u, v, 6, 4, 71)) + sstep(0.85, 0.95, vnoise(u, v, 50, 72));
    const dirt = fbm(u, v, 3, 3, 73), w = sat(wear);
    const pr = yel ? 0.72 : 0.03, pg = yel ? 0.5 : 0.03, pb = yel ? 0.035 : 0.03;
    const d = 1 - (dirt - 0.4) * 0.35;
    o.r = (pr * d) * (1 - w) + 0.45 * w; o.g = (pg * d) * (1 - w) + 0.45 * w; o.b = (pb * d) * (1 - w) + 0.46 * w;
    o.h = -w * 0.3 - (1 - sstep(0, 0.01, edge)) * 0.05; o.ro = 0.58 + (dirt - 0.5) * 0.2 - w * 0.2; o.me = w; o.tm = 0;
  },
  polymer(u, v, o) {
    const st = vnoise(u, v, 160, 81), m = fbm(u, v, 4, 3, 82);
    const a = 0.045 + (m - 0.5) * 0.015;
    o.r = o.g = o.b = a; o.h = st * 0.35; o.ro = 0.62 + (st - 0.5) * 0.15 + (m - 0.5) * 0.15; o.me = 0; o.tm = 0;
  },
  wood(u, v, o) {
    const plank = Math.floor(v * 6), fv = fract(v * 6), seam = 1 - sstep(0.0, 0.025, Math.min(fv, 1 - fv));
    const gr = fract(fbm(u, v + plank * 0.13, 4, 3, 91 + plank) * 10 + v * 37), ring = sstep(0.1, 0.5, gr) * (1 - sstep(0.6, 0.95, gr));
    const tone = 0.85 + (vnoise(0.5, (plank + 0.5) / 6, 6, 93) - 0.5) * 0.3;
    o.r = 0.44 * tone * (0.8 + ring * 0.25) * (1 - seam * 0.5); o.g = 0.32 * tone * (0.8 + ring * 0.22) * (1 - seam * 0.5); o.b = 0.19 * tone * (0.8 + ring * 0.2) * (1 - seam * 0.5);
    o.h = ring * 0.15 - seam * 0.8 + vnoise(u, v, 64, 94) * 0.1; o.ro = 0.76 + seam * 0.15; o.me = 0; o.tm = 1;
  },
  gunmetal(u, v, o) {
    const m = fbm(u, v, 8, 4, 101), g = vnoise(u, v, 200, 102);
    const scr = (1 - sstep(0, 0.02, Math.abs(fract(u * 7 + v * 3 + vnoise(u, v, 4, 103)) - 0.5))) * sstep(0.7, 0.85, vnoise(u, v, 6, 104));
    const a = 0.06 + (m - 0.5) * 0.02 + scr * 0.18;
    o.r = a; o.g = a * 1.02; o.b = a * 1.05; o.h = g * 0.25 - scr * 0.2; o.ro = 0.42 + (m - 0.5) * 0.15 - scr * 0.15; o.me = 0.7 + scr * 0.3; o.tm = 0;
  },
  brass(u, v, o) {
    const m = fbm(u, v, 6, 3, 111);
    o.r = 0.8 - m * 0.1; o.g = 0.58 - m * 0.1; o.b = 0.26 - m * 0.06; o.h = m * 0.05; o.ro = 0.24 + m * 0.15; o.me = 1; o.tm = 0;
  },
  diffuser(u, v, o) {
    const px = fract(u * 48), py = fract(v * 48), cone = 1 - Math.max(Math.abs(px - 0.5), Math.abs(py - 0.5)) * 2;
    o.r = o.g = o.b = 0.88; o.h = cone * 0.3; o.ro = 0.25; o.me = 0; o.tm = 0;
  },
  fabric(u, v, o) {
    const wx = Math.sin(u * Math.PI * 2 * 96) * 0.5 + 0.5, wy = Math.sin(v * Math.PI * 2 * 96) * 0.5 + 0.5;
    const weave = (Math.floor(u * 96 + v * 96) % 2) ? wx : wy, m = fbm(u, v, 4, 4, 121);
    const a = 0.6 * (0.85 + weave * 0.15) * (0.85 + (m - 0.5) * 0.4);
    o.r = o.g = o.b = a; o.h = weave * 0.4 + m * 0.2; o.ro = 0.92; o.me = 0; o.tm = 1;
  },
  plate(u, v, o) {
    const n = 10, cx = Math.floor(u * n), cy = Math.floor(v * n), fx = fract(u * n) - 0.5, fy = fract(v * n) - 0.5;
    const flip = (cx + cy) % 2 ? 1 : -1;
    const ax = (fx + fy * flip) * 0.707, ay = (fx - fy * flip) * 0.707;
    const lozenge = 1 - sstep(0.0, 0.06, Math.abs(ay) * 2.6 + Math.abs(ax) * 0.55 - 0.15);
    const dirt = sstep(0.4, 0.8, fbm(u, v, 4, 4, 131)) * (1 - lozenge), rust = sstep(0.68, 0.82, fbm(u, v, 3, 4, 132));
    const base = 0.32 + (vnoise(u, v, 64, 133) - 0.5) * 0.05;
    o.r = base * (1 - dirt * 0.6) * (1 - rust) + 0.3 * rust; o.g = base * (1 - dirt * 0.6) * (1 - rust) + 0.16 * rust; o.b = base * 1.02 * (1 - dirt * 0.6) * (1 - rust) + 0.09 * rust;
    o.h = lozenge * 0.8; o.ro = 0.42 - lozenge * 0.14 + dirt * 0.4 + rust * 0.35; o.me = (1 - dirt * 0.7) * (1 - rust); o.tm = 0;
  },
};
const NORMAL_STRENGTH = { concrete: 3, block: 4, ceiling: 4, paintsteel: 2, steel: 1, hazard: 2, polymer: 1.5, wood: 3, gunmetal: 1, brass: 0.5, diffuser: 2, fabric: 2, plate: 6 };

// photo layers: albedo straight from the calibrated photo, relief and roughness from its detail
const PHOTO = {
  concrete: { rough: 0.62, rk: 0.45, tm: 0, ks: 2.2 },
  ceiling: { rough: 0.86, rk: 0.25, tm: 1, ks: 2.6 },
};
// load photo layers (null = keep the generated layer); drawn at the profile's size
export async function loadPhotoLayers(size, base = 'textures/') {
  const out = {};
  await Promise.all(Object.keys(PHOTO).map(name => new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, size, size);
      out[name] = g.getImageData(0, 0, size, size).data; res();
    };
    im.onerror = () => res();
    im.src = base + name + '.webp';
  })));
  return out;
}

export function makeMaterialArrays(size, anisotropy = 1, photos = {}) {
  const L = LAYERS.length, N = size * size;
  const alb = new Uint8Array(N * 4 * L), nrm = new Uint8Array(N * 4 * L);
  const h = new Float32Array(N), o = { h: 0, r: 0, g: 0, b: 0, ro: 0, me: 0, tm: 0 };
  const toS = c => { c = sat(c); return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); };
  for (let l = 0; l < L; l++) {
    const gen = GEN[LAYERS[l]], base = N * 4 * l;
    let ks = NORMAL_STRENGTH[LAYERS[l]] * size / 256;
    const ph = photos[LAYERS[l]], pd = PHOTO[LAYERS[l]];
    if (ph) {
      // linear luminance, its local mean (box 1/16 of the tile, wrapped), detail = relief
      const lum = new Float32Array(N), sl = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      for (let i = 0; i < N; i++) lum[i] = sl(ph[i * 4]) * 0.2126 + sl(ph[i * 4 + 1]) * 0.7152 + sl(ph[i * 4 + 2]) * 0.0722;
      const r = Math.max(2, size >> 4), tmp = new Float32Array(N), mean = new Float32Array(N);
      for (let y = 0; y < size; y++) { let acc = 0; for (let k = -r; k <= r; k++) acc += lum[y * size + ((k + size) % size)]; for (let x = 0; x < size; x++) { tmp[y * size + x] = acc / (2 * r + 1); acc += lum[y * size + (x + r + 1) % size] - lum[y * size + (x - r + size) % size]; } }
      for (let x = 0; x < size; x++) { let acc = 0; for (let k = -r; k <= r; k++) acc += tmp[((k + size) % size) * size + x]; for (let y = 0; y < size; y++) { mean[y * size + x] = acc / (2 * r + 1); acc += tmp[((y + r + 1) % size) * size + x] - tmp[((y - r + size) % size) * size + x]; } }
      for (let i = 0; i < N; i++) {
        const rel = lum[i] / Math.max(1e-4, mean[i]) - 1, q = base + i * 4;
        h[i] = Math.max(-1, Math.min(1, rel * 1.6));
        alb[q] = ph[i * 4]; alb[q + 1] = ph[i * 4 + 1]; alb[q + 2] = ph[i * 4 + 2];
        alb[q + 3] = Math.round(sat(pd.rough - rel * pd.rk) * 255);   // pits and cracks rougher
        nrm[q + 2] = pd.tm * 255; nrm[q + 3] = 0;
      }
      ks = pd.ks * size / 256;
    } else
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      gen((x + 0.5) / size, (y + 0.5) / size, o);
      const i = y * size + x, q = base + i * 4;
      h[i] = o.h;
      // cavity darkening from height (cheap baked AO)
      const ao = 0.82 + 0.18 * sat(o.h + 0.6);
      alb[q] = toS(o.r * ao); alb[q + 1] = toS(o.g * ao); alb[q + 2] = toS(o.b * ao); alb[q + 3] = Math.round(sat(o.ro) * 255);
      nrm[q + 2] = Math.round(sat(o.tm) * 255); nrm[q + 3] = Math.round(sat(o.me) * 255);
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size, yd = (y - 1 + size) % size, yu = (y + 1) % size;
      const dx = (h[y * size + xr] - h[y * size + xl]) * 0.5 * ks / 8, dy = (h[yu * size + x] - h[yd * size + x]) * 0.5 * ks / 8;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), q = base + (y * size + x) * 4;
      nrm[q] = Math.round((-dx * il * 0.5 + 0.5) * 255); nrm[q + 1] = Math.round((-dy * il * 0.5 + 0.5) * 255);
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, size, size, L);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, true), normal: mk(nrm, false), bytes: alb.length * 2 * 4 / 3 };
}

// ---------- decal atlas (canvas) ----------
export function makeDecalAtlas(scale = 1, photos = {}) {
  const S = Math.round(DECAL_ATLAS * scale), SH = Math.round(DECAL_ATLAS_H * scale), cv = document.createElement('canvas');
  cv.width = S; cv.height = SH;
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  const r = rng(77);
  const cell = n => DECAL_CELLS[n];
  const clip = (n, fn) => { const [x, y, w, h] = cell(n); g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); fn(w, h); g.restore(); };
  const wear = (w, h, amt, size = 3) => { g.save(); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < w * h * amt / 40; i++) { g.globalAlpha = 0.3 + r() * 0.7; g.beginPath(); g.arc(r() * w, r() * h, r() * size + 0.5, 0, 7); g.fill(); } g.restore(); };
  const font = (px, weight = 800) => `${weight} ${px}px "Arial Narrow", "Roboto Condensed", Arial, Helvetica, sans-serif`;
  const sign = (n, bg, fg, lines, opt = {}) => clip(n, (w, h) => {
    g.fillStyle = bg; g.fillRect(4, 4, w - 8, h - 8);
    if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20); }
    if (opt.band) { g.fillStyle = opt.band; g.fillRect(4, 4, w - 8, h * 0.34); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [txt, y, px, col] of lines) { g.fillStyle = col || fg; g.font = font(px); g.fillText(txt, w / 2, y * h, w - 24); }
    wear(w, h, 0.05, 2);
  });
  // floor line
  clip('line', (w, h) => { g.fillStyle = '#d9a514'; g.fillRect(0, 0, w, h); wear(w, h, 0.5, 2.5); });
  clip('hazardFloor', (w, h) => {
    for (let i = -h; i < w + h; i += 40) { g.fillStyle = '#d9a514'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 20, 0); g.lineTo(i + 20 - h, h); g.lineTo(i - h, h); g.fill(); }
    g.fillStyle = 'rgba(10,10,10,0.92)';
    for (let i = -h + 20; i < w + h; i += 40) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 20, 0); g.lineTo(i + 20 - h, h); g.lineTo(i - h, h); g.fill(); }
    wear(w, h, 0.6, 3);
  });
  sign('sign_sectorb', '#e8e6df', '#151515', [['SECTOR B', 0.42, 64], ['LEVEL −2 · BLACKSITE', 0.8, 26, '#5a5a5a']], { border: '#151515' });
  sign('sign_armory', '#1d1f20', '#e8e6df', [['ARMORY  ▸  B-4', 0.55, 52]]);
  sign('sign_auth', '#e8e6df', '#151515', [['RESTRICTED', 0.18, 34, '#f2f2f2'], ['AUTHORIZED PERSONNEL ONLY', 0.58, 30], ['CLEARANCE LEVEL 3', 0.83, 22, '#6a1010']], { band: '#a3170f' });
  sign('sign_tunnel', '#1f3a26', '#f0f0e8', [['SERVICE', 0.25, 34], ['TUNNEL B-T1', 0.52, 30], ['◂ ▲ ▸', 0.8, 26]]);
  sign('sign_fire', '#b3150c', '#ffffff', [['FIRE', 0.38, 50], ['EXTINGUISHER', 0.75, 22]]);
  sign('sign_blast', '#e0b21a', '#111111', [['BLAST DOOR B1', 0.34, 42], ['SEALED — DO NOT OPERATE', 0.72, 24]], { border: '#111' });
  sign('sign_lift', '#e8e6df', '#151515', [['SERVICE LIFT', 0.3, 36], ['OUT OF ORDER', 0.7, 32, '#a3170f']]);
  sign('sign_range', '#1d1f20', '#e8e6df', [['TEST LANE B-4', 0.27, 42], ['EYE AND EAR PROTECTION', 0.58, 28, '#e0b21a'], ['REQUIRED BEYOND THIS POINT', 0.82, 22]]);
  sign('sign_silo', '#1d1f20', '#e0b21a', [['SILO 7', 0.36, 40], ['LAUNCH CONTROL · SEALED', 0.76, 17, '#e8e6df']]);
  sign('sign_drop', '#e8e6df', '#151515', [['DANGER', 0.22, 30, '#f2f2f2'], ['OPEN SHAFT — 400 M DROP', 0.6, 22], ['KEEP TO THE GANTRY', 0.85, 16, '#6a1010']], { band: '#a3170f' });
  sign('sign_armorybig', '#e8e6df', '#151515', [['ARMORY', 0.45, 60], ['WEAPONS MUST BE CLEARED', 0.82, 22, '#a3170f']], { border: '#151515' });
  clip('firing_line', (w, h) => { g.fillStyle = '#e6e3da'; g.font = font(44); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('FIRING LINE', w / 2, h / 2 + 2); wear(w, h, 0.5, 2.5); });
  clip('stencil_b2', (w, h) => { g.fillStyle = '#e3e0d6'; g.font = font(150, 900); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B2', w / 2, h / 2 + 8); g.fillStyle = 'rgba(0,0,0,1)'; g.globalCompositeOperation = 'destination-out'; g.fillRect(w * 0.47, 0, 8, h); g.fillRect(0, h * 0.48, w, 6); g.globalCompositeOperation = 'source-over'; wear(w, h, 0.9, 3); });
  clip('locker_vent', (w, h) => { for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(10 + i * 19, 10, 9, h - 20); } });
  if (photos.door_yellow) clip('door_yellow', (w, h) => g.drawImage(photos.door_yellow, 0, 0, w, h));
  if (photos.vent) clip('vent', (w, h) => g.drawImage(photos.vent, 0, 0, w, h)); else
  clip('vent', (w, h) => { g.fillStyle = '#585b5c'; g.fillRect(2, 2, w - 4, h - 4); g.fillStyle = '#121314'; for (let i = 0; i < 9; i++) g.fillRect(10, 10 + i * 12, w - 20, 7); g.strokeStyle = '#2a2c2d'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8); });
  clip('grime', (w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(22,19,15,0.75)'); gr.addColorStop(0.35, 'rgba(26,22,17,0.35)'); gr.addColorStop(1, 'rgba(30,26,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(20,17,13,${r() * 0.25})`; g.fillRect(r() * w, h * (0.4 + r() * 0.6), 1 + r() * 6, r() * h * 0.5); } });
  clip('stain_water', (w, h) => { for (let i = 0; i < 26; i++) { const x = w * (0.2 + r() * 0.6), len = h * (0.3 + r() * 0.7), wd = 2 + r() * 10; const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(40,36,28,0.0)'); gr.addColorStop(0.15, 'rgba(48,42,30,0.35)'); gr.addColorStop(1, 'rgba(52,44,30,0)'); g.fillStyle = gr; g.fillRect(x, 0, wd, len); } });
  const blob = (n, col, k) => clip(n, (w, h) => { for (let i = 0; i < k; i++) { const x = w * (0.3 + r() * 0.4), y = h * (0.3 + r() * 0.4), rad = Math.min(w, h) * (0.08 + r() * 0.22); const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, col(0.5)); gr.addColorStop(0.7, col(0.3)); gr.addColorStop(1, col(0)); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad, rad * (0.6 + r() * 0.5), r() * 3, 0, 7); g.fill(); } });
  blob('stain_oil', a => `rgba(8,7,6,${a})`, 14);
  blob('puddle', a => `rgba(14,16,18,${Math.min(1, a * 1.4)})`, 18);
  blob('scorch', a => `rgba(10,9,8,${a * 0.9})`, 10);
  const hole = (n, ring) => clip(n, (w, h) => { const c = w / 2; const gr = g.createRadialGradient(c, c, 0, c, c, c * 0.95); gr.addColorStop(0, 'rgba(2,2,2,1)'); gr.addColorStop(0.14, 'rgba(5,5,5,1)'); gr.addColorStop(0.2, ring); gr.addColorStop(0.55, 'rgba(60,58,54,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(20,20,20,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(c, c); const a = r() * 7, l = c * (0.3 + r() * 0.6); g.lineTo(c + Math.cos(a) * l, c + Math.sin(a) * l); g.stroke(); } });
  hole('hole_concrete', 'rgba(150,146,138,0.7)');
  hole('hole_metal', 'rgba(170,172,176,0.8)');
  clip('arrow', (w, h) => { g.fillStyle = '#e3e0d6'; g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w - 10, h / 2); g.lineTo(w * 0.64, h / 2); g.lineTo(w * 0.64, h - 8); g.lineTo(w * 0.36, h - 8); g.lineTo(w * 0.36, h / 2); g.lineTo(10, h / 2); g.fill(); wear(w, h, 0.5); });
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return { texture: t, bytes: S * SH * 4 * 4 / 3 };
}

// photo decals (null when missing: the drawn version is used)
export function loadImage(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
