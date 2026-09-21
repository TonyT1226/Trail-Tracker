import { CONFIG } from './config.js';
import { Route } from './geo.js';
import { merge, total } from './intervals.js';
import * as store from './store.js';
import { stateProgress, summarize } from './stats.js';
import { createMapView } from './map.js';
import { STATE_NAMES } from './strings.js';

const TOKEN_KEY = 'at-tracker:token';
const $ = (sel) => document.querySelector(sel);
const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const app = {
  route: null,
  anchors: [],
  statesData: null,
  hikes: [],
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
    throw new Error(`${url} 加载失败（HTTP ${res.status}）`);
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

// ---------------------------------------------------------------- resolving what the user typed

function anchorNear(mile, tolerance = 0.06) {
  return app.anchors.find((a) => Math.abs(a.mile - mile) <= tolerance);
}

// "31.7", "Neels Gap", or "Neels Gap (31.7)" -> { mile, name }
function resolvePoint(text) {
  const t = text.trim();
  if (!t) throw new Error('请填写起点和终点');
  let result;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const mile = Number(t);
    result = { mile, name: anchorNear(mile, 0.05)?.name ?? '' };
  } else {
    const withMile = t.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\)\s*$/);
    if (withMile) {
      const name = withMile[1].trim();
      const typed = Number(withMile[2]);
      const hit = app.anchors.find((a) => a.name.toLowerCase() === name.toLowerCase() && Math.abs(a.mile - typed) < 0.06);
      result = { mile: hit ? hit.mile : typed, name };
    } else {
      const key = t.toLowerCase();
      const exact = app.anchors.filter((a) => a.name.toLowerCase() === key);
      const starts = exact.length ? exact : app.anchors.filter((a) => a.name.toLowerCase().startsWith(key));
      if (starts.length > 1) throw new Error(`有 ${starts.length} 个地点匹配“${t}”，请从下拉列表里选，或直接输入里程`);
      if (!starts.length) throw new Error(`找不到“${t}”。可以输入里程数，或从下拉列表里选地名`);
      result = { mile: starts[0].mile, name: starts[0].name };
    }
  }
  const max = app.route.length;
  if (result.mile < 0 || result.mile > max + 0.05) {
    throw new Error(`里程 ${fmt(result.mile)} 超出范围（0 到 ${fmt(max)}）`);
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
  const list = $('#states');
  list.replaceChildren();
  for (const r of stateProgress(merged, app.statesData, CONFIG.stateGroups)) {
    const name = r.codes.map((c) => STATE_NAMES[c] || c).join(' / ');
    const fill = el('span', { class: 'fill' });
    fill.style.width = `${r.pct}%`;
    list.append(
      el('li', { class: `state${r.pct >= 99.95 ? ' complete' : ''}` },
        el('div', { class: 'state-head' },
          el('span', { class: 'state-name', text: name }),
          el('span', { class: 'state-num', text: `${fmt(r.done)} / ${fmt(r.total)}` })),
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
      el('span', { class: 'hike-names', text: `${h.fromName || fmt(h.from)} → ${h.toName || fmt(h.to)}` }),
      el('span', { class: 'hike-len', text: `${fmt(hi - lo)} 英里` })),
    h.note ? el('p', { class: 'hike-note', text: h.note }) : null,
    el('div', { class: 'hike-actions' }, btn('定位', 'focus'), btn('编辑', 'edit'), btn('删除', 'del')));
}

function render() {
  const s = summarize(app.hikes, app.route.length);
  $('#doneMi').textContent = fmt(s.done);
  $('#pct').textContent = `${fmt(s.pct)}%`;
  $('#remainMi').textContent = `${fmt(s.remaining)} 英里`;
  $('#dayCount').textContent = `${s.dayCount} 天`;
  $('#hikeCount').textContent = `${s.hikeCount} 段`;
  $('#lastDate').textContent = s.lastDate ?? '—';
  renderBlazes(s.pct);
  $('#blazes').setAttribute('aria-label', `已完成 ${fmt(s.pct)}%`);
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
    box.textContent = `${fmt(len)} 英里，新增 ${fmt(fresh)} 英里${dup > 0.05 ? `（${fmt(dup)} 英里之前走过，不重复计算）` : ''}`;
  } catch {
    /* incomplete input while typing: say nothing until submit */
  }
}

// ---------------------------------------------------------------- state changes

function commit(hikes) {
  app.hikes = hikes;
  try {
    store.save(hikes);
  } catch {
    flash('浏览器不允许保存数据（可能是无痕模式）。请先点“导出 JSON”备份。', true);
  }
  render();
}

function resetForm() {
  app.editingId = null;
  $('#fFrom').value = '';
  $('#fTo').value = '';
  $('#fNote').value = '';
  $('#formTitle').textContent = '记录一段徒步';
  $('#submitBtn').textContent = '记录这段';
  $('#cancelEdit').hidden = true;
  $('#preview').textContent = '';
  endPick();
}

