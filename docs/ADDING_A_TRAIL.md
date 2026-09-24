# Adding a trail

*(中文版：[ADDING_A_TRAIL.zh.md](ADDING_A_TRAIL.zh.md))*

The app reads trails as data. Adding one takes no page code: you build a folder of JSON under `data/trails/<ID>/`, describe it in a `trail.json`, and list it in `data/trails/index.json`. The picker, per-trail progress and the "All" overview pick it up from there. For how the files fit together, see [SPEC.md](../SPEC.md) ("Trail packages" and "Data pipeline").

This guide goes through it in order. The AT and PCT were both built this way, so their files are working examples.

## 1. Check that you're allowed to use the data

Do this before anything else, since it can rule a source out. You need a source for the **trail's centerline**. Official **mile markers** are optional; the trail is fine without them.

Look for an explicit license, in this order of preference:

| What you find | Usable? |
|---|---|
| Public domain (e.g. a US federal work), or an open license like CC BY / CC0 / ODbL | Yes -- credit it as the license asks |
| Only a "no warranty / for reference only" disclaimer, no license | Maybe. This is the AT's situation: it's credited, and SPEC.md says plainly that there's no formal license. Write down exactly what you found. |
| A restriction that conflicts with this project being open source and MIT-licensed (e.g. "no commercial use") | Not without a decision from the maintainer. Open an issue first. |

Where to look: ArcGIS items carry `licenseInfo` and `accessInformation` fields (`https://www.arcgis.com/sharing/rest/content/items/<item id>?f=json`), and their layers carry `copyrightText`. The trail organisation's own data page counts too. Record what you found, with the date, because you'll need it in step 5.

Two worked examples, from what was publicly findable in September 2026 (check again before relying on it):

- **Continental Divide Trail (CDT).** A centerline built by the US Forest Service with Bear Creek Survey Service. The metadata we found has a no-warranty disclaimer but no license, so it's in the same position as the AT: usable with careful attribution and an honest note. The Continental Divide Trail Coalition's maps-and-data page is the place to confirm.
- **Long Trail (Vermont).** The Green Mountain Club's `LTSYSTEM` layer, distributed through the Vermont Center for Geographic Information (last provided in 2006). Its metadata forbids using it for commercial hiking maps and allows non-profit use. This project is MIT-licensed, so anyone may reuse it commercially, which puts that restriction in conflict with the license. It needs a decision (or permission from the GMC) before it goes in.

Place names come from OpenStreetMap (ODbL) for every trail, and state lines from the US Census (public domain). Neither needs a new check.

## 2. Add a pipeline profile

Everything that differs between trails lives in one place: [`scripts/trail_profiles.py`](../scripts/trail_profiles.py). Add a `TrailProfile` next to `AT` and `PCT`, then add it to `PROFILES`:

```python
CDT = TrailProfile(
    id="CDT",                         # folder name and the trailId on every logged hike; letters/digits, never "*"
    name="Continental Divide Trail",
    source="...",                     # who made the centerline; stamped into route.json
    start=(lon, lat), start_name="...",   # where mile 0 is (the AT and PCT start in the south)
    end=(lon, lat), end_name="...",       # the other terminus
    official_miles=...,               # the managing organisation's current published length
    states=[("NM", "New Mexico"), ("CO", "Colorado"), ...],   # in trail order, from the start
    centerline_url="https://.../FeatureServer/0/query",       # an ArcGIS layer that supports f=geojson
    markers_url="",                   # optional: an official mile-marker point layer
    proj_center=(lon, lat),           # roughly the middle of the trail; used when simplifying in metres
)
```

Notes:

- **The centerline isn't an ArcGIS layer?** Leave `centerline_url` empty, and save the line yourself as GeoJSON at `data/raw/<ID>/centerline.geojson` (GPX/KML/shapefile can be converted with QGIS or `ogr2ogr`). Then skip `fetch_centerline.py`.
- **Mile markers** need to be points with a `Mile` (or `mile`) property. With `markers_url` set, `fetch_centerline.py` saves them as `data/raw/<ID>/mile_markers.json`, and `build_route.py` uses them automatically. You can also write that file by hand in the same shape: `[{"name", "lat", "lon", "mile"}, ...]`. Without markers, miles are scaled evenly to `official_miles`, which is what the AT does.
- **A trail outside the US?** `build_states.py` only knows US states (Census). Skip that step. `states.json` is optional, and without it the per-state list doesn't appear.

## 3. Build the data

