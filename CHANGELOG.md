# 变更记录

## 0.2.0

知识库大扩充：9 个板块 67 条 → **34 个板块 264 条**，计算器整体下线。

### 新增板块

- **F 系列（基础理论，10 个板块 / 83 条）**：几何光学与成像、干涉衍射与相干、偏振与晶体光学、激光原理与光束、辐射度/光度/色度、薄膜光学、光电探测与噪声、光谱学与色散、干涉计量与表面测量、材料与制造工艺
- **G 系列（工程与系统，7 个板块 / 53 条）**：光机结构与装调、公差/不确定度/热稳定、热光学与无热化、光谱与辐射定标、光学检测与图像处理、COMSOL 多物理场、SolidWorks 建模与工程图
- **H 系列（前沿与交叉，8 个板块 / 61 条）**：超表面与 DOE、光波导与光子集成、量子光学与量子信息、高光谱与光谱成像、激光三角/共焦/激光雷达、失效与现场、前沿专题、半导体光源

对应 PLUGIN_PLAN §4.2 的 41 个主题全部落地。

### 新增写作与校验机制

- 新增 `docs/KB-OUTLINE.zh.md`：板块与条目总纲，chunk_id 契约
- 新增 `docs/KB-SPEC-COMPILED.zh.md`：编译型板块规范（≥300 字、字段行 ≥3、来源可核对、不写厂商指标）
- `scripts/build-kb.mjs` 支持两类板块：原文型保持"chunk_id 集合等于原文 + 数字逐字回查"；编译型校验顺序编号、字段行、来源与免责声明
- `--check` 由硬编码总数改为"合并产物与分部文件逐字段一致"，减少基线漂移

### 移除

- 删除 `lib/calculators.js`、`opticforge_calc` 工具、`docs/CALCULATORS.zh.md`
- 工具由 4 个减为 3 个：`opticforge_docs` / `search` / `get`
- 测试移除 9 个计算器用例，新增 5 个目录/取用用例

### 数据

- `kb_version` → 0.2.0，`package.json` → 0.2.0
- 缺失/替代条目保持 16 条不变（A03、C01、E01 的原文仍未取得）
- 空白主题词表更新为当前真正未覆盖的方向（光刻工艺、空间光学、太赫兹、X 射线等）

## 0.1.0

首个公开发布版本。

### 包与安装

- 包名由 `@deepseek-ai/dsh-opticforge` 改为 `dsh-opticforge`
- 移除 `peerDependencies`（`@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis`）
- 工具改为原生 JSON Schema 注册，不再 `import @deepseek-ai/dsh-tools`
  - 不再需要从 `app.asar` 抽取依赖闭包
  - `link:` 安装即可用，参数校验由插件自身完成
- `scripts/install-local.mjs` 重写：只写 profile 依赖项、bundles 项与目录链接

### 知识库

- 数据按板块拆分为 `data/kb/*.json`，由 `scripts/build-kb.mjs` 合并为 `data/kb-data.json`
- 全部 `present` 条目改写为事实条目：`is_original_excerpt=false`、以`【标题】`开头、数字逐字回查原文
- 逐字厂商原文块清零（早期版本有 55 块逐字原文）
- 修正知识缺口条目的内部排障痕迹
- 新增 `data/kb-meta.json`：`kb_version`、`content_sha256`、板块清单、空白词表、覆盖锚点

### 检索与调用

- 新增 `opticforge_docs`（板块目录）与 `opticforge_get`（取完整条目）
- 检索摘录由"正文前 300 字"改为`【标题】` + 命中词周围 400 字窗口
- 检索回显 `matched_terms`、`chars`、`kb_version`、`total_matched`、`has_more`
- 新增 `offset` 翻页与 `max_per_doc` 同板块限流
- 三个知识库工具统一输出信封 `{ ok, kb_version, action, ... }`

### 移除

- 删除 ModelScope 云端同步链路与本地缓存（旧缓存会遮蔽新版数据）
- 删除 `scripts/upload_dataset.py`、`scripts/export_dataset.py`
- 删除 `syncFromCloud()` 与 `CANDIDATE_URLS`

### 测试

- 集成测试改为纯本地宿主桩，不再依赖 asar 抽取的真实 `defineTool`
- `scripts/verify-all.mjs` 重写为 29 项发布门前置检查
- 新增 GitHub Actions（Ubuntu + Windows × Node 20 + 22）
