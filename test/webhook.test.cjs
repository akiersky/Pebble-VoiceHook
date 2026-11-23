const test = require('node:test');
const assert = require('node:assert');

// The plugin registers handlers on load, so give it a stub Pebble.
global.Pebble = { registerActionHandler() {}, registerConfigHandler() {}, secureStorage: {} };
const { parseUrl, cleanHeaders, cleanConfig, buildRequest, migrate } = require('../src/plugin/index.js');

test('parseUrl accepts https and http, rejects the rest', () => {
  assert.strictEqual(parseUrl('https://Example.com:8443/a?b=c').host, 'example.com');
  assert.strictEqual(parseUrl('http://10.0.0.5/x').https, false);
  assert.ok(parseUrl('example.com/x').error);
  assert.ok(parseUrl('ftp://example.com').error);
  assert.ok(parseUrl('https://user:pw@example.com/x').error);
  assert.ok(parseUrl('').error);
});

test('cleanHeaders validates names and keeps saved values when blank', () => {
  const kept = cleanHeaders([{ name: 'Authorization', value: '' }], [{ name: 'authorization', value: 'Bearer abc' }]);
  assert.deepStrictEqual(kept.headers, [{ name: 'Authorization', value: 'Bearer abc' }]);
  assert.ok(cleanHeaders([{ name: 'Bad Name', value: 'x' }]).error);
  assert.ok(cleanHeaders([{ name: 'Host', value: 'x' }]).error);
  assert.ok(cleanHeaders([{ name: 'X-A', value: 'a' }, { name: 'x-a', value: 'b' }]).error);
  assert.ok(cleanHeaders([{ name: 'X-A', value: 'a\nb' }]).error);
  assert.deepStrictEqual(cleanHeaders([{ name: '  ', value: 'x' }]).headers, []);
});

const dest = (extra) => ({ id: 'a', name: 'Notes', url: 'https://example.com/hook', headers: [], ...extra });

test('cleanConfig defaults, destinations and commands', () => {
  const ok = cleanConfig({
    destinations: [dest({ format: 'bogus', field: '' }), dest({ id: 'b', name: 'Home', url: 'https://home.example/x' })],
    noteDestination: 'nope',
    commands: { up_single: { command: ' lights_off ', destination: 'b' }, up_double: { command: '' }, bogus: { command: 'x' }, down_hold: { command: 'x', destination: 'zzz' } },
  });
  const c = ok.config;
  assert.strictEqual(c.destinations[0].format, 'json');
  assert.strictEqual(c.destinations[0].field, 'text');
  assert.strictEqual(c.noteDestination, 'a');
  assert.deepStrictEqual(c.commands, {
    up_single: { command: 'lights_off', destination: 'b', headers: [] },
    down_hold: { command: 'x', destination: 'a', headers: [] },
  });
  assert.ok(cleanConfig({ destinations: [dest({ field: 'bad field!' })] }).error);
  assert.ok(cleanConfig({ destinations: [dest(), dest()] }).error);
  assert.ok(cleanConfig({ destinations: [dest({ url: 'nope' })] }).error);
  assert.ok(cleanConfig({ destinations: [dest({ id: 'bad id!' })] }).error);
  assert.deepStrictEqual(cleanConfig({ destinations: [] }).config.destinations, []);
  assert.deepStrictEqual(cleanConfig({ destinations: [], labels: { up: ' Lights ', down: '' } }).config.labels, { up: 'Lights', down: '' });
  assert.ok(cleanConfig({ destinations: [], labels: { up: 'x'.repeat(25) } }).error);
});

test('cleanConfig keeps a saved header value per destination', () => {
  const previous = { destinations: [dest({ headers: [{ name: 'X-Token', value: 'secret' }] })] };
  const next = cleanConfig({ destinations: [dest({ headers: [{ name: 'X-Token', value: '' }] })] }, previous);
  assert.strictEqual(next.config.destinations[0].headers[0].value, 'secret');
});

test('command headers are added to the destination headers and keep saved values', () => {
  const previous = { destinations: [dest()], commands: { up_single: { command: 'x', destination: 'a', headers: [{ name: 'X-Scene', value: 'movie' }] } } };
  const next = cleanConfig({ destinations: [dest()], commands: { up_single: { command: 'x', destination: 'a', headers: [{ name: 'x-scene', value: '' }, { name: 'X-Other', value: 'o' }] } } }, previous);
  assert.deepStrictEqual(next.config.commands.up_single.headers, [{ name: 'x-scene', value: 'movie' }, { name: 'X-Other', value: 'o' }]);
  assert.ok(cleanConfig({ destinations: [dest()], commands: { up_single: { command: 'x', headers: [{ name: 'Host', value: 'h' }] } } }).error);

  const base = { url: 'https://example.com/h', headers: [{ name: 'Authorization', value: 'a' }, { name: 'X-Scene', value: 'default' }], format: 'json', field: 'text' };
  const request = buildRequest(base, 'command', 'go', new Date(), [{ name: 'x-scene', value: 'movie' }, { name: 'X-New', value: 'n' }]);
  assert.deepStrictEqual(request.options.headers, { Authorization: 'a', 'x-scene': 'movie', 'X-New': 'n', 'Content-Type': 'application/json' });
});

test('buildRequest builds JSON, command and text bodies', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  const base = { url: 'https://example.com/h', headers: [{ name: 'X-Token', value: 't' }], format: 'json', field: 'msg' };
  const json = buildRequest(base, 'text', 'hello', now);
  assert.strictEqual(json.options.method, 'POST');
  assert.strictEqual(json.options.headers['X-Token'], 't');
  assert.strictEqual(json.options.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(json.options.body), { msg: 'hello', timestamp: '2026-11-23T10:00:00.000Z', source: 'pebble' });

  const command = buildRequest(base, 'command', 'lights_off', now);
  assert.deepStrictEqual(JSON.parse(command.options.body), { command: 'lights_off', timestamp: '2026-11-23T10:00:00.000Z', source: 'pebble' });

  const text = buildRequest({ ...base, format: 'text' }, 'text', 'hello', now);
  assert.strictEqual(text.options.body, 'hello');
  assert.strictEqual(text.options.headers['Content-Type'], 'text/plain; charset=utf-8');

  const custom = buildRequest({ ...base, headers: [{ name: 'content-type', value: 'application/x-ndjson' }] }, 'text', 'hi', now);
  assert.strictEqual(custom.options.headers['Content-Type'], undefined);
  assert.strictEqual(custom.options.headers['content-type'], 'application/x-ndjson');
});

test('migrate upgrades version 0.1 settings and passes version 2 through', () => {
  const old = { url: 'https://example.com/h', host: 'example.com', https: true, headers: [{ name: 'A', value: 'b' }], format: 'text', field: 'text' };
  const moved = migrate(old);
  assert.strictEqual(moved.destinations[0].url, old.url);
  assert.strictEqual(moved.noteDestination, moved.destinations[0].id);
  const v2 = { v: 2, destinations: [], noteDestination: '', commands: {} };
  assert.strictEqual(migrate(v2), v2);
  assert.strictEqual(migrate(null), null);
});
