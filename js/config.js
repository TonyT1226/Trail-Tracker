// Settings you may want to change. Everything else lives in data/ (built by scripts/).
export const CONFIG = {
  // Mapbox PUBLIC token (starts with "pk."). Leave empty -- the page will ask for it on
  // first visit and remember it in that browser's localStorage only. Do not commit a
  // real token here: this file is checked into the repo.
  mapboxToken: '',

  // Outdoors has contour lines, hillshade, trails and state names built in.
  mapStyle: 'mapbox://styles/mapbox/outdoors-v12',

  // States to count together in the per-state progress list, e.g. [['NC', 'TN']].
  // All 14 states are shown separately by default. The trail zig-zags across the
  // NC/TN line for ~200 miles, so those two totals are each made of many short
  // alternating segments -- still added up correctly, just not a tidy shape on a map.
  stateGroups: [],

  data: {
    route: 'data/route.json',
    anchors: 'data/anchors.json',
    states: 'data/states.json',
    borders: 'data/state_borders.geojson',
    seedHikes: 'data/hikes.json', // optional: used only when this browser has no saved log yet
  },
};
