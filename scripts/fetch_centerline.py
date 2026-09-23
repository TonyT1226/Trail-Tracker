#!/usr/bin/env python3
"""Download a trail's official centerline (and official mile markers, if it has them).

Sources (ArcGIS Online FeatureServer layers that support f=geojson, see trail_profiles.py):
  AT  - ANST_Centerline, NPS / Appalachian Trail Conservancy
  PCT - PCTA_Centerline + PCT_Mile_Markers_2026, Pacific Crest Trail Association (CC BY 4.0)
Pages through the results, since the services cap records per request.

Usage:
    python scripts/fetch_centerline.py                # -> data/raw/AT/centerline.geojson
    python scripts/fetch_centerline.py --trail PCT    # -> data/raw/PCT/centerline.geojson
                                                      #    + data/raw/PCT/mile_markers.json
    python scripts/fetch_centerline.py -o other.geojson

If this fails (network, service moved), open the URL printed by --print-url in a browser
and save the page as data/raw/<trail>/centerline.geojson instead.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

from atlib import write_json
from trail_profiles import add_trail_arg, get_profile

PAGE = 1000


def query_url(layer, offset=0, count=PAGE):
    params = {
        "where": "1=1",
        "outFields": "*",
        "outSR": 4326,
        "f": "geojson",
        "orderByFields": "OBJECTID",
        "resultOffset": offset,
        "resultRecordCount": count,
    }
    return layer + "?" + urllib.parse.urlencode(params)


def get_json(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": "at-tracker/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - network errors vary
            if attempt == retries - 1:
                raise
            print(f"  retrying after error: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def fetch_all(layer):
    """Every feature in the layer, as GeoJSON features (raises on a service error)."""
    features, offset = [], 0
    while True:
        page = get_json(query_url(layer, offset))
        if "error" in page:
            raise RuntimeError(f"service error: {page['error']}")
        got = page.get("features", [])
        features.extend(got)
        print(f"fetched {len(features)} features")
        more = (len(got) >= PAGE or page.get("exceededTransferLimit")
                or (page.get("properties") or {}).get("exceededTransferLimit"))
        if not got or not more:
            return features
        offset += len(got)


def markers_to_calibration(features, trail_id):
    """Mile-marker points -> build_route.py's calibration format [{name, lat, lon, mile}]."""
    out = []
    for ft in features:
        geom = ft.get("geometry") or {}
        props = ft.get("properties") or {}
        mile = props.get("Mile", props.get("mile"))
        if geom.get("type") != "Point" or mile is None:
            continue
        lon, lat = geom["coordinates"][:2]
        out.append({"name": f"{trail_id} mile {float(mile):g}", "lat": round(lat, 6),
                    "lon": round(lon, 6), "mile": float(mile)})
    return sorted(out, key=lambda c: c["mile"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_trail_arg(ap)
    ap.add_argument("-o", "--output", help="default: data/raw/<trail>/centerline.geojson")
    ap.add_argument("--print-url", action="store_true", help="print the first-page URL and exit")
    args = ap.parse_args()
    profile = get_profile(args.trail)
    output = args.output or profile.raw("centerline.geojson")
    if args.print_url:
        print(query_url(profile.centerline_url))
        return 0

    try:
        features = fetch_all(profile.centerline_url)
        if not features:
            print("no features returned", file=sys.stderr)
            return 2
        size = write_json(output, {"type": "FeatureCollection", "features": features})
        print(f"wrote {output} ({size / 1024 / 1024:.1f} MB)")

        if profile.markers_url:
            markers = markers_to_calibration(fetch_all(profile.markers_url), profile.id)
            path = profile.raw("mile_markers.json")
            write_json(path, markers, indent=0)
            print(f"wrote {path} ({len(markers)} official mile markers, "
                  f"{markers[0]['mile']:g} to {markers[-1]['mile']:g})")
    except RuntimeError as e:
        print(e, file=sys.stderr)
        return 2
    print(f"next: python scripts/build_route.py --trail {profile.id}", output, "--inspect")
    return 0


if __name__ == "__main__":
    sys.exit(main())
