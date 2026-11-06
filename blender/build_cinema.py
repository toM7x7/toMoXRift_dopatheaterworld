"""Build the Dopagaki Cinema room in Blender from cinema_spec and export public/ambient-cinema.glb.

Run inside Blender (MCP):  exec(open(r'.../blender/build_cinema.py', encoding='utf-8').read())
Builds into its own scene 'ambient_cinema' (the user's other scenes are untouched).

Everything is authored in three.js world coordinates (meters, +Y up, -Z toward the screen) and
converted once when written: blender (x, y, z) = (x, -z, y). Geometry goes straight into one
bmesh per (group, material), so the export has one mesh per material and group:
  Room_<mat>              the room (walls, ceiling, floor, screen wall, doors, lights).
                          Base surfaces (AC_wall_base, AC_ceiling_base, AC_front_fabric, AC_stage,
                          AC_carpet) stay at the peak; every other material dissolves.
  SeatProto/<mat>         one seat at the origin, facing -Z (instanced by the world)
  ArmProto/<mat>          one shared armrest at the origin
  EndPanelProto/<mat>     wood side panel for row ends
  Projector/<mat>         projector + pedestal (world position), Projector_Lens separate
"""
import importlib
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else r'D:\personal_dev\XRift\worlds\ambient-cinema\blender'
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import cinema_spec as S  # noqa: E402
importlib.reload(S)

SCENE = 'ambient_cinema'
OUT = os.path.join(S.ROOT, 'public', 'ambient-cinema.glb')
SEG = 0.6  # max face size on lit surfaces (screen light is computed per vertex)


def B(p):
    return Vector((p[0], -p[2], p[1]))


# ---------------------------------------------------------------------------------------
# Builder: one bmesh per (group, material)
class Builder:
    def __init__(self):
        self.bms = {}

    def bm(self, group, mat):
        key = (group, mat)
        if key not in self.bms:
            self.bms[key] = bmesh.new()
        return self.bms[key]

    def add(self, group, mat, verts, faces, smooth=False):
        bm = self.bm(group, mat)
        vs = [bm.verts.new(B(v)) for v in verts]
        out = []
        for f in faces:
            try:
                face = bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue
            face.smooth = smooth
            out.append(face)
        return out


def grid_face(o, a, b, seg=SEG):
    """Quad grid from corner o along vectors a, b (a x b = outward normal)."""
    o, a, b = Vector(o), Vector(a), Vector(b)
    nu = max(1, math.ceil(a.length / seg))
    nv = max(1, math.ceil(b.length / seg))
    verts = [o + a * (i / nu) + b * (j / nv) for j in range(nv + 1) for i in range(nu + 1)]
    faces = []
    for j in range(nv):
        for i in range(nu):
            k = j * (nu + 1) + i
            faces.append((k, k + 1, k + nu + 2, k + nu + 1))
    return verts, faces


def merge(parts):
    verts, faces = [], []
    for vs, fs in parts:
        base = len(verts)
        verts += list(vs)
        faces += [tuple(i + base for i in f) for f in fs]
    return verts, faces


def box_geom(size, seg=SEG, skip=()):
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    spec = {
        '+x': ((hx, -hy, -hz), (0, 2 * hy, 0), (0, 0, 2 * hz)),
        '-x': ((-hx, -hy, -hz), (0, 0, 2 * hz), (0, 2 * hy, 0)),
        '+y': ((-hx, hy, -hz), (0, 0, 2 * hz), (2 * hx, 0, 0)),
        '-y': ((-hx, -hy, -hz), (2 * hx, 0, 0), (0, 0, 2 * hz)),
        '+z': ((-hx, -hy, hz), (2 * hx, 0, 0), (0, 2 * hy, 0)),
        '-z': ((-hx, -hy, -hz), (0, 2 * hy, 0), (2 * hx, 0, 0)),
    }
    return merge([grid_face(*v, seg=seg) for k, v in spec.items() if k not in skip])


def transform(verts, center=(0, 0, 0), rot=None):
    m = rot if rot is not None else Matrix.Identity(3)
    c = Vector(center)
    return [m @ Vector(v) + c for v in verts]


def rot_x(a):
    return Matrix.Rotation(a, 3, 'X')


def rot_y(a):
    return Matrix.Rotation(a, 3, 'Y')


def box(bd, group, mat, center, size, rot=None, seg=SEG, skip=(), bevel=0.0, smooth=False):
    verts, faces = box_geom(size, seg, skip)
    verts = transform(verts, center, rot)
    new = bd.add(group, mat, verts, faces, smooth=smooth)
    if bevel > 0 and new:
        bm = bd.bm(group, mat)
        bmesh.ops.remove_doubles(bm, verts=list({v for f in new for v in f.verts}), dist=1e-5)
        edges = [e for e in {e for f in new if f.is_valid for e in f.edges} if e.is_manifold and e.calc_face_angle(0) > 0.5]
        verts_b = list({v for e in edges for v in e.verts})
        res = bmesh.ops.bevel(bm, geom=verts_b + edges, offset=bevel, segments=2, affect='EDGES', profile=0.5, clamp_overlap=True)
        for f in res.get('faces', []):
            f.smooth = True
        for f in new:
            if f.is_valid:
                f.smooth = smooth


