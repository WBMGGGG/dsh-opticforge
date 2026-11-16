# OpticForge — 光电工程师知识库 + 工程计算（DSH 插件）

`@deepseek-ai/dsh-opticforge` 是一个 DSH 服务端 **cordis 插件**，注册 2 个 `defineTool`，让任意 DSH 会话里的 agent 能：

1. 用 Okapi BM25 检索内置的 **67 块光学知识库**（9 篇来源，其中 51 块 status=present 可检索）；
2. 调用 **5 类光电工程计算器**，输出完整计算过程与带单位的结果。

插件运行时 **纯 Node.js**（仅用 Node 内置模块），不依赖 torch/Python，无新增 npm 运行时依赖。它**不链接之前的 AI**：不含创空间 / 模型 / API 入口，只做本地知识检索与工程计算。回复一律中文。

---

## 一、插件用途

| 工具 | 作用 |
|---|---|
| `opticforge_search` | 中英文关键词 BM25 检索知识库，返回命中块的 chunk_id / doc_id / status / BM25 分数 / 正文前 300 字摘录 / 来源 / 页码。只返回 `status=present` 的块。 |
| `opticforge_calc` | 5 类工程计算：`diffraction_limit`（衍射极限）、`coating_thermal_drift`（镀膜中心波长温漂）、`confocal_range_select`（共焦量程选型）、`tolerance_rss`（公差 RSS 合成）、`na_resolution`（数值孔径与分辨率）。 |

知识覆盖：薄膜、偏振、公差分析、干涉衍射、光谱仪与光栅、Zemax 成像设计、激光原理、光电探测器、噪声与微弱信号、失效与现场、几何光学等板块（详见方案 §4，共 11 板块 / 41 主题）。

---

## 二、安装方式（由 lead 统一处理）

> 本插件的所有交付文件只创建在 `D:/AI/DeepSeek Harness/opticforge/` 下。**安装 / 激活由 lead 统一处理**，不会修改 `C:/Users/Lenovo/.dsh/profiles/desktop/cordis.patch.yml` 或 DSH 安装目录之外的其他文件。

常见两种放置方式：

1. 把整个插件目录放到 DSH 的 `node_modules`：`D:/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-opticforge/`，DSH 启动时按 cordis 补丁自动加载；
2. 或放到用户 profile 的插件目录下，通过自定义插件索引安装。

加载链路：`package.json` 的 `dsh.bundle.patch` 指向 `./cordis.patch.yml`，补丁内容为：

```yaml
- insert:
    - id: opticforge
      name: '@deepseek-ai/dsh-opticforge'
```

插件 `main` 为 `lib/index.js`，`inject = ["tools"]`，`apply(ctx)` 里通过 `ctx.tools.register(defineTool(...))` 注册两个工具。

**兼容性注意**：`peerDependencies` 中 `@deepseek-ai/dsh-tools` 必须写 `0.2.2-rc.1`（或能匹配该运行时版本的范围），否则 DSH 的 `unmetRequirements` 审查会跳过该 bundle（`skippedBundles`）；不要写 `engines.dsh`（一旦声明，peerDependencies 会被完全忽略）。

---

## 三、两个工具用法示例

### 3.1 `opticforge_search`（知识库检索）

参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 中文 / 英文检索词 |
| `top_k` | number | 否 | 最多返回条数，默认 5 |
| `doc_filter` | string | 否 | 按 doc_id 过滤（A01/B01/C02 等） |

调用示例：

```json
{ "query": "共焦色散位移传感器 IFS2402 量程 分辨率", "top_k": 5, "doc_filter": "A01" }
```

返回（结构示意）：

```json
{
  "query": "共焦色散位移传感器 IFS2402 量程 分辨率",
  "total_hits": 2,
  "source": "OpticForge KB (ModelScope Datasets GrestestOptics/optics-kb)",
  "note": "仅返回知识库中 status=present 的原文块；知识空白如实告知。",
  "results": [
    {
      "chunk_id": "A01-02",
      "doc_id": "A01",
      "status": "present",
      "score": 8.1234,
      "excerpt": "IFS2402 系列量程 0.5 / 1.5 / 3.5 mm，静态分辨率 <8 / <30 / <50 nm……",
      "source": "Micro-Epsilon confocalDT 产品目录（本地 PDF）",
      "page": "规格表"
    }
  ]
}
```

