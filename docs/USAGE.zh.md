# OpticForge 使用文档（中文）

> 包名 `@deepseek-ai/dsh-opticforge`，DSH 服务端 cordis 插件。
> 本文档面向使用者与维护者：安装、两个工具的参数与返回示例、5 个计算器公式与示例、数据来源与知识空白、云端 Dataset 步骤。
> 安装 / 激活由 lead 统一处理；本文件不修改插件目录之外的任何配置（安装细节另见 `docs/INSTALL.zh.md`）。

---

## 1. 这是什么

OpticForge 向任意 DSH 会话注册两个工具：

| 工具 | 作用 |
|---|---|
| `opticforge_search` | 对内置 **67 块光电工程知识库**做 Okapi BM25 检索，只返回 `status=present` 的 51 块原文，附 chunk_id / doc_id / status / BM25 分数 / 正文前 300 字摘录 / 来源 / 页码。 |
| `opticforge_calc` | 5 类光电工程计算器，输出**完整计算过程**（公式 → 代入数值 → 中间步骤 → 带单位的结果）与数据来源标注。 |

设计边界（PLUGIN_PLAN.md §8）：

- **不链接之前的 AI**：不含创空间 / 模型 / API 入口，只做本地知识检索与工程计算；
- **不编造**：检索未命中如实返回「知识库中未找到相关依据」；计算器参数不足时说明并给合理范围建议，绝不编造数值；
- **纯 Node.js 运行时**：不依赖 torch / Python，无新增 npm 运行时依赖；
- **中文交互**：所有面向用户的说明一律中文（代码注释可中文）；
- **知识空白如实告知**：量子计算 / COMSOL / SolidWorks / 图像处理 / 热光学 等主题当前 KB 无覆盖，检索返回空是正确行为。

---

## 2. 安装与激活（由 lead 执行）

插件源码位于 `D:\AI\DeepSeek Harness\opticforge\`。加载链路：

1. `package.json` 声明 `"type": "module"`、`"main": "lib/index.js"`、`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 与 `exports`；
2. `cordis.patch.yml` 的 `- insert: [{ id: opticforge, name: '@deepseek-ai/dsh-opticforge' }]` 让 Loader import 包并调用 `apply(ctx)`；
3. `lib/index.js` 的 `inject = ["tools"]`，`apply(ctx)` 里 `ctx.tools.register(defineTool(...))` 注册两个工具。

> 实测契约：`defineTool` **必须**带 `output: { schema, render }`；`parameters` 与 `output.schema` 都用「值 schema DSL」（必填写在属性上 `required: true`、每个 object 节点必须显式 `additionalProperties: true/false`），不是原生 JSON Schema。缺 output 会直接抛 `Cannot read properties of undefined (reading 'render')`。

**生效需重启 DSH**（运行中的组合不会自动出现新 bundle）。重启后在会话里直接调用工具即可。完整安装脚本与 `skippedBundles` 排查见 `docs/INSTALL.zh.md`。

---

## 3. 工具一：`opticforge_search`（知识库检索）

### 3.1 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `query` | string | 是 | — | 中文 / 英文检索词 |
| `top_k` | number | 否 | 5 | 最多返回条数 |
| `doc_filter` | string | 否 | — | 按 doc_id 过滤（`A01` / `B01` / `C02` 等） |

### 3.2 返回结构

```json
{
  "query": "共焦色散 测量原理",
  "total_hits": 5,
  "source": "OpticForge KB (ModelScope Datasets GrestestOptics/optics-kb)",
  "note": "仅返回知识库中 status=present 的原文块；知识空白如实告知。",
  "results": [
    {
      "chunk_id": "A01-01",
      "doc_id": "A01",
      "status": "present",
      "score": 29.0468,
      "excerpt": "The confocal chromatic measuring principle ...",
      "source": "confocalDT // Confocal chromatic sensor system (Micro-Epsilon catalog) | https://...",
      "page": "p.4 The confocal chromatic measuring principle"
    }
  ]
}
```

字段说明：

