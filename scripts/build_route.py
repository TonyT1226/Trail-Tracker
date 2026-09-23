#!/usr/bin/env python3
"""Build data/trails/<trail>/route.json from a raw centerline GeoJSON.

Pipeline: read LineStrings -> merge/chain into ONE south->north path ->
stamp cumulative miles (scaled to the official length, or calibrated against
official mile markers) -> simplify -> write compact JSON.

Usage:
    python scripts/build_route.py data/raw/AT/centerline_ordered.geojson --inspect
    python scripts/build_route.py data/raw/AT/centerline_ordered.geojson          # -> data/trails/AT/route.json
    python scripts/build_route.py --trail PCT data/raw/PCT/centerline.geojson     # uses data/raw/PCT/mile_markers.json if present
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter

import numpy as np
from shapely.geometry import MultiLineString
from shapely.ops import linemerge

from atlib import PipelineError, cumulative_miles, haversine_mi, snap, to_local_m, write_json
from trail_profiles import AT, add_trail_arg, get_profile

OFFICIAL_MILES_2026 = AT.official_miles   # kept for make_placeholder.py


# ---------------------------------------------------------------- reading

def load_features(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    kind = data.get("type")
    if kind == "FeatureCollection":
        return data["features"]
    if kind == "Feature":
        return [data]
    return [{"type": "Feature", "geometry": data, "properties": {}}]


def extract_lines(features):
    """All LineString parts as lists of (lon, lat); returns (lines, skipped_count)."""
    lines, skipped = [], 0
    for ft in features:
        geom = ft.get("geometry")
        if not geom:
            skipped += 1
            continue
        if geom["type"] == "LineString":
            parts = [geom["coordinates"]]
        elif geom["type"] == "MultiLineString":
            parts = geom["coordinates"]
        else:
            skipped += 1
            continue
        for part in parts:
            pts = [(c[0], c[1]) for c in part]
            if not pts:
                continue
            dedup = [pts[0]] + [q for p, q in zip(pts, pts[1:]) if q != p]
            if len(dedup) >= 2:
                lines.append(dedup)
    return lines, skipped


def inspect(features):
    types = Counter((f.get("geometry") or {}).get("type") for f in features)
    print(f"features: {len(features)}   geometry types: {dict(types)}")
    keys = {}
    for f in features:
        for k, v in (f.get("properties") or {}).items():
            keys.setdefault(k, Counter())[str(v)] += 1
    for k, c in keys.items():
        common = ", ".join(f"{v}x{n}" for v, n in c.most_common(4))
        print(f"  {k}: {len(c)} distinct values, e.g. {common}")
    lines, _ = extract_lines(features)
    total = sum(float(cumulative_miles(l)[-1]) for l in lines)
    print(f"total line length: {total:.1f} mi across {len(lines)} parts")


# ---------------------------------------------------------------- ordering

def merge_lines(lines):
    merged = linemerge(MultiLineString(lines))
    if merged.geom_type == "LineString":
        return [list(merged.coords)]
    return [list(g.coords) for g in merged.geoms]


def chain(parts, start=AT.start):
    """Chain parts into one path starting at `start` (lon, lat). Returns (coords, jumps).

    jumps = [(distance_mi, position_index_in_output, (lon, lat))] for places where
    consecutive parts did not touch and had to be joined with a straight line.
    """
    def dist(p, q):
        return haversine_mi(p[0], p[1], q[0], q[1])

    remaining = list(range(len(parts)))
    best = None
    for i in remaining:
        for rev in (False, True):
            end = parts[i][-1] if rev else parts[i][0]
            d = dist(end, start)
            if best is None or d < best[0]:
                best = (d, i, rev)
    _, i, rev = best
    cur = list(parts[i][::-1] if rev else parts[i])
    remaining.remove(i)

    jumps = []
    while remaining:
        tail = cur[-1]
        best = None
        for j in remaining:
            for rev in (False, True):
                head = parts[j][-1] if rev else parts[j][0]
                d = dist(tail, head)
                if best is None or d < best[0]:
                    best = (d, j, rev)
        d, j, rev = best
        seg = list(parts[j][::-1] if rev else parts[j])
        if d > 1e-6:
            jumps.append((d, len(cur), tail))
            cur.extend(seg)
        else:
            cur.extend(seg[1:])
        remaining.remove(j)
    return cur, jumps


# ---------------------------------------------------------------- simplify

def rdp_indices(xy, tol):
    """Ramer-Douglas-Peucker on projected points; returns indices of kept vertices."""
    n = len(xy)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = xy[i], xy[j]
        ab = b - a
        denom = float(ab @ ab)
        pts = xy[i + 1:j]
        if denom == 0:
            d = np.hypot(*(pts - a).T)
        else:
            t = np.clip(((pts - a) @ ab) / denom, 0.0, 1.0)
            proj = a + t[:, None] * ab
            d = np.hypot(*(pts - proj).T)
        k = int(np.argmax(d))
        if d[k] > tol:
            idx = i + 1 + k
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return np.nonzero(keep)[0]


# ---------------------------------------------------------------- calibration

CAL_WINDOW_MI = 25.0   # search this far (raw miles) either side of where a marker should be
CAL_MAX_OFF_MI = 0.5   # markers farther than this from the line are ignored


def calibrate(coords, raw_miles, cal_points, official_total, log=print):
    """Piecewise-linear map from raw geometric miles to official miles.

    Each marker is first snapped within a window around where its official mile says
    it should be -- fast on long routes, and it keeps a marker from snapping onto a
    far part of the trail that happens to pass close by -- and only searched for along
    the whole route if it isn't found there.
    """
    coords = np.asarray(coords, dtype=float)
    raw_total = float(raw_miles[-1])
    ratio = raw_total / official_total
    xs, ys = [0.0], [0.0]
    pts, far = [], 0
    for c in cal_points:
        guess = float(c["mile"]) * ratio
        lo = max(int(np.searchsorted(raw_miles, guess - CAL_WINDOW_MI)) - 1, 0)
        hi = min(int(np.searchsorted(raw_miles, guess + CAL_WINDOW_MI)) + 1, len(raw_miles))
        r, off = (snap(coords[lo:hi], raw_miles[lo:hi], c["lon"], c["lat"])
                  if hi - lo >= 2 else (0.0, float("inf")))
        if off > CAL_MAX_OFF_MI:   # not where the scale says it should be -- look everywhere
            r, off = snap(coords, raw_miles, c["lon"], c["lat"])
        if off > CAL_MAX_OFF_MI:
            far += 1
            log(f"  skipped calibration point {c.get('name', c)!r}: {off:.2f} mi from the route")
            continue
        pts.append((r, float(c["mile"]), c.get("name", "")))
    if far:
        log(f"  {far} calibration points were too far from the route")
    for r, m, name in sorted(pts):
        if r <= xs[-1] or m <= ys[-1] or r >= raw_total or m >= official_total:
            log(f"  skipped calibration point {name!r}: not increasing / out of range")
            continue
        xs.append(r)
        ys.append(m)
    xs.append(raw_total)
    ys.append(float(official_total))
    return np.interp(raw_miles, xs, ys)


# ---------------------------------------------------------------- main build

def build_route(features, official_miles=OFFICIAL_MILES_2026, tolerance_m=15.0,
                cal_points=None, source="", placeholder=False, force=False, log=print, profile=AT):
    lines, skipped = extract_lines(features)
    if not lines:
        raise PipelineError("No LineString geometry found in the input.")
    parts = merge_lines(lines)
    coords, jumps = chain(parts, profile.start)
    raw = cumulative_miles(coords)
    raw_total = float(raw[-1])
    log(f"input: {len(lines)} line parts -> {len(parts)} after merging "
        f"({skipped} non-line features skipped); raw length {raw_total:.1f} mi")

    big = [j for j in jumps if j[0] > 0.05]
    for d, idx, pt in sorted(jumps, reverse=True)[:5]:
        mile = raw[min(idx, len(raw) - 1)]
        log(f"  gap of {d:.3f} mi near raw mile {mile:.1f} at lon/lat {pt[0]:.4f}, {pt[1]:.4f}")

    problems = []
    d0 = haversine_mi(*coords[0], *profile.start)
    d1 = haversine_mi(*coords[-1], *profile.end)
    if d0 > 3:
        problems.append(f"route does not start at the {profile.start_name} (off by {d0:.1f} mi)")
    if d1 > 3:
        problems.append(f"route does not end at the {profile.end_name} (off by {d1:.1f} mi)")
    if big:
        problems.append(f"{len(big)} gaps longer than 0.05 mi were bridged with straight lines")
    if official_miles and abs(raw_total / official_miles - 1) > 0.02:
        problems.append(f"raw length {raw_total:.1f} mi differs from official {official_miles} mi by more than 2%"
                        " (side trails mixed in, or pieces missing?)")
    for p in problems:
        log(f"  WARNING: {p}")
    hard = [p for p in problems if "start" in p or "end at" in p]
    if hard and not force:
        raise PipelineError("; ".join(hard) + ". Re-run with --force to build anyway.")

    if cal_points:
        miles = calibrate(coords, raw, cal_points, official_miles or raw_total, log)
        log(f"calibrated against {len(cal_points)} mile markers "
            f"(overall scale {(official_miles or raw_total) / raw_total:.4f})")
    elif official_miles:
        miles = raw * (official_miles / raw_total)
        log(f"scaled by {official_miles / raw_total:.4f} to match official {official_miles} mi")
    else:
        miles = raw

    xy = to_local_m(coords, *profile.proj_center)
    keep = rdp_indices(xy, tolerance_m)
    out_coords = [[round(coords[i][0], 5), round(coords[i][1], 5)] for i in keep]
    out_miles = [round(float(miles[i]), 3) for i in keep]
    log(f"simplified {len(coords)} -> {len(keep)} vertices (tolerance {tolerance_m} m)")

    return {
        "name": profile.name,
        "source": source,
        "placeholder": bool(placeholder),
        "totalMiles": out_miles[-1],
        "coords": out_coords,
        "miles": out_miles,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="raw centerline GeoJSON")
    add_trail_arg(ap)
    ap.add_argument("-o", "--output", help="default: data/trails/<trail>/route.json")
    ap.add_argument("--official-miles", type=float,
                    help="official total length (default: the trail's current official figure); 0 keeps the raw geometric miles")
    ap.add_argument("--tolerance", type=float, default=15.0, help="simplify tolerance in metres")
    ap.add_argument("--calibration",
                    help="JSON list of {name, lat, lon, mile} official mile markers "
                         "(default: data/raw/<trail>/mile_markers.json if it exists)")
    ap.add_argument("--no-calibration", action="store_true", help="scale to the official length even if markers exist")
    ap.add_argument("--source", help="default: the trail's data source")
    ap.add_argument("--placeholder", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--inspect", action="store_true", help="just describe the input and exit")
    args = ap.parse_args()
    profile = get_profile(args.trail)
    output = args.output or profile.out("route.json")
    official = profile.official_miles if args.official_miles is None else args.official_miles
    cal_path = args.calibration
    if cal_path is None and not args.no_calibration and os.path.exists(profile.raw("mile_markers.json")):
        cal_path = profile.raw("mile_markers.json")

    try:
        features = load_features(args.input)
        if args.inspect:
            inspect(features)
            return 0
        cal = None
        if cal_path and not args.no_calibration:
            with open(cal_path, encoding="utf-8") as f:
                cal = json.load(f)
            print(f"calibrating with {cal_path}")
        route = build_route(features, official or None, args.tolerance, cal,
                            profile.source if args.source is None else args.source,
                            args.placeholder, args.force, profile=profile)
        size = write_json(output, route)
        print(f"wrote {output} ({size / 1024:.0f} KB), total {route['totalMiles']} mi")
        return 0
    except PipelineError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
