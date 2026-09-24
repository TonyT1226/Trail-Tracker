// All user-facing text, in English (default) and Chinese. Add a language by adding a key
// to LOCALES and a matching object to STRINGS/STATE_NAMES -- nothing else needs to change.
const LANG_KEY = 'at-tracker:lang';
const UNIT_KEY = 'at-tracker:unit';
export const KM_PER_MI = 1.609344;

export const LOCALES = ['en', 'zh'];

export const STATE_NAMES = {
  en: {
    GA: 'Georgia', NC: 'North Carolina', TN: 'Tennessee', VA: 'Virginia', WV: 'West Virginia',
    MD: 'Maryland', PA: 'Pennsylvania', NJ: 'New Jersey', NY: 'New York', CT: 'Connecticut',
    MA: 'Massachusetts', VT: 'Vermont', NH: 'New Hampshire', ME: 'Maine',
    CA: 'California', OR: 'Oregon', WA: 'Washington',
  },
  zh: {
    GA: '乔治亚', NC: '北卡罗来纳', TN: '田纳西', VA: '弗吉尼亚', WV: '西弗吉尼亚',
    MD: '马里兰', PA: '宾夕法尼亚', NJ: '新泽西', NY: '纽约', CT: '康涅狄格',
    MA: '马萨诸塞', VT: '佛蒙特', NH: '新罕布什尔', ME: '缅因',
    CA: '加利福尼亚', OR: '俄勒冈', WA: '华盛顿',
  },
};

const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
const hikesCount = (n) => `${n} hike${n === 1 ? '' : 's'}`;