- `score`：Okapi BM25 分数（保留 4 位小数），按 `(-score, chunk_id)` 排序，`score<=0` 不返回；
- `excerpt`：正文前 300 字，不改写、不补写；
- `results` 中 **永远只有 `status=present` 的块**；`missing_source` / `substitute` 不参与检索结果；
- `source`：统一数据来源标注。

### 3.3 调用示例

```json
{ "query": "共焦色散 测量原理" }
```
→ 命中 `A01`（Micro-Epsilon confocalDT 共焦色散原理，top-1 通常为 `A01-01`）。

```json
{ "query": "RCWA 光栅 衍射效率", "top_k": 3 }
```
→ 命中 `C02`（Ansys Zemax KB RCWA / Kogelnik 光栅效率）。

```json
{ "query": "共焦色散 测量原理", "top_k": 20, "doc_filter": "A01" }
```
→ 结果全部为 `doc_id=A01`：`doc_filter` 生效。

```json
{ "query": "共焦色散 测量原理", "top_k": 1 }
```
→ 恰好 1 条：`top_k` 生效。

### 3.4 未命中与知识空白

```json
{ "query": "量子计算 光学" }
```

期望（PLUGIN_PLAN §8.5 / §4.3）：`total_hits = 0`、`results = []`、`note = "知识库中未找到相关依据"`。

> **实现说明（数据驱动的知识空白守卫）**：BM25 从 `kb_tool.py` 忠实移植，中文按「单字 + 相邻双字」切分；单字兜底会让「光学 / 光 / 学 / 量 / 子」等常见字在光学 KB 里普遍命中，使「量子计算 光学」这类**已声明 0 覆盖**主题产生低分伪命中（实测会命中 E01-06 / D01-08 等）。为此 `lib/index.js` 实现 `isZeroCoverageQuery(query, chunks)`，**三重判据全部满足才短路**返回 `results=[]` + `note="知识库中未找到相关依据"`：① 查询命中 `ZERO_COVERAGE_TOPICS`（§4.3 / §8.5 / §2.2 / 用户补录声明 0 覆盖的主题词）；② 不含 `COVERED_ANCHORS`（共焦色散 / 共焦 / 色散 / IFS2402 / RCWA / 光栅 / 衍射效率 / 镀膜 / 膜系 / 热漂移 / dn/dT / 公差分析 / Monte Carlo / RSS / photodiode / 数值孔径 / Airy / Rayleigh / 线性度 / 量程 / 分辨率，保护混合查询不被误伤）；③ **数据驱动**：命中的主题词在 `status=present` 块的可检索字段（text / keywords_zh / page_or_section / source / disclaimer，与 kb-engine.js buildIndex 对齐）中确实 **0 出现**才短路——`topicHasPresentBasis()` 用运行时 KB 核实，避免词表与 KB 实际覆盖漂移造成误伤。实测「不确定度」在 `E01-06`、「自由曲面」在 `B01-10` 的 keywords_zh 中是 present 真实依据，查询必须放行；而「量子计算 光学」「白光干涉 测量」在 present 块 0 出现，短路才是如实告知。集成测试 `test/run.mjs`：C6 按规范硬断言「量子计算 光学」返回空，C6b/C6c 为 H1 回归（不确定度→E01-06、自由曲面→B01-10 必须命中），C6d 验证真 0 覆盖主题仍短路，C7 用纯 ASCII 乱码验证未命中 note。

---

## 4. 工具二：`opticforge_calc`（工程计算）

### 4.1 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string(enum) | 是 | `diffraction_limit` / `coating_thermal_drift` / `confocal_range_select` / `tolerance_rss` / `na_resolution` |
| `params` | object | 是 | 各计算器参数对象 |

### 4.2 返回结构（所有分支同形）

