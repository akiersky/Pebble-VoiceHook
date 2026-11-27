# Sending notes to Memos

[Memos](https://usememos.com) (MIT, self-hosted) can take VoiceHook's notes directly, with no receiver in between.
Checked against Memos 26.11.2: its create-memo endpoint accepts the JSON VoiceHook sends and ignores the extra
`timestamp` and `source` fields.

1. Run Memos, for example `docker run -d --name memos -p 5230:5230 -v ~/.memos:/var/opt/memos neosmemo/memos:stable`, and create your account.
2. Make it reachable from your phone over https (a Cloudflare Tunnel or similar), since the phone sends the request.
3. In Memos, create an access token in your account settings. It starts with `memos_pat_` and is shown once.
4. In VoiceHook's settings add a webhook:
   - URL: `https://<your memos address>/api/memos`
   - Header: `Authorization` = `Bearer memos_pat_...`
   - Format: JSON, with the field name set to `content`
5. Choose it as the voice-note webhook and tap "Save & send test message". A memo should appear.

If the address is behind Cloudflare Access, the watch can't sign in through a browser page. Add a separate Access
application for just `<your memos address>/api/memos` with a Service Auth policy for a service token, and add two more
headers to the webhook: `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Without them Access answers 403; with them
the request reaches Memos, which still needs its own token.

Notes arrive as private memos stamped with the time they reach Memos. A `#hashtag` in a dictated note becomes a tag.
Older Memos versions used `/api/v1/memos`; 26.11 removed it, so use `/api/memos`.

Memos keeps notes in its own database, not as Markdown files. For a plain Markdown folder instead, see `receiver/`.
