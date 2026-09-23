# 技术说明

*(English: [SPEC.md](SPEC.md))*

代码怎么组织、数据怎么流动、步道数据从哪来。这个项目是做什么的、怎么用，见 [README.zh.md](README.zh.md)。

## 整体结构

```
index.html            页面骨架
start.command         双击启动本地服务器并打开浏览器
css/style.css         样式（松绿面板 + 白色路标 + 洋红完成线）
js/
  config.js           你要改的设置：Mapbox token、州合并规则、数据路径
  trails.js            读取路线目录（data/trails/index.json）和每条路线的说明文件
  strings.js           所有界面文案（中英双语）及语言/单位切换逻辑
  app.js               页面逻辑：读数据、表单、记录列表、统计
  map.js               所有 Mapbox 代码都在这里（底图、路线、地名、州界、3D 地形、点选里程）
  geo.js               路线几何：按里程取点/切段、找离点击处最近的里程
  intervals.js         里程区间合并（重复、重叠的徒步不会重复计算）
  store.js             徒步记录的存取，浏览器 localStorage + 导入导出 JSON
  stats.js             总进度和各州进度
data/trails/
  index.json           要加载哪些路线文件夹，顺序即切换菜单里的顺序
  AT/                  每条路线一个文件夹（"路线数据包"）
    trail.json         说明文件：id、名称、简称、颜色、副标题、署名，以及下面哪些文件存在
    route.json         路线：坐标 + 每个点的里程
    anchors.json       地名（村镇、垭口、庇护所）及其里程（可选）
    states.json        每个州对应的里程区间（可选）
    state_borders.geojson  州界虚线（可选）
scripts/              数据流水线（Python），生成上面 AT 的文件
tests/                JS 与 Python 测试
```

## 路线数据包

每条路线是 `data/trails/` 下的一个文件夹，里面有一份 `trail.json` 说明文件；`data/trails/index.json` 列出要加载哪些文件夹。新增一条路线只改数据：生成它的数据文件、写好 `trail.json`、把 id 加进 `index.json`，不需要改页面代码。列出的路线超过一条时，语言/单位切换旁边会出现路线切换菜单，选择会记在这个浏览器里。

```jsonc
{
  "schemaVersion": 1,
  "id": "AT",                       // 必须和文件夹同名；每条记录用 trailId 引用它
  "name": "Appalachian Trail",
  "shortName": "AT",                // 显示在切换菜单里
  "color": "#d1246b",
  "subtitle": { "en": "...", "zh": "..." },   // 也可以直接写一个字符串
  "credit":   { "en": "...", "zh": "..." },   // 页脚显示的数据署名
  "files": { "route": "route.json", "anchors": "anchors.json", "states": "states.json", "borders": "state_borders.geojson" }
}
```

只有 `files.route` 是必须的；不提供 `anchors`/`states`/`borders` 时，地名列表、各州进度、州界虚线就不显示。州名优先用 `js/strings.js` 里的翻译（为了中文显示），没有的话用该路线 `states.json` 里的 `name`。

## 数据模型

一次徒步记为一条 Activity：`{ id, trailId, date, source, range: { from, to }, fromName, toName, note }`（`range` 是走过的里程，`from > to` 表示南行；`source` 现在都是 `'manual'`——手动录入，`'gpx'`/`'healthkit'` 是留给以后里程碑的其他录入方式预留的）。已完成的路线是所有记录 range 的并集，所以同一段走两遍、或者两次徒步有重叠，都只算一次。

所有路线的记录共用一份列表：每条记录带 `trailId`，页面只显示和统计当前路线的记录，保存、导出、导入永远包含全部路线。只有一种 JSON 结构需要记住，而且是持续更新的同一份记录，不是每条徒步一个文件：所有记录都作为一份不断更新的列表存在这个浏览器的 localStorage 里；点"导出 JSON"永远是把到目前为止的全部记录导出成一份完整快照（不是只导出新增的部分）；"导入 JSON"按 id 把一份快照合并回来（相同 id 的记录会被导入的版本覆盖）。所以每次徒步后都导出一次，或者把旧备份导入到更新的记录上，都是安全的，不会丢数据也不会重复。也可以把导出的文件放到 `data/hikes.json`，新浏览器第一次打开时会用它作为初始记录。

