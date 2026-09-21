// Settings you may want to change. Everything else lives in data/ (built by scripts/).
export const CONFIG = {
  // Mapbox PUBLIC token (starts with "pk."). Leave empty -- the page will ask for it on
  // first visit and remember it in that browser's localStorage only. Do not commit a
  // real token here: this file is checked into the repo.
  mapboxToken: '',

  // Outdoors has contour lines, hillshade, trails and state names built in.
  mapStyle: 'mapbox://styles/mapbox/outdoors-v12',

  // States to count together in the per-state progress list. NC and TN are merged by
  // default because the trail zig-zags along their shared line for ~200 miles, so a
  // clean split is not meaningful. Use [] to show all 14 states separately.
  stateGroups: [['NC', 'TN']],

  data: {
    route: 'data/route.json',
    anchors: 'data/anchors.json',
    states: 'data/states.json',
    borders: 'data/state_borders.geojson',
    seedHikes: 'data/hikes.json', // optional: used only when this browser has no saved log yet
  },
};
