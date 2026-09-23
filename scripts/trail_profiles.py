"""Per-trail settings for the data pipeline.

Every script takes --trail (default AT) and reads what differs between trails from
here: where the official geometry lives, the termini, the official length, the
states it crosses, and where raw downloads and built files go. Adding a trail to
the pipeline means adding a profile here; the web app itself only needs the
built folder under data/trails/<id>/ (see SPEC.md, "Trail packages").
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from atlib import AT_STATES, KATAHDIN, SPRINGER

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW_SHARED = os.path.join("data", "raw")       # inputs used by every trail (Census states)


@dataclass(frozen=True)
class TrailProfile:
    id: str
    name: str
    source: str                        # stamped into route.json
    start: tuple                       # (lon, lat) of the southern terminus
    start_name: str
    end: tuple                         # (lon, lat) of the northern terminus
    end_name: str
    official_miles: float
    states: list                       # [(code, name)] in trail order, south to north
    centerline_url: str                # ArcGIS FeatureServer layer query endpoint
    markers_url: str = ""              # optional official mile-marker layer (for calibration)
    proj_center: tuple = (0.0, 0.0)    # (lon, lat) used when simplifying in metres

    @property
    def raw_dir(self):
        return os.path.join(RAW_SHARED, self.id)

    @property
    def out_dir(self):
        return os.path.join("data", "trails", self.id)

    def raw(self, name):
        return os.path.join(self.raw_dir, name)

    def out(self, name):
        return os.path.join(self.out_dir, name)


AT = TrailProfile(
    id="AT",
    name="Appalachian Trail",
    source="NPS Appalachian Trail Park Office / Appalachian Trail Conservancy",
    start=SPRINGER, start_name="Springer Mountain",
    end=KATAHDIN, end_name="Mount Katahdin",
    official_miles=2197.9,             # ATC official length for 2026
    states=AT_STATES,
    centerline_url="https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/ANST_Centerline/FeatureServer/0/query",
    proj_center=(-76.0, 40.0),
)

PCT = TrailProfile(
    id="PCT",
    name="Pacific Crest Trail",
    source="Pacific Crest Trail Association (CC BY 4.0)",
    start=(-116.46698, 32.58974), start_name="Southern Terminus",    # monument at the Mexican border near Campo
    end=(-120.80211, 49.00030), end_name="Northern Terminus",        # monument at the Canadian border
    official_miles=2655.84,            # PCTA's January 2026 figure
    states=[("CA", "California"), ("OR", "Oregon"), ("WA", "Washington")],
    centerline_url="https://services5.arcgis.com/ZldHa25efPFpMmfB/arcgis/rest/services/PCTA_Centerline/FeatureServer/0/query",
    markers_url="https://services5.arcgis.com/ZldHa25efPFpMmfB/arcgis/rest/services/PCT_Mile_Markers_2026/FeatureServer/0/query",
    proj_center=(-120.0, 41.0),
)

PROFILES = {p.id: p for p in (AT, PCT)}


def get_profile(trail_id):
    try:
        return PROFILES[trail_id]
    except KeyError:
        raise SystemExit(f"unknown trail {trail_id!r}; known: {', '.join(PROFILES)}") from None


def add_trail_arg(ap):
    ap.add_argument("--trail", default="AT", choices=sorted(PROFILES),
                    help="which trail to build (default AT); sets the default input/output paths")
