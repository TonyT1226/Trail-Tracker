import { CONFIG } from './config.js';
import { Route } from './geo.js';
import { merge, total } from './intervals.js';
import * as store from './store.js';
import { stateProgress, summarize } from './stats.js';
import { createMapView } from './map.js';
import { loadCatalog, localized, pickTrail, getSavedTrailId, saveTrailId } from './trails.js';
import { t, getLang, setLang, getUnit, setUnit, KM_PER_MI, STATE_NAMES } from './strings.js';

const TOKEN_KEY = 'at-tracker:token';
const $ = (sel) => document.querySelector(sel);
const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// Distances are stored and computed internally in miles throughout (that's what the AT data
// pipeline stamps every route/anchor/state file with). The km/mi switch only affects display:
// convert-and-label here, nowhere else.
const distValue = (miles) => (getUnit() === 'km' ? miles * KM_PER_MI : miles);
const dist = (miles) => `${fmt(distValue(miles))} ${t(getUnit() === 'km' ? 'unitKm' : 'unitMi')}`;

const app = {
  catalog: [],        // every trail listed in data/trails/index.json
  trail: null,        // the one on screen
  route: null,
  anchors: [],
  statesData: null,
  hikes: [],          // activities on this trail
  otherHikes: [],     // activities on other trails: kept, saved and exported untouched
  editingId: null,
  pickTarget: null,
  view: null,
};

// ---------------------------------------------------------------- small helpers

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter(Boolean));
  return node;
}

const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

async function getJSON(url, optional = false) {
  const res = await fetch(url);
  if (!res.ok) {
    if (optional) return null;
    throw new Error(t('loadFailed', url, res.status));
  }
  return res.json();
}

let flashTimer;
function flash(message, isError = false) {
  const box = $('#formMsg');
  box.textContent = message;
  box.classList.toggle('err', isError);
  clearTimeout(flashTimer);
  if (!isError && message) flashTimer = setTimeout(() => { box.textContent = ''; }, 4000);
}

// ---------------------------------------------------------------- language / units

function applyStaticI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  });
  document.querySelectorAll('#langSwitch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === getLang());
  });
  document.querySelectorAll('#unitSwitch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.unit === getUnit());
  });
}

function wireSwitches() {
  $('#langSwitch').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-lang]');
    if (!btn || btn.dataset.lang === getLang()) return;
    setLang(btn.dataset.lang);
    location.reload();
  });
  $('#trailSelect').addEventListener('change', (ev) => {
    saveTrailId(ev.target.value);
    location.reload();
  });
  $('#unitSwitch').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-unit]');
    if (!btn || btn.dataset.unit === getUnit()) return;
    setUnit(btn.dataset.unit);
    location.reload();
  });
}

// ---------------------------------------------------------------- resolving what the user typed

function anchorNear(mile, tolerance = 0.06) {
  return app.anchors.find((a) => Math.abs(a.mile - mile) <= tolerance);
}

// "31.7", "Neels Gap", or "Neels Gap (31.7)" -> { mile, name }
function resolvePoint(text) {
  const t2 = text.trim();
  if (!t2) throw new Error(t('fillStartEnd'));
  let result;
  if (/^\d+(\.\d+)?$/.test(t2)) {
    const mile = Number(t2);
    result = { mile, name: anchorNear(mile, 0.05)?.name ?? '' };
  } else {
    const withMile = t2.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\)\s*$/);
    if (withMile) {
      const name = withMile[1].trim();
      const typed = Number(withMile[2]);
      const hit = app.anchors.find((a) => a.name.toLowerCase() === name.toLowerCase() && Math.abs(a.mile - typed) < 0.06);
      result = { mile: hit ? hit.mile : typed, name };
    } else {
      const key = t2.toLowerCase();
      const exact = app.anchors.filter((a) => a.name.toLowerCase() === key);
      const starts = exact.length ? exact : app.anchors.filter((a) => a.name.toLowerCase().startsWith(key));
      if (starts.length > 1) throw new Error(t('multipleMatches', starts.length, t2));
      if (!starts.length) throw new Error(t('noMatch', t2));
      result = { mile: starts[0].mile, name: starts[0].name };
    }
  }
  const max = app.route.length;
  if (result.mile < 0 || result.mile > max + 0.05) {
    throw new Error(t('outOfRange', fmt(distValue(result.mile)), fmt(distValue(max))));
  }
  result.mile = Math.min(result.mile, max);
  return result;
}

// ---------------------------------------------------------------- rendering

function buildBlazes() {
  const wrap = $('#blazes');
  for (let i = 0; i < 100; i++) wrap.append(document.createElement('i'));
}

