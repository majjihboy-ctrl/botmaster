"""
Adds a sense of implied motion to the static app icon (the one shown by the
OS-native install/launch splash screen, which cannot itself be animated).
Extracts just the "bm" mark from the original icon (soft-alpha cutout, so no
hard edges) and recomposites it over a new background that has: a richer
radial glow, two frozen "orbit" arcs echoing the in-app boot-splash rings,
and a diagonal glass-style light sweep. Source icons are read from
public/icons-backup (untouched originals); outputs overwrite public/icons.

Run once locally (or via this container) after any logo change. Requires
Pillow + numpy.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BG = (6, 10, 18, 255)          # #060a12 — must match manifest.json background_color
GLOW_A = (0, 229, 255)         # cyan
GLOW_B = (26, 111, 255)        # blue
ACCENT = (240, 180, 41)        # amber ring accent
BG_RGB = np.array(BG[:3])


def make_backdrop(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    cx = cy = size / 2

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    max_r = size * 0.62
    steps = 90
    for i in range(steps, 0, -1):
        t = i / steps
        r = max_r * t
        alpha = int(150 * (1 - t) ** 2.2)
        col = tuple(int(GLOW_A[c] * (1 - t) + GLOW_B[c] * t) for c in range(3))
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col + (alpha,))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.02))
    img = Image.alpha_composite(img, glow)

    orbit = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    od = ImageDraw.Draw(orbit)
    for radius, width, color, start, end in [
        (size * 0.46, max(2, round(size * 0.012)), GLOW_A + (150,), -35, 165),
        (size * 0.37, max(2, round(size * 0.016)), ACCENT + (110,), 140, 260),
    ]:
        bbox = [cx - radius, cy - radius, cx + radius, cy + radius]
        od.arc(bbox, start=start, end=end, fill=color, width=width)
    orbit = orbit.filter(ImageFilter.GaussianBlur(size * 0.004))
    img = Image.alpha_composite(img, orbit)

    sweep = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sweep)
    band_w = size * 0.34
    x0 = -size * 0.3
    sd.polygon(
        [
            (x0, size * 1.1),
            (x0 + band_w, size * 1.1),
            (x0 + band_w + size * 0.9, -size * 0.1),
            (x0 + size * 0.9, -size * 0.1),
        ],
        fill=(255, 255, 255, 26),
    )
    sweep = sweep.filter(ImageFilter.GaussianBlur(size * 0.025))
    img = Image.alpha_composite(img, sweep)

    return img


def extract_mark(logo_path: str) -> Image.Image:
    """Soft-alpha cutout of just the mark, discarding the original flat
    background/glow so it can sit over a new backdrop with no seam."""
    logo = Image.open(logo_path).convert("RGB")
    arr = np.array(logo).astype(int)
    diff = np.abs(arr - BG_RGB).sum(axis=2)
    alpha = np.clip((diff - 55) / 130.0, 0, 1) * 255
    rgba = np.dstack([arr, alpha]).astype("uint8")
    cutout = Image.fromarray(rgba, "RGBA")

    # crop tight to content so we control final scale precisely
    ys, xs = np.where(alpha > 10)
    pad = int(logo.width * 0.03)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, logo.width)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, logo.height)
    return cutout.crop((x0, y0, x1, y1))


def compose(logo_path: str, out_path: str, size: int, mark_width_frac: float):
    backdrop = make_backdrop(size)
    mark = extract_mark(logo_path)

    target_w = int(size * mark_width_frac)
    scale = target_w / mark.width
    target_h = int(mark.height * scale)
    mark_resized = mark.resize((target_w, target_h), Image.LANCZOS)

    pos = ((size - target_w) // 2, (size - target_h) // 2)
    backdrop.alpha_composite(mark_resized, pos)
    backdrop.save(out_path, "PNG")


# Point SRC at plain, un-enhanced source icons (e.g. a fresh logo export) —
# NOT at public/icons once it already holds enhanced output, or the glow/
# arcs/sweep will double up. The previous plain versions are also recoverable
# from git history (the commit before this script was added).
SRC = "/home/claude/botmaster/public/icons"
OUT = "/home/claude/botmaster/public/icons"

# any/plain icons: mark can take up most of the frame's width
compose(f"{SRC}/icon-512.png", f"{OUT}/icon-512.png", 512, 0.78)
compose(f"{SRC}/icon-192.png", f"{OUT}/icon-192.png", 192, 0.78)

# maskable: keep mark inside the ~80% safe zone so circular/squircle OS crops don't clip it
compose(f"{SRC}/icon-512-maskable.png", f"{OUT}/icon-512-maskable.png", 512, 0.60)
compose(f"{SRC}/icon-192-maskable.png", f"{OUT}/icon-192-maskable.png", 192, 0.60)

# apple-touch-icon: iOS wants a fully opaque icon (no alpha channel)
apple_size = Image.open(f"{SRC}/apple-touch-icon.png").size[0]
backdrop = make_backdrop(apple_size)
mark = extract_mark(f"{SRC}/apple-touch-icon.png")
target_w = int(apple_size * 0.78)
scale = target_w / mark.width
mark_resized = mark.resize((target_w, int(mark.height * scale)), Image.LANCZOS)
pos = ((apple_size - target_w) // 2, (apple_size - mark_resized.height) // 2)
backdrop.alpha_composite(mark_resized, pos)
backdrop.convert("RGB").save(f"{OUT}/apple-touch-icon.png", "PNG")

print("done")
