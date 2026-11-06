"""Compose the world thumbnail from the aligned before/after captures.

Left of a diagonal seam: the cinema (dissolve 0). Right: the same frame during the show
(dissolve 1). The seam is ragged and glows like the real dissolve rim, and runs from the
screen side toward the seats, the same direction the room burns away in the world.

Usage: python scripts/compose_thumbnail.py [DATE]   (sources: docs/screenshots/thumbnail-source-{before,after}-DATE.png)
Writes docs/screenshots/thumbnail-v6-DATE.png and public/thumbnail.png.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DATE = sys.argv[1] if len(sys.argv) > 1 else '2026-11-07'
SHOTS = ROOT / 'docs' / 'screenshots'
W, H = 1280, 720
FONT = Path('C:/Windows/Fonts/NotoSansJP-VF.ttf')
FALLBACK = Path('C:/Windows/Fonts/YuGothB.ttc')

TITLE = 'ドパガキシネマ'
TITLE_EN = 'DOPAGAKI CINEMA'
HOOK = '上映が始まると、部屋が映像に溶ける'
LABEL_BEFORE = '上映前'
LABEL_AFTER = '上映中'

# Seam: top x, bottom x, wobble amplitude (px)
SEAM_TOP, SEAM_BOTTOM, WOBBLE = 250, 700, 14


def font(size: int, weight: int) -> ImageFont.FreeTypeFont:
    if FONT.exists():
        f = ImageFont.truetype(str(FONT), size)
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        return f
    return ImageFont.truetype(str(FALLBACK), size)


def seam_x(y: float) -> float:
    base = SEAM_TOP + (SEAM_BOTTOM - SEAM_TOP) * y / H
    # Slow, soft wobble: a burning edge, not a lightning bolt.
    wob = math.sin(y * 0.011 + 1.3) * 0.65 + math.sin(y * 0.029 + 0.4) * 0.35
    return base + wob * WOBBLE


def seam_mask() -> Image.Image:
    """White = after (right of the seam)."""
    mask = Image.new('L', (W, H), 0)
    px = mask.load()
    for y in range(H):
        sx = seam_x(y)
        for x in range(W):
            d = x - sx
            px[x, y] = 255 if d >= 1 else 0 if d <= -1 else int((d + 1) * 127.5)
    return mask


def seam_glow(mask: Image.Image) -> Image.Image:
    """Glowing rim along the seam: thin hot core plus a soft coloured halo."""
    edge = mask.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 30 else 0)
    # FIND_EDGES also marks the picture's outer border; only the seam should glow.
    inner = Image.new('L', (W, H), 0)
    ImageDraw.Draw(inner).rectangle((3, 3, W - 4, H - 4), fill=255)
    edge = ImageChops.multiply(edge, inner)
    core = edge.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(2.0))
    halo = edge.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(16))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    pink = Image.new('RGBA', (W, H), (255, 120, 225, 0))
    pink.putalpha(halo.point(lambda v: min(220, int(v * 2.4))))
    white = Image.new('RGBA', (W, H), (255, 236, 250, 0))
    white.putalpha(core.point(lambda v: min(190, int(v * 1.1))))
    glow = Image.alpha_composite(glow, pink)
    return Image.alpha_composite(glow, white)


def plate(draw: ImageDraw.ImageDraw, box, radius=16, fill=(10, 8, 16, 186)):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def chip(img: Image.Image, xy, text: str, accent):
    f = font(26, 700)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    x, y = xy
    padx, pady = 16, 9
    box = (x, y, x + (r - l) + padx * 2 + 14, y + (b - t) + pady * 2)
    plate(d, box, radius=(box[3] - box[1]) // 2)
    cy = (box[1] + box[3]) / 2
    d.ellipse((x + padx - 2, cy - 5, x + padx + 8, cy + 5), fill=accent)
    d.text((x + padx + 14 - l, y + pady - t), text, font=f, fill=(245, 240, 250, 255))
    return Image.alpha_composite(img, layer)


def main():
    before = Image.open(SHOTS / f'thumbnail-source-before-{DATE}.png').convert('RGBA')
    after = Image.open(SHOTS / f'thumbnail-source-after-{DATE}.png').convert('RGBA')
    assert before.size == after.size == (W, H)
    mask = seam_mask()
    img = Image.composite(after, before, mask)
    img = Image.alpha_composite(img, seam_glow(mask))

    # Title block, bottom right over the lit floor.
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ft, fe, fh = font(78, 900), font(21, 700), font(30, 700)
    tb = d.textbbox((0, 0), TITLE, font=ft)
    eb = d.textbbox((0, 0), TITLE_EN, font=fe)
    hb = d.textbbox((0, 0), HOOK, font=fh)
    en_track = 6
    en_w = (eb[2] - eb[0]) + en_track * (len(TITLE_EN) - 1)
    inner_w = max(tb[2] - tb[0], hb[2] - hb[0], en_w)
    pad = 28
    gap1, gap2 = 6, 14
    inner_h = (eb[3] - eb[1]) + gap1 + (tb[3] - tb[1]) + gap2 + (hb[3] - hb[1])
    right, bottom = W - 40, H - 36
    box = (right - inner_w - pad * 2, bottom - inner_h - pad * 2, right, bottom)
    plate(d, box, radius=18)
    x0, y = box[0] + pad, box[1] + pad
    # English name, letter-spaced, in the halo's pink.
    cx = x0
    for ch in TITLE_EN:
        cb = d.textbbox((0, 0), ch, font=fe)
        d.text((cx - cb[0], y - eb[1]), ch, font=fe, fill=(255, 128, 226, 255))
        cx += (cb[2] - cb[0]) + en_track if ch != ' ' else 10 + en_track
    y += (eb[3] - eb[1]) + gap1
    d.text((x0 - tb[0], y - tb[1]), TITLE, font=ft, fill=(255, 255, 255, 255))
    y += (tb[3] - tb[1]) + gap2
    d.text((x0 - hb[0], y - hb[1]), HOOK, font=fh, fill=(236, 230, 246, 255))
    img = Image.alpha_composite(img, layer)

    # Which side is which, either side of the seam at the top.
    img = chip(img, (40, 36), LABEL_BEFORE, (214, 70, 110, 255))
    img = chip(img, (int(seam_x(40)) + 34, 36), LABEL_AFTER, (90, 240, 255, 255))

    out = img.convert('RGB')
    work = SHOTS / f'thumbnail-v6-{DATE}.png'
    out.save(work, optimize=True)
    out.save(ROOT / 'public' / 'thumbnail.png', optimize=True)
    print(work)
    print(ROOT / 'public' / 'thumbnail.png')


if __name__ == '__main__':
    main()
