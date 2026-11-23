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
3. Triggering `send_message` from the watch: not yet tested. Options are Pebble's Index agent (voice),
   a timeline pin or notification with a `pluginAction` (`inputArg: "text"`), or a small watchapp.
4. Install: `pebble install build/pebble-webhook.pbw --adb` (file first; `--adb` takes an optional device
   serial and otherwise swallows the path). Needs Android wireless debugging paired with `adb pair`.
   Publish with `pebble publish` when ready.

## Develop
```
npm test
export PATH=~/.venvs/pebble/bin:$PATH   # pebble-tool needs uv on PATH (pip install uv in the same venv)
pebble build                             # SDK 4.44+, pebble-tool 5.1.0+
pebble install --adb                     # Android over adb, or: pebble install --phone <ip>
```
Docs: https://developer.repebble.com/guides/plugins/preview/ and https://developer.repebble.com/guides/ai-agents/
Reference plugin: https://github.com/coredevices/pebble-apps/tree/main/workflowy
