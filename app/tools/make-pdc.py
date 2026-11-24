#!/usr/bin/env python3
"""Writes the confirmation icons (vector animations, PDC) into ../resources/images.

The shapes come from the Pebble iconography SVGs in ../art; the motion is described here, frame by frame.
    thumbs_anim.pdc   Pebble_80x80_Thumbs_up.svg: the thumb pops up from a fist, with sparkles, and wobbles
    tide_anim.pdc     Pebble_80x80_Tide_is_high.svg: the pinky and thumb pop out and the hand waves
    music_anim.pdc    Pebble_80x80_Music_event.svg: the horns pop up and the hand headbangs
    rocket_anim.pdc   80px_Rocket.svg: it rumbles on the pad, then blasts off with a growing flame and smoke

    python3 make-pdc.py           writes the .pdc files
    python3 make-pdc.py --sheet   also writes build-sheet-<name>.png contact sheets of the frames (needs Pillow)

PDC layout (see the Pebble docs on Draw Commands): 'PDCS', size, version 1, view box, play count, frame count,
then per frame a duration in ms and its commands. Commands here are precise paths: points in 1/8 pixel.
"""
import math, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', 'art')
OUT = os.path.join(HERE, '..', 'resources', 'images')
FRAME_MS = 33
FRAMES = 36            # 36 x 33 ms, about 1.2 s
BLACK, WHITE, NONE = 192, 255, 0   # ARGB2222


class Shape:
    """kind 'poly' (closed) or 'line' (open); fill and stroke are colours; width 0 means no outline."""
    def __init__(self, kind, points, fill=NONE, width=4):
        self.kind, self.points, self.fill, self.width = kind, [tuple(p) for p in points], fill, width

    def moved(self, points):
        return Shape(self.kind, points, self.fill, self.width)


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


def attr(body, name):
    found = re.search(r'\b%s="([^"]*)"' % name, body)
    return found.group(1) if found else None


def colour(value):
    if value is None or value.lower() == 'none':
        return NONE
    return BLACK if value.lower() in ('#000000', 'black') else WHITE


def svg_shapes(name):
    """Every drawn shape of the SVG, in drawing order (polygon, polyline, line, path with M L H V Z, and rect as a dot)."""
    text = open(os.path.join(ART, name)).read()
    shapes = []
    for tag, body in re.findall(r'<(polygon|polyline|line|path|rect)\b([^>]*?)/?>', text, re.S):
        width = float(attr(body, 'stroke-width') or 4) if attr(body, 'stroke') not in (None, 'none') else 0
        fill = colour(attr(body, 'fill'))
        if tag == 'line':
            x1, y1, x2, y2 = [float(attr(body, k)) for k in ('x1', 'y1', 'x2', 'y2')]
            shapes.append(Shape('line', [(x1, y1), (x2, y2)], NONE, width))
        elif tag in ('polygon', 'polyline'):
            numbers = [float(n) for n in attr(body, 'points').replace(',', ' ').split()]
            points = list(zip(numbers[0::2], numbers[1::2]))
            if tag == 'polyline' and fill:
                # An open outline with a fill: the fill is a closed shape of its own, drawn under the outline.
                shapes.append(Shape('poly', points, fill, 0))
                fill = NONE
            shapes.append(Shape('poly' if tag == 'polygon' else 'line', points, fill, width))
        elif tag == 'rect':
            x, y, w, h = [float(attr(body, k)) for k in ('x', 'y', 'width', 'height')]
            shapes.append(Shape('poly', [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], fill, 0))
        else:
            points, x, y, closed = [], 0.0, 0.0, False
            for op, args in re.findall(r'([MLHVZ])([^MLHVZ]*)', attr(body, 'd')):
                n = [float(v) for v in args.replace(',', ' ').split()]
                if op in 'ML':
                    x, y = n[0], n[1]
                elif op == 'H':
                    x = n[0]
                elif op == 'V':
                    y = n[0]
                if op == 'Z':
                    closed = True
                else:
                    points.append((x, y))
            if closed and points[0] == points[-1]:
                points.pop()
            shapes.append(Shape('poly' if closed else 'line', points, fill, width))
    return shapes


def rotate(point, pivot, degrees):
    a = math.radians(degrees)
    dx, dy = point[0] - pivot[0], point[1] - pivot[1]
    return (pivot[0] + dx * math.cos(a) - dy * math.sin(a), pivot[1] + dx * math.sin(a) + dy * math.cos(a))


def scaled(point, centre, factor):
    return (centre[0] + (point[0] - centre[0]) * factor, centre[1] + (point[1] - centre[1]) * factor)


