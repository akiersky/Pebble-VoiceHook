// Relays the watchapp's requests to the Webhook plugin bundled in this same pbw.
// A bundled plugin shares the pbw's uuid, so this must match "uuid" in package.base.json.
var PLUGIN_UUID = 'c0756590-bd59-464d-82f3-acd4499077d4';
// ---- shared contract: generated from src/contract.js by `npm run contract`, do not edit ----
var Contract = {
  MESSAGES: { STATUS: 'status', SAVE: 'save', TEST: 'test', PIN: 'pin', UNLINK: 'unlink' },
  LIMITS: { HEADERS: 10, DESTINATIONS: 10, LABEL: 24, COMMAND: 100, HEADER_VALUE: 2000, TEXT: 8000, NAME: 40 },
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
};
// ---- end shared contract ----

// The watch sends a slot as a number; the plugin knows it by name.
var SLOT_BY_WIRE = {};
Contract.SLOTS.forEach(function (slot) { SLOT_BY_WIRE[slot.wire] = slot.id; });

function reply(ok, message) {
  Pebble.sendAppMessage({ RESULT: ok ? Contract.WIRE.RESULT_OK : Contract.WIRE.RESULT_FAIL, MESSAGE: String(message || '').slice(0, Contract.WIRE.MESSAGE_MAX) }, function () {}, function () {
    console.error('Could not reply to the watch.');
  });
}

// The user's reminders for the Up and Down buttons live in the plugin's private settings; the watch shows them.
Pebble.addEventListener('ready', function () {
  Pebble.invokeAction({ plugin: PLUGIN_UUID, action: 'get_labels', args: {} }).then(function (result) {
    if (!result.ok) return;
    var labels = JSON.parse(result.text);
    Pebble.sendAppMessage({ UP_LABEL: labels.up || '', DOWN_LABEL: labels.down || '', CONFIGURED: labels.configured ? 1 : 0 }, function () {}, function () {});
  }, function (error) {
    console.error('get_labels failed: ' + (error && error.name));
  });
});

// This file goes through an ES5-only bundler, so no async/await here.
Pebble.addEventListener('appmessage', function (event) {
  var payload = event.payload || {};
  var request;
  if (typeof payload.TEXT === 'string') {
    request = { action: 'send_message', args: { text: payload.TEXT } };
  } else if (SLOT_BY_WIRE[payload.SLOT]) {
    request = { action: 'send_command', args: { slot: SLOT_BY_WIRE[payload.SLOT] } };
  } else {
    reply(false, 'Unknown request');
    return;
  }
  Pebble.invokeAction({ plugin: PLUGIN_UUID, action: request.action, args: request.args }).then(function (result) {
    reply(result.ok, result.ok ? result.text : result.message);
  }, function (error) {
    console.error('invokeAction failed: ' + (error && error.name) + ' ' + (error && error.message));
    reply(false, 'Webhook plugin unavailable');
  });
});
