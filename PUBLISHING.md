# Publishing checklist

Two listings, two UUIDs: the **watchapp** (with the bundled plugin, built in `app/`) and the **standalone
plugin** (built in the repo root, for other developers). Releases go live at once, with no review queue, so
check everything first. Copy for both listings is in `app/store-assets/listing.md` and
`app/store-assets/listing-plugin.md`.

## Before the first release
- [x] Public source repository: https://github.com/akiersky/Pebble-VoiceHook (the "source code URL" for both listings; one repo holds the plugin and the watchapp).
- [x] Licence: MIT (`LICENSE`). The icons are Apache-2.0, see `app/resources/images/ATTRIBUTION.md`.
- [x] Set `version` to `1.0.0` in `package.json` (plugin) and `app/package.base.json` (watchapp). The store wants
      `major.minor.0`, so development builds (`0.1.x`) are not published. Each later release needs a new version.
- [ ] `author` is `kiersky` in both manifests.
- [ ] Run `npm test`, then `app/sync.sh` and `pebble clean && pebble build` in `app/` and in the root (a clean build, so no screenshot-mode objects linger).
- [ ] Try the build on a real watch: voice note, all six button gestures, Quick Launch, idle exit, a failure
      (turn off Wi-Fi), settings page on the phone.
- [ ] `pebble login` (opens a browser; Google, GitHub or Apple).

## Watchapp
```
cd app && ./sync.sh && pebble clean && pebble build
pebble publish --pbw build/app.pbw \
  --name "VoiceHook" --version 1.0.0 --category "Tools & Utilities" \
  --description "$(sed -n '/^## Description/,/^## Release notes/p' store-assets/listing.md | sed '1d;$d')" \
  --source https://github.com/akiersky/Pebble-VoiceHook \
  --icon-small store-assets/icon-80.png --icon-large store-assets/icon-144.png \
  --release-notes "First release: voice notes, six button commands, multiple webhooks with custom headers, and a settings page on your phone." \
  --screenshots store-assets/watch/*.png
```
Then add `store-assets/banner.png` (720x320) in the developer dashboard; the command line has no banner option.
Screenshot files must start with the platform name and an underscore (`emery_idle.png`).

## Standalone plugin
```
pebble build            # in the repo root
pebble publish          # asks for a plugin category; no screenshots
```
Use the text in `app/store-assets/listing-plugin.md`.

## After publishing
- Install it from the store on a phone and watch and repeat the checks above.
- Keep the UUIDs forever: they tie future releases to the listings.
- After the listing is live, add its appstore link to `README.md`.

## Published
- VoiceHook 1.0.0 (2026-11-25): https://apps.rePebble.com/1852e4511e1548b997838e12, UUID c0756590-bd59-464d-82f3-acd4499077d4. The first attempts with the full description and all 12 screenshots failed with a 500; it succeeded with a short description and 2 basalt screenshots, the rest added in the dashboard.
- Webhook Actions 1.0.0 (2026-11-25): https://apps.rePebble.com/753416d1f8cc403cb3406391, UUID 020583bc-828e-454c-b579-de76d60ec3e6.
- 1.0.1 (2026-11-25) for both: removed the timeline pin and the Timeline permission.
- 1.0.2 (2026-11-27) for both: settings page stacks each header's name above its value, with the remove and show/hide buttons beside them.
