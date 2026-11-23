const test = require('node:test');
const assert = require('node:assert');

// The plugin registers handlers on load, so give it a stub Pebble.
global.Pebble = { registerActionHandler() {}, registerConfigHandler() {}, secureStorage: {} };
const { parseUrl, cleanHeaders, cleanConfig, buildRequest } = require('../src/plugin/index.js');

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

test('cleanConfig defaults and field validation', () => {
  const ok = cleanConfig({ url: 'https://example.com/hook', headers: [], format: 'bogus', field: '' });
  assert.strictEqual(ok.config.format, 'json');
  assert.strictEqual(ok.config.field, 'text');
  assert.ok(cleanConfig({ url: 'https://example.com', headers: [], field: 'bad field!' }).error);
});

test('buildRequest builds JSON and text bodies', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  const base = { url: 'https://example.com/h', headers: [{ name: 'X-Token', value: 't' }], format: 'json', field: 'msg' };
  const json = buildRequest(base, 'hello', now);
  assert.strictEqual(json.options.method, 'POST');
  assert.strictEqual(json.options.headers['X-Token'], 't');
  assert.strictEqual(json.options.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(json.options.body), { msg: 'hello', timestamp: '2026-11-23T10:00:00.000Z', source: 'pebble' });

  const text = buildRequest({ ...base, format: 'text' }, 'hello', now);
  assert.strictEqual(text.options.body, 'hello');
  assert.strictEqual(text.options.headers['Content-Type'], 'text/plain; charset=utf-8');

  const custom = buildRequest({ ...base, headers: [{ name: 'content-type', value: 'application/x-ndjson' }] }, 'hi', now);
  assert.strictEqual(custom.options.headers['Content-Type'], undefined);
  assert.strictEqual(custom.options.headers['content-type'], 'application/x-ndjson');
});