```bash
pip install shapely numpy pyshp
# once: download https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip into data/raw/

python3 scripts/fetch_centerline.py --trail CDT                        # -> data/raw/CDT/ (skip if you saved it by hand)
python3 scripts/build_route.py --trail CDT data/raw/CDT/centerline.geojson --inspect   # look first
python3 scripts/build_route.py --trail CDT data/raw/CDT/centerline.geojson             # -> data/trails/CDT/route.json
python3 scripts/fetch_osm_pois.py --trail CDT                          # a few minutes; just re-run if it stops
python3 scripts/build_anchors.py --trail CDT data/raw/CDT/osm_pois.geojson
python3 scripts/build_states.py --trail CDT data/raw/cb_2023_us_state_500k.zip
```

What to look for in the output:

- **`--inspect`**: how many features, and how long the lines are in total. One ordered line (like the PCT) is the easy case. Hundreds of pieces (like the AT) get chained together automatically. If they still come out wrong, you may need a source-specific cleanup step like the AT's [`order_centerline.py`](../scripts/order_centerline.py). Alternate routes and side trails mixed into the source are the usual cause.
- **`build_route.py` WARNINGs**: it stops if the line doesn't start and end within 3 miles of your termini (so check the coordinates, and that you haven't swapped the two ends). It warns about gaps over 0.05 miles bridged with straight lines, and about a raw length more than 2% off `official_miles`. Look into every warning.
- **With mile markers**: "calibrated against N mile markers", and any markers it skipped as too far from the line. A handful is normal; a lot means the markers and the line are different versions.
- **`build_states.py`**: the per-state totals should add up to the route length. If a trail runs along a state line, the state can flip back and forth there. `--min-run 0.8` smooths that out (see SPEC.md).
- **Size**: `route.json` should be around 1 MB (the AT is ~760 KB, the PCT ~1 MB). If it's much bigger, raise `--tolerance` (metres, default 15).

## 4. Describe it: `trail.json`

Create `data/trails/<ID>/trail.json`. The PCT's is a good template:

```json
{
  "schemaVersion": 1,
  "id": "CDT",
  "name": "Continental Divide Trail",
  "shortName": "CDT",
  "color": "#7b5ea7",
  "subtitle": { "en": "Crazy Cook, NM to Waterton Lake, MT", "zh": "..." },
  "credit": { "en": "Trail: .... Place names: © OpenStreetMap contributors.", "zh": "..." },
  "files": { "route": "route.json", "anchors": "anchors.json", "states": "states.json", "borders": "state_borders.geojson" }
}
```

- `id` must match the folder name exactly.
- `shortName` is what the picker shows, so keep it to a few letters.
- `color` is used in the "All" overview. Pick one that's easy to tell apart from the others there (AT `#2a9d99`, PCT `#d9822b`) and readable on the map.
- `credit` is shown in the page footer. It must carry the attribution from step 1.
- `subtitle` and `credit` can be plain strings, or `{ "en": ..., "zh": ... }` for a translation.
- Only `files.route` is required. Leave out any file you didn't build.

## 5. Turn it on

1. Add the id to `data/trails/index.json`. The order there is the order in the picker.
2. **Chinese state names** (optional): if the trail crosses states that [`js/strings.js`](../js/strings.js) doesn't translate yet, add them to both `STATE_NAMES.en` and `STATE_NAMES.zh`. Without them, the English name from `states.json` is shown.
3. **SPEC.md / SPEC.zh.md, "Data sources and licensing"**: add the source, its year, and exactly what its license or disclaimer says (what you found in step 1).

## 6. Check it

```bash
npm install     # once
npm test        # includes a check that every file each trail.json names exists
python3 -m unittest tests/test_pipeline.py -v
```

Then start the site (`start.command`, or `python3 -m http.server 8000`) and check in the browser:

- The new trail is in the picker, and its name, subtitle, total length and credit are right.
- The whole line shows on the map, starting and ending where it should.
- A few well-known places: type their names into Start/End. Their miles should match the trail's own guidebook or data to within a mile or so.
- Log a hike, switch to another trail and back: each keeps its own progress.
- "All" shows the new trail in its colour, and the totals add up.

## 7. Sending it in

In the pull request, include:

- [ ] the profile in `scripts/trail_profiles.py`
- [ ] `data/trails/<ID>/` (built files only; `data/raw/` is git-ignored and must stay out)
- [ ] the id in `data/trails/index.json`
- [ ] the source and license in SPEC.md / SPEC.zh.md, with where you checked and when
- [ ] tests passing, plus a line on what you checked in the browser
