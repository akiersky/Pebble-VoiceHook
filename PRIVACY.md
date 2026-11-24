# Privacy

Webhook sends what you tell it to send, to the URLs you give it, and nothing else.

- **Where data goes:** only to the webhook URLs you enter in the settings. Webhook has no server of its own,
  no accounts, no analytics and no tracking. The developer receives nothing.
- **What is sent:** the text you dictate (or the command you chose for a button), the time, and the word
  `pebble`, as a POST request with the headers you set.
- **What is stored:** your webhook URLs, header values, button commands and reminders. URLs and header values
  are kept in the Pebble app's encrypted plugin storage on your phone (`Pebble.secureStorage`). Header values are
  never shown again after you save them, and a saved value is never sent to a different host: if you change a
  webhook's host, you must enter the value again.
- **Other apps:** any app you install can ask the plugin to send a note or one of your button commands. It goes only
  to the webhooks you set up, with your headers. The app never sees the headers or the URL and can't pick another
  address. Each action answers at most one request per second.
- **Permissions:** your phone asks you to allow Webhook to connect to each host the first time it is used. You
  can withdraw that in the plugin's permissions.
- **Voice:** dictation is done by your phone's and watch's own speech recognition. Webhook only receives the
  resulting text.
- **Logs:** the plugin may log the host name and the names (never the values) of the headers it sends, on your
  phone only.
- **Plain http:** if you use an `http://` URL the page warns you, because the note and headers then travel
  unencrypted. Prefer `https://`.
