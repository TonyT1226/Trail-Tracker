// A second, made-up trail added purely as data (an index.json entry + a folder of JSON):
// the page must pick it up with no code changes, keep each trail's progress separate,
// and never drop another trail's activities when saving.
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
define('mapboxgl', undefined); // no map: this suite is about data, not Mapbox

// ---- a 100-mile straight "Test Trail" crossing two made-up states
const testTrail = {
  'data/trails/index.json': { schemaVersion: 1, trails: ['AT', 'TEST'] },
  'data/trails/TEST/trail.json': {
    schemaVersion: 1,
    id: 'TEST',
    name: 'Test Trail',
    shortName: 'TT',
    color: '#0077aa',
    subtitle: { en: 'Here to There', zh: '从这里到那里' },
    credit: 'Test data, public domain.',
    files: { route: 'route.json', states: 'states.json' },
  },
  'data/trails/TEST/route.json': {
    name: 'Test Trail', placeholder: false, totalMiles: 100,
    coords: [[-120, 40], [-120, 40.5], [-120, 41]],
    miles: [0, 50, 100],
  },
  'data/trails/TEST/states.json': {
    order: ['XA', 'XB'],
    states: { XA: { name: 'Exampleland', ranges: [[0, 40]] }, XB: { name: 'Otherland', ranges: [[40, 100]] } },
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

const atHike = {
  id: 'at-1', trailId: 'AT', date: '2026-04-01', source: 'manual',
  range: { from: 0, to: 50 }, fromName: '', toName: '', note: '',
};
const testHike = { ...atHike, id: 'tt-1', trailId: 'TEST', date: '2026-04-02', range: { from: 0, to: 10 } };
localStorage.setItem('at-tracker:hikes:v1', JSON.stringify({ schemaVersion: 1, activities: [atHike, testHike] }));
localStorage.setItem('at-tracker:trail', 'TEST');

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const type = (sel, value) => {
  $(sel).value = value;
  $(sel).dispatchEvent(new window.Event('input', { bubbles: true }));
};
const saved = () => JSON.parse(localStorage.getItem('at-tracker:hikes:v1')).activities;

const { start } = await import('../js/app.js');
await start();

test('the saved trail is opened, with a picker listing every trail', () => {
  assert.equal($('#loadError').hidden, true, $('#loadError').textContent);
  assert.equal($('#trailSelect').hidden, false);
  assert.equal($('#trailName').textContent, 'Test Trail');
  assert.deepEqual($$('#trailSelect option').map((o) => [o.value, o.textContent]),
    [['AT', 'AT'], ['TEST', 'TT']]);
  assert.equal($('#trailSelect').value, 'TEST');
  assert.equal($('#trailSubtitle').textContent, 'Here to There');
  assert.match($('#credit').textContent, /Test data, public domain\./);
  assert.equal(document.title, 'Test Trail · Trail Tracker');
  assert.equal($('#map').getAttribute('aria-label'), 'Test Trail map');
});

test('only this trail\'s files are loaded', () => {
  assert.ok(fetched.includes('data/trails/TEST/route.json'));
  assert.ok(!fetched.includes('data/trails/AT/route.json'), 'the AT route is not downloaded while viewing another trail');
});

test('stats count only this trail\'s activities', () => {
  assert.equal($('#totalMi').textContent, '100.0 mi');
  assert.equal($('#doneMi').textContent, '10.0');
  assert.equal($$('#hikes li').length, 1);
});

test('state names fall back to the names in the trail\'s own states.json', () => {
  const names = $$('#states li .state-name').map((n) => n.textContent);
  assert.deepEqual(names, ['Exampleland', 'Otherland']);
});

test('logging on this trail tags the activity and leaves other trails\' activities alone', () => {
  type('#fDate', '2026-04-03');
  type('#fFrom', '20');
  type('#fTo', '30');
  $('#hikeForm').requestSubmit();
  assert.equal($('#doneMi').textContent, '20.0');
  const all = saved();
  assert.equal(all.length, 3);
  assert.deepEqual(all.find((a) => a.id === 'at-1'), atHike);
  assert.equal(all.filter((a) => a.trailId === 'TEST').length, 2);
});

test('deleting on this trail leaves other trails\' activities alone', () => {
  $$('#hikes li').find((r) => r.textContent.includes('2026-04-02')).querySelector('button[data-act="del"]').click();
  assert.deepEqual(saved().map((a) => a.id).sort(), ['at-1', saved().find((a) => a.trailId === 'TEST').id].sort());
});

test('importing hikes from several trails says how many landed on other trails', async () => {
  const file = new File([JSON.stringify({   // Node's File: jsdom's has no .text()
    schemaVersion: 1,
    activities: [
      { ...atHike, id: 'at-2', range: { from: 60, to: 70 } },
      { ...testHike, id: 'tt-2', range: { from: 50, to: 60 } },
    ],
  })], 'backup.json', { type: 'application/json' });
  const input = $('#importFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal($('#formMsg').textContent, 'Imported 2 hikes (1 on other trails -- switch trails to see it)');
  assert.ok(saved().some((a) => a.id === 'at-2'), 'the AT hike is kept even though it is not shown');
  assert.equal($$('#hikes li').length, 2);   // the remaining TEST hike + the imported one
});
