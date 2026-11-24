#!/usr/bin/env node
// Copies the <inline> region of src/contract.js into the files that need their own copy of it.
// `node scripts/inline-contract.js` rewrites them, `--check` only reports files that are out of date.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = ['src/plugin/index.js', 'src/config.html'];
const BEGIN = '// ---- shared contract: generated from src/contract.js by `npm run contract`, do not edit ----';
const END = '// ---- end shared contract ----';

function region() {
  const source = fs.readFileSync(path.join(root, 'src/contract.js'), 'utf8');
  const start = source.indexOf('// <inline>');
  const end = source.indexOf('// </inline>');
  if (start === -1 || end === -1) throw new Error('src/contract.js has no <inline> region');
  return source.slice(start + '// <inline>'.length, end).trim();
}

function render(text, block) {
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from === -1 || to === -1) throw new Error('missing shared-contract markers');
  return text.slice(0, from) + BEGIN + '\n' + block + '\n' + text.slice(to);
}

// The files whose copy of the contract is not the current one.
function outOfDate() {
  const block = region();
  return FILES.filter((file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    return render(text, block) !== text;
  });
}

function update() {
  const block = region();
  for (const file of FILES) {
    const full = path.join(root, file);
    fs.writeFileSync(full, render(fs.readFileSync(full, 'utf8'), block));
  }
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