**未命中 / 知识空白**：`total_hits = 0`、`results = []`，`note = "知识库中未找到相关依据"`。量子计算、COMSOL、SolidWorks、图像处理、热光学等主题 KB 无覆盖，检索返回空是**正确行为**，插件如实告知，不编造。

> **实现说明（`isZeroCoverageQuery` 数据驱动守卫）**：BM25 从 `kb_tool.py` 忠实移植，中文按「单字 + 相邻双字」切分；单字兜底会让「光学 / 光 / 学 / 量 / 子」等通用字在 51 个 `status=present` 块里普遍命中，使「量子计算 光学」这类**已声明 0 覆盖**主题产生低分伪命中（实测 5 条，最高 14.5232）。把这些伪命中当作「依据」返回会违反「不编造 / 知识空白如实告知」硬约束。为此 `lib/index.js` 实现 `isZeroCoverageQuery(query, chunks)`，仅当**三重判据全部满足**才短路返回空结果 + `note`：
>
> 1. `query` 命中 `ZERO_COVERAGE_TOPICS`（量子计算 / 量子信息 / 量子光学 / COMSOL / SolidWorks / 图像处理 / 缺陷检测 / 热光学 / 无热化 / 热稳定 等 §4.3、§8.5、§2.2 与用户补录里已声明 0 覆盖的主题）；
> 2. `query` 不含 `COVERED_ANCHORS`（共焦色散 / IFS2402 / RCWA / 光栅 / 公差分析 / RSS / photodiode / 量程 / 分辨率 等 KB 明确覆盖的核心主题）——混合查询一律放行，避免误伤；
> 3. **运行时按当前 KB 数据核实**：命中的主题词在 `status=present` 块的可检索字段（`text` / `keywords_zh` / `page_or_section` / `source` / `disclaimer`，与 `kb-engine.js` 的 `buildIndex` 对齐）中确实 0 出现。
>
> 第 3 条是数据驱动的关键：词表只是「已声明 0 覆盖」清单，是否短路由**运行时 KB 数据**判定，避免词表与 KB 实际覆盖漂移造成误伤。实测「不确定度」在 `E01-06`（present）、「自由曲面」在 `B01-10`（present）的 `keywords_zh` 中是真实依据，因此**不会被短路**；「白光干涉」仅出现在 `C01-*` 的 `missing_source` / `substitute` 块（本就不返回），仍如实短路。集成测试 `test/run.mjs` 的 C6（「量子计算 光学」→ 空 + note）与 C7（纯 ASCII 乱码未命中）覆盖该行为。

### 3.2 `opticforge_calc`（工程计算）

参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string(enum) | 是 | `diffraction_limit` / `coating_thermal_drift` / `confocal_range_select` / `tolerance_rss` / `na_resolution` |
| `params` | object | 是 | 各计算器的参数对象 |

调用示例（衍射极限）：

```json
{ "type": "diffraction_limit", "params": { "lambda_nm": 550, "NA": 0.95 } }
```

返回（**真实结果片段**，即 `calculate("diffraction_limit", { lambda_nm: 550, NA: 0.95 })` 的输出；字段名与运行时一致，输出**完整计算过程**）：

```json
{
  "type": "diffraction_limit",
  "ok": true,
  "formula": "d = 1.22 × λ / NA",
  "substitution": "λ = 550 nm，NA = 0.95；d = 1.22 × 550 / 0.95 = 706.3158 nm",
  "steps": [
    "① 公式：d = 1.22 × λ / NA（结果 d 与 λ 同单位）",
    "② 代入：λ = 550 nm，NA = 0.95 → d = 1.22 × 550 / 0.95",
    "③ 分子：1.22 × 550 = 671 nm",
    "④ 除法：671 / 0.95 = 706.3158 nm",
    "⑤ 结果：d ≈ 706.3158 nm（最小可分辨距离 / 艾里斑直径）",
    "⑥ 校核：艾里斑半径 = 0.61 × 550 / 0.95 = 353.1579 nm，恰为 d/2"
  ],
  "result": {
    "value": 706.3158, "unit": "nm",
    "d": 706.3158, "d_display": "≈706.3158 nm",
    "lambda": 550, "lambda_unit": "nm", "NA": 0.95,
    "airy_radius": 353.1579, "airy_radius_unit": "nm",
    "numerator_1_22_lambda": 671,
    "plan_example_d_nm": 708
  },
  "source": "通用光学公式（Rayleigh 判据 / Airy 斑）；KB 参考 A02-03（Diffraction limit / Airy disk / Rayleigh criterion）",
  "notes": [
    "① 公式 d = 1.22λ/NA 给出艾里斑第一暗环直径；Rayleigh 两点可分辨距离常取 0.61λ/NA，两者相差 2 倍，勿混用。",
    "② 方案 §3.2 示例记作 ≈708 nm，与公式精确值 706.3158 nm 不一致（疑为取整/笔误）；result.plan_example_d_nm = 708 仅为方案示例值的如实标注，精确答案以 value/d 字段为准，不改动公式去凑示例值。",
    "③ 该式为 diffraction-limited 理想值，未计入像差、加工与探测器像元尺寸。"
  ]
}
```

