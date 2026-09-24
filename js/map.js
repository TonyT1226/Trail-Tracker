// Everything that touches Mapbox GL JS lives here. app.js only calls the small APIs returned
// by createMapView() (one trail) and createOverviewMap() (all of them), so the rest of the
// app works (and is testable) without a map.

const EMPTY = { type: 'FeatureCollection', features: [] };
const FONT = ['DIN Pro Medium', 'Arial Unicode MS Regular'];
const COLORS = { base: '#4f5d58', done: '#d1246b', halo: '#ffb703', casing: '#ffffff' };

const widthByZoom = (small, large) => ['interpolate', ['linear'], ['zoom'], 4, small, 11, large];

const line = (id, source, color, width, extra = {}) => ({
  id,
  type: 'line',
  source,
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': color, 'line-width': width, ...extra },
});

// Topo layers: soft hillshade plus contour lines from Mapbox's terrain tilesets, drawn under
// roads and labels, with contours labelled in feet or metres to match the unit switch. Every
// 5th/10th line (the "index" contours) is darker and carries the labels, as on a paper topo map.
const CONTOUR = '#7d6b4a';
const DEM = { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 };
function addContours(map, unit) {
  const standard = Boolean(map.getStyle().imports?.length);
  const slot = standard ? { slot: 'bottom' } : {};        // Standard style: under roads and labels
  const labelSlot = standard ? { slot: 'middle' } : {};
  if (!map.getSource('dem')) map.addSource('dem', DEM);    // shared with the 3D terrain toggle
  map.addLayer({
    id: 'hillshade', type: 'hillshade', source: 'dem',
    paint: {
      'hillshade-exaggeration': 0.35,
      'hillshade-shadow-color': 'rgba(60, 55, 40, 0.5)',
      'hillshade-highlight-color': 'rgba(255, 255, 255, 0.25)',
      'hillshade-accent-color': 'rgba(60, 55, 40, 0.3)',
    },
    ...slot,
  });
  const major = ['in', ['get', 'index'], ['literal', [5, 10]]];
  const ele = unit === 'km'
    ? ['concat', ['to-string', ['get', 'ele']], ' m']
    : ['concat', ['to-string', ['round', ['*', ['get', 'ele'], 3.28084]]], ' ft'];
  map.addSource('contours', { type: 'vector', url: 'mapbox://mapbox.mapbox-terrain-v2' });
  map.addLayer({
    id: 'contour-minor', type: 'line', source: 'contours', 'source-layer': 'contour', minzoom: 11,
    filter: ['!', major],
    paint: { 'line-color': CONTOUR, 'line-width': 0.6, 'line-opacity': 0.45 },
    ...slot,
  });
  map.addLayer({
    id: 'contour-major', type: 'line', source: 'contours', 'source-layer': 'contour', minzoom: 9,
    filter: major,
    paint: { 'line-color': CONTOUR, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 1.2], 'line-opacity': 0.65 },
    ...slot,
  });
  map.addLayer({
    id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contour', minzoom: 12,
    filter: major,
    layout: {
      'symbol-placement': 'line', 'text-field': ele, 'text-font': FONT, 'text-size': 10,
      'text-max-angle': 25, 'text-padding': 20,
    },
    paint: { 'text-color': CONTOUR, 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.2 },
    ...labelSlot,
  });
}

// Shared by both views: the map itself, its controls, contours, and error reporting.
function baseMap({ mapboxgl, token, style, styleConfig, contours, container, bounds, unit, onError }) {
  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({
    container, style, bounds, fitBoundsOptions: { padding: 40 }, ...(styleConfig ? { config: styleConfig } : {}),
  });
  if (contours) map.on('load', () => addContours(map, unit));
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new mapboxgl.ScaleControl({ unit: unit === 'km' ? 'metric' : 'imperial' }), 'bottom-left');
  map.on('error', (e) => onError?.(e.error || e));
  return map;
}

