#!/bin/sh
# Takes the appstore screenshots from the emulator, at each display's exact size, into store-assets/watch:
#   tools/capture-screenshots.sh basalt chalk emery gabbro diorite flint
# It builds a screenshot-only version of the app (SCREENSHOT_MODE, see src/c/main.c) in which a RESULT of 10 + n
# shows confirmation icon n and keeps it on screen, then photographs each icon at rest. The normal build is
# restored at the end. Message keys are the numbers the build assigns (build/src/message_keys.auto.c):
# RESULT 10002, MESSAGE 10003, UP_LABEL 10004, DOWN_LABEL 10005, CONFIGURED 10006.
# The app closes after a minute idle, so each platform is photographed right after launching it.
cd "$(dirname "$0")/.."
q() { grep -vE "pebble-tool|uv tool|^$|N/A%" || true; }
OUT=store-assets/watch
mkdir -p "$OUT"
SHOT_PBW="$(mktemp -d)/webhook-screenshots.pbw"

pebble clean >/dev/null 2>&1
SCREENSHOT_MODE=1 pebble build 2>&1 | q | grep -E "error|'build' finished"
cp build/app.pbw "$SHOT_PBW"

launch() {
  for attempt in 1 2 3; do
    pebble install --emulator "$1" "$SHOT_PBW" 2>&1 | q | grep -q "succeeded" && break
    sleep 15
  done
  pebble send-app-message --emulator "$1" --int 10006=1 --string 10004=Lights 10005=Garage 2>&1 | q >/dev/null
  sleep 1
}

# result PLATFORM NAME NUMBER MESSAGE: show one confirmation icon, wait for it to settle, photograph it.
result() {
  pebble send-app-message --emulator "$1" --int 10002="$3" --string 10003="$4" 2>&1 | q >/dev/null
  sleep 2.5
  pebble screenshot --emulator "$1" --no-open "$OUT/$1_$2.png" 2>&1 | q >/dev/null
}

for P in "$@"; do
  launch "$P"
  pebble screenshot --emulator "$P" --no-open "$OUT/${P}_idle.png" 2>&1 | q >/dev/null
  result "$P" plane 140 "Sent to example.com."   # 100 + 40: the paper plane 40% through its animation
  result "$P" thumbs 11 "Sent lights_off"
  result "$P" shaka 13 "Sent garage_open"
  result "$P" rock 12 "Sent party_mode"
  echo "$P done"
done

pebble clean >/dev/null 2>&1
pebble build 2>&1 | q | grep -E "error|'build' finished"
