#!/usr/bin/env python3
"""Generate the Genix desktop icon sets.

fork_change - new file.

Upstream's icons were produced by hand (see README.md: an exported app-icon.png
run through `tauri icon`, then Image2Icon for the macOS inset). This fork has no
design assets, so the channel icons are generated from the mark in
packages/ui/src/components/logo.tsx instead: the same portrait ring, on a
rounded square, in Genix blue.

Treat the output as a placeholder. When real artwork arrives, drop it in and
delete this script rather than tweaking the numbers below.

Requires pillow and png2icns (icnsutils). Run from packages/desktop:

    python3 icons/fork-generate.py
"""

import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw

BRAND = (1, 134, 205, 255)  # #0186CD
WHITE = (255, 255, 255, 255)

CHANNELS = {
    # background, mark, and the tint filling the lower part of the counter
    "prod": {"bg": BRAND, "mark": WHITE, "shade": (1, 106, 162, 255)},
    "beta": {"bg": (242, 244, 247, 255), "mark": BRAND, "shade": (183, 208, 226, 255)},
    "dev": {"bg": (18, 22, 28, 255), "mark": BRAND, "shade": (14, 62, 92, 255)},
}

CANVAS = 1024
# macOS Big Sur app-icon grid: the rounded square sits inset in the canvas.
SHAPE_INSET = 100
SHAPE_RADIUS = 185

# The mark, in the proportions of the Splash logo: an 80x100 outer rectangle with
# a 20-unit border, so the counter is 40x60.
MARK_UNIT = 5.0
MARK_W, MARK_H, MARK_BORDER = 80, 100, 20

# name -> pixel size
SIZES = {
    "icon.png": 1024,
    "dock.png": 256,
    "128x128@2x.png": 256,
    "128x128.png": 128,
    "64x64.png": 64,
    "32x32.png": 32,
    "StoreLogo.png": 50,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
}

ICNS_SIZES = [1024, 512, 256, 128, 32, 16]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def render(channel: str) -> Image.Image:
    colors = CHANNELS[channel]
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (SHAPE_INSET, SHAPE_INSET, CANVAS - SHAPE_INSET, CANVAS - SHAPE_INSET),
        radius=SHAPE_RADIUS,
        fill=colors["bg"],
    )

    width, height = MARK_W * MARK_UNIT, MARK_H * MARK_UNIT
    border = MARK_BORDER * MARK_UNIT
    left, top = (CANVAS - width) / 2, (CANVAS - height) / 2

    draw.rectangle((left, top, left + width, top + height), fill=colors["mark"])
    # Knock the counter back out to the background, then shade its lower part —
    # the same weak fill the SVG mark carries.
    draw.rectangle(
        (left + border, top + border, left + width - border, top + height - border),
        fill=colors["bg"],
    )
    draw.rectangle(
        (left + border, top + height / 2, left + width - border, top + height - border),
        fill=colors["shade"],
    )
    return image


def write(channel: str, source: Image.Image) -> None:
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), channel)
    os.makedirs(out, exist_ok=True)

    for name, size in SIZES.items():
        source.resize((size, size), Image.LANCZOS).save(os.path.join(out, name))

    source.save(os.path.join(out, "icon.ico"), sizes=[(s, s) for s in ICO_SIZES])

    staged = [os.path.join(out, f".icns-{size}.png") for size in ICNS_SIZES]
    for path, size in zip(staged, ICNS_SIZES):
        source.resize((size, size), Image.LANCZOS).save(path)
    try:
        subprocess.run(["png2icns", os.path.join(out, "icon.icns"), *staged], check=True)
    finally:
        for path in staged:
            os.remove(path)

    print(f"wrote {channel} icons to {out}")


def main() -> int:
    if shutil.which("png2icns") is None:
        print("png2icns not found: install icnsutils", file=sys.stderr)
        return 1
    for channel in CHANNELS:
        write(channel, render(channel))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