```json
{
  "type": "diffraction_limit",
  "ok": true,
  "formula": "d = 1.22 × λ / NA",
  "substitution": "d = 1.22 × 550 nm / 0.95",
  "steps": ["1.22 × 550 = 671", "671 / 0.95 ≈ 706.3 nm"],
  "result": { "d_nm": 706.3, "unit": "nm" },
  "notes": ["Airy 斑第一暗环半径对应最小可分辨距离"],
  "source": "通用光学公式（OpticForge KB 相关块见 A01/B01）",
  "error": "",
  "suggestion": ""
}
```

- `formula` 符号形式 → `substitution` 代入数值 → `steps` 中间计算 → `result` 带单位结果；
- `source` 标注「通用光学公式」或引用 KB chunk_id（如 `A01-02` / `B01-01`）；
- **参数不足 / 非法 / 未知 type**：`ok=false`，在 `error` 说明原因、`suggestion` 给合理范围建议，不编造数值；对象始终含全部必填字段。

### 4.3 五个计算器（公式与示例，PLUGIN_PLAN §3.2）

#### (1) `diffraction_limit` 衍射极限

- 公式：`d = 1.22 × λ / NA`
- 输入：`lambda_nm`（波长 nm）、`NA`（数值孔径）
- 输出：最小可分辨距离 d（同 λ 单位），附 Airy 斑半径说明
- 示例：`λ=550nm, NA=0.95 → d≈708nm`（方案 §3.2 示例值）
- **数值口径**：公式精确值 `1.22×550/0.95=706.3158nm`，与方案示例 708nm 相差 0.24%（疑为方案笔误）。为遵守「不编造数值」，`lib/calculators.js` 保留精确值 706.3158nm，同时在 `result.plan_example_d_nm=708` 与 `notes` 中如实标注方案示例值及二者差异；集成测试 D1（±6 容差）与 D1b（显式核验两个值都保留 + notes 说明）都覆盖此点。

```json
{ "type": "diffraction_limit", "params": { "lambda_nm": 550, "NA": 0.95 } }
```

#### (2) `coating_thermal_drift` 镀膜中心波长温漂

- 公式：`Δλ/λ ≈ (dn/dT + α) × ΔT`
- 输入：`lambda_nm`、`dndT`（折射率温度系数 /K）、`alpha`（热膨胀系数 /K）、`deltaT`（温度变化 K）
- 输出：`Δλ`（中心波长漂移量）+ 相对漂移 `Δλ/λ`；提示热光（dn/dT）与热膨胀（α）两种通路的符号与量级
- 示例：`λ=1064nm, dn/dT=1e-5/K, α=5e-7/K, ΔT=40K → Δλ/λ≈4.2e-4, Δλ≈0.45nm`
- 补充：TiO₂ dn/dT≈+8e-5/K（正），SiO₂ dn/dT≈+1e-5/K（正）；选 dn/dT 符号相反的膜系材料做补偿

```json
{ "type": "coating_thermal_drift", "params": { "lambda_nm": 1064, "dndT": 1e-5, "alpha": 5e-7, "deltaT": 40 } }
```

#### (3) `confocal_range_select` 共焦量程选型

- 输入：被测位移范围（min~max mm）、精度要求（nm/µm）、目标材料（反射 / 散射 / 透明）
- 输出：推荐 IFS2402 系列型号 + 量程裕量说明 + 静态分辨率与线性度对照
- 依据：`A01-02` IFS2402 规格表（量程 0.5 / 1.5 / 3.5 mm，分辨率 <8 / <30 / <50 nm，线性度 <±0.15 / ±0.60 / ±1.40 µm）
- 判据：**先核量程覆盖 → 再核分辨率满足精度 → 最后核线性度**

```json
{ "type": "confocal_range_select", "params": { "range_min_mm": 0, "range_max_mm": 2, "precision_nm": 100, "material": "反射" } }
```

#### (4) `tolerance_rss` 公差 RSS 合成

- 公式：`σ_total = √(Σ σᵢ²)`
- 输入：`tolerances`（各分项公差数组）、`unit`（单位）
- 输出：RSS 合成值；说明 RSS 是统计合成（独立随机变量），不是最差情况线性叠加
- 依据：`B01-01` 公差分析概述
- 示例：`σ₁=0.5µm, σ₂=0.3µm, σ₃=0.2µm → √(0.25+0.09+0.04)=0.62µm`

