const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./harness.cjs');

async function fillBasic(t, url) {
  const card = t.document.querySelector('#destinations details');
  t.type(card.querySelector('input[type=url]'), url);
  return card;
}

test('a good save sends every default header and the command extras', async () => {
  const t = await start();
  const card = await fillBasic(t, 'https://x.test/h');
  const rows = card.querySelectorAll('.header-row');
  t.type(rows[0].children[0], 'Authorization');
  t.type(rows[0].children[1], 'Bearer t');
  [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Add header')).click();
  const rows2 = card.querySelectorAll('.header-row');
  t.type(rows2[1].children[0], 'X-Default');
  t.type(rows2[1].children[1], 'd');
  const command = t.document.querySelector('#commandsUp .command');
  t.type(command.querySelector('input[placeholder="e.g. lights_off"]'), 'go');
  [...command.querySelectorAll('button')].find((b) => b.textContent.includes('Add header')).click();
  const extra = command.querySelector('.header-row');
  t.type(extra.children[0], 'X-Extra');
  t.type(extra.children[1], 'e');
  await t.click(t.document.querySelector('#save'));
  const result = await t.action({ action: 'send_command', args: { slot: 'up_single' } });
  assert.ok(result.ok);
  assert.deepStrictEqual(Object.keys(t.fetches[0].options.headers), ['Authorization', 'X-Default', 'X-Extra', 'Content-Type']);
  await t.action({ action: 'send_message', args: { text: 'hi' } });
  assert.deepStrictEqual(Object.keys(t.fetches[1].options.headers), ['Authorization', 'X-Default', 'Content-Type']);
});

test('an invalid URL marks the field, describes the error, and clears when edited', async () => {
  const t = await start();
  const card = await fillBasic(t, 'not a url');
  await t.click(t.document.querySelector('#save'));
  const input = card.querySelector('input[type=url]');
  assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
  assert.ok(input.classList.contains('invalid'));
  const note = t.document.getElementById(input.getAttribute('aria-describedby'));
  assert.ok(note && /full URL/.test(note.textContent));
  assert.strictEqual(note.getAttribute('role'), 'alert');
  assert.strictEqual(t.document.activeElement, input);
  t.type(input, 'https://x.test/h');
  assert.strictEqual(input.getAttribute('aria-invalid'), null);
  assert.strictEqual(t.document.getElementById(note.id), null);
});

test('a forbidden header marks that header row, in a destination and in a command', async () => {
  const t = await start();
  const card = await fillBasic(t, 'https://x.test/h');
  t.type(card.querySelector('.header-row').children[0], 'Host');
  t.type(card.querySelector('.header-row').children[1], 'x');
  await t.click(t.document.querySelector('#save'));
  const nameInput = card.querySelector('.header-row').children[0];
  assert.strictEqual(nameInput.getAttribute('aria-invalid'), 'true');
  assert.ok(card.open);

  t.type(nameInput, '');
  t.type(card.querySelector('.header-row').children[1], '');
  const command = t.document.querySelector('#commandsDown .command');
  t.type(command.querySelector('input[placeholder="e.g. lights_off"]'), 'go');
  [...command.querySelectorAll('button')].find((b) => b.textContent.includes('Add header')).click();
  t.type(command.querySelector('.header-row').children[0], 'bad name');
  await t.click(t.document.querySelector('#save'));
  const bad = command.querySelector('.header-row').children[0];
  assert.strictEqual(bad.getAttribute('aria-invalid'), 'true');
  assert.ok(command.querySelector('details').open);
});

test('a too-long reminder marks its field', async () => {
  const t = await start();
  await fillBasic(t, 'https://x.test/h');
  const label = t.document.getElementById('labelDown');
  t.type(label, 'x'.repeat(30));
  await t.click(t.document.querySelector('#save'));
  assert.strictEqual(label.getAttribute('aria-invalid'), 'true');
});

test('labels are linked to their inputs', async () => {
  const t = await start();
  const unlabeled = [...t.document.querySelectorAll('input, select')].filter((input) => {
    if (input.type === 'password' || input.closest('.header-row')) return false;   // header rows use placeholders
    const labelled = input.id && t.document.querySelector('label[for="' + input.id + '"]');
    return !labelled;
  });
  assert.deepStrictEqual(unlabeled.map((i) => i.outerHTML.slice(0, 60)), []);
});

const Contract = require('../src/contract.js');

test('a reserved JSON field name and an over-long command mark their fields', async () => {
  const t = await start();
  const card = await fillBasic(t, 'https://x.test/h');
  const jsonField = card.fields.field;
  t.type(jsonField, 'timestamp');
  await t.click(t.document.querySelector('#save'));
  assert.strictEqual(jsonField.getAttribute('aria-invalid'), 'true');

  t.type(jsonField, 'text');
  const command = t.document.querySelector('#commandsUp .command').querySelector('input[placeholder="e.g. lights_off"]');
  t.type(command, 'x'.repeat(Contract.LIMITS.COMMAND + 1));
  await t.click(t.document.querySelector('#save'));
  assert.strictEqual(command.getAttribute('aria-invalid'), 'true');
});

test('the page can mark the note and command webhook selects', async () => {
  const t = await start();
  t.window.applyError({ error: 'Choose a webhook that exists for voice notes.', target: { kind: Contract.TARGETS.NOTE, field: Contract.FIELDS.DESTINATION } });
  assert.strictEqual(t.document.getElementById('noteDestination').getAttribute('aria-invalid'), 'true');
  t.window.applyError({ error: 'Button up single: choose a webhook that exists.', target: { kind: Contract.TARGETS.COMMAND, slot: 'up_single', field: Contract.FIELDS.DESTINATION } });
  assert.strictEqual(t.document.querySelector('#commandsUp .command select').getAttribute('aria-invalid'), 'true');
});

test('the Add header buttons stop at the limit', async () => {
  const t = await start();
  const card = await fillBasic(t, 'https://x.test/h');
  const add = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Add header'));
  for (let i = 0; i < Contract.LIMITS.HEADERS + 3; i++) add.click();
  assert.strictEqual(card.fields.headers.children.length, Contract.LIMITS.HEADERS);
  assert.match(t.document.querySelector('#status').textContent, /up to 10 headers/);
});

test('a blocked test send names the host, and a good one says it is set up', async () => {
  const blocked = await start({ fetchError: 'NotAllowedError', permission: 'denied' });
  await fillBasic(blocked, 'https://blocked.test/h');
  const testButton = [...blocked.document.querySelectorAll('#destinations button')].find((b) => b.textContent.includes('send test'));
  await blocked.click(testButton);
  assert.match(blocked.document.querySelector('#status').textContent, /blocked from blocked\.test/);

  const good = await start();
  await fillBasic(good, 'https://good.test/h');
  await good.click([...good.document.querySelectorAll('#destinations button')].find((b) => b.textContent.includes('send test')));
  assert.match(good.document.querySelector('#status').textContent, /set up/);
  assert.strictEqual(good.fetches.length, 1);
});

test('the http warning is still there when the page is reopened', async () => {
  const store = {};
  const first = await start({ store });
  await fillBasic(first, 'http://plain.test/h');
  await first.click(first.document.querySelector('#save'));
  assert.ok(!first.document.getElementById('warning').hidden);

  const reopened = await start({ store });
  const warning = reopened.document.getElementById('warning');
  assert.ok(!warning.hidden);
  assert.match(warning.textContent, /without encryption/);
});

test('the timeline pin button adds the pin, and Clear settings empties the page', async () => {
  const t = await start();
  await fillBasic(t, 'https://x.test/h');
  await t.click(t.document.querySelector('#save'));
  await t.click(t.document.querySelector('#pin'));
  assert.strictEqual(t.pins.length, 1);
  assert.match(t.document.querySelector('#status').textContent, /Pin added/);

  await t.click(t.document.querySelector('#unlink'));
  await t.click(t.document.querySelector('#unlink'));   // the first tap only asks for confirmation
  assert.match(t.document.querySelector('#status').textContent, /cleared/);
  assert.strictEqual(t.document.querySelector('#destinations input[type=url]').value, '');
  assert.strictEqual(Object.keys(t.store).length, 0);
});

const addWebhook = async (t, name, url) => {
  await t.click(t.document.querySelector('#addDestination'));
  const cards = t.document.querySelectorAll('#destinations details');
  const card = cards[cards.length - 1];
  t.type(card.fields.name, name);
  t.type(card.fields.url, url);
  return card;
};
const choose = (t, select, value) => { select.value = value; select.dispatchEvent(new t.window.Event('change', { bubbles: true })); };
const removeButton = (card) => [...card.querySelectorAll('button')].find((b) => /remove/i.test(b.textContent));

test('removing a webhook does not quietly move its buttons to another one', async () => {
  const t = await start();
  const one = await fillBasic(t, 'https://one.test/h');
  t.type(one.fields.name, 'One');
  const two = await addWebhook(t, 'Two', 'https://two.test/h');
  const command = t.document.querySelector('#commandsUp .command');
  t.type(command.input, 'lights_off');
  choose(t, command.destination, two.dataset.id);
  choose(t, t.document.getElementById('noteDestination'), two.dataset.id);

  await t.click(removeButton(two));
  assert.ok(t.document.contains(two), 'the first tap only asks');
  await t.click(removeButton(two));
  assert.ok(!t.document.contains(two));

  for (const select of [command.destination, t.document.getElementById('noteDestination')]) {
    assert.strictEqual(select.value, '');
    assert.strictEqual(select.options[select.selectedIndex].text, 'Choose a webhook…');
    assert.strictEqual(select.getAttribute('aria-invalid'), 'true');
  }
  assert.ok(command.open);
  assert.match(command.querySelector('summary').textContent, /choose a webhook/);

  const before = t.sent.length;
  await t.click(t.document.querySelector('#save'));
  assert.strictEqual(t.sent.length, before, 'nothing is saved while a choice is missing');
  assert.match(t.document.querySelector('#status').textContent, /Choose a webhook/);

  choose(t, command.destination, one.dataset.id);
  choose(t, t.document.getElementById('noteDestination'), one.dataset.id);
  await t.click(t.document.querySelector('#save'));
  assert.strictEqual(t.sent.length, before + 1);
  assert.strictEqual(t.document.querySelector('#status').textContent, 'Saved.');
  t.window.close();
});

test('Remove and Clear all settings take two taps', async () => {
  const t = await start();
  await fillBasic(t, 'https://x.test/h');
  await t.click(t.document.querySelector('#save'));
  const card = t.document.querySelector('#destinations details');   // saving rebuilds the cards
  const remove = removeButton(card);
  await t.click(remove);
  assert.ok(t.document.contains(card));
  assert.strictEqual(remove.textContent, 'Tap again to remove');
  assert.ok(remove.hasAttribute('data-confirming'));

  const unlink = t.document.querySelector('#unlink');
  await t.click(unlink);
  assert.strictEqual(unlink.textContent, 'Tap again to clear everything');
  assert.ok(Object.keys(t.store).length > 0, 'nothing is cleared by the first tap');
  await t.click(unlink);
  assert.strictEqual(Object.keys(t.store).length, 0);
  assert.strictEqual(unlink.textContent, 'Clear all settings');
  t.window.close();
});

test('the page says when there are unsaved changes, and warns before leaving', async () => {
  const t = await start();
  const dirty = t.document.getElementById('dirty');
  assert.strictEqual(dirty.textContent, '');
  await fillBasic(t, 'https://x.test/h');
  assert.strictEqual(dirty.textContent, 'Unsaved changes');
  const leave = new t.window.Event('beforeunload', { cancelable: true });
  t.window.dispatchEvent(leave);
  assert.ok(leave.defaultPrevented);

  await t.click(t.document.querySelector('#save'));
  assert.strictEqual(dirty.textContent, '');
  const quiet = new t.window.Event('beforeunload', { cancelable: true });
  t.window.dispatchEvent(quiet);
  assert.ok(!quiet.defaultPrevented);

  const rebuilt = t.document.querySelector('#destinations details');   // saving rebuilds the cards
  [...rebuilt.querySelectorAll('button')].find((b) => b.textContent.includes('Add header')).click();
  assert.strictEqual(dirty.textContent, 'Unsaved changes');
  assert.ok(t.document.querySelector('.savebar #save'), 'Save sits in the sticky bar');
});

test('the page calls them webhooks everywhere the user can read', async () => {
  const t = await start();
  assert.doesNotMatch(t.document.querySelector('main').textContent, /destination/i);
  assert.ok([...t.document.querySelectorAll('h2')].some((h) => h.textContent === 'Webhooks'));
  assert.ok(t.document.querySelector('#addDestination').textContent.includes('Add webhook'));
  assert.strictEqual(t.document.querySelector('#destinations summary span').textContent, 'Webhook');
});

test('each button command is one collapsed row that says what it does', async () => {
  const t = await start();
  await fillBasic(t, 'https://x.test/h');
  t.type(t.document.querySelector('#destinations details').fields.name, 'Home');
  const rows = [...t.document.querySelectorAll('.command')];
  assert.strictEqual(rows.length, 6);
  assert.ok(rows.every((row) => !row.open));
  assert.strictEqual(rows[0].querySelector('summary').textContent, 'Presswhatnot'.slice(0, 5) + 'not set');
  t.type(rows[0].input, 'lights_off');
  assert.strictEqual(rows[0].querySelector('summary').textContent, 'Presslights_off → Home');
  assert.strictEqual(t.document.getElementById('labelUp').placeholder, 'lights_off');
  t.type(rows[1].input, 'fan');
  assert.strictEqual(t.document.getElementById('labelUp').placeholder, 'lights_off · fan');
});

test('the page shows what fits the product it is part of', async () => {
  const plugin = await start();
  assert.ok(plugin.document.getElementById('reminderUp').hidden);
  assert.ok(!plugin.document.getElementById('pinSection').hidden);

  const watchapp = await start({ watchapp: true });
  assert.ok(!watchapp.document.getElementById('reminderUp').hidden);
  assert.ok(watchapp.document.getElementById('pinSection').hidden);
});

test('first-run steps show until something is saved', async () => {
  const store = {};
  const first = await start({ store });
  assert.ok(!first.document.getElementById('firstRun').hidden);
  await fillBasic(first, 'https://x.test/h');
  await first.click(first.document.querySelector('#save'));
  assert.ok(first.document.getElementById('firstRun').hidden);
  const reopened = await start({ store });
  assert.ok(reopened.document.getElementById('firstRun').hidden);
});

test('small controls are at least 44px tall', () => {
  const fs = require('fs');
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'config.html'), 'utf8');
  assert.match(html, /\.command details > summary \{[^}]*min-height: 44px/);
});

