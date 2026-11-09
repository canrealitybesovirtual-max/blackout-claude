# Fire extinguisher body texture from the user's photo (extinguisher_a.jpg): the front (label, worn red, strap) is the
# photo's body straightened onto the cylinder (u 0.22..0.78), the back is the photo's own red paint mirrored and
# re-scuffed. v = 0 bottom .. 1 top of the dome. python3 tools/prep_extinguisher.py
import numpy as np
from PIL import Image, ImageFilter
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
im = Image.open(ROOT / 'textures/src/extinguisher_a.jpg').convert('RGB')
# body in the photo: x 236..526 (silhouette), y 258 (top of the dome shoulder) .. 1062 (base)
x0, x1, y0, y1 = 236, 526, 362, 1040   # straight body only (the dome is its own part)
body = np.asarray(im.crop((x0, y0, x1, y1)), dtype=np.float32) / 255
H, Wb = body.shape[:2]
# unwrap the visible half: screen x = sin(theta) -> theta = asin, resample evenly in angle (-80..80 deg)
th = np.linspace(-np.radians(68), np.radians(68), 360)
xs = (np.sin(th) / np.sin(np.radians(85)) * 0.5 + 0.5) * (Wb - 1)
front = np.stack([np.stack([np.interp(xs, np.arange(Wb), body[y, :, c]) for c in range(3)], 1) for y in range(H)])
# undo the studio light falloff toward the silhouette (the game lights it)
col = front.mean((0, 2)); front = front / (col / col.max())[None, :, None] ** 0.45
OUT_W, OUT_H = 1024, 1024
fr = np.asarray(Image.fromarray((np.clip(front, 0, 1) * 255).astype(np.uint8)).resize((int(OUT_W * 0.38), OUT_H), Image.LANCZOS), dtype=np.float32) / 255
# back: the photo's paint colour (median of its red pixels) with grain, rubbed patches and chips; the strap and the
# lower can seam carried round from the photo's rows
px = front.reshape(-1, 3); redm = px[(px[:, 0] > px[:, 1] * 1.6) & (px[:, 0] > 0.25)]; paint = np.median(redm, 0)
rng = np.random.default_rng(3)
def nz(c): return np.asarray(Image.fromarray((rng.random((c, c)) * 255).astype(np.uint8)).resize((OUT_W, OUT_H), Image.BICUBIC), dtype=np.float32)[..., None] / 255
back = paint[None, None] * 0.85 * (0.82 + 0.25 * nz(48) + 0.12 * nz(256))
chips = (nz(96) * 0.6 + nz(300) * 0.4) > 0.86
back = np.where(chips, back * 0.35 + np.array([0.33, 0.32, 0.31]) * 0.65, back)
rowsrc = np.asarray(Image.fromarray((np.clip(front, 0, 1) * 255).astype(np.uint8)).resize((360, OUT_H), Image.LANCZOS), dtype=np.float32) / 255
rowmean = rowsrc[:, 8:40].mean(1)                     # the photo's left edge rows: strap and seam darkening
dark = np.clip(1 - rowmean.mean(1) / np.median(rowmean.mean(1)), 0, 1)[:, None, None]
back = back * (1 - dark) + np.array([0.03, 0.03, 0.03]) * dark
out = back.copy()
u0 = int(OUT_W * (0.5 - 0.38 / 2)); out[:, u0:u0 + fr.shape[1]] = fr
# soft seams between the photo and the back
for k in range(48):
    a = k / 48
    for u in (u0 + k, u0 + fr.shape[1] - 1 - k): out[:, u] = out[:, u] * a + back[:, u] * (1 - a)
Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(ROOT / 'textures/extinguisher.webp', 'WEBP', quality=90)
print('ok')
