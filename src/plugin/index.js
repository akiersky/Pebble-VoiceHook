// Webhook Actions: POSTs the user's text or button commands to URLs they choose, with headers they choose.
// The whole configuration (destinations, header values) lives in secureStorage, because webhook URLs
// and headers often carry tokens. The settings page only ever sees hosts and header names back.

// ---- shared contract: generated from src/contract.js by `npm run contract`, do not edit ----
var Contract = {
  MESSAGES: { STATUS: 'status', SAVE: 'save', TEST: 'test', PIN: 'pin', UNLINK: 'unlink' },
  LIMITS: { HEADERS: 10, DESTINATIONS: 10, LABEL: 24, COMMAND: 100, HEADER_NAME: 100, HEADER_VALUE: 2000, URL: 2000, TEXT: 8000, NAME: 40 },
  TARGETS: { DESTINATION: 'destination', COMMAND: 'command', NOTE: 'note', LABEL: 'label' },
  FIELDS: { URL: 'url', HEADERS: 'headers', JSON_FIELD: 'field', COMMAND: 'command', DESTINATION: 'destination', UP: 'up', DOWN: 'down' },
  PARTS: { NAME: 'name', VALUE: 'value' },
  SLOTS: [
    { id: 'up_single', button: 'up', gesture: 'press', wire: 1 },
    { id: 'up_double', button: 'up', gesture: 'double press', wire: 2 },
    { id: 'up_hold', button: 'up', gesture: 'hold', wire: 3 },
    { id: 'down_single', button: 'down', gesture: 'press', wire: 4 },
    { id: 'down_double', button: 'down', gesture: 'double press', wire: 5 },
    { id: 'down_hold', button: 'down', gesture: 'hold', wire: 6 },
  ],
  WIRE: { KEYS: ['TEXT', 'SLOT', 'RESULT', 'MESSAGE', 'UP_LABEL', 'DOWN_LABEL', 'CONFIGURED'], RESULT_OK: 1, RESULT_FAIL: 0, MESSAGE_MAX: 90 },
  // The watch's buffers hold bytes, so LABEL and MESSAGE_MAX are counted in UTF-8 bytes, not characters.
  utf8Bytes: function (text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { n += 4; i++; }
      else n += 3;
    }
    return n;
  },
  // The longest start of `text` that fits in `max` bytes, never cutting a character in half.
  clipBytes: function (text, max) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      var pair = c >= 0xd800 && c <= 0xdbff && i + 1 < text.length;
      var size = c < 0x80 ? 1 : c < 0x800 ? 2 : pair ? 4 : 3;
      if (n + size > max) return text.slice(0, i);
      n += size;
      if (pair) i++;
    }
    return text;
  },
};
// ---- end shared contract ----

// What users call this plugin. app/sync.js sets it to the watchapp's name in the copy bundled with the watchapp.
var PRODUCT = 'Webhook Actions';