> 注意：`result` **不含** `d_nm` 键，真实返回键为 `value` / `d` / `d_display` / `lambda` / `lambda_unit` / `NA` / `airy_radius` / `airy_radius_unit` / `numerator_1_22_lambda` / `plan_example_d_nm`。**708 裁决**：精确值 `706.3158 nm`，不改为凑方案示例的 708；方案示例 708 疑为笔误，精确值以公式结果为准。

**参数不足 / 非法 / 未知 type**：`ok = false`，在 `error`、`suggestion` 中说明原因并给出合理范围建议，不编造数值；返回对象始终含 `type / ok / formula / substitution / steps / result / source` 全部字段（缺字段由插件骨架补齐空串 / 空数组 / `{}`）。

---

## 四、数据来源

- **内置知识库**：67 块，UTF-8 JSON 数组，字段 `doc_id / chunk_id / status / is_original_excerpt / text / source / page_or_section / keywords_zh / disclaimer`。
  - status 分布：`present` 51 / `missing_source` 11 / `substitute` 5（`missing_source` 为真实状态名，方案简写为 missing）。
  - doc_id 分布：A01=13、A02=9、A03=1、B01=11、B02=4、C01=5、C02=7、D01=11、E01=6。
  - 来源：Micro-Epsilon confocalDT 产品目录、Ansys Zemax KB 文章、滨松《Si photodiodes》技术说明、ZYGO / ISO 25178 白皮书、JJF 1990-2022 校准规范查询页等。
  - 检索数据标注统一为：`OpticForge KB (ModelScope Datasets GrestestOptics/optics-kb)`。
- **检索算法**：Okapi BM25（k1=1.5，b=0.75），中文按单字 + 相邻双字，英文/数字按词小写，字段覆盖 text + keywords_zh + page_or_section + source + disclaimer；从 `kb_tool.py` Python 参考实现移植为纯 JS。
- **工程公式**：5 个计算器内置公式，依据光学基础 + KB 原文（A01-02 IFS2402 规格表、B01-01 公差分析概述等）。

---

## 五、云端 Dataset（需用户本人登录上传）

- 方案采用 ModelScope Datasets **`GrestestOptics/optics-kb`** 作为云端知识库数据源：67 行结构化列（doc_id / chunk_id / status / text / source / page_or_section / keywords_zh / is_original_excerpt），UTF-8。
- **云端同步口径（按需显式调用，不自动联网）**：`lib/kb-data.js` 导出 `syncFromCloud(force=false)` 供宿主在需要时显式调用；本插件的 `apply()` / 两个工具不会自动发网络请求。`syncFromCloud()` 才会通过 ModelScope HTTP API 尝试拉取 `GrestestOptics/optics-kb` 并缓存到 `~/.dsh/opticforge-cache/`；`getKBData()` 只读取已成功同步的本地缓存，否则回退内置 67 块数据。任何网络/解析失败都静默回退内置数据，离线完全可用。
- **上传必须由用户本人完成**：网页登录 ModelScope，或用 `modelscope login` 后用 Python SDK 推送；AI 无法代登录。上传脚本为开发仓库中的 `scripts/export_dataset.py`（导出 JSONL+CSV）与 `scripts/upload_dataset.py`（默认 `--dry-run` 只校验）；二者**不在 npm 发布包内**。
- 不链接之前的 AI：不含创空间 / 模型 / 推理 API 入口；唯一外部网络访问是上节的 ModelScope Dataset **文件下载**（由宿主按需显式触发，失败静默回退），不是模型推理 API。

