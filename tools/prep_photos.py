# Photo -> game texture: de-lit, seamless, albedo calibrated to the layer's value, 512 px WebP.
# python3 tools/prep_photos.py   (sources in textures/src, outputs in textures/)
import numpy as np
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOBS = [  # source, output, target mean linear albedo (= LAYER_ALBEDO in materials.js), contrast kept
    ('concrete_floor.png', 'concrete.webp', 0.40, 0.55),
    ('concrete_ceiling.png', 'ceiling.webp', 0.36, 0.85),
]
SIZE = 512

def to_lin(s): return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
def to_srgb(l): return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.maximum(l, 0), 1 / 2.4) - 0.055)
def low_pass(a, cells):  # wrap-safe low-frequency light estimate
    h, w = a.shape[:2]
    out = np.empty_like(a)
    for c in range(a.shape[2]):
        im = Image.fromarray(a[..., c].astype(np.float32), 'F')
        small = im.resize((cells, cells), Image.BOX)
        t = np.asarray(small)
        t = np.tile(t, (3, 3))  # tile so the upscale wraps
        big = Image.fromarray(t, 'F').resize((w * 3, h * 3), Image.BICUBIC)
        out[..., c] = np.asarray(big)[h:2 * h, w:2 * w]
    return out

for src, dst, target, contrast in JOBS:
    a = to_lin(np.asarray(Image.open(ROOT / 'textures/src' / src).convert('RGB'), dtype=np.float64) / 255)
    n = min(a.shape[:2]); a = a[:n, :n]
    # make seamless: blend with a half-shifted copy near the edges
    sh = np.roll(np.roll(a, n // 2, 0), n // 2, 1)
    d = np.minimum(np.arange(n), np.arange(n)[::-1]) / n
    w1 = np.clip((d - 0.02) / 0.13, 0, 1); w1 = w1 * w1 * (3 - 2 * w1)
    w = np.minimum.outer(w1, w1)[..., None]
    a = a * w + sh * (1 - w)
    # de-light: remove broad shading, keep detail
    lum = a.mean(2, keepdims=True)
    lowl = low_pass(lum, 6)
    a = a / np.maximum(lowl, 1e-4) * lum.mean()
    m = a.mean((0, 1), keepdims=True)
    a = m + (a - m) * contrast            # trowelled floors are more even than the photo
    a = a * (target / a.mean())
    img = Image.fromarray((np.clip(to_srgb(a), 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').resize((SIZE, SIZE), Image.LANCZOS)
    img.save(ROOT / 'textures' / dst, 'WEBP', quality=90, method=6)
    print(dst, (ROOT / 'textures' / dst).stat().st_size // 1024, 'KB')
