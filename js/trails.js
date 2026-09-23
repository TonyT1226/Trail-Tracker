// Trail packages. Each trail is a folder data/trails/<id>/ holding a trail.json manifest
// plus the data files it names (route, and optionally anchors / states / borders), and
// data/trails/index.json lists which folders to load. Adding a trail is a data change
// only: drop in a folder, add its id to index.json.
//
// trail.json: { schemaVersion, id, name, shortName, color, subtitle, credit,
//               files: { route, anchors?, states?, borders? } }
// subtitle / credit may be a plain string or a { en, zh, ... } object.
const TRAIL_KEY = 'at-tracker:trail';

// Saved in place of a trail id when the picker is on "All trails" (the overview).
export const ALL_TRAILS = '*';

// "data/trails/index.json" + "PCT" -> "data/trails/PCT/"
export const trailFolder = (indexUrl, id) => indexUrl.replace(/[^/]*$/, `${encodeURIComponent(id)}/`);

export function localized(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value.en ?? '';
}

export function validateManifest(m, expectedId) {
  if (!m || typeof m !== 'object') throw new Error(`trail ${expectedId}: trail.json is missing or not an object`);
  if (m.id !== expectedId) throw new Error(`trail ${expectedId}: trail.json says id "${m.id}"`);
  if (typeof m.name !== 'string' || !m.name) throw new Error(`trail ${expectedId}: trail.json needs a name`);
  if (typeof m.files?.route !== 'string') throw new Error(`trail ${expectedId}: trail.json needs files.route`);
  return m;
}

// Every manifest listed in index.json, in listed order, each with `folder` and resolved
// file URLs (`urls.route`, `urls.anchors`, ...). getJSON(url) must reject on failure.
export async function loadCatalog(indexUrl, getJSON) {
  const index = await getJSON(indexUrl);
  const ids = index?.trails;
  if (!Array.isArray(ids) || !ids.length) throw new Error(`${indexUrl} lists no trails`);
  return Promise.all(ids.map(async (id) => {
    const folder = trailFolder(indexUrl, id);
    const manifest = validateManifest(await getJSON(`${folder}trail.json`), id);
    const urls = Object.fromEntries(Object.entries(manifest.files).map(([k, f]) => [k, folder + f]));
    return { ...manifest, folder, urls };
  }));
}

export function getSavedTrailId() {
  try {
    return localStorage.getItem(TRAIL_KEY);
  } catch {
    return null;
  }
}

export function saveTrailId(id) {
  try {
    localStorage.setItem(TRAIL_KEY, id);
  } catch {
    /* can't persist the choice -- the first trail will be shown next time */
  }
}

// The saved choice if it's still in the catalog, otherwise the first listed trail.
export const pickTrail = (catalog, savedId) => catalog.find((tr) => tr.id === savedId) ?? catalog[0];
