from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ICON_DIR = ROOT / "icons"
ICON_DIR.mkdir(exist_ok=True)

def draw_icon(size: int):
    scale = size / 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(112 * scale)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(16, 18, 23, 255))

    def lerp(a, b, t):
        return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

    x0, y0, x1, y1 = [int(v * scale) for v in (92, 118, 420, 394)]
    c0, c1 = (47, 109, 246), (124, 58, 237)
    for i in range(y1 - y0):
        t = i / max(1, y1 - y0 - 1)
        d.line([(x0, y0 + i), (x1, y0 + i)], fill=lerp(c0, c1, t))
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(34 * scale), outline=None)

    white = (238, 244, 255, 255)
    w = max(2, int(20 * scale))
    d.line([int(256*scale), int(146*scale), int(256*scale), int(366*scale)], fill=white, width=w)
    w = max(2, int(18 * scale))
    lines = [
        ((150, 182), (236, 230)),
        ((150, 246), (236, 294)),
        ((362, 182), (276, 230)),
        ((362, 246), (276, 294)),
    ]
    for a, b in lines:
        d.line([tuple(int(v*scale) for v in a), tuple(int(v*scale) for v in b)], fill=white, width=w, joint="curve")
    return img

for size in (192, 512):
    draw_icon(size).save(ICON_DIR / f"icon-{size}.png")
