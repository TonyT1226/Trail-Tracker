# 如何添加一条新路线

*(English: [ADDING_A_TRAIL.md](ADDING_A_TRAIL.md))*

页面把路线当作数据来读取。添加一条路线不需要改页面代码，只要做三件事：在 `data/trails/<ID>/` 下生成一组 JSON 文件，写一份 `trail.json` 说明文件，再把 id 加进 `data/trails/index.json`。之后路线切换菜单、单条路线的进度和“全部”总览都会自动出现这条路线。这些文件之间的关系见 [SPEC.zh.md](../SPEC.zh.md) 的“路线数据包”和“数据流水线”两节。

下面按顺序一步步来。AT 和 PCT 都是按这个流程做出来的，它们的文件可以直接当参考。

## 1. 先确认数据可以用

这一步要最先做，因为它可能直接否决一个数据来源。必须有的是**路线中心线**的来源；官方**里程标**是可选的，没有也没关系。

找明确的许可，优先级如下：

| 找到的情况 | 能不能用 |
|---|---|
| 公有领域（比如美国联邦政府作品），或 CC BY / CC0 / ODbL 这类开放许可 | 可以，按许可要求署名 |
| 只有“不保证准确、仅供参考”这类免责声明，没有许可 | 可能可以。AT 就是这种情况：署名使用，并在 SPEC 里如实写明没有正式许可。把你找到的原文记下来。 |
| 有和本项目冲突的限制（比如“禁止商业使用”，而本项目是 MIT 开源协议） | 需要维护者先做决定，先开一个 issue 讨论。 |

去哪里找：ArcGIS 条目有 `licenseInfo` 和 `accessInformation` 字段（`https://www.arcgis.com/sharing/rest/content/items/<条目 id>?f=json`），图层有 `copyrightText` 字段；管理这条路线的机构自己的数据页面也算。把找到的内容和查询日期记下来，第 5 步要用。

两个例子，依据的是 2026 年 9 月能公开查到的信息（真要用之前请再核实一次）：

- **Continental Divide Trail（CDT）**：中心线由美国林务局（USFS）和 Bear Creek Survey Service 合作制作。查到的元数据里只有“不保证准确性”的免责声明，没有许可，所以情况和 AT 一样：可以谨慎署名使用，并在 SPEC 里如实说明。确认的话，可以去 Continental Divide Trail Coalition 的地图与数据页面。
- **Long Trail（佛蒙特）**：Green Mountain Club 的 `LTSYSTEM` 图层，由 Vermont Center for Geographic Information 分发（最近一次提供是 2006 年）。元数据写明不允许用于商业徒步地图，允许非营利使用。本项目是 MIT 协议，任何人都可以拿去商用，这和那条限制冲突。所以收录之前需要先做决定，或者取得 GMC 的许可。

地名对每条路线都用 OpenStreetMap（ODbL），州界用美国人口普查局的数据（公有领域），这两项不需要重新核查。

## 2. 添加流水线配置

每条路线不一样的设置都集中在 [`scripts/trail_profiles.py`](../scripts/trail_profiles.py) 里。在 `AT`、`PCT` 旁边加一个 `TrailProfile`，再把它加进 `PROFILES`：

```python
CDT = TrailProfile(
    id="CDT",                         # 文件夹名，也是每条记录的 trailId；只用字母和数字，不能是 "*"
    name="Continental Divide Trail",
    source="...",                     # 中心线的制作方，会写进 route.json
    start=(经度, 纬度), start_name="...",   # 里程 0 所在的端点（AT 和 PCT 都从南端开始）
    end=(经度, 纬度), end_name="...",       # 另一个端点
    official_miles=...,               # 管理机构当前公布的官方总长
    states=[("NM", "New Mexico"), ("CO", "Colorado"), ...],   # 按路线顺序，从起点开始
    centerline_url="https://.../FeatureServer/0/query",       # 支持 f=geojson 的 ArcGIS 图层
    markers_url="",                   # 可选：官方里程标的点图层
    proj_center=(经度, 纬度),          # 大致是路线中部，简化路线时用来换算米
)
```

说明：

- **中心线不是 ArcGIS 图层？** `centerline_url` 留空，自己把线存成 GeoJSON，放在 `data/raw/<ID>/centerline.geojson`（GPX、KML、shapefile 可以用 QGIS 或 `ogr2ogr` 转换），然后跳过 `fetch_centerline.py`。
- **里程标**必须是带 `Mile`（或 `mile`）属性的点。设了 `markers_url` 后，`fetch_centerline.py` 会把它们存为 `data/raw/<ID>/mile_markers.json`，`build_route.py` 会自动用来校准。也可以按同样的格式自己写这个文件：`[{"name", "lat", "lon", "mile"}, ...]`。没有里程标时，里程按 `official_miles` 整体等比例缩放，AT 就是这样处理的。
- **路线不在美国？** `build_states.py` 只认识美国的州（Census 数据），跳过这一步即可。`states.json` 是可选的，没有它，页面就不显示各州进度。

## 3. 生成数据