function submitForm(ev) {
  ev.preventDefault();
  try {
    const a = resolvePoint($('#fFrom').value);
    const b = resolvePoint($('#fTo').value);
    if (Math.abs(a.mile - b.mile) < 0.05) throw new Error('起点和终点几乎在同一处');
    const hike = store.normalizeHike({
      id: app.editingId || undefined,
      date: $('#fDate').value,
      from: a.mile,
      to: b.mile,
      fromName: a.name,
      toName: b.name,
      note: $('#fNote').value.trim(),
    });
    const editing = Boolean(app.editingId);
    commit(editing ? app.hikes.map((h) => (h.id === hike.id ? hike : h)) : [...app.hikes, hike]);
    const [lo, hi] = store.bounds(hike);
    resetForm();
    flash(editing ? '已保存修改' : `已记录 ${fmt(hi - lo)} 英里`);
    app.view?.focus(lo, hi);
  } catch (e) {
    flash(e.message, true);
  }
}

function startEdit(h) {
  app.editingId = h.id;
  $('#fDate').value = h.date;
  $('#fFrom').value = h.fromName ? `${h.fromName} (${h.from})` : String(h.from);
  $('#fTo').value = h.toName ? `${h.toName} (${h.to})` : String(h.to);
  $('#fNote').value = h.note;
  $('#formTitle').textContent = '编辑这段记录';
  $('#submitBtn').textContent = '保存修改';
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
    if (confirm(`删除 ${hike.date} 这段记录？`)) {
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
  $('#pickHint').textContent = targetId === 'fFrom' ? '在地图上点一下路线，选择起点' : '在地图上点一下路线，选择终点';
  $('#pickHint').hidden = false;
  document.querySelector(`.pick[data-target="${targetId}"]`).classList.add('active');
}

function onPick({ mile, hit }) {
  if (!hit) {
    $('#pickHint').textContent = '离路线太远了，点在路线附近';
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
    'aria-label': 'Mapbox 公开 token',
  });
  const save = el('button', { type: 'button', text: '保存并加载地图' });
  save.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value.startsWith('pk.')) {
      note.textContent = '要填公开 token，以 pk. 开头。不要用 sk. 开头的密钥。';
      return;
    }
    localStorage.setItem(TOKEN_KEY, value);
    location.reload();
  });
  showMapMessage(
    el('p', { text: reason }),
    el('div', { class: 'inline' }, input, save),
    note,
    el('p', { class: 'map-note', text: '这个 token 只保存在这台设备的浏览器里。想长期使用，把它写进 js/config.js。' }),
  );
}

// ---------------------------------------------------------------- start

export async function start() {
  try {
    const [routeData, anchorData, statesData, seed] = await Promise.all([
      getJSON(CONFIG.data.route),
      getJSON(CONFIG.data.anchors, true),
      getJSON(CONFIG.data.states, true),
      getJSON(CONFIG.data.seedHikes, true),
    ]);
    app.route = new Route(routeData);
    app.anchors = anchorData?.anchors ?? [];
    app.statesData = statesData;
    const stored = store.load();
    app.hikes = stored ?? (seed ? store.parseImport(JSON.stringify(seed)) : []);

    $('#placeholderBanner').hidden = !routeData.placeholder;
    $('#totalMi').textContent = fmt(app.route.length);
    $('#anchorList').replaceChildren(...app.anchors.map((a) =>
      el('option', { value: `${a.name} (${a.mile.toFixed(1)})`, label: `${fmt(a.mile)} 英里` })));
    $('#fDate').value = today();
    buildBlazes();
  } catch (e) {
    const hint = location.protocol === 'file:'
      ? '不能直接双击打开 index.html。在项目目录运行 python3 -m http.server，再访问 http://localhost:8000'
      : e.message;
    $('#loadError').textContent = `数据加载失败：${hint}`;
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
    const url = URL.createObjectURL(new Blob([store.serialize(app.hikes)], { type: 'application/json' }));
    const a = el('a', { href: url, download: `at-hikes-${today()}.json` });
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
      if (confirm(`导入 ${incoming.length} 条记录，并与现有记录合并（相同 id 会被覆盖）？`)) {
        commit(store.mergeById(app.hikes, incoming));
        flash(`已导入 ${incoming.length} 条记录`);
      }
    } catch (e) {
      flash(e.message, true);
    }
  });

  // map
  const token = CONFIG.mapboxToken || localStorage.getItem(TOKEN_KEY) || '';
  const mapboxgl = globalThis.mapboxgl;
  if (!mapboxgl) {
    showMapMessage(el('p', { text: '地图脚本没有加载出来。检查网络后刷新页面；下面的记录和统计仍然可用。' }));
  } else if (!token) {
    tokenPrompt('还没有 Mapbox token。填入公开 token（pk. 开头）后加载地图；没有的话，在 account.mapbox.com 创建一个。');
  } else {
    app.view = createMapView({
      mapboxgl,
      token,
      style: CONFIG.mapStyle,
      route: app.route,
      anchors: app.anchors,
      bordersUrl: CONFIG.data.borders,
      container: 'map',
      onPick,
      onError: (err) => {
        if (err?.status === 401 || err?.status === 403) {
          tokenPrompt('Mapbox 拒绝了这个 token（401/403）。检查 token 是否有效，以及 URL 限制里是否包含当前网址。');
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
