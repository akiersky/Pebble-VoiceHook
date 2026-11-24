# Publishing checklist

Two listings, two UUIDs: the **watchapp** (with the bundled plugin, built in `app/`) and the **standalone
plugin** (built in the repo root, for other developers). Releases go live at once, with no review queue, so
check everything first. Copy for both listings is in `app/store-assets/listing.md` and
`app/store-assets/listing-plugin.md`.

## Before the first release
- [ ] A public source repository, and its URL for the "source code URL" field (the repo is on a private Gitea).
- [ ] A licence for the code (none is set yet). The icons are Apache-2.0, see `app/resources/images/ATTRIBUTION.md`.
- [ ] Set `version` to `1.0.0` in `package.json` (plugin) and `app/package.base.json` (watchapp). The store wants
      `major.minor.0`, so development builds (`0.1.x`) are not published. Each later release needs a new version.
- [ ] `author` is `kiersky` in both manifests.
- [ ] Run `npm test`, then `app/sync.sh` and `pebble build` in `app/` and in the root.
- [ ] Try the build on a real watch: voice note, all six button gestures, Quick Launch, idle exit, a failure
      (turn off Wi-Fi), settings page on the phone.
- [ ] `pebble login` (opens a browser; Google, GitHub or Apple).

## Watchapp
```
cd app && ./sync.sh && pebble build
pebble publish --pbw build/app.pbw \
  --name "Webhook" --version 1.0.0 --category "Tools & Utilities" \
  --description "$(sed -n '/^## Description/,/^## Release notes/p' store-assets/listing.md | sed '1d;$d')" \
  --source <public repo URL> \
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
