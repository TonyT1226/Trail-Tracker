import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/store.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('normalizeHike validates and rounds', () => {
  const h = store.normalizeHike({ date: '2026-05-03', from: '0', to: 31.43349, note: 'x' });
  assert.equal(h.to, 31.433);
  assert.ok(h.id.length > 5);
  assert.throws(() => store.normalizeHike({ date: '5/3/2026', from: 0, to: 1 }), /日期/);
  assert.throws(() => store.normalizeHike({ date: '2026-05-03', from: 'a', to: 1 }), /里程/);
});

test('bounds handles southbound hikes', () => {
  assert.deepEqual(store.bounds({ from: 50, to: 20 }), [20, 50]);
});

test('load returns null when nothing was ever saved, [] when saved empty', () => {
  const s = fakeStorage();
  assert.equal(store.load(s), null);
  store.save([], s);
  assert.deepEqual(store.load(s), []);
});

test('save then load round-trips', () => {
  const s = fakeStorage();
  const hikes = [store.normalizeHike({ date: '2026-05-03', from: 0, to: 10 })];
  store.save(hikes, s);
  assert.deepEqual(store.load(s), hikes);
});

test('load survives corrupted storage', () => {
  const s = fakeStorage();
  s.setItem('at-tracker:hikes:v1', '{oops');
  assert.equal(store.load(s), null);
});

test('export then import round-trips; bad files give readable errors', () => {
  const hikes = [store.normalizeHike({ date: '2026-05-03', from: 0, to: 10, fromName: 'A', toName: 'B' })];
  assert.deepEqual(store.parseImport(store.serialize(hikes)), hikes);
  assert.deepEqual(store.parseImport(JSON.stringify(hikes)), hikes);       // bare array also accepted
  assert.throws(() => store.parseImport('not json'), /有效的 JSON/);
  assert.throws(() => store.parseImport('{"a":1}'), /hikes/);
  assert.throws(() => store.parseImport('{"hikes":[{"date":"2026-01-01","from":1,"to":"x"}]}'), /第 1 条/);
});

test('mergeById lets incoming win', () => {
  const a = { ...store.normalizeHike({ date: '2026-01-01', from: 0, to: 1 }), id: 'a' };
  const b = { ...a, to: 2 };
  const c = { ...a, id: 'c' };
  const out = store.mergeById([a], [b, c]);
  assert.equal(out.length, 2);
  assert.equal(out.find((h) => h.id === 'a').to, 2);
});
