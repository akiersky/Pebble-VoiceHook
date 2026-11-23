// Webhook: POSTs the user's text or button commands to URLs they choose, with headers they choose.
// The whole configuration (destinations, header values) lives in secureStorage, because webhook URLs
// and headers often carry tokens. The settings page only ever sees hosts and header names back.

var CONFIG_KEY = 'webhook.config.v2';
var LEGACY_KEY = 'webhook.config.v1';
var MAX_HEADERS = 10;
var MAX_DESTINATIONS = 10;
var SLOTS = ['up_single', 'up_double', 'up_hold', 'down_single', 'down_double', 'down_hold'];
var MAX_TEXT = 8000;
var FORBIDDEN_HEADERS = ['host', 'content-length', 'connection', 'transfer-encoding', 'cookie'];

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseUrl(value) {
  var url = stringValue(value);
  var match = url.match(/^(https?):\/\/([^\/?#\s]+)([^\s]*)$/i);
  if (!match) return { error: 'Enter a full URL starting with https:// (or http://).' };
  var authority = match[2];
  if (authority.indexOf('@') !== -1) return { error: 'Put credentials in a header, not in the URL.' };
  var host = authority.replace(/:\d+$/, '').toLowerCase();
  if (!host) return { error: 'The URL has no host.' };
  return { url: url, host: host, https: match[1].toLowerCase() === 'https' };
}

function cleanHeaders(raw, previous) {
  var list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_HEADERS) return { error: 'At most ' + MAX_HEADERS + ' headers.' };
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var name = stringValue(list[i] && list[i].name);
    if (!name) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return { error: 'Header "' + name + '" is not a valid header name.' };
    var lower = name.toLowerCase();
    if (FORBIDDEN_HEADERS.indexOf(lower) !== -1) return { error: 'The ' + name + ' header can\'t be set.' };
    if (seen[lower]) return { error: 'Header "' + name + '" appears twice.' };
    seen[lower] = true;
    var value = typeof list[i].value === 'string' ? list[i].value : '';
    // A blank value on a header that already had one means "keep the saved value".
    if (!value && previous) {
      var kept = previous.filter(function (header) { return header.name.toLowerCase() === lower; })[0];
      if (kept) value = kept.value;
    }
    if (/[\r\n]/.test(value) || value.length > 2000) return { error: 'The value of ' + name + ' is not valid.' };
    out.push({ name: name, value: value });
  }
  return { headers: out };
}

function cleanDestination(raw, previous) {
  var id = stringValue(raw && raw.id);
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return { error: 'A destination has an invalid id.' };
  var name = stringValue(raw.name).slice(0, 40) || 'Webhook';
  var parsed = parseUrl(raw.url);
  if (parsed.error) return { error: name + ': ' + parsed.error };
  var headers = cleanHeaders(raw.headers, previous && previous.headers);
  if (headers.error) return { error: name + ': ' + headers.error };
  var format = raw.format === 'text' ? 'text' : 'json';
  var field = stringValue(raw.field) || 'text';
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(field)) return { error: name + ': the JSON field name can only use letters, digits, _ . and -.' };
  return { destination: { id: id, name: name, url: parsed.url, host: parsed.host, https: parsed.https, headers: headers.headers, format: format, field: field } };
}

function findDestination(config, id) {
  return config.destinations.filter(function (destination) { return destination.id === id; })[0] || null;
}

