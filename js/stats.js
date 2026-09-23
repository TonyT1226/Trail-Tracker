import { merge, overlap, total } from './intervals.js';
import { bounds } from './store.js';

export function summarize(hikes, totalMiles) {
  const merged = merge(hikes.map(bounds));
  const done = total(merged);
  const dates = [...new Set(hikes.map((h) => h.date))].sort();
  return {
    merged,
    done,
    remaining: Math.max(totalMiles - done, 0),
    pct: totalMiles > 0 ? Math.min((done / totalMiles) * 100, 100) : 0,
    hikeCount: hikes.length,
    dayCount: dates.length,
    lastDate: dates.length ? dates[dates.length - 1] : null,
  };
}

// Progress across several trails: [{ id, totalMiles, hikes }] -> combined figures plus one
// summarize() per trail. Miles restart at 0 on every trail, so intervals are only ever merged
// within a trail -- mile 10 on the AT and mile 10 on the PCT are different places.
export function summarizeTrails(trails) {
  const perTrail = trails.map((tr) => ({ id: tr.id, ...summarize(tr.hikes, tr.totalMiles) }));
  const totalMiles = trails.reduce((s, tr) => s + tr.totalMiles, 0);
  const done = perTrail.reduce((s, r) => s + r.done, 0);
  const dates = [...new Set(trails.flatMap((tr) => tr.hikes.map((h) => h.date)))].sort();
  return {
    perTrail,
    totalMiles,
    done,
    remaining: Math.max(totalMiles - done, 0),
    pct: totalMiles > 0 ? Math.min((done / totalMiles) * 100, 100) : 0,
    hikeCount: perTrail.reduce((s, r) => s + r.hikeCount, 0),
    dayCount: dates.length,
    lastDate: dates.length ? dates[dates.length - 1] : null,
  };
}

// One row per state (or per group of states listed together), south to north.
export function stateProgress(merged, statesData, groups = []) {
  const rows = [];
  const used = new Set();
  for (const code of statesData.order) {
    if (used.has(code)) continue;
    const group = (groups.find((g) => g.includes(code)) || [code]).filter((c) => statesData.states[c]);
    group.forEach((c) => used.add(c));
    const ranges = group.flatMap((c) => statesData.states[c].ranges);
    const totalMi = ranges.reduce((s, [a, b]) => s + (b - a), 0);
    const done = overlap(merged, ranges);
    rows.push({ codes: group, total: totalMi, done, pct: totalMi > 0 ? Math.min((done / totalMi) * 100, 100) : 0 });
  }
  return rows;
}
