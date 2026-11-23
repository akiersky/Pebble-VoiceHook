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
Early. Unit tests pass (`npm test`). Not yet built or run on a phone.

Open questions to settle by testing:
1. Does plugin `fetch` reach a host typed in settings when the manifest declares no `Internet` domain?
   (Docs say each domain is its own permission. This plugin declares none on purpose.)
2. Are custom request headers honored by plugin `fetch`? (Workflowy's plugin sets `Authorization`, so likely.)
3. How does a user trigger `send_message` from the watch? The docs show agent (Index) actions and `pluginAction` on pins.
4. How to install a local `.pbw` for testing, then publishing with `pebble publish`.

## Develop
```
npm test
~/.venvs/pebble/bin/pebble build     # SDK 4.44+, pebble-tool 5.1.0+
```
Docs: https://developer.repebble.com/guides/plugins/preview/ and https://developer.repebble.com/guides/ai-agents/
Reference plugin: https://github.com/coredevices/pebble-apps/tree/main/workflowy
