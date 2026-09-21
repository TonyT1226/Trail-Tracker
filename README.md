# AT 进度看板

记录你走过的 Appalachian Trail 里程，在地图上把走完的部分标成洋红色，并按州统计进度。纯静态网站，部署在 GitHub Pages，不需要后端，也不需要构建步骤。代码遵循 [MIT 协议](LICENSE)；步道路线数据另有出处和许可，见「数据来源与许可」一节。

## 整体结构

```
index.html            页面骨架
start.command         双击启动本地服务器并打开浏览器
css/style.css         样式（松绿面板 + 白色路标 + 洋红完成线）
js/
  config.js           你要改的设置：Mapbox token、州合并规则、数据路径
  app.js              页面逻辑：读数据、表单、记录列表、统计
  map.js              所有 Mapbox 代码都在这里（底图、路线、地名、州界、3D 地形、点选里程）
  geo.js              路线几何：按里程取点/切段、找离点击处最近的里程
  intervals.js        里程区间合并（重复、重叠的徒步不会重复计算）
  store.js            徒步记录的存取，浏览器 localStorage + 导入导出 JSON
  stats.js            总进度和各州进度
data/
  route.json          路线：坐标 + 每个点的里程
  anchors.json        地名（村镇、垭口、庇护所）及其里程
  states.json         每个州对应的里程区间
  state_borders.geojson  州界虚线（可选）
scripts/              数据流水线（Python），生成上面 data/ 里的文件
tests/                JS 与 Python 测试
```

## 数据模型

一次徒步是一个里程区间：`{ date, from, to, fromName, toName, note }`。已完成的路线是所有区间的并集，所以同一段走两遍、或者两次徒步有重叠，都只算一次。`from > to` 表示南行，统计时按同一段处理。

路线数据的关键设计：`route.json` 里每个顶点都带里程，地图上“从第 A 英里到第 B 英里”只是查表，不需要在浏览器里做地理计算。地名和州界都通过同一条路线换算成里程，所以三者天然对得上。

## 数据流水线

```
fetch_centerline.py   ->  data/raw/centerline.geojson          NPS/ATC 官方中心线（~3000 段独立测量的线）
order_centerline.py   ->  data/raw/centerline_ordered.geojson  按南到北顺序拼接成一条线（见下）
build_route.py        ->  data/route.json                      定向、按官方总长换算里程、简化
fetch_osm_pois.py     ->  data/raw/osm_pois.geojson            OpenStreetMap 的庇护所/垭口/村镇
build_anchors.py      ->  data/anchors.json                    吸附到路线上，得到里程
(下载 Census 州界)    ->  data/raw/cb_2023_us_state_500k.zip
build_states.py       ->  data/states.json, data/state_borders.geojson
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
python3 scripts/build_route.py data/raw/centerline_ordered.geojson -o data/route.json

python3 scripts/fetch_osm_pois.py
python3 scripts/build_anchors.py data/raw/osm_pois.geojson

# 下载 https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip 到 data/raw/
python3 scripts/build_states.py data/raw/cb_2023_us_state_500k.zip --min-run 0.8
```

`build_route.py` 会检查路线是否从 Springer Mountain 出发、到 Katahdin 结束，并报告拼接时的缺口和长度偏差。看到 WARNING 先别忽略——不过用了 `order_centerline.py` 之后应该不会再有这些警告了。

`fetch_osm_pois.py` 用的是公共 Overpass API，请求多了会被限流（HTTP 429）。如果整条命令跑到一半失败，直接重新运行 `fetch_osm_pois.py` 即可（默认按 40 英里分段请求，重试很快）；网络不稳定时可以加 `--chunk-miles` 调大分段、减少请求次数。

