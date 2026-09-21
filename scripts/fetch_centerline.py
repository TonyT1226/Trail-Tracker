#!/usr/bin/env python3
"""Download the official A.T. centerline (NPS / ATC) as GeoJSON.

Source layer: ANST_Centerline FeatureServer (ArcGIS Online), which supports f=geojson.
Pages through the results, since the service caps records per request.

Usage:
    python scripts/fetch_centerline.py                # -> data/raw/centerline.geojson
    python scripts/fetch_centerline.py -o other.geojson

If this fails (network, service moved), open the URL printed by --print-url in a browser
and save the page as data/raw/centerline.geojson instead.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

from atlib import write_json

LAYER = "https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/ANST_Centerline/FeatureServer/0/query"
PAGE = 1000


def query_url(offset=0, count=PAGE):
    params = {
        "where": "1=1",
        "outFields": "*",
        "outSR": 4326,
        "f": "geojson",
        "orderByFields": "OBJECTID",
        "resultOffset": offset,
        "resultRecordCount": count,
    }
    return LAYER + "?" + urllib.parse.urlencode(params)


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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", default="data/raw/centerline.geojson")
    ap.add_argument("--print-url", action="store_true", help="print the first-page URL and exit")
    args = ap.parse_args()
    if args.print_url:
        print(query_url())
        return 0

    features, offset = [], 0
    while True:
        page = get_json(query_url(offset))
        if "error" in page:
            print(f"service error: {page['error']}", file=sys.stderr)
            return 2
        got = page.get("features", [])
        features.extend(got)
        print(f"fetched {len(features)} features")
        more = (len(got) >= PAGE or page.get("exceededTransferLimit")
                or (page.get("properties") or {}).get("exceededTransferLimit"))
        if not got or not more:
            break
        offset += len(got)

    if not features:
        print("no features returned", file=sys.stderr)
        return 2
    size = write_json(args.output, {"type": "FeatureCollection", "features": features})
    print(f"wrote {args.output} ({size / 1024 / 1024:.1f} MB)")
    print("next: python scripts/build_route.py", args.output, "--inspect")
    return 0


if __name__ == "__main__":
    sys.exit(main())
