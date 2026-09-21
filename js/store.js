// The hike log. Lives in this browser's localStorage as one continuously-updated record
// (not one file per hike); "Export JSON" writes out a complete snapshot of everything
// logged so far, and "Import JSON" merges a snapshot back in by id. So there's always
// exactly one JSON shape to reason about: the live one in this browser, and whatever
// snapshot of it you last exported.
//
// An Activity: { id, trailId, date: "YYYY-MM-DD", source, range: { from, to }, fromName,
// toName, note }. `range` is miles as walked, so from > to means southbound. `source` is
// 'manual' for 1.0 (the only way to log a hike today); 'gpx' and 'healthkit' are reserved
// for when 3.0/4.0 add other ways to bring in a hike.
import { t } from './strings.js';

const KEY = 'at-tracker:hikes:v1';
const SCHEMA_VERSION = 1;
const round3 = (n) => Math.round(n * 1000) / 1000;

export function newId() {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Accepts either the current shape ({ range: { from, to }, ... }) or the old flat shape
// ({ from, to, ... }) so that old localStorage data and old export files both still load.
export function normalizeActivity(a) {
  const range = a.range ?? { from: a.from, to: a.to };
  const from = Number(range.from);
  const to = Number(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error(t('mileInvalid'));
  if (typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
    throw new Error(t('dateInvalid'));
  }
  return {
    id: a.id || newId(),
    trailId: a.trailId || 'AT',
    date: a.date,
    source: a.source || 'manual',
    range: { from: round3(from), to: round3(to) },
    fromName: String(a.fromName || ''),
    toName: String(a.toName || ''),
    note: String(a.note || ''),
  };
}

export const bounds = (a) => [Math.min(a.range.from, a.range.to), Math.max(a.range.from, a.range.to)];

function activityList(data) {
  if (Array.isArray(data)) return data;               // oldest shape: a bare array of hikes
  if (Array.isArray(data?.activities)) return data.activities;
  if (Array.isArray(data?.hikes)) return data.hikes;   // pre-schemaVersion export shape
  return null;
}

// null = nothing has ever been saved here (as opposed to an empty log)
export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return null;
    const list = activityList(JSON.parse(raw));
    return list ? list.map(normalizeActivity) : null;
  } catch {
    return null;
  }
}

export function save(activities, storage = globalThis.localStorage) {
  storage.setItem(KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, activities }));
}

export function serialize(activities) {
  return JSON.stringify(
    { app: 'at-tracker', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), activities },
    null, 2,
  );
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('notJson'));
  }
  const list = activityList(data);
  if (!list) throw new Error(t('noActivitiesFound'));
  return list.map((a, i) => {
    try {
      return normalizeActivity(a);
    } catch (e) {
      throw new Error(t('recordProblem', i + 1, e.message));
    }
  });
}

// merge by id; entries in `incoming` win
export function mergeById(existing, incoming) {
  const map = new Map(existing.map((a) => [a.id, a]));
  for (const a of incoming) map.set(a.id, a);
  return [...map.values()];
}
