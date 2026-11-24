#!/usr/bin/env python3
"""Renders the appstore banner (720x320) and the README picture (docs/images/watch.png) from the app icon and two
emulator screenshots.

Needs: pip install resvg_py pillow. Run tools/capture-screenshots.sh first; it writes store-assets/watch/basalt_idle.png and basalt_plane.png.
"""
import io, os
import resvg_py
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, '..', 'store-assets')
FONTS = ['/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf', '/Library/Fonts/Arial Rounded Bold.ttf',
         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']

def font(size):
    for path in FONTS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit('No bold font found; add one to FONTS in tools/render-banner.py')
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

draw.text((40, 188), 'VoiceHook', font=font(58), fill=(255, 255, 255))
draw.text((42, 254), 'Voice notes and button presses,', font=font(21), fill=(232, 238, 255))
draw.text((42, 282), 'sent to any URL you choose.', font=font(21), fill=(232, 238, 255))

left = device(os.path.join(STORE, 'watch', 'basalt_idle.png'), 1)
right = device(os.path.join(STORE, 'watch', 'basalt_plane.png'), 1)
shadowed(banner, left, (384, 56))
shadowed(banner, right, (552, 96))

banner.convert('RGB').save(os.path.join(STORE, 'banner.png'))
print('banner.png', banner.size)

# The README picture: the same two screens, twice the size, side by side with a caption each.
pair = Image.new('RGBA', (720, 400), (0, 0, 0, 0))
for i, name in enumerate(['basalt_idle.png', 'basalt_plane.png']):
    watch = device(os.path.join(STORE, 'watch', name), 2)
    pair.alpha_composite(watch, (28 + i * 360, 36))
os.makedirs(os.path.join(HERE, '..', '..', 'docs', 'images'), exist_ok=True)
pair.save(os.path.join(HERE, '..', '..', 'docs', 'images', 'watch.png'))
print('docs/images/watch.png', pair.size)
