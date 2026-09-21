"""Pipeline tests on synthetic data (no network needed).

Run:  python -m unittest tests/test_pipeline.py -v
"""
import json
import math
import os
import random
import sys
import tempfile
import unittest

import numpy as np
from shapely.geometry import box

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from atlib import KATAHDIN, SPRINGER, PipelineError, cumulative_miles, haversine_mi, snap  # noqa: E402
from build_anchors import build_anchors  # noqa: E402
from build_route import build_route, chain, rdp_indices  # noqa: E402
from build_states import build_borders, build_state_ranges  # noqa: E402

quiet = lambda *a, **k: None  # noqa: E731


def wiggly_route(n=3000):
    """A wavy SW->NE line from Springer to Katahdin."""
    t = np.linspace(0, 1, n)
    lon = SPRINGER[0] + (KATAHDIN[0] - SPRINGER[0]) * t
    lat = SPRINGER[1] + (KATAHDIN[1] - SPRINGER[1]) * t + 0.15 * np.sin(t * 60) * np.sin(t * math.pi)
    return list(zip(lon.tolist(), lat.tolist()))


def as_features(lines):
    return [{"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": l}}
            for l in lines]


class RouteTests(unittest.TestCase):
    def test_fragments_shuffled_reversed_with_tiny_gaps(self):
        pts = wiggly_route()
        cuts = [0, 400, 900, 1300, 1900, 2400, len(pts)]
        frags = []
        for a, b in zip(cuts, cuts[1:]):
            f = [list(p) for p in pts[a:b + 1]]
            f[-1][0] += 1e-5                      # ~1 m gap between fragments
            frags.append(f)
        random.Random(3).shuffle(frags)
        frags = [f[::-1] if i % 2 else f for i, f in enumerate(frags)]

        route = build_route(as_features(frags), official_miles=2197.9, tolerance_m=15, log=quiet)
        self.assertLess(haversine_mi(*route["coords"][0], *SPRINGER), 0.1)
        self.assertLess(haversine_mi(*route["coords"][-1], *KATAHDIN), 0.1)
        self.assertAlmostEqual(route["totalMiles"], 2197.9, places=1)
        self.assertEqual(len(route["coords"]), len(route["miles"]))
        self.assertTrue(all(b > a for a, b in zip(route["miles"], route["miles"][1:])))
        self.assertLess(len(route["coords"]), len(pts))            # simplified

    def test_simplify_keeps_shape_within_tolerance(self):
        pts = np.array([[x, math.sin(x / 40) * 100] for x in range(0, 2000, 5)], dtype=float)
        keep = rdp_indices(pts, 5.0)
        kept = pts[keep]
        for p in pts:                                 # every original point close to kept polyline
            d = min(_dist_to_seg(p, kept[i], kept[i + 1]) for i in range(len(kept) - 1))
            self.assertLessEqual(d, 5.0 + 1e-6)
        self.assertLess(len(keep), len(pts))

    def test_wrong_start_is_rejected(self):
        pts = wiggly_route()[600:]                   # missing the southern part
        with self.assertRaises(PipelineError):
            build_route(as_features([pts]), log=quiet)

    def test_calibration_hits_known_miles(self):
        pts = wiggly_route()
        mid = pts[len(pts) // 2]
        route = build_route(as_features([pts]), official_miles=2197.9, tolerance_m=15,
                            cal_points=[{"name": "mid", "lat": mid[1], "lon": mid[0], "mile": 1000.0}],
                            log=quiet)
        coords, miles = np.asarray(route["coords"]), np.asarray(route["miles"])
        m, _ = snap(coords, miles, mid[0], mid[1])
        self.assertAlmostEqual(m, 1000.0, delta=0.5)
        self.assertAlmostEqual(miles[-1], 2197.9, places=1)

    def test_chain_starts_at_springer(self):
        a = [(-84.19, 34.63), (-84.0, 34.7)]
        b = [(-84.0, 34.7), (-83.9, 34.8)]
        cur, jumps = chain([b[::-1], a])
        self.assertEqual(cur[0], a[0])
        self.assertEqual(cur[-1], b[-1])
        self.assertEqual(jumps, [])


def _dist_to_seg(p, a, b):
    ab, ap = b - a, p - a
    t = 0.0 if not ab.any() else max(0.0, min(1.0, float(ap @ ab) / float(ab @ ab)))
    return float(np.hypot(*(p - (a + t * ab))))


class AnchorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        coords = [[-84.0, 35.0], [-83.0, 35.0]]     # 1 degree of longitude east-west
        miles = cumulative_miles(coords)
        self.route_path = os.path.join(self.tmp.name, "route.json")
        with open(self.route_path, "w") as f:
            json.dump({"coords": coords, "miles": [float(m) for m in miles]}, f)
        self.total = float(miles[-1])

    def tearDown(self):
        self.tmp.cleanup()

    def pt(self, lon, lat, **props):
        return {"type": "Feature", "properties": props,
                "geometry": {"type": "Point", "coordinates": [lon, lat]}}

    def test_snap_filter_and_termini(self):
        pois = [
            self.pt(-83.5, 35.001, name="Half Shelter", amenity="shelter"),
            self.pt(-83.5, 35.2, name="Far Shelter", amenity="shelter"),       # ~14 mi away
            self.pt(-83.25, 35.03, name="Little Town", place="town"),           # towns are intentionally excluded
            self.pt(-83.5, 35.0, amenity="shelter"),                            # no name
            self.pt(-83.5, 35.0, name="Just A Peak", natural="peak"),           # unknown kind
        ]
        out = build_anchors(pois, self.route_path, log=quiet)["anchors"]
        names = [a["name"] for a in out]
        self.assertEqual(names[0], "Springer Mountain")
        self.assertEqual(names[-1], "Mount Katahdin")
        self.assertIn("Half Shelter", names)
        self.assertNotIn("Little Town", names)
        self.assertNotIn("Far Shelter", names)
        self.assertNotIn("Just A Peak", names)
        half = next(a for a in out if a["name"] == "Half Shelter")
        self.assertAlmostEqual(half["mile"], self.total / 2, delta=0.1)
        self.assertEqual(out, sorted(out, key=lambda a: a["mile"]))


class StateTests(unittest.TestCase):
    def shapes(self):
        # GA below lat 35.2, NC above; TN is a box east of lon -83.0 (trail never enters it)
        return {
            "GA": box(-85, 34, -83, 35.2),
            "NC": box(-85, 35.2, -83, 36.5),
            "TN": box(-83, 34, -80, 36.5),
        }

    def test_ranges_split_at_state_line(self):
        coords = np.array([[-84.0, 34.6], [-84.0, 35.0], [-84.0, 35.6], [-84.0, 36.2]])
        miles = cumulative_miles(coords)
        out = build_state_ranges(coords, miles, self.shapes(), min_run=0.1, log=quiet)
        ga, nc = out["states"]["GA"], out["states"]["NC"]
        expected_cut = 69.09 * (35.2 - 34.6)          # miles from the start to lat 35.2
        self.assertAlmostEqual(ga["ranges"][0][1], expected_cut, delta=0.5)
        self.assertAlmostEqual(nc["ranges"][0][0], ga["ranges"][0][1], places=3)
        self.assertAlmostEqual(ga["total"] + nc["total"], float(miles[-1]), delta=0.05)
        self.assertNotIn("TN", out["states"])

    def test_noise_flip_is_absorbed(self):
        # a 0.03-mile dip into TN in the middle of NC should not create a TN range
        coords = np.array([[-84.0, 35.4], [-83.0005, 35.6], [-82.9995, 35.6], [-83.0005, 35.6001], [-84.0, 36.0]])
        # route hugging the line: NC -> TN -> NC with tiny TN part
        miles = cumulative_miles(coords)
        out = build_state_ranges(coords, miles, self.shapes(), min_run=0.5, log=quiet)
        self.assertEqual(len(out["states"]["NC"]["ranges"]), 1)

    def test_borders_only_between_states(self):
        borders = build_borders(self.shapes())
        geom = borders["features"][0]["geometry"]
        lines = geom["coordinates"] if geom["type"] == "MultiLineString" else [geom["coordinates"]]
        # GA/NC border is lat 35.2 (lon -85..-83); GA/TN and NC/TN borders are lon -83.
        for line in lines:
            for lon, lat in line:
                on_ga_nc = abs(lat - 35.2) < 1e-6 and -85 - 1e-6 <= lon <= -83 + 1e-6
                on_tn_line = abs(lon + 83) < 1e-6
                self.assertTrue(on_ga_nc or on_tn_line, (lon, lat))


if __name__ == "__main__":
    unittest.main()