`build_states.py` 的 `--min-run` 控制"州界噪音"的平滑程度：AT 沿北卡/田纳西州界来回穿插约 200 英里、沿弗吉尼亚/西弗吉尼亚州界也有类似路段，默认 0.1 英里的平滑力度会在这些地方切出上百个碎片区间；调到 0.8 英里左右能把弗吉尼亚/西弗吉尼亚收敛到几段真实的跨州（在 Harpers Ferry 附近），北卡/田纳西那 200 英里本来就是真实的反复穿插，切多细都不算错——不管切成多少段，`js/stats.js` 都会把同一个州的里程加总成一个数字，不影响显示。

### 关于州界处的统计

北卡和田纳西之间约 200 英里，路线沿着州界来回穿插，弗吉尼亚和西弗吉尼亚之间也有类似的地方。这些地方按多边形划分会产生很多小段（NC、TN 各有十几段），但各州进度列表只看总里程，段数不影响统计结果，所以默认按 14 个州分别显示。如果想把某几个州合并成一行，在 `js/config.js` 的 `stateGroups` 里加，例如 `[['NC', 'TN']]`。

## 数据来源与许可

- **步道中心线**（`data/route.json` 的原始输入）：National Park Service Appalachian National Scenic Trail 与 Appalachian Trail Conservancy 联合维护的 `ANST_Centerline` 图层（ArcGIS Online 公开图层）。图层自带的版权声明是 `National Park Service Appalachian National Scenic Trail & Appalachian Trail Conservancy, 2023`，附带的说明是"仅供一般参考、不是法律文件，NPS / USDA Forest Service / ATC 及合作方不对准确性、可靠性或完整性做任何明示或暗示的保证"——这是免责声明，不是一份正式的可复用许可（既没写公有领域，也没写具体的转载条款）。因为版权方里包含 ATC 这个非营利机构（不是纯联邦政府作品），不能简单当作 public domain。本项目按上面那行原文署名使用；如果你打算更大范围地重新分发这份几何数据，建议自己联系 ATC 确认。
- **官方总里程**（默认 2197.9 英里）：ATC 每年发布的官方数据，当前用的是 2026 年的数字，见 `build_route.py --official-miles`。
- **地名兴趣点**（`data/anchors.json` 的庇护所、垭口、村镇）：来自 OpenStreetMap，遵循 [ODbL](https://opendatacommons.org/licenses/odbl/) 协议，使用需署名 "© OpenStreetMap contributors"。
- **州界**（`data/states.json`、`data/state_borders.geojson`）：美国人口普查局（Census Bureau）Cartographic Boundary File，属美国联邦政府作品，公有领域（Public Domain），没有版权限制。
- **地图底图**：Mapbox（`mapStyle` 见 `js/config.js`），页面右下角会自动显示 Mapbox 和 OpenStreetMap 的署名，遵循 Mapbox 自己的服务条款。

## 本地运行与测试

双击 [`start.command`](start.command) 会自动启动本地服务器并打开浏览器（第一次运行 macOS 可能提示"来自未标识开发者"，去系统设置里点"仍要打开"）。或者手动：

```bash
python3 -m http.server 8000     # 然后访问 http://localhost:8000（不能直接双击 index.html）
npm install                     # 只为跑 UI 测试
npm test                        # JS 测试
python3 -m unittest tests/test_pipeline.py -v   # 数据流水线测试
```

## 部署

推到 GitHub，Settings → Pages → Deploy from a branch → `main` / root。`js/config.js` 里的 `mapboxToken` 留空，不要提交自己的令牌；第一次打开页面时会弹出输入框，令牌只存在浏览器的 localStorage 里。如果想长期用同一个令牌不用每次输入，可以在 Mapbox 后台创建一个 public token 并限制到自己的 Pages 网址（例如 `https://用户名.github.io`）加 `http://localhost:8000`，再自行写入本地的 `js/config.js`（该文件已跟踪进仓库，写入后注意不要提交）。

## 备份

徒步记录存在浏览器的 localStorage 里。页面底部有“导出 JSON”，换设备或清理浏览器数据之前先导出。也可以把导出的文件放到 `data/hikes.json`，新浏览器第一次打开时会用它作为初始记录。