var CONFIG_KEY = 'webhook.config.v2';
var LEGACY_KEY = 'webhook.config.v1';
var SLOTS = Contract.SLOTS.map(function (slot) { return slot.id; });
var FORBIDDEN_HEADERS = ['host', 'content-length', 'connection', 'transfer-encoding', 'cookie'];
var RESERVED_FIELDS = ['timestamp', 'source', 'command'];
// Any installed app can call this plugin, so each sending action answers at most one request a second.
var RATE_LIMIT_MS = 1000;
var lastSent = Object.create(null);
function tooFast(action) {
  var now = Date.now();
  if (lastSent[action] !== undefined && now - lastSent[action] < RATE_LIMIT_MS) return true;
  lastSent[action] = now;
  return false;
}
var TOO_FAST = { ok: false, code: 'UNKNOWN', message: 'Too many requests. Wait a second and try again.' };

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseUrl(value) {
  var url = stringValue(value);
  if (url.length > Contract.LIMITS.URL) return { error: 'That URL is too long.' };
  // Browsers read a backslash as a slash, which would make a different host than the one shown here.
  if (url.indexOf('\\') !== -1) return { error: 'The URL can\'t contain a backslash.' };
  var match = url.match(/^(https?):\/\/([^\/?#\s]+)([^\s]*)$/i);
  if (!match) return { error: 'Enter a full URL starting with https:// (or http://).' };
  var authority = match[2];
  if (authority.indexOf('@') !== -1) return { error: 'Put credentials in a header, not in the URL.' };
  var parts = authority.match(/^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/);
  if (!parts || parts[1] === '.' || (parts[2] && parseInt(parts[2], 10) > 65535)) return { error: 'The URL\'s host isn\'t valid. Use letters, digits, dots and dashes, with an optional :port.' };
  var host = parts[1].toLowerCase();
  var https = match[1].toLowerCase() === 'https';
  var port = parts[2] ? String(parseInt(parts[2], 10)) : (https ? '443' : '80');
  return { url: url, host: host, https: https, origin: (https ? 'https' : 'http') + '://' + host + ':' + port };
}

// Where a saved destination sends: scheme, host and port. A saved secret only follows an unchanged origin.
function originOf(destination) {
  var parsed = destination && parseUrl(destination.url);
  return parsed && parsed.origin ? parsed.origin : null;
}

// A header list from the page. `previous` is the list saved before, so a blank value can mean "keep the
// saved one", unless `hostChanged`: those values were saved for another host and must not follow the URL.
function cleanHeaders(raw, previous, hostChanged) {
  var list = Array.isArray(raw) ? raw : [];
  if (list.length > Contract.LIMITS.HEADERS) return { error: 'At most ' + Contract.LIMITS.HEADERS + ' headers.' };
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var name = stringValue(list[i] && list[i].name);
    if (!name) continue;
    if (name.length > Contract.LIMITS.HEADER_NAME || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return { error: 'Header "' + name + '" is not a valid header name.', index: i, part: Contract.PARTS.NAME };
    var lower = name.toLowerCase();
    if (FORBIDDEN_HEADERS.indexOf(lower) !== -1) return { error: 'The ' + name + ' header can\'t be set.', index: i, part: Contract.PARTS.NAME };
    if (seen[lower]) return { error: 'Header "' + name + '" appears twice.', index: i, part: Contract.PARTS.NAME };
    seen[lower] = true;
    var value = typeof list[i].value === 'string' ? list[i].value : '';
    if (!value && previous) {
      var kept = previous.filter(function (header) { return header.name.toLowerCase() === lower; })[0];
      if (kept && kept.value && hostChanged) {
        return { error: 'Enter the value of ' + name + ' again. The host changed, so the saved value isn\'t sent to the new one.', index: i, part: Contract.PARTS.VALUE };
      }
      if (kept) value = kept.value;
    }
    if (/[\r\n]/.test(value) || value.length > Contract.LIMITS.HEADER_VALUE) return { error: 'The value of ' + name + ' is not valid.', index: i, part: Contract.PARTS.VALUE };
    out.push({ name: name, value: value });
  }
  return { headers: out };
}

// Errors carry a `target` saying which field is wrong, so the settings page can mark it.
function cleanDestination(raw, previous) {
  var id = stringValue(raw && raw.id);
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return { error: 'A webhook has an invalid id.' };
  var name = stringValue(raw.name).slice(0, Contract.LIMITS.NAME) || 'Webhook';
  var at = function (field, extra) { return Object.assign({ kind: Contract.TARGETS.DESTINATION, id: id, field: field }, extra); };
  var parsed = parseUrl(raw.url);
  if (parsed.error) return { error: name + ': ' + parsed.error, target: at(Contract.FIELDS.URL) };
  var hostChanged = !!previous && originOf(previous) !== parsed.origin;
  var headers = cleanHeaders(raw.headers, previous && previous.headers, hostChanged);
  if (headers.error) return { error: name + ': ' + headers.error, target: at(Contract.FIELDS.HEADERS, { index: headers.index, part: headers.part }) };
  var format = raw.format === 'text' ? 'text' : 'json';
  var field = stringValue(raw.field) || 'text';
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(field)) return { error: name + ': the JSON field name can only use letters, digits, _ . and -.', target: at(Contract.FIELDS.JSON_FIELD) };
  // timestamp and source are added to every JSON message, and a command is sent as "command", so a note can't use those names.
  if (format === 'json' && field === '__proto__') return { error: name + ': "__proto__" can\'t be used as a field name.', target: at(Contract.FIELDS.JSON_FIELD) };
  if (format === 'json' && RESERVED_FIELDS.indexOf(field) !== -1) return { error: name + ': "' + field + '" is added to every message already. Pick another field name.', target: at(Contract.FIELDS.JSON_FIELD) };
  return { destination: { id: id, name: name, url: parsed.url, host: parsed.host, https: parsed.https, headers: headers.headers, format: format, field: field } };
}

function findDestination(config, id) {
  return config.destinations.filter(function (destination) { return destination.id === id; })[0] || null;
}

// The whole settings object from the page: { destinations, noteDestination, commands, labels }.
// Returns { config } or { error, target }. A reference to a webhook that doesn't exist is an error, not repaired.
function cleanConfig(message, previous) {
  var list = Array.isArray(message.destinations) ? message.destinations : [];
  if (list.length > Contract.LIMITS.DESTINATIONS) return { error: 'At most ' + Contract.LIMITS.DESTINATIONS + ' webhooks.' };
  var destinations = [];
  var byId = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var oldDestination = previous && findDestination(previous, stringValue(list[i] && list[i].id));
    var cleaned = cleanDestination(list[i], oldDestination);
    if (cleaned.error) return { error: cleaned.error, target: cleaned.target };
    if (byId[cleaned.destination.id]) return { error: 'A webhook appears twice.' };
    byId[cleaned.destination.id] = cleaned.destination;
    destinations.push(cleaned.destination);
  }
  var fallback = destinations.length ? destinations[0].id : '';
  var noteDestination = fallback;
  if (message.noteDestination !== undefined) {
    if (!byId[message.noteDestination]) return { error: 'Choose a webhook that exists for voice notes.', target: { kind: Contract.TARGETS.NOTE, field: Contract.FIELDS.DESTINATION } };
    noteDestination = message.noteDestination;
  }
  var commands = {};
  var rawCommands = message.commands && typeof message.commands === 'object' ? message.commands : {};
  for (var j = 0; j < SLOTS.length; j++) {
    var raw = rawCommands[SLOTS[j]];
    var command = stringValue(raw && raw.command);
    if (!command) continue;
    var slotName = SLOTS[j].replace('_', ' ');
    var at = function (field, extra) { return Object.assign({ kind: Contract.TARGETS.COMMAND, slot: SLOTS[j], field: field }, extra); };
    if (command.length > Contract.LIMITS.COMMAND || /[\u0000-\u001f]/.test(command)) return { error: 'Button ' + slotName + ': the command is too long or has invalid characters.', target: at(Contract.FIELDS.COMMAND) };
    var destinationId = raw.destination === undefined ? fallback : raw.destination;
    var destination = byId[destinationId];
    if (!destination) return { error: 'Button ' + slotName + ': choose a webhook that exists.', target: at(Contract.FIELDS.DESTINATION) };
    // Saved extra header values belong to the webhook they were saved for.
    var oldCommand = previous && previous.commands && previous.commands[SLOTS[j]];
    var oldHost = oldCommand && previous && findDestination(previous, oldCommand.destination);
    var hostChanged = !!oldCommand && (!oldHost || originOf(oldHost) !== originOf(destination));
    var extra = cleanHeaders(raw.headers, oldCommand && oldCommand.headers, hostChanged);
    if (extra.error) return { error: 'Button ' + slotName + ': ' + extra.error, target: at(Contract.FIELDS.HEADERS, { index: extra.index, part: extra.part }) };
    commands[SLOTS[j]] = { command: command, destination: destinationId, headers: extra.headers };
  }
  var rawLabels = message.labels && typeof message.labels === 'object' ? message.labels : {};
  var labels = { up: stringValue(rawLabels.up), down: stringValue(rawLabels.down) };
  if (Contract.utf8Bytes(labels.up) > Contract.LIMITS.LABEL || Contract.utf8Bytes(labels.down) > Contract.LIMITS.LABEL || /[\u0000-\u001f]/.test(labels.up + labels.down)) {
    var badLabel = Contract.utf8Bytes(labels.up) > Contract.LIMITS.LABEL || /[\u0000-\u001f]/.test(labels.up) ? Contract.FIELDS.UP : Contract.FIELDS.DOWN;
    return { error: 'A button reminder can be up to ' + Contract.LIMITS.LABEL + ' letters. Accented letters and emoji take more room.', target: { kind: Contract.TARGETS.LABEL, field: badLabel } };
  }
  return { config: { v: 2, destinations: destinations, noteDestination: noteDestination, commands: commands, labels: labels } };
}

// The request for a message or button command, as { url, options }. extraHeaders is optional.
// JSON by default: { "<field>": text, ... } for notes, { "command": name, ... } for commands.
function buildRequest(destination, kind, value, now, extraHeaders) {
  var headers = {};
  destination.headers.forEach(function (header) { headers[header.name] = header.value; });
  // A command's own headers are added to the destination's. If both have the same header name, both
  // values are sent, comma-separated (the standard way to repeat a header), so nothing is dropped.
  (extraHeaders || []).forEach(function (header) {
    var existing = Object.keys(headers).filter(function (name) { return name.toLowerCase() === header.name.toLowerCase(); })[0];
    if (existing) headers[existing] = headers[existing] + ', ' + header.value;
    else headers[header.name] = header.value;
  });
  var hasType = Object.keys(headers).some(function (name) { return name.toLowerCase() === 'content-type'; });
  var body;
  if (destination.format === 'text') {
    body = value;
    if (!hasType) headers['Content-Type'] = 'text/plain; charset=utf-8';
  } else {
    var payload = {};
    payload[kind === 'command' ? 'command' : destination.field] = value;
    payload.timestamp = now.toISOString();
    payload.source = 'pebble';
    body = JSON.stringify(payload);
    if (!hasType) headers['Content-Type'] = 'application/json';
  }
  return { url: destination.url, options: { method: 'POST', headers: headers, body: body, redirect: 'error' } };
}

// Settings saved by version 0.1 had a single destination at the top level.
function migrate(stored) {
  if (stored && stored.v === 2 && Array.isArray(stored.destinations)) return stored;
  if (stored && stored.url) {
    var destination = { id: 'main', name: 'Webhook', url: stored.url, host: stored.host, https: stored.https, headers: stored.headers || [], format: stored.format || 'json', field: stored.field || 'text' };
    return { v: 2, destinations: [destination], noteDestination: 'main', commands: {}, labels: { up: '', down: '' } };
  }
  return null;
}

async function loadConfig() {
  try {
    var stored = await Pebble.secureStorage.getItem(CONFIG_KEY);
    if (!stored) stored = await Pebble.secureStorage.getItem(LEGACY_KEY);
    var config = stored ? migrate(JSON.parse(stored)) : null;
    return config && config.destinations.length ? config : null;
  } catch (e) {
    return null;
  }
}

// The version 0.1 settings are migrated on load; once the new ones are saved (or cleared) the old copy must go too.
async function removeLegacy() {
  try { await Pebble.secureStorage.removeItem(LEGACY_KEY); } catch (e) {}
}

async function permissionState(host) {
  try {
    if (typeof Pebble !== 'undefined' && Pebble.permissions && Pebble.permissions.query) {
      return await Pebble.permissions.query('Internet/' + host);
    }
  } catch (e) {}
  return 'unknown';
}

// Sends a note or command and says what happened: { ok, status, message }. Never throws.
async function deliver(destination, kind, value, doneText, extraHeaders) {
  if (!destination) return { ok: false, status: 0, message: 'That webhook was removed. Choose another in the ' + PRODUCT + ' settings.' };
  var request = buildRequest(destination, kind, value, new Date(), extraHeaders);
  console.log(PRODUCT + ' sending to ' + destination.host + ' with headers: ' + Object.keys(request.options.headers).join(', '));
  try {
    var response = await fetch(request.url, request.options);
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status, message: doneText || 'Sent to ' + destination.host + '.' };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, message: destination.host + ' rejected the request (' + response.status + '). Check your headers in the ' + PRODUCT + ' settings.' };
    }
    return { ok: false, status: response.status, message: destination.host + ' answered ' + response.status + '.' };
  } catch (error) {
    var name = error && error.name;
    console.error(PRODUCT + ' request failed: ' + name);
    if (name === 'NotAllowedError') {
      return { ok: false, status: 0, blocked: true, message: PRODUCT + ' isn\'t allowed to connect to ' + destination.host + '. Allow it in the plugin\'s Permissions.' };
    }
    return { ok: false, status: 0, message: 'Could not reach ' + destination.host + '. The message may not have been delivered. Redirects aren\'t followed, so use the final URL.' };
  }
}

