// The hike log. Lives in this browser's localStorage; export/import JSON to move it
// between devices or to keep a backup (or commit it as data/hikes.json).
//
// A hike: { id, date: "YYYY-MM-DD", from, to, fromName, toName, note }
// `from`/`to` are miles as walked, so from > to means southbound.

const KEY = 'at-tracker:hikes:v1';
const round3 = (n) => Math.round(n * 1000) / 1000;

export function newId() {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeHike(h) {
  const from = Number(h.from);
  const to = Number(h.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('起点或终点的里程无效');
  if (typeof h.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) {
    throw new Error('日期格式应为 YYYY-MM-DD');
  }
  return {
    id: h.id || newId(),
    date: h.date,
    from: round3(from),
    to: round3(to),
    fromName: String(h.fromName || ''),
    toName: String(h.toName || ''),
    note: String(h.note || ''),
  };
}

export const bounds = (h) => [Math.min(h.from, h.to), Math.max(h.from, h.to)];

// null = nothing has ever been saved here (as opposed to an empty log)
export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map(normalizeHike) : null;
  } catch {
    return null;
  }
}

export function save(hikes, storage = globalThis.localStorage) {
  storage.setItem(KEY, JSON.stringify(hikes));
}

export function serialize(hikes) {
  return JSON.stringify({ app: 'at-tracker', version: 1, exportedAt: new Date().toISOString(), hikes }, null, 2);
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('这不是有效的 JSON 文件');
  }
  const list = Array.isArray(data) ? data : data?.hikes;
  if (!Array.isArray(list)) throw new Error('文件里没有找到 hikes 列表');
  return list.map((h, i) => {
    try {
      return normalizeHike(h);
    } catch (e) {
      throw new Error(`第 ${i + 1} 条记录有问题：${e.message}`);
    }
  });
}

// merge by id; entries in `incoming` win
export function mergeById(existing, incoming) {
  const map = new Map(existing.map((h) => [h.id, h]));
  for (const h of incoming) map.set(h.id, h);
  return [...map.values()];
}
