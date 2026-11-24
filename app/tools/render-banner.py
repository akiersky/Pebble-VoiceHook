#!/usr/bin/env python3
"""Renders the appstore banner (720x320) from the app icon and two emulator screenshots.

Needs: pip install resvg_py pillow. Run tools/capture-screenshots.sh first and copy the screenshots you chose
to store-assets/watch/basalt_idle.png and basalt_thumbs.png.
"""
import io, os
import resvg_py
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, '..', 'store-assets')
FONT = '/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'
W, H = 720, 320
BACKGROUND = (71, 114, 250)      # the settings page's accent blue

def icon(size):
    svg = open(os.path.join(HERE, '..', 'art', 'app-icon.svg')).read()
    data = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(io.BytesIO(bytes(data))).convert('RGBA')

def device(path, scale):
    shot = Image.open(path).convert('RGBA')
    shot = shot.resize((shot.width * scale, shot.height * scale), Image.NEAREST)
    pad = 10
    frame = Image.new('RGBA', (shot.width + 2 * pad, shot.height + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle((0, 0, frame.width - 1, frame.height - 1), radius=22, fill=(24, 26, 34, 255))
    frame.alpha_composite(shot, (pad, pad))
    return frame

def shadowed(canvas, layer, position):
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    mask = Image.new('RGBA', layer.size, (0, 0, 0, 110))
    shadow.paste(mask, (position[0] + 6, position[1] + 10), layer.getchannel('A'))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10)))
    canvas.alpha_composite(layer, position)

banner = Image.new('RGBA', (W, H), BACKGROUND + (255,))
draw = ImageDraw.Draw(banner)
# a soft lighter band behind the watches
draw.ellipse((330, -120, 900, 440), fill=(96, 136, 252, 255))

tile = Image.new('RGBA', (120, 120), (0, 0, 0, 0))
ImageDraw.Draw(tile).rounded_rectangle((0, 0, 119, 119), radius=28, fill=(255, 255, 255, 255))
tile.alpha_composite(icon(96), (12, 12))
shadowed(banner, tile, (40, 52))

draw.text((40, 188), 'Webhook', font=ImageFont.truetype(FONT, 58), fill=(255, 255, 255))
draw.text((42, 254), 'Voice notes and button presses,', font=ImageFont.truetype(FONT, 21), fill=(232, 238, 255))
draw.text((42, 282), 'sent to any URL you choose.', font=ImageFont.truetype(FONT, 21), fill=(232, 238, 255))

left = device(os.path.join(STORE, 'watch', 'basalt_idle.png'), 1)
right = device(os.path.join(STORE, 'watch', 'basalt_thumbs.png'), 1)
shadowed(banner, left, (400, 56))
shadowed(banner, right, (558, 96))

banner.convert('RGB').save(os.path.join(STORE, 'banner.png'))
print('banner.png', banner.size)
