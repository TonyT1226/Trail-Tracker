# Technical spec

*(中文说明见 [SPEC.zh.md](SPEC.zh.md))*

How the code is laid out, how data flows through it, and where the trail data comes from. For what the app does and how to use it, see [README.md](README.md).

## Layout

```
index.html            page shell
start.command         double-click to start a local server and open the browser
css/style.css         styling (pine-green panel + white blazes + magenta completed line)
js/
  config.js           settings you may want to change: Mapbox token, state grouping, data paths
  strings.js           all user-facing text, English + Chinese, plus the language/unit switches
  app.js               page logic: load data, the form, the hike log, stats
  map.js               all the Mapbox code lives here (basemap, route, place names, state borders, 3D terrain, click-to-pick)
  geo.js               route geometry: point/slice by mile, nearest mile to a click
  intervals.js         mile-range merging (a repeated or overlapping hike is never double-counted)
  store.js             the hike log's storage: localStorage + JSON export/import
  stats.js             overall and per-state progress
data/
  route.json           the route: coordinates + the mile at each point
  anchors.json         named places (towns, gaps, shelters) and their mile
  states.json          the mile range(s) each state covers
  state_borders.geojson  dashed state-border lines (optional)
scripts/               the data pipeline (Python) that generates the files in data/
tests/                JS and Python tests
```

## Data model

A hike is logged as one Activity: `{ id, trailId, date, source, range: { from, to }, fromName, toName, note }` (`range` is in miles as walked, so `from > to` means southbound; `source` is `'manual'` for everything you log by hand today -- reserved for `'gpx'`/`'healthkit'` once later milestones add other ways to bring in a hike). The finished trail is the union of every activity's range, so walking the same stretch twice, or two hikes that overlap, are each only counted once.