// Returns a function that flips 3D terrain on/off and reports the new state.
function terrainToggle(map) {
  let on = false;
  return () => {
    on = !on;
    if (on) {
      if (!map.getSource('dem')) map.addSource('dem', DEM);
      map.setTerrain({ source: 'dem', exaggeration: 1.4 });
      map.easeTo({ pitch: 60, duration: 800 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, duration: 800 });
    }
    return on;
  };
}

// Clicks within ~24 px of a line count as "on" it, whatever the zoom.
function clickLimitMi(map, lat) {
  const mPerPx = (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
  return Math.max(0.3, (mPerPx * 24) / 1609.344);
}

export function createMapView({ mapboxgl, token, style, styleConfig, contours, route, anchors, bordersUrl, container, onPick, onError, unit = 'mi', formatMile }) {
  const map = baseMap({ mapboxgl, token, style, styleConfig, contours, container, bounds: route.bounds(), unit, onError });

  let ready = false;
  let pendingDone = EMPTY;
  let pickMode = false;

  map.on('load', () => {
    map.addSource('route', { type: 'geojson', data: route.asFeature() });
    map.addSource('done', { type: 'geojson', data: pendingDone });
    map.addSource('focus', { type: 'geojson', data: EMPTY });

    map.addLayer(line('route-casing', 'route', COLORS.casing, widthByZoom(3.5, 7), { 'line-opacity': 0.85 }));
    map.addLayer(line('route-base', 'route', COLORS.base, widthByZoom(1.5, 3)));
    map.addLayer(line('focus-halo', 'focus', COLORS.halo, widthByZoom(9, 16), { 'line-opacity': 0.55, 'line-blur': 2 }));
    map.addLayer(line('done-casing', 'done', COLORS.casing, widthByZoom(5, 9)));
    map.addLayer(line('done', 'done', COLORS.done, widthByZoom(3, 5.5)));

    if (anchors?.length) {
      map.addSource('anchors', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: anchors.map((a) => ({
            type: 'Feature',
            properties: { name: a.name, kind: a.kind, mile: a.mile },
            geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
          })),
        },
      });
      const label = (minzoom, kinds, size) => ({
        id: `anchors-${kinds.join('-')}`,
        type: 'symbol',
        source: 'anchors',
        minzoom,
        filter: ['in', ['get', 'kind'], ['literal', kinds]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': size,
          'text-anchor': 'top',
          'text-offset': [0, 0.7],
          'text-optional': true,
        },
        paint: { 'text-color': '#1b2a26', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      });
      const dot = (minzoom, kinds, r) => ({
        id: `anchor-dots-${kinds.join('-')}`,
        type: 'circle',
        source: 'anchors',
        minzoom,
        filter: ['in', ['get', 'kind'], ['literal', kinds]],
        paint: { 'circle-radius': r, 'circle-color': '#ffffff', 'circle-stroke-color': '#1b2a26', 'circle-stroke-width': 1.5 },
      });
      map.addLayer(dot(6, ['terminus'], 4));
      map.addLayer(label(6.5, ['terminus'], 12));
      map.addLayer(dot(9.5, ['gap', 'shelter', 'campsite'], 3));
      map.addLayer(label(10.5, ['gap', 'shelter', 'campsite'], 11));
    }

    // Our own state lines, below the trail. Optional: skipped if the file is missing.
    if (bordersUrl) {
      fetch(bordersUrl)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          map.addSource('borders', { type: 'geojson', data });
          map.addLayer(
            {
              id: 'state-borders',
              type: 'line',
              source: 'borders',
              paint: { 'line-color': '#2b2b2b', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.75 },
            },
            'route-casing',
          );
        })
        .catch(() => {});
    }

    ready = true;
    map.getSource('done').setData(pendingDone);
  });

  map.on('click', (e) => {
    const { mile, distMi } = route.nearest(e.lngLat.lng, e.lngLat.lat);
    const hit = distMi <= clickLimitMi(map, e.lngLat.lat);
    if (pickMode) {
      onPick?.({ mile, hit });
      return;
    }
    if (hit) {
      new mapboxgl.Popup({ closeButton: false, offset: 8 })
        .setLngLat(route.pointAt(mile))
        .setText(formatMile ? formatMile(mile) : mile.toFixed(1))
        .addTo(map);
    }
  });

  return {
    map,
    setDone(featureCollection) {
      pendingDone = featureCollection;
      if (ready) map.getSource('done').setData(featureCollection);
    },
    focus(lo, hi) {
      const coords = route.slice(lo, hi);
      const src = map.getSource('focus');
      const apply = () => {
        map.getSource('focus').setData({
          type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords },
        });
        const xs = coords.map((c) => c[0]);
        const ys = coords.map((c) => c[1]);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
          { padding: 70, maxZoom: 12, duration: 800 });
      };
      if (src) apply();
      else map.once('load', apply);
    },
    clearFocus() {
      map.getSource('focus')?.setData(EMPTY);
    },
    fit() {
      map.fitBounds(route.bounds(), { padding: 40, duration: 800, pitch: 0, bearing: 0 });
    },
    setPickMode(on) {
      pickMode = on;
      map.getCanvas().style.cursor = on ? 'crosshair' : '';
    },
    toggleTerrain: terrainToggle(map),
  };
}

