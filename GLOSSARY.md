# Glossary

- **Webhook** (in the code, a *destination*): a named URL with its own headers and format. Up to 10. The
  settings page and the watch say "webhook"; the code and the contract say `destination`.
- **Note**: dictated text sent with the Select button. Goes to the voice-note webhook.
  Confirmed with the paper plane.
- **Command**: a fixed word the user chose for a button slot, sent as `{"command": "<name>"}`.
- **Slot**: one of the six button gestures (Up or Down, each as press, double press, hold). Listed once in
  `src/contract.js`; `wire` is the number the watch sends.
- **Reminder**: the user's own text shown next to the Up and Down buttons on the watch.
- **Extra headers**: headers on a command that are added to its webhook's headers. Same name: both values are
  sent, comma-separated.
- **Contract**: what the plugin and the settings page agree on (`src/contract.js`).
- **Relay**: the phone-side script in the watchapp (`app/src/pkjs/index.js`) that passes the watch's requests
  to the plugin.
- **Target**: the field of the settings page an error belongs to, so the page can mark it.
- **Setup needed**: the phone tells the watch at launch whether anything is saved (`CONFIGURED`). If not, the
  watch says "Set up VoiceHook in the phone app" instead of recording something that would only fail.
- **Choose a webhook**: what a button or the voice note shows after its webhook was removed. It never moves to
  another webhook by itself, and Save is blocked until a webhook is chosen.