def span_box(bd, group, mat, a, b, w, h, seg=SEG):
    """Box from point a to point b (three coords), cross-section w (horizontal) x h (vertical)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    yaw = math.atan2(d.x, d.z)
    pitch = -math.asin(d.y / length) if length > 0 else 0
    rot = rot_y(yaw) @ rot_x(pitch)
    box(bd, group, mat, (a + b) / 2, (w, h, length), rot=rot, seg=seg)


def prism(bd, group, mat, quad, extrude, nu=1, nv=1, back=False, smooth=False):
    """Quad (p0..p3, loop order) pushed out by `extrude`: front grid + 4 sides (+ back)."""
    p = [Vector(q) for q in quad]
    e = Vector(extrude)
    if (p[1] - p[0]).cross(p[3] - p[0]).dot(e) < 0:
        p = [p[0], p[3], p[2], p[1]]
    verts, faces = [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            u, v = i / nu, j / nv
            q = p[0].lerp(p[1], u).lerp(p[3].lerp(p[2], u), v)
            verts.append(q + e)
    for j in range(nv):
        for i in range(nu):
            k = j * (nu + 1) + i
            faces.append((k, k + 1, k + nu + 2, k + nu + 1))
    centroid = sum(p, Vector()) / 4 + e / 2
    for i in range(4):
        a, b = p[i], p[(i + 1) % 4]
        quad_s = [a, b, b + e, a + e]
        n = (quad_s[1] - quad_s[0]).cross(quad_s[3] - quad_s[0])
        if n.dot((a + b) / 2 + e / 2 - centroid) < 0:
            quad_s = [a, a + e, b + e, b]
        base = len(verts)
        verts += quad_s
        faces.append((base, base + 1, base + 2, base + 3))
    if back:
        base = len(verts)
        verts += [p[0], p[3], p[2], p[1]]
        faces.append((base, base + 1, base + 2, base + 3))
    bd.add(group, mat, verts, faces, smooth=smooth)


def surface(bd, group, mat, fn, nu, nv, facing, smooth=False):
    """Grid surface fn(u, v) -> point; faces oriented toward `facing` (vector or fn(point))."""
    verts = [Vector(fn(i / nu, j / nv)) for j in range(nv + 1) for i in range(nu + 1)]
    faces = []
    for j in range(nv):
        for i in range(nu):
            k = j * (nu + 1) + i
            f = (k, k + 1, k + nu + 2, k + nu + 1)
            n = (verts[f[1]] - verts[f[0]]).cross(verts[f[3]] - verts[f[0]])
            want = Vector(facing(verts[f[0]]) if callable(facing) else facing)
            if n.dot(want) < 0:
                f = (f[0], f[3], f[2], f[1])
            faces.append(f)
    bd.add(group, mat, verts, faces, smooth=smooth)


def cylinder(bd, group, mat, center, r, length, axis='y', segs=24, caps=True, a0=0.0, a1=2 * math.pi, smooth=True, cap_mat=None):
    """Cylinder along axis ('x', 'y', 'z'), centred; partial when a0..a1 is not a full turn."""
    c = Vector(center)
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    n = segs if full else max(2, round(segs * (a1 - a0) / (2 * math.pi)))
    ring = []
    for i in range(n if full else n + 1):
        t = a0 + (a1 - a0) * i / n
        ring.append((math.cos(t) * r, math.sin(t) * r))

    def P(x2, y2, h):
        if axis == 'y':
            return c + Vector((x2, h, y2))
        if axis == 'x':
            return c + Vector((h, x2, y2))
        return c + Vector((x2, y2, h))

    verts = [P(x2, y2, -length / 2) for x2, y2 in ring] + [P(x2, y2, length / 2) for x2, y2 in ring]
    m = len(ring)
    faces = []
    for i in range(m if full else m - 1):
        j = (i + 1) % m
        faces.append((i, j, m + j, m + i))
    # orient outward
    fixed = []
    for f in faces:
        a, b, d = verts[f[0]], verts[f[1]], verts[f[3]]
        nrm = (b - a).cross(d - a)
        mid = (verts[f[0]] + verts[f[2]]) / 2
        axis_pt = c + (mid - c).project({'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[axis])
        fixed.append(f if nrm.dot(mid - axis_pt) >= 0 else (f[0], f[3], f[2], f[1]))
    bd.add(group, mat, verts, fixed, smooth=smooth)
    if caps:
        ax = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[axis]
        for side in (-1, 1):
            cv = [P(x2, y2, side * length / 2) for x2, y2 in ring] + [c + ax * side * length / 2]
            ci = len(cv) - 1
            cf = []
            for i in range(m if full else m - 1):
                f = (i, (i + 1) % m, ci)
                nrm = (cv[f[1]] - cv[f[0]]).cross(cv[f[2]] - cv[f[0]])
                cf.append(f if nrm.dot(ax * side) >= 0 else (f[0], f[2], f[1]))
            bd.add(group, cap_mat or mat, cv, cf, smooth=False)


def annulus(bd, group, mat, center, r_out, r_in, height, segs=28):
    """Ring around +Y (cup holder rim): top, outer and inner walls."""
    c = Vector(center)
    verts, faces = [], []
    for i in range(segs):
        t = 2 * math.pi * i / segs
        co, si = math.cos(t), math.sin(t)
        verts += [c + Vector((co * r_out, 0, si * r_out)), c + Vector((co * r_out, height, si * r_out)),
                  c + Vector((co * r_in, height, si * r_in)), c + Vector((co * r_in, 0, si * r_in))]
    for i in range(segs):
        a, b = i * 4, ((i + 1) % segs) * 4
        faces += [(a, a + 1, b + 1, b), (a + 1, a + 2, b + 2, b + 1), (a + 2, a + 3, b + 3, b + 2)]
    fixed = []
    for f in faces:
        n = (verts[f[1]] - verts[f[0]]).cross(verts[f[3]] - verts[f[0]])
        mid = sum((verts[i] for i in f), Vector()) / 4
        radial = Vector((mid.x - c.x, 0, mid.z - c.z))
        r = radial.length
        # top faces point up; outer wall out; inner wall in
        if abs(mid.y - (c.y + height)) < 1e-6 and abs(n.normalized().y) > 0.9:
            want = Vector((0, 1, 0))
        else:
            want = radial if r > (r_out + r_in) / 2 else -radial
        fixed.append(f if n.dot(want) >= 0 else (f[0], f[3], f[2], f[1]))
    bd.add(group, mat, verts, fixed, smooth=True)


def floor_breaks(z0, z1):
    zs = [z0] + [z for z in (S.RAKE_START, S.RAKE_END) if z0 < z < z1] + [z1]
    return list(zip(zs[:-1], zs[1:]))


# ---------------------------------------------------------------------------------------
# P1 screen wall
def build_screen_wall(bd):
    g = 'room'
    hw = S.HW
    surface(bd, g, 'AC_front_fabric', lambda u, v: (-hw + 2 * hw * u, S.H * v, S.FRONT), 27, 14, (0, 0, 1))
    m, lip = S.MASK_W, S.BRASS_LIP
    zc = (S.FRONT + S.MASK_FRONT_Z) / 2
    zd = S.MASK_FRONT_Z - S.FRONT
    top, bot = S.SC_Y + S.SC_H / 2, S.SC_Y - S.SC_H / 2
    l, r = -S.SC_W / 2, S.SC_W / 2
    for c, s in [((0, top + m / 2, zc), (S.SC_W + 2 * m, m, zd)), ((0, bot - m / 2, zc), (S.SC_W + 2 * m, m, zd)),
                 ((l - m / 2, S.SC_Y, zc), (m, S.SC_H, zd)), ((r + m / 2, S.SC_Y, zc), (m, S.SC_H, zd))]:
        box(bd, g, 'AC_black_velvet', c, s)
    lz = (S.SC_Z + S.MASK_FRONT_Z + 0.006) / 2
    ld = S.MASK_FRONT_Z + 0.006 - S.SC_Z
    for c, s in [((0, top + lip / 2, lz), (S.SC_W + 2 * lip, lip, ld)), ((0, bot - lip / 2, lz), (S.SC_W + 2 * lip, lip, ld)),
                 ((l - lip / 2, S.SC_Y, lz), (lip, S.SC_H, ld)), ((r + lip / 2, S.SC_Y, lz), (lip, S.SC_H, ld))]:
        box(bd, g, 'AC_brass', c, s)

    # Curtains gathered in the corners, tied back with a brass band.
    def envelope(y):
        """inner edge |x| at height y (outer edge is the side wall)."""
        tie, topw, tiew, botw = S.CURTAIN_TIE_Y, hw - S.CURTAIN_INNER, 0.55, 0.85
        if y >= tie:
            t = (y - tie) / (S.CURTAIN_TOP - tie)
            t = 1 - (1 - t) ** 1.6
            return hw - (tiew + (topw - tiew) * t)
        t = (tie - y) / tie
        return hw - (tiew + (botw - tiew) * t ** 1.3)

    pleats = 7
    for sgn in (-1, 1):
        def cf(u, v, sgn=sgn):
            y = S.CURTAIN_TOP * v
            xin = envelope(y)
            width = hw - xin
            x = xin + (hw - 0.01 - xin) * u
            gather = (hw - S.CURTAIN_INNER) / max(width, 0.2)
            amp = S.CURTAIN_AMP * min(1.8, gather ** 0.5)
            z = S.CURTAIN_Z + math.sin(u * pleats * 2 * math.pi) * amp
            return (sgn * x, y, z)
        surface(bd, g, 'AC_curtain', cf, pleats * 8, 40, (0, 0, 1), smooth=True)
        tie_in = envelope(S.CURTAIN_TIE_Y)
        box(bd, g, 'AC_brass', (sgn * (tie_in + hw) / 2, S.CURTAIN_TIE_Y, S.CURTAIN_Z + S.CURTAIN_AMP * 1.9 + 0.02),
            ((hw - tie_in) + 0.04, 0.07, 0.03))
        cylinder(bd, g, 'AC_brass', (sgn * (hw - 0.06), S.CURTAIN_TIE_Y, S.CURTAIN_Z + 0.25), 0.045, 0.07, axis='z', segs=16)

    def vf(u, v):
        x = -hw + 2 * hw * u
        y = S.VALANCE_BOTTOM + (S.H - S.VALANCE_BOTTOM) * v
        return (x, y, S.VALANCE_Z + math.sin(x / S.VALANCE_PLEAT * 2 * math.pi) * S.VALANCE_AMP * (0.7 + 0.3 * (1 - v)))
    surface(bd, g, 'AC_curtain', vf, int(2 * hw / S.VALANCE_PLEAT) * 6, 3, (0, 0, 1), smooth=True)
    box(bd, g, 'AC_brass', (0, S.VALANCE_BOTTOM + 0.015, S.VALANCE_Z + S.VALANCE_AMP + 0.03), (2 * hw, 0.03, 0.03), seg=2)
    box(bd, g, 'AC_glow_cove', (0, S.H - 0.03, S.VALANCE_Z + S.VALANCE_AMP + 0.06), (2 * hw - 1.9, S.COVE, S.COVE), seg=2)
    # Wood slat columns in the two front corners, behind the curtains (seen above the tie).
    for sgn in (-1, 1):
        x = hw - 0.02
        while x > hw - 0.55:
            box(bd, g, 'AC_wood', (sgn * x, S.CURTAIN_TOP / 2, S.FRONT + 0.03), (S.SLAT_W, S.CURTAIN_TOP, S.SLAT_D), seg=2)
            x -= S.SLAT_PITCH


# ---------------------------------------------------------------------------------------
# P2 side walls (+ the side soffits from P3)
def build_side_walls(bd):
    g = 'room'
    hw = S.HW
    for sgn in (-1, 1):
        inward = (-sgn, 0, 0)
        wx = sgn * hw
        surface(bd, g, 'AC_wall_base', lambda u, v, wx=wx: (wx, S.H * v, S.FRONT + (S.BACK - S.FRONT) * u), 37, 14, inward)
        # soffit + cove line
        sx = sgn * (S.SOFFIT_INNER + S.SOFFIT_W / 2)
        box(bd, g, 'AC_ceiling', (sx, S.H - S.SOFFIT_DROP / 2, 0), (S.SOFFIT_W, S.SOFFIT_DROP, S.BACK - S.FRONT))
        box(bd, g, 'AC_glow_cove', (sgn * (S.SOFFIT_INNER + 0.015), S.H - S.SOFFIT_DROP - S.COVE / 2, 0), (0.03, S.COVE, S.BACK - S.FRONT - 0.2), seg=4)
        for (z0, z1, kind) in S.side_bays():
            door0 = S.DOOR_Z - S.DOOR_W / 2 - S.DOOR_FRAME - 0.05
            door1 = S.DOOR_Z + S.DOOR_W / 2 + S.DOOR_FRAME + 0.05
            # slats following the floor
            z = z0 + S.SLAT_PITCH / 2
            while z < z1 - S.SLAT_W / 2:
                if not (kind == 'door' and door0 < z < door1):
                    yb = max(0.0, S.floor_y(z) - 0.05)
                    yt = S.floor_y(z) + S.WAINSCOT_H
                    box(bd, g, 'AC_wood', (sgn * (hw - 0.03 - S.SLAT_D / 2), (yb + yt) / 2, z), (S.SLAT_D, yt - yb, S.SLAT_W), seg=1.0)
                z += S.SLAT_PITCH
            # brass line on top of the slats (split at rake breaks)
            for (a, b) in floor_breaks(z0, z1):
                if kind == 'door' and b > door0 and a < door1:
                    for (aa, bb) in ((a, min(b, door0)), (max(a, door1), b)):
                        if bb - aa > 0.05:
                            span_box(bd, g, 'AC_brass', (sgn * (hw - 0.05), S.floor_y(aa) + S.WAINSCOT_H + S.TRIM_H / 2, aa),
                                     (sgn * (hw - 0.05), S.floor_y(bb) + S.WAINSCOT_H + S.TRIM_H / 2, bb), 0.05, S.TRIM_H, seg=2)
                    continue
                span_box(bd, g, 'AC_brass', (sgn * (hw - 0.05), S.floor_y(a) + S.WAINSCOT_H + S.TRIM_H / 2, a),
                         (sgn * (hw - 0.05), S.floor_y(b) + S.WAINSCOT_H + S.TRIM_H / 2, b), 0.05, S.TRIM_H, seg=2)
            # fabric panels
            for (a, b, bottom) in S.bay_panels(z0, z1, kind):
                quad = [(wx, bottom(a), a), (wx, bottom(b), b), (wx, S.PANEL_TOP, b), (wx, S.PANEL_TOP, a)]
                h = S.PANEL_TOP - min(bottom(a), bottom(b))
                prism(bd, g, 'AC_wall_fabric', quad, (-sgn * S.PANEL_D, 0, 0), nu=max(1, math.ceil((b - a) / SEG)), nv=max(1, math.ceil(h / SEG)))
        # pilasters, sconces
        for z in S.PILASTER_Z:
            px = sgn * (hw - S.PILASTER_D / 2)
            box(bd, g, 'AC_curtain', (px, S.PILASTER_TOP / 2, z), (S.PILASTER_D, S.PILASTER_TOP, S.PILASTER_W))
            fy = S.floor_y(z)
            box(bd, g, 'AC_brass', (px - sgn * 0.005, fy + 0.06, z), (S.PILASTER_D + 0.02, 0.12, S.PILASTER_W + 0.02), seg=2)
            box(bd, g, 'AC_brass', (px - sgn * 0.005, S.PILASTER_TOP - 0.04, z), (S.PILASTER_D + 0.02, 0.08, S.PILASTER_W + 0.02), seg=2)
            sy = fy + S.SCONCE_H
            face = sgn * (hw - S.PILASTER_D)
            box(bd, g, 'AC_brass', (face - sgn * 0.01, sy, z), (0.02, 0.36, 0.12), seg=2)
            # half cylinder facing into the room
            a0 = math.pi / 2 if sgn > 0 else -math.pi / 2
            cylinder(bd, g, 'AC_brass', (face, sy, z), 0.13, 0.26, axis='y', segs=24, caps=False, a0=a0, a1=a0 + math.pi)
            cylinder(bd, g, 'AC_glow_sconce', (face - sgn * 0.002, sy + 0.125, z), 0.12, 0.01, axis='y', segs=24, caps=True,
                     a0=a0, a1=a0 + math.pi)
        # door, frame, handles, exit sign
        y0 = S.RAKE_RISE
        dx = sgn * (hw - 0.02)
        for k in (-1, 1):
            zc = S.DOOR_Z + k * S.DOOR_W / 4
            box(bd, g, 'AC_door', (dx, y0 + S.DOOR_H / 2, zc), (0.04, S.DOOR_H, S.DOOR_W / 2 - 0.01))
            cylinder(bd, g, 'AC_brass', (dx - sgn * 0.05, y0 + 1.05, S.DOOR_Z + k * 0.08), 0.014, 0.36, axis='y', segs=10)
            for yy in (y0 + 0.87, y0 + 1.23):
                box(bd, g, 'AC_brass', (dx - sgn * 0.035, yy, S.DOOR_Z + k * 0.08), (0.04, 0.02, 0.02), seg=1)
        fz0, fz1 = S.DOOR_Z - S.DOOR_W / 2, S.DOOR_Z + S.DOOR_W / 2
        f = S.DOOR_FRAME
        fx = sgn * (hw - 0.035)
        box(bd, g, 'AC_brass', (fx, y0 + S.DOOR_H / 2, fz0 - f / 2), (0.07, S.DOOR_H, f), seg=2)
        box(bd, g, 'AC_brass', (fx, y0 + S.DOOR_H / 2, fz1 + f / 2), (0.07, S.DOOR_H, f), seg=2)
        box(bd, g, 'AC_brass', (fx, y0 + S.DOOR_H + f / 2, S.DOOR_Z), (0.07, f, S.DOOR_W + 2 * f), seg=2)
        sx = sgn * (hw - S.SIGN_D / 2)
        box(bd, g, 'AC_seat_frame', (sx, S.SIGN_Y, S.DOOR_Z), (S.SIGN_D, S.SIGN_H, S.SIGN_W), seg=1)
        gx = sgn * (hw - S.SIGN_D - 0.003)
        box(bd, g, 'AC_glow_exit', (gx, S.SIGN_Y, S.DOOR_Z), (0.006, S.SIGN_H - 0.03, S.SIGN_W - 0.03), seg=1)
        # running figure + door outline (white), drawn as thin bars; faces the room
        wx2 = sgn * (hw - S.SIGN_D - 0.008)
        dz = -sgn * 1  # "forward" along the sign as seen from the room
        cz = S.DOOR_Z + dz * 0.05
        bars = [((0.0, 0.065), (0.0, 0.065)), ((0.0, 0.045), (0.02, -0.005)), ((0.02, -0.005), (0.05, -0.06)), ((0.02, -0.005), (-0.025, -0.06)),
                ((0.005, 0.03), (0.045, 0.01)), ((0.005, 0.03), (-0.03, 0.005))]
        for (a, b) in bars:
            pa = (wx2, S.SIGN_Y + a[1], cz + dz * a[0])
            pb = (wx2, S.SIGN_Y + b[1], cz + dz * b[0])
            if pa == pb:
                box(bd, g, 'AC_glow_exit_white', pa, (0.006, 0.028, 0.028), seg=1)
            else:
                span_box(bd, g, 'AC_glow_exit_white', pa, pb, 0.006, 0.016, seg=1)
        for (a, b) in (((-0.12, 0.07), (-0.12, -0.07)), ((-0.12, 0.07), (-0.07, 0.07)), ((-0.12, -0.07), (-0.07, -0.07))):
            span_box(bd, g, 'AC_glow_exit_white', (wx2, S.SIGN_Y + a[1], S.DOOR_Z + dz * a[0]), (wx2, S.SIGN_Y + b[1], S.DOOR_Z + dz * b[0]), 0.006, 0.012, seg=1)


# ---------------------------------------------------------------------------------------
# P3 ceiling (soffits are with the side walls)
def build_ceiling(bd):
    g = 'room'
    si = S.SOFFIT_INNER
    # Full width: the soffits sit under it and dissolve at the peak, the base must close the room.
    surface(bd, g, 'AC_ceiling_base', lambda u, v: (-S.HW + 2 * S.HW * u, S.H, S.FRONT + (S.BACK - S.FRONT) * v), 27, 37, (0, -1, 0))
    for z in S.BEAM_Z:
        box(bd, g, 'AC_beam', (0, S.H - S.BEAM_D / 2, z), (2 * si, S.BEAM_D, S.BEAM_W))
        for k in (-1, 1):
            box(bd, g, 'AC_glow_cove', (0, S.H - S.COVE / 2 - 0.005, z + k * (S.BEAM_W / 2 + 0.04)), (2 * si - 0.1, S.COVE, 0.03), seg=4)
    for (x0, x1, z0, z1) in S.coffers():
        for fx in (0.25, 0.5, 0.75):
            x = x0 + (x1 - x0) * fx
            zc = (z0 + z1) / 2
            cylinder(bd, g, 'AC_brass', (x, S.H - 0.006, zc), 0.11, 0.012, axis='y', segs=20)
            cylinder(bd, g, 'AC_glow_down', (x, S.H - 0.014, zc), 0.075, 0.006, axis='y', segs=20)


# ---------------------------------------------------------------------------------------
# P4 floor
def build_floor(bd):
    g = 'room'
    hw = S.HW
    surface(bd, g, 'AC_stage', lambda u, v: (-hw + 2 * hw * u, 0.0, S.FRONT + (S.RAKE_START - S.FRONT) * v), 32, 16, (0, 1, 0))
    surface(bd, g, 'AC_carpet', lambda u, v: (-hw + 2 * hw * u, S.floor_y(S.RAKE_START + (S.RAKE_END - S.RAKE_START) * v), S.RAKE_START + (S.RAKE_END - S.RAKE_START) * v),
            32, 22, (0, 1, 0))
    surface(bd, g, 'AC_carpet', lambda u, v: (-hw + 2 * hw * u, S.RAKE_RISE, S.RAKE_END + (S.BACK - S.RAKE_END) * v), 32, 6, (0, 1, 0))
    box(bd, g, 'AC_brass', (0, 0.004, S.RAKE_START), (2 * hw, 0.008, S.STAGE_EDGE_W), seg=2)
    for (x, y, z) in S.step_lights():
        box(bd, g, 'AC_brass', (x, y + 0.006, z), (0.07, 0.012, 0.16), seg=1)
        box(bd, g, 'AC_glow_step', (x, y + 0.008, z), (0.04, 0.012, 0.12), seg=1)


# ---------------------------------------------------------------------------------------
# P5 seats (prototypes at the origin, facing -Z)
def build_seat(bd):
    g = 'seat'
    c = S.CUSHION
    box(bd, g, 'AC_seat_velvet', (0, S.CUSHION_TOP - c['t'] / 2, c['z0'] + c['d'] / 2), (c['w'], c['t'], c['d']), seg=0.2, bevel=0.035)
    box(bd, g, 'AC_seat_frame', (0, 0.27, 0.0), (0.44, 0.16, 0.34), seg=0.3)
    b = S.BACKREST
    tilt = math.radians(b['tilt_deg'])
    h = S.BACK_TOP - (S.CUSHION_TOP - 0.04)
    rot = rot_x(tilt)
    base = Vector((0, S.CUSHION_TOP - 0.04, b['z'] + b['t'] / 2))
    center = base + rot @ Vector((0, h / 2, 0))
    box(bd, g, 'AC_seat_velvet', center, (b['w'], h, b['t']), rot=rot, seg=0.2, bevel=0.045)
    # vertical channel stitching on the backrest (thin raised ribs)
    for k in (-1, 1):
        rib_c = base + rot @ Vector((k * 0.09, h / 2 + 0.02, -b['t'] / 2 - 0.004))
        box(bd, g, 'AC_seat_velvet', rib_c, (0.012, h - 0.22, 0.01), rot=rot, seg=0.3)


def build_arm(bd):
    g = 'arm'
    a = S.ARM
    box(bd, g, 'AC_seat_frame', (0, a['top_y'] / 2, 0), (a['panel_w'], a['top_y'], a['panel_d']), seg=0.3)
    box(bd, g, 'AC_black_velvet', (0, 0.012, 0), (0.1, 0.024, 0.34), seg=0.3)
    box(bd, g, 'AC_brass', (0, a['top_y'] - 0.008, 0), (a['panel_w'] + 0.006, 0.016, a['panel_d'] + 0.006), seg=0.3)
    zc = -a['top_d'] / 2 + 0.28 - 0.04
    box(bd, g, 'AC_arm', (0, a['top_y'] + a['top_t'] / 2, zc), (a['top_w'], a['top_t'], a['top_d']), seg=0.3, bevel=0.012)
    box(bd, g, 'AC_brass', (0, a['top_y'] + a['top_t'] / 2, zc - a['top_d'] / 2 - 0.004), (a['top_w'] + 0.004, a['top_t'] + 0.004, 0.012), seg=0.3)
    cy = a['top_y'] + a['top_t']
    annulus(bd, g, 'AC_brass', (0, cy - 0.002, a['cup_z']), a['cup_r'], a['cup_r'] - 0.008, 0.014, segs=16)
    cylinder(bd, g, 'AC_black_velvet', (0, cy + 0.001, a['cup_z']), a['cup_r'] - 0.008, 0.002, axis='y', segs=16)


def build_end_panel(bd):
    box(bd, 'endpanel', 'AC_wood', (0.04, 0.32, 0), (0.02, 0.56, 0.54), seg=0.3)
    box(bd, 'endpanel', 'AC_brass', (0.04, 0.6, 0), (0.024, 0.012, 0.56), seg=0.3)


# ---------------------------------------------------------------------------------------
# P6 back wall + projector
def build_back(bd):
    g = 'room'
    hw = S.HW
    surface(bd, g, 'AC_wall_base', lambda u, v: (-hw + 2 * hw * u, S.H * v, S.BACK), 27, 14, (0, 0, -1))
    base = S.RAKE_RISE
    for (x0, x1) in S.BACK_SLAT_X:
        x = x0 + S.SLAT_PITCH / 2
        while x < x1:
            box(bd, g, 'AC_wood', (x, (base + S.PANEL_TOP) / 2, S.BACK - 0.03 - S.SLAT_D / 2), (S.SLAT_W, S.PANEL_TOP - base, S.SLAT_D), seg=1.0)
            x += S.SLAT_PITCH
    cols = [(-S.SOFFIT_INNER, S.BACK_SLAT_X[0][0] - 0.05), (S.BACK_SLAT_X[0][1] + 0.05, -0.03), (0.03, S.BACK_SLAT_X[1][0] - 0.05), (S.BACK_SLAT_X[1][1] + 0.05, S.SOFFIT_INNER)]
    for (x0, x1) in cols:
        y0, y1 = base + 0.25, 5.6
        quad = [(x0, y0, S.BACK), (x1, y0, S.BACK), (x1, y1, S.BACK), (x0, y1, S.BACK)]
        prism(bd, g, 'AC_wall_fabric', quad, (0, 0, -S.PANEL_D), nu=max(1, math.ceil((x1 - x0) / SEG)), nv=max(1, math.ceil((y1 - y0) / SEG)))
    box(bd, g, 'AC_brass', (0, 5.72, S.BACK - 0.03), (2 * S.SOFFIT_INNER, 0.03, 0.04), seg=2)
    box(bd, g, 'AC_brass', (0, base + 0.06, S.BACK - 0.02), (2 * hw, 0.12, 0.04), seg=2)
    bw = S.BOOTH_WIN
    for x in S.BOOTH_WINDOWS_X:
        fw = 0.05
        y = bw['y']
        for c, s in [((x, y + bw['h'] / 2 + fw / 2, S.BACK - 0.03), (bw['w'] + 2 * fw, fw, 0.06)), ((x, y - bw['h'] / 2 - fw / 2, S.BACK - 0.03), (bw['w'] + 2 * fw, fw, 0.06)),
                     ((x - bw['w'] / 2 - fw / 2, y, S.BACK - 0.03), (fw, bw['h'], 0.06)), ((x + bw['w'] / 2 + fw / 2, y, S.BACK - 0.03), (fw, bw['h'], 0.06))]:
            box(bd, g, 'AC_brass', c, s, seg=1)
        box(bd, g, 'AC_glow_booth', (x, y, S.BACK - 0.004), (bw['w'], bw['h'], 0.006), seg=1)


def build_projector(bd):
    g = 'projector'
    bx, by, bz = S.PROJ_BASE
    pw, ph = S.PEDESTAL['w'], S.PEDESTAL['h']
    box(bd, g, 'AC_black_velvet', (bx, by + 0.06, bz), (pw + 0.12, 0.12, pw + 0.12), seg=0.4)
    box(bd, g, 'AC_wall_fabric', (bx, by + 0.12 + (ph - 0.17) / 2, bz), (pw, ph - 0.17, pw), seg=0.4)
    box(bd, g, 'AC_brass', (bx, by + ph - 0.025, bz), (pw + 0.06, 0.05, pw + 0.06), seg=0.4)
    lh = by + S.LENS_H
    body = S.PROJ_BODY
    box(bd, g, 'AC_projector', (bx, (by + ph + lh - body['h'] / 2) / 2, bz), (0.3, lh - body['h'] / 2 - by - ph, 0.4), seg=0.4)
    box(bd, g, 'AC_projector', (bx, lh, bz), (body['w'], body['h'], body['d']), seg=0.3, bevel=0.02)
    # vents + side knobs
    for k in range(5):
        box(bd, g, 'AC_black_velvet', (bx + body['w'] / 2 + 0.003, lh - 0.08 + k * 0.035, bz + 0.12), (0.006, 0.012, 0.2), seg=1)
    for (dy, dz) in ((0.1, -0.15), (-0.08, -0.12), (0.05, 0.05)):
        cylinder(bd, g, 'AC_brass', (bx - body['w'] / 2 - 0.02, lh + dy, bz + dz), 0.035, 0.04, axis='x', segs=14)
    front = bz - body['d'] / 2
    lens_z = bz - S.LENS_FWD
    cylinder(bd, g, 'AC_projector', (bx, lh, (front + lens_z) / 2), 0.08, front - lens_z, axis='z', segs=24)
    cylinder(bd, g, 'AC_brass', (bx, lh, lens_z + 0.03), 0.092, 0.05, axis='z', segs=24)
    cylinder(bd, 'lens', 'AC_lens', (bx, lh, lens_z - 0.002), 0.07, 0.004, axis='z', segs=24)
    # reels on arms
    for (dz, dy) in ((-0.2, 0.55), (0.22, 0.62)):
        cy, cz = lh + dy, bz + dz
        span_box(bd, g, 'AC_projector', (bx, lh + body['h'] / 2, bz + dz * 0.6), (bx, cy, cz), 0.04, 0.03, seg=1)
        r = S.REEL_R
        # rim ring as a thin cylinder shell, hub, spokes
        cylinder(bd, g, 'AC_metal', (bx, cy, cz), r, 0.035, axis='x', segs=40, caps=False)
        cylinder(bd, g, 'AC_metal', (bx, cy, cz), r - 0.03, 0.035, axis='x', segs=40, caps=False)
        for side in (-1, 1):
            # side faces of the rim (annulus in the YZ plane)
            verts, faces = [], []
            n = 40
            for i in range(n):
                t = 2 * math.pi * i / n
                verts += [Vector((bx + side * 0.0175, cy + math.cos(t) * r, cz + math.sin(t) * r)),
                          Vector((bx + side * 0.0175, cy + math.cos(t) * (r - 0.03), cz + math.sin(t) * (r - 0.03)))]
            for i in range(n):
                a, b2 = i * 2, ((i + 1) % n) * 2
                f = (a, b2, b2 + 1, a + 1)
                nrm = (verts[f[1]] - verts[f[0]]).cross(verts[f[3]] - verts[f[0]])
                faces.append(f if nrm.x * side >= 0 else (f[0], f[3], f[2], f[1]))
            bd.add(g, 'AC_metal', verts, faces)
        cylinder(bd, g, 'AC_brass', (bx, cy, cz), 0.05, 0.05, axis='x', segs=18)
        for k in range(5):
            t = 2 * math.pi * k / 5 + 0.3
            span_box(bd, g, 'AC_metal', (bx, cy + math.cos(t) * 0.05, cz + math.sin(t) * 0.05), (bx, cy + math.cos(t) * (r - 0.03), cz + math.sin(t) * (r - 0.03)), 0.02, 0.03, seg=1)


# ---------------------------------------------------------------------------------------
def material(name, rgb):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    glow = name.startswith('AC_glow') or name == 'AC_lens'
    bsdf.inputs['Emission Color'].default_value = (*rgb, 1) if glow else (0, 0, 0, 1)
    bsdf.inputs['Emission Strength'].default_value = 1.0 if glow else 0.0
    metal = name in ('AC_brass', 'AC_metal')
    bsdf.inputs['Metallic'].default_value = 0.35 if metal else 0.0
    bsdf.inputs['Roughness'].default_value = 0.35 if metal or name == 'AC_stage' else 0.85
    mat.diffuse_color = (*rgb, 1)
    return mat


def build():
    palette = dict(S.MATERIALS)
    palette.update({'AC_arm': (0.1, 0.095, 0.11), 'AC_metal': (0.45, 0.44, 0.42)})
    # Base surfaces stay when the room dissolves at the peak; everything else is "detail".
    palette['AC_wall_base'] = palette['AC_wall_fabric']
    palette['AC_ceiling_base'] = palette['AC_ceiling']
    palette['AC_glow_booth'] = (0.32, 0.22, 0.12)

    scene = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    for ob in list(scene.collection.all_objects):
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0 and isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)

    bd = Builder()
    build_screen_wall(bd)
    build_side_walls(bd)
    build_ceiling(bd)
    build_floor(bd)
    build_back(bd)
    build_seat(bd)
    build_arm(bd)
    build_end_panel(bd)
    build_projector(bd)

    roots = {}
    for name in ('SeatProto', 'ArmProto', 'EndPanelProto', 'Projector'):
        e = bpy.data.objects.new(name, None)
        scene.collection.objects.link(e)
        roots[name] = e
    group_root = {'seat': 'SeatProto', 'arm': 'ArmProto', 'endpanel': 'EndPanelProto', 'projector': 'Projector', 'lens': 'Projector'}
    stats = {}
    for (group, mat_name), bm in bd.bms.items():
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        if group == 'room':
            obname = f'Room_{mat_name[3:]}'
        elif group == 'lens':
            obname = 'Projector_Lens'
        else:
            obname = f'{group_root[group]}_{mat_name[3:]}'
        me = bpy.data.meshes.get(obname)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
        me = bpy.data.meshes.new(obname)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material(mat_name, palette[mat_name]))
        ob = bpy.data.objects.new(obname, me)
        scene.collection.objects.link(ob)
        if group in group_root:
            ob.parent = roots[group_root[group]]
        stats[obname] = len(me.vertices)

    window = bpy.context.window
    prev = window.scene
    window.scene = scene
    try:
        for ob in scene.objects:
            ob.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=OUT, export_format='GLB', use_active_scene=True, use_selection=False,
            export_apply=True, export_yup=True, export_texcoords=False, export_normals=True,
            export_materials='EXPORT', export_animations=False, export_cameras=False, export_lights=False,
            export_extras=False,
        )
    finally:
        window.scene = prev
    return {'objects': len(stats), 'verts': sum(stats.values()), 'by_object': stats, 'glb_bytes': os.path.getsize(OUT)}


result = build()
