# OpticForge

光电工程师的**任务辅助插件**，面向 DeepSeek Harness（DSH）。输入一个具体的光电问题，输出一套可以直接执行的作战包：任务简报、按维度组织的知识证据、跨域关系、能力路由、分阶段计划、定向检索词与验收清单。

纯 Node.js，零运行时依赖。插件本身不联网、不执行外部动作——它负责"想清楚怎么干"，真正去干的是 DSH 执行层。

> English: [README.md](README.md)

---

## 1. 它是什么

光电工程任务真正卡人的往往不是公式，而是三件事。OpticForge 用三层分别解决：

| 问题 | OpticForge 的应对 |
|---|---|
| 依据散落在手册、标准、论文里 | **证据层**——40 板块 / 324 条带来源事实条目（308 条可用），按必答维度取证；每条命中带 chunk_id、来源、摘录；没有依据就明说 |
| 路径不清——先查什么、算什么、画什么、写什么 | **路由层**——多剧本激活、维度融合、本机 Skill/MCP/工作目录盘点，生成带 `dimension_id` 与 `coordinates_with` 的能力标签计划 |
| 交付看着对，一核引用/单位/假设/缺口就露馅 | **验收层**——交付前检查引用、数量、结构、公式轨迹、维度覆盖与采信闸门 |

插件是**辅助层**，不是执行器。`plan` 里的一切由 DSH 执行层完成。

---

## 2. 版本与知识库真相

本节是 **3.1.0 实际交付内容**的权威描述。在读其他部分前先看这里，避免形成错误预期。

### 2.1 版本

| 项 | 值 |
|---|---|
| `package.json` version | `3.1.0` |
| `data/kb-meta.json` 的 `kb_version` | `3.1.0` |
| 五个工具的 `kb_version` 回显 | `3.1.0` |

版本在三处校验，入口契约测试会拦——只改一处不改另外两处，CI 不过。

### 2.2 3.1.0 改的是机制，不是内容

**知识条目没有变。** 3.1.0 是机制版本：把"交叉覆盖"变成可检查的执行契约——多剧本激活、按维度取证、维度×来源覆盖矩阵、交叉核对、采信闸门。事实库仍是同样的 40 板块 / 324 条 / 308 present。

### 2.3 两个都叫"知识库"的东西

把这两者混为一谈，是错误预期最常见的来源：

| | 运行时知识库（插件实际查询的） | v3 内容地图（规划基准） |
|---|---|---|
| 在哪 | `data/kb/*.json` → `data/kb-data.json` | 一个设计目标，不作为可查询条目发布 |
| 形态 | 40 板块（A–E、F、G、H、I），324 条 | 8 域 × 54 族，约 470 个叶子主题 |
| 作用 | 唯一可引用的来源，仅 `status=present` | 定义"该覆盖什么"、跨域任务必须答哪几面 |
| 用在哪 | 每次 `assist` / `search` 调用 | 设计主题卡、确定评测覆盖面 |

**v3 地图是覆盖基准与检索词池，不是 470 条写满的完整 chunk。** 它没有废弃——16 张主题卡的必答维度正是从它派生出来的。穷举一份**主题目录**是有限的、有用的；为每片叶子写一篇**完整条目**则会让存储爆炸、稀释 BM25 精度。3.1.0 只做前者。

### 2.4 叠在运行时知识库上的三个只读层

| 文件 | 内容 | 作用 |
|---|---|---|
| `data/assist-playbooks.json` | 16 张主题卡、98 条维度声明、`relations` + `cross_check`、每步带 `dimension_id` | 跨域覆盖在这里显式声明，不靠检索碰运气 |
| `data/concept-cards.json` | 308 张原子卡，一条 present 块一卡，逐字抽取（不改写、不加数值）；8 域 IM53/QE33/MT65/DT26/TF67/EL3/DS53/AL8，每张带 `applies_to` | 把 v3 叶子压缩成可复用的原子，不重复建库 |
| `data/cross-dimensions.json` | 6 个通用维度：原理 / 设计 / 计算 / 实现 / 验证 / 风险 | 没有主题卡命中时兜底，保证交叉仍是默认行为 |

---

## 3. 三层如何协作