// The whole settings object from the page: { destinations, noteDestination, commands }.
function cleanConfig(message, previous) {
  var list = Array.isArray(message.destinations) ? message.destinations : [];
  if (list.length > MAX_DESTINATIONS) return { error: 'At most ' + MAX_DESTINATIONS + ' destinations.' };
  var destinations = [];
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var before = previous && findDestination(previous, stringValue(list[i] && list[i].id));
    var cleaned = cleanDestination(list[i], before);
    if (cleaned.error) return { error: cleaned.error };
    if (seen[cleaned.destination.id]) return { error: 'A destination appears twice.' };
    seen[cleaned.destination.id] = true;
    destinations.push(cleaned.destination);
  }
  var fallback = destinations.length ? destinations[0].id : '';
  var noteDestination = seen[message.noteDestination] ? message.noteDestination : fallback;
  var commands = {};
  var rawCommands = message.commands && typeof message.commands === 'object' ? message.commands : {};
  for (var j = 0; j < SLOTS.length; j++) {
    var raw = rawCommands[SLOTS[j]];
    var command = stringValue(raw && raw.command);
    if (!command) continue;
    if (command.length > 100 || /[\u0000-\u001f]/.test(command)) return { error: 'A command is too long or has invalid characters.' };
    var before = previous && previous.commands && previous.commands[SLOTS[j]];
    var extra = cleanHeaders(raw.headers, before && before.headers);
    if (extra.error) return { error: 'Button ' + SLOTS[j].replace('_', ' ') + ': ' + extra.error };
    commands[SLOTS[j]] = { command: command, destination: seen[raw.destination] ? raw.destination : fallback, headers: extra.headers };
  }
  var rawLabels = message.labels && typeof message.labels === 'object' ? message.labels : {};
  var labels = { up: stringValue(rawLabels.up), down: stringValue(rawLabels.down) };
  if (labels.up.length > 24 || labels.down.length > 24 || /[\u0000-\u001f]/.test(labels.up + labels.down)) {
    return { error: 'Button labels can be up to 24 characters.' };
  }
  return { config: { v: 2, destinations: destinations, noteDestination: noteDestination, commands: commands, labels: labels } };
}

// The request for a message or button command, as { url, options }. extraHeaders is optional.
// JSON by default: { "<field>": text, ... } for notes, { "command": name, ... } for commands.
function buildRequest(destination, kind, value, now, extraHeaders) {
  var headers = {};
  destination.headers.forEach(function (header) { headers[header.name] = header.value; });
  // A command's own headers are added to the destination's, replacing any with the same name.
  (extraHeaders || []).forEach(function (header) {
    Object.keys(headers).forEach(function (name) {
      if (name.toLowerCase() === header.name.toLowerCase()) delete headers[name];
    });
    headers[header.name] = header.value;
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
  return { url: destination.url, options: { method: 'POST', headers: headers, body: body } };
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
  var request = buildRequest(destination, kind, value, new Date(), extraHeaders);
  try {
    var response = await fetch(request.url, request.options);
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status, message: doneText || 'Sent to ' + destination.host + '.' };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, message: destination.host + ' rejected the request (' + response.status + '). Check your headers in the Webhook settings.' };
    }
    return { ok: false, status: response.status, message: destination.host + ' answered ' + response.status + '.' };
  } catch (error) {
    var name = error && error.name;
    console.error('Webhook request failed: ' + name);
    if (name === 'NotAllowedError') {
      return { ok: false, status: 0, blocked: true, message: 'Webhook isn\'t allowed to connect to ' + destination.host + '. Allow it in the plugin\'s Permissions.' };
    }
    return { ok: false, status: 0, message: 'Could not reach ' + destination.host + '. The message may not have been delivered.' };
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
      subtitle: config ? 'to ' + findDestination(config, config.noteDestination).host : 'Webhook',
      tinyIcon: 'system://images/NOTIFICATION_FLAG',
    },
    actions: [{ title: 'Send note', type: 'pluginAction', action: 'send_message', inputArg: 'text' }],
  };
  try {
    await Pebble.insertTimelinePin(pin);
    return { ok: true };
  } catch (error) {
    console.error('Pin insert failed: ' + (error && error.name) + ' ' + (error && error.message));
    return { ok: false, error: 'Could not add the pin' + (error && error.name === 'NotAllowedError' ? ': allow the Timeline permission for Webhook.' : '.') };
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

function fail(respond, result) {
  respond.error(result.status === 401 || result.status === 403 ? 'AUTH_REQUIRED' : 'UNKNOWN', result.message);
}

Pebble.registerActionHandler(async function (req, respond) {
  var args = req.args || {};
  if (req.action === 'send_message') {
    var text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) {
      respond.error('INVALID_ARGS', 'text must not be empty.');
      return;
    }
    if (text.length > MAX_TEXT) {
      respond.error('INVALID_ARGS', 'That message is too long to send (limit ' + MAX_TEXT + ' characters).');
      return;
    }
    var config = await loadConfig();
    if (!config) {
      respond.error('AUTH_REQUIRED', 'Set your webhook URL in the Webhook plugin\'s settings first.');
      return;
    }
    var result = await deliver(findDestination(config, config.noteDestination), 'text', text);
    if (result.ok) respond.ok({ text: result.message });
    else fail(respond, result);
    return;
  }
  if (req.action === 'send_command') {
    if (SLOTS.indexOf(args.slot) === -1) {
      respond.error('INVALID_ARGS', 'Unknown button.');
      return;
    }
    var current = await loadConfig();
    if (!current) {
      respond.error('AUTH_REQUIRED', 'Set your webhook URL in the Webhook plugin\'s settings first.');
      return;
    }
    var entry = current.commands[args.slot];
    if (!entry) {
      respond.error('INVALID_ARGS', 'No command set for that button.');
      return;
    }
    var sent = await deliver(findDestination(current, entry.destination), 'command', entry.command, 'Sent ' + entry.command, entry.headers);
    if (sent.ok) respond.ok({ text: sent.message });
    else fail(respond, sent);
    return;
  }
  // Used by the watchapp to show the user's own reminders next to the Up and Down buttons.
  if (req.action === 'get_labels') {
    var stored = await loadConfig();
    var labels = stored && stored.labels ? stored.labels : { up: '', down: '' };
    respond.ok({ text: JSON.stringify({ up: labels.up, down: labels.down }) });
    return;
  }
  console.error('Unsupported action: ' + req.action);
  respond.error('PLUGIN_UNAVAILABLE', 'Unsupported Webhook action.');
});