`route.json` 里每个顶点都带里程，地图上"从第 A 英里到第 B 英里"只是查表，不需要在浏览器里做地理计算。地名和州界都通过同一条路线换算成里程，所以三者天然对得上。内部距离全程用英里存储和计算，公里显示只是渲染时的换算（见 `js/strings.js`）。

## 数据流水线

```
fetch_centerline.py   ->  data/raw/centerline.geojson          NPS/ATC 官方中心线（~3000 段独立测量的线）
order_centerline.py   ->  data/raw/centerline_ordered.geojson  按南到北顺序拼接成一条线（见下）
build_route.py        ->  data/trails/AT/route.json                      定向、按官方总长换算里程、简化
fetch_osm_pois.py     ->  data/raw/osm_pois.geojson            OpenStreetMap 的庇护所/垭口/村镇
build_anchors.py      ->  data/trails/AT/anchors.json                    吸附到路线上，得到里程
(下载 Census 州界)    ->  data/raw/cb_2023_us_state_500k.zip
build_states.py       ->  data/trails/AT/states.json, data/trails/AT/state_borders.geojson
make_placeholder.py   ->  占位数据（直线连接约 58 个航点，仅供试用）
```

官方总长默认 2197.9 英里（ATC 2026 年数据），可用 `--official-miles` 修改。几何长度与官方长度的比例用来缩放里程；如果你手上有可靠的里程标记，可以用 `--calibration` 传入分段校准。

**为什么多了 `order_centerline.py` 这一步：** NPS 的 ANST_Centerline 图层不是一条排好序的线，而是 20 多年里不同年份、不同 GPS 设备测量的近 3000 段独立线段，段与段之间经常有几米到几十米的空隙（不是精确首尾相连）。早期直接把这些段丢给 `build_route.py` 自带的"贪心找最近点拼接"逻辑，会被这些空隙和个别测量伪迹（比如重复记录的单点、和主线无关的小连接段）带偏，拼出一条长达 3049 英里、结尾在离 Katahdin 890 英里外的错误路线。`order_centerline.py` 用更稳的办法解决：先按官方 `Alt_Name` 字段剔除 Bartram Trail、Benton MacKaye Trail 这类共线的旁道；再用模糊匹配（容差约 80 米）把本该相连但有小空隙的线段拼起来，比 shapely 的精确端点匹配更宽容；最后按 Springer→Katahdin 方向做全局排序拼接，丢弃拼接产生的孤立伪迹点。目前跑出来的结果：拼接后总长 2158 英里，起点离 Springer 0.01 英里、终点离 Katahdin 0.01 英里以内，连接处最大空隙 2.5 英里（真实存在、未被测量覆盖的路段，比如公路穿越点）。

### 常用命令

```bash
pip install shapely numpy pyshp

python3 scripts/fetch_centerline.py
python3 scripts/order_centerline.py data/raw/centerline.geojson        # 拼接成一条有序的线
python3 scripts/build_route.py data/raw/centerline_ordered.geojson --inspect   # 先看看数据长什么样
python3 scripts/build_route.py data/raw/centerline_ordered.geojson -o data/trails/AT/route.json

python3 scripts/fetch_osm_pois.py
python3 scripts/build_anchors.py data/raw/osm_pois.geojson

# 下载 https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip 到 data/raw/
python3 scripts/build_states.py data/raw/cb_2023_us_state_500k.zip --min-run 0.8
```

`build_route.py` 会检查路线是否从 Springer Mountain 出发、到 Katahdin 结束，并报告拼接时的缺口和长度偏差。看到 WARNING 先别忽略——不过用了 `order_centerline.py` 之后应该不会再有这些警告了。

