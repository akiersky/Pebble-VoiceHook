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