// A timeline pin whose action asks the watch for a voice reply and hands it to send_message as args.text.
// Inserting the same id again updates the pin, so this doubles as "refresh".
var PIN_ID = 'webhook-send-note';

async function insertPin(config) {
  var pin = {
    id: PIN_ID,
    time: new Date().toISOString(),
    layout: {
      type: 'genericPin',
      title: 'Send note',
      subtitle: config && findDestination(config, config.noteDestination) ? 'to ' + findDestination(config, config.noteDestination).host : PRODUCT,
      tinyIcon: 'system://images/NOTIFICATION_FLAG',
    },
    actions: [{ title: 'Send note', type: 'pluginAction', action: 'send_message', inputArg: 'text' }],
  };
  try {
    await Pebble.insertTimelinePin(pin);
    return { ok: true };
  } catch (error) {
    console.error('Pin insert failed: ' + (error && error.name) + ' ' + (error && error.message));
    return { ok: false, error: 'Could not add the pin' + (error && error.name === 'NotAllowedError' ? ': allow the Timeline permission for ' + PRODUCT + '.' : '.') };
  }
}

function summarizeCommands(commands) {
  var out = {};
  Object.keys(commands).forEach(function (slot) {
    var entry = commands[slot];
    out[slot] = {
      command: entry.command,
      destination: entry.destination,
      headers: (entry.headers || []).map(function (header) { return { name: header.name, hasValue: !!header.value }; }),
    };
  });
  return out;
}