test('page accessibility basics: language, a live status region, labelled header group', async () => {
  const t = await start();
  assert.strictEqual(t.document.documentElement.getAttribute('lang'), 'en');
  const status = t.document.querySelector('#status');
  assert.strictEqual(status.getAttribute('role'), 'status');
  assert.ok(!status.classList.contains('show'), 'present in the page but not displayed until it has a message');
  const group = t.document.querySelector('#destinations [role=group]');
  assert.ok(t.document.getElementById(group.getAttribute('aria-labelledby')).textContent === 'Headers');
});

test('choosing + New webhook adds a card; moving on without typing removes it again', async () => {
  const t = await start();
  const select = t.document.querySelector('#noteDestination');
  const before = t.document.querySelectorAll('#destinations > details').length;
  select.value = '__new__';
  select.dispatchEvent(new t.window.Event('change', { bubbles: true }));
  assert.strictEqual(t.document.querySelectorAll('#destinations > details').length, before + 1);
  select.value = select.options[0].value;
  select.dispatchEvent(new t.window.Event('change', { bubbles: true }));
  assert.strictEqual(t.document.querySelectorAll('#destinations > details').length, before);
});

test('settings saved by version 0.1 are migrated, and saving or clearing removes the old copy', async () => {
  const old = JSON.stringify({ url: 'https://old.test/h', host: 'old.test', https: true, headers: [{ name: 'A', value: 'old-secret' }], format: 'json', field: 'text' });
  const t = await start({ store: { 'webhook.config.v1': old } });
  assert.strictEqual(t.document.querySelector('#destinations input[type=url]').value, 'https://old.test/h');
  await t.click(t.document.querySelector('#save'));
  assert.ok(!('webhook.config.v1' in t.store), 'saved: the old copy is gone');

  const u = await start({ store: { 'webhook.config.v1': old } });
  await u.click(u.document.querySelector('#unlink'));
  await u.click(u.document.querySelector('#unlink'));
  assert.strictEqual(Object.keys(u.store).length, 0, 'cleared: nothing left, including the old secret');
});