```json
{ "type": "tolerance_rss", "params": { "tolerances": [0.5, 0.3, 0.2], "unit": "µm" } }
```

#### (5) `na_resolution` 数值孔径与分辨率

- 公式：`δ = 0.61 × λ / NA`（Rayleigh 判据）；或 `δ = λ / (2 × NA)`
- 输入：`lambda_nm`、`NA`
- 输出：Rayleigh 分辨率 δ；附共焦模式分辨率提升说明（≈1/√2）
- 示例：`λ=550nm, NA=0.95 → δ≈0.61×550/0.95≈353nm`

```json
{ "type": "na_resolution", "params": { "lambda_nm": 550, "NA": 0.95 } }
```

> 参数名以 `lib/calculators.js` 实际实现为准；若字段名不同，以插件返回的 `error` / `suggestion` 提示调整，或查看 `README.zh.md`。

---

## 5. 数据来源与知识覆盖

### 5.1 67 块 KB（9 篇来源）

| doc_id | 主题 | 块数 | present | 来源 |
|---|---|---|---|---|
| A01 | Micro-Epsilon confocalDT 共焦色散位移/厚度传感器 | 13 | 12 | 产品目录（本地 PDF） |
| A02 | Ansys Zemax KB 光谱仪（LGL 理论+实操） | 9 | 7 | Zemax KB 文章 ×4 |
| A03 | 《光学学报》峰值定位综述 | 1 | 0 | 未取得原文 |
| B01 | Ansys Zemax KB 公差分析 | 11 | 11 | Zemax KB 文章 |
| B02 | Ansys Zemax KB DOE / 超透镜 | 4 | 4 | Zemax KB 文章 |
| C01 | ZYGO CSI 白皮书 / ISO 25178 | 5 | 0 | zygo.com 403 |
| C02 | Ansys Zemax KB RCWA / Kogelnik 光栅效率 | 7 | 7 | Zemax KB 文章 |
| D01 | 滨松《Si photodiodes》技术说明 | 11 | 9 | 17 页 PDF |
| E01 | JJF 1990-2022 校准规范 / 光学制图 | 6 | 1 | 规范查询页 |
| **合计** | | **67** | **51** | |

- 状态分布：`present 51` / `missing_source 11` / `substitute 5`（真实状态名是 `missing_source`，方案里 "missing" 是简写）。
- 每块字段：`doc_id / chunk_id / status / is_original_excerpt / text / source / page_or_section / keywords_zh / disclaimer`。
- 内置数据 `data/kb-data.json` 与源 `D:\AI\OpticsGPT\opticsgpt-space\kb-data-full.json` 逐字段一致（集成测试 E1 校验）。

### 5.2 检索算法

Okapi BM25（k1=1.5，b=0.75），中文「单字 + 相邻双字」、英文/数字按词小写；可检索字段 = `text + keywords_zh + page_or_section + source + disclaimer`；从 `D:\AI\OpticsGPT\optics-train\kb_tool.py`（5/5 selftest 通过的纯 Python 参考实现）移植为纯 JS。

### 5.3 知识空白（如实告知）

方案 §4 列出 11 板块 / 41 主题，其中以下主题 **当前 KB 0 覆盖或极薄**，检索应返回空并如实告知，不得编造：

> 量子计算与量子信息、量子光学、COMSOL 多物理场耦合 / 波动光学、SolidWorks 工程图与仿真 / 建模、图像处理与缺陷检测、热光学与无热化、热稳定与公差链、衍射光波导 AR、光波导与光子集成、非球面与自由曲面、辐射度学、黑体与红外测温、高光谱、色度学、杂散光、环境可靠性 等。

覆盖层：知识库 67 块原文 + 板块要点卡片（41 主题，人工润色）+ 5 个工程公式 + 知识空白如实告知。

---

## 6. 云端 Dataset（方案 A：ModelScope Datasets `GrestestOptics/optics-kb`）

