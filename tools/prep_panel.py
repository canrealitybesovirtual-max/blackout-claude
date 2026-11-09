# Electric panel: the user's door and breaker photos -> albedo + ORM (G roughness, B metalness) with rust and grime.
# Rust runs down from what holds water (screw heads, hinge pins, louvre lips, the handle, the bottom edge), grime
# settles low and in the louvres, the warning sign fades and chips. python3 tools/prep_panel.py
import numpy as np
from PIL import Image
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
rng = np.random.default_rng(17)

def to_lin(s): return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
def to_srgb(l): return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.maximum(l, 0), 1 / 2.4) - 0.055)
def fbm(h, w, cells, oct=4):
    out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(oct):
        c = cells * 2 ** o
        g = rng.random((c + 1, int(c * w / h) + 2))
        out += amp * np.asarray(Image.fromarray(g.astype(np.float32), 'F').resize((w, h), Image.BICUBIC)); tot += amp; amp *= 0.5
    return out / tot
RUST = np.array([0.20, 0.075, 0.025]); RUST2 = np.array([0.09, 0.035, 0.014]); GRIME = np.array([0.045, 0.040, 0.034])

def weather(src, dst, sources, louvres, metal_base, rough_base, size, pit=1.0):
    a = to_lin(np.asarray(Image.open(ROOT / 'textures/src' / src).convert('RGB'), dtype=np.float64) / 255)
    a = np.asarray(Image.fromarray((to_srgb(a) * 255).astype(np.uint8)).resize(size, Image.LANCZOS), dtype=np.float64) / 255
    a = to_lin(a); H, W = a.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W] / np.array([H, W])[:, None, None]
    n1, n2, n3 = fbm(H, W, 6), fbm(H, W, 24, 3), fbm(H, W, 90, 2)
    sat = a.max(2) - a.min(2); sign = (sat > 0.12).astype(float)          # painted sign: not metal
    rust = np.zeros((H, W)); dark = np.zeros((H, W))
    def streak(x0, y0, length, width, k):
        j = np.clip((yy - y0) / length, 0, 1); inside = (yy >= y0) & (yy <= y0 + length)
        wob = (n2 - 0.5) * width * 1.6
        prof = np.exp(-((xx - x0 - wob) / (width * (1 + j))) ** 2) * (1 - j) ** 1.6 * inside
        return prof * k * np.clip(0.4 + n3, 0, 1.4)
    for (x0, y0, r) in sources:                                            # screw / pin heads: a bloom and a run below
        d = np.hypot((xx - x0) * W / H, yy - y0)
        rust = np.maximum(rust, np.clip(1 - d / r, 0, 1) ** 0.7 * (0.55 + 0.6 * n2))
        rust = np.maximum(rust, streak(x0, y0, rng.uniform(0.05, 0.16), r * 0.45, rng.uniform(0.5, 0.9)))
    for (x0, x1, y) in louvres:                                           # louvre lips: dirt line above, runs below
        band = np.exp(-((yy - y) / 0.004) ** 2) * (xx > x0) * (xx < x1)
        dark = np.maximum(dark, band * 0.8)
        rust = np.maximum(rust, band * np.clip(n2 * 1.4 - 0.2, 0, 1) * 0.8)
        for _ in range(rng.integers(1, 4)):
            rust = np.maximum(rust, streak(rng.uniform(x0 + 0.02, x1 - 0.02), y + 0.004, rng.uniform(0.02, 0.07), 0.004, rng.uniform(0.3, 0.7)))
    edge = np.minimum.reduce([xx, 1 - xx, yy, 1 - yy])
    low = np.clip((yy - 0.55) / 0.45, 0, 1) ** 1.5
    rust = np.maximum(rust, np.clip(1 - edge / 0.03, 0, 1) * np.clip(n1 * 1.6 - 0.35, 0, 1) * (0.4 + 0.6 * low))  # edges, worse low down
    rust = np.maximum(rust, np.clip(n3 * 2.2 - 1.6 + low * 0.3, 0, 1) * 0.65 * pit * np.clip(n1 * 2.4 - 0.9, 0, 1))  # pitting, in patches
    rust *= 1 - sign * 0.5
    vstain = np.asarray(Image.fromarray(rng.random((1, 48)).astype(np.float32), 'F').resize((W, H), Image.BICUBIC))   # water stains run down the face
    grime = np.clip(0.45 * low + 0.45 * np.clip(1 - edge / 0.07, 0, 1) + 0.35 * (n1 - 0.5) + dark + 0.3 * np.clip(vstain * 2 - 1.1, 0, 1) * yy, 0, 1)
    rustc = RUST[None, None] * (0.7 + 0.6 * n2[..., None]) * (1 - n3[..., None] * 0.3) + RUST2[None, None] * n3[..., None]
    # faded, chipped sign
    g = a.mean(2, keepdims=True); a = a * (1 - sign[..., None] * 0.25) + g * sign[..., None] * 0.25
    chips = (sign > 0) & (n3 * 1.8 + n2 * 0.6 > 1.62)
    a[chips] = a[chips] * 0.35 + np.array([0.12, 0.12, 0.12]) * 0.65
    a = a * (1 - grime[..., None] * 0.6) + GRIME * grime[..., None] * 0.6
    k = np.clip(rust, 0, 1)[..., None]; a = a * (1 - k) + rustc * k
    rough = np.clip(rough_base + 0.25 * grime + 0.5 * rust + sign * 0.2 + (n2 - 0.5) * 0.1, 0.05, 1)
    metal = np.clip(metal_base * (1 - sign) * (1 - np.clip(rust * 1.3, 0, 1)) * (1 - grime * 0.4), 0, 1)
    Image.fromarray((np.clip(to_srgb(a), 0, 1) * 255 + 0.5).astype(np.uint8)).save(ROOT / 'textures' / f'{dst}.webp', 'WEBP', quality=90, method=6)
    orm = np.stack([np.ones_like(rough), rough, metal], 2)
    Image.fromarray((orm * 255 + 0.5).astype(np.uint8)).save(ROOT / 'textures' / f'{dst}_orm.webp', 'WEBP', quality=90, method=6)
    print(dst, (ROOT / 'textures' / f'{dst}.webp').stat().st_size // 1024, 'KB')

# door photo (666 x 964, normalised x, y): frame screws, hinge pins and leaves, handle, louvre lips
door_src = [(x, y, 0.022) for x in (0.05, 0.5, 0.95) for y in (0.035, 0.965)] + \
           [(0.095, 0.17, 0.03), (0.095, 0.25, 0.03), (0.095, 0.75, 0.03), (0.095, 0.83, 0.03), (0.84, 0.46, 0.02), (0.84, 0.6, 0.02)]
door_lv = [(0.28, 0.72, 0.145 + i * 0.0325) for i in range(5)] + [(0.28, 0.72, 0.715 + i * 0.0325) for i in range(6)]
weather('panel_door.jpg', 'panel_door', door_src, door_lv, 0.85, 0.42, (512, 742))
# breaker photo (387 x 553): frame screws, bus bar screws, the breaker rail screws
ins_src = [(x, y, 0.025) for x in (0.06, 0.94) for y in (0.03, 0.5, 0.97)] + [(0.3 + i * 0.065, 0.785, 0.015) for i in range(7)] + [(0.27, 0.17, 0.02), (0.75, 0.17, 0.02)]
weather('panel_inside.jpg', 'panel_inside', ins_src, [], 0.5, 0.55, (384, 548), pit=0.25)
