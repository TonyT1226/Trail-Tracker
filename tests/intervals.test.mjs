import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, overlap, total } from '../js/intervals.js';

test('merge unions overlapping and touching intervals', () => {
  assert.deepEqual(merge([[10, 20], [0, 5], [4, 8], [20.003, 25]]), [[0, 8], [10, 25]]);
  assert.deepEqual(merge([[0, 5], [5, 9]]), [[0, 9]]);
  assert.deepEqual(merge([[3, 3], [0, 0.0000000001]]), []);
  assert.deepEqual(merge([]), []);
});

test('merge does not mutate its input', () => {
  const input = [[5, 9], [0, 6]];
  merge(input);
  assert.deepEqual(input, [[5, 9], [0, 6]]);
});

test('total and overlap', () => {
  const m = merge([[0, 10], [20, 30]]);
  assert.equal(total(m), 20);
  assert.equal(overlap(m, [[5, 25]]), 10);       // 5..10 and 20..25
  assert.equal(overlap(m, [[10, 20]]), 0);
  assert.equal(overlap(m, [[0, 5], [25, 40]]), 10);
});

test('the same hike logged twice never double counts', () => {
  assert.equal(total(merge([[0, 30], [0, 30], [10, 20]])), 30);
});