// Every trail at once: each route as a grey line, with its walked miles drawn over it in
// that trail's own colour. trails: [{ id, name, color, route }]; setDone takes
// { [id]: mergedIntervals }.
export function createOverviewMap({ mapboxgl, token, style, styleConfig, contours, trails, container, onError, unit = 'mi', formatPoint }) {
  const all = trails.flatMap((tr) => tr.route.bounds());
  const bounds = [
    [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))],
    [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))],
  ];
  const map = baseMap({ mapboxgl, token, style, styleConfig, contours, container, bounds, unit, onError });

  let ready = false;
  let pendingDone = EMPTY;
  const doneFeatures = (byId) => ({
    type: 'FeatureCollection',
    features: trails.flatMap((tr) => tr.route.featuresFor(byId[tr.id] || []).features
      .map((f) => ({ ...f, properties: { color: tr.color } }))),
  });

  map.on('load', () => {
    map.addSource('routes', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: trails.map((tr) => tr.route.asFeature()) },
    });
    map.addSource('done', { type: 'geojson', data: pendingDone });
    map.addLayer(line('route-casing', 'routes', COLORS.casing, widthByZoom(3.5, 7), { 'line-opacity': 0.85 }));
    map.addLayer(line('route-base', 'routes', COLORS.base, widthByZoom(1.5, 3)));
    map.addLayer(line('done-casing', 'done', COLORS.casing, widthByZoom(5, 9)));
    map.addLayer(line('done', 'done', ['get', 'color'], widthByZoom(3, 5.5)));
    ready = true;
    map.getSource('done').setData(pendingDone);
  });

  // clicking on a trail says which one it is and where
  map.on('click', (e) => {
    const { lng, lat } = e.lngLat;
    const best = trails
      .map((tr) => ({ tr, ...tr.route.nearest(lng, lat) }))
      .sort((a, b) => a.distMi - b.distMi)[0];
    if (!best || best.distMi > clickLimitMi(map, lat)) return;
    new mapboxgl.Popup({ closeButton: false, offset: 8 })
      .setLngLat(best.tr.route.pointAt(best.mile))
      .setText(formatPoint ? formatPoint(best.tr, best.mile) : `${best.tr.name} ${best.mile.toFixed(1)}`)
      .addTo(map);
  });

  return {
    map,
    setDone(byId) {
      pendingDone = doneFeatures(byId);
      if (ready) map.getSource('done').setData(pendingDone);
    },
    fit() {
      map.fitBounds(bounds, { padding: 40, duration: 800, pitch: 0, bearing: 0 });
    },
    toggleTerrain: terrainToggle(map),
  };
}
