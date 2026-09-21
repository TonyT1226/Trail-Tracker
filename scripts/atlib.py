"""Shared helpers for the AT data pipeline (distance, projection, snapping)."""
from __future__ import annotations

import json
import math
import os

import numpy as np

R_MI = 3958.7613          # mean Earth radius in miles
M_PER_DEG = 111_320.0     # metres per degree of latitude (close enough for local work)
M_PER_MI = 1609.344

SPRINGER = (-84.1938, 34.6268)   # (lon, lat) southern terminus, Georgia
KATAHDIN = (-68.9214, 45.9044)   # (lon, lat) northern terminus, Maine

AT_STATES = [
    ("GA", "Georgia"), ("NC", "North Carolina"), ("TN", "Tennessee"),
    ("VA", "Virginia"), ("WV", "West Virginia"), ("MD", "Maryland"),
    ("PA", "Pennsylvania"), ("NJ", "New Jersey"), ("NY", "New York"),
    ("CT", "Connecticut"), ("MA", "Massachusetts"), ("VT", "Vermont"),
    ("NH", "New Hampshire"), ("ME", "Maine"),
]


class PipelineError(Exception):
    """Raised for problems the user needs to look at (bad input, broken route...)."""


def haversine_mi(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_MI * math.asin(math.sqrt(a))


def cumulative_miles(coords):
    """Cumulative great-circle distance (miles) along a list of (lon, lat)."""
    arr = np.asarray(coords, dtype=float)
    lon, lat = np.radians(arr[:, 0]), np.radians(arr[:, 1])
    dphi, dl = np.diff(lat), np.diff(lon)
    a = np.sin(dphi / 2) ** 2 + np.cos(lat[:-1]) * np.cos(lat[1:]) * np.sin(dl / 2) ** 2
    seg = 2 * R_MI * np.arcsin(np.sqrt(a))
    return np.concatenate([[0.0], np.cumsum(seg)])


def to_local_m(coords, lon0, lat0):
    """Equirectangular projection to metres around (lon0, lat0)."""
    arr = np.asarray(coords, dtype=float)
    x = (arr[:, 0] - lon0) * math.cos(math.radians(lat0)) * M_PER_DEG
    y = (arr[:, 1] - lat0) * M_PER_DEG
    return np.column_stack([x, y])


def snap(coords, miles, lon, lat):
    """Project a point onto a polyline.

    Returns (mile, off_trail_miles): the along-route mile of the closest point
    and how far the query point is from the route.
    """
    xy = to_local_m(coords, lon, lat)          # query point is the origin
    a, b = xy[:-1], xy[1:]
    ab = b - a
    denom = (ab ** 2).sum(axis=1)
    denom = np.where(denom == 0, 1e-12, denom)
    t = np.clip(-(a * ab).sum(axis=1) / denom, 0.0, 1.0)
    proj = a + ab * t[:, None]
    d = np.hypot(proj[:, 0], proj[:, 1])
    k = int(np.argmin(d))
    mile = float(miles[k] + t[k] * (miles[k + 1] - miles[k]))
    return mile, float(d[k] / M_PER_MI)


def load_route(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data, np.asarray(data["coords"], dtype=float), np.asarray(data["miles"], dtype=float)


def write_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        if indent is None:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=indent)
    return os.path.getsize(path)
