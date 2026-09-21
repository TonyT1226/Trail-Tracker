#!/usr/bin/env python3
"""Work out which state each mile of the route is in, and extract state borders.

Inputs : a US state boundary file (Census cartographic boundary, .zip/.shp/.geojson)
         and data/route.json
Outputs: data/states.json          state -> mile ranges (used for per-state progress)
         data/state_borders.geojson dashed border lines between states (drawn on the map)

Where the trail hugs a state line (Smokies on the NC/TN line, parts of VA/WV) the
state can flip back and forth; the split there is only as accurate as the boundary
file. The web app can merge such states (see stateGroups in js/config.js).

Usage:
    python scripts/build_states.py data/raw/cb_2023_us_state_500k.zip
"""
from __future__ import annotations

import argparse
import json
import sys

from shapely.geometry import LineString, MultiLineString, Point, mapping, shape
from shapely.ops import linemerge
from shapely.prepared import prep

from atlib import AT_STATES, PipelineError, load_route, write_json

NAME_TO_CODE = {name: code for code, name in AT_STATES}
ABBR_KEYS = ("STUSPS", "STATE_ABBR", "stusps", "postal", "abbr", "code")
NAME_KEYS = ("NAME", "name", "STATE_NAME")


# ---------------------------------------------------------------- reading

def read_shapes(path):
    low = path.lower()
    if low.endswith((".zip", ".shp")):
        import shapefile  # pyshp
        sf = shapefile.Reader(path)
        for sr in sf.shapeRecords():
            yield sr.record.as_dict(), shape(sr.shape.__geo_interface__)
    else:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for ft in data["features"]:
            yield ft.get("properties") or {}, shape(ft["geometry"])


def state_code(props):
    for k in ABBR_KEYS:
        v = props.get(k)
        if isinstance(v, str) and len(v) == 2 and v.isalpha():
            return v.upper()
    for k in NAME_KEYS:
        v = props.get(k)
        if isinstance(v, str) and v in NAME_TO_CODE:
            return NAME_TO_CODE[v]
    return None


def load_states(path):
    shapes = {}
    for props, geom in read_shapes(path):
        code = state_code(props)
        if code:
            shapes[code] = geom
    missing = [c for c, _ in AT_STATES if c not in shapes]
    if missing:
        raise PipelineError(f"boundary file is missing AT states: {', '.join(missing)}")
    return shapes


# ---------------------------------------------------------------- locating

class StateLocator:
    """Which of the 14 AT states contains a point (nearest state if it falls in none)."""

    def __init__(self, shapes):
        self.items = [(c, prep(shapes[c]), shapes[c]) for c, _ in AT_STATES if c in shapes]
        self.last = 0

    def __call__(self, lonlat):
        pt = Point(lonlat)
        if self.items[self.last][1].contains(pt):
            return self.items[self.last][0]
        for i, (code, pg, _) in enumerate(self.items):
            if pg.contains(pt):
                self.last = i
                return code
        return min(self.items, key=lambda it: it[2].distance(pt))[0]


def crossing(pa, pb, state_a, locate):
    """Fraction t in [0,1] along pa->pb where the state stops being state_a."""
    lo, hi = 0.0, 1.0
    for _ in range(30):
        mid = (lo + hi) / 2
        p = (pa[0] + (pb[0] - pa[0]) * mid, pa[1] + (pb[1] - pa[1]) * mid)
        if locate(p) == state_a:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def compute_runs(coords, miles, locate):
    states = [locate((float(c[0]), float(c[1]))) for c in coords]
    runs, cur, start = [], states[0], float(miles[0])
    for i in range(len(coords) - 1):
        if states[i] != states[i + 1]:
            t = crossing(coords[i], coords[i + 1], states[i], locate)
            m = float(miles[i] + t * (miles[i + 1] - miles[i]))
            runs.append([cur, start, m])
            cur, start = states[i + 1], m
    runs.append([cur, start, float(miles[-1])])
    return runs


def merge_adjacent(runs):
    out = []
    for r in runs:
        if out and out[-1][0] == r[0]:
            out[-1][2] = r[2]
        else:
            out.append(list(r))
    return out


def smooth(runs, min_len):
    """Absorb tiny runs sandwiched between two runs of the same state (boundary noise)."""
    runs = merge_adjacent(runs)
    while True:
        changed = False
        for i in range(1, len(runs) - 1):
            if runs[i][2] - runs[i][1] < min_len and runs[i - 1][0] == runs[i + 1][0]:
                runs[i][0] = runs[i - 1][0]
                changed = True
        runs = merge_adjacent(runs)
        if not changed:
            return runs


def build_state_ranges(coords, miles, shapes, min_run=0.1, log=print):
    runs = smooth(compute_runs(coords, miles, StateLocator(shapes)), min_run)
    out = {}
    for code, name in AT_STATES:
        ranges = [[round(a, 3), round(b, 3)] for c, a, b in runs if c == code]
        if ranges:
            out[code] = {"name": name, "ranges": ranges,
                         "total": round(sum(b - a for a, b in ranges), 2)}
    log("state       miles   ranges")
    for code, s in out.items():
        log(f"  {code}   {s['total']:8.1f}   {len(s['ranges'])}")
    log(f"  sum {sum(s['total'] for s in out.values()):8.1f}  (route length {miles[-1]:.1f})")
    return {"order": [c for c, _ in AT_STATES if c in out], "states": out}


# ---------------------------------------------------------------- borders

def _line_parts(geom):
    if geom.is_empty:
        return
    if isinstance(geom, LineString):
        yield geom
    elif hasattr(geom, "geoms"):
        for g in geom.geoms:
            yield from _line_parts(g)


def _round(obj, nd=4):
    if isinstance(obj, (list, tuple)):
        return [_round(x, nd) for x in obj]
    if isinstance(obj, float):
        return round(obj, nd)
    return obj


def build_borders(shapes, simplify_deg=0.002):
    """Lines shared between an AT state and any neighbour (no coastlines)."""
    at_all = [c for c, _ in AT_STATES]
    lines = []
    for a in (c for c in at_all if c in shapes):
        for b in sorted(shapes):
            if b == a or (b in at_all and b < a):
                continue
            if not shapes[a].intersects(shapes[b]):
                continue
            lines.extend(_line_parts(shapes[a].boundary.intersection(shapes[b].boundary)))
    if not lines:
        return None
    merged = linemerge(MultiLineString(lines)).simplify(simplify_deg)
    geom = mapping(merged)
    geom["coordinates"] = _round(geom["coordinates"])
    return {"type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {}, "geometry": geom}]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("states", help="state boundary file (.zip/.shp/.geojson)")
    ap.add_argument("--route", default="data/route.json")
    ap.add_argument("--out-states", default="data/states.json")
    ap.add_argument("--out-borders", default="data/state_borders.geojson")
    ap.add_argument("--min-run", type=float, default=0.1,
                    help="absorb same-state flips shorter than this many miles (default 0.1)")
    args = ap.parse_args()
    try:
        _, coords, miles = load_route(args.route)
        shapes = load_states(args.states)
        result = build_state_ranges(coords, miles, shapes, args.min_run)
        write_json(args.out_states, result)
        print(f"wrote {args.out_states}")
        borders = build_borders(shapes)
        if borders:
            size = write_json(args.out_borders, borders)
            print(f"wrote {args.out_borders} ({size / 1024:.0f} KB)")
        else:
            print("warning: no shared borders found; the map will use Mapbox's own state lines")
        return 0
    except PipelineError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
