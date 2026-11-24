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
