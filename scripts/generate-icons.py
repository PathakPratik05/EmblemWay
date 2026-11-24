#!/usr/bin/env python3
"""Renders EmblemWay legacy launcher PNGs (Android < 8) and a store icon.

The artwork mirrors android/app/src/main/res/drawable/ic_launcher_foreground.xml.
Usage (needs Pillow):  python3 scripts/generate-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "mobile/android/app/src/main/res"
BLUE, AMBER, WHITE = (27, 77, 137, 255), (242, 168, 29, 255), (255, 255, 255, 255)
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def bezier(p0, p1, p2, p3, steps=24):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t**2
        d = t**3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


def render(size: int, round_icon: bool) -> Image.Image:
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if round_icon:
        d.ellipse((0, 0, s - 1, s - 1), fill=BLUE)
    else:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=BLUE)
    # Map the 108-unit adaptive-icon viewport (artwork centred on 54,54) onto ~70% of the icon.
    k = s / 80.0
    off = s / 2 - 54 * k

    def P(x, y):
        return (x * k + off, y * k + off)

    shield = [P(54, 26), P(76, 34), P(76, 52)] + [P(*q) for q in bezier((76, 52), (76, 66), (66, 77), (54, 82))]
    shield += [P(*q) for q in bezier((54, 82), (42, 77), (32, 66), (32, 52))] + [P(32, 34)]
    d.polygon(shield, outline=WHITE, width=int(4 * k))
    route = [P(*q) for q in bezier((42, 66), (46, 58), (50, 60), (54, 52))] + [P(*q) for q in bezier((54, 52), (58, 44), (62, 46), (66, 38))]
    d.line(route, fill=AMBER, width=int(5 * k), joint="curve")
    for (x, y, r, col) in [(42, 66, 4, WHITE), (66, 38, 4.5, AMBER)]:
        cx, cy = P(x, y)
        d.ellipse((cx - r * k, cy - r * k, cx + r * k, cy + r * k), fill=col)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    for density, px in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        render(px, False).save(folder / "ic_launcher.png")
        render(px, True).save(folder / "ic_launcher_round.png")
    store = ROOT / "mobile/assets"
    store.mkdir(exist_ok=True)
    render(512, False).save(store / "emblemway-icon-512.png")
    print("Icons written for", ", ".join(DENSITIES))


if __name__ == "__main__":
    main()
