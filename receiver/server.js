#!/usr/bin/env node
// VoiceHook receiver: takes the webhooks the watch sends and appends them to plain Markdown files.
//
//   POST /note     { "text": "..." }      -> <vault>/Daily/YYYY-MM-DD.md      as "- 14:32 the note"
//   POST /command  { "command": "..." }   -> <vault>/Commands/YYYY-MM-DD.md  as "- 14:32 lights_off"
//   GET  /health                          -> ok
//
// Both POSTs need "Authorization: Bearer <TOKEN>". A text/plain body works too, for webhooks set to plain text.
// The files are ordinary Markdown with no frontmatter and nothing specific to any notes app. Run it with:
//   VAULT_DIR=~/notes TOKEN=$(openssl rand -hex 24) node receiver/server.js
// Settings (environment): VAULT_DIR (must exist), TOKEN (20+ characters), PORT (8787), HOST (127.0.0.1),
// NOTES_DIR (Daily), COMMANDS_DIR (Commands). Dates and times use this computer's time zone (set TZ to change it).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BODY = 16 * 1024;
const MIN_TOKEN_LENGTH = 20;

function digest(text) { return crypto.createHash('sha256').update(text).digest(); }

function pad(n) { return String(n).padStart(2, '0'); }
function dateOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function timeOf(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

// One list item. Extra lines of a multi-line note are indented so they stay inside the item.
function listItem(d, text) {
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '');
  return '- ' + timeOf(d) + ' ' + lines.join('\n  ') + '\n';
}

function clean(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
}

// The text of a request: the named field of a JSON body, or the whole body when it is plain text.
function textOf(contentType, body, field) {
  if (/json/i.test(contentType || '')) {
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) { return { error: 'The body is not valid JSON.' }; }
    const value = parsed && typeof parsed === 'object' ? parsed[field] : undefined;
    const text = clean(value);
    if (!text) return { error: 'The JSON needs a non-empty "' + field + '" text field.' };
    const stamp = new Date(parsed.timestamp);
    return { text, at: Number.isNaN(stamp.getTime()) ? null : stamp };
  }
  const text = clean(body);
  return text ? { text, at: null } : { error: 'The body is empty.' };
}

function createReceiver(options) {
  const token = digest(options.token);
  const now = options.now || (() => new Date());
  const kinds = {
    '/note': { field: 'text', dir: options.notesDir || 'Daily' },
    '/command': { field: 'command', dir: options.commandsDir || 'Commands' },
  };
  let queue = Promise.resolve();   // writes go one at a time, so two notes never interleave

  async function append(dir, d, text) {
    const folder = path.join(options.vaultDir, dir);
    const file = path.join(folder, dateOf(d) + '.md');
    await fs.promises.mkdir(folder, { recursive: true });
    try {
      await fs.promises.writeFile(file, '# ' + dateOf(d) + '\n\n' + listItem(d, text), { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await fs.promises.appendFile(file, listItem(d, text));
    }
    return path.join(dir, dateOf(d) + '.md');
  }

  function reply(res, status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { if (size - chunk.length <= MAX_BODY) reject(Object.assign(new Error('too large'), { status: 413 })); return; }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  return http.createServer(async (req, res) => {
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (route === '/health' && req.method === 'GET') return reply(res, 200, 'ok');
      const kind = kinds[route];
      if (!kind) return reply(res, 404, { ok: false, error: 'Not found.' });
      if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'Use POST.' });
      const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (!match || !crypto.timingSafeEqual(digest(match[1]), token)) return reply(res, 401, { ok: false, error: 'Wrong or missing token.' });

      const parsed = textOf(req.headers['content-type'], await readBody(req), kind.field);
      if (parsed.error) return reply(res, 400, { ok: false, error: parsed.error });
      // The watch's own timestamp is used when it is plausible (a clock that is days off would file the note under the wrong day).
      const current = now();
      const when = parsed.at && Math.abs(parsed.at - current) < 2 * 86400000 ? parsed.at : current;
      const written = await (queue = queue.then(() => append(kind.dir, when, parsed.text), () => append(kind.dir, when, parsed.text)));
      console.log(new Date().toISOString() + ' ' + route.slice(1) + ' -> ' + written);   // never the text itself
      return reply(res, 200, { ok: true });
    } catch (error) {
      if (error.status === 413) { res.setHeader('Connection', 'close'); return reply(res, 413, { ok: false, error: 'Too large.' }); }
      console.error('Write failed: ' + (error && error.message));
      return reply(res, 500, { ok: false, error: 'Could not write the note.' });
    }
  });
}

function main() {
  const vaultDir = process.env.VAULT_DIR;
  const token = process.env.TOKEN || '';
  if (!vaultDir || !fs.existsSync(vaultDir) || !fs.statSync(vaultDir).isDirectory()) {
    console.error('Set VAULT_DIR to an existing folder, for example: VAULT_DIR=~/notes');
    process.exit(1);
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    console.error('Set TOKEN to at least ' + MIN_TOKEN_LENGTH + ' characters, for example: TOKEN=$(openssl rand -hex 24)');
    process.exit(1);
  }
  const server = createReceiver({
    vaultDir, token, notesDir: process.env.NOTES_DIR, commandsDir: process.env.COMMANDS_DIR,
  });
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log('VoiceHook receiver on http://' + host + ':' + port + ', writing to ' + vaultDir));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createReceiver };
if (require.main === module) main();
