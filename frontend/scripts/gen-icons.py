#!/usr/bin/env python3
"""Regenerate every app icon from frontend/assets/logo.png.

    python3 frontend/scripts/gen-icons.py

The master is a non-square, opaque render (glyph on textured paper). Outputs land in
frontend/public/ — the favicon, PWA manifest icons and the iOS home-screen icon.
Needs Pillow + numpy.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logo.png"
OUT = ROOT / "public"

# Glyph centre in the master (px). Square crop = full height, centred on it.
CX = 562
MASTER = 1024  # work at this size, downsample once per output
MASK_SCALE = 0.74  # glyph size inside a maskable icon; ink radius x this must stay < 0.4 of the side


def square() -> Image.Image:
    im = Image.open(SRC).convert("RGB")
    side = im.height
    x0 = max(0, min(im.width - side, CX - side // 2))
    return im.crop((x0, 0, x0 + side, side)).resize((MASTER, MASTER), Image.LANCZOS)


def paper(sq: Image.Image, size: int, seed: int = 7) -> Image.Image:
    """The paper alone, extended to any size: fit a smooth colour plane (bilinear, per channel)
    to the clean paper pixels in the crop's border band — robustly, dropping shadow/glyph
    outliers — then evaluate it on a canvas that reaches past the crop."""
    a = np.asarray(sq, dtype=np.float64)
    n = a.shape[0]
    ys, xs = np.mgrid[0:n, 0:n] / (n - 1)
    band = (np.minimum.reduce([xs, ys, 1 - xs, 1 - ys]) < 0.06).ravel()
    x, y = xs.ravel()[band], ys.ravel()[band]
    design = np.stack([np.ones_like(x), x, y, x * y], axis=1)
    px = a.reshape(-1, 3)[band]
    keep = np.ones(len(x), bool)
    coef = np.zeros((4, 3))
    for _ in range(6):
        coef, *_ = np.linalg.lstsq(design[keep], px[keep], rcond=None)
        keep = (np.abs(design @ coef - px).max(axis=1) < 10) & (px.min(axis=1) > 120)
    yy, xx = np.mgrid[0:size, 0:size] / (size - 1)
    # canvas -> crop coordinates (the crop occupies the middle of the canvas)
    u, v = (xx - 0.5) / MASK_SCALE + 0.5, (yy - 0.5) / MASK_SCALE + 0.5
    field = np.stack([np.ones_like(u), u, v, u * v], axis=-1) @ coef
    field += np.random.default_rng(seed).normal(0, 1.4, field.shape[:2] + (1,))  # paper grain, no banding
    return Image.fromarray(np.clip(field, 0, 255).astype(np.uint8))


def maskable(sq: Image.Image) -> Image.Image:
    """Glyph shrunk into the maskable safe zone (inner 80% circle) on extended paper."""
    bg = paper(sq, MASTER)
    inner = round(MASTER * MASK_SCALE)
    fg = sq.resize((inner, inner), Image.LANCZOS)
    feather = round(MASTER * 0.05)
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rectangle((feather, feather, inner - feather, inner - feather), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 1.8))
    off = (MASTER - inner) // 2
    bg.paste(fg, (off, off), mask)
    return bg


def save_png(im: Image.Image, name: str, size: int) -> None:
    im.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print(f"  {name} {size}x{size}")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    sq = square()
    mk = maskable(sq)
    save_png(sq, "icon-192.png", 192)  # manifest "any" (+ high-dpi tab icon)
    save_png(sq, "icon-512.png", 512)  # manifest "any"
    save_png(mk, "icon-maskable-512.png", 512)  # manifest "maskable" (Android adaptive)
    save_png(sq, "apple-touch-icon.png", 180)  # iOS home screen — must be opaque, iOS rounds it
    sq.resize((256, 256), Image.LANCZOS).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("  favicon.ico 16/32/48")
