const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createReceiver } = require('../receiver/server.js');

const TOKEN = 'a-test-token-of-enough-length';

async function start(options) {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receiver-'));
  const server = createReceiver({ vaultDir, token: TOKEN, now: () => new Date(2026, 10, 26, 14, 32, 5), ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body, headers) => fetch(base + route, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { vaultDir, post, base, stop: () => { server.close(); server.closeAllConnections(); }, read: (file) => fs.readFileSync(path.join(vaultDir, file), 'utf8') };
}

test('a note starts the day\'s file with a heading and appends one list item per note', async () => {
  const t = await start();
  assert.strictEqual((await t.post('/note', { text: 'buy milk' })).status, 200);
  assert.strictEqual((await t.post('/note', { text: 'call the dentist' })).status, 200);
  assert.strictEqual(t.read('Daily/2026-11-26.md'), '# 2026-11-26\n\n- 14:32 buy milk\n- 14:32 call the dentist\n');
  t.stop();
});

test('the watch\'s timestamp sets the time and the day, in this computer\'s time zone', async () => {
  const t = await start();
  const stamp = new Date(2026, 10, 26, 9, 5).toISOString();
  await t.post('/note', { text: 'early', timestamp: stamp, source: 'pebble' });
  assert.match(t.read('Daily/2026-11-26.md'), /- 09:05 early/);
  // a clock that is days off is ignored
  await t.post('/note', { text: 'odd clock', timestamp: '2020-01-01T00:00:00Z' });
  assert.match(t.read('Daily/2026-11-26.md'), /- 14:32 odd clock/);
  t.stop();
});

test('a plain text body is a note, and a multi-line note stays inside its list item', async () => {
  const t = await start();
  await t.post('/note', 'first line\r\nsecond line\n\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  assert.strictEqual(t.read('Daily/2026-11-26.md'), '# 2026-11-26\n\n- 14:32 first line\n  second line\n');
  t.stop();
});

test('commands go to their own folder', async () => {
  const t = await start();
  assert.strictEqual((await t.post('/command', { command: 'lights_off' })).status, 200);
  assert.strictEqual(t.read('Commands/2026-11-26.md'), '# 2026-11-26\n\n- 14:32 lights_off\n');
  assert.ok(!fs.existsSync(path.join(t.vaultDir, 'Daily')));
  t.stop();
});

test('the token is required, and nothing is written without it', async () => {
  const t = await start();
  assert.strictEqual((await t.post('/note', { text: 'x' }, { Authorization: 'Bearer wrong' })).status, 401);
  assert.strictEqual((await t.post('/note', { text: 'x' }, { Authorization: '' })).status, 401);
  assert.strictEqual((await fetch(t.base + '/note', { method: 'POST', body: '{"text":"x"}' })).status, 401);
  assert.deepStrictEqual(fs.readdirSync(t.vaultDir), []);
  t.stop();
});

test('bad requests are refused with a reason', async () => {
  const t = await start();
  assert.strictEqual((await t.post('/note', '{not json')).status, 400);
  assert.strictEqual((await t.post('/note', { text: '   ' })).status, 400);
  assert.strictEqual((await t.post('/note', { command: 'x' })).status, 400);
  assert.strictEqual((await t.post('/command', { text: 'x' })).status, 400);
  assert.strictEqual((await t.post('/note', { text: 'x'.repeat(20000) })).status, 413);
  assert.strictEqual((await t.post('/elsewhere', { text: 'x' })).status, 404);
  assert.strictEqual((await fetch(t.base + '/note')).status, 405);
  assert.deepStrictEqual(fs.readdirSync(t.vaultDir), []);
  t.stop();
});

test('health answers without a token, and notes sent together are all kept', async () => {
  const t = await start();
  assert.strictEqual(await (await fetch(t.base + '/health')).text(), 'ok');
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => t.post('/note', { text: 'note ' + i })));
  assert.ok(results.every((r) => r.status === 200));
  const lines = t.read('Daily/2026-11-26.md').split('\n').filter((l) => l.startsWith('- '));
  assert.strictEqual(lines.length, 20);
  assert.strictEqual(t.read('Daily/2026-11-26.md').match(/^# /gm).length, 1);
  t.stop();
});

test('control characters are dropped from a note', async () => {
  const t = await start();
  await t.post('/note', { text: 'a\u0007b\u0000c' });
  assert.match(t.read('Daily/2026-11-26.md'), /- 14:32 abc\n$/);
  t.stop();
});
