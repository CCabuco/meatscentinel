"""One-off dev script: rasterize the source SVGs into white-on-transparent
PNGs so Kivy's Image.color tint can recolor them at runtime. Not shipped /
not imported by the app -- run manually if the source SVGs ever change.

Requires (dev-only, not in requirements.txt): svglib, reportlab==3.6.13, Pillow
"""
import os
import re

from PIL import Image
from reportlab.graphics import renderPM
from svglib.svglib import svg2rlg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "icons"))
SIZE = 256

ICONS = ["chicken", "pork", "beef", "folder"]


def _whiten(svg_path):
    with open(svg_path, "r", encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r"#000000", "#ffffff", text, flags=re.IGNORECASE)
    # pork/beef are thin stroke-only line art; bump weight to read clearly
    # on a small touchscreen and to match chicken's bolder filled silhouette.
    text = re.sub(r'stroke-width="1"', 'stroke-width="2.4"', text)
    tmp_path = svg_path + ".white.svg"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(text)
    return tmp_path


def build(name):
    src = os.path.join(HERE, f"{name}.svg")
    white_src = _whiten(src)
    try:
        drawing = svg2rlg(white_src)
        scale = SIZE / max(drawing.width, drawing.height)
        drawing.width *= scale
        drawing.height *= scale
        drawing.scale(scale, scale)

        raw_path = os.path.join(OUT_DIR, f"{name}_raw.png")
        renderPM.drawToFile(drawing, raw_path, fmt="PNG", bg=0x000000)

        img = Image.open(raw_path).convert("RGBA")
        pixels = img.load()
        for y in range(img.height):
            for x in range(img.width):
                r, g, b, a = pixels[x, y]
                # Source is white-on-black; luminance becomes alpha, color -> white.
                lum = (r + g + b) // 3
                pixels[x, y] = (255, 255, 255, lum)
        out_path = os.path.join(OUT_DIR, f"{name}.png")
        img.save(out_path, "PNG")
        os.remove(raw_path)
        print(f"wrote {out_path} ({img.width}x{img.height})")
    finally:
        os.remove(white_src)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for icon in ICONS:
        build(icon)
