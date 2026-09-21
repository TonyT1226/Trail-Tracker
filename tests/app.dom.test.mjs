// Drives the real index.html + js/app.js in jsdom with a fake Mapbox and the placeholder data.
// Covers the form, the log, stats, per-state rows, edit/delete, validation and persistence.
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
window.HTMLElement.prototype.scrollIntoView = () => {};

// ---- fake Mapbox
const handlers = {};
const sources = {};
const calls = [];
class FakeMap {
  constructor(opts) { calls.push(['new', opts]); }
  on(evt, fn) { (handlers[evt] ||= []).push(fn); }
  once(evt, fn) { (handlers[evt] ||= []).push(fn); }
  addControl() {}
  addSource(id, spec) { sources[id] = { spec, data: spec.data, setData(d) { this.data = d; } }; }
  addLayer() {}
  getSource(id) { return sources[id]; }
  getCanvas() { return { style: {} }; }
  getZoom() { return 6; }
  fitBounds(b) { calls.push(['fitBounds', b]); }
  easeTo() {}
  setTerrain() {}
}
define('mapboxgl', {
  Map: FakeMap,
  NavigationControl: class {},
  ScaleControl: class {},
  Popup: class { setLngLat() { return this; } setText() { return this; } addTo() { return this; } },
});
localStorage.setItem('at-tracker:token', 'pk.test');

// ---- serve data/ from disk
define('fetch', async (url) => {
  const file = path.join(root, url);
  const missing = /hikes\.json$|state_borders/.test(url) || !fs.existsSync(file);
  if (missing) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
});