There is exactly one JSON shape to reason about, and it's a single continuously-updated record, not one file per hike: activities live in this browser's localStorage as one evolving list; "Export JSON" always writes out a complete snapshot of everything logged so far (not just what's new); "Import JSON" merges a snapshot back in by id (an incoming entry with the same id overwrites the local one). So re-exporting after every hike, or importing an old backup on top of a newer log, are both safe and never lose or duplicate data. You can also drop an exported file at `data/hikes.json`; a browser that has never saved anything locally will use it to seed the initial log.

Every vertex in `route.json` already carries its mile, so "from mile A to mile B" on the map is a lookup, not a geometry calculation done in the browser. Place names and state boundaries are both expressed in miles along that same route, so all three line up automatically. Distances are stored and computed in miles throughout; the km display is a conversion at render time only (see `js/strings.js`).

## Data pipeline

```
fetch_centerline.py   ->  data/raw/centerline.geojson          the official NPS/ATC centerline (~3,000 independently surveyed segments)
order_centerline.py   ->  data/raw/centerline_ordered.geojson  stitched into one south-to-north line (see below)
build_route.py        ->  data/route.json                      oriented, mile-scaled to the official length, simplified
fetch_osm_pois.py     ->  data/raw/osm_pois.geojson             shelters/gaps/towns from OpenStreetMap
build_anchors.py      ->  data/anchors.json                    snapped onto the route, giving each one a mile
(download Census state boundaries) -> data/raw/cb_2023_us_state_500k.zip
build_states.py       ->  data/states.json, data/state_borders.geojson
make_placeholder.py   ->  placeholder data (about 58 waypoints connected by straight lines, for trying the app out only)
```

The official length defaults to 2,197.9 miles (ATC's 2026 figure); override with `--official-miles`. The ratio between the geometric length and the official length is used to scale the mile markers; pass `--calibration` with per-segment calibration points if you have reliable mile markers of your own.

**Why there's an extra `order_centerline.py` step:** the NPS's ANST_Centerline layer isn't one ordered line -- it's nearly 3,000 independently surveyed segments from more than 20 years of different equipment and different years, often with gaps of a few meters to a few dozen meters between segments that should connect (not exact endpoint matches). Feeding these straight into `build_route.py`'s own greedy nearest-point stitching used to get thrown off by those gaps and by a handful of survey artifacts (duplicated single points, short connector segments unrelated to the main line), producing a broken 3,049-mile route that ended 890 miles short of Katahdin. `order_centerline.py` takes a more robust approach: it first drops co-located alternates like the Bartram Trail and Benton MacKaye Trail using the official `Alt_Name` field; then stitches segments that should connect but have small gaps using fuzzy matching (about 80m tolerance), which is more forgiving than shapely's exact-endpoint matching; then does one global sort-and-stitch pass in the Springer-to-Katahdin direction, discarding the isolated artifact points that stitching produces. Current result: a stitched line 2,158 miles long, starting within 0.01 miles of Springer and ending within 0.01 miles of Katahdin, with the largest gap at any single join being 2.5 miles (a real, unsurveyed stretch -- a road crossing, for instance).

### Common commands

```bash
pip install shapely numpy pyshp

python3 scripts/fetch_centerline.py
python3 scripts/order_centerline.py data/raw/centerline.geojson        # stitch into one ordered line
python3 scripts/build_route.py data/raw/centerline_ordered.geojson --inspect   # take a look at the data first
python3 scripts/build_route.py data/raw/centerline_ordered.geojson -o data/route.json

python3 scripts/fetch_osm_pois.py
python3 scripts/build_anchors.py data/raw/osm_pois.geojson

# download https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip into data/raw/
python3 scripts/build_states.py data/raw/cb_2023_us_state_500k.zip --min-run 0.8
```

`build_route.py` checks that the route starts at Springer Mountain and ends at Katahdin, and reports any gaps and length deviation from stitching. Don't ignore a WARNING here -- though you shouldn't see any once you're using `order_centerline.py`.

`fetch_osm_pois.py` uses the public Overpass API, which rate-limits you (HTTP 429) if you ask for too much at once. If the command fails partway through, just re-run `fetch_osm_pois.py` -- it requests in 40-mile chunks by default, so retries are quick; on a flaky connection, pass `--chunk-miles` with a larger value to make fewer, bigger requests.

`build_states.py`'s `--min-run` controls how aggressively "state-border noise" gets smoothed out: the AT zig-zags across the NC/TN state line for about 200 miles, and across the VA/WV line for a shorter stretch, and the default 0.1-mile smoothing would carve those into hundreds of tiny fragments; raising it to about 0.8 miles collapses VA/WV down to a few real crossings (near Harpers Ferry), and the ~200 miles of genuine NC/TN back-and-forth is real regardless of how finely it gets sliced -- however many segments it ends up as, `js/stats.js` just sums them into one number per state, so it doesn't affect what's displayed. All 14 states are shown separately by default; group a couple together with `stateGroups` in `js/config.js`, e.g. `[['NC', 'TN']]`.

## Data sources and licensing

- **Trail centerline** (the raw input to `data/route.json`): the `ANST_Centerline` layer maintained jointly by the National Park Service's Appalachian National Scenic Trail office and the Appalachian Trail Conservancy (a public ArcGIS Online layer). Its own copyright text reads `National Park Service Appalachian National Scenic Trail & Appalachian Trail Conservancy, 2023`, with a note that the data is "for general reference purposes only... not legal documents," with no warranty as to accuracy, reliability, or completeness from NPS, USDA Forest Service, ATC, or their partners -- that's a liability disclaimer, not a formal reuse license (it states neither public domain nor specific redistribution terms). Because the copyright is jointly held with ATC, a private nonprofit (not a pure federal work), it can't simply be treated as public domain. This project attributes it using the line above; if you plan to redistribute this geometry more broadly, check with ATC directly.
- **Official trail length** (defaults to 2,197.9 miles): ATC's annually published figure; currently using the 2026 number -- see `build_route.py --official-miles`.
- **Named points of interest** (the shelters, gaps, and towns in `data/anchors.json`): from OpenStreetMap, under the [ODbL](https://opendatacommons.org/licenses/odbl/) license, requiring attribution to "© OpenStreetMap contributors".
- **State boundaries** (`data/states.json`, `data/state_borders.geojson`): the US Census Bureau's Cartographic Boundary File, a US federal government work, in the public domain with no copyright restriction.
- **Basemap**: Mapbox (`mapStyle` in `js/config.js`); the page automatically shows Mapbox's and OpenStreetMap's attribution in the bottom-right corner, per Mapbox's own terms of service.

## Development

```bash
python3 -m http.server 8000     # then visit http://localhost:8000 (double-clicking index.html directly won't work)
npm install                     # only needed to run the UI tests
npm test                        # JS tests
python3 -m unittest tests/test_pipeline.py -v   # data pipeline tests
```

### Deploying your own copy

Push to GitHub, then Settings → Pages → Deploy from a branch → `main` / root. Leave `mapboxToken` empty in `js/config.js` -- don't commit your own token; the page will prompt for one on first load, and it's kept in that browser's localStorage only. If you'd rather not re-enter it every time, create a public token in the Mapbox dashboard restricted to your own Pages URL (e.g. `https://yourname.github.io`) plus `http://localhost:8000`, and write it into your own local copy of `js/config.js` (that file is tracked in the repo, so be careful not to commit it once you've added a real token -- `git update-index --assume-unchanged js/config.js` will keep local edits to it out of `git status`).
