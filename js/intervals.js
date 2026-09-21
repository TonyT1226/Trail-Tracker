// Completed sections are mile intervals [start, end]. The finished part of the trail is
// their union, so overlapping or repeated hikes never count the same mile twice.

// gaps smaller than this (miles, ~26 ft) are treated as touching, so a hike that ends at
// "Neels Gap (31.7)" and one that starts at 31.7 join up cleanly.
const JOIN_EPS = 0.005;

export function merge(intervals) {
  const sorted = intervals
    .filter(([a, b]) => b - a > 1e-9)
    .map(([a, b]) => [a, b])
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + JOIN_EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function total(merged) {
  return merged.reduce((sum, [a, b]) => sum + (b - a), 0);
}

// miles of `merged` that fall inside `ranges` (ranges must not overlap each other)
export function overlap(merged, ranges) {
  let sum = 0;
  for (const [ra, rb] of ranges) {
    for (const [a, b] of merged) {
      const lo = Math.max(a, ra);
      const hi = Math.min(b, rb);
      if (hi > lo) sum += hi - lo;
    }
  }
  return sum;
}