> **重要前提**：实测 `https://www.modelscope.cn/datasets/GrestestOptics/optics-kb` 当前返回 404「不存在的数据集」（与 PLUGIN_PLAN.md:256 一致）。**需用户本人先在 ModelScope 网页创建该 Dataset** 并确认账号有写权限，否则上传必然撞 404；AI 无法代登、无法代建、不接触任何凭据。

### 6.1 结构化列（67 行，UTF-8，**9 列**）

`doc_id`(string) / `chunk_id`(string) / `status`(string) / `text`(string) / `source`(string) / `page_or_section`(string) / `keywords_zh`(string) / `is_original_excerpt`(bool) / `disclaimer`(string)

> **口径说明（与方案 §2.4 的差异，如实记录）**：PLUGIN_PLAN.md §2.4 原写 **8 列**（不含 `disclaimer`）；但 `lib/kb-data.js:14-17` 的 `REQUIRED_FIELDS` 含 `disclaimer`、`isValidKB()` 对云端拉回数据**逐块检查全部 9 字段**。若云端 Dataset 只存 8 列，`syncFromCloud()` 会因校验失败而**静默回退内置数据**，云端同步闭环断裂。因此 `scripts/export_dataset.py` 导出 **9 列（增加 `disclaimer` 作为第 9 列）**，不改 `lib/kb-data.js`、不改 `package.json`，与运行时 9 字段校验一致；JSONL 每行可直接作为 `parseCloudPayload()` 的输入。上传脚本同时兼容 8 列旧文件（会给出「云端同步会失效」的明确警告）。

### 6.2 步骤（上传必须由用户本人登录）

```bash
# 1) 导出 67 行 9 列 JSONL + CSV（纯 Python 标准库，无需登录、无需 modelscope SDK）
python scripts/export_dataset.py
#    默认读插件内置副本 opticforge/data/kb-data.json（与源 kb-data-full.json 逐字段一致）
#    默认写到 opticforge/data/opticforge-dataset.jsonl 与 .csv
#    可用 -i 指向外部全量源：python scripts/export_dataset.py -i D:/AI/OpticsGPT/opticsgpt-space/kb-data-full.json -o D:/out
#    只校验不写文件：python scripts/export_dataset.py --check

# 2) 只校验数据、不上传（AI 可安全执行；不连网、不要求登录/SDK）
python scripts/upload_dataset.py --dry-run

# 3) 用户本人登录 ModelScope —— AI 无法代登、不接触凭据
#    方式 a: modelscope login --token <本人 Access Token>
#    方式 b: 网页登录 https://www.modelscope.cn （SDK 读取本地缓存登录态）
#    方式 c: 高级用法由用户本人在自己的脚本里用 HubApi(token=<本人 token>) / api.login(...)
#    注意：MODELSCOPE_API_TOKEN 并非 SDK 支持的登录环境变量，不要依赖它。

# 4) 用户本人执行上传（需 pip install modelscope；注意必须带 --upload）
python scripts/upload_dataset.py --upload \
  --dataset-file data/opticforge-dataset.jsonl \
  --commit "init: OpticForge KB 67 chunks"
#    脚本调用官方 HubApi().upload_file(path_or_fileobj=..., path_in_repo="kb-data.json",
#    repo_id="GrestestOptics/optics-kb", repo_type="dataset", commit_message=...)
#    或回退官方 CLI：modelscope upload <repo_id> <本地文件> <仓库内路径> --repo-type dataset
#    仓库内文件名 kb-data.json 与 lib/kb-data.js 的 CANDIDATE_URLS 一致，保证云端同步闭环。
```

要点：

