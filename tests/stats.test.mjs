import test from 'node:test';
import assert from 'node:assert/strict';
import { stateProgress, summarize } from '../js/stats.js';
import { merge } from '../js/intervals.js';

const hike = (from, to, date = '2026-05-01') => ({ id: `${from}-${to}`, date, range: { from, to } });

test('summarize merges overlaps and counts distinct days', () => {
  const s = summarize([hike(0, 30, '2026-05-01'), hike(20, 50, '2026-05-02'), hike(60, 70, '2026-05-02')], 100);
  assert.equal(s.done, 60);
  assert.equal(s.remaining, 40);
  assert.equal(s.pct, 60);
  assert.equal(s.dayCount, 2);
  assert.equal(s.hikeCount, 3);
  assert.equal(s.lastDate, '2026-05-02');
});

test('summarize with no hikes', () => {
  const s = summarize([], 2197.9);
  assert.equal(s.done, 0);
  assert.equal(s.lastDate, null);
});

const statesData = {
  order: ['GA', 'NC', 'TN', 'VA'],
  states: {
    GA: { ranges: [[0, 80]] },
    NC: { ranges: [[80, 150], [200, 260]] },
    TN: { ranges: [[150, 200]] },
    VA: { ranges: [[260, 400]] },
  },
};

test('stateProgress counts per state, with groups merged', () => {
  const merged = merge([[0, 100], [190, 300]]);
  const plain = stateProgress(merged, statesData, []);
  assert.deepEqual(plain.map((r) => r.codes), [['GA'], ['NC'], ['TN'], ['VA']]);
  assert.equal(plain[0].done, 80);
  assert.equal(plain[1].done, 20 + 60);         // NC: 80..100 and 200..260
  assert.equal(plain[2].done, 10);              // TN: 190..200
  assert.equal(plain[3].done, 40);              // VA: 260..300

  const grouped = stateProgress(merged, statesData, [['NC', 'TN']]);
  assert.deepEqual(grouped.map((r) => r.codes), [['GA'], ['NC', 'TN'], ['VA']]);
  assert.equal(grouped[1].total, 70 + 60 + 50);
  assert.equal(grouped[1].done, 90);
});

test('a finished state reports 100%', () => {
  const rows = stateProgress(merge([[0, 80]]), statesData, []);
  assert.equal(rows[0].pct, 100);
});
