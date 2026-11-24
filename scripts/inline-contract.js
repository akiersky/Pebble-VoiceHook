#!/usr/bin/env node
// Writes everything that is derived from src/contract.js:
//   - a copy of its <inline> region into the plugin, the settings page and the phone-side relay
//   - app/src/c/contract.h for the watch's C code
//   - the `slot` enum in package.json
// `node scripts/inline-contract.js` rewrites them, `--check` only reports what is out of date.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const Contract = require('../src/contract.js');
const BLOCK_FILES = ['src/plugin/index.js', 'src/config.html', 'app/src/pkjs/index.js'];
const BEGIN = '// ---- shared contract: generated from src/contract.js by `npm run contract`, do not edit ----';
const END = '// ---- end shared contract ----';

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

function region() {
  const source = read('src/contract.js');
  const start = source.indexOf('// <inline>');
  const end = source.indexOf('// </inline>');
  if (start === -1 || end === -1) throw new Error('src/contract.js has no <inline> region');
  return source.slice(start + '// <inline>'.length, end).trim();
}

function renderBlock(text, block) {
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from === -1 || to === -1) throw new Error('missing shared-contract markers');
  return text.slice(0, from) + BEGIN + '\n' + block + '\n' + text.slice(to);
}

// The watch's constants. LABEL_MAX counts the terminating zero.
function header() {
  const lines = ['// Generated from src/contract.js by scripts/inline-contract.js. Do not edit.', '#pragma once', ''];
  for (const slot of Contract.SLOTS) lines.push('#define SLOT_' + slot.id.toUpperCase() + ' ' + slot.wire);
  lines.push('', '#define RESULT_OK ' + Contract.WIRE.RESULT_OK, '#define RESULT_FAIL ' + Contract.WIRE.RESULT_FAIL);
  lines.push('#define WIRE_MESSAGE_MAX ' + Contract.WIRE.MESSAGE_MAX, '#define LABEL_MAX ' + (Contract.LIMITS.LABEL + 1), '');
  return lines.join('\n');
}

// package.json with the send_command action's `slot` enum taken from the slot table.
function manifest() {
  const data = JSON.parse(read('package.json'));
  const action = data.pebble.plugin.actions.find((a) => a.name === 'send_command');
  action.parameters.properties.slot.enum = Contract.SLOTS.map((slot) => slot.id);
  return JSON.stringify(data, null, 2) + '\n';
}

// Every derived file as { file, content }.
function outputs() {
  const block = region();
  const list = BLOCK_FILES.map((file) => ({ file, content: renderBlock(read(file), block) }));
  list.push({ file: 'app/src/c/contract.h', content: header() });
  list.push({ file: 'package.json', content: manifest() });
  return list;
}

function current(file) {
  try { return read(file); } catch (e) { return null; }
}

// The files that are not what the contract says they should be.
function outOfDate() {
  return outputs().filter((o) => current(o.file) !== o.content).map((o) => o.file);
}

function update() {
  for (const o of outputs()) fs.writeFileSync(path.join(root, o.file), o.content);
}

module.exports = { outOfDate, update };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const stale = outOfDate();
    if (stale.length) { console.error('Out of date: ' + stale.join(', ') + '. Run `npm run contract`.'); process.exit(1); }
  } else {
    update();
  }
}
