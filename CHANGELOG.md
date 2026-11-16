# 变更记录

## 1.1.0

架构升级：从“检索插件”改为“任务辅助插件”。输入一个具体问题，输出可直接执行的作战包；检索退为证据层。

### 新增辅助层

- **`opticforge_assist`**：任务受理 + 取证 + 能力路由 + 分阶段计划 + 定向检索包 + 验收清单 + 可交接 Markdown
  - `brief`：目标、领域、意图、交付物、约束、待澄清（≤3 问）
  - `evidence`：≤10 条 present 条目，带 chunk_id、来源、摘录、命中的检索面
  - `coverage_matrix` / `gaps` / `library_gaps`：检索面覆盖、主题缺口、A03/C01/E01 原文缺口
  - `capabilities`：扫描本机 Skill 与 MCP，支持 `known_capabilities` 声明校正
  - `local_assets`：`workspace` 内图纸/数据/代码/文档清单（只读文件名与大小）
  - `plan`：每步 phase/goal/capability/actions/output/routing，含关键路径与可并行步骤
  - `search_pack`：标准、论文、厂商、误差预算、成本五类定向检索词
  - `handoff`：可直接交给子 agent 的执行块
- **`opticforge_verify`**：交付自检
  - 引用是否存在、是否 present（error）
  - 数量断言是否有引用或计算说明（warning，strict 下 error）
  - 假设 / 缺口 / 复现 / 来源段是否齐备
  - 绝对化与营销词
  - 输出 0–100 分、`pass`、问题清单与 checklist

### 新增模块与数据

- `lib/assist.js`：受理、取证、路由、计划、验收
- `lib/capabilities.js`：Skill / MCP / 本地素材只读扫描
- `lib/verify.js`：文本级交付自检
- `data/assist-playbooks.json`：9 类任务剧本（高光谱、光学设计、检测装调、共焦、光谱仪、成像相机、薄膜、排障、调研）+ 交付物模板
- 新增 `docs/ARCHITECTURE.zh.md`

### 版本与基线

- `package.json` 与 `kb_version` → **1.1.0**
- 知识库内容不变：40 板块 / 324 条 / 308 present
- 原文缺口固定为 A03（1 条）、C01（5 条）、E01（6 条），assist 单列 `library_gaps`
- 集成测试 3 项 → **26 项**（新增 assist/verify/能力发现/版本一致性）
- 发布门禁 28 项 → **32 项**（打包清单增加 4 个新文件）
- 五个工具统一 `{ ok, kb_version, action }` 信封

## 0.2.1

场景深化，按使用场景补强几何光学、物理光学、光学检测、光学设计、高光谱成像与分光系统设计。**40 个板块 / 324 条 / 308 present。**

### 新增 I 系列（6 个板块 / 60 条）

- **I01 几何光学与像差的工程判读（10 条）**：光瞳与渐晕、远心度、球差与弥散斑、彗差与像散判别、场曲与畸变、色差分离、焦深与对准、镜头型式、变焦组元、像质验收口径
- **I02 物理光学与传递函数（10 条）**：相干长度换算、空间相干、条纹可见度、傅里叶性质、PSF/MTF、相干传递函数、部分相干与散斑、偏振干涉、衍射计算近似、薄膜 GDD
- **I03 光学检测（10 条）**：面形与子孔径拼接、波前检测、MTF 测量、畸变/主点/焦距、透过率与杂散光、后截距与法兰距、焦深与最佳像面、相对照度、环境控制、检测报告判据
- **I04 光学设计（10 条）**：规格分解、初始结构、评价函数、优化策略、像差平衡、玻璃选择、非球面引入、公差回代、可制造性、设计评审清单
- **I05 高光谱成像：推扫与快照（10 条）**：数据立方、推扫几何与速高比、分光链像差、smile/keystone 配准、快照四类、积分视场、编码孔径、滤光片阵列、SNR 与运动预算、定标与验收
- **I06 分光系统设计（10 条）**：Czerny-Turner 几何、消像散条件、像差与狭缝弯曲、Offner 同心三镜、凸面光栅、Littrow、透射式、分辨率与杂散光、公差装调、选型对比

### 数据与一致性

- `kb_version` → 0.2.1，`package.json` → 0.2.1
- `lib/kb-data.js` 基线 → 324 块 / 308 present
- `scripts/build-kb.mjs` 编译型系列扩展为 F/G/H/I
- 测试基线同步：B1 324/308/40、D1 40 板块、E1 ≥40 个分部文件
- README / KB / USAGE / TESTING / 总纲统计表同步

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
- 空白主题词表收敛为维护者确认不再补充的方向（光刻工艺、空间光学）

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
