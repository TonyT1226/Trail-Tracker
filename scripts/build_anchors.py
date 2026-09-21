#!/usr/bin/env python3
"""Build data/anchors.json (named places with mile markers) from a POI GeoJSON.

Every POI is snapped onto data/route.json, so its mile comes from the same
scale as the route (no need to type in mile markers by hand).

Usage:
    python scripts/build_anchors.py data/raw/osm_pois.geojson
"""
from __future__ import annotations

import argparse
import json
import sys

from atlib import PipelineError, load_route, snap, write_json

# how far off the trail a place may be and still count (miles)
MAX_OFF = {"shelter": 0.6, "campsite": 0.6, "gap": 0.5}
DEDUPE_MI = 0.3


def infer_kind(props):
    """Map raw properties (OSM tags or an explicit 'kind') to one of our kinds.
    Nearby towns are intentionally not surfaced as anchors -- not something this
    app tracks, and OSM has far too many small named places within a few miles
    of the trail for that to stay readable on the map."""
    if props.get("kind"):
        return props["kind"]
    if props.get("tourism") == "wilderness_hut" or props.get("amenity") == "shelter" or props.get("shelter_type"):
        return "shelter"
    if props.get("tourism") == "camp_site":
        return "campsite"
    if props.get("mountain_pass") == "yes" or props.get("natural") == "saddle":
        return "gap"
    return None


def build_anchors(pois, route_path, log=print):
    route, coords, miles = load_route(route_path)
    total = float(miles[-1])
    found = []
    dropped = {"no_name": 0, "no_kind": 0, "too_far": 0, "not_point": 0}

    for ft in pois:
        geom = ft.get("geometry") or {}
        props = ft.get("properties") or {}
        if geom.get("type") != "Point":
            dropped["not_point"] += 1
            continue
        name = (props.get("name") or "").strip()
        if not name:
            dropped["no_name"] += 1
            continue
        if name.isdigit():
            dropped["no_name"] += 1
            continue
        kind = infer_kind(props)
        if kind is None:
            dropped["no_kind"] += 1
            continue
        lon, lat = geom["coordinates"][:2]
        mile, off = snap(coords, miles, lon, lat)
        if off > MAX_OFF.get(kind, 0.6):
            dropped["too_far"] += 1
            continue
        found.append({"name": name, "kind": kind, "mile": round(mile, 3),
                      "lat": round(lat, 5), "lon": round(lon, 5), "off": round(off, 2)})

    # same name + kind within DEDUPE_MI of each other -> keep the one closest to the trail
    found.sort(key=lambda a: (a["name"].lower(), a["kind"], a["mile"]))
    deduped = []
    for a in found:
        prev = deduped[-1] if deduped else None
        if prev and prev["name"].lower() == a["name"].lower() and prev["kind"] == a["kind"] \
                and abs(prev["mile"] - a["mile"]) < DEDUPE_MI:
            if a["off"] < prev["off"]:
                deduped[-1] = a
            continue
        deduped.append(a)

    # termini are always present and pinned to the ends of the route
    termini = [
        {"name": "Springer Mountain", "kind": "terminus", "mile": 0.0,
         "lat": round(coords[0][1], 5), "lon": round(coords[0][0], 5), "off": 0.0},
        {"name": "Mount Katahdin", "kind": "terminus", "mile": round(total, 3),
         "lat": round(coords[-1][1], 5), "lon": round(coords[-1][0], 5), "off": 0.0},
    ]
    anchors = sorted(termini + [a for a in deduped if a["kind"] != "terminus"], key=lambda a: a["mile"])
    log(f"{len(anchors)} anchors kept; dropped: {dropped}")
    return {"anchors": anchors}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pois", help="GeoJSON of points (OSM tags or an explicit 'kind' property)")
    ap.add_argument("--route", default="data/route.json")
    ap.add_argument("-o", "--output", default="data/anchors.json")
    args = ap.parse_args()
    try:
        with open(args.pois, encoding="utf-8") as f:
            data = json.load(f)
        out = build_anchors(data.get("features", []), args.route)
        size = write_json(args.output, out)
        print(f"wrote {args.output} ({size / 1024:.0f} KB)")
        return 0
    except PipelineError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
