const test = require('node:test');
const assert = require('node:assert');

// The plugin registers handlers on load, so give it a stub Pebble.
global.Pebble = { registerActionHandler() {}, registerConfigHandler() {}, secureStorage: {} };
const { parseUrl, cleanHeaders, cleanConfig, buildRequest, migrate } = require('../src/plugin/index.js');

const dest = (extra) => ({ id: 'a', name: 'Notes', url: 'https://example.com/hook', headers: [], ...extra });
const save = (message, previous) => {
  const result = cleanConfig(message, previous);
  assert.ok(result.config, result.error);
  return result.config;
};

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

test('names that exist on Object.prototype are ordinary names', () => {
  assert.deepStrictEqual(cleanHeaders([{ name: 'constructor', value: 'x' }, { name: 'toString', value: 'y' }]).headers,
    [{ name: 'constructor', value: 'x' }, { name: 'toString', value: 'y' }]);
  const config = save({ destinations: [dest({ id: 'constructor' })], noteDestination: 'constructor' });
  assert.strictEqual(config.noteDestination, 'constructor');
  const bad = cleanConfig({ destinations: [dest()], noteDestination: 'toString' });
  assert.deepStrictEqual(bad.target, { kind: 'note', field: 'destination' });
});

test('cleanConfig defaults, destinations and commands', () => {
  const c = save({
    destinations: [dest({ format: 'bogus', field: '' }), dest({ id: 'b', name: 'Home', url: 'https://home.example/x' })],
    commands: { up_single: { command: ' lights_off ', destination: 'b' }, up_double: { command: '' }, bogus: { command: 'x' }, down_hold: { command: 'x' } },
  });
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
  assert.deepStrictEqual(save({ destinations: [], labels: { up: ' Lights ', down: '' } }).labels, { up: 'Lights', down: '' });
  assert.ok(cleanConfig({ destinations: [], labels: { up: 'x'.repeat(25) } }).error);
});

test('a reference to a webhook that does not exist is an error, not repaired', () => {
  const unknownNote = cleanConfig({ destinations: [dest()], noteDestination: 'nope' });
  assert.deepStrictEqual(unknownNote.target, { kind: 'note', field: 'destination' });
  const unknownCommand = cleanConfig({ destinations: [dest()], commands: { down_hold: { command: 'x', destination: 'zzz' } } });
  assert.deepStrictEqual(unknownCommand.target, { kind: 'command', slot: 'down_hold', field: 'destination' });
});

test('an explicitly empty webhook choice is an error; a missing one means the first webhook', () => {
  const emptyNote = cleanConfig({ destinations: [dest()], noteDestination: '' });
  assert.deepStrictEqual(emptyNote.target, { kind: 'note', field: 'destination' });
  const emptyCommand = cleanConfig({ destinations: [dest()], commands: { up_hold: { command: 'x', destination: '' } } });
  assert.deepStrictEqual(emptyCommand.target, { kind: 'command', slot: 'up_hold', field: 'destination' });
  assert.strictEqual(save({ destinations: [dest()], commands: { up_hold: { command: 'x' } } }).commands.up_hold.destination, 'a');
});

test('JSON field names that collide with the added metadata are refused', () => {
  const clash = cleanConfig({ destinations: [dest({ field: 'timestamp' })] });
  assert.deepStrictEqual(clash.target, { kind: 'destination', id: 'a', field: 'field' });
  assert.ok(cleanConfig({ destinations: [dest({ field: 'source' })] }).error);
  assert.ok(cleanConfig({ destinations: [dest({ field: 'source', format: 'text' })] }).config);   // unused in plain text
});

test('a saved header value stays with the host it was saved for', () => {
  const saved = save({ destinations: [dest({ headers: [{ name: 'Authorization', value: 'Bearer SECRET' }] })] });

  const sameHost = save({ destinations: [dest({ url: 'https://example.com/other', headers: [{ name: 'Authorization', value: '' }] })] }, saved);
  assert.strictEqual(sameHost.destinations[0].headers[0].value, 'Bearer SECRET');

  const moved = cleanConfig({ destinations: [dest({ url: 'https://elsewhere.example/hook', headers: [{ name: 'Authorization', value: '' }] })] }, saved);
  assert.deepStrictEqual(moved.target, { kind: 'destination', id: 'a', field: 'headers', index: 0, part: 'value' });

  const retyped = save({ destinations: [dest({ url: 'https://elsewhere.example/hook', headers: [{ name: 'Authorization', value: 'Bearer NEW' }] })] }, saved);
  assert.strictEqual(retyped.destinations[0].headers[0].value, 'Bearer NEW');
});

test('a command keeps its saved header values only while it points at the same host', () => {
  const two = [dest({ id: 'a' }), dest({ id: 'b', url: 'https://other.example/x' }), dest({ id: 'c', url: 'https://example.com/second' })];
  const saved = save({ destinations: two, commands: { up_single: { command: 'go', destination: 'a', headers: [{ name: 'X-Scene', value: 'movie' }] } } });
  const blank = (destination) => ({ destinations: two, commands: { up_single: { command: 'go', destination, headers: [{ name: 'x-scene', value: '' }] } } });

  assert.strictEqual(save(blank('a'), saved).commands.up_single.headers[0].value, 'movie');
  assert.strictEqual(save(blank('c'), saved).commands.up_single.headers[0].value, 'movie');   // same host
  const moved = cleanConfig(blank('b'), saved);
  assert.deepStrictEqual(moved.target, { kind: 'command', slot: 'up_single', field: 'headers', index: 0, part: 'value' });
  assert.ok(cleanConfig({ destinations: [dest()], commands: { up_single: { command: 'x', headers: [{ name: 'Host', value: 'h' }] } } }).error);
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

test('command headers are added to the destination headers', () => {
  const base = { url: 'https://example.com/h', headers: [{ name: 'Authorization', value: 'a' }, { name: 'X-Scene', value: 'default' }], format: 'json', field: 'text' };
  const request = buildRequest(base, 'command', 'go', new Date(), [{ name: 'x-scene', value: 'movie' }, { name: 'X-New', value: 'n' }]);
  assert.deepStrictEqual(request.options.headers, { Authorization: 'a', 'X-Scene': 'default, movie', 'X-New': 'n', 'Content-Type': 'application/json' });
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
