// The agreement between the plugin and its settings page: message names, limits, and the vocabulary the
// plugin uses to say which field of the page an error belongs to. This file is the only place it is
// written. `npm run contract` (and app/sync.sh) copies the region below into src/plugin/index.js and
// src/config.html; a test fails if either copy is out of date.
//
// The six button slots (a press, double press and hold of the watch's Up and Down buttons) are listed
// once, here. `wire` is the number the watch sends for a slot. The plugin, the page, the plugin manifest
// (the `slot` enum), the phone-side relay and the watch's C code (app/src/c/contract.h) all come from it.
// WIRE describes the messages between the watch and the phone: the AppMessage keys (also the app's
// `messageKeys`), the RESULT values the phone answers with, and the longest message it sends back.
//
// Messages the page sends (Pebble.sendMessage('plugin', { type, ... })) and what comes back:
//   status                                 -> settings summary
//   save   { destinations, noteDestination, commands, labels } -> settings summary, or { error, target }
//   test   { destination }                 -> { ok, message, permission, host } or { error }
//   pin                                    -> { ok, message } or { error }
//   unlink                                 -> empty settings summary
// An error may carry a `target` naming the field to mark:
//   { kind: 'destination', id, field: 'url' | 'headers' | 'field', index?, part? }
//   { kind: 'command', slot, field: 'command' | 'headers' | 'destination', index?, part? }
//   { kind: 'note', field: 'destination' }
//   { kind: 'label', field: 'up' | 'down' }
// `index` is the row of a header list and `part` is 'name' or 'value'.
// <inline>
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
// </inline>
if (typeof module !== 'undefined' && module.exports) module.exports = Contract;
