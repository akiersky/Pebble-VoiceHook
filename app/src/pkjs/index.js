// Relays the watchapp's requests to the Webhook plugin bundled in this same pbw.
// A bundled plugin shares the pbw's uuid, so this must match "uuid" in package.base.json.
var PLUGIN_UUID = 'c0756590-bd59-464d-82f3-acd4499077d4';
var SLOTS = [null, 'up_single', 'up_double', 'up_hold', 'down_single', 'down_double', 'down_hold'];

function reply(ok, message) {
  Pebble.sendAppMessage({ RESULT: ok ? 1 : 0, MESSAGE: String(message || '').slice(0, 90) }, function () {}, function () {
    console.error('Could not reply to the watch.');
  });
}

// This file goes through an ES5-only bundler, so no async/await here.
Pebble.addEventListener('appmessage', function (event) {
  var payload = event.payload || {};
  var request;
  if (typeof payload.TEXT === 'string') {
    request = { action: 'send_message', args: { text: payload.TEXT } };
  } else if (SLOTS[payload.SLOT]) {
    request = { action: 'send_command', args: { slot: SLOTS[payload.SLOT] } };
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