const anchors = JSON.parse(fs.readFileSync(path.join(root, 'data/anchors.json'), 'utf8')).anchors;
const mileOf = (name) => anchors.find((a) => a.name === name).mile;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const type = (sel, value) => {
  const node = $(sel);
  node.value = value;
  node.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const submit = () => $('#hikeForm').requestSubmit();
const savedHikes = () => JSON.parse(localStorage.getItem('at-tracker:hikes:v1'));

const { CONFIG } = await import('../js/config.js');
const { start } = await import('../js/app.js');
await start();
(handlers.load || []).forEach((fn) => fn()); // map finishes loading

test('initial render from real route data', () => {
  assert.equal($('#totalMi').textContent, '2,197.9');
  assert.equal($('#placeholderBanner').hidden, true);
  assert.equal($$('#anchorList option').length, anchors.length);
  assert.equal($$('#states li').length, 13);                 // 14 states, NC + TN listed together
  assert.match($$('#states li')[1].textContent, /北卡罗来纳 \/ 田纳西/);
  assert.equal($$('#blazes i').length, 100);
  assert.equal($$('#hikes li').length, 0);
  assert.equal($('#emptyMsg').hidden, false);
  assert.equal($('#doneMi').textContent, '0.0');
  assert.ok(sources.route && sources.done && sources.focus, 'map sources were added on load');
});

test('logging a hike by place names', () => {
  type('#fDate', '2026-05-03');
  type('#fFrom', 'Springer Mountain');
  type('#fTo', 'Neels Gap');
  assert.match($('#preview').textContent, /新增/);
  submit();
  assert.equal($$('#hikes li').length, 1);
  assert.equal($('#doneMi').textContent, mileOf('Neels Gap').toFixed(1));
  assert.match($('#formMsg').textContent, /已记录/);
  assert.equal($('#fFrom').value, '');                          // form reset
  assert.equal(savedHikes().length, 1);
  assert.equal(savedHikes()[0].toName, 'Neels Gap');
  assert.equal($('#emptyMsg').hidden, true);
  assert.match($$('#hikes li')[0].textContent, /Springer Mountain → Neels Gap/);
  const pct = (mileOf('Neels Gap') / 2197.9) * 100;
  assert.equal($$('#blazes i')[0].style.getPropertyValue('--f'), '1');
  assert.ok(Math.abs(Number($$('#blazes i')[1].style.getPropertyValue('--f')) - (pct - 1)) < 0.01);
  assert.equal(sources.done.data.features[0].geometry.type, 'MultiLineString');
  assert.ok(calls.some(([k]) => k === 'fitBounds'), 'map zooms to the new hike');
});

test('overlapping miles are not counted twice', () => {
  type('#fDate', '2026-05-04');
  type('#fFrom', '20');
  type('#fTo', 'Tesnatee Gap');
  assert.match($('#preview').textContent, /之前走过/);
  submit();
  assert.equal($$('#hikes li').length, 2);
  assert.equal($('#doneMi').textContent, mileOf('Tesnatee Gap').toFixed(1));   // union of 0..Neels and 20..Indian Grave
  assert.equal($$('#hikes li')[0].querySelector('time').textContent, '2026-05-04');  // newest first
});

test('a southbound hike counts the same miles', () => {
  type('#fDate', '2026-05-05');
  type('#fFrom', String(mileOf("Dick's Creek Gap")));
  type('#fTo', String(mileOf('Tesnatee Gap')));
  submit();
  const expected = mileOf("Dick's Creek Gap");                  // 0..Indian Grave plus Indian Grave..Dick's Creek
  assert.equal($('#doneMi').textContent, expected.toFixed(1));
});

test('bad input shows a message and saves nothing', () => {
  const before = savedHikes().length;
  type('#fFrom', 'Nowhere Shelter');
  type('#fTo', '10');
  submit();
  assert.match($('#formMsg').textContent, /找不到/);
  assert.ok($('#formMsg').classList.contains('err'));
  type('#fFrom', '0');
  type('#fTo', '99999');
  submit();
  assert.match($('#formMsg').textContent, /超出范围/);
  type('#fFrom', '10');
  type('#fTo', '10');
  submit();
  assert.match($('#formMsg').textContent, /同一处/);
  assert.equal(savedHikes().length, before);
});

test('editing a record', () => {
  const rows = $$('#hikes li');
  const target = rows.find((r) => r.textContent.includes('2026-05-03'));
  target.querySelector('button[data-act="edit"]').click();
  assert.equal($('#formTitle').textContent, '编辑这段记录');
  assert.equal($('#fFrom').value, 'Springer Mountain (0)');
  assert.equal($('#cancelEdit').hidden, false);
  type('#fNote', '下雨，住 Blood Mountain 山顶');
  submit();
  assert.equal($$('#hikes li').length, 3);
  assert.match($('#hikes').textContent, /下雨/);
  assert.equal($('#formTitle').textContent, '记录一段徒步');
  assert.equal(savedHikes().length, 3);
});

test('deleting a record', () => {
  const before = $('#doneMi').textContent;
  const row = $$('#hikes li').find((r) => r.textContent.includes('2026-05-05'));
  row.querySelector('button[data-act="del"]').click();
  assert.equal($$('#hikes li').length, 2);
  assert.notEqual($('#doneMi').textContent, before);
  assert.equal(savedHikes().length, 2);
});

test('per-state progress reflects the log', () => {
  const georgia = $$('#states li')[0];
  assert.match(georgia.querySelector('.state-name').textContent, /乔治亚/);
  const width = parseFloat(georgia.querySelector('.fill').style.width);
  assert.ok(width > 30 && width < 100, `Georgia bar at ${width}%`);
});

test('no token prompt is shown when a token is configured', () => {
  assert.equal($('#mapMsg').hidden, true);
  assert.equal(calls.filter(([k]) => k === 'new').length, 1);
  assert.equal(calls.find(([k]) => k === 'new')[1].accessToken, undefined); // token goes via mapboxgl.accessToken
  // config.js ships with mapboxToken left empty on purpose (nothing to commit), so this
  // suite falls back to the localStorage token set up above -- assert against that.
  assert.equal(CONFIG.mapboxToken, '');
  assert.equal(globalThis.mapboxgl.accessToken, 'pk.test');
});
