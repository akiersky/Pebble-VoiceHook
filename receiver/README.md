# VoiceHook receiver

A small server that takes the webhooks VoiceHook (or any app using Webhook Actions) sends and appends them to
plain Markdown files. One file, no dependencies, Node 18 or later.

```
POST /note      {"text": "buy milk"}       ->  Daily/2026-11-26.md     - 14:32 buy milk
POST /command   {"command": "lights_off"}  ->  Commands/2026-11-26.md  - 14:32 lights_off
```

Each day's file starts with a `# YYYY-MM-DD` heading, then one list item per note. Nothing else is written: no
frontmatter, no app settings, so any Markdown notes app (or none) can open the folder. Text that arrives as plain text
works too, and a multi-line note stays inside its list item.

## Run it
```
VAULT_DIR=~/notes TOKEN=$(openssl rand -hex 24) node receiver/server.js
```
`VAULT_DIR` must already exist. Other settings: `PORT` (8787), `HOST` (127.0.0.1, so only this computer, or a tunnel
running on it, can reach it), `NOTES_DIR` (Daily), `COMMANDS_DIR` (Commands). Times and dates use the computer's
time zone (`TZ=...` to change it). Keep the token: you will paste it into VoiceHook.

## Point VoiceHook at it
In VoiceHook's settings add two webhooks, each with the header `Authorization` = `Bearer <your token>`:
- **Notes**: `https://<your address>/note`, format JSON, field `text`. Use it for the voice-note webhook.
- **Commands**: `https://<your address>/command`, format JSON. Choose it for the button commands.

Use the "Save & send test message" button; a line should appear in `Daily/`.

## Reach it from your phone
The phone sends the request, so the address has to work away from home. A Cloudflare Tunnel pointing at
`http://localhost:8787` gives you an https address (`cloudflared tunnel --url http://localhost:8787` makes a temporary one to try).
Tailscale works as well. Either way the token is the only thing keeping strangers out, so keep it long and private.
If the computer is asleep or the tunnel is down, a send fails and the watch shows the failure screen; VoiceHook does not retry.

## Keep it running (macOS)
Save as `~/Library/LaunchAgents/com.voicehook.receiver.plist` (edit the paths and token), then
`launchctl load ~/Library/LaunchAgents/com.voicehook.receiver.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.voicehook.receiver</string>
  <key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>/path/to/receiver/server.js</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>VAULT_DIR</key><string>/Users/you/notes</string>
    <key>TOKEN</key><string>your-long-token</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/voicehook-receiver.log</string>
  <key>StandardErrorPath</key><string>/tmp/voicehook-receiver.log</string>
</dict></plist>
```
The log lines name the file written, never the note text.

## Limits
Bodies over 16 KB are refused. A timestamp from the watch more than two days off the computer's clock is ignored,
so a wrong watch clock can't file a note under the wrong day. Requests without the right token get a 401 and write nothing.