- **需用户本人先 `modelscope login --token <本人 token>` / 网页登录；AI 无法代登**。脚本不含账号密码、不读取浏览器隐私数据、不模拟登录、不打印 token 值；
- **默认即为 `--dry-run`（不连网、不上传），必须显式加 `--upload` 才真正推送**；仅去掉 `--dry-run` 或只给 `--commit` 都不会上传（旧文档/脚本的示例命令曾漏写 `--upload`，已修正）；
- `--dry-run` 校验 67 行、9 列（也兼容旧 8 列并警告）、status 分布 51/11/5、doc_id 分布，不 import modelscope、不联网；
- 官方 SDK **没有 `push_dataset` 方法**（PLUGIN_PLAN.md:87 的 `api.push_dataset` 是错的）；本脚本只调用已核对过的 `HubApi.upload_file` / `upload_folder` 或 CLI `modelscope upload`，见 https://www.modelscope.cn/docs/datasets/upload ；
- 上传失败（未登录 / token 失效 / Dataset 不存在 / 网络问题）会打印中文排查清单并退出，不伪造成功；
- **云端同步如实口径**：`lib/kb-data.js` 导出 `syncFromCloud(force=false)` 供宿主在需要时显式调用；本插件的 `apply()` / 两个工具**不会自动发网络请求**。只有 `syncFromCloud()` 才会通过 ModelScope HTTP API 尝试拉取 `GrestestOptics/optics-kb` 并缓存到 `~/.dsh/opticforge-cache/`；`getKBData()` 只读取**已成功同步**的本地缓存，否则回退内置 67 块数据。任何网络 / 解析失败都静默回退内置数据，**离线完全可用**。

### 6.3 命令速查

| 目的 | 命令 |
|---|---|
| 导出（默认：内置源 → `data/`） | `python scripts/export_dataset.py` |
| 导出并指定外部源/输出目录 | `python scripts/export_dataset.py -i D:/data/kb-data-full.json -o D:/out` |
| 只校验源数据 | `python scripts/export_dataset.py --check` |
| 校验待上传 JSONL | `python scripts/upload_dataset.py --dry-run` |
| 本人登录 | `modelscope login --token <本人 Access Token>` |
| 本人上传（必须带 --upload） | `python scripts/upload_dataset.py --upload --dataset-file data/opticforge-dataset.jsonl --commit "..."` |

---

## 7. 集成测试与自检

```bash
# 必须能用 node 直接运行（不依赖测试框架安装）
node test/run.mjs
# 或
node --test test/run.mjs
```

测试内容（`node:test`，23 个用例）：

- 用 **asar 内真实的 `@deepseek-ai/dsh-tools`** 校验 `lib/index.js` 注册的两个 `defineTool`：`parameters` / `output.schema` 通过真实 `assertSupportedJsonSchema`，`output.render` 可调用，`execute` 返回值通过 `validateJsonSchemaValue` 符合 `output.schema`；
- 端到端检索：共焦色散→A01、RCWA→C02、doc_filter、top_k、status=present 过滤、知识空白如实告知（C6 硬断言）；H1 数据驱动守卫回归 C6b/C6c（不确定度→E01-06、自由曲面→B01-10 必须命中，不得误屏蔽）与 C6d（真 0 覆盖主题仍短路）；
- 5 个计算器示例数值（含 D1b 精确值/方案示例值双口径核验）+ 未知 type / 缺参 / 非法参数 `ok:false` 不抛异常（D6b 区分「工具层 enum 干净拒绝」与「calculate() 层结构化返回」两层契约）；
- 统计断言：67 块、51 present、状态与 doc_id 分布、内置数据与源文件逐字段一致；
- 测试脚本本身**不修改任何源码文件**（只写并在收尾自动清理 `test/.asar-runtime/` 依赖缓存）。队友模块未写完时给出清晰失败信息，不静默跳过。

> `test/_asar_loader.mjs` 负责从只读的 `app.asar` 归档里抽取 `@deepseek-ai/dsh-tools` 及其依赖到缓存目录，并通过 Node ESM loader hook 让插件的裸导入可解析；这是为了让「用真实 defineTool 校验」在普通 `node` 进程里也能跑。

---

## 8. 文件清单（本任务交付）

