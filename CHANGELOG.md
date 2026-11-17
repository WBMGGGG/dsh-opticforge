# 变更记录

## 3.1.0

交叉化改造：从“单剧本 + 检索面”升级为“多剧本激活 + 维度取证 + 交叉核对 + 采信闸门”。仍是五个工具，插件不联网、不写文件、不执行命令；知识内容不变（40 板块 / 324 条 / 308 present）。

### L2 数据层

- `data/assist-playbooks.json` 升到 version 3：9 → **16 张主题卡**，新增位置姿态、红外系统、光纤传感、干涉/OCT、波导 AR、信号链、不确定度与定标；每张卡补 `required_dimensions`（共 98 条维度声明）、`relations`、`cross_check`，每个步骤补 `dimension_id`
- 新增 `data/concept-cards.json`：308 张概念卡，从 `kb-data.json` 的 308 条 present 块**一块一卡**逐字抽取，不改写、不加数值；8 域分布 IM53/QE33/MT65/DT26/TF67/EL3/DS53/AL8，全部带 `applies_to`
- 新增 `scripts/build-concept-cards.mjs`：40 板块 → v3 八域/54 族映射，支持 `--write`/`--check`；`build-kb --all` 写完 meta 后自动重建概念卡
- 新增 `data/cross-dimensions.json`：principle/design/calc/implementation/verification/risk 六个通用维度模板，含 queries/boards/priority

### assist：多剧本与维度化

- `detectPlaybooks` 改为多激活：主剧本必选，其余需分数 ≥2 且命中至少一个非通用词，最多 3 张；`GENERIC_KEYWORDS` 21 词压掉“分辨率/成像”这类跨义项误激活
- 新增 `fuseDimensions`（同 id 合并、最小 priority、合并 domains/boards、记录 sources，上限 12）与 `fuseRelations`（只留两端存在的维度）
- `collectEvidenceByDimensions`：每维度独立检索（label+anchor+anchorTerms+queries），输出 evidence/hit_chunk_ids/queries/concept_cards/gap_reason；全局证据优先剧本 sections、跨板块最多补 2
- `coverage_matrix` 升为**维度×来源**：每行带 `source_matrix`（kb covered/gap + web not_required/required），alignment 增 `source_summary`
- `buildSearchPack` 增按缺口维度的中英双语外部组（`facet:"缺口·X"`、`gate_id:"kb_gap"`、带 `dimension_id`）
- `buildPlan` 维度化：KB 步 `dimension_ids` 覆盖全部维度，专业步带 `dimension_id`，新增「缺口补证」与「交叉复核」步；relation 两端互写 `coordinates_with`，`parallelizable` 排除 critical/web_gated/有耦合的步
- `brief.active_playbooks` 回显激活主题卡与得分；alignment 改为维度口径（matched/unmatched 带 `dimension_id`）

### verify：交叉检查与采信闸门

- 新增可选入参 `dimensions` / `relations` / `now`，`VERIFY_PARAMS` 与 execute 透传
- 维度：缺面报 `missing_dimension`；维度附近无 chunk_id/URL 报 `dimension_without_evidence`
- 耦合：两端缺一报 `relation_not_reflected`；220 字内无约束/取舍词报 `relation_not_stated`
- 采信四判据：来源分级（一手/二手/未标，`external_source_tier` / `external_untrusted_source`）、多源交叉（单源报 `external_single_source`）、KB 冲突（未标 `conflict_with_kb` / 未说明 `conflict_with_kb_unstated`）、时效（价格/型号/标准超 30 天报 `external_stale`）
- 输出新增 `dimensions`（total/covered/missing/unevidenced/coupling_*）与 `adoption`（四判据 + pass）；checklist 增 `dimensions_complete` / `dimensions_evidenced` / `coupling_consistent` / `adoption_gate`

### 测试、评测与发布门禁

