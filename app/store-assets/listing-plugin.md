# Appstore listing: Webhook Actions (standalone plugin)

## Name
Webhook Actions

## Description
Send text and fixed commands from your Pebble to any URL you choose, as an HTTP POST with the headers you set.

For watch app developers and tinkerers: this plugin gives any Pebble app a ready-made way to talk to your own server, automation or note system. It does not depend on any particular service.

Actions other apps can call (with Pebble.invokeAction):
- send_message { text }: POST the text to the voice-note webhook.
- send_command { slot }: POST one of six configured commands (up/down: press, double press, hold) to its webhook.
Callers can't read headers or choose a host: everything goes to the webhooks the user set up. Each action answers at most one request per second, and redirects are not followed.

SET UP
1. Open Webhook Actions' settings in the Pebble app and add one or more webhooks: URL, optional headers, JSON or plain-text body.
2. Tap "Save & send test message" and allow the connection when your phone asks.

PRIVATE BY DESIGN
Messages go only to the URLs you enter. Nothing is sent to the developer or any third party. URLs and header values stay in your phone's encrypted plugin storage and are never shown again after saving. Each new host needs your approval the first time it is used.

Looking for a ready-made watch app? The VoiceHook watchapp includes this plugin and adds voice notes and button commands on the watch.

## Release notes (1.0.0)
First release.

## Category
Ask `pebble publish` for the list (the docs do not name the plugin categories); "Tools & Utilities" or the closest.