```
问题
 │
 ├─ opticforge_assist ── 受理与路由（不联网）
 │    ├─ brief          目标 / 交付物 / 约束 / 待澄清 / active_playbooks
 │    ├─ alignment      KB 查询 / matched / unmatched / verdict —— 按维度
 │    ├─ web_gate       默认关闭；缺口 / 版本 / 厂商 / 时效才打开
 │    ├─ dimensions     按维度取证 + 概念卡 + 缺口原因 + source_matrix
 │    ├─ relations      交叉关系 + cross_checks
 │    ├─ evidence       知识库证据 + 维度×来源矩阵 + 缺口
 │    ├─ capabilities   本机 Skill / MCP / 工作目录素材
 │    ├─ calc_specs     公式卡（只描述，不计算）
 │    ├─ plan           分阶段步骤；dimension_id、blocked_by、coordinates_with
 │    ├─ search_pack    KB 查询 + 按缺口维度分组的外部查询
 │    └─ acceptance     验收清单 + 风险 + 可交接 Markdown
 │
 ├─ 执行层（DSH agent）── 按 plan 执行
 │    ├─ Skill：opticforge-task / sheet / word / ppt / browser …
 │    ├─ MCP：桌面 / 浏览器 / GitHub …
 │    ├─ 本地：PowerShell / Python / 文件读写
 │    └─ 检索：仅在 web_gate 打开后 general_search + web_fetch
 │
 └─ opticforge_verify ── 交付自检（不联网）
      ├─ 引用 / 数量 / 结构 / 措辞
      ├─ KB-first：对齐段、verdict、URL 日期与来源细节
      ├─ 交叉：维度齐全、每面有据、耦合一致
      ├─ 采信：来源分级、多源交叉、KB 冲突、时效
      └─ 计算：formula_id、输入、单位、输出、复算路径
```

**边界**：`assist` 与 `verify` 是辅助、只读的。它们不联网、不写文件、不执行命令。这些由执行层做。

---

## 4. 五个工具

| 工具 | 层 | 用途 |
|---|---|---|
| `opticforge_assist` | 辅助 | **主入口**。问题 → 简报 + 证据 + 路由 + 计划 + 检索包 + 验收 + handoff |
| `opticforge_verify` | 辅助 | 交付自检。传 `text` 或 `.md/.txt/.json/.csv` 路径；0–100 分与问题清单。新增入参：`dimensions`、`relations`、`now` |
| `opticforge_search` | 证据 | BM25 检索；chunk_id、分数、命中词、摘录、来源、章节 |
| `opticforge_get` | 证据 | 按 chunk_id 取完整条目（9 个字段） |
| `opticforge_docs` | 证据 | 列出 40 个板块与每块标题 |

所有工具统一信封 `{ ok, kb_version, action, ... }`。

### 4.1 一次典型调用

```json
{
  "problem": "设计一台 400–1000 nm 推扫式高光谱成像仪，光谱分辨率 5 nm，空间分辨率 0.5 m@1 km，幅宽 30 km，给出分光方案、指标预算和定标流程",
  "deliverable": "方案报告",
  "workspace": "D:/AI/projects/hyperspectral",
  "known_capabilities": ["sheet", "word", "general_search"]
}
```

`assist` 会激活最多三张主题卡（此例通常是高光谱 + 光谱仪 + 光学设计），融合它们的必答维度（分光 / 像差 / 探测器 / 算法 / 电路 / 定标），返回：

- `brief`——目标、交付物、约束、待澄清、`active_playbooks`
- `alignment`——`kb_queries`、`matched` / `unmatched`、`coverage_matrix`、`verdict`（`covered` / `partial` / `gap`），全部按维度
- `dimensions`——每维度一行：证据、`hit_chunk_ids`、`concept_cards`、`gap_reason`、`source_matrix`（`kb`: covered/gap；`web`: not_required/required）
- `relations` / `cross_checks`——跨域约束与需要显式回答的交叉点
- `plan.steps[]`——每步带 `capability`、`actions`、`routing`、`output`、`dimension_id`、`blocked_by`；耦合步带 `coordinates_with`，并从 `parallelizable` 中排除
- `search_pack`——KB 查询 + 带 `trigger` / `gated` / `gate_id` / `blocked_by` / `dimension_id` 的外部查询组
- `handoff`、`acceptance`、`risks`

### 4.2 KB-first 与联网门禁

先调 `assist`，执行 `alignment.kb_queries`，记录 matched/unmatched 与 `verdict`，再核对 `web_gate`。`alignment.verdict` **只描述覆盖度**，从不放行联网。