- `test/assist-contract.test.mjs` 18 → **24 例**：多剧本、通用词不误激活、维度×来源矩阵、缺口外部组、plan 维度/交叉/并行约束、verify 交叉与采信
- `test/run.mjs` 仍 30 例全绿；`test/entry-contract.test.mjs` 5 例全绿
- `eval/run-kb-first.mjs` 10 → **13 类**，新增光纤传感、AR 波导、不确定度定标；指标增 `multi_playbook_rate` / `dimension_coverage_rate` / `source_matrix_rate` / `cross_relation_rate`，并单独跑「交叉契约」合成文本
- `scripts/verify-all.mjs` 43 → **57 项**：打包清单增概念卡/通用维度、版本四处一致、概念卡一块一卡/来源/applies_to、主题卡 16 张/维度关系步骤闭合、assist 回显版本

### 文档

- `docs/ARCHITECTURE.zh.md`、`USAGE.zh.md`、`TESTING.zh.md`、`KB-OUTLINE.zh.md`、`KB.zh.md`、`INSTALL.zh.md`、`README.md`、`README.zh.md`、`skills/opticforge-task/SKILL.md` 更新为 3.1.0 与交叉契约/采信闸门

### 基线

- `package.json`、`data/kb-meta.json`、`data/concept-cards.json` 均为 **3.1.0**
- 知识内容不变：40 板块 / 324 条 / 308 present；A03/C01/E01 原文缺口不变
- 五工具名不变：`opticforge_assist` / `opticforge_verify` / `opticforge_docs` / `opticforge_search` / `opticforge_get`

## 1.2.0

把“先知识库、后联网”从建议升级为可检查的执行契约，同时落地软约束 Skill、公式卡、文档前置提取检查与 KB-first 评测。仍为五个插件工具，无计算器，插件不联网、不执行动作。

### KB-first 架构

- `assist` 新增 `alignment`：KB 查询、matched/unmatched、coverage_matrix 与 covered/partial/gap 判定
- 新增 `web_gate`：默认关闭，只有 KB 缺口、标准版本、厂商规格、价格/时效等条件满足才允许联网
- KB 查询与外部查询分离；外部查询带 `trigger/gated/gate_id/blocked_by`，web 执行步骤带 `blocked_by`
- `execution_contract.must` 明确禁止在完成 KB 对齐前调用 general_search/web_search/web_fetch
- 工具描述把 `opticforge_assist` 固定为光学任务第一入口，并在计划中声明先调 `opticforge-task` Skill

### P1：公式卡与计算轨迹

- 新增 `data/formula-cards.json`：19 张卡，覆盖薄透镜、NA/F#、焦深、高斯光束、M²、相干、RSS、热光程、响应度、噪声、光栅、色散、光谱分辨率、推扫 GSD、薄膜与 CT 消像散
- `assist.calc_specs` 只读返回公式、变量单位、假设、合理范围、算例与 KB 来源；不新增计算器
- `verify` 新增 formula_id 有效性、计算轨迹、外部引用日期/来源细节检查

### P2：软约束 Skill 与文档前置提取

- 新增 `skills/opticforge-task/SKILL.md`：assist → KB 对齐 → web_gate → 执行 → 公式卡轨迹 → 文档导出 → verify
- 安装器把 Skill 链接到 `~/.dsh/skills/opticforge-task`；真实目录不覆盖，卸载只删链接
- docx/pdf 先用 word/pdf Skill 导出 `.md/.txt`，再交给 `verify`
- 报告要求固定 KB 对齐段、外部来源访问日期与型号/标准号、计算轨迹和单位闭合

### P3：KB-first 评测

- 新增 10 类任务的契约评测：红外镜头、高光谱推扫、光栅光谱仪、薄膜热漂移、共焦选型、光机公差、干涉测量、杂光/鬼像、探测器选型、标准/白皮书调研
- 支持导入真实工具调用 JSONL，统计 assist 首调率、KB 先于 web、verify 使用率；无轨迹时只报告离线契约结果，不冒充模型行为达标

### 基线

- `package.json` 与 `kb_version` → **1.2.0**
- 知识内容不变：40 板块 / 324 条 / 308 present；A03/C01/E01 原文缺口不变
- 五工具名不变：`opticforge_assist` / `opticforge_verify` / `opticforge_docs` / `opticforge_search` / `opticforge_get`
- 发布门禁 43 项通过：主集成 30、assist 契约 18、入口契约 5、10 类离线评测全绿；真实模型轨迹指标需另行采集

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
