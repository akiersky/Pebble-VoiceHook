#!/bin/sh
# Builds the watchapp project from the standalone plugin in the parent folder (see sync.js).
set -e
node "$(dirname "$0")/sync.js" "$@"