`web_gate` 默认拒绝，需命中四个条件之一：`kb_gap`、`standard_version`、`vendor_params`、`price_timeliness`。即便命中，某条联网查询仍须其条件 granted 且该步 `blocked_by` 解除后才执行；web 步骤不与取证并行。随包 `skills/opticforge-task/SKILL.md` 给 DSH 固定同一流程。

**维度缺口显式表达**：某维度 KB 零命中时，`source_matrix.web.status = "required"`，并生成中英双语 `缺口·X` 外部查询组；交付物必须标 `covered_by_web` 与来源等级。这补上了"检索为空"与"插件悄悄编造"之间的空档。

### 4.3 计算与自检

`calc_specs` 从 19 张公式卡中选卡（公式、变量、单位、假设、合理范围、算例、KB 来源 ID）。插件不计算；执行层计算并记录 `formula_id`、输入、输出、单位与复算路径。

docx/pdf 先用 word/pdf Skill 导出 `.md` / `.txt`，再交给 `verify`。

---

## 5. 采信闸门——第二道闸门

放行闸门管"能不能联网"；采信闸门管"联网拿回来的知识可不可信、算不算覆盖"。带日期的 URL 不等于正确。

| 判据 | 规则 |
|---|---|
| 来源分级 | 一手源（标准原文、厂商 datasheet、官方手册、论文）可采信；二手源（博客、论坛、聚合站、自媒体）标 `untrusted`——只作线索，不作依据 |
| 多源交叉 | 关键数值（带宽、效率、温度、精度）需 ≥2 个独立一手源，或 1 个一手源并明确标"单源待核" |
| KB 冲突 | 联网事实与 KB present 条目冲突时标 `conflict_with_kb`；优先 KB，或解释差异（测试条件 / 版本 / 型号） |
| 时效 | 价格、型号、标准版本、交期类必须带访问日期；超阈值（如价格 30 天）标 `stale` |

只有采信通过的联网证据才会把维度从 `gap` 翻转为 `covered_by_web` 并计入覆盖；二手源/冲突源标 `unverified`，不计入。`verify` 输出 `adoption`（四判据 + pass），严格模式下失败判为错误。

`assist` 把要求前置：外部查询组对关键数值携带 `require_source_tier: "primary"` 与 `min_corroborations: 2`，让检索阶段就找可采信来源，而不是等到交付才被打回。

---

## 6. 能力发现

`assist` 做三项只读扫描，失败则降级为空列表并写 note，不阻断任务：

1. **Skill**——扫常见根目录（`~/.dsh/skills`、`~/.agents/skills`、`~/Doubao/skills`、workspace 的 `.skills` / `.user_skills`），读 `SKILL.md` 的 name/description。
2. **MCP**——读常见 `.mcp.json` / `mcp.json`，只取服务器名，从不读凭据。
3. **本地素材**——给了 `workspace` 就扫两层目录的图纸/数据/代码/文档，只读文件名与大小。

DSH 内建 Skill 在 `app.asar` 里，文件系统扫描看不到。传 `known_capabilities`（及 `known_mcp`）声明当前会话实际可用的项；声明项在路由中排最前。

---

## 7. 运行时知识库

### 7.1 内容

40 板块 / 324 条 / 308 `present`，按来源类型（A–E）或工程主题（F–I）组织：

| 系列 | 板块 | 内容 | 条目 |
|---|---|---|---|
| A–E | 9 | 厂商原文改写：共焦传感器、光谱仪搭建、公差分析、DOE、白光干涉、RCWA 光栅、光电二极管、计量规范 | 67（51 present） |
| F | 10 | 基础理论：几何光学、干涉衍射、偏振、激光、辐射度与色度、薄膜、探测与噪声、光谱学、干涉计量、材料工艺 | 83 |
| G | 7 | 工程系统：光机装调、公差与不确定度、热光学、光谱/辐射定标、检测与图像处理、COMSOL、SolidWorks | 53 |
| H | 8 | 前沿交叉：超表面与 DOE、光波导与光子集成、量子光学、高光谱、激光三角/共焦/雷达、失效现场、前沿专题、半导体光源 | 61 |
| I | 6 | 场景深化：像差判读、物理光学与传递函数、光学检测、光学设计、高光谱推扫/快照、Czerny–Turner 与 Offner 分光系统 | 60 |

概念卡分 8 个域：IM53 / QE33 / MT65 / DT26 / TF67 / EL3 / DS53 / AL8。这些域 ID 是通往 §2.3 所述 v3 内容地图的桥梁。

