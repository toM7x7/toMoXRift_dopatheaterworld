"""Compose the world thumbnail as a before/after slider of one camera.

Left half: the cinema before the show (no share, house lights, every seat).
Right half: the same view during the show (room dissolved into the picture, no seats).
A straight white divider with a slider handle marks the boundary.

Usage: python scripts/compose_thumbnail.py [LABEL] [DATE]
  sources: docs/screenshots/thumbnail-source-{before,after}-LABEL-DATE.png (scripts/capture-thumb-pair.mjs)
  writes:  docs/screenshots/thumbnail-v9-DATE.png and public/thumbnail.png
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LABEL = sys.argv[1] if len(sys.argv) > 1 else 'back'
DATE = sys.argv[2] if len(sys.argv) > 2 else '2026-11-07'
SHOTS = ROOT / 'docs' / 'screenshots'
W, H = 1280, 720
SPLIT = W // 2
FONT = Path('C:/Windows/Fonts/NotoSansJP-VF.ttf')
FALLBACK = Path('C:/Windows/Fonts/YuGothB.ttc')

TITLE = 'ドパドバシネマ'
TITLE_EN = 'DOPADOBA CINEMA'
HOOK = '上映が始まると、部屋が映像に溶ける'
LABEL_BEFORE = '上映前'
LABEL_AFTER = '上映中'
PLATE = (10, 8, 16, 196)


def font(size: int, weight: int) -> ImageFont.FreeTypeFont:
    if FONT.exists():
        f = ImageFont.truetype(str(FONT), size)
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        return f
    return ImageFont.truetype(str(FALLBACK), size)


def divider(img: Image.Image, handle_y: int) -> Image.Image:
    """White line with a dark outline (reads on both the dark and the bright half) + handle."""
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ds = ImageDraw.Draw(shadow)
    ds.rectangle((SPLIT - 6, 0, SPLIT + 6, H), fill=(0, 0, 0, 150))
    ds.ellipse((SPLIT - 40, handle_y - 40, SPLIT + 40, handle_y + 40), fill=(0, 0, 0, 150))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(5)))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle((SPLIT - 2, 0, SPLIT + 2, H), fill=(255, 255, 255, 255))
    r = 32
    d.ellipse((SPLIT - r, handle_y - r, SPLIT + r, handle_y + r), fill=(255, 255, 255, 255))
    # ◀ ▶ arrows drawn as triangles (no font dependency).
    a, h = 11, 10
    d.polygon([(SPLIT - 6, handle_y - h), (SPLIT - 6, handle_y + h), (SPLIT - 6 - a, handle_y)], fill=(24, 20, 32, 255))
    d.polygon([(SPLIT + 6, handle_y - h), (SPLIT + 6, handle_y + h), (SPLIT + 6 + a, handle_y)], fill=(24, 20, 32, 255))
    return Image.alpha_composite(img, layer)


def chip(img: Image.Image, text: str, accent, anchor_x: int, y: int, align: str) -> Image.Image:
    f = font(30, 800)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    padx, pady, dot = 18, 10, 16
    w = (r - l) + padx * 2 + dot
    h = (b - t) + pady * 2
    x = anchor_x - w if align == 'right' else anchor_x
    d.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=PLATE)
    cy = y + h / 2
    d.ellipse((x + padx - 2, cy - 6, x + padx + 10, cy + 6), fill=accent)
    d.text((x + padx + dot - l, y + pady - t), text, font=f, fill=(248, 244, 252, 255))
    return Image.alpha_composite(img, layer)


def title_block(img: Image.Image) -> Image.Image:
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ft, fe, fh = font(60, 900), font(17, 700), font(24, 700)
    tb = d.textbbox((0, 0), TITLE, font=ft)
    eb = d.textbbox((0, 0), TITLE_EN, font=fe)
    hb = d.textbbox((0, 0), HOOK, font=fh)
    track = 6
    en_w = (eb[2] - eb[0]) + track * (len(TITLE_EN) - 1)
    inner_w = max(tb[2] - tb[0], hb[2] - hb[0], en_w)
    pad, gap1, gap2 = 22, 6, 10
    inner_h = (eb[3] - eb[1]) + gap1 + (tb[3] - tb[1]) + gap2 + (hb[3] - hb[1])
    right, top = W - 32, 24
    box = (right - inner_w - pad * 2, top, right, top + inner_h + pad * 2)
    assert box[0] > SPLIT + 20, f'title plate crosses the divider: {box}'
    print('title plate', box)
    d.rounded_rectangle(box, radius=18, fill=PLATE)
    x0, y = box[0] + pad, box[1] + pad
    cx = x0
    for ch in TITLE_EN:
        cb = d.textbbox((0, 0), ch, font=fe)
        d.text((cx - cb[0], y - eb[1]), ch, font=fe, fill=(255, 128, 226, 255))
        cx += (cb[2] - cb[0]) + track if ch != ' ' else 9 + track
    y += (eb[3] - eb[1]) + gap1
    d.text((x0 - tb[0], y - tb[1]), TITLE, font=ft, fill=(255, 255, 255, 255))
    y += (tb[3] - tb[1]) + gap2
    d.text((x0 - hb[0], y - hb[1]), HOOK, font=fh, fill=(236, 230, 246, 255))
    return Image.alpha_composite(img, layer)


def main():
    before = Image.open(SHOTS / f'thumbnail-source-before-{LABEL}-{DATE}.png').convert('RGBA')
    after = Image.open(SHOTS / f'thumbnail-source-after-{LABEL}-{DATE}.png').convert('RGBA')
    assert before.size == after.size == (W, H)
    img = before.copy()
    img.paste(after.crop((SPLIT, 0, W, H)), (SPLIT, 0))
    img = divider(img, handle_y=470)
    # Labels hug the divider near the bottom, over the seats (left) and the empty floor (right).
    img = chip(img, LABEL_BEFORE, (214, 70, 110, 255), SPLIT - 22, H - 86, 'right')
    img = chip(img, LABEL_AFTER, (90, 240, 255, 255), SPLIT + 22, H - 86, 'left')
    img = title_block(img)

    out = img.convert('RGB')
    work = SHOTS / f'thumbnail-v9-{DATE}.png'
    out.save(work, optimize=True)
    out.save(ROOT / 'public' / 'thumbnail.png', optimize=True)
    print(work)


if __name__ == '__main__':
    main()
