#!/usr/bin/env python3
"""Generate PLACEHOLDER data (data/route.json, anchors.json, states.json).

The "route" is just straight lines between ~58 approximate waypoints; it is NOT the
real trail. It exists so the dashboard can be opened and tried out before the real
centerline is downloaded. route.json carries "placeholder": true and the page shows
a banner until real data replaces it.

Usage:
    python scripts/make_placeholder.py
"""
from __future__ import annotations

import json
import os
import sys

from atlib import AT_STATES, snap, write_json
from build_anchors import build_anchors
from build_route import build_route, OFFICIAL_MILES_2026

# name, lon, lat, state, kind  (approximate!)
WAYPOINTS = [
    ("Springer Mountain", -84.1938, 34.6268, "GA", "terminus"),
    ("Woody Gap", -83.9906, 34.6787, "GA", "gap"),
    ("Neels Gap", -83.9174, 34.7359, "GA", "gap"),
    ("Unicoi Gap", -83.7448, 34.8006, "GA", "gap"),
    ("Dicks Creek Gap", -83.5500, 34.9880, "GA", "gap"),
    ("Winding Stair Gap", -83.4400, 35.1600, "NC", "gap"),
    ("Wayah Bald", -83.5556, 35.1861, "NC", "gap"),
    ("Nantahala Outdoor Center", -83.5960, 35.3330, "NC", "town"),
    ("Fontana Dam", -83.8080, 35.4510, "NC", "gap"),
    ("Clingmans Dome", -83.4985, 35.5628, "TN", "gap"),
    ("Newfound Gap", -83.4250, 35.6111, "TN", "gap"),
    ("Davenport Gap", -83.1250, 35.7600, "TN", "gap"),
    ("Hot Springs", -82.8253, 35.8967, "NC", "town"),
    ("Erwin", -82.4160, 36.1450, "TN", "town"),
    ("Roan Mountain", -82.1210, 36.1050, "TN", "gap"),
    ("Watauga Lake", -81.9800, 36.3300, "TN", "gap"),
    ("Damascus", -81.7773, 36.6347, "VA", "town"),
    ("Mount Rogers", -81.5450, 36.6600, "VA", "gap"),
    ("Atkins", -81.1900, 36.8700, "VA", "town"),
    ("Pearisburg", -80.7300, 37.3270, "VA", "town"),
    ("McAfee Knob", -80.0360, 37.3930, "VA", "gap"),
    ("Daleville", -79.9370, 37.4120, "VA", "town"),
    ("Glasgow", -79.4000, 37.6300, "VA", "town"),
    ("Waynesboro", -78.8560, 38.0360, "VA", "town"),
    ("Big Meadows", -78.4400, 38.5210, "VA", "gap"),
    ("Front Royal", -78.2000, 38.9100, "VA", "town"),
    ("Bears Den Rocks", -77.9500, 39.0800, "VA", "gap"),
    ("Harpers Ferry", -77.7311, 39.3247, "WV", "town"),
    ("Gathland State Park", -77.6300, 39.4200, "MD", "gap"),
    ("Pen Mar", -77.5000, 39.7250, "MD", "gap"),
    ("Caledonia State Park", -77.4600, 39.9000, "PA", "gap"),
    ("Boiling Springs", -77.1290, 40.1520, "PA", "town"),
    ("Duncannon", -77.0230, 40.3960, "PA", "town"),
    ("Port Clinton", -76.0400, 40.5720, "PA", "town"),
    ("Lehigh Gap", -75.6000, 40.7900, "PA", "gap"),
    ("Delaware Water Gap", -75.1400, 40.9720, "PA", "town"),
    ("High Point", -74.6600, 41.3210, "NJ", "gap"),
    ("Bear Mountain", -73.9880, 41.3120, "NY", "gap"),
    ("Pawling", -73.5900, 41.5700, "NY", "town"),
    ("Kent", -73.4780, 41.7250, "CT", "town"),
    ("Sages Ravine", -73.4370, 42.0480, "CT", "gap"),
    ("Route 23 Egremont", -73.2900, 42.1800, "MA", "gap"),
    ("Dalton", -73.1900, 42.4700, "MA", "town"),
    ("Mount Greylock", -73.1660, 42.6380, "MA", "gap"),
    ("Manchester Center", -72.9800, 43.1700, "VT", "town"),
    ("Killington Peak", -72.8200, 43.6050, "VT", "gap"),
    ("Hanover", -72.2900, 43.7000, "NH", "town"),
    ("Kinsman Notch", -71.8000, 44.1200, "NH", "gap"),
    ("Franconia Notch", -71.6800, 44.1400, "NH", "gap"),
    ("Mount Washington", -71.3050, 44.2700, "NH", "gap"),
    ("Gorham", -71.1700, 44.3900, "NH", "town"),
    ("Grafton Notch", -70.9500, 44.5800, "ME", "gap"),
    ("Rangeley", -70.6500, 44.9600, "ME", "town"),
    ("Sugarloaf", -70.3100, 45.0300, "ME", "gap"),
    ("Caratunk", -69.9800, 45.2300, "ME", "town"),
    ("Monson", -69.5000, 45.3000, "ME", "town"),
    ("Abol Bridge", -69.0400, 45.8800, "ME", "gap"),
    ("Mount Katahdin", -68.9214, 45.9044, "ME", "terminus"),
]

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def main():
    raw_dir = os.path.join(DATA, "raw")
    coords = [[w[1], w[2]] for w in WAYPOINTS]
    raw = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"note": "placeholder"},
         "geometry": {"type": "LineString", "coordinates": coords}}]}
    write_json(os.path.join(raw_dir, "placeholder.geojson"), raw)

    route = build_route(raw["features"], OFFICIAL_MILES_2026, tolerance_m=1.0,
                        source="PLACEHOLDER: straight lines between approximate waypoints",
                        placeholder=True)
    route_path = os.path.join(DATA, "route.json")
    write_json(route_path, route)

    pois = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": w[0], "kind": w[4]},
         "geometry": {"type": "Point", "coordinates": [w[1], w[2]]}} for w in WAYPOINTS]}
    anchors = build_anchors(pois["features"], route_path)
    write_json(os.path.join(DATA, "anchors.json"), anchors)

    # crude state split: boundary halfway (by mile) between waypoints of different states
    import numpy as np
    r_coords, r_miles = np.asarray(route["coords"]), np.asarray(route["miles"])
    wp_miles = [snap(r_coords, r_miles, w[1], w[2])[0] for w in WAYPOINTS]
    runs, cur, start = [], WAYPOINTS[0][3], 0.0
    for k in range(1, len(WAYPOINTS)):
        if WAYPOINTS[k][3] != cur:
            cut = (wp_miles[k - 1] + wp_miles[k]) / 2
            runs.append((cur, start, cut))
            cur, start = WAYPOINTS[k][3], cut
    runs.append((cur, start, float(r_miles[-1])))
    states = {}
    for code, name in AT_STATES:
        ranges = [[round(a, 3), round(b, 3)] for c, a, b in runs if c == code]
        if ranges:
            states[code] = {"name": name, "ranges": ranges,
                            "total": round(sum(b - a for a, b in ranges), 2)}
    write_json(os.path.join(DATA, "states.json"),
               {"order": [c for c, _ in AT_STATES if c in states], "states": states})
    print(f"placeholder data written to {os.path.abspath(DATA)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