export const STRINGS = {
  en: {
    title: 'Trail Tracker',
    mapAriaLabel: (name) => `${name} map`,
    trailSelectAria: 'Trail',
    allTrails: 'All trails', allTrailsShort: 'All',
    overviewSubtitle: (n) => `Progress on all ${n} trails`,
    trailsTitle: 'Progress by trail',
    overviewHint: 'To log a hike, pick a trail from the menu at the top.',
    openTrailAria: (name) => `Open ${name}`,
    mapPopupTrailMile: (name, dist) => `${name} · mile ${dist}`,
    fitBtn: 'View full trail',
    terrainBtn: '3D terrain',
    placeholderBanner: 'This is a placeholder route: a few dozen waypoints connected by straight lines, not the real trail, and mileage is estimated. Run the data pipeline per SPEC.md to switch to the real route.',
    progressAriaLabel: 'Overall progress',
    completedAriaLabel: (pct) => `${pct}% complete`,
    unitMi: 'mi', unitKm: 'km',
    remainingLabel: 'Remaining', daysLabel: 'Days hiked', hikesLabel: 'Hikes logged', lastLabel: 'Last hike',
    statesTitle: 'Progress by state', stateCompleted: 'done',
    formTitle: 'Log a hike', editFormTitle: 'Edit this hike',
    dateLabel: 'Date', startLabel: 'Start', endLabel: 'End',
    mileOrName: 'Mile or place name',
    pickStartAria: 'Pick start on the map', pickEndAria: 'Pick end on the map', pickBtn: 'Pick',
    noteLabel: 'Note', notePlaceholder: 'Weather, who you went with, where you stayed',
    submitBtn: 'Log this hike', saveEditBtn: 'Save changes', cancelEditBtn: 'Cancel edit',
    hikesTitle: 'Hike log',
    emptyMsg: 'No hikes logged yet. Fill in the form above, or click "Pick" to choose a start and end point on the map.',
    exportBtn: 'Export JSON', importBtn: 'Import JSON',
    localOnlyNote: 'Hikes are only saved in this browser -- export a backup before switching devices.',
    focusBtn: 'Locate', editBtn: 'Edit', delBtn: 'Delete',
    loadFailed: (url, status) => `${url} failed to load (HTTP ${status})`,
    saveFailedPrivateMode: 'Your browser won’t let this page save data (maybe private/incognito mode). Click "Export JSON" to back up first.',
    fillStartEnd: 'Enter a start and end point',
    multipleMatches: (n, text) => `${n} places match "${text}" — pick one from the list, or type a mile number`,
    noMatch: (text) => `Can’t find "${text}". Type a mile number, or pick a name from the list`,
    outOfRange: (mile, max) => `Mile ${mile} is out of range (0 to ${max})`,
    sameSpot: 'Start and end are basically the same spot',
    savedEdit: 'Changes saved',
    logged: (dist) => `Logged ${dist}`,
    previewMsg: (lenDist, freshDist, dupDist) =>
      `${lenDist} total, ${freshDist} new${dupDist ? ` (${dupDist} already walked, not double-counted)` : ''}`,
    deleteConfirm: (date) => `Delete the hike logged on ${date}?`,
    pickStartHint: 'Click a point on the trail to set the start',
    pickEndHint: 'Click a point on the trail to set the end',
    pickTooFar: 'That’s too far from the trail — click closer to the line',
    mapScriptMissing: 'The map script didn’t load. Check your connection and refresh the page — the log and stats below still work.',
    noTokenYet: 'No Mapbox token yet. Enter a public token (starts with pk.) to load the map, or create one for free at account.mapbox.com.',
    tokenRejected: 'Mapbox rejected this token (401/403). Check that it’s valid and that your URL restrictions include this site.',
    tokenNeedsPk: 'Enter a public token starting with pk. — not a secret key starting with sk.',
    mapboxTokenAria: 'Mapbox public token',
    saveAndLoadMap: 'Save & load map',
    tokenLocalNote: 'This token is only saved in this browser. To keep using it long-term, put it in js/config.js.',
    fileProtocolHint: 'Can’t open index.html by double-clicking. Double-click start.command, or run "python3 scripts/serve.py" in the project folder and visit http://localhost:8000.',
    loadErrorPrefix: (hint) => `Couldn’t load data: ${hint}`,
    importConfirm: (n) => `Import ${n} hike${n === 1 ? '' : 's'} and merge with what’s already here? (entries with the same id are overwritten)`,
    importedFlash: (n, elsewhere = 0) => `Imported ${n} hike${n === 1 ? '' : 's'}${
      elsewhere ? ` (${elsewhere} on other trails -- switch trails to see ${elsewhere === 1 ? 'it' : 'them'})` : ''}`,
    mapPopupMile: (dist) => `Mile ${dist}`,
    days, hikesCount,
    langToggleAria: 'Language', unitToggleAria: 'Distance unit',
    dateInvalid: 'Date must be in YYYY-MM-DD format',
    mileInvalid: 'Start or end mile is invalid',
    notJson: 'That’s not a valid JSON file',
    noActivitiesFound: 'No hikes found in this file',
    recordProblem: (i, msg) => `Record ${i} has a problem: ${msg}`,
  },
  zh: {
    title: '长线徒步进度',
    mapAriaLabel: (name) => `${name} 地图`,
    trailSelectAria: '路线',
    allTrails: '全部路线', allTrailsShort: '全部',
    overviewSubtitle: (n) => `${n} 条路线的总进度`,
    trailsTitle: '各路线进度',
    overviewHint: '要记录徒步，先在顶部菜单里选一条路线。',
    openTrailAria: (name) => `打开 ${name}`,
    mapPopupTrailMile: (name, dist) => `${name} · 里程 ${dist}`,
    fitBtn: '看全程',
    terrainBtn: '3D 地形',
    placeholderBanner: '现在显示的是占位路线：用直线连起几十个航点，不是真实路线，里程也是估算。按 SPEC.zh.md 运行数据脚本后会换成真实路线。',
    progressAriaLabel: '总进度',
    completedAriaLabel: (pct) => `已完成 ${pct}%`,
    unitMi: '英里', unitKm: '公里',
    remainingLabel: '剩余', daysLabel: '徒步天数', hikesLabel: '记录', lastLabel: '最近一次',
    statesTitle: '各州进度', stateCompleted: '已走完',
    formTitle: '记录一段徒步', editFormTitle: '编辑这段记录',
    dateLabel: '完成日期', startLabel: '起点', endLabel: '终点',
    mileOrName: '里程或地名',
    pickStartAria: '在地图上选起点', pickEndAria: '在地图上选终点', pickBtn: '选点',
    noteLabel: '备注', notePlaceholder: '天气、同行的人、住在哪',
    submitBtn: '记录这段', saveEditBtn: '保存修改', cancelEditBtn: '取消编辑',
    hikesTitle: '徒步记录',
    emptyMsg: '还没有记录。填一段上面的表单，或者点"选点"在地图上选起点和终点。',
    exportBtn: '导出 JSON', importBtn: '导入 JSON',
    localOnlyNote: '记录只保存在这个浏览器里，换设备前先导出。',
    focusBtn: '定位', editBtn: '编辑', delBtn: '删除',
    loadFailed: (url, status) => `${url} 加载失败（HTTP ${status}）`,
    saveFailedPrivateMode: '浏览器不允许保存数据（可能是无痕模式）。请先点"导出 JSON"备份。',
    fillStartEnd: '请填写起点和终点',
    multipleMatches: (n, text) => `有 ${n} 个地点匹配"${text}"，请从下拉列表里选，或直接输入里程`,
    noMatch: (text) => `找不到"${text}"。可以输入里程数，或从下拉列表里选地名`,
    outOfRange: (mile, max) => `里程 ${mile} 超出范围（0 到 ${max}）`,
    sameSpot: '起点和终点几乎在同一处',
    savedEdit: '已保存修改',
    logged: (dist) => `已记录 ${dist}`,
    previewMsg: (lenDist, freshDist, dupDist) =>
      `${lenDist}，新增 ${freshDist}${dupDist ? `（${dupDist}之前走过，不重复计算）` : ''}`,
    deleteConfirm: (date) => `删除 ${date} 这段记录？`,
    pickStartHint: '在地图上点一下路线，选择起点',
    pickEndHint: '在地图上点一下路线，选择终点',
    pickTooFar: '离路线太远了，点在路线附近',
    mapScriptMissing: '地图脚本没有加载出来。检查网络后刷新页面；下面的记录和统计仍然可用。',
    noTokenYet: '还没有 Mapbox token。填入公开 token（pk. 开头）后加载地图；没有的话，在 account.mapbox.com 创建一个。',
    tokenRejected: 'Mapbox 拒绝了这个 token（401/403）。检查 token 是否有效，以及 URL 限制里是否包含当前网址。',
    tokenNeedsPk: '要填公开 token，以 pk. 开头。不要用 sk. 开头的密钥。',
    mapboxTokenAria: 'Mapbox 公开 token',
    saveAndLoadMap: '保存并加载地图',
    tokenLocalNote: '这个 token 只保存在这台设备的浏览器里。想长期使用，把它写进 js/config.js。',
    fileProtocolHint: '不能直接双击打开 index.html。双击 start.command，或者在项目目录运行 python3 scripts/serve.py，再访问 http://localhost:8000。',
    loadErrorPrefix: (hint) => `数据加载失败：${hint}`,
    importConfirm: (n) => `导入 ${n} 条记录，并与现有记录合并（相同 id 会被覆盖）？`,
    importedFlash: (n, elsewhere = 0) => `已导入 ${n} 条记录${elsewhere ? `（其中 ${elsewhere} 条属于其他路线，切换路线后可以看到）` : ''}`,
    mapPopupMile: (dist) => `里程 ${dist}`,
    days: (n) => `${n} 天`,
    hikesCount: (n) => `${n} 段`,
    langToggleAria: '语言', unitToggleAria: '距离单位',
    dateInvalid: '日期格式应为 YYYY-MM-DD',
    mileInvalid: '起点或终点的里程无效',
    notJson: '这不是有效的 JSON 文件',
    noActivitiesFound: '文件里没有找到记录',
    recordProblem: (i, msg) => `第 ${i} 条记录有问题：${msg}`,
  },
};

// store.js (which has no DOM) calls t() for error messages too, and runs under plain
// Node in tests where there is no global localStorage at all -- fall back to English.
function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no localStorage in this environment (or it's full/blocked) -- nothing to persist */
  }
}

export function getLang() {
  const saved = readStorage(LANG_KEY);
  return LOCALES.includes(saved) ? saved : 'en';
}

export function setLang(lang) {
  writeStorage(LANG_KEY, lang);
}

export function getUnit() {
  return readStorage(UNIT_KEY) === 'km' ? 'km' : 'mi';
}

export function setUnit(unit) {
  writeStorage(UNIT_KEY, unit === 'km' ? 'km' : 'mi');
}

// t('key') -> string; t('key', ...args) -> calls STRINGS[lang][key](...args)
export function t(key, ...args) {
  const value = STRINGS[getLang()][key];
  return typeof value === 'function' ? value(...args) : value;
}