Pebble.registerConfigHandler(async function (message, respond) {
  switch (message && message.type) {
    case 'status':
      respond(summary(await loadConfig()));
      return;

    case 'save': {
      var previous = await loadConfig();
      var cleaned = cleanConfig(message, previous);
      if (cleaned.error) {
        respond({ error: cleaned.error });
        return;
      }
      await Pebble.secureStorage.setItem(CONFIG_KEY, JSON.stringify(cleaned.config));
      var state = summary(cleaned.config);
      state.insecure = cleaned.config.destinations.filter(function (destination) { return !destination.https; }).map(function (destination) { return destination.name; });
      respond(state);
      return;
    }

    // Sends a real request with the saved settings. Doubles as the first "link": the phone asks the user
    // to allow the host the first time it's used.
    case 'test': {
      var saved = await loadConfig();
      var target = saved && findDestination(saved, message.destination);
      if (!target) {
        respond({ error: 'Save your settings first.' });
        return;
      }
      var tested = await deliver(target, 'text', 'Test message from the Pebble Webhook plugin');
      tested.permission = await permissionState(target.host);
      respond(tested);
      return;
    }

    case 'pin': {
      var pinConfig = await loadConfig();
      var pinResult = await insertPin(pinConfig);
      respond(pinResult.ok ? { ok: true, message: 'Pin added. Look for "Send note" in your watch\'s timeline.' } : { error: pinResult.error });
      return;
    }

    case 'unlink':
      await Pebble.secureStorage.removeItem(CONFIG_KEY);
      respond(summary(null));
      return;

    default:
      respond({ error: 'Unknown message type.' });
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseUrl: parseUrl, cleanHeaders: cleanHeaders, cleanConfig: cleanConfig, buildRequest: buildRequest, migrate: migrate };
}
