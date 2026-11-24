# Developing VoiceHook

The repository holds two things that ship together: the **plugin** (the repo root) and the **watchapp**
(`app/`), which bundles the plugin. The plugin ("Webhook Actions" on its own, "VoiceHook" inside the watchapp: `PRODUCT` in the plugin and the page,
set by `app/sync.js`) knows nothing about any particular server.

## Layout
- `src/plugin/index.js`: the plugin. Actions `send_message { text }`, `send_command { slot }` and the internal
  `get_labels`, plus the settings-page message handler.
- `src/config.html`: the settings page (plain HTML and JS, no build step).
- `src/contract.js`: the one place for message names, limits, error-target vocabulary, the six button slots and
  the watch-to-phone message keys. `npm run contract` copies it into the plugin, the settings page, the
  phone-side relay (`app/src/pkjs/index.js`), `app/src/c/contract.h` and the `slot` enum in `package.json`.
  A test fails if any copy is stale.
- `app/`: the watchapp. `app/src/c/main.c` is the watch side (C), `app/src/pkjs/index.js` the phone-side relay.
  `app/sync.sh` copies the plugin and settings page in and writes `app/package.json` (plugin block, permissions,
  message keys, target platforms, per-screen icon resources). The build stops with "out of date" if you forget.
- `app/screens.json`: the watch screen sizes and the icon size for each. It drives the C `ICON_SIZE`, the rendered
  images (`app/tools/render-art.py`), the manifest's target platforms and per-screen resources.
- `app/store-assets/`: appstore icons, banner, screenshots and listing text. `PUBLISHING.md` has the checklist.
- `GLOSSARY.md`: the terms used in the code and the UI.

## How a message travels
1. Select on the watch starts dictation; the text goes to the phone over AppMessage.
2. The relay (`app/src/pkjs/index.js`) calls the bundled plugin with `Pebble.invokeAction`.
3. The plugin POSTs `{"text": "...", "timestamp": "<ISO>", "source": "pebble"}` (field name configurable) or the
   raw text, with your headers, to the voice-note webhook. A command sends `{"command": "...", ...}`.
4. 2xx is success; 401/403 reports an auth problem; a blocked host reports a permission problem. Redirects are
   not followed. The result goes back to the watch as `RESULT` and `MESSAGE`.

URLs and header values live in `Pebble.secureStorage`. The settings page only gets host and header names back,
never values, and a saved value is only sent to the origin (scheme, host, port) it was saved for.

## Build and test
```
npm test                                 # unit tests, plus the real settings page against the real plugin
export PATH=~/.venvs/pebble/bin:$PATH   # pebble-tool needs uv on PATH (pip install uv in the same venv)
pebble build                             # the standalone plugin: SDK 4.44+, pebble-tool 5.1.0+
cd app && ./sync.sh && pebble build      # the watchapp (includes the plugin)
pebble install build/app.pbw --adb       # Android over adb, or: pebble install --phone <ip> / --emulator <platform>
```
Installing the same version again wipes the plugin's settings, so bump `version` in `app/package.base.json` for
every install while testing (`0.1.x`). A store release needs `major.minor.0`.

Docs: https://developer.repebble.com/guides/plugins/preview/ and https://developer.repebble.com/guides/ai-agents/
Reference plugin: https://github.com/coredevices/pebble-apps/tree/main/workflowy

## Tools (`app/tools/`)
- `capture-screenshots.sh <platforms>`: builds a screenshot-only version, photographs the main screen and the
  sending screen on each emulator at the exact display size, then restores the normal build.
- `render-banner.py`: the 720x320 appstore banner and `docs/images/watch.png` for the README.
- `render-settings-shot.sh`: `docs/images/settings.png`, the settings page in headless Chrome.
- `make-pdc.py`: writes the vector animations for the thumbs-up and the shaka (`resources/images/*_anim.pdc`) from the
  iconography SVGs; the motion is described in the script. `--sheet` also writes contact sheets of the frames.
- `render-art.py`: the app icon, the confirmation icons for each screen size, and the store icons.

Icons are from https://github.com/pebble-dev/iconography (Apache 2.0), see `app/resources/images/ATTRIBUTION.md`.