function summary(config) {
  return {
    configured: !!config,
    // Names of the webhooks that use plain http, so the page can warn each time it opens.
    insecure: config ? config.destinations.filter(function (destination) { return !destination.https; }).map(function (destination) { return destination.name; }) : [],
    // Header values never leave secure storage.
    destinations: config ? config.destinations.map(function (destination) {
      return {
        id: destination.id, name: destination.name, url: destination.url, host: destination.host,
        format: destination.format, field: destination.field,
        headers: destination.headers.map(function (header) { return { name: header.name, hasValue: !!header.value }; }),
      };
    }) : [],
    noteDestination: config ? config.noteDestination : '',
    commands: config ? summarizeCommands(config.commands) : {},
    labels: config && config.labels ? config.labels : { up: '', down: '' },
  };
}

var SETUP_FIRST = 'Set your webhook URL in the ' + PRODUCT + ' plugin\'s settings first.';

function failure(result) {
  return { ok: false, code: result.status === 401 || result.status === 403 ? 'AUTH_REQUIRED' : 'UNKNOWN', message: result.message };
}

// What an action asks for, answered as { ok: true, text } or { ok: false, code, message }. Never throws.
async function runAction(req) {
  var args = req.args || {};
  if (req.action === 'send_message') {
    var text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) return { ok: false, code: 'INVALID_ARGS', message: 'text must not be empty.' };
    if (text.length > Contract.LIMITS.TEXT) {
      return { ok: false, code: 'INVALID_ARGS', message: 'That message is too long to send (limit ' + Contract.LIMITS.TEXT + ' characters).' };
    }
    var config = await loadConfig();
    if (!config) return { ok: false, code: 'AUTH_REQUIRED', message: SETUP_FIRST };
    if (tooFast('send_message')) return TOO_FAST;
    var result = await deliver(findDestination(config, config.noteDestination), 'text', text);
    return result.ok ? { ok: true, text: result.message } : failure(result);
  }
  if (req.action === 'send_command') {
    if (SLOTS.indexOf(args.slot) === -1) return { ok: false, code: 'INVALID_ARGS', message: 'Unknown button.' };
    var current = await loadConfig();
    if (!current) return { ok: false, code: 'AUTH_REQUIRED', message: SETUP_FIRST };
    var entry = current.commands[args.slot];
    if (!entry) return { ok: false, code: 'INVALID_ARGS', message: 'No command set for that button.' };
    if (tooFast('send_command')) return TOO_FAST;
    var sent = await deliver(findDestination(current, entry.destination), 'command', entry.command, 'Sent ' + entry.command, entry.headers);
    return sent.ok ? { ok: true, text: sent.message } : failure(sent);
  }
  // Used by the watchapp to show the user's own reminders next to the Up and Down buttons.
  if (req.action === 'get_labels') {
    var stored = await loadConfig();
    var labels = stored && stored.labels ? stored.labels : { up: '', down: '' };
    return { ok: true, text: JSON.stringify({ up: labels.up, down: labels.down, configured: !!stored }) };
  }
  console.error('Unsupported action: ' + req.action);
  return { ok: false, code: 'PLUGIN_UNAVAILABLE', message: 'Unsupported ' + PRODUCT + ' action.' };
}

