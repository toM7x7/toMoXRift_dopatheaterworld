"""Draw dimensioned blueprints (SVG) for each part of the room from cinema_spec.

python blender/blueprints.py   ->  design/blueprints/*.svg
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cinema_spec as S  # noqa: E402

OUT = os.path.join(S.ROOT, 'design', 'blueprints')
os.makedirs(OUT, exist_ok=True)

INK = '#1d3557'
FILL = {
    'wall': '#d9dde6', 'fabric': '#c9c6d4', 'wood': '#d9b48c', 'brass': '#e2c27a', 'black': '#3a3a40',
    'velvet': '#c97a86', 'stage': '#9aa0aa', 'carpet': '#e7cfd6', 'seat': '#c97a86', 'frame': '#8d8a96',
    'glow': '#ffcf6b', 'exit': '#5fd38f', 'glass': '#9fb3c8', 'screen': '#f3f3f3', 'ceiling': '#dcdbe3',
}


class Sheet:
    def __init__(self, name, title, width=1400, height=900):
        self.name, self.title, self.w, self.h = name, title, width, height
        self.items = []

    def view(self, x0, y0, scale, ox, oy, flip_y=True):
        return View(self, x0, y0, scale, ox, oy, flip_y)

    def raw(self, s):
        self.items.append(s)

    def text(self, x, y, s, size=13, anchor='start', color=INK, weight='normal'):
        s = str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        self.raw(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" text-anchor="{anchor}" fill="{color}" font-weight="{weight}">{s}</text>')

    def save(self):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}" '
                f'font-family="Noto Sans JP, Yu Gothic, Meiryo, sans-serif">'
                f'<rect width="100%" height="100%" fill="#f7f8fb"/>'
                f'<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0,1 L10,5 L0,9 z" fill="{INK}"/></marker></defs>')
        frame = (f'<rect x="10" y="10" width="{self.w - 20}" height="{self.h - 20}" fill="none" stroke="{INK}" stroke-width="1.5"/>'
                 f'<rect x="{self.w - 600}" y="{self.h - 70}" width="590" height="60" fill="#fff" stroke="{INK}"/>'
                 f'<text x="{self.w - 590}" y="{self.h - 46}" font-size="16" fill="{INK}" font-weight="bold">ドパドバシネマ　{self.title}</text>'
                 f'<text x="{self.w - 590}" y="{self.h - 22}" font-size="12" fill="{INK}">単位 m ／ 寸法の正本 design/layout.json ＋ blender/cinema_spec.py</text>')
        with open(os.path.join(OUT, self.name + '.svg'), 'w', encoding='utf-8') as f:
            f.write(head + ''.join(self.items) + frame + '</svg>')


class View:
    """Maps meters to px. (ox, oy) = px position of the meter origin."""

    def __init__(self, sheet, x0, y0, scale, ox, oy, flip_y):
        self.s, self.k, self.ox, self.oy, self.flip = sheet, scale, ox, oy, flip_y

    def p(self, x, y):
        return self.ox + x * self.k, (self.oy - y * self.k) if self.flip else (self.oy + y * self.k)

    def rect(self, x0, y0, x1, y1, fill='none', stroke=INK, sw=1, dash=None, opacity=1):
        (a, b), (c, d) = self.p(x0, y0), self.p(x1, y1)
        da = f' stroke-dasharray="{dash}"' if dash else ''
        self.s.raw(f'<rect x="{min(a, c):.1f}" y="{min(b, d):.1f}" width="{abs(c - a):.1f}" height="{abs(d - b):.1f}" '
                   f'fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-width="{sw}"{da}/>')

    def poly(self, pts, fill='none', stroke=INK, sw=1, dash=None, closed=True):
        ps = ' '.join(f'{a:.1f},{b:.1f}' for a, b in (self.p(x, y) for x, y in pts))
        da = f' stroke-dasharray="{dash}"' if dash else ''
        tag = 'polygon' if closed else 'polyline'
        self.s.raw(f'<{tag} points="{ps}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{da}/>')

    def line(self, x0, y0, x1, y1, stroke=INK, sw=1, dash=None):
        (a, b), (c, d) = self.p(x0, y0), self.p(x1, y1)
        da = f' stroke-dasharray="{dash}"' if dash else ''
        self.s.raw(f'<line x1="{a:.1f}" y1="{b:.1f}" x2="{c:.1f}" y2="{d:.1f}" stroke="{stroke}" stroke-width="{sw}"{da}/>')

    def circle(self, x, y, r, fill='none', stroke=INK, sw=1):
        a, b = self.p(x, y)
        self.s.raw(f'<circle cx="{a:.1f}" cy="{b:.1f}" r="{max(1.5, r * self.k):.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def label(self, x, y, s, size=12, anchor='middle', color=INK, dy=0):
        a, b = self.p(x, y)
        self.s.text(a, b + dy, s, size, anchor, color)

    def dim(self, x0, y0, x1, y1, off, text=None, size=12):
        """Dimension line between two points, offset perpendicular by `off` meters."""
        dx, dy = x1 - x0, y1 - y0
        n = math.hypot(dx, dy) or 1
        nx, ny = -dy / n * off, dx / n * off
        a0, a1 = (x0 + nx, y0 + ny), (x1 + nx, y1 + ny)
        self.line(x0, y0, a0[0] + nx * 0.15, a0[1] + ny * 0.15, sw=0.6)
        self.line(x1, y1, a1[0] + nx * 0.15, a1[1] + ny * 0.15, sw=0.6)
        (pa, pb), (pc, pd) = self.p(*a0), self.p(*a1)
        self.s.raw(f'<line x1="{pa:.1f}" y1="{pb:.1f}" x2="{pc:.1f}" y2="{pd:.1f}" stroke="{INK}" stroke-width="0.9" '
                   f'marker-start="url(#a)" marker-end="url(#a)"/>')
        mx, my = (pa + pc) / 2, (pb + pd) / 2
        ang = math.degrees(math.atan2(pd - pb, pc - pa))
        if ang > 90 or ang < -90:
            ang += 180
        t = text if text is not None else f'{n:.2f}'.rstrip('0').rstrip('.')
        t = str(t).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        self.s.raw(f'<text x="{mx:.1f}" y="{my - 4:.1f}" font-size="{size}" text-anchor="middle" fill="{INK}" '
                   f'transform="rotate({ang:.1f} {mx:.1f} {my:.1f})" paint-order="stroke" stroke="#f7f8fb" stroke-width="3">{t}</text>')


def legend(sheet, x, y, entries):
    for i, (key, name) in enumerate(entries):
        sheet.raw(f'<rect x="{x}" y="{y + i * 22}" width="16" height="14" fill="{FILL[key]}" stroke="{INK}" stroke-width="0.6"/>')
        sheet.text(x + 24, y + i * 22 + 12, name, 12)


def notes(sheet, x, y, lines, size=13):
    for i, s in enumerate(lines):
        sheet.text(x, y + i * 20, s, size)


# ---------------------------------------------------------------------------------------
def plan():
    sh = Sheet('bp-00-plan', '00 平面図（上から）', 1400, 1000)
    v = sh.view(0, 0, 36, 420, 520, flip_y=False)  # x right, z down (screen at top)
    hw = S.HW
    v.rect(-hw, S.FRONT, hw, S.BACK, fill=FILL['wall'], sw=2)
    v.rect(-hw, S.FRONT, hw, S.RAKE_START, fill=FILL['stage'], opacity=0.6)
    v.rect(-hw, S.RAKE_START, hw, S.BACK, fill=FILL['carpet'], opacity=0.8)
    v.rect(-hw, S.RAKE_START - 0.025, hw, S.RAKE_START + 0.025, fill=FILL['brass'])
    v.line(-hw, S.RAKE_END, hw, S.RAKE_END, dash='6 4')
    # screen + mask
    v.rect(-S.SC_W / 2 - S.MASK_W, S.FRONT, S.SC_W / 2 + S.MASK_W, S.MASK_FRONT_Z, fill=FILL['black'])
    v.rect(-S.SC_W / 2, S.SC_Z - 0.03, S.SC_W / 2, S.SC_Z + 0.03, fill=FILL['screen'])
    for sgn in (-1, 1):
        v.rect(sgn * S.CURTAIN_INNER, S.FRONT, sgn * hw, S.FRONT + 0.4, fill=FILL['velvet'])
    # pilasters + doors
    for z in S.PILASTER_Z:
        for sgn in (-1, 1):
            v.rect(sgn * hw, z - S.PILASTER_W / 2, sgn * (hw - S.PILASTER_D), z + S.PILASTER_W / 2, fill=FILL['velvet'])
    for sgn in (-1, 1):
        v.rect(sgn * hw, S.DOOR_Z - S.DOOR_W / 2, sgn * (hw + 0.25), S.DOOR_Z + S.DOOR_W / 2, fill=FILL['wood'])
        v.label(sgn * (hw + 0.7), S.DOOR_Z, '扉', 12, dy=4)
    # seats + arms
    for (x, y, z) in S.seat_spots():
        v.rect(x - S.SEAT_WIDTH / 2, z - 0.27, x + S.SEAT_WIDTH / 2, z + 0.33, fill=FILL['seat'], sw=0.5)
    for (x, y, z) in S.arm_spots():
        v.rect(x - 0.03, z - 0.3, x + 0.03, z + 0.3, fill=FILL['frame'], sw=0.4)
    for (x, y, z) in S.step_lights():
        v.rect(x - 0.08, z - 0.035, x + 0.08, z + 0.035, fill=FILL['glow'], sw=0.4)
    # projector
    bx, by, bz = S.PROJ_BASE
    v.rect(bx - S.PEDESTAL['w'] / 2, bz - S.PEDESTAL['d'] / 2, bx + S.PEDESTAL['w'] / 2, bz + S.PEDESTAL['d'] / 2, fill=FILL['frame'])
    v.line(0, bz - S.LENS_FWD, -S.SC_W / 2, S.SC_Z, dash='3 3', stroke='#c47f00')
    v.line(0, bz - S.LENS_FWD, S.SC_W / 2, S.SC_Z, dash='3 3', stroke='#c47f00')
    for z in S.BEAM_Z:
        v.line(-S.SOFFIT_INNER, z, S.SOFFIT_INNER, z, dash='2 5', stroke='#7a7f8c')
    sx, sy, sz = L_spawn = S.L['spawn']
    v.circle(sx, sz, 0.18, fill='#2a9d8f')
    v.label(sx + 0.3, sz, 'スポーン', 11, 'start', dy=4)
    # dims
    v.dim(-hw, S.FRONT, hw, S.FRONT, -0.9, '16.0（幅）')
    v.dim(-hw, S.FRONT, -hw, S.BACK, 1.3, '22.0（奥行）')
    v.dim(hw, S.FRONT, hw, S.RAKE_START, -1.3, '8.0 舞台（平ら・つや）')
    v.dim(hw, S.RAKE_START, hw, S.RAKE_END, -1.3, '11.0 客席の斜面（+1.6）')
    v.dim(hw, S.RAKE_END, hw, S.BACK, -1.3, '3.0 後ろの台')
    v.dim(-S.AISLE_HALF, S.BACK - 0.3, S.AISLE_HALF, S.BACK - 0.3, 0.5, '通路 1.9')
    r0 = S.SEAT_ROWS[0] + 0.3
    v.dim(S.AISLE_HALF + 0.36, r0, S.AISLE_HALF + 0.36 + S.SEAT_PITCH, r0, -0.55, '0.66')
    v.dim(6.6, S.SEAT_ROWS[0] + 0.3, 6.6, S.SEAT_ROWS[1] + 0.3, 0.3, '列 2.0')
    v.dim(-S.SC_W / 2, S.FRONT + 0.6, S.SC_W / 2, S.FRONT + 0.6, 0.4, 'スクリーン 9.6')
    v.dim(-hw, S.PILASTER_Z[1], -hw, S.PILASTER_Z[2], -0.9, '柱 3.6')
    legend(sh, 1000, 120, [('stage', '舞台（つやのある黒）'), ('carpet', 'じゅうたん'), ('brass', '真鍮の見切り'), ('velvet', 'ベルベット（柱・カーテン）'),
                            ('seat', '座席（80席）'), ('frame', '肘掛け・映写機台'), ('glow', '段差灯'), ('wood', '扉')])
    notes(sh, 1000, 330, ['座席 5列 × 16席。左右8席ずつ、中央に通路。', '座席の体には当たり判定なし（列の間で詰まらない）。',
                          '各座席は <Seat> で座れる。座面＝クッション上面。', '映写機は後ろの台の中央。触ると自分の光の強さを切替。',
                          '点線＝天井の梁（柱の位置にそろえる）。', '橙の点線＝映写の光の通り道。'])
    sh.save()


def section():
    sh = Sheet('bp-01-section', '01 縦断面図（横から・x=2 で切断）', 1500, 700)
    v = sh.view(0, 0, 50, 760, 560)  # z horizontal, y up
    zs = [S.FRONT + i * 0.1 for i in range(int((S.BACK - S.FRONT) / 0.1) + 1)]
    v.poly([(S.FRONT, -0.4)] + [(z, S.floor_y(z)) for z in zs] + [(S.BACK, -0.4)], fill=FILL['carpet'])
    v.rect(S.FRONT, -0.4, S.RAKE_START, 0, fill=FILL['stage'])
    v.rect(S.FRONT - 0.2, -0.4, S.FRONT, S.H, fill=FILL['wall'])
    v.rect(S.BACK, -0.4, S.BACK + 0.2, S.H, fill=FILL['wall'])
    v.rect(S.FRONT, S.H, S.BACK, S.H + 0.2, fill=FILL['wall'])
    v.rect(S.FRONT, S.SC_Y - S.SC_H / 2, S.SC_Z, S.SC_Y + S.SC_H / 2, fill=FILL['screen'])
    v.rect(S.FRONT, S.VALANCE_BOTTOM, S.FRONT + 0.3, S.H, fill=FILL['velvet'])
    for z in S.BEAM_Z:
        v.rect(z - S.BEAM_W / 2, S.H - S.BEAM_D, z + S.BEAM_W / 2, S.H, fill=FILL['ceiling'])
        v.rect(z - S.BEAM_W / 2 - 0.03, S.H - 0.04, z - S.BEAM_W / 2, S.H, fill=FILL['glow'], sw=0.3)
        v.rect(z + S.BEAM_W / 2, S.H - 0.04, z + S.BEAM_W / 2 + 0.03, S.H, fill=FILL['glow'], sw=0.3)
    for rz in S.SEAT_ROWS:
        z = rz + 0.3
        y = S.floor_y(z)
        t = math.radians(S.BACKREST['tilt_deg'])
        v.poly([(z - 0.27, y + 0.35), (z - 0.27, y + S.CUSHION_TOP), (z + 0.2, y + S.CUSHION_TOP), (z + 0.2 + math.sin(t) * 0.68, y + S.BACK_TOP),
                (z + 0.33 + math.sin(t) * 0.68, y + S.BACK_TOP), (z + 0.33, y + 0.3), (z + 0.2, y), (z - 0.1, y), (z - 0.1, y + 0.35)], fill=FILL['seat'], sw=0.8)
        v.circle(z + 0.05, y + 1.2, 0.1, fill='#fff')  # seated eye
    bx, by, bz = S.PROJ_BASE
    v.rect(bz - 0.25, by, bz + 0.25, by + S.PEDESTAL['h'], fill=FILL['frame'])
    v.rect(bz - 0.31, by + S.LENS_H - 0.21, bz + 0.31, by + S.LENS_H + 0.21, fill=FILL['black'])
    v.circle(bz - 0.25, by + S.LENS_H + 0.55, S.REEL_R)
    v.circle(bz + 0.25, by + S.LENS_H + 0.6, S.REEL_R)
    lz, ly = bz - S.LENS_FWD, by + S.LENS_H
    v.line(lz, ly, S.SC_Z, S.SC_Y + S.SC_H / 2, stroke='#c47f00', dash='4 3')
    v.line(lz, ly, S.SC_Z, S.SC_Y - S.SC_H / 2, stroke='#c47f00', dash='4 3')
    v.dim(S.FRONT, 0, S.FRONT, S.H, 0.9, '天井 8.0')
    v.dim(S.FRONT + 0.4, 0, S.FRONT + 0.4, S.SC_Y - S.SC_H / 2, -0.5, '1.2')
    v.dim(S.FRONT + 0.4, S.SC_Y - S.SC_H / 2, S.FRONT + 0.4, S.SC_Y + S.SC_H / 2, -0.5, 'スクリーン 5.4')
    v.dim(S.RAKE_END, 0, S.RAKE_END, S.RAKE_RISE, -0.4, '+1.6')
    v.dim(bz + 0.6, by, bz + 0.6, by + S.LENS_H, -0.3, 'レンズ 1.75')
    v.dim(S.BEAM_Z[2] - 0.2, S.H - S.BEAM_D, S.BEAM_Z[2] - 0.2, S.H, 0.4, '梁 0.5')
    v.dim(S.RAKE_START, -0.4, S.RAKE_END, -0.4, -0.5, '斜面 11.0（勾配 8.3°）')
    notes(sh, 40, 60, ['スクリーン下端 1.2、上端 6.6。中段の席で目の高さ ≒ 床 +1.2。', '映写の光は頭上を通る（最前列の座った頭より上）。',
                       '梁の両脇に間接照明の線（黄色）。'])
    sh.save()


def front_elevation():
    sh = Sheet('bp-p1-front', 'P1 スクリーンまわり（前の壁・正面図）', 1400, 980)
    v = sh.view(0, 0, 70, 700, 700)
    hw = S.HW
    v.rect(-hw, 0, hw, S.H, fill=FILL['fabric'], sw=2)
    for x in (-4.8, -2.4, 0, 2.4, 4.8):
        v.line(x, 0.2, x, S.SC_Y - S.SC_H / 2 - S.MASK_W, stroke='#8f8aa0', sw=0.6)
    v.line(-hw, S.SC_Y - S.SC_H / 2 - S.MASK_W - 0.6, hw, S.SC_Y - S.SC_H / 2 - S.MASK_W - 0.6, stroke='#8f8aa0', sw=0.6)
    m = S.MASK_W
    v.rect(-S.SC_W / 2 - m, S.SC_Y - S.SC_H / 2 - m, S.SC_W / 2 + m, S.SC_Y + S.SC_H / 2 + m, fill=FILL['black'])
    v.rect(-S.SC_W / 2 - S.BRASS_LIP, S.SC_Y - S.SC_H / 2 - S.BRASS_LIP, S.SC_W / 2 + S.BRASS_LIP, S.SC_Y + S.SC_H / 2 + S.BRASS_LIP, fill=FILL['brass'])
    v.rect(-S.SC_W / 2, S.SC_Y - S.SC_H / 2, S.SC_W / 2, S.SC_Y + S.SC_H / 2, fill=FILL['screen'])
    v.label(0, S.SC_Y, 'スクリーン（画面共有）', 16, dy=5)
    v.rect(-hw, S.VALANCE_BOTTOM, hw, S.H, fill=FILL['velvet'])
    x = -hw
    while x < hw:
        v.line(x, S.VALANCE_BOTTOM, x, S.H, stroke='#8e3b48', sw=0.5)
        x += S.VALANCE_PLEAT
    v.line(-hw, S.VALANCE_BOTTOM, hw, S.VALANCE_BOTTOM, stroke=FILL['brass'], sw=3)
    v.line(-hw, S.H - 0.03, hw, S.H - 0.03, stroke=FILL['glow'], sw=3)
    for sgn in (-1, 1):
        top0, top1 = sgn * S.CURTAIN_INNER, sgn * hw
        tie0, tie1 = sgn * (hw - 0.55), sgn * hw
        bot0 = sgn * (hw - 0.85)
        v.poly([(top0, S.CURTAIN_TOP), (top1, S.CURTAIN_TOP), (tie1, S.CURTAIN_TIE_Y), (tie1, 0), (bot0, 0), (tie0, S.CURTAIN_TIE_Y)], fill=FILL['velvet'])
        v.rect(tie0 - 0.05 * sgn, S.CURTAIN_TIE_Y - 0.05, tie1, S.CURTAIN_TIE_Y + 0.05, fill=FILL['brass'])
    v.rect(-hw, -0.25, hw, 0, fill=FILL['stage'])
    v.dim(-S.SC_W / 2, S.SC_Y + S.SC_H / 2 + m, S.SC_W / 2, S.SC_Y + S.SC_H / 2 + m, 0.35, '9.6')
    v.dim(S.SC_W / 2 + m, S.SC_Y - S.SC_H / 2, S.SC_W / 2 + m, S.SC_Y + S.SC_H / 2, -0.35, '5.4')
    v.dim(S.SC_W / 2 + m, 0, S.SC_W / 2 + m, S.SC_Y - S.SC_H / 2, -0.35, '1.2')
    v.dim(-S.SC_W / 2 - m, S.SC_Y - S.SC_H / 2 - m - 0.0, -S.SC_W / 2, S.SC_Y - S.SC_H / 2 - m, -0.3, '0.35 黒枠')
    v.dim(S.CURTAIN_INNER, S.CURTAIN_TOP, hw, S.CURTAIN_TOP, 0.0, '1.3')
    v.dim(-hw, S.VALANCE_BOTTOM, -hw, S.H, -0.3, '0.75')
    v.dim(-hw, 0, -hw, S.CURTAIN_TIE_Y, -0.3, '1.35 留め')
    v.dim(-hw, 0, hw, 0, -0.55, '16.0')
    legend(sh, 40, 790, [('fabric', '布張りの壁'), ('black', '黒ベルベットの枠'), ('brass', '真鍮'), ('velvet', 'カーテン・上飾り'), ('glow', '間接照明'), ('stage', '舞台の床')])
    notes(sh, 30, 40, ['黒枠は壁から 0.16 出る。内側に幅 0.025 の真鍮の縁。', 'カーテンは隅でまとめ、真鍮の留め具で 1.35 の高さに留める。',
                       '上飾り（バランス）は 7.25〜8.0 のひだ。下端に真鍮の線、上端に間接照明。', '後光（加算の板）はこの壁の手前 0.03 に重なる。'])
    sh.save()


def side_elevation():
    sh = Sheet('bp-p2-side', 'P2 横の壁（室内から見た立面）', 1700, 760)
    v = sh.view(0, 0, 62, 850 + 0 * 62, 640)
    hw = S.HW

    def X(z):  # screen side on the left
        return z

    v.rect(X(S.FRONT), 0, X(S.BACK), S.H, fill=FILL['fabric'], sw=2)
    v.rect(X(S.FRONT), S.H - S.SOFFIT_DROP, X(S.BACK), S.H, fill=FILL['ceiling'])
    v.line(X(S.FRONT), S.H - S.SOFFIT_DROP, X(S.BACK), S.H - S.SOFFIT_DROP, stroke=FILL['glow'], sw=3)
    zs = [S.FRONT + i * 0.1 for i in range(221)]
    v.poly([(X(z), S.floor_y(z) + S.WAINSCOT_H) for z in zs] + [(X(S.BACK), -0.3), (X(S.FRONT), -0.3)], fill=FILL['wood'])
    v.poly([(X(z), S.floor_y(z) + S.WAINSCOT_H) for z in zs], stroke=FILL['brass'], sw=3, closed=False)
    v.poly([(X(S.FRONT), -0.3)] + [(X(z), S.floor_y(z)) for z in zs] + [(X(S.BACK), -0.3)], fill=FILL['carpet'])
    for (z0, z1, kind) in S.side_bays():
        for (a, b, bottom) in S.bay_panels(z0, z1, kind):
            v.poly([(X(a), bottom(a)), (X(b), bottom(b)), (X(b), S.PANEL_TOP), (X(a), S.PANEL_TOP)], fill='#b9b5c6', sw=0.6)
        if kind == 'door':
            y0 = S.RAKE_RISE
            v.rect(X(S.DOOR_Z - S.DOOR_W / 2 - S.DOOR_FRAME), y0, X(S.DOOR_Z + S.DOOR_W / 2 + S.DOOR_FRAME), y0 + S.DOOR_H + S.DOOR_FRAME, fill=FILL['brass'])
            v.rect(X(S.DOOR_Z - S.DOOR_W / 2), y0, X(S.DOOR_Z + S.DOOR_W / 2), y0 + S.DOOR_H, fill=FILL['wood'])
            v.line(X(S.DOOR_Z), y0, X(S.DOOR_Z), y0 + S.DOOR_H)
            v.rect(X(S.DOOR_Z - S.SIGN_W / 2), S.SIGN_Y - S.SIGN_H / 2, X(S.DOOR_Z + S.SIGN_W / 2), S.SIGN_Y + S.SIGN_H / 2, fill=FILL['exit'])
            v.dim(X(S.DOOR_Z - S.DOOR_W / 2), y0, X(S.DOOR_Z + S.DOOR_W / 2), y0, -0.35, '扉 1.8')
            v.dim(X(S.DOOR_Z + S.DOOR_W / 2 + 0.1), y0, X(S.DOOR_Z + S.DOOR_W / 2 + 0.1), y0 + S.DOOR_H, -0.25, '2.4')
    for z in S.PILASTER_Z:
        v.rect(X(z - S.PILASTER_W / 2), 0, X(z + S.PILASTER_W / 2), S.PILASTER_TOP, fill=FILL['velvet'])
        y = S.floor_y(z) + S.SCONCE_H
        v.rect(X(z - 0.13), y - 0.16, X(z + 0.13), y + 0.16, fill=FILL['brass'])
        v.poly([(X(z - 0.13), y + 0.16), (X(z + 0.13), y + 0.16), (X(z + 0.3), y + 0.9), (X(z - 0.3), y + 0.9)], fill=FILL['glow'], stroke='none')
    p = S.PILASTER_Z
    v.dim(X(p[1]), S.H, X(p[2]), S.H, 0.35, '柱の間隔 3.6')
    v.dim(X(p[0] - S.PILASTER_W / 2), S.PILASTER_TOP, X(p[0] + S.PILASTER_W / 2), S.PILASTER_TOP, 0.2, '0.5')
    v.dim(X(S.FRONT), 0, X(S.FRONT), S.WAINSCOT_H, 0.35, '木 1.9（床から）')
    v.dim(X(S.FRONT), S.WAINSCOT_H, X(S.FRONT), S.PANEL_TOP, 0.35, '布パネル')
    v.dim(X(S.FRONT), S.H - S.SOFFIT_DROP, X(S.FRONT), S.H, 0.35, '0.8')
    v.dim(X(p[3] + 0.4), S.floor_y(p[3]), X(p[3] + 0.4), S.floor_y(p[3]) + S.SCONCE_H, -0.2, '照明 3.0')
    v.label(X(S.FRONT + 0.3), 0.9, '← スクリーン側', 13, 'start')
    v.label(X(S.BACK - 0.3), 3.0, '後ろ →', 13, 'end')
    legend(sh, 40, 40, [('fabric', '布の壁'), ('wood', '木のスラット（幅 0.045・間隔 0.09）'), ('brass', '真鍮の線・照明・扉枠'), ('velvet', '付け柱（ベルベット）'),
                        ('exit', '非常口サイン'), ('glow', '光')])
    notes(sh, 520, 40, ['腰の木のスラットは床の傾きに沿う（床から 1.9）。上端に真鍮の線。', '布パネルは柱の間を3枚（扉の区画は扉の上を避ける）。目地 0.04。',
                        '付け柱は壁から 0.22 出る。照明は床から 3.0 の高さで上向きに光る。', '天井際は下がり天井（0.8）で、下端に間接照明の線。'])
    sh.save()


def ceiling_plan():
    sh = Sheet('bp-p3-ceiling', 'P3 天井伏図（下から見上げ）', 1400, 1000)
    v = sh.view(0, 0, 36, 420, 520, flip_y=False)
    hw = S.HW
    v.rect(-hw, S.FRONT, hw, S.BACK, fill=FILL['ceiling'], sw=2)
    for sgn in (-1, 1):
        v.rect(sgn * hw, S.FRONT, sgn * S.SOFFIT_INNER, S.BACK, fill='#c4c2cd')
        v.line(sgn * S.SOFFIT_INNER, S.FRONT, sgn * S.SOFFIT_INNER, S.BACK, stroke=FILL['glow'], sw=3)
    for z in S.BEAM_Z:
        v.rect(-S.SOFFIT_INNER, z - S.BEAM_W / 2, S.SOFFIT_INNER, z + S.BEAM_W / 2, fill='#a9a6b6')
        v.line(-S.SOFFIT_INNER, z - S.BEAM_W / 2 - 0.05, S.SOFFIT_INNER, z - S.BEAM_W / 2 - 0.05, stroke=FILL['glow'], sw=2.5)
        v.line(-S.SOFFIT_INNER, z + S.BEAM_W / 2 + 0.05, S.SOFFIT_INNER, z + S.BEAM_W / 2 + 0.05, stroke=FILL['glow'], sw=2.5)
    for (x0, x1, z0, z1) in S.coffers():
        for fx in (0.25, 0.5, 0.75):
            v.circle(x0 + (x1 - x0) * fx, (z0 + z1) / 2, 0.08, fill=FILL['glow'])
    v.rect(-hw, S.FRONT, hw, S.FRONT + 0.25, fill=FILL['velvet'])
    v.dim(-S.SOFFIT_INNER, S.FRONT, S.SOFFIT_INNER, S.FRONT, 1.0, '14.2（下がり天井の間）')
    v.dim(hw, S.BEAM_Z[1], hw, S.BEAM_Z[2], -1.0, '3.6')
    v.dim(-hw, S.BEAM_Z[3] - S.BEAM_W / 2, -hw, S.BEAM_Z[3] + S.BEAM_W / 2, 1.0, '梁幅 0.4')
    v.dim(-hw, S.BACK - 1, -S.SOFFIT_INNER, S.BACK - 1, -0.4, '0.9')
    legend(sh, 1000, 120, [('ceiling', '天井（布）'), ('frame', '梁（深さ 0.5）'), ('glow', '間接照明・ダウンライト'), ('velvet', '上飾り')])
    notes(sh, 1000, 260, ['梁は横の壁の柱の位置（6本）にそろえる。', '梁の両脇の天井際に間接照明の線（深さ 0.025）。', '下がり天井（幅 0.9・下がり 0.8）の内側の下端にも線。',
                          'ダウンライトは梁の間に3つずつ（客電と一緒に暗くなる）。', '上映中は間接照明・ダウンライトとも 25% ほどまで落とす。'])
    sh.save()


def floor_plan():
    sh = Sheet('bp-p4-floor', 'P4 床の仕上げ（舞台・じゅうたん・段差灯）', 1400, 1000)
    v = sh.view(0, 0, 36, 420, 520, flip_y=False)
    hw = S.HW
    v.rect(-hw, S.FRONT, hw, S.RAKE_START, fill=FILL['stage'], sw=2)
    v.rect(-hw, S.RAKE_START, hw, S.BACK, fill=FILL['carpet'], sw=2)
    v.rect(-S.AISLE_HALF, S.RAKE_START, S.AISLE_HALF, S.BACK, fill='#dcbcc6', sw=0.6)
    v.rect(-hw, S.RAKE_START - S.STAGE_EDGE_W / 2, hw, S.RAKE_START + S.STAGE_EDGE_W / 2, fill=FILL['brass'])
    for (x, y, z) in S.step_lights():
        v.rect(x - 0.08, z - 0.035, x + 0.08, z + 0.035, fill=FILL['glow'], sw=0.5)
    # carpet motif tile
    t = Sheet  # noqa
    ox, oy = 1010, 360
    sh.raw(f'<rect x="{ox}" y="{oy}" width="240" height="240" fill="#6b2a3a" stroke="{INK}"/>')
    for i in range(4):
        for j in range(4):
            cx, cy = ox + 30 + i * 60, oy + 30 + j * 60
            col = '#e2c27a' if (i + j) % 2 == 0 else '#5fb3a8'
            sh.raw(f'<rect x="{cx - 9}" y="{cy - 9}" width="18" height="18" fill="none" stroke="{col}" stroke-width="2" transform="rotate(45 {cx} {cy})"/>')
            sh.raw(f'<circle cx="{cx + 30}" cy="{cy + 30}" r="2.5" fill="#e2c27a"/>')
    sh.text(ox, oy - 10, 'じゅうたんの柄（0.6 m 角の繰り返し・シェーダーで描く）', 12)
    sx, sy = 1010, 690
    sh.raw(f'<rect x="{sx}" y="{sy}" width="200" height="80" fill="{FILL["brass"]}" stroke="{INK}"/>')
    sh.raw(f'<rect x="{sx + 18}" y="{sy + 22}" width="164" height="36" fill="{FILL["glow"]}" stroke="{INK}"/>')
    sh.text(sx, sy - 10, '段差灯（真鍮枠 0.16 × 0.07、高さ 0.02）', 12)
    v.dim(hw, S.FRONT, hw, S.RAKE_START, -1.0, '舞台 8.0（つやのある黒・映り込み強）')
    v.dim(-hw, S.RAKE_START, -hw, S.BACK, 1.0, 'じゅうたん 14.0（斜面 11 ＋ 台 3）')
    v.dim(-S.AISLE_HALF, S.BACK - 0.5, S.AISLE_HALF, S.BACK - 0.5, 0.4, '通路 1.9')
    sl = S.step_lights()
    v.dim(sl[20][0], sl[20][2], sl[22][0], sl[22][2], -0.6, f'{S.STEP_PITCH}')
    legend(sh, 1000, 120, [('stage', '舞台（黒・鏡面ぎみ）'), ('carpet', 'じゅうたん（えんじ地）'), ('brass', '真鍮の見切り 0.05'), ('glow', '段差灯（通路の両端）')])
    notes(sh, 1000, 240, ['舞台とじゅうたんの境目（z=-3）に真鍮の見切り。', '通路の段差灯は 1.1 m おき、通路の端から 0.08 内側。', '舞台は映り込み強め、じゅうたんは弱め。'])
    sh.save()


def seat_detail():
    sh = Sheet('bp-p5-seat', 'P5 座席の詳細（正面・側面）', 1400, 820)
    k = 330
    front = sh.view(0, 0, k, 330, 700)
    side = sh.view(0, 0, k, 1000, 700)
    c, b, a = S.CUSHION, S.BACKREST, S.ARM
    w = S.SEAT_WIDTH
    # front view: two arms + seat
    for sgn in (-1, 1):
        x = sgn * S.SEAT_PITCH / 2
        front.rect(x - a['panel_w'] / 2, 0, x + a['panel_w'] / 2, a['top_y'], fill=FILL['frame'])
        front.rect(x - a['top_w'] / 2, a['top_y'], x + a['top_w'] / 2, a['top_y'] + a['top_t'], fill='#4a4652')
        front.rect(x - a['cup_r'], a['top_y'] + a['top_t'], x + a['cup_r'], a['top_y'] + a['top_t'] + 0.012, fill=FILL['brass'])
        front.rect(x - a['panel_w'] / 2 - 0.02, 0, x + a['panel_w'] / 2 + 0.02, 0.02, fill=FILL['black'])
    front.rect(-w / 2, S.CUSHION_TOP - c['t'], w / 2, S.CUSHION_TOP, fill=FILL['seat'])
    front.rect(-b['w'] / 2, S.CUSHION_TOP - 0.04, b['w'] / 2, S.BACK_TOP, fill=FILL['seat'])
    front.rect(-0.2, 0.18, 0.2, S.CUSHION_TOP - c['t'], fill=FILL['frame'])
    front.dim(-S.SEAT_PITCH / 2, 0, S.SEAT_PITCH / 2, 0, -0.08, '0.66（座席の間隔＝肘掛けの中心間）')
    front.dim(-w / 2, S.BACK_TOP, w / 2, S.BACK_TOP, 0.06, f'{w}')
    front.dim(S.SEAT_PITCH / 2 + 0.1, 0, S.SEAT_PITCH / 2 + 0.1, S.CUSHION_TOP, -0.06, f'座面 {S.CUSHION_TOP}')
    front.dim(-S.SEAT_PITCH / 2 - 0.1, 0, -S.SEAT_PITCH / 2 - 0.1, a['top_y'] + a['top_t'], 0.06, '肘掛け 0.67')
    front.dim(-S.SEAT_PITCH / 2 - 0.25, 0, -S.SEAT_PITCH / 2 - 0.25, S.BACK_TOP, 0.06, f'背 {S.BACK_TOP}')
    # side view (z horizontal: front of the seat on the left)
    t = math.radians(b['tilt_deg'])
    z0 = c['z0']
    side.poly([(z0, S.CUSHION_TOP - c['t']), (z0, S.CUSHION_TOP), (z0 + c['d'], S.CUSHION_TOP), (z0 + c['d'], S.CUSHION_TOP - c['t'])], fill=FILL['seat'])
    bz = b['z']
    side.poly([(bz, S.CUSHION_TOP - 0.04), (bz + math.sin(t) * 0.68, S.BACK_TOP), (bz + b['t'] + math.sin(t) * 0.68, S.BACK_TOP), (bz + b['t'], S.CUSHION_TOP - 0.04)], fill=FILL['seat'])
    side.rect(-a['panel_d'] / 2, 0, a['panel_d'] / 2, a['top_y'], fill=FILL['frame'], opacity=0.55)
    side.rect(-a['top_d'] / 2 - 0.04, a['top_y'], a['top_d'] / 2 - 0.04, a['top_y'] + a['top_t'], fill='#4a4652', opacity=0.8)
    side.circle(0, S.CUSHION_TOP + 0.02, 0.012, fill='#2a9d8f')
    side.label(0.03, S.CUSHION_TOP + 0.05, '座る点（<Seat> の原点）', 12, 'start')
    side.dim(z0, 0, z0 + c['d'], 0, -0.08, f'座面の奥行 {c["d"]}')
    side.dim(-a['panel_d'] / 2, a['top_y'] + a['top_t'] + 0.02, a['panel_d'] / 2, a['top_y'] + a['top_t'] + 0.02, 0.05, f'{a["panel_d"]}')
    side.label(bz + 0.2, S.BACK_TOP + 0.05, f'背もたれ {b["tilt_deg"]}° 後ろへ', 12)
    side.label(-0.35, 0.05, '← スクリーン側', 12, 'end')
    legend(sh, 40, 40, [('seat', 'ベルベット（背・座面）'), ('frame', '濃灰の金属（脚・側板）'), ('brass', '真鍮（カップホルダー・縁）')])
    notes(sh, 520, 40, ['肘掛けは隣の席と共有（列ごとに 9 本）。列の端は木の側板。', 'カップホルダーは肘掛けの前寄り（中心から 0.22 前）。',
                        '座席は Blender で1脚だけ作り、ワールドで 80 脚に並べる（インスタンス）。', '座る判定は見えない箱（座面の上）。他の人が座っている席は座れない。'])
    sh.save()


def back_elevation():
    sh = Sheet('bp-p6-back', 'P6 後ろ（後ろの壁と映写機・正面図）', 1400, 860)
    v = sh.view(0, 0, 70, 700, 760)
    hw = S.HW
    base = S.RAKE_RISE
    v.rect(-hw, base, hw, S.H, fill=FILL['fabric'], sw=2)
    v.rect(-hw, base - 0.3, hw, base, fill=FILL['carpet'])
    for (x0, x1) in S.BACK_SLAT_X:
        v.rect(x0, base, x1, S.PANEL_TOP, fill=FILL['wood'])
        x = x0
        while x < x1:
            v.line(x, base, x, S.PANEL_TOP, stroke='#9b6b43', sw=0.5)
            x += S.SLAT_PITCH
    v.rect(-hw, S.H - S.SOFFIT_DROP, hw, S.H, fill=FILL['ceiling'])
    v.line(-hw, S.H - S.SOFFIT_DROP, hw, S.H - S.SOFFIT_DROP, stroke=FILL['glow'], sw=3)
    for x in S.BOOTH_WINDOWS_X:
        bw = S.BOOTH_WIN
        v.rect(x - bw['w'] / 2 - 0.05, bw['y'] - bw['h'] / 2 - 0.05, x + bw['w'] / 2 + 0.05, bw['y'] + bw['h'] / 2 + 0.05, fill=FILL['brass'])
        v.rect(x - bw['w'] / 2, bw['y'] - bw['h'] / 2, x + bw['w'] / 2, bw['y'] + bw['h'] / 2, fill=FILL['glass'])
    pw, ph = S.PEDESTAL['w'], S.PEDESTAL['h']
    v.rect(-pw / 2 - 0.05, base, pw / 2 + 0.05, base + 0.12, fill=FILL['black'])
    v.rect(-pw / 2, base + 0.12, pw / 2, base + ph, fill=FILL['fabric'])
    v.rect(-pw / 2 - 0.03, base + ph - 0.05, pw / 2 + 0.03, base + ph, fill=FILL['brass'])
    bw_, bh_ = S.PROJ_BODY['w'], S.PROJ_BODY['h']
    v.rect(-bw_ / 2, base + S.LENS_H - bh_ / 2, bw_ / 2, base + S.LENS_H + bh_ / 2, fill=FILL['black'])
    v.circle(0, base + S.LENS_H, 0.08, fill=FILL['glass'])
    v.rect(-0.03, base + S.LENS_H + bh_ / 2, 0.03, base + S.LENS_H + 0.85, fill=FILL['frame'])
    v.circle(0, base + S.LENS_H + 0.6, S.REEL_R)
    v.dim(-hw, base, hw, base, -0.35, '16.0')
    v.dim(pw / 2 + 0.2, base, pw / 2 + 0.2, base + S.LENS_H, -0.3, 'レンズ 1.75')
    v.dim(-pw / 2, base + ph + 0.05, pw / 2, base + ph + 0.05, 0.15, '台 0.5')
    bw = S.BOOTH_WIN
    v.dim(S.BOOTH_WINDOWS_X[1] - bw['w'] / 2, bw['y'] + bw['h'] / 2 + 0.05, S.BOOTH_WINDOWS_X[1] + bw['w'] / 2, bw['y'] + bw['h'] / 2 + 0.05, 0.2, '映写窓 0.8×0.6')
    legend(sh, 1180, 60, [('fabric', '布の壁・台'), ('wood', '木のスラット'), ('brass', '真鍮'), ('glass', '映写窓（奥がほのかに光る）'), ('black', '映写機')])
    notes(sh, 30, 40, ['映写機：本体 0.42×0.42×0.62、フィルムリール 2 枚（半径 0.28）、レンズは本体の前 0.65。', '台は布張り＋真鍮の天板の縁＋黒い台座。触ると光の強さを切替（自分だけ）。',
                       '後ろの壁の上方に映写窓 2 つ。両側に木のスラットの帯。'])
    sh.save()


if __name__ == '__main__':
    plan()
    section()
    front_elevation()
    side_elevation()
    ceiling_plan()
    floor_plan()
    seat_detail()
    back_elevation()
    print('wrote', sorted(os.listdir(OUT)))
