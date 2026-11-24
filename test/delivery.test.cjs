const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./harness.cjs');

const destination = (extra) => ({ id: 'a', name: 'Notes', url: 'https://x.test/h', headers: [], ...extra });
const settings = (extra) => ({
  type: 'save',
  destinations: [destination()],
  noteDestination: 'a',
  commands: { up_single: { command: 'lights_off', destination: 'a', headers: [] } },
  labels: { up: 'Lights', down: '' },
  ...extra,
});

async function configured(options) {
  const t = await start(options);
  const saved = await t.window.Pebble.sendMessage('plugin', settings());
  assert.ok(!saved.error, saved.error);
  return t;
}

test('a note and a command that the receiver accepts', async () => {
  const t = await configured();
  assert.deepStrictEqual(await t.action({ action: 'send_message', args: { text: ' buy milk ' } }), { ok: true, text: 'Sent to x.test.' });
  assert.deepStrictEqual(JSON.parse(t.fetches[0].options.body).text, 'buy milk');
  assert.deepStrictEqual(await t.action({ action: 'send_command', args: { slot: 'up_single' } }), { ok: true, text: 'Sent lights_off' });
  assert.strictEqual(JSON.parse(t.fetches[1].options.body).command, 'lights_off');
});

test('the receiver says no: 401, 403 and other statuses map to the right error', async () => {
  for (const status of [401, 403]) {
    const t = await configured({ status });
    const result = await t.action({ action: 'send_message', args: { text: 'hi' } });
    assert.strictEqual(result.code, 'AUTH_REQUIRED');
    assert.match(result.message, new RegExp('rejected the request \\(' + status + '\\)'));
  }
  const t = await configured({ status: 500 });
  const result = await t.action({ action: 'send_command', args: { slot: 'up_single' } });
  assert.strictEqual(result.code, 'UNKNOWN');
  assert.match(result.message, /x\.test answered 500/);
});

test('the phone refuses or cannot reach the host', async () => {
  const blocked = await configured({ fetchError: 'NotAllowedError' });
  assert.match((await blocked.action({ action: 'send_message', args: { text: 'hi' } })).message, /isn't allowed to connect to x\.test/);
  const offline = await configured({ fetchError: 'TypeError' });
  const result = await offline.action({ action: 'send_message', args: { text: 'hi' } });
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Could not reach x\.test/);
});

test('bad requests are answered, not thrown', async () => {
  const t = await configured();
  assert.strictEqual((await t.action({ action: 'send_message', args: { text: '   ' } })).code, 'INVALID_ARGS');
  assert.strictEqual((await t.action({ action: 'send_message', args: { text: 'x'.repeat(8001) } })).code, 'INVALID_ARGS');
  assert.strictEqual((await t.action({ action: 'send_command', args: { slot: 'nope' } })).code, 'INVALID_ARGS');
  assert.match((await t.action({ action: 'send_command', args: { slot: 'down_hold' } })).message, /No command set/);
  assert.strictEqual((await t.action({ action: 'launch_rockets', args: {} })).code, 'PLUGIN_UNAVAILABLE');
  assert.strictEqual(t.fetches.length, 0);
});

test('before anything is set up, actions say to open the settings', async () => {
  const t = await start();
  const result = await t.action({ action: 'send_message', args: { text: 'hi' } });
  assert.strictEqual(result.code, 'AUTH_REQUIRED');
  assert.match(result.message, /settings first/);
  assert.strictEqual((await t.action({ action: 'send_command', args: { slot: 'up_single' } })).code, 'AUTH_REQUIRED');
});

test('settings that point at a removed webhook give an error instead of throwing', async () => {
  const store = {
    'webhook.config.v2': JSON.stringify({
      v: 2, destinations: [{ id: 'a', name: 'Notes', url: 'https://x.test/h', host: 'x.test', https: true, headers: [], format: 'json', field: 'text' }],
      noteDestination: 'gone', commands: { up_single: { command: 'x', destination: 'gone', headers: [] } }, labels: { up: '', down: '' },
    }),
  };
  const t = await start({ store });
  assert.match((await t.action({ action: 'send_message', args: { text: 'hi' } })).message, /removed/);
  assert.match((await t.action({ action: 'send_command', args: { slot: 'up_single' } })).message, /removed/);
  assert.strictEqual((await t.window.Pebble.sendMessage('plugin', { type: 'pin' })).ok, true);   // the pin still works
  assert.strictEqual(t.fetches.length, 0);
});

test('the watch can ask for the button reminders', async () => {
  const t = await configured();
  const result = await t.action({ action: 'get_labels', args: {} });
  assert.deepStrictEqual(JSON.parse(result.text), { up: 'Lights', down: '', configured: true });
  const empty = await start();
  assert.deepStrictEqual(JSON.parse((await empty.action({ action: 'get_labels', args: {} })).text), { up: '', down: '', configured: false });
});
