#!/bin/sh
# Builds the watchapp project from the standalone plugin in the parent folder:
# copies the plugin script and settings page, and merges the plugin block into package.json.
set -e
cd "$(dirname "$0")"
mkdir -p src/plugin
cp ../src/plugin/index.js src/plugin/index.js
cp ../src/config.html src/config.html
node -e '
const base = require("./package.base.json");
const root = require("../package.json");
base.pebble.plugin = root.pebble.plugin;
base.pebble.configPage = root.pebble.configPage;
require("fs").writeFileSync("package.json", JSON.stringify(base, null, 2) + "\n");
'
