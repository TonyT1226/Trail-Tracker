// First-run experience: no Mapbox token yet. The page must explain what to do, and the
// log / stats must keep working without a map.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<link[^>]*>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost:8000/', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('window', window);
define('document', document);
define('localStorage', window.localStorage);
define('location', window.location);
define('confirm', () => true);
define('__AT_TEST__', true);
define('mapboxgl', { Map: class { constructor() { throw new Error('map must not be created without a token'); } } });
define('fetch', async (url) => {
  const file = path.join(root, url);
  const missing = /hikes\.json$|state_borders/.test(url) || !fs.existsSync(file);
  if (missing) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
});

const $ = (s) => document.querySelector(s);
const type = (sel, value) => {
  $(sel).value = value;
  $(sel).dispatchEvent(new window.Event('input', { bubbles: true }));
};

const { CONFIG } = await import('../js/config.js');
// This suite specifically exercises the "no token configured yet" first-run
// path. config.js normally carries a real production token (see js/config.js),
// so force it empty here regardless -- CONFIG is a shared module-cache object,
// and js/app.js reads CONFIG.mapboxToken lazily inside start(), so mutating it
// before calling start() reliably simulates the empty-token state.
CONFIG.mapboxToken = '';
const { start } = await import('../js/app.js');
await start();

test('asks for a token and hides map-only controls', () => {
  assert.equal($('#mapMsg').hidden, false);
  assert.match($('#mapMsg').textContent, /pk\./);
  assert.equal($('.map-tools').hidden, true);
  assert.ok([...document.querySelectorAll('.pick')].every((b) => b.hidden));
});

test('rejects a secret (sk.) token', () => {
  const input = $('#mapMsg input');
  input.value = 'sk.secret';
  $('#mapMsg button').click();
  assert.match($('#mapMsg').textContent, /not a secret key starting with sk\./);
  assert.equal(localStorage.getItem('at-tracker:token'), null);
});

test('the hike log still works without a map', () => {
  type('#fDate', '2026-06-01');
  type('#fFrom', '0');
  type('#fTo', '25');
  $('#hikeForm').requestSubmit();
  assert.equal(document.querySelectorAll('#hikes li').length, 1);
  assert.equal($('#doneMi').textContent, '25.0');
});

test('a data loading failure is reported instead of a blank page', async () => {
  define('fetch', async () => ({ ok: false, status: 500, json: async () => null }));
  await start();
  assert.equal($('#loadError').hidden, false);
  assert.match($('#loadError').textContent, /Couldn.t load data/);
});