---

## 六、硬约束（PLUGIN_PLAN.md §8）

1. **不链接之前的 AI**：不含创空间 / 模型 / API 入口，纯知识检索与工程计算。
2. **不编造**：检索未命中如实返回「知识库中未找到相关依据」（`note` 字段）；计算器参数不足时说明并给合理范围建议，不编造数值。
3. **纯 Node.js 运行时**：不依赖 torch / Python，无新增 npm 运行时依赖（仅 peerDependencies）。
4. **中文回复**：所有用户交互中文；代码注释可中文。
5. **知识空白如实告知**：量子计算 / COMSOL / SolidWorks / 图像处理 / 热光学等 KB 无覆盖，检索返回空是正确行为。
6. **交付范围**：所有交付文件只创建在 `D:/AI/DeepSeek Harness/opticforge/` 下；不修改该目录之外的任何文件（尤其 `C:/Users/Lenovo/.dsh/profiles/desktop/cordis.patch.yml` 与 DSH 安装目录）——安装 / 激活由 lead 统一处理。

---

## 七、目录结构

```
opticforge/
├── package.json          # ESM / main / exports / dsh.bundle.patch / peerDependencies
├── cordis.patch.yml      # cordis 插入补丁
├── README.zh.md          # 本文件
├── lib/
│   ├── index.js          # 插件骨架：apply(ctx) 注册 2 个 defineTool
│   ├── kb-engine.js      # Okapi BM25 检索引擎（已交付）
│   ├── kb-data.js        # 67 块内置数据 + 可选云端同步（已交付）
│   └── calculators.js    # 5 个工程计算器（已交付）
├── data/                 # 数据文件
├── docs/                 # 文档（仅开发仓库）
├── scripts/              # ModelScope Dataset 上传 / 安装脚本（仅开发仓库）
└── test/                 # 集成测试（仅开发仓库）
```

> **npm 包内容**：`docs/`、`scripts/`、`test/` 仅存在于开发仓库，**不在 npm 发布包内**。`package.json` 的 `files` 声明为 `lib/` / `data/` / `cordis.patch.yml` / `README.zh.md`（`package.json` 由 npm 自动包含）；实测 `npm pack --dry-run` 恰好打包 8 个文件：`README.zh.md`、`cordis.patch.yml`、`data/kb-data.json`、`lib/index.js`、`lib/kb-data.js`、`lib/kb-engine.js`、`lib/calculators.js`、`package.json`。
>
> 自检方式：用 DSH 自带的真实 `defineTool`（来自 `@deepseek-ai/dsh-tools`）对两个定义做 `defineTool(...)`、`execute`、`output.render` 校验，不抛错即合法；集成测试 `test/run.mjs` 在独立 Node 下 **20/20 通过**。四个 `lib/` 模块均已交付，`execute` 用动态 import 按需加载，并对模块缺失 / 异常做了兜底（只报告、不中断，不编造）。


---

## 八、项目定位与设计原则

OpticForge 为 DeepSeek Harness（DSH）提供**光电工程领域的本地知识检索与工程计算**能力：

- **本地优先**：知识库与计算全部在本地完成，断网时检索与计算照常可用（云端同步为可选增强，见 §五）；
- **可核查**：每个检索结果都带 `chunk_id` / `doc_id` / `source` / `page`，可回溯到 KB 原文；每个计算结果都带公式、代入过程与数据来源；
- **不编造**：检索未命中、知识空白、参数不足，全部如实告知并给出建议，绝不生成看似合理的假数据；
- **中文优先**：面向用户的输出一律中文，代码注释与文档亦为中文。

---

## 九、BM25 检索机制简述

- 参数：Okapi BM25，`k1 = 1.5`，`b = 0.75`；
- 分词：中文连续段产出**单字 + 相邻双字**（"共焦色散" → 共/焦/色/散/共焦/焦色/色散），英文与数字按词收集并转小写；
- 可检索字段：`text + keywords_zh + page_or_section + source + disclaimer`（与守卫判据一致）；
- 索引：只纳入 `status=present` 的 51 块；`idf = log(1 + (N - df + 0.5) / (df + 0.5))`；`score <= 0` 不返回；按 `(-score, chunk_id)` 排序，分数保留 4 位小数；
- 忠实移植：与 Python 参考实现 `kb_tool.py` **逐分比对 25/25 完全一致**（top-5 的 chunk_id 与 score），未做任何"改进"或硬编码过滤。

