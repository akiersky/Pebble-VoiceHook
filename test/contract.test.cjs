const test = require('node:test');
const assert = require('node:assert');
const Contract = require('../src/contract.js');
const { outOfDate } = require('../scripts/inline-contract.js');
const { start } = require('./harness.cjs');

test('the plugin and the page carry the current contract', () => {
  assert.deepStrictEqual(outOfDate(), [], 'run `npm run contract`');
});

test('the plugin answers every message type in the contract', async () => {
  const t = await start();
  for (const type of Object.values(Contract.MESSAGES)) {
    const reply = await t.window.Pebble.sendMessage('plugin', { type });
    assert.notStrictEqual(reply && reply.error, 'Unknown message type.', type);
  }
  const unknown = await t.window.Pebble.sendMessage('plugin', { type: 'nope' });
  assert.strictEqual(unknown.error, 'Unknown message type.');
});

const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// Runs the phone-side relay (app/src/pkjs/index.js) against a stub Pebble and gives back what it did.
function runRelay(invokeResult) {
  const calls = [];
  const replies = [];
  let onMessage;
  const sandbox = {
    console,
    Pebble: {
      addEventListener(name, callback) { if (name === 'appmessage') onMessage = callback; },
      invokeAction: (request) => { calls.push(request); return Promise.resolve(invokeResult || { ok: true, text: 'done' }); },
      sendAppMessage: (message) => { replies.push(message); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app/src/pkjs/index.js'), 'utf8'), sandbox);
  const send = async (payload) => { onMessage({ payload }); await new Promise((resolve) => setTimeout(resolve, 5)); };
  return { calls, replies, send };
}

test('the slot table is consistent', () => {
  const ids = Contract.SLOTS.map((slot) => slot.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.deepStrictEqual(Contract.SLOTS.map((slot) => slot.wire), ids.map((_, i) => i + 1));
  for (const slot of Contract.SLOTS) assert.ok(slot.id.startsWith(slot.button + '_'), slot.id);
});

test('the phone relay turns every watch slot number into the plugin action for that slot', async () => {
  const relay = runRelay();
  for (const slot of Contract.SLOTS) await relay.send({ SLOT: slot.wire });
  assert.deepStrictEqual(relay.calls.map((call) => call.args.slot), Contract.SLOTS.map((slot) => slot.id));
  assert.ok(relay.calls.every((call) => call.action === 'send_command'));
  assert.strictEqual(relay.replies.length, Contract.SLOTS.length);
  assert.ok(relay.replies.every((reply) => reply.RESULT === Contract.WIRE.RESULT_OK));
});

test('the phone relay sends notes, rejects unknown requests, and shortens long replies', async () => {
  const relay = runRelay({ ok: false, message: 'x'.repeat(200) });
  await relay.send({ TEXT: 'buy milk' });
  assert.deepStrictEqual([relay.calls[0].action, relay.calls[0].args.text], ['send_message', 'buy milk']);
  assert.strictEqual(relay.replies[0].RESULT, Contract.WIRE.RESULT_FAIL);
  assert.strictEqual(relay.replies[0].MESSAGE.length, Contract.WIRE.MESSAGE_MAX);

  await relay.send({ SLOT: 99 });
  assert.strictEqual(relay.calls.length, 1);
  assert.strictEqual(relay.replies[1].RESULT, Contract.WIRE.RESULT_FAIL);
  for (const reply of relay.replies) for (const key of Object.keys(reply)) assert.ok(Contract.WIRE.KEYS.includes(key), key);
});

test('the relay only reads keys the contract declares', () => {
  const source = fs.readFileSync(path.join(root, 'app/src/pkjs/index.js'), 'utf8');
  const used = new Set([...source.matchAll(/payload\.([A-Z_]+)/g)].map((m) => m[1]));
  for (const key of used) assert.ok(Contract.WIRE.KEYS.includes(key), key);
});

test('the watch code uses the generated constants, not slot numbers', () => {
  const main = fs.readFileSync(path.join(root, 'app/src/c/main.c'), 'utf8');
  assert.match(main, /#include "contract\.h"/);
  assert.doesNotMatch(main, /prv_command\(\d\)/);
  assert.doesNotMatch(main, /\? \d : \d\)/);
});

test('the watchapp build takes its plugin block and message keys from the contract', () => {
  execFileSync('sh', [path.join(root, 'app/sync.sh')]);
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app/package.json'), 'utf8'));
  assert.deepStrictEqual(app.pebble.messageKeys, Contract.WIRE.KEYS);
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepStrictEqual(app.pebble.plugin, rootManifest.pebble.plugin);
  const action = rootManifest.pebble.plugin.actions.find((a) => a.name === 'send_command');
  assert.deepStrictEqual(action.parameters.properties.slot.enum, Contract.SLOTS.map((slot) => slot.id));
});

const appSync = require('../app/sync.js');

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('every icon image has the size the screen table says, and every screen has all of them', () => {
  const screens = JSON.parse(fs.readFileSync(path.join(root, 'app/screens.json'), 'utf8'));
  const header = fs.readFileSync(path.join(root, 'app/src/c/contract.h'), 'utf8');
  for (const screen of screens) {
    assert.ok(header.includes('#define ICON_SIZE ' + screen.icon), screen.name);
    for (const icon of ['rocket', 'thumbs_up', 'music', 'tide']) {
      const file = path.join(root, 'app/resources/images', icon + '_' + screen.name + '.png');
      assert.deepStrictEqual(pngSize(file), [screen.icon, screen.icon], icon + ' ' + screen.name);
    }
  }
});

test('the watchapp manifest lists each screen platform and each icon resource once', () => {
  execFileSync('sh', [path.join(root, 'app/sync.sh')]);
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app/package.json'), 'utf8')).pebble;
  const screens = JSON.parse(fs.readFileSync(path.join(root, 'app/screens.json'), 'utf8'));
  assert.deepStrictEqual(app.targetPlatforms, screens.flatMap((screen) => screen.platforms));
  const permissions = app.usesPermissions.map((p) => p.name);
  assert.deepStrictEqual(permissions, ['Timeline', 'InvokeAction']);
  for (const entry of app.resources.media) {
    assert.ok(fs.existsSync(path.join(root, 'app/resources', entry.file)), entry.file);
  }
  const byPlatform = {};
  for (const entry of app.resources.media.filter((e) => e.name === 'IMAGE_ROCKET')) {
    for (const platform of entry.targetPlatforms) byPlatform[platform] = (byPlatform[platform] || 0) + 1;
  }
  assert.deepStrictEqual(Object.values(byPlatform).filter((n) => n !== 1), []);
  assert.deepStrictEqual(Object.keys(byPlatform).sort(), [...app.targetPlatforms].sort());
});

test('a freshly synced watchapp is not stale, and a stale copy is noticed', () => {
  execFileSync('sh', [path.join(root, 'app/sync.sh')]);
  assert.deepStrictEqual(appSync.stale(), []);
  const copy = path.join(root, 'app/src/plugin/index.js');
  const original = fs.readFileSync(copy, 'utf8');
  try {
    fs.writeFileSync(copy, original + '\n// stale\n');
    assert.deepStrictEqual(appSync.stale(), ['src/plugin/index.js']);
  } finally {
    fs.writeFileSync(copy, original);
  }
});

test('the relay names the bundled plugin by the watchapp uuid', () => {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'app/package.base.json'), 'utf8'));
  const relay = fs.readFileSync(path.join(root, 'app/src/pkjs/index.js'), 'utf8');
  assert.ok(relay.includes("PLUGIN_UUID = '" + base.pebble.uuid + "'"));
});

test('the manifest declares exactly the actions the plugin handles and the relay uses', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).pebble.plugin.actions.map((a) => a.name);
  const t = await start();
  for (const name of manifest) {
    const result = await t.action({ action: name, args: {} });
    assert.notStrictEqual(result.code, 'PLUGIN_UNAVAILABLE', name);
  }
  assert.strictEqual((await t.action({ action: 'not_declared', args: {} })).code, 'PLUGIN_UNAVAILABLE');
  const relay = fs.readFileSync(path.join(root, 'app/src/pkjs/index.js'), 'utf8');
  for (const [, name] of relay.matchAll(/action: '([a-z_]+)'/g)) assert.ok(manifest.includes(name), name);
});
