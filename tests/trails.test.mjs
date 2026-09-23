import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, localized, pickTrail, trailFolder, validateManifest } from '../js/trails.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = async (url) => JSON.parse(fs.readFileSync(path.join(root, url), 'utf8'));

test('trailFolder resolves next to index.json', () => {
  assert.equal(trailFolder('data/trails/index.json', 'PCT'), 'data/trails/PCT/');
});

test('localized accepts plain strings and per-language objects', () => {
  assert.equal(localized('Hi', 'zh'), 'Hi');
  assert.equal(localized({ en: 'Hi', zh: '你好' }, 'zh'), '你好');
  assert.equal(localized({ en: 'Hi' }, 'zh'), 'Hi');   // falls back to English
  assert.equal(localized(undefined, 'en'), '');
});

test('validateManifest rejects mismatched ids and missing routes', () => {
  assert.throws(() => validateManifest({ id: 'PCT', name: 'x', files: { route: 'r' } }, 'AT'), /id "PCT"/);
  assert.throws(() => validateManifest({ id: 'AT', name: 'x', files: {} }, 'AT'), /files\.route/);
  assert.throws(() => validateManifest(null, 'AT'), /missing/);
});

test('pickTrail falls back to the first trail when the saved one is gone', () => {
  const catalog = [{ id: 'AT' }, { id: 'PCT' }];
  assert.equal(pickTrail(catalog, 'PCT').id, 'PCT');
  assert.equal(pickTrail(catalog, 'CDT').id, 'AT');
  assert.equal(pickTrail(catalog, null).id, 'AT');
});

test('the shipped catalog is valid and every file it names exists', async () => {
  const catalog = await loadCatalog('data/trails/index.json', readJSON);
  assert.ok(catalog.length >= 1);
  assert.equal(catalog[0].id, 'AT');
  for (const tr of catalog) {
    for (const url of Object.values(tr.urls)) {
      assert.ok(fs.existsSync(path.join(root, url)), `${tr.id}: ${url} is missing`);
    }
  }
});
