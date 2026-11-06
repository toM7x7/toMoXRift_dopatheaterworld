"""Dimensions for every part of the Ambient Cinema room.

Core numbers come from design/layout.json (shared with src/layout.ts); the part details
below are only used by the blueprints (design/blueprints.py) and the Blender build
(blender/build_cinema.py), so the drawings and the model can never disagree.

Coordinates are three.js world axes in meters: +X right (facing the screen), +Y up,
-Z toward the screen. Blender conversion: blender (x, y, z) = (x, -z, y).
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
with open(os.path.join(ROOT, 'design', 'layout.json'), encoding='utf-8') as f:
    L = json.load(f)

ROOM = L['room']
HW = ROOM['halfWidth']
FRONT = ROOM['front']
BACK = ROOM['back']
H = ROOM['height']

RAKE_START = L['rake']['start']
RAKE_END = L['rake']['end']
RAKE_RISE = L['rake']['rise']
RAKE_SLOPE = RAKE_RISE / (RAKE_END - RAKE_START)


def floor_y(z):
    if z <= RAKE_START:
        return 0.0
    if z >= RAKE_END:
        return RAKE_RISE
    return (z - RAKE_START) * RAKE_SLOPE


SCREEN = L['screen']
SC_X, SC_Y, SC_Z = SCREEN['center']
SC_W, SC_H = SCREEN['width'], SCREEN['height']

# ---- Part 1: screen wall -------------------------------------------------------------
SW = L['screenWall']
MASK_W = SW['maskWidth']          # black velvet border around the picture
MASK_FRONT_Z = FRONT + 0.16       # front face of the masking frame
BRASS_LIP = 0.025                 # brass edge on the inner side of the frame
CURTAIN_INNER = SW['curtainInner']  # curtains cover |x| from here to the side wall
CURTAIN_TOP = SW['curtainTop']
CURTAIN_TIE_Y = 1.35              # height of the brass holdback
CURTAIN_Z = FRONT + 0.25          # pleat centre line
CURTAIN_PLEAT = 0.2               # pleat pitch
CURTAIN_AMP = 0.09                # pleat depth (half)
VALANCE_BOTTOM = SW['valanceBottom']
VALANCE_Z = FRONT + 0.2
VALANCE_PLEAT = 0.32
VALANCE_AMP = 0.06

# ---- Part 2: side walls ----------------------------------------------------------------
B = L['bays']
PILASTER_Z = B['pilasterZ']
PILASTER_W = B['pilasterWidth']
PILASTER_D = B['pilasterDepth']
PILASTER_TOP = H - L['ceiling']['soffitDrop']   # meets the soffit
FLUTES = 5
WAINSCOT_H = B['wainscotHeight']  # wood slat band height above the local floor
SLAT_W = 0.045
SLAT_PITCH = 0.09
SLAT_D = 0.035
TRIM_H = 0.035                    # brass line on top of the slats
PANEL_GAP = 0.12                  # between trim and fabric panel
PANEL_TOP = B['panelTop']
PANEL_D = 0.05
REVEAL = 0.04
SCONCE_H = B['sconceHeight']      # above the local floor
DOORS = L['doors']
DOOR_Z = DOORS['z']
DOOR_W = DOORS['width']
DOOR_H = DOORS['height']
DOOR_FRAME = 0.06
SIGN_W, SIGN_H, SIGN_D = 0.42, 0.22, 0.08
SIGN_Y = RAKE_RISE + DOOR_H + DOORS['signHeight']


def side_bays():
    """Fabric/slat bays between pilasters along one side wall: list of (z0, z1, kind)."""
    edges = [FRONT] + [p for p in PILASTER_Z] + [BACK]
    bays = []
    for i in range(len(edges) - 1):
        z0 = edges[i] + (PILASTER_W / 2 if i > 0 else 0)
        z1 = edges[i + 1] - (PILASTER_W / 2 if i + 1 < len(edges) - 1 else 0)
        kind = 'door' if z0 < DOOR_Z < z1 else 'panel'
        bays.append((z0, z1, kind))
    return bays


def bay_panels(z0, z1, kind):
    """Fabric panels in one bay: list of (z_a, z_b, bottom(z)). Door bays keep clear of the door and sign."""
    n = 3 if (z1 - z0) > 2.4 else 2
    w = (z1 - z0) / n
    out = []
    for i in range(n):
        a, b = z0 + i * w + REVEAL / 2, z0 + (i + 1) * w - REVEAL / 2
        over_door = kind == 'door' and a < DOOR_Z + DOOR_W / 2 + DOOR_FRAME and b > DOOR_Z - DOOR_W / 2 - DOOR_FRAME
        if over_door:
            y = SIGN_Y + SIGN_H / 2 + 0.15
            out.append((a, b, lambda z, y=y: y))
        else:
            out.append((a, b, lambda z: floor_y(z) + WAINSCOT_H + PANEL_GAP))
    return out


# ---- Part 3: ceiling ---------------------------------------------------------------------
C = L['ceiling']
SOFFIT_W = C['soffitWidth']
SOFFIT_DROP = C['soffitDrop']
SOFFIT_INNER = HW - SOFFIT_W
BEAM_D = C['beamDepth']
BEAM_W = C['beamWidth']
BEAM_Z = PILASTER_Z                # transverse beams line up with the pilasters
LONG_BEAM_X = C['longBeamX']       # two beams running front to back
COVE = 0.025                       # glowing cove line thickness


def coffers():
    """Rectangles (x0, x1, z0, z1) between beams and soffits."""
    xs = [-SOFFIT_INNER] + LONG_BEAM_X + [SOFFIT_INNER]
    zs = [FRONT] + BEAM_Z + [BACK]
    out = []
    for i in range(len(xs) - 1):
        x0 = xs[i] + (BEAM_W / 2 if i > 0 else 0)
        x1 = xs[i + 1] - (BEAM_W / 2 if i + 1 < len(xs) - 1 else 0)
        for j in range(len(zs) - 1):
            z0 = zs[j] + (BEAM_W / 2 if j > 0 else 0)
            z1 = zs[j + 1] - (BEAM_W / 2 if j + 1 < len(zs) - 1 else 0)
            out.append((x0, x1, z0, z1))
    return out


# ---- Part 4: floor -------------------------------------------------------------------------
STAGE_EDGE_W = 0.05               # brass strip where the carpet starts
AISLE_HALF = L['seats']['aisleHalf']
STEP_PITCH = L['aisleLights']['pitch']
STEP_LIGHT = (0.05, 0.02, 0.16)   # x, y, z size of one step light


def step_lights():
    out = []
    z = RAKE_START + 0.5
    while z < BACK - 0.5:
        for x in (-AISLE_HALF + 0.08, AISLE_HALF - 0.08):
            out.append((x, floor_y(z), z))
        z += STEP_PITCH
    return out


# ---- Part 5: seats --------------------------------------------------------------------------
S = L['seats']
SEAT_ROWS = S['rows']
SEATS_PER_SIDE = S['perSide']
SEAT_PITCH = S['pitch']
CUSHION_TOP = S['cushionTop']
SEAT_WIDTH = S['seatWidth']
BACK_TOP = S['backTop']
CUSHION = dict(w=SEAT_WIDTH, d=0.5, t=0.14, z0=-0.27)       # front edge at z0 (local)
BACKREST = dict(w=0.54, t=0.13, z=0.2, tilt_deg=12)          # bottom-front at local z
ARM = dict(panel_w=0.06, panel_d=0.56, top_y=0.62, top_t=0.05, top_w=0.1, top_d=0.6, cup_r=0.045, cup_z=-0.22)


def seat_spots():
    out = []
    for r, rz in enumerate(SEAT_ROWS):
        z = rz + S['rowDepthOffset']
        y = floor_y(z)
        for side in (-1, 1):
            for k in range(SEATS_PER_SIDE):
                x = side * (AISLE_HALF + S['firstOffset'] + k * SEAT_PITCH)
                out.append((x, y, z))
    return out


def arm_spots():
    out = []
    for rz in SEAT_ROWS:
        z = rz + S['rowDepthOffset']
        y = floor_y(z)
        for side in (-1, 1):
            for k in range(SEATS_PER_SIDE + 1):
                out.append((side * (AISLE_HALF + S['firstOffset'] - SEAT_PITCH / 2 + k * SEAT_PITCH), y, z))
    return out


# ---- Part 6: back of the room ---------------------------------------------------------------
P = L['projector']
PROJ_BASE = P['base']
LENS_H = P['lensHeight']
LENS_FWD = P['lensForward']
PEDESTAL = dict(w=0.5, d=0.5, h=1.25)
PROJ_BODY = dict(w=0.42, h=0.42, d=0.62)
REEL_R = 0.28
BOOTH_WINDOWS_X = [-1.2, 1.2]
BOOTH_WIN = dict(w=0.8, h=0.6, y=6.2)
BACK_SLAT_X = [(-5.6, -4.0), (4.0, 5.6)]

# Material palette (Blender names; the world maps them to ambient shaders by prefix).
MATERIALS = {
    'AC_front_fabric': (0.085, 0.082, 0.1),
    'AC_wall_fabric': (0.23, 0.22, 0.27),
    'AC_wood': (0.36, 0.22, 0.14),
    'AC_brass': (0.71, 0.55, 0.3),
    'AC_black_velvet': (0.03, 0.03, 0.035),
    'AC_curtain': (0.42, 0.07, 0.11),
    'AC_ceiling': (0.15, 0.145, 0.17),
    'AC_beam': (0.19, 0.17, 0.17),
    'AC_stage': (0.07, 0.065, 0.08),
    'AC_carpet': (0.22, 0.13, 0.17),
    'AC_seat_velvet': (0.48, 0.1, 0.15),
    'AC_seat_frame': (0.12, 0.115, 0.13),
    'AC_door': (0.3, 0.18, 0.11),
    'AC_glass': (0.03, 0.035, 0.045),
    'AC_projector': (0.16, 0.155, 0.16),
    'AC_glow_cove': (1.0, 0.68, 0.38),
    'AC_glow_down': (1.0, 0.82, 0.6),
    'AC_glow_sconce': (1.0, 0.74, 0.46),
    'AC_glow_step': (1.0, 0.6, 0.22),
    'AC_glow_exit': (0.08, 0.85, 0.38),
    'AC_glow_exit_white': (0.92, 1.0, 0.94),
    'AC_glow_booth': (1.0, 0.8, 0.55),
    'AC_lens': (0.1, 0.1, 0.1),
}
