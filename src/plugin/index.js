// Webhook: POSTs the user's text to a URL they choose, with headers they choose.
// The whole configuration (URL, header values) lives in secureStorage, because webhook URLs and
// headers often carry tokens. The settings page only ever sees the host and header names back.

var CONFIG_KEY = 'webhook.config.v1';
var MAX_HEADERS = 10;
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

function cleanConfig(message, previous) {
  var parsed = parseUrl(message.url);
  if (parsed.error) return { error: parsed.error };
  var headers = cleanHeaders(message.headers, previous && previous.headers);
  if (headers.error) return { error: headers.error };
  var format = message.format === 'text' ? 'text' : 'json';
  var field = stringValue(message.field) || 'text';
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(field)) return { error: 'The JSON field name can only use letters, digits, _ . and -.' };
  return { config: { url: parsed.url, host: parsed.host, https: parsed.https, headers: headers.headers, format: format, field: field } };
}

// The request for a message, as { url, options }. JSON by default: { "<field>": text, "timestamp", "source" }.
function buildRequest(config, text, now) {
  var headers = {};
  config.headers.forEach(function (header) { headers[header.name] = header.value; });
  var hasType = Object.keys(headers).some(function (name) { return name.toLowerCase() === 'content-type'; });
  var body;
  if (config.format === 'text') {
    body = text;
    if (!hasType) headers['Content-Type'] = 'text/plain; charset=utf-8';
  } else {
    var payload = {};
    payload[config.field] = text;
    payload.timestamp = now.toISOString();
    payload.source = 'pebble';
    body = JSON.stringify(payload);
    if (!hasType) headers['Content-Type'] = 'application/json';
  }
  return { url: config.url, options: { method: 'POST', headers: headers, body: body } };
}

async function loadConfig() {
  try {
    var stored = await Pebble.secureStorage.getItem(CONFIG_KEY);
    var config = stored ? JSON.parse(stored) : null;
    return config && config.url ? config : null;
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

// Sends text and says what happened: { ok, status, message }. Never throws.
async function deliver(config, text) {
  var request = buildRequest(config, text, new Date());
  try {
    var response = await fetch(request.url, request.options);
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status, message: 'Sent to ' + config.host + '.' };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, message: config.host + ' rejected the request (' + response.status + '). Check your headers in the Webhook settings.' };
    }
    return { ok: false, status: response.status, message: config.host + ' answered ' + response.status + '.' };
  } catch (error) {
    var name = error && error.name;
    console.error('Webhook request failed: ' + name);
    if (name === 'NotAllowedError') {
      return { ok: false, status: 0, blocked: true, message: 'Webhook isn\'t allowed to connect to ' + config.host + '. Allow it in the plugin\'s Permissions.' };
    }
    return { ok: false, status: 0, message: 'Could not reach ' + config.host + '. The message may not have been delivered.' };
  }
}

function summary(config) {
  return {
    configured: !!config,
    url: config ? config.url : '',
    host: config ? config.host : '',
    format: config ? config.format : 'json',
    field: config ? config.field : 'text',
    // Header values never leave secure storage.
    headers: config ? config.headers.map(function (header) { return { name: header.name, hasValue: !!header.value }; }) : [],
  };
}

Pebble.registerActionHandler(async function (req, respond) {
  if (req.action !== 'send_message') {
    console.error('Unsupported action: ' + req.action);
    respond.error('PLUGIN_UNAVAILABLE', 'Unsupported Webhook action.');
    return;
  }
  var args = req.args || {};
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
  var result = await deliver(config, text);
  if (result.ok) respond.ok({ text: result.message });
  else respond.error(result.status === 401 || result.status === 403 ? 'AUTH_REQUIRED' : 'UNKNOWN', result.message);
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
      state.permission = await permissionState(cleaned.config.host);
      state.insecure = !cleaned.config.https;
      respond(state);
      return;
    }

    // Sends a real request with the saved settings. Doubles as the first "link": the phone asks the user
    // to allow the host the first time it's used.
    case 'test': {
      var config = await loadConfig();
      if (!config) {
        respond({ error: 'Save your settings first.' });
        return;
      }
      var result = await deliver(config, 'Test message from the Pebble Webhook plugin');
      result.permission = await permissionState(config.host);
      respond(result);
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
  module.exports = { parseUrl: parseUrl, cleanHeaders: cleanHeaders, cleanConfig: cleanConfig, buildRequest: buildRequest };
}
