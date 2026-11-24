#!/bin/sh
# Takes the appstore screenshots from the emulator, at each display's exact size, into store-assets/watch:
#   tools/capture-screenshots.sh basalt chalk emery gabbro diorite flint
# It builds a screenshot-only version of the app (SCREENSHOT_MODE=1, see src/c/main.c) in which a RESULT of 10 + n
# shows confirmation icon n and keeps it on screen, then photographs the main screen and the paper plane in flight (the store needs just those two). The normal build is
# restored when the script ends, however it ends. Message key numbers are read from the build
# (build/src/message_keys.auto.c). The app closes after a minute idle, so each platform is photographed right
# after launching it.
cd "$(dirname "$0")/.."
q() { grep -vE "pebble-tool|uv tool|^$|N/A%" || true; }
OUT=store-assets/watch
mkdir -p "$OUT"
SHOT_PBW="$(mktemp -d)/webhook-screenshots.pbw"

restore() {
  pebble clean >/dev/null 2>&1
  pebble build 2>&1 | q | grep -E "error|'build' finished"
}
trap restore EXIT
trap 'exit 1' INT TERM

pebble clean >/dev/null 2>&1
SCREENSHOT_MODE=1 pebble build 2>&1 | q | grep -q "'build' finished" || { echo "screenshot build failed" >&2; exit 1; }
cp build/app.pbw "$SHOT_PBW"

key() {
  k=$(grep -E "MESSAGE_KEY_$1 =" build/src/message_keys.auto.c | grep -oE "[0-9]{4,}" | head -1)
  [ -n "$k" ] || { echo "message key $1 not found in the build" >&2; exit 1; }
  echo "$k"
}
RESULT=$(key RESULT); MESSAGE=$(key MESSAGE); UP_LABEL=$(key UP_LABEL); DOWN_LABEL=$(key DOWN_LABEL); CONFIGURED=$(key CONFIGURED)

launch() {
  for attempt in 1 2 3; do
    pebble install --emulator "$1" "$SHOT_PBW" 2>&1 | q | grep -q "succeeded" && return 0
    sleep 15
  done
  echo "could not install on $1" >&2
  return 1
}

# result PLATFORM NAME NUMBER MESSAGE: show one confirmation icon, wait for it to settle, photograph it.
result() {
  pebble send-app-message --emulator "$1" --int "$RESULT=$3" --string "$MESSAGE=$4" 2>&1 | q >/dev/null
  sleep 2.5
  pebble screenshot --emulator "$1" --no-open "$OUT/$1_$2.png" 2>&1 | q >/dev/null
}

for P in "$@"; do
  launch "$P" || exit 1
  pebble send-app-message --emulator "$P" --int "$CONFIGURED=1" --string "$UP_LABEL=Lights" "$DOWN_LABEL=Garage" 2>&1 | q >/dev/null
  sleep 1
  pebble screenshot --emulator "$P" --no-open "$OUT/${P}_idle.png" 2>&1 | q >/dev/null
  result "$P" plane 140 "Sent to example.com."   # 100 + 40: the paper plane 40% through its animation
  echo "$P done"
done
