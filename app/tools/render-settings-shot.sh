#!/bin/sh
# Takes docs/images/settings.png: the real settings page (the watchapp's copy) in headless Chrome, with a stub
# Pebble that answers with sample settings (cards closed, light theme). Needs Google Chrome.
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
node - "$TMP/page.html" <<'JS'
const fs = require('fs');
const sample = {
  configured: true, insecure: [],
  destinations: [
    { id: 'notes', name: 'Notes server', url: 'https://notes.example.com/capture', host: 'notes.example.com', format: 'json', field: 'text', headers: [{ name: 'Authorization', hasValue: true }] },
    { id: 'home', name: 'Home automation', url: 'https://home.example.com/hooks/pebble', host: 'home.example.com', format: 'json', field: 'text', headers: [{ name: 'X-Api-Key', hasValue: true }] },
  ],
  noteDestination: 'notes',
  commands: {
    up_single: { command: 'lights_off', destination: 'home', headers: [] },
    up_double: { command: 'fan_toggle', destination: 'home', headers: [] },
    up_hold: { command: 'all_off', destination: 'home', headers: [] },
    down_single: { command: 'garage_open', destination: 'home', headers: [] },
  },
  labels: { up: 'Lights', down: 'Garage' },
};
const stub = `<style>body { padding-top: 36px; }</style><script>
window.Pebble = { sendMessage: function () { return Promise.resolve(${JSON.stringify(sample)}); },
  addEventListener: function (name, callback) { if (name === 'ready') setTimeout(function () { callback({ target: 'plugin' }); }, 0); } };
</script>`;
const html = fs.readFileSync('app/src/config.html', 'utf8').replace('@media (prefers-color-scheme: dark)', '@media not all').replace('<script>', stub + '\n<script>');   // always the light theme
fs.writeFileSync(process.argv[2], html);
JS
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=500,1500 \
  --virtual-time-budget=3000 --screenshot=docs/images/settings.png "file://$TMP/page.html" 2>&1 | tail -1
# Headless Chrome adds a blank strip under the page; trim it and the page content peeking out under the Save bar, keeping the top. Needs Pillow (PY=path to a python that has it).
"${PY:-python3}" - <<'PYEOF'
from PIL import Image, ImageChops
image = Image.open('docs/images/settings.png').convert('RGB')
page = Image.new('RGB', image.size, (244, 245, 248))      # the page's background colour
box = ImageChops.difference(image, page).getbbox()
image.crop((0, 0, image.width, box[3] - 8)).save('docs/images/settings.png')
PYEOF