def command(shape):
    """One precise path command."""
    stroke = BLACK if shape.width else NONE
    data = struct.pack('<BBBBB', 3, 0, stroke, int(round(shape.width)), shape.fill)
    data += struct.pack('<HH', 0 if shape.kind == 'poly' else 1, len(shape.points))
    for x, y in shape.points:
        data += struct.pack('<hh', round(x * 8), round(y * 8))
    return data


def write(name, frames):
    """frames: a list of Shape lists. Writes the file and returns the bounding box of everything drawn."""
    body = b''
    low, high = [1e9, 1e9], [-1e9, -1e9]
    for shapes in frames:
        body += struct.pack('<HH', FRAME_MS, len(shapes))
        for shape in shapes:
            body += command(shape)
            for x, y in shape.points:
                low = [min(low[0], x), min(low[1], y)]
                high = [max(high[0], x), max(high[1], y)]
    header = struct.pack('<BBhhHH', 1, 0, 80, 80, 1, len(frames))
    data = b'PDCS' + struct.pack('<I', len(header) + len(body)) + header + body
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(data)
    return low, high, len(data)


def sparkles(centre, life, angles, inner=5, reach=6):
    """A burst of short lines radiating from a point; `life` runs 0 to 1 to 0."""
    out = []
    for angle in angles:
        a = math.radians(angle)
        r1, r2 = inner + 3 * life, inner + 3 * life + reach * life
        out.append(Shape('line', [(centre[0] + r1 * math.cos(a), centre[1] + r1 * math.sin(a)),
                                  (centre[0] + r2 * math.cos(a), centre[1] + r2 * math.sin(a))], NONE, 4))
    return out


# ---- thumbs up: pops up as a fist, the thumb pops (overshooting), sparkles fly, a small wobble settles
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
            return rotate(scaled(q, (40, 46), grow), wrist, turn)
        frame = []
        for index, shape in enumerate(shapes):
            moved = []
            for n, (x, y) in enumerate(shape.points):
                if index == 0 and n in (4, 5, 6):             # the thumb's tip grows out of the fist
                    y = 24 + (y - 24) * k
                moved.append(place((x, y)))
            frame.append(shape.moved(moved))
        if 0.30 < u < 0.74:
            frame += sparkles(place((tip_svg[0], 24 + (tip_svg[1] - 24) * k)), math.sin(math.pi * (u - 0.30) / 0.44), (-135, -90, -45))
        frames.append(frame)
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
            return rotate(scaled((p[0] - 3, p[1]), (40, 46), grow), wrist, turn)
        frame = []
        for index, shape in enumerate(shapes):
            moved = []
            for n, (x, y) in enumerate(shape.points):
                if index == 0 and n in (1, 2, 3):            # pinky tip folds toward its base
                    y = 26 + (y - 26) * k
                if index == 0 and n in (10, 11, 12):         # thumb tip folds toward its base
                    x = 50 + (x - 50) * k
                moved.append(place((x, y)))
            frame.append(shape.moved(moved))
        if abs(turn) > 5:                                    # motion lines on the side the hand swings toward
            side = 1 if turn > 0 else -1
            for n, (dy, length) in enumerate(((0, 9), (9, 7))):
                x0 = 70 + n * 2 if side > 0 else 8 - n * 2
                frame.append(Shape('line', [(x0, 20 + dy), (x0 + side * length, 17 + dy)], NONE, 4))
        frames.append(frame)
    return frames


# ---- rock on: the horns pop up from a fist, then the hand headbangs with a bounce and sparks on the beat
def music_frames():
    shapes = svg_shapes('Pebble_80x80_Music_event.svg')    # viewBox 80 x 80
    wrist = (31.0, 76.0)
    frames = []
    for i in range(FRAMES):
        u = i / (FRAMES - 1)
        k = keys([(0, 0), (0.12, 0), (0.32, 1.3), (0.46, 0.92), (0.56, 1.0), (1, 1)], u)
        grow = keys([(0, 0.5), (0.2, 1.08), (0.32, 1.0), (1, 1)], u)
        w = max((u - 0.3) / 0.7, 0.0)
        turn = 15 * math.sin(2 * math.pi * 2.5 * w) * min(w / 0.08, 1) * (1 - w) if u >= 0.3 else 0.0
        hop = 4 * abs(math.sin(2 * math.pi * 2.5 * w)) * (1 - w) if u >= 0.3 else 0.0

        def place(p):
            q = rotate(scaled(p, (40, 46), grow), wrist, turn)
            return (q[0], q[1] - hop)
        frame = []
        for index, shape in enumerate(shapes):
            moved = []
            for n, (x, y) in enumerate(shape.points):
                if index in (1, 2) and n in (7, 8, 9):          # the index finger's horn folds toward its base
                    y = 27 + (y - 27) * k
                if index in (6, 7) and n in (1, 2, 3):          # the pinky's horn folds toward its base
                    y = 43 + (y - 43) * k
                moved.append(place((x, y)))
            frame.append(shape.moved(moved))
        for beat in (0.30, 0.52):                            # a spark at each horn on the beats
            if beat < u < beat + 0.16:
                life = math.sin(math.pi * (u - beat) / 0.16)
                frame += sparkles(place((31, 8 + (27 - 8) * (1 - k))), life, (-150, -110), 5, 5)
                frame += sparkles(place((61, 6 + (43 - 6) * (1 - k))), life, (-70, -30), 5, 5)
        frames.append(frame)
    return frames