function renderBlazes(pct) {
  [...$('#blazes').children].forEach((node, i) => {
    node.style.setProperty('--f', String(Math.max(0, Math.min(1, pct - i))));
  });
}

function renderStates(merged) {
  const section = $('#statesSection');
  if (!app.statesData) {
    section.hidden = true;
    return;
  }
  const names = STATE_NAMES[getLang()];
  const list = $('#states');
  list.replaceChildren();
  for (const r of stateProgress(merged, app.statesData, CONFIG.stateGroups)) {
    const name = r.codes.map((c) => names[c] || app.statesData.states[c]?.name || c).join(' / ');
    const fill = el('span', { class: 'fill' });
    fill.style.width = `${r.pct}%`;
    const done = r.pct >= 99.95;
    list.append(
      el('li', { class: `state${done ? ' complete' : ''}` },
        el('div', { class: 'state-head' },
          el('span', { class: 'state-name', text: name }, done ? el('span', { class: 'state-done-badge', text: t('stateCompleted') }) : null),
          el('span', { class: 'state-num', text: `${fmt(distValue(r.done))} / ${fmt(distValue(r.total))}` })),
        el('div', {
          class: 'track', role: 'progressbar', 'aria-label': name,
          'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(r.pct)),
        }, fill)),
    );
  }
}

function hikeRow(h) {
  const [lo, hi] = store.bounds(h);
  const btn = (label, act) => el('button', { type: 'button', class: 'link', 'data-act': act, text: label });
  return el('li', { class: 'hike', 'data-id': h.id },
    el('time', { dateTime: h.date, text: h.date }),
    el('div', { class: 'hike-main' },
      el('span', { class: 'hike-names', text: `${h.fromName || fmt(distValue(h.range.from))} → ${h.toName || fmt(distValue(h.range.to))}` }),
      el('span', { class: 'hike-len', text: dist(hi - lo) })),
    h.note ? el('p', { class: 'hike-note', text: h.note }) : null,
    el('div', { class: 'hike-actions' }, btn(t('focusBtn'), 'focus'), btn(t('editBtn'), 'edit'), btn(t('delBtn'), 'del')));
}

function render() {
  const s = summarize(app.hikes, app.route.length);
  $('#doneMi').textContent = fmt(distValue(s.done));
  $('#pct').textContent = `${fmt(s.pct)}%`;
  $('#remainMi').textContent = dist(s.remaining);
  $('#dayCount').textContent = t('days', s.dayCount);
  $('#hikeCount').textContent = t('hikesCount', s.hikeCount);
  $('#lastDate').textContent = s.lastDate ?? '—';
  renderBlazes(s.pct);
  $('#blazes').setAttribute('aria-label', t('completedAriaLabel', fmt(s.pct)));
  renderStates(s.merged);

  const sorted = [...app.hikes].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  $('#hikes').replaceChildren(...sorted.map(hikeRow));
  $('#emptyMsg').hidden = app.hikes.length > 0;

  app.view?.setDone(app.route.featuresFor(s.merged));
}

function updatePreview() {
  const box = $('#preview');
  box.textContent = '';
  const fromT = $('#fFrom').value;
  const toT = $('#fTo').value;
  if (!fromT.trim() || !toT.trim()) return;
  try {
    const a = resolvePoint(fromT);
    const b = resolvePoint(toT);
    const len = Math.abs(b.mile - a.mile);
    const others = app.hikes.filter((h) => h.id !== app.editingId).map(store.bounds);
    const before = total(merge(others));
    const after = total(merge([...others, [Math.min(a.mile, b.mile), Math.max(a.mile, b.mile)]]));
    const fresh = after - before;
    const dup = len - fresh;
    box.textContent = t('previewMsg', dist(len), dist(fresh), dup > 0.05 ? dist(dup) : null);
  } catch {
    /* incomplete input while typing: say nothing until submit */
  }
}

// ---------------------------------------------------------------- state changes

// `hikes` is this trail's full list; other trails' activities ride along unchanged.
function commit(hikes) {
  app.hikes = hikes;
  try {
    store.save([...app.otherHikes, ...hikes]);
  } catch {
    flash(t('saveFailedPrivateMode'), true);
  }
  render();
}

function resetForm() {
  app.editingId = null;
  $('#fFrom').value = '';
  $('#fTo').value = '';
  $('#fNote').value = '';
  $('#formTitle').textContent = t('formTitle');
  $('#submitBtn').textContent = t('submitBtn');
  $('#cancelEdit').hidden = true;
  $('#preview').textContent = '';
  endPick();
}

