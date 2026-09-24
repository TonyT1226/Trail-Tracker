// Settings you may want to change. Everything else lives in data/ (built by scripts/).
export const CONFIG = {
  // Mapbox PUBLIC token (starts with "pk."). Leave empty -- the page will ask for it on
  // first visit and remember it in that browser's localStorage only. Do not commit a
  // real token here: this file is checked into the repo.
  mapboxToken: '',

  // Mapbox Standard with its muted "faded" theme, so the trail lines stand out. mapStyleConfig
  // only applies to Standard; set it to null if you switch to another style (e.g. the more
  // colourful 'mapbox://styles/mapbox/outdoors-v12').
  mapStyle: 'mapbox://styles/mapbox/standard',
  mapStyleConfig: {
    basemap: {
      theme: 'faded',
      lightPreset: 'day',
      show3dObjects: false,
      showPointOfInterestLabels: false,
      showTransitLabels: false,
    },
  },
  // Topo-style contour lines (from Mapbox's terrain tiles), labelled in ft or m.
  contours: true,

  // States to count together in the per-state progress list, e.g. [['NC', 'TN']].
  // Applies to whichever trail is open; every state is shown separately by default.
  // The AT zig-zags across the NC/TN line for ~200 miles, so those two totals are each
  // made of many short alternating segments -- still added up correctly, just not a
  // tidy shape on a map.
  stateGroups: [],

  data: {
    trails: 'data/trails/index.json', // which trail folders to load; see js/trails.js
    seedHikes: 'data/hikes.json', // optional: used only when this browser has no saved log yet
  },
};
