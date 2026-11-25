# Appstore listing: VoiceHook (watchapp with bundled plugin)

Copy for the appstore dashboard / `pebble publish`. Plain text only (the store shows no formatting).

## Name
VoiceHook

## Category
Tools & Utilities

## Version
1.0.0 (the store wants `major.minor.0`; development builds use 0.1.x)

## Description
Send voice notes and one-press commands from your Pebble to any URL you choose.

Press Select, say your note, and it is sent as an HTTP POST to your own webhook, with the headers you set (for example an Authorization token). Up and Down send fixed commands with a press, a double press or a hold, six in all, each to the webhook you pick. Use it to feed notes, to-dos and triggers into your own server, home automation or note system, or any service that accepts a webhook.

SET UP IN A MINUTE
1. Open VoiceHook's settings in the Pebble app and paste your webhook's URL.
2. Add a header if it needs one, such as a token.
3. Tap "Save & send test message" and allow the connection when your phone asks.

HIGHLIGHTS
- Voice notes: dictate on the watch, sent as JSON or plain text.
- Six button commands (Up and Down: press, double press, hold), each with its own webhook and optional extra headers.
- Several webhooks, each with its own URL, headers and format.
- Your own reminders on the watch screen with an arrow at each button.
- Add VoiceHook to a Quick Launch button to start a voice note from anywhere.
- Closes by itself after a minute of no activity.

PRIVATE BY DESIGN
Messages go only to the URLs you enter. Nothing is sent to the developer or to any third party, and there are no accounts or analytics. Webhook URLs and header values are kept in your phone's encrypted plugin storage and are never shown again after you save them. Your phone asks your permission the first time VoiceHook connects to each new host.

Needs the Pebble mobile app with plugin support (version 2.0 or later) and a watch with a microphone. Includes the Webhook Actions plugin, which other watch apps can also use to send to your webhooks (they can't see your headers or choose another address, and the plugin answers at most one request per second per action).

## Release notes (1.0.0)
First release: voice notes, six button commands, multiple webhooks with custom headers, and a settings page on your phone.

## Permissions (as shown to the user)
- InvokeAction: "To send your notes and button commands through the VoiceHook plugin" (required)
- Internet: not declared. Each webhook host is approved by the user the first time it is used.

## Links
- Source code URL: https://github.com/akiersky/Pebble-VoiceHook
- Website URL: optional

## Images
- Small icon 80x80: `icon-80.png`. Large icon 144x144: `icon-144.png`.
- Banner 720x320: `banner.png`
- Screenshots (exact display size, no frame): `watch/<platform>_<name>.png`, two per platform: the main screen (`idle`) and the voice-note send screen (`plane`). Made with `tools/capture-screenshots.sh`.