function submitForm(ev) {
  ev.preventDefault();
  try {
    const a = resolvePoint($('#fFrom').value);
    const b = resolvePoint($('#fTo').value);
    if (Math.abs(a.mile - b.mile) < 0.05) throw new Error(t('sameSpot'));
    const hike = store.normalizeActivity({
      id: app.editingId || undefined,
      trailId: app.trail.id,
      date: $('#fDate').value,
      range: { from: a.mile, to: b.mile },
      fromName: a.name,
      toName: b.name,
      note: $('#fNote').value.trim(),
    });
    const editing = Boolean(app.editingId);
    commit(editing ? app.hikes.map((h) => (h.id === hike.id ? hike : h)) : [...app.hikes, hike]);
    const [lo, hi] = store.bounds(hike);
    resetForm();
    flash(editing ? t('savedEdit') : t('logged', dist(hi - lo)));
    app.view?.focus(lo, hi);
  } catch (e) {
    flash(e.message, true);
  }
}

function startEdit(h) {
  app.editingId = h.id;
  $('#fDate').value = h.date;
  $('#fFrom').value = h.fromName ? `${h.fromName} (${h.range.from})` : String(h.range.from);
  $('#fTo').value = h.toName ? `${h.toName} (${h.range.to})` : String(h.range.to);
  $('#fNote').value = h.note;
  $('#formTitle').textContent = t('editFormTitle');
  $('#submitBtn').textContent = t('saveEditBtn');
  $('#cancelEdit').hidden = false;
  updatePreview();
  $('#hikeForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onHikeClick(ev) {
  const btn = ev.target.closest('button[data-act]');
  const row = ev.target.closest('li[data-id]');
  if (!btn || !row) return;
  const hike = app.hikes.find((h) => h.id === row.dataset.id);
  if (!hike) return;
  if (btn.dataset.act === 'focus') {
    const [lo, hi] = store.bounds(hike);
    app.view?.focus(lo, hi);
  } else if (btn.dataset.act === 'edit') {
    startEdit(hike);
  } else if (btn.dataset.act === 'del') {
    if (confirm(t('deleteConfirm', hike.date))) {
      if (app.editingId === hike.id) resetForm();
      commit(app.hikes.filter((h) => h.id !== hike.id));
    }
  }
}

// ---------------------------------------------------------------- picking a point on the map

function endPick() {
  app.pickTarget = null;
  app.view?.setPickMode(false);
  $('#pickHint').hidden = true;
  document.querySelectorAll('.pick').forEach((b) => b.classList.remove('active'));
}

function startPick(targetId) {
  if (app.pickTarget === targetId) {
    endPick();
    return;
  }
  endPick();
  app.pickTarget = targetId;
  app.view.setPickMode(true);
  $('#pickHint').textContent = targetId === 'fFrom' ? t('pickStartHint') : t('pickEndHint');
  $('#pickHint').hidden = false;
  document.querySelector(`.pick[data-target="${targetId}"]`).classList.add('active');
}

function onPick({ mile, hit }) {
  if (!hit) {
    $('#pickHint').textContent = t('pickTooFar');
    return;
  }
  const near = anchorNear(mile, 0.15);
  const text = near ? `${near.name} (${near.mile.toFixed(1)})` : mile.toFixed(1);
  const target = app.pickTarget;
  $(`#${target}`).value = text;
  endPick();
  updatePreview();
  if (target === 'fFrom' && !$('#fTo').value) $('#fTo').focus();
}

// ---------------------------------------------------------------- map notices and token

function showMapMessage(...nodes) {
  const box = $('#mapMsg');
  box.replaceChildren(...nodes);
  box.hidden = false;
}

function tokenPrompt(reason) {
  const note = el('p', { class: 'map-note', text: '' });
  const input = el('input', {
    type: 'text', placeholder: 'pk.eyJ1…', autocomplete: 'off', spellcheck: false,
    'aria-label': t('mapboxTokenAria'),
  });
  const save = el('button', { type: 'button', text: t('saveAndLoadMap') });
  save.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value.startsWith('pk.')) {
      note.textContent = t('tokenNeedsPk');
      return;
    }
    localStorage.setItem(TOKEN_KEY, value);
    location.reload();
  });
  showMapMessage(
    el('p', { text: reason }),
    el('div', { class: 'inline' }, input, save),
    note,
    el('p', { class: 'map-note', text: t('tokenLocalNote') }),
  );
}

// ---------------------------------------------------------------- trails

function splitByTrail(activities) {
  app.hikes = activities.filter((h) => h.trailId === app.trail.id);
  app.otherHikes = activities.filter((h) => h.trailId !== app.trail.id);
}