---

## 十、五个计算器速查表

| type | 公式 | 示例输入 | 精确结果 | 备注 |
|---|---|---|---|---|
| `diffraction_limit` | `d = 1.22 × λ / NA` | `λ=550nm, NA=0.95` | **706.3158 nm** | Airy 半径 353.1579 nm；方案示例 708 疑笔误，如实标注于 `plan_example_d_nm` |
| `coating_thermal_drift` | `Δλ/λ ≈ (dn/dT + α) × ΔT` | `λ=1064nm, dn/dT=1e-5/K, α=5e-7/K, ΔT=40K` | Δλ ≈ **0.4469 nm** | 热光项 4e-4 是热膨胀项 2e-5 的 20 倍；TiO₂/SiO₂ 符号相反补偿说明 |
| `confocal_range_select` | 量程→分辨率→线性度三步判据 | `0~2mm, 100nm, 反射` | 推荐 **IFS2402-1.5** | 如实报告"线性度 600nm 不满足 100nm 精度要求"，不隐瞒 |
| `tolerance_rss` | `σ_total = √(Σσᵢ²)` | `[0.5, 0.3, 0.2] µm` | **0.6164 µm (≈0.62)** | 附最差线性叠加 1.0 µm 对照；统计合成非最差情况 |
| `na_resolution` | `δ = 0.61 × λ / NA` | `λ=550nm, NA=0.95` | **353.1579 nm** | λ/2NA=289.4737；共焦模式 ≈249.7203（提升 1/√2） |

每个计算器的完整参数表（含 `normalizeParams` 参数别名映射）见 `docs/CALCULATORS.zh.md`。

---

## 十一、版本与兼容性

| 项 | 值 |
|---|---|
| 插件版本 | 0.1.0（ESM，`main: lib/index.js`） |
| DSH runtime（实测） | `0.2.2-rc.1` |
| peerDependencies | `@deepseek-ai/dsh-tools: 0.2.2-rc.1`（精确匹配 runtime）；`@deepseek-ai/cordis: ~4.1.0`（不以 `dsh-` 开头，运行时不校验） |
| Node 运行环境 | DSH Electron 内置；独立 `node.exe` 亦可（安装脚本会把 peer 依赖闭包复制为插件包内真实文件） |
| Python（仅上传脚本） | 3.x 纯标准库（导出/校验）；真正上传才需要 `modelscope` SDK |

---

## 十二、FAQ

**Q1：装完后工具没出现？**
需**重启 DSH**（运行中的组合不会自动加载新 bundle）。重启后仍未出现，检查 `skippedBundles`：常见原因是 peer 版本范围与 runtime 不匹配、`cordis.patch.yml` 的 `name` 与包名不一致、或 `dsh.bundle.patch` 声明缺失。

**Q2：如何卸载？**
`node scripts/install-local.mjs --uninstall`（会删除插件目录并从 profile bundles 移除，幂等安全）。

**Q3：离线时能用吗？**
能。`getKBData()` 只读取已成功同步的云端缓存，否则回退**内置 67 块数据**；两个工具本身不发网络请求。云端同步仅当宿主显式调用 `syncFromCloud()` 才发生。

**Q4：为什么检索结果 d = 706.3158，方案里写 708？**
708 是方案 §3.2 的示例值，疑为取整/笔误。为遵守"不编造"，插件保留公式精确值 **706.3158 nm**，并把 708 作为 `result.plan_example_d_nm` 如实标注，详见 §3.2 的 708 裁决说明。

**Q5：为什么"量子计算 光学"返回空？**
该主题在 KB 中 0 覆盖，返回空并附 `note="知识库中未找到相关依据"` 是**正确行为**（数据驱动三重判据守卫，见 §3.1 实现说明）。

**Q6：能检索英文吗？**
能。BM25 对英文按词小写处理；但 KB 原文多为中英混排，中文检索词的召回通常更好。

---

> 集成测试：`node test/run.mjs`（23 用例，含真实 defineTool 契约校验）；端到端断言：`node scripts/verify-all.mjs`（74 项断言，独立 node.exe 可跑）。详见 `docs/TESTING.zh.md`。