Pebble.registerActionHandler(async function (req, respond) {
  var result = await runAction(req);
  if (result.ok) respond.ok({ text: result.text });
  else respond.error(result.code, result.message);
});

Pebble.registerConfigHandler(async function (message, respond) {
  switch (message && message.type) {
    case Contract.MESSAGES.STATUS:
      respond(summary(await loadConfig()));
      return;

    case Contract.MESSAGES.SAVE: {
      var previous = await loadConfig();
      var cleaned = cleanConfig(message, previous);
      if (cleaned.error) {
        respond({ error: cleaned.error, target: cleaned.target });
        return;
      }
      await Pebble.secureStorage.setItem(CONFIG_KEY, JSON.stringify(cleaned.config));
      await removeLegacy();
      respond(summary(cleaned.config));
      return;
    }

    // Sends a real request with the saved settings. Doubles as the first "link": the phone asks the user
    // to allow the host the first time it's used.
    case Contract.MESSAGES.TEST: {
      var saved = await loadConfig();
      var target = saved && findDestination(saved, message.destination);
      if (!target) {
        respond({ error: 'Save your settings first.' });
        return;
      }
      var tested = await deliver(target, 'text', 'Test message from ' + PRODUCT);
      tested.permission = await permissionState(target.host);
      tested.host = target.host;
      respond(tested);
      return;
    }

    case Contract.MESSAGES.PIN: {
      var pinConfig = await loadConfig();
      var pinResult = await insertPin(pinConfig);
      respond(pinResult.ok ? { ok: true, message: 'Pin added. Look for "Send note" in your watch\'s timeline.' } : { error: pinResult.error });
      return;
    }

    case Contract.MESSAGES.UNLINK:
      await Pebble.secureStorage.removeItem(CONFIG_KEY);
      await removeLegacy();
      respond(summary(null));
      return;

    default:
      respond({ error: 'Unknown message type.' });
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAction: runAction, parseUrl: parseUrl, cleanHeaders: cleanHeaders, cleanConfig: cleanConfig, buildRequest: buildRequest, migrate: migrate, setRateLimit: function (ms) { RATE_LIMIT_MS = ms; } };
}
