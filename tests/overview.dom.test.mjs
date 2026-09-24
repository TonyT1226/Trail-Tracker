// "All trails" in the picker: combined progress, one row per trail, every route on one map
// with each trail's walked miles in its own colour -- and no way to log a hike without a trail.
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

// ---- fake Mapbox (records sources so we can check what gets drawn)
const handlers = {};
const sources = {};
const layers = [];
const fits = [];
class FakeMap {
  on(evt, fn) { (handlers[evt] ||= []).push(fn); }
  addControl() {}
  addSource(id, spec) { sources[id] = { data: spec.data, setData(d) { this.data = d; } }; }
  addLayer(spec) { layers.push(spec); }
  getSource(id) { return sources[id]; }
  getStyle() { return { imports: [] }; }
  getZoom() { return 6; }
  fitBounds(b) { fits.push(b); }
}
define('mapboxgl', {
  Map: FakeMap,
  NavigationControl: class {},
  ScaleControl: class {},
  Popup: class { setLngLat() { return this; } setText() { return this; } addTo() { return this; } },
});
localStorage.setItem('at-tracker:token', 'pk.test');

// ---- the real AT package plus a small made-up second trail
const testTrail = {
  'data/trails/index.json': { schemaVersion: 1, trails: ['AT', 'TEST'] },
  'data/trails/TEST/trail.json': {
    schemaVersion: 1, id: 'TEST', name: 'Test Trail', shortName: 'TT', color: '#0077aa',
    credit: 'Test data, public domain.', files: { route: 'route.json' },
  },
  'data/trails/TEST/route.json': {
    name: 'Test Trail', placeholder: false, totalMiles: 100,
    coords: [[-120, 40], [-120, 40.5], [-120, 41]], miles: [0, 50, 100],
  },
};
const fetched = [];
define('fetch', async (url) => {
  fetched.push(url);
  if (url in testTrail) return { ok: true, status: 200, json: async () => structuredClone(testTrail[url]) };
  const file = path.join(root, url);
  if (/hikes\.json$/.test(url) || !fs.existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
});

const hike = (id, trailId, from, to, date) => ({
  id, trailId, date, source: 'manual', range: { from, to }, fromName: '', toName: '', note: '',
});
localStorage.setItem('at-tracker:hikes:v1', JSON.stringify({
  schemaVersion: 1,
  activities: [
    hike('a1', 'AT', 0, 100, '2026-04-01'),
    hike('a2', 'AT', 50, 150, '2026-04-02'),      // overlaps a1: AT done = 150
    hike('t1', 'TEST', 0, 30, '2026-04-02'),      // same miles as a1, other trail: still counts
    hike('x1', 'CDT', 0, 500, '2026-04-03'),      // a trail this copy doesn't have: kept, not counted
  ],
}));
localStorage.setItem('at-tracker:trail', '*');

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const { start } = await import('../js/app.js');
await start();
(handlers.load || []).forEach((fn) => fn());

const AT_TOTAL = 2197.9;

test('the picker is on "All" and the header describes every trail', () => {
  assert.equal($('#loadError').hidden, true, $('#loadError').textContent);
  assert.equal($('#trailSelect').value, '*');
  assert.equal($('#trailName').textContent, 'Trail Tracker');
  assert.equal($('#trailSubtitle').textContent, 'Progress on all 2 trails');
  assert.equal(document.title, 'Trail Tracker');
  assert.equal($('.app').classList.contains('booting'), false, 'panel revealed once filled in');
  assert.match($('#credit').textContent, /Appalachian Trail Conservancy.*Test data, public domain\./);
});

test('every trail\'s route is loaded, but no per-trail extras', () => {
  assert.ok(fetched.includes('data/trails/AT/route.json'));
  assert.ok(fetched.includes('data/trails/TEST/route.json'));
  assert.ok(!fetched.includes('data/trails/AT/anchors.json'));
  assert.ok(!fetched.includes('data/trails/AT/states.json'));
});

test('combined figures merge within each trail, never across trails', () => {
  assert.equal($('#doneMi').textContent, '180.0');                           // 150 on the AT + 30 on TEST
  assert.equal($('#totalMi').textContent, `${(AT_TOTAL + 100).toLocaleString('en-US', { minimumFractionDigits: 1 })} mi`);
  assert.equal($('#hikeCount').textContent, '3 hikes');                     // the CDT hike isn't counted
  assert.equal($('#dayCount').textContent, '2 days');
  assert.equal($('#lastDate').textContent, '2026-04-02');
});

test('one row per trail, in its colour, that opens the trail', () => {
  assert.equal($('#statesTitle').textContent, 'Progress by trail');
  const rows = $$('#states li');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Appalachian Trail\s*150\.0 \/ 2,197\.9 · 6\.8%/);
  assert.match(rows[1].textContent, /Test Trail\s*30\.0 \/ 100\.0 · 30\.0%/);
  assert.equal(rows[1].querySelector('.fill').style.background, 'rgb(0, 119, 170)');
  assert.equal(rows[1].querySelector('button').dataset.trail, 'TEST');
});

test('no hike form or log without a trail, just a pointer to the picker', () => {
  assert.equal($('#logSection').hidden, true);
  assert.equal($('#hikesSection').hidden, true);
  assert.equal($('#overviewHint').hidden, false);
});

test('the map draws every route and colours walked miles per trail', () => {
  assert.equal(sources.routes.data.features.length, 2);
  const done = sources.done.data.features;
  assert.deepEqual(done.map((f) => f.properties.color), ['#d1246b', '#0077aa']);
  assert.deepEqual(layers.find((l) => l.id === 'done').paint['line-color'], ['get', 'color']);
});

test('saving from the overview keeps every activity, including unknown trails', () => {
  const file = new File([JSON.stringify({ schemaVersion: 1, activities: [hike('t2', 'TEST', 40, 50, '2026-04-05')] })],
    'backup.json', { type: 'application/json' });
  const input = $('#importFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  return new Promise((r) => setTimeout(r, 20)).then(() => {
    assert.equal($('#toolsMsg').textContent, 'Imported 1 hike');
    const ids = JSON.parse(localStorage.getItem('at-tracker:hikes:v1')).activities.map((a) => a.id).sort();
    assert.deepEqual(ids, ['a1', 'a2', 't1', 't2', 'x1']);
    assert.equal($('#doneMi').textContent, '190.0');
  });
});
