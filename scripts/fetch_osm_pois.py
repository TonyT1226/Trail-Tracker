#!/usr/bin/env python3
"""Fetch shelters, campsites, mountain gaps and towns near the route from OpenStreetMap.

Queries the Overpass API in small bounding boxes along data/trails/AT/route.json (one box per
~40 route miles) so no single request is heavy. Output is a GeoJSON of points carrying
the raw OSM tags; build_anchors.py then snaps them to the route and filters them.

Usage:
    python scripts/fetch_osm_pois.py                 # -> data/raw/osm_pois.geojson
    python scripts/fetch_osm_pois.py --dry-run       # print the first query only

Data (c) OpenStreetMap contributors, ODbL.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

from atlib import load_route, write_json

ENDPOINT = "https://overpass-api.de/api/interpreter"
PAD_DEG = 0.06   # ~4-5 miles around the route so off-trail towns are included


def chunk_bboxes(coords, miles, chunk_mi=40.0):
    """Split the route into ~chunk_mi pieces and return padded (south, west, north, east) boxes."""
    boxes, start = [], 0
    for i in range(1, len(miles)):
        if miles[i] - miles[start] >= chunk_mi or i == len(miles) - 1:
            seg = coords[start:i + 1]
            lons, lats = seg[:, 0], seg[:, 1]
            boxes.append((float(lats.min() - PAD_DEG), float(lons.min() - PAD_DEG),
                          float(lats.max() + PAD_DEG), float(lons.max() + PAD_DEG)))
            start = i
    return boxes


def build_query(bbox):
    s, w, n, e = bbox
    box = f"({s:.5f},{w:.5f},{n:.5f},{e:.5f})"
    return f"""[out:json][timeout:120];
(
  node["tourism"="wilderness_hut"]["name"]{box};
  node["amenity"="shelter"]["name"]{box};
  node["tourism"="camp_site"]["name"]{box};
  node["mountain_pass"="yes"]["name"]{box};
  node["natural"="saddle"]["name"]{box};
);
out body;"""


def post(query, retries=4):
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(ENDPOINT, data=data, headers={"User-Agent": "at-tracker/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            wait = 10 * (attempt + 1)
            print(f"  error ({e}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--route", default="data/trails/AT/route.json")
    ap.add_argument("-o", "--output", default="data/raw/osm_pois.geojson")
    ap.add_argument("--chunk-miles", type=float, default=40.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    _, coords, miles = load_route(args.route)
    boxes = chunk_bboxes(coords, miles, args.chunk_miles)
    print(f"{len(boxes)} bounding boxes along the route")
    if args.dry_run:
        print(build_query(boxes[0]))
        return 0

    seen, features = set(), []
    for k, bbox in enumerate(boxes, 1):
        result = post(build_query(bbox))
        for el in result.get("elements", []):
            if el.get("type") != "node" or el["id"] in seen:
                continue
            seen.add(el["id"])
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]},
                "properties": {**el.get("tags", {}), "osm_id": el["id"]},
            })
        print(f"  box {k}/{len(boxes)}: {len(features)} places so far")
        time.sleep(2)   # be polite to the public Overpass server

    size = write_json(args.output, {"type": "FeatureCollection", "features": features})
    print(f"wrote {args.output} ({size / 1024:.0f} KB)")
    print("next: python scripts/build_anchors.py", args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
