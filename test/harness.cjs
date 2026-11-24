// Runs the real settings page against the real plugin, with a stub Pebble, so tests can drive the UI.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function start(options) {
  options = options || {};
  const store = options.store || {};
  const fetches = [];
  const pins = [];
  const sent = [];
  let configHandler;
  let actionHandler;
  global.Pebble = {
    registerActionHandler(handler) { actionHandler = handler; },
    registerConfigHandler(handler) { configHandler = handler; },
    secureStorage: {
      getItem: async (key) => (key in store ? store[key] : null),
      setItem: async (key, value) => { store[key] = value; },
      removeItem: async (key) => { delete store[key]; },
    },
    permissions: { query: async () => options.permission || 'granted' },
    insertTimelinePin: async (pin) => { pins.push(pin); },
  };
  global.fetch = async (url, init) => {
    fetches.push({ url, options: init });
    if (options.fetchError) { const error = new Error('stubbed'); error.name = options.fetchError; throw error; }
    return { status: options.status || 200 };
  };
  const pluginPath = require.resolve('../src/plugin/index.js');
  delete require.cache[pluginPath];
  require(pluginPath).setRateLimit(options.rateLimit || 0);   // tests send in quick bursts unless they ask otherwise

  let ready;
  let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.html'), 'utf8');
  if (options.watchapp) html = html.replace('var HAS_WATCHAPP = false;', 'var HAS_WATCHAPP = true;').replace("var PRODUCT = 'Webhook Actions';", "var PRODUCT = 'VoiceHook';");
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.Pebble = {
        sendMessage: (target, message) => { sent.push(message); return new Promise((resolve) => configHandler(message, resolve)); },
        addEventListener: (name, callback) => { if (name === 'ready') ready = callback; },
      };
      window.HTMLElement.prototype.scrollIntoView = function () {};
    },
  });
  await ready({ target: 'plugin' });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  await settle();
  const window = dom.window;
  const document = window.document;
  const type = (input, value) => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = async (element) => { element.click(); await settle(); };
  const action = (request) => new Promise((resolve) => actionHandler(request, { ok: (r) => resolve({ ok: true, ...r }), error: (code, message) => resolve({ ok: false, code, message }) }));
  return { window, document, store, fetches, pins, sent, type, click, settle, action };
}

module.exports = { start };