| 文件 | 说明 |
|---|---|
| `test/run.mjs` | 集成测试主入口（可直接 `node` 运行） |
| `test/_asar_loader.mjs` | 抽取 asar 内真实 dsh-tools 运行时的辅助模块 |
| `scripts/export_dataset.py` | 导出 67 行 **9 列** JSONL + CSV（纯标准库，含 `disclaimer`） |
| `scripts/upload_dataset.py` | ModelScope Dataset 上传（默认 dry-run，显式 `--upload` 才推送，需本人登录，官方 `upload_file` API） |
| `docs/USAGE.zh.md` | 本文档 |

> 另有 `scripts/verify-all.mjs`（lead 的最终契约审查脚本，只读）与 `scripts/install-local.mjs`（安装脚本），不属于本任务写范围。

> 其余文件（`lib/`、`data/kb-data.json`、`package.json`、`cordis.patch.yml`、`README.zh.md`、`scripts/install-local.mjs`、`docs/INSTALL.zh.md`）由其他队友 / lead 负责；本任务不修改它们。

---

## 9. 更多检索示例（实测要点）

| 查询 | 预期 | 说明 |
|---|---|---|
| `{"query":"共焦色散 测量原理"}` | top1=A01-01，total_hits=5 | Micro-Epsilon confocalDT 共焦色散原理（BM25 分数 ≈29.05） |
| `{"query":"RCWA 光栅 衍射效率"}` | top1=C02-01，total_hits=5 | Zemax KB RCWA 光栅效率 |
| `{"query":"公差分析 Monte Carlo","doc_filter":"B01"}` | 全部 doc_id=B01 | doc_filter 生效 |
| `{"query":"不确定度 评定"}` | top1=E01-06，total_hits=5 | **不被守卫误伤**："不确定度"在 E01-06 的 keywords_zh 真实出现 |
| `{"query":"自由曲面 光学设计"}` | top1=B01-10，total_hits=5 | 同上，B01-10 真实依据放行 |
| `{"query":"量子计算 光学"}` | total_hits=0 + note | 数据驱动守卫：该主题在 present 块 0 出现，短路才是如实告知 |

## 10. FAQ

**Q：为什么结果里 d = 706.3158，方案 §3.2 写 ≈708 nm？**
708 是方案示例值，疑为取整/笔误。插件遵守"不编造"保留公式精确值 **706.3158 nm**，并把 708 作为 `result.plan_example_d_nm` 如实标注（集成测试 D1b 同时核验两个值）。

**Q："量子计算 光学"为什么返回空？**
该主题 KB 0 覆盖。`isZeroCoverageQuery(query, chunks)` 数据驱动三重判据（词表命中 + 无 COVERED_ANCHORS + 运行时 present 块可检索字段 0 出现）判定短路，返回空 + `note="知识库中未找到相关依据"` 是正确行为。

**Q：离线时行为如何？**
`getKBData()` 只读取已成功同步的云端缓存，否则回退**内置 67 块**；两个工具不发网络请求，检索与计算完全离线可用。只有宿主显式调用 `syncFromCloud()` 才会有网络访问。

**Q：如何只看某篇文档的检索结果？**
用 `doc_filter`：`{"query":"公差分析","doc_filter":"B01"}`。值是 doc_id 前缀（A01/B01/C02 等）。

**Q：`top_k` 超过命中数会怎样？**
返回实际命中数。`top_k` 只是上限。

## 11. 验证体系

两套独立验证，都可离线跑：

```bash
# ① 端到端 74 项断言（独立 node.exe 可跑；内联解析 asar 提取真实 dsh-tools）
node scripts/verify-all.mjs   # → RESULT: ALL PASS（74/74）

# ② 23 用例集成测试（node:test；运行收尾自动清理 test/.asar-runtime/）
cd opticforge && node test/run.mjs   # → 23/23 PASS
```

缓存：verify-all 把依赖闭包提取到 `os.tmpdir()/dsh-opticforge-verify-runtime`，缓存 stamp 含脚本自身 sha256，代码变更自动重建。非默认安装路径用 `DSH_ASAR=<app.asar 路径>` 覆盖。

---