### 7.2 准确性规则

由 `scripts/build-kb.mjs` 强制：

**A–E（原文型，67 条）**——`chunk_id` 集合与厂商原文快照完全一致；条目为改写事实（`is_original_excerpt = false`），以`【标题】`开头；每个数字都能在同块原文里逐字找到；公开仓库不放逐字原文长段（`_kb-raw/` 只留本地）。

**F/G/H/I（编译型，257 条）**——无单一原文，来源是教材、标准与综述的共识；`source` 为可核对的真实文献；正文 ≥300 字、至少 3 个字段行；`disclaimer` 注明"非原文摘录"；不写具体产品型号与厂商指标。

### 7.3 缺口

三处原文层缺口：A03（峰值定位综述，1 条）、C01（ZYGO CSI 白皮书，5 条）、E01（JJF 1990-2022，6 条）。合计 16 条非 present：11 条 `missing_source`、5 条 `substitute`（同类公开资料，明确标注非原出处）。`assist` 将其单列为 `library_gaps`；`verify` 把引用非 present 条目判为错误。两条主题按要求不覆盖：光刻工艺与空间光学。检索为空即无依据，不编造。

---

## 8. 目录结构

```
lib/index.js                工具注册（5 个）
lib/assist.js               受理、取证、路由、计划、验收
lib/capabilities.js         Skill / MCP / 本地素材只读扫描
lib/verify.js               交付自检 + 采信闸门
lib/kb-engine.js            BM25 检索引擎
lib/kb-data.js              数据加载
data/kb/                    40 个板块文件（人可读、git diff 可审）
data/kb-data.json           合并产物，运行时读它
data/kb-meta.json           版本、sha256、板块、缺口词表（生成物）
data/assist-playbooks.json  16 张主题卡
data/concept-cards.json     308 张原子概念卡
data/cross-dimensions.json  6 个通用兜底维度
data/formula-cards.json     19 张公式卡（不执行计算）
skills/opticforge-task/     DSH 的 KB-first 工作流 Skill
eval/                       KB-first + 交叉契约评测；真实轨迹评分
docs/ARCHITECTURE.zh.md     架构与扩展点
```

---

## 9. 安装

**从插件市场**（已投稿）：在 DSH 插件市场搜 `OpticForge`。

**本机 link 安装**（开发用）：

```bash
node scripts/install-local.mjs            # 写 profile 依赖 + bundles + 目录链接
node scripts/install-local.mjs --dry-run  # 只预览，不改文件
node scripts/install-local.mjs --uninstall
```

重启 DSH 后生效；之后改仓库代码或数据，重启即加载最新版本。安装器会把 `skills/opticforge-task` 链接到 `~/.dsh/skills/opticforge-task`；目标已是普通目录则不覆盖，卸载只删除链接。

---

## 10. 开发

```bash
node test/run.mjs                              # 集成测试
node test/assist-contract.test.mjs             # assist 契约（24 例）
node test/entry-contract.test.mjs              # 入口契约（5 例）
node scripts/verify-all.mjs                    # 发布门禁（57 项）
node eval/run-kb-first.mjs                     # 13 类任务 + 交叉契约
node scripts/build-kb.mjs --all --version 3.1.0
node scripts/build-kb.mjs --check
node eval/run-kb-first.mjs --trace <trace.jsonl>   # 真实工具轨迹评分
```

改知识库：编辑 `data/kb/<板块>.json` → `--doc` 自检 → `--all` 重建 → 跑测试；重建会同步刷新概念卡与 `kb_version`。
改主题卡：编辑 `data/assist-playbooks.json`，无需改代码。

CI（`.github/workflows/test.yml`）在 Ubuntu + Windows、Node 20 + 22 上跑同一套检查。

---

## 11. 边界

- 只覆盖 §7 列出的 40 个板块；光刻工艺、空间光学明确不覆盖
- 编译型条目是工程整理，对外引用前按 `source` 回原始文献核对
- 厂商指标只出现在有原文快照的 A–E
- 缺口条目只说明"这里没有依据"，不能当事实引用
- 插件不联网、不执行动作；外部检索与 Skill/MCP 调用由执行层完成
- `verify` 只做文本级检查；docx/pdf 需先导出为文本
- `alignment.verdict` 只报覆盖度，不等于可联网；联网与否取决于 `web_gate`

## 许可

MIT。第三方资料版权归各原作者，本仓库只收录改写后的工程事实与来源标注。