# ---- rocket: rumbles on the pad, then blasts off up and to the right with a long flame; the stars twinkle on
def rocket_frames():
    shapes = svg_shapes('80px_Rocket.svg')
    body = shapes[0:3]            # hull, nose line, window
    flames = shapes[3:6]          # three streaks, each starting at the tail
    pluses = [shapes[6:8], shapes[8:10], shapes[10:12], shapes[12:14]]
    plus_centres = [(23, 9), (8, 36), (23, 75), (71, 57)]
    dots = shapes[14:20]
    frames = []
    for i in range(FRAMES):
        u = i / (FRAMES - 1)
        lift_off = 0.28
        if u < lift_off:                                     # rumble
            ox, oy = (1.5 if i % 2 else -1.5), (1.0 if (i // 2) % 2 else -1.0)
            stretch = 0.75 + 0.35 * (i % 3) / 2
            run = 0.0
        else:
            run = (u - lift_off) / (1 - lift_off)
            distance = 118 * run * run
            ox, oy = distance * 0.707, -distance * 0.707
            stretch = (1.0 + 0.9 * ease_out(run / 0.35) + 0.2 * math.sin(i * 2.3)) * min(1.0, (1 - run) / 0.3)
        frame = []
        for shape in body:
            frame.append(shape.moved([(x + ox, y + oy) for x, y in shape.points]))
        for shape in flames:
            (x1, y1), (x2, y2) = shape.points
            frame.append(shape.moved([(x1 + ox, y1 + oy), (x1 + (x2 - x1) * stretch + ox, y1 + (y2 - y1) * stretch + oy)]))
        if run > 0:                                          # smoke puffs left on the pad
            for n, (px, py) in enumerate(((22, 60), (27, 64), (17, 55))):
                life = max(0.0, 1 - run * 1.6 + n * 0.12)
                size = 2.5 * life
                if size > 0.4:
                    cx, cy = px - 6 * run * (n + 1), py + 5 * run * (n + 1)
                    frame.append(Shape('poly', [(cx - size, cy - size), (cx + size, cy - size), (cx + size, cy + size), (cx - size, cy + size)], BLACK, 0))
        for n, pair in enumerate(pluses):                    # the plus-shaped stars pulse in turn
            factor = 1.0 + 0.35 * math.sin(i * 0.9 + n * 1.7)
            for shape in pair:
                frame.append(shape.moved([scaled(p, plus_centres[n], factor) for p in shape.points]))
        for n, shape in enumerate(dots):                     # the small dots blink
            if (i + n) % 4 != 0:
                frame.append(shape)
        frames.append(frame)
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
        for shape in frames[index]:
            pts = [(x * scale, y * scale) for x, y in shape.points]
            if shape.kind == 'poly' and shape.fill and len(pts) > 2:
                draw.polygon(pts, fill=(0, 0, 0) if shape.fill == BLACK else (255, 255, 255))
            if shape.width:
                line = pts + ([pts[0]] if shape.kind == 'poly' else [])
                draw.line(line, fill=(0, 0, 0), width=int(shape.width * scale / 2) + 1, joint='curve')
        image.paste(tile, ((n % cols) * cell, (n // cols) * cell))
    image.save(os.path.join(HERE, '..', 'build-sheet-%s.png' % name))


if __name__ == '__main__':
    for name, frames in (('thumbs_anim.pdc', thumbs_frames()), ('tide_anim.pdc', tide_frames()),
                         ('music_anim.pdc', music_frames()), ('rocket_anim.pdc', rocket_frames())):
        low, high, size = write(name, frames)
        print('%s: %d frames, %d bytes, drawn within x %.0f..%.0f, y %.0f..%.0f' % (name, len(frames), size, low[0], high[0], low[1], high[1]))
        if '--sheet' in sys.argv:
            sheet(name.split('_')[0], frames)
