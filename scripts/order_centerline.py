#!/usr/bin/env python3
"""Turn the raw NPS/ATC ANST_Centerline GeoJSON (from fetch_centerline.py) into a
single, correctly-ordered LineString that build_route.py can consume directly.

Why this exists: the centerline layer ships as ~3000 separate small line
features (survey segments digitized over 20+ years with different GPS gear),
not one ordered path. A naive "merge touching endpoints, then greedily walk
to the nearest remaining piece" approach (which is what a first cut at this
problem tends to look like) fails on real data: as-built segments that should
be continuous often have tiny (a few metres to a few dozen metres) gaps
between them because they were surveyed separately, so exact-endpoint merging
leaves hundreds of fragments, and pure nearest-neighbor walking among those
fragments gets fooled into leaving a stray fragment unconsumed until the very
end -- producing a wildly inflated, wrongly-shaped path (in testing: 3049 mi
instead of ~2160, ending 890 mi from Katahdin).

This script fixes that in three steps:
  1. Drop named side/alternate trails that share the ANST layer (Bartram Trail,
     Benton MacKaye Trail, road walks tagged with a non-"NA" Alt_Name, etc).
  2. Fuzzy-merge: union-find any two segment endpoints within FUZZ_MI of each
     other (not just exact matches), then walk each resulting simple chain
     (degree-2 path) into one line. This collapses ~2990 raw parts to a
     couple hundred long chains, preserving total length exactly (no segment
     is walked twice).
  3. Order those chains south-to-north by projecting onto the Springer <->
     Katahdin axis, greedily connecting nearest remaining chain to chain,
     with a projection-based fallback if a connection would exceed
     MAX_JUMP_MI (this only ever fires on truly orphaned zero-length survey
     artifacts, which are dropped before ordering anyway).

Usage:
    python scripts/order_centerline.py data/raw/centerline.geojson
    python scripts/build_route.py data/raw/centerline_ordered.geojson -o data/trails/AT/route.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict

sys.path.insert(0, "scripts")
from build_route import merge_lines  # noqa: E402
from atlib import KATAHDIN, PipelineError, SPRINGER, cumulative_miles, haversine_mi, write_json  # noqa: E402

FUZZ_MI = 0.05          # ~80 m; endpoints closer than this are treated as touching
MAX_JUMP_MI = 15.0      # a real connector gap should never be bigger than this
MIN_CHAIN_MI = 0.01     # drop degenerate (near-zero-length) survey artifacts

LON0 = (SPRINGER[0] + KATAHDIN[0]) / 2
LAT0 = (SPRINGER[1] + KATAHDIN[1]) / 2
M_PER_DEG = 111_320.0


def _to_xy(lon, lat):
    x = (lon - LON0) * math.cos(math.radians(LAT0)) * M_PER_DEG
    y = (lat - LAT0) * M_PER_DEG
    return x, y


_sx, _sy = _to_xy(*SPRINGER)
_kx, _ky = _to_xy(*KATAHDIN)
_dx, _dy = _kx - _sx, _ky - _sy
_norm = math.hypot(_dx, _dy)
_ux, _uy = _dx / _norm, _dy / _norm


def _proj(lon, lat):
    x, y = _to_xy(lon, lat)
    return (x - _sx) * _ux + (y - _sy) * _uy


def _dist(p, q):
    return haversine_mi(p[0], p[1], q[0], q[1])


class _UnionFind:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def extract_parts(features, drop_alt_names=True):
    """One coordinate-list per LineString/MultiLineString part. Optionally drops
    parts whose Alt_Name marks them as a named side trail rather than the
    through-route (the ANST layer stores both in the same layer)."""
    parts, dropped = [], 0
    for ft in features:
        props = ft.get("properties") or {}
        if drop_alt_names and (props.get("Alt_Name") or "NA") != "NA":
            dropped += 1
            continue
        geom = ft.get("geometry") or {}
        if geom.get("type") == "LineString":
            candidates = [geom["coordinates"]]
        elif geom.get("type") == "MultiLineString":
            candidates = geom["coordinates"]
        else:
            continue
        for part in candidates:
            pts = [(c[0], c[1]) for c in part]
            dedup = [pts[0]] + [q for p, q in zip(pts, pts[1:]) if q != p]
            if len(dedup) >= 2:
                parts.append(dedup)
    return parts, dropped


def fuzzy_merge(parts, fuzz_mi=FUZZ_MI, log=print):
    """Union-find endpoints within fuzz_mi of each other, then walk each simple
    (degree-2) chain into one merged line. Never merges a part's own two ends
    with each other, and only walks through a merge-group that has exactly two
    members (an unambiguous single connection) -- a group with 3+ members is a
    real junction or an ambiguous coincidence, and is left as a chain boundary
    rather than guessed at."""
    n = len(parts)
    endpoints = []
    for p in parts:
        endpoints.append(p[0])
        endpoints.append(p[-1])

    cell = 0.02  # ~1.3 mi grid cells for a coarse spatial hash
    grid = defaultdict(list)
    for idx, (lon, lat) in enumerate(endpoints):
        grid[(round(lon / cell), round(lat / cell))].append(idx)

    uf = _UnionFind(2 * n)
    for idx, (lon, lat) in enumerate(endpoints):
        cx, cy = round(lon / cell), round(lat / cell)
        part_i = idx // 2
        for dxg in (-1, 0, 1):
            for dyg in (-1, 0, 1):
                for j in grid.get((cx + dxg, cy + dyg), []):
                    if j <= idx or j // 2 == part_i:
                        continue
                    if haversine_mi(lon, lat, *endpoints[j]) <= fuzz_mi:
                        uf.union(idx, j)

    groups = defaultdict(list)
    for idx in range(2 * n):
        groups[uf.find(idx)].append(idx)

    def safe_partner(idx):
        group = groups[uf.find(idx)]
        if len(group) != 2:
            return None
        other = group[0] if group[1] == idx else group[1]
        return None if other // 2 == idx // 2 else other

    used = [False] * n
    chains = []
    for i in range(n):
        if used[i] or safe_partner(2 * i) is not None:
            continue  # something safely precedes this part's start; not a chain head
        seq, used[i] = [(i, False)], True
        cur_end = 2 * i + 1
        while True:
            link = safe_partner(cur_end)
            if link is None or used[link // 2]:
                break
            nj, rev = link // 2, (link % 2 == 1)
            seq.append((nj, rev))
            used[nj] = True
            cur_end = 2 * nj + (0 if rev else 1)
        chains.append(seq)
    for i in range(n):  # leftover cycles, if any
        if not used[i]:
            chains.append([(i, False)])
            used[i] = True

    merged = []
    for seq in chains:
        coords = []
        for idx, rev in seq:
            pts = list(reversed(parts[idx])) if rev else list(parts[idx])
            coords.extend(pts[1:] if coords and coords[-1] == pts[0] else pts)
        merged.append(coords)

    total_before = sum(cumulative_miles(p)[-1] for p in parts)
    total_after = sum(cumulative_miles(c)[-1] for c in merged)
    log(f"fuzzy-merged {n} parts -> {len(merged)} chains "
        f"({total_before:.1f} mi -> {total_after:.1f} mi, should match)")
    return merged


def order_chains(chains, log=print):
    """Orient each chain along the Springer->Katahdin axis, drop degenerate
    zero-length chains, then greedily connect nearest remaining chain to
    chain, starting at Springer. Falls back to the chain nearest in axis
    projection if the true nearest is implausibly far (only ever needed for
    stray artifacts, which MIN_CHAIN_MI already filters out)."""
    kept = [c for c in chains if cumulative_miles(c)[-1] > MIN_CHAIN_MI]
    if len(kept) < len(chains):
        log(f"dropped {len(chains) - len(kept)} near-zero-length chain fragments")

    oriented = []
    for c in kept:
        t0, t1 = _proj(*c[0]), _proj(*c[-1])
        if t0 > t1:
            c, t0, t1 = list(reversed(c)), t1, t0
        oriented.append({"t0": t0, "t1": t1, "coords": c})

    remaining = set(range(len(oriented)))
    start = min(remaining, key=lambda i: min(_dist(oriented[i]["coords"][0], SPRINGER),
                                              _dist(oriented[i]["coords"][-1], SPRINGER)))
    c0 = oriented[start]["coords"]
    if _dist(c0[-1], SPRINGER) < _dist(c0[0], SPRINGER):
        c0 = list(reversed(c0))
    result = list(c0)
    remaining.remove(start)
    jumps = []

    while remaining:
        tail = result[-1]
        d, j, rev = min(
            ((min(_dist(tail, oriented[i]["coords"][0]), _dist(tail, oriented[i]["coords"][-1])), i,
              _dist(tail, oriented[i]["coords"][-1]) < _dist(tail, oriented[i]["coords"][0]))
             for i in remaining),
            key=lambda t: t[0],
        )
        if d > MAX_JUMP_MI:
            j = min(remaining, key=lambda i: abs((oriented[i]["t0"] + oriented[i]["t1"]) / 2 - _proj(*tail)))
            co = oriented[j]["coords"]
            d_fwd, d_rev = _dist(tail, co[0]), _dist(tail, co[-1])
            rev, d = d_rev < d_fwd, min(d_fwd, d_rev)
            log(f"  warning: no nearby chain found near {tail}; falling back to axis order (gap {d:.1f} mi)")
        co = oriented[j]["coords"]
        if d > 0.3:
            jumps.append(d)
        result.extend(list(reversed(co)) if rev else co)
        remaining.remove(j)

    return result, jumps


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="raw centerline GeoJSON from fetch_centerline.py")
    ap.add_argument("-o", "--output", default="data/raw/centerline_ordered.geojson")
    ap.add_argument("--keep-alt-names", action="store_true",
                    help="don't drop side/alternate trails sharing the ANST layer")
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"] if data.get("type") == "FeatureCollection" else [data]

    parts, dropped = extract_parts(features, drop_alt_names=not args.keep_alt_names)
    if dropped:
        print(f"dropped {dropped} side/alternate-trail features (non-'NA' Alt_Name)")
    if not parts:
        raise PipelineError("no usable LineString geometry found")

    # First pass: shapely's exact-endpoint merge collapses the ~3000 raw survey
    # segments to a few hundred parts wherever they touch precisely. This matters
    # because it reduces the number of distinct endpoints BEFORE fuzzy-matching,
    # which avoids spurious 3-way coincidences (a real junction plus an unrelated
    # nearby point both within FUZZ_MI) that would otherwise block the fuzzy pass
    # from walking through an ordinary pass-through connection.
    exact_merged = merge_lines(parts)
    print(f"exact-endpoint merge: {len(parts)} parts -> {len(exact_merged)}")
    chains = fuzzy_merge(exact_merged)
    result, jumps = order_chains(chains)

    d0 = haversine_mi(*result[0], *SPRINGER)
    d1 = haversine_mi(*result[-1], *KATAHDIN)
    total = float(cumulative_miles(result)[-1])
    print(f"ordered path: {total:.1f} mi, start {d0:.3f} mi from Springer, end {d1:.3f} mi from Katahdin")
    if jumps:
        print(f"{len(jumps)} connector gaps > 0.3 mi (real unmapped road-walks/gaps): "
              f"{[round(j, 2) for j in sorted(jumps, reverse=True)]}")
    if d0 > 1 or d1 > 1:
        print("warning: endpoint is further from the known terminus than expected; inspect the output before trusting it")

    out = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"source": "NPS ANST_Centerline, reordered by order_centerline.py"},
            "geometry": {"type": "LineString", "coordinates": [[c[0], c[1]] for c in result]},
        }],
    }
    size = write_json(args.output, out)
    print(f"wrote {args.output} ({size / 1024 / 1024:.1f} MB)")
    print("next: python scripts/build_route.py", args.output, "-o data/trails/AT/route.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
