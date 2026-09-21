import test from 'node:test';
import assert from 'node:assert/strict';
import { Route } from '../js/geo.js';

// three vertices on the equator; "miles" are just whatever the pipeline stamped
const route = new Route({ coords: [[0, 0], [1, 0], [2, 0]], miles: [0, 10, 20] });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('pointAt interpolates and clamps', () => {
  assert.deepEqual(route.pointAt(5), [0.5, 0]);
  assert.deepEqual(route.pointAt(15), [1.5, 0]);
  assert.deepEqual(route.pointAt(-3), [0, 0]);
  assert.deepEqual(route.pointAt(99), [2, 0]);
  assert.deepEqual(route.pointAt(10), [1, 0]);
});

test('slice returns interior vertices, in either argument order', () => {
  assert.deepEqual(route.slice(5, 15), [[0.5, 0], [1, 0], [1.5, 0]]);
  assert.deepEqual(route.slice(15, 5), [[0.5, 0], [1, 0], [1.5, 0]]);
  assert.deepEqual(route.slice(0, 20), [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(route.slice(11, 12), [[1.1, 0], [1.2, 0]]);
});

test('nearest finds the mile of the closest point', () => {
  const n = route.nearest(1.2, 0.0001);
  close(n.mile, 12, 1e-6);
  assert.ok(n.distMi < 0.01);
  assert.ok(route.nearest(5, 0).mile === 20);          // beyond the end snaps to the end
  assert.ok(route.nearest(1, 1).distMi > 60);           // far away is reported as far
});

test('featuresFor builds a MultiLineString and skips empty intervals', () => {
  const fc = route.featuresFor([[0, 5], [8, 12], [13, 13]]);
  assert.equal(fc.features[0].geometry.type, 'MultiLineString');
  assert.equal(fc.features[0].geometry.coordinates.length, 2);
  assert.deepEqual(route.featuresFor([]).features, []);
});

test('bad route data is rejected with a readable message', () => {
  assert.throws(() => new Route({ coords: [[0, 0], [1, 1]], miles: [0] }), /长度必须一致/);
});
