// Route geometry. The route is a polyline whose every vertex carries its mile marker,
// so "mile A to mile B" is a lookup, not a geometric calculation.

const MI_PER_DEG_LAT = 69.093;
const rad = (d) => (d * Math.PI) / 180;

export class Route {
  constructor({ coords, miles }) {
    if (!Array.isArray(coords) || coords.length < 2 || coords.length !== miles?.length) {
      throw new Error('route.json 格式不对：coords 和 miles 的长度必须一致，且至少 2 个点');
    }
    this.coords = coords;
    this.miles = miles;
    this.length = miles[miles.length - 1];
  }

  clamp(m) {
    return Math.min(Math.max(m, 0), this.length);
  }

  // index i such that miles[i] <= m <= miles[i+1]
  segmentIndex(m) {
    let lo = 0;
    let hi = this.miles.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.miles[mid] <= m) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pointAt(m) {
    m = this.clamp(m);
    const i = this.segmentIndex(m);
    const m0 = this.miles[i];
    const m1 = this.miles[i + 1];
    const t = m1 > m0 ? (m - m0) / (m1 - m0) : 0;
    const a = this.coords[i];
    const b = this.coords[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  // coordinates of the route between two miles (either order)
  slice(m0, m1) {
    const a = this.clamp(Math.min(m0, m1));
    const b = this.clamp(Math.max(m0, m1));
    const out = [this.pointAt(a)];
    for (let i = this.segmentIndex(a) + 1; i < this.miles.length && this.miles[i] < b; i++) {
      if (this.miles[i] > a) out.push(this.coords[i]);
    }
    out.push(this.pointAt(b));
    return out;
  }

  // closest point on the route to a lng/lat: { mile, distMi }
  nearest(lng, lat) {
    const cosLat = Math.cos(rad(lat));
    let bestD2 = Infinity;
    let bestMile = 0;
    for (let i = 0; i < this.coords.length - 1; i++) {
      const a = this.coords[i];
      const b = this.coords[i + 1];
      const ax = (a[0] - lng) * cosLat;
      const ay = a[1] - lat;
      const dx = (b[0] - a[0]) * cosLat;
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d2 = px * px + py * py;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestMile = this.miles[i] + t * (this.miles[i + 1] - this.miles[i]);
      }
    }
    return { mile: bestMile, distMi: Math.sqrt(bestD2) * MI_PER_DEG_LAT };
  }

  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of this.coords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return [[minX, minY], [maxX, maxY]];
  }

  // GeoJSON for a set of mile intervals (a MultiLineString), or an empty collection
  featuresFor(intervals) {
    const lines = intervals.filter(([a, b]) => b - a > 1e-4).map(([a, b]) => this.slice(a, b));
    if (!lines.length) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }],
    };
  }

  // the whole route as one LineString feature
  asFeature() {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: this.coords },
    };
  }
}

// bounding box of a list of [lng, lat] points
export function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return [[minX, minY], [maxX, maxY]];
}
