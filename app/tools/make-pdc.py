#!/usr/bin/env python3
"""Writes the confirmation icons that morph (vector animations, PDC) into ../resources/images.

The shapes come from the Pebble iconography SVGs in ../art; the motion is described here, frame by frame.
    thumbs_anim.pdc   Pebble_80x80_Thumbs_up.svg: the thumb pops up from a fist, with sparkles, and wobbles
    tide_anim.pdc     Pebble_80x80_Tide_is_high.svg: the pinky and thumb pop out and the hand waves

    python3 make-pdc.py           writes the two .pdc files
    python3 make-pdc.py --sheet   also writes frames-<name>.png contact sheets next to them (needs Pillow)

PDC layout (see the Pebble docs on Draw Commands): 'PDCS', size, version 1, view box, play count, frame count,
then per frame a duration in ms and its commands. Commands here are precise paths: points in 1/8 pixel.
"""
import math, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', 'art')
OUT = os.path.join(HERE, '..', 'resources', 'images')
FRAME_MS = 33
FRAMES = 36            # 36 x 33 ms, about 1.2 s
BLACK, WHITE = 192, 255  # ARGB2222


def ease_out(u):
    u = min(max(u, 0.0), 1.0)
    return 1 - (1 - u) ** 3


def smooth(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


def keys(points, u):
    """Piecewise smooth interpolation through (time, value) keys."""
    if u <= points[0][0]:
        return points[0][1]
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if u <= t1:
            return v0 + (v1 - v0) * smooth((u - t0) / (t1 - t0))
    return points[-1][1]


def svg_shapes(name):
    """The drawing's shapes as ('poly'|'line', [(x, y), ...], filled) in the order they are drawn."""
    text = open(os.path.join(ART, name)).read()
    shapes = []
    for tag, body in re.findall(r'<(polygon|polyline|line)\b([^>]*?)/?>', text, re.S):
        if tag == 'line':
            x1, y1, x2, y2 = [float(re.search(r'\b%s="([-0-9.]+)"' % k, body).group(1)) for k in ('x1', 'y1', 'x2', 'y2')]
            shapes.append(('line', [(x1, y1), (x2, y2)], False))
        else:
            numbers = [float(n) for n in re.search(r'points="([^"]*)"', body).group(1).replace(',', ' ').split()]
            points = list(zip(numbers[0::2], numbers[1::2]))
            shapes.append(('poly' if tag == 'polygon' else 'polyline', points, 'fill="#FFFFFF"' in body and tag == 'polygon'))
    return shapes


def rotate(point, pivot, degrees):
    a = math.radians(degrees)
    dx, dy = point[0] - pivot[0], point[1] - pivot[1]
    return (pivot[0] + dx * math.cos(a) - dy * math.sin(a), pivot[1] + dx * math.sin(a) + dy * math.cos(a))


def command(kind, points, filled):
    """One precise path command."""
    data = struct.pack('<BBBBB', 3, 0, BLACK, 4, WHITE if filled else 0)
    data += struct.pack('<HH', 0 if kind == 'poly' else 1, len(points))
    for x, y in points:
        data += struct.pack('<hh', round(x * 8), round(y * 8))
    return data


def write(name, frames):
    """frames: a list of command lists. Writes the file and returns the bounding box of everything drawn."""
    body = b''
    low, high = [1e9, 1e9], [-1e9, -1e9]
    for commands in frames:
        body += struct.pack('<HH', FRAME_MS, len(commands))
        for kind, points, filled in commands:
            body += command(kind, points, filled)
            for x, y in points:
                low = [min(low[0], x), min(low[1], y)]
                high = [max(high[0], x), max(high[1], y)]
    header = struct.pack('<BBhhHH', 1, 0, 80, 80, 1, len(frames))
    data = b'PDCS' + struct.pack('<I', len(header) + len(body)) + header + body
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(data)
    return low, high, len(data)


# ---- thumbs up: slides up as a fist, the thumb pops (overshooting), sparkles fly, a small wobble settles
def thumbs_frames():
    shapes = svg_shapes('Pebble_80x80_Thumbs_up.svg')      # viewBox 58 x 68
    scale = 0.94
    ox, oy = (80 - 58 * scale) / 2, 13.0                    # room above for the sparkles
    wrist = (40.0, 74.0)
    tip_svg = (30.5, 2.0)
    frames = []
    for i in range(FRAMES):
        u = i / (FRAMES - 1)
        k = keys([(0, 0), (0.16, 0), (0.38, 1.35), (0.56, 0.9), (0.70, 1.06), (0.84, 1.0), (1, 1)], u)
        grow = keys([(0, 0.5), (0.2, 1.08), (0.32, 1.0), (1, 1)], u)
        if u < 0.4:
            turn = -14 * (1 - smooth(u / 0.4))
        else:
            turn = 6 * math.sin(2 * math.pi * 3 * (u - 0.4) / 0.6) * (1 - (u - 0.4) / 0.6)
        def place(p):
            q = (ox + p[0] * scale, oy + p[1] * scale)
            q = (40 + (q[0] - 40) * grow, 46 + (q[1] - 46) * grow)   # pops up from half size
            return rotate(q, wrist, turn)
        commands = []
        for index, (kind, points, filled) in enumerate(shapes):
            moved = []
            for n, (x, y) in enumerate(points):
                if index == 0 and n in (4, 5, 6):             # the thumb's tip grows out of the fist
                    y = 24 + (y - 24) * k
                moved.append(place((x, y)))
            commands.append((kind, moved, filled))
        # sparkles around the tip while the thumb pops
        if 0.30 < u < 0.74:
            life = math.sin(math.pi * (u - 0.30) / 0.44)
            tip = place((tip_svg[0], 24 + (tip_svg[1] - 24) * k))
            for angle in (-135, -90, -45):
                a = math.radians(angle)
                r1, r2 = 5 + 3 * life, 5 + 3 * life + 6 * life
                commands.append(('line', [(tip[0] + r1 * math.cos(a), tip[1] + r1 * math.sin(a)),
                                          (tip[0] + r2 * math.cos(a), tip[1] + r2 * math.sin(a))], False))
        frames.append(commands)
    return frames


# ---- shaka: the pinky and thumb pop out of a fist, then the hand waves from the wrist
def tide_frames():
    shapes = svg_shapes('Pebble_80x80_Tide_is_high.svg')    # viewBox 80 x 80
    wrist = (24.0, 74.0)                                     # the hand is drawn 3 px left of the SVG's place
    frames = []
    for i in range(FRAMES):
        u = i / (FRAMES - 1)
        k = keys([(0, 0), (0.12, 0), (0.32, 1.3), (0.46, 0.92), (0.56, 1.0), (1, 1)], u)
        grow = keys([(0, 0.5), (0.2, 1.08), (0.32, 1.0), (1, 1)], u)
        if u < 0.3:
            turn = 0.0
        else:
            w = (u - 0.3) / 0.7
            turn = 13 * math.sin(2 * math.pi * 2.5 * w) * min(w / 0.08, 1) * (1 - w)
        def place(p):
            q = (40 + (p[0] - 3 - 40) * grow, 46 + (p[1] - 46) * grow)   # pops up from half size, 3 px left
            return rotate(q, wrist, turn)
        commands = []
        for index, (kind, points, filled) in enumerate(shapes):
            moved = []
            for n, (x, y) in enumerate(points):
                if index == 0 and n in (1, 2, 3):            # pinky tip folds toward its base
                    y = 26 + (y - 26) * k
                if index == 0 and n in (10, 11, 12):         # thumb tip folds toward its base
                    x = 50 + (x - 50) * k
                moved.append(place((x, y)))
            commands.append((kind, moved, filled))
        # motion lines on the side the hand is swinging toward
        if abs(turn) > 5:
            side = 1 if turn > 0 else -1
            for n, (dy, length) in enumerate(((0, 9), (9, 7))):
                x0 = 70 + n * 2 if side > 0 else 8 - n * 2
                y0 = 20 + dy
                commands.append(('line', [(x0, y0), (x0 + side * length, y0 - 3)], False))
        frames.append(commands)
    return frames


def sheet(name, frames):
    from PIL import Image, ImageDraw
    cols = 9
    picks = [round(i * (len(frames) - 1) / (cols * 2 - 1)) for i in range(cols * 2)]
    cell, scale = 160, 2
    image = Image.new('RGB', (cols * cell, 2 * cell), (255, 255, 255))
    for n, index in enumerate(picks):
        tile = Image.new('RGB', (80 * scale, 80 * scale), (235, 245, 255))
        draw = ImageDraw.Draw(tile)
        for kind, points, filled in frames[index]:
            pts = [(x * scale, y * scale) for x, y in points]
            if kind == 'poly' and filled:
                draw.polygon(pts, fill=(255, 255, 255))
            line = pts + ([pts[0]] if kind == 'poly' else [])
            draw.line(line, fill=(0, 0, 0), width=4 * scale // 2 + 1, joint='curve')
        image.paste(tile, ((n % cols) * cell, (n // cols) * cell))
    image.save(os.path.join(OUT, '..', '..', 'build-sheet-%s.png' % name))


if __name__ == '__main__':
    for name, frames in (('thumbs_anim.pdc', thumbs_frames()), ('tide_anim.pdc', tide_frames())):
        low, high, size = write(name, frames)
        print('%s: %d frames, %d bytes, drawn within x %.0f..%.0f, y %.0f..%.0f' % (name, len(frames), size, low[0], high[0], low[1], high[1]))
        if '--sheet' in sys.argv:
            sheet(name.split('_')[0], frames)
