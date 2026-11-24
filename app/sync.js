#!/usr/bin/env node
// Builds the watchapp project in this folder from the standalone plugin in the parent folder:
//   - src/plugin/index.js and src/config.html are copies of the plugin and its settings page
//   - package.json is package.base.json plus the plugin block, permissions, message keys,
//     target platforms and the per-screen icon resources taken from the parent manifest, the contract
//     and screens.json
//   - everything derived from src/contract.js is refreshed first
// `node sync.js` writes them. `node sync.js --check` only reports what is stale; the build runs it.
const fs = require('fs');
const path = require('path');

const here = __dirname;
const root = path.join(here, '..');
const contract = require('../scripts/inline-contract.js');
const Contract = require('../src/contract.js');
const ICONS = ['rocket', 'music'];   // the picture icons; the others are vector animations (tools/make-pdc.py)

const readHere = (file) => fs.readFileSync(path.join(here, file), 'utf8');
const readRoot = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function manifest() {
  const base = JSON.parse(readHere('package.base.json'));
  const rootManifest = JSON.parse(readRoot('package.json'));
  const screens = JSON.parse(readHere('screens.json'));
  const pebble = base.pebble;

  // The bundled plugin shares the pbw's uuid, and the phone-side relay needs to name it.
  const relay = readHere('src/pkjs/index.js').match(/var PLUGIN_UUID = '([^']+)'/);
  if (!relay || relay[1] !== pebble.uuid) throw new Error('PLUGIN_UUID in src/pkjs/index.js must be ' + pebble.uuid);

  pebble.plugin = rootManifest.pebble.plugin;
  pebble.configPage = rootManifest.pebble.configPage;
  pebble.messageKeys = Contract.WIRE.KEYS;
  pebble.targetPlatforms = screens.flatMap((screen) => screen.platforms);

  // Permissions the plugin declares, then the watchapp's own.
  const key = (p) => p.name + '/' + (p.plugin || '');
  const permissions = [...(rootManifest.pebble.usesPermissions || [])];
  for (const p of pebble.usesPermissions || []) if (!permissions.some((q) => key(q) === key(p))) permissions.push(p);
  pebble.usesPermissions = permissions;

  const icons = [];
  for (const icon of ICONS) {
    for (const screen of screens) {
      icons.push({ type: 'bitmap', name: 'IMAGE_' + icon.toUpperCase(), file: 'images/' + icon + '_' + screen.name + '.png', targetPlatforms: screen.platforms });
    }
  }
  pebble.resources.media = [...pebble.resources.media, ...icons];
  return JSON.stringify(base, null, 2) + '\n';
}

// Every generated file in this folder as { file, content }.
function outputs() {
  return [
    { file: 'src/plugin/index.js', content: withName(readRoot('src/plugin/index.js'), 'src/plugin/index.js') },
    { file: 'src/config.html', content: watchappPage() },
    { file: 'package.json', content: manifest() },
  ];
}

// The settings page is shared with the standalone plugin; in the watchapp it also shows the watch's own settings.
function watchappPage() {
  const flag = 'var HAS_WATCHAPP = false;';
  const page = readRoot('src/config.html');
  if (!page.includes(flag)) throw new Error('src/config.html has no HAS_WATCHAPP flag');
  return withName(page.replace(flag, 'var HAS_WATCHAPP = true;'), 'src/config.html');
}

// In the watchapp the plugin and its page go by the watchapp's name, not the standalone plugin's.
function withName(text, file) {
  const standalone = "var PRODUCT = 'Webhook Actions';";
  if (!text.includes(standalone)) throw new Error(file + ' has no PRODUCT line');
  return text.replace(standalone, "var PRODUCT = 'VoiceHook';");
}

const current = (file) => { try { return readHere(file); } catch (e) { return null; } };

// What is stale: anything the contract generates, plus the files above.
function stale() {
  const list = contract.outOfDate().map((file) => path.join('..', file));
  return list.concat(outputs().filter((o) => current(o.file) !== o.content).map((o) => o.file));
}

function update() {
  contract.update();
  fs.mkdirSync(path.join(here, 'src/plugin'), { recursive: true });
  for (const o of outputs()) fs.writeFileSync(path.join(here, o.file), o.content);
}

module.exports = { stale, update };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const files = stale();
    if (files.length) { console.error('Out of date: ' + files.join(', ') + '. Run app/sync.sh.'); process.exit(1); }
  } else {
    update();
  }
}
