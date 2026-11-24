# Webhook: a Pebble plugin

Sends text from your Pebble to a URL you choose, as an HTTP POST with the headers you set.
Generic by design: it knows nothing about any particular server or note system.

## How it works
- Settings page (opened from the plugin in the Pebble app): URL, header name/value rows,
  message format (JSON or plain text), a **Send test message** button, and **Clear settings**.
- The URL and header values are stored together in `Pebble.secureStorage` (encrypted by the phone's keystore).
  The settings page only gets the host and header names back, never the values.
- Action `send_message { text }` does:
  `POST <url>` with your headers and body `{"text": "...", "timestamp": "<ISO>", "source": "pebble"}`
  (field name configurable) or the raw text.
- 2xx means success. 401/403 reports an auth problem. A blocked host reports a permission problem.

## Status
Early. Unit tests pass (`npm test`). Builds to `build/pebble-webhook.pbw` with pebble-tool 5.2.0 / SDK 4.44. Installed and tested on an Android phone (Pixel 7).

Findings from testing on Android (2026-11-23):
1. A host typed in settings works with no `Internet` domain declared. The phone asks the user to allow
   the host the first time it is used (tested against webhook.site). CONFIRMED.
2. Custom request headers arrive at the receiver, along with the JSON body (`text`, `timestamp`, `source`). CONFIRMED.
3. Triggering `send_message` from the watch: a timeline pin inserted by the plugin
   (`Pebble.insertTimelinePin`, action `{type: 'pluginAction', action: 'send_message', inputArg: 'text'}`)
   works. The watch prompts for dictation and the dictated text arrives as `text` in the POST. CONFIRMED.
   The settings page has an "Add Send note pin" button to create it.
4. Install: `pebble install build/pebble-webhook.pbw --adb` (file first; `--adb` takes an optional device
   serial and otherwise swallows the path). Needs Android wireless debugging paired with `adb pair`.
   Publish with `pebble publish` when ready.

## Watchapp (`app/`)
`app/` is the same plugin bundled with a small watchapp: Select dictates a note, Up and Down send
fixed commands (press, double press, hold). Assign it to a Quick Launch button on the watch to start a voice
note from anywhere; it then starts dictating at once and closes after the confirmation. It also closes after a
minute of nothing.

Build it with `app/sync.sh` and then `pebble build` inside `app/`. `app/sync.js` copies the plugin and the
settings page in and writes `app/package.json` (plugin block, permissions, message keys, target platforms and
per-screen icon resources). The build stops with "out of date" if you forget.
Icons are from https://github.com/pebble-dev/iconography (Apache 2.0), see `app/resources/images/ATTRIBUTION.md`.

## One place for each fact
- `src/contract.js`: message names, limits, error-target vocabulary, the six button slots and the
  watch-to-phone message keys. `npm run contract` copies it into the plugin, the settings page, the phone-side
  relay (`app/src/pkjs/index.js`), `app/src/c/contract.h` and the `slot` enum in `package.json`. A test fails
  if any copy is stale.
- `app/screens.json`: the watch screen sizes and the icon size for each. It drives the C `ICON_SIZE`, the
  rendered images (`app/tools/render-art.py`), the manifest's target platforms and per-screen resources.
- See `GLOSSARY.md` for the terms.

## Develop
```
npm test                                 # unit tests plus the real settings page against the real plugin
export PATH=~/.venvs/pebble/bin:$PATH   # pebble-tool needs uv on PATH (pip install uv in the same venv)
pebble build                             # SDK 4.44+, pebble-tool 5.1.0+
pebble install --adb                     # Android over adb, or: pebble install --phone <ip>
```
Docs: https://developer.repebble.com/guides/plugins/preview/ and https://developer.repebble.com/guides/ai-agents/
Reference plugin: https://github.com/coredevices/pebble-apps/tree/main/workflowy