function renderTrailHeader() {
  const { name } = app.trail;
  const lang = getLang();
  document.title = `${name} · ${t('title')}`;
  $('#trailName').textContent = name;
  $('#trailSubtitle').textContent = localized(app.trail.subtitle, lang);
  $('#map').setAttribute('aria-label', t('mapAriaLabel', name));
  $('#credit').textContent = [t('localOnlyNote'), localized(app.trail.credit, lang)].filter(Boolean).join(' ');
  // The picker only appears once there is more than one trail to pick from.
  const select = $('#trailSelect');
  select.replaceChildren(...app.catalog.map((tr) =>
    el('option', { value: tr.id, text: tr.shortName || tr.id, title: tr.name, selected: tr.id === app.trail.id })));
  select.hidden = app.catalog.length < 2;
}

// ---------------------------------------------------------------- start

export async function start() {
  applyStaticI18n();
  wireSwitches();
  try {
    app.catalog = await loadCatalog(CONFIG.data.trails, (url) => getJSON(url));
    app.trail = pickTrail(app.catalog, getSavedTrailId());
    const { urls } = app.trail;
    const optional = (url) => (url ? getJSON(url, true) : null);
    const [routeData, anchorData, statesData, seed] = await Promise.all([
      getJSON(urls.route),
      optional(urls.anchors),
      optional(urls.states),
      getJSON(CONFIG.data.seedHikes, true),
    ]);
    app.route = new Route(routeData);
    app.anchors = anchorData?.anchors ?? [];
    app.statesData = statesData;
    const stored = store.load();
    splitByTrail(stored ?? (seed ? store.parseImport(JSON.stringify(seed)) : []));

    renderTrailHeader();
    $('#placeholderBanner').hidden = !routeData.placeholder;
    $('#totalMi').textContent = dist(app.route.length);
    $('#anchorList').replaceChildren(...app.anchors.map((a) =>
      el('option', { value: `${a.name} (${a.mile.toFixed(1)})`, label: dist(a.mile) })));
    $('#fDate').value = today();
    buildBlazes();
  } catch (e) {
    const hint = location.protocol === 'file:' ? t('fileProtocolHint') : e.message;
    $('#loadError').textContent = t('loadErrorPrefix', hint);
    $('#loadError').hidden = false;
    return;
  }

  // form + list
  $('#hikeForm').addEventListener('submit', submitForm);
  $('#hikeForm').addEventListener('input', () => { flash(''); updatePreview(); });
  $('#cancelEdit').addEventListener('click', resetForm);
  $('#hikes').addEventListener('click', onHikeClick);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') endPick(); });
  $('#exportBtn').addEventListener('click', () => {
    const all = [...app.otherHikes, ...app.hikes];
    const url = URL.createObjectURL(new Blob([store.serialize(all)], { type: 'application/json' }));
    const a = el('a', { href: url, download: `trail-hikes-${today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('#importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const incoming = store.parseImport(await file.text());
      if (confirm(t('importConfirm', incoming.length))) {
        splitByTrail(store.mergeById([...app.otherHikes, ...app.hikes], incoming));
        commit(app.hikes);
        const elsewhere = incoming.filter((h) => h.trailId !== app.trail.id).length;
        flash(t('importedFlash', incoming.length, elsewhere));
      }
    } catch (e) {
      flash(e.message, true);
    }
  });

  // map
  const token = CONFIG.mapboxToken || localStorage.getItem(TOKEN_KEY) || '';
  const mapboxgl = globalThis.mapboxgl;
  if (!mapboxgl) {
    showMapMessage(el('p', { text: t('mapScriptMissing') }));
  } else if (!token) {
    tokenPrompt(t('noTokenYet'));
  } else {
    app.view = createMapView({
      mapboxgl,
      token,
      style: CONFIG.mapStyle,
      route: app.route,
      anchors: app.anchors,
      bordersUrl: app.trail.urls.borders,
      container: 'map',
      unit: getUnit(),
      formatMile: (mile) => t('mapPopupMile', dist(mile)),
      onPick,
      onError: (err) => {
        if (err?.status === 401 || err?.status === 403) {
          tokenPrompt(t('tokenRejected'));
        }
      },
    });
    $('#fitBtn').addEventListener('click', () => app.view.fit());
    $('#terrainBtn').addEventListener('click', (ev) => {
      ev.currentTarget.setAttribute('aria-pressed', String(app.view.toggleTerrain()));
    });
    document.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => startPick(b.dataset.target)));
  }
  if (!app.view) {
    $('.map-tools').hidden = true;
    document.querySelectorAll('.pick').forEach((b) => { b.hidden = true; });
  }

  render();
}

if (!globalThis.__AT_TEST__) start();
