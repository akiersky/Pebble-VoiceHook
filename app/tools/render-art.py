#!/usr/bin/env python3
"""Renders the watchapp's artwork from the SVGs in ../art into ../resources/images and ../store-assets.

Needs: pip install resvg_py pillow
"""
import io, json, os, re
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


# ---- app icon: menu icon (25px) and the store's small (80px) and large (144px) icons
icon_svg = open(os.path.join(ART, 'app-icon.svg')).read()
# The 25px menu icon needs bolder strokes and a simpler grille to stay legible.
small = icon_svg.replace('stroke-width="4"', 'stroke-width="5"')
small = re.sub(r'\s*<line[^>]*y1="(14|28)"[^>]*/>', '', small)
render(small, 25, 25).save(os.path.join(IMAGES, 'menu_icon.png'))
render(icon_svg, 144, 144).save(os.path.join(STORE, 'icon-144.png'))
render(icon_svg, 80, 80).save(os.path.join(STORE, 'icon-80.png'))   # the store's small icon

# (The main-screen microphone is drawn in code on the watch, so it can move and turn.)

# ---- confirmation icons, one size per screen class (sizes set by hand in screens.json)
ICON_SIZES = {screen['name']: screen['icon'] for screen in json.load(open(os.path.join(HERE, '..', 'screens.json')))}
# (The thumbs-up and the shaka are vector animations: see make-pdc.py.)
CONFIRM = {'rocket': '80px_Rocket.svg', 'music': 'Pebble_80x80_Music_event.svg'}
for screen, size in ICON_SIZES.items():
    for name, source in CONFIRM.items():
        svg = open(os.path.join(ART, source)).read()
        image = render(svg, size, size)
        square = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        square.paste(image, ((size - image.width) // 2, (size - image.height) // 2))   # some are narrower than tall
        square.save(os.path.join(IMAGES, f'{name}_{screen}.png'))