```bash
pip install shapely numpy pyshp
# 只需一次：把 https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip 下载到 data/raw/

python3 scripts/fetch_centerline.py --trail CDT                        # -> data/raw/CDT/（手动存的就跳过）
python3 scripts/build_route.py --trail CDT data/raw/CDT/centerline.geojson --inspect   # 先看看数据
python3 scripts/build_route.py --trail CDT data/raw/CDT/centerline.geojson             # -> data/trails/CDT/route.json
python3 scripts/fetch_osm_pois.py --trail CDT                          # 要几分钟；中途失败就重新运行
python3 scripts/build_anchors.py --trail CDT data/raw/CDT/osm_pois.geojson
python3 scripts/build_states.py --trail CDT data/raw/cb_2023_us_state_500k.zip
```

输出里要注意的：

- **`--inspect`**：有多少个要素、线的总长是多少。一条排好序的线（像 PCT）最省事；几百段（像 AT）会自动拼接。如果拼出来还是不对，可能需要为这个数据源单独写一步清理，参考 AT 的 [`order_centerline.py`](../scripts/order_centerline.py)。最常见的原因是数据里混进了备选路线或支线。
- **`build_route.py` 的 WARNING**：线的首尾离你填的两个端点超过 3 英里时，脚本会直接停下，这时检查坐标，以及两端是不是填反了。超过 0.05 英里、被直线连起来的缺口，以及原始长度和 `official_miles` 相差超过 2%，都会给出警告。每条警告都要弄清原因。
- **有里程标时**：会显示 “calibrated against N mile markers”，以及因为离线太远而跳过的里程标。跳过几个很正常；跳过很多，说明里程标和中心线不是同一个版本。
- **`build_states.py`**：各州里程加起来应该等于路线总长。如果路线沿着州界走，在那一段会在两个州之间反复切换，可以用 `--min-run 0.8` 平滑掉（见 SPEC.zh.md）。
- **文件大小**：`route.json` 应该在 1 MB 左右（AT 约 760 KB，PCT 约 1 MB）。大很多的话，调大 `--tolerance`（单位是米，默认 15）。

## 4. 写说明文件 `trail.json`

在 `data/trails/<ID>/trail.json` 新建，可以照着 PCT 的写：

```json
{
  "schemaVersion": 1,
  "id": "CDT",
  "name": "Continental Divide Trail",
  "shortName": "CDT",
  "color": "#2a9d4b",
  "subtitle": { "en": "Crazy Cook, NM to Waterton Lake, MT", "zh": "..." },
  "credit": { "en": "Trail: .... Place names: © OpenStreetMap contributors.", "zh": "..." },
  "files": { "route": "route.json", "anchors": "anchors.json", "states": "states.json", "borders": "state_borders.geojson" }
}
```

- `id` 必须和文件夹名完全一致。
- `shortName` 显示在切换菜单里，几个字母就好。
- `color` 用在“全部”总览里。选一个和已有路线容易区分（AT `#d1246b`，PCT `#1f78b4`）、在地图上也看得清的颜色。
- `credit` 显示在页面底部，必须包含第 1 步要求的署名。
- `subtitle` 和 `credit` 可以直接写字符串，也可以写成 `{ "en": ..., "zh": ... }` 提供翻译。
- 只有 `files.route` 是必须的，没生成的文件就不要列。

## 5. 启用

1. 把 id 加进 `data/trails/index.json`。这里的顺序就是切换菜单里的顺序。
2. **中文州名**（可选）：如果路线经过的州在 [`js/strings.js`](../js/strings.js) 里还没有翻译，在 `STATE_NAMES.en` 和 `STATE_NAMES.zh` 里都加上。不加的话会显示 `states.json` 里的英文州名。
3. **SPEC.md / SPEC.zh.md 的“数据来源与许可”**：写上数据来源、年份，以及许可或免责声明的原文（第 1 步找到的内容）。

## 6. 检查

```bash
npm install     # 只需一次
npm test        # 其中有一项会检查每个 trail.json 里列的文件是否都存在
python3 -m unittest tests/test_pipeline.py -v
```

然后启动网站（双击 `start.command`，或运行 `python3 -m http.server 8000`），在浏览器里检查：

- 切换菜单里出现了新路线，名称、副标题、总长和署名都对。
- 地图上显示完整的路线，起点和终点位置正确。
- 挑几个有名的地点，把名字输入起点或终点，里程应该和这条路线的官方指南或数据相差在 1 英里左右以内。
- 记一段徒步，切到别的路线再切回来，确认每条路线的进度各自独立。
- “全部”总览里，新路线用了它自己的颜色，合计数字也对得上。

## 7. 提交

Pull request 里应该包含：

- [ ] `scripts/trail_profiles.py` 里的新配置
- [ ] `data/trails/<ID>/`（只放生成好的文件；`data/raw/` 被 git 忽略，不要提交）
- [ ] `data/trails/index.json` 里的新 id
- [ ] SPEC.md / SPEC.zh.md 里的数据来源和许可，写明在哪里查的、什么时候查的
- [ ] 测试全部通过，再附一句说明在浏览器里检查了哪些
