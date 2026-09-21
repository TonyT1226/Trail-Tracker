import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/store.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('normalizeActivity validates and rounds', () => {
  const a = store.normalizeActivity({ date: '2026-05-03', range: { from: '0', to: 31.43349 }, note: 'x' });
  assert.equal(a.range.to, 31.433);
  assert.equal(a.trailId, 'AT');
  assert.equal(a.source, 'manual');
  assert.ok(a.id.length > 5);
  assert.throws(() => store.normalizeActivity({ date: '5/3/2026', range: { from: 0, to: 1 } }), /date/i);
  assert.throws(() => store.normalizeActivity({ date: '2026-05-03', range: { from: 'a', to: 1 } }), /mile/i);
});

test('normalizeActivity also accepts the old flat {from,to} shape (pre-schemaVersion data)', () => {
  const a = store.normalizeActivity({ id: 'old1', date: '2026-05-03', from: 0, to: 10, fromName: 'A', toName: 'B' });
  assert.deepEqual(a.range, { from: 0, to: 10 });
  assert.equal(a.trailId, 'AT');
});

test('bounds handles southbound hikes', () => {
  assert.deepEqual(store.bounds({ range: { from: 50, to: 20 } }), [20, 50]);
});

test('load returns null when nothing was ever saved, [] when saved empty', () => {
  const s = fakeStorage();
  assert.equal(store.load(s), null);
  store.save([], s);
  assert.deepEqual(store.load(s), []);
});

test('save then load round-trips', () => {
  const s = fakeStorage();
  const activities = [store.normalizeActivity({ date: '2026-05-03', range: { from: 0, to: 10 } })];
  store.save(activities, s);
  assert.deepEqual(store.load(s), activities);
});

test('load migrates old flat-array-of-hikes storage (pre-schemaVersion) transparently', () => {
  const s = fakeStorage();
  s.setItem('at-tracker:hikes:v1', JSON.stringify([{ id: 'old1', date: '2026-05-03', from: 0, to: 10, fromName: 'A', toName: 'B', note: '' }]));
  const loaded = store.load(s);
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0].range, { from: 0, to: 10 });
  assert.equal(loaded[0].trailId, 'AT');
});

test('load survives corrupted storage', () => {
  const s = fakeStorage();
  s.setItem('at-tracker:hikes:v1', '{oops');
  assert.equal(store.load(s), null);
});

test('export then import round-trips; old export shape and bad files give readable errors', () => {
  const activities = [store.normalizeActivity({ date: '2026-05-03', range: { from: 0, to: 10 }, fromName: 'A', toName: 'B' })];
  assert.deepEqual(store.parseImport(store.serialize(activities)), activities);
  assert.deepEqual(store.parseImport(JSON.stringify(activities)), activities);              // bare array also accepted
  assert.deepEqual(store.parseImport(JSON.stringify({ hikes: [{ id: activities[0].id, date: '2026-05-03', from: 0, to: 10, fromName: 'A', toName: 'B', note: '' }] })), activities);
  assert.throws(() => store.parseImport('not json'), /valid JSON/i);
  assert.throws(() => store.parseImport('{"a":1}'), /hikes/i);
  assert.throws(() => store.parseImport('{"activities":[{"date":"2026-01-01","range":{"from":1,"to":"x"}}]}'), /Record 1/);
});

test('mergeById lets incoming win', () => {
  const a = { ...store.normalizeActivity({ date: '2026-01-01', range: { from: 0, to: 1 } }), id: 'a' };
  const b = { ...a, range: { from: 0, to: 2 } };
  const c = { ...a, id: 'c' };
  const out = store.mergeById([a], [b, c]);
  assert.equal(out.length, 2);
  assert.equal(out.find((h) => h.id === 'a').range.to, 2);
});