`fetch_osm_pois.py` 用的是公共 Overpass API，请求多了会被限流（HTTP 429）。如果整条命令跑到一半失败，直接重新运行 `fetch_osm_pois.py` 即可（默认按 40 英里分段请求，重试很快）；网络不稳定时可以加 `--chunk-miles` 调大分段、减少请求次数。

`build_states.py` 的 `--min-run` 控制"州界噪音"的平滑程度：AT 沿北卡/田纳西州界来回穿插约 200 英里、沿弗吉尼亚/西弗吉尼亚州界也有类似路段，默认 0.1 英里的平滑力度会在这些地方切出上百个碎片区间；调到 0.8 英里左右能把弗吉尼亚/西弗吉尼亚收敛到几段真实的跨州（在 Harpers Ferry 附近），北卡/田纳西那 200 英里本来就是真实的反复穿插，切多细都不算错——不管切成多少段，`js/stats.js` 都会把同一个州的里程加总成一个数字，不影响显示。默认按 14 个州分别显示，想合并成一行的话在 `js/config.js` 的 `stateGroups` 里加，例如 `[['NC', 'TN']]`。

## 数据来源与许可

- **步道中心线**（`data/trails/AT/route.json` 的原始输入）：National Park Service Appalachian National Scenic Trail 与 Appalachian Trail Conservancy 联合维护的 `ANST_Centerline` 图层（ArcGIS Online 公开图层）。图层自带的版权声明是 `National Park Service Appalachian National Scenic Trail & Appalachian Trail Conservancy, 2023`，附带的说明是"仅供一般参考、不是法律文件，NPS / USDA Forest Service / ATC 及合作方不对准确性、可靠性或完整性做任何明示或暗示的保证"——这是免责声明，不是一份正式的可复用许可（既没写公有领域，也没写具体的转载条款）。因为版权方里包含 ATC 这个非营利机构（不是纯联邦政府作品），不能简单当作 public domain。本项目按上面那行原文署名使用；如果你打算更大范围地重新分发这份几何数据，建议自己联系 ATC 确认。
- **官方总里程**（默认 2197.9 英里）：ATC 每年发布的官方数据，当前用的是 2026 年的数字，见 `build_route.py --official-miles`。
- **地名兴趣点**（`data/trails/AT/anchors.json` 的庇护所、垭口、村镇）：来自 OpenStreetMap，遵循 [ODbL](https://opendatacommons.org/licenses/odbl/) 协议，使用需署名 "© OpenStreetMap contributors"。
- **州界**（`data/trails/AT/states.json`、`data/trails/AT/state_borders.geojson`）：美国人口普查局（Census Bureau）Cartographic Boundary File，属美国联邦政府作品，公有领域（Public Domain），没有版权限制。
- **地图底图**：Mapbox（`mapStyle` 见 `js/config.js`），页面右下角会自动显示 Mapbox 和 OpenStreetMap 的署名，遵循 Mapbox 自己的服务条款。

## 开发

```bash
python3 -m http.server 8000     # 然后访问 http://localhost:8000（不能直接双击 index.html）
npm install                     # 只为跑 UI 测试
npm test                        # JS 测试
python3 -m unittest tests/test_pipeline.py -v   # 数据流水线测试
```

### 部署自己的版本

推到 GitHub，Settings → Pages → Deploy from a branch → `main` / root。`js/config.js` 里的 `mapboxToken` 留空，不要提交自己的令牌；第一次打开页面时会弹出输入框，令牌只存在浏览器的 localStorage 里。如果想长期用同一个令牌不用每次输入，可以在 Mapbox 后台创建一个 public token 并限制到自己的 Pages 网址（例如 `https://用户名.github.io`）加 `http://localhost:8000`，再自行写入本地的 `js/config.js`（该文件已跟踪进仓库，写入后注意不要提交——`git update-index --assume-unchanged js/config.js` 可以让这个文件的本地改动不出现在 `git status` 里）。
