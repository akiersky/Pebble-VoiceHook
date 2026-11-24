#!/usr/bin/env python3
"""Renders the app icon (the watch menu icon and the store icons) from ../art/app-icon.svg.

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

# (The confirmation icons are vector animations written by make-pdc.py; the screens' icon sizes are in screens.json.)
