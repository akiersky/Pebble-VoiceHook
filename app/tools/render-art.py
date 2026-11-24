#!/usr/bin/env python3
"""Renders the watchapp's artwork from the SVGs in ../art into ../resources/images and ../store-assets.

Needs: pip install resvg_py pillow
"""
import io, os, re
import resvg_py
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', 'art')
IMAGES = os.path.join(HERE, '..', 'resources', 'images')
STORE = os.path.join(HERE, '..', 'store-assets')
os.makedirs(IMAGES, exist_ok=True)
os.makedirs(STORE, exist_ok=True)


def render(svg, width, height):
    data = resvg_py.svg_to_bytes(svg_string=svg, width=width, height=height)
    return Image.open(io.BytesIO(bytes(data))).convert('RGBA')


# ---- app icon: menu icon (25px), store icons, and a preview
icon_svg = open(os.path.join(ART, 'app-icon.svg')).read()
# The 25px menu icon needs bolder strokes and a simpler grille to stay legible.
small = icon_svg.replace('stroke-width="4"', 'stroke-width="5"')
small = re.sub(r'\s*<line[^>]*y1="(14|28)"[^>]*/>', '', small)
render(small, 25, 25).save(os.path.join(IMAGES, 'menu_icon.png'))
render(icon_svg, 144, 144).save(os.path.join(STORE, 'icon-144.png'))
render(icon_svg, 48, 48).save(os.path.join(STORE, 'icon-48.png'))

# ---- big tilted microphone for the main screen, one image per screen size.
# The microphone is turned about 80 degrees so its head points toward the buttons, drawn large and
# cropped by the left edge. Each image is cropped to the microphone, symmetric around the vertical middle.
mic = open(os.path.join(ART, 'Pebble_80x80_Microphone.svg')).read()
inner = re.search(r'<svg[^>]*>(.*)</svg>', mic, re.S).group(1)
inner = re.sub(r'<!--.*?-->', '', inner, flags=re.S)
SIZES = {'144x168': (144, 168), '180x180': (180, 180), '200x228': (200, 228), '260x260': (260, 260)}
for name, (w, h) in SIZES.items():
    k = h * 0.0115                       # scale of the 80x80 artwork
    right = w * 0.60                     # where the microphone's sparkles end
    cx = right - 38.5 * k * 0.985        # artwork centre (its top is 38.5 units from the centre)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
           f'<g transform="translate({cx:.2f} {h / 2:.2f}) rotate(80) scale({k:.4f}) translate(-40 -40)">{inner}</g></svg>')
    image = render(svg, w, h)
    box = image.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    mid = h / 2
    half = int(max(mid - box[1], box[3] - mid)) + 1
    top, bottom = max(0, int(mid) - half), min(h, int(mid) + half)
    image.crop((0, top, box[2] + 1, bottom)).save(os.path.join(IMAGES, f'mic_{name}.png'))
    print(name, 'mic image', box[2] + 1, 'x', bottom - top)
