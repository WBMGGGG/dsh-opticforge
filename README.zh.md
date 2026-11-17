# OpticForge

> 光电任务不是“查一段资料”，而是“必须回答哪些维度、每一维有没有依据、下一步做什么、交付前怎么验收”。
>
> OpticForge 把这件事做成一个可执行的作战包。它不替你算、不替你联网、不替你写文件；它负责让执行层知道**该查什么、按什么维度取证、什么情况才允许联网、交付前必须过哪几道闸门**。
>
> 用户看到的回答固定按“一句话原理 → 关键公式/判据 → 具体思路 → 操作步骤”展开；不报知识库层级或条目编号，来源只说文献/标准/手册名称。图片只辅助理解，不替代依据。

面向 DeepSeek Harness（DSH）。纯 Node.js，零运行时依赖。当前版本 **3.1.1**。

> English: [README.md](README.md)

---

## 0. 先看结论：只有一套 v3 架构

这是最容易误读的一点，先放在最前面。

**OpticForge 的知识库只有一套架构，就是 `OpticForge知识库-v3纯净版` 定义的 v3 架构。** 运行时知识库不是另一套架构，而是这套架构下**已经填充了内容的那部分**。

| 你看到的名字 | 它到底是什么 | 它不是什么 |
|---|---|---|
| v3 纯净版：8 域 / 54 族 / 约 470 叶子 | **L1 覆盖基准**，定义知识库的骨架、族与叶子主题、每个主题应回答的维度 | 不是一套“只存在于文档里”的旧库 |
| 40 个源板块 / 324 条 / 308 present（A–I） | **L2 已填充子集**：v3 架构下当前有来源、可引用的资料分区 | 不是第二套知识库，也不是 40 个 v3 族 |
| 308 张概念卡 | **L3 原子层**：每条 present 一块一卡，映射到 v3 的 8 域与族 | 不是另建索引，也不是 470 条全文的替代品 |

一句话：**v3 是地图，40 个源板块是地图上已经建好的街区。街区编号 A–I 是施工资料编号，不是新的城市分区。**

---

## 1. 它解决什么问题

光电工程真正卡人的，通常不是公式，而是三件事：

| 卡点 | OpticForge 的做法 |
|---|---|
| 依据散落在手册、标准、论文里，查不全也不敢说“没有” | **证据层**：按必答维度逐面取证；每条命中带来源、摘录；内部记录 `chunk_id` 只供自查，不写进用户正文；没有依据就明确标 gap，不编造 |
| 不知道该先查什么、算什么、画什么、写什么 | **路由层**：多剧本激活、维度融合、本机 Skill/MCP/素材盘点，生成带 `dimension_id` 与 `coordinates_with` 的分阶段计划 |
| 交付看着对，一核引用、单位、假设、缺口就露馅 | **验收层**：引用、数量、结构、公式轨迹、维度覆盖、采信闸门、五段呈现逐项检查 |

三个“不”是它和普通问答式知识库的区别：

- **不先联网**：先建立 KB 基线，只有 KB 缺口、标准版本、厂商参数、价格时效四类条件才放行联网。
- **不藏缺口**：缺面就标 `gap`，原文缺口单列 `library_gaps`，二手源标 `untrusted`，不拿相邻维度顶上。
- **不把内部字段倒给用户**：3.1.1 起固定五段呈现，结论≤3 句、严重性一张表、一个分流判据、路线≤3 条、验证≤3 条+待补≤4 个。

---

## 2. 架构：一套 v3，两种编号

### 2.1 三层关系

```
L1  v3 覆盖基准        8 域 / 54 族 / 约 470 叶子 / 16 主题卡 / 34 公式卡（目标）
         │  定义骨架、族、叶子主题、每主题应回答的维度
         ▼
L2  运行时证据层       40 个源板块（A–I）/ 324 条 / 308 present
         │  只保留有来源、可引用的内容；按 BOARD_MAP 落到 v3 域/族
         ▼
L3  概念卡             308 张，一块一卡，逐字抽取
            每张带 domain（8 域之一）+ v3_boards（映射到的 v3 族）+ applies_to
```

**L1 是覆盖基准，不是可检索条目。** 它回答“应该覆盖什么”；L2 回答“现在真正能引用什么”；L3 把 L2 压成不重复的原子，供维度取证和主题卡复用。

### 2.2 40 与 54 怎么对应

40 个源板块是**资料源分区**，按原文/教材来源编号：A–E 是厂商原文改写，F 是基础理论，G 是工程系统，H 是前沿交叉，I 是场景深化。它们落到 v3 的 8 域 / 54 族，是**多对多**关系：一个源板块可以落 2–3 个族，一个族也可以由多个源板块供料。

`scripts/build-concept-cards.mjs` 里的 `BOARD_MAP` 是这条映射的唯一事实源，只落到族级，不硬塞到叶子。示例：

| 源板块 | 落到 v3 族 | 说明 |
|---|---|---|
| `A01` 共焦传感器 | `IM04` / `DT02` / `TF02` | 一套共焦内容同时供成像、检测、理论三族 |
| `C01` 公差分析 | `DT02` / `IM05` / `TF02` | 计量、成像链路、理论三族共用 |
| `I05` 高光谱推扫 | `IM03` / `DS03` / `TF02` | 成像、设计、理论三族共用 |
| `F01` 几何光学 | `TF01` | 基础理论单族落点 |
| `G01` 光机装调 | `DS04` | 设计与仿真族 |

所以：

- **40 不是 54 的替代，也不是另一套分区。** 40 是“当前有资料可填的源分区”，54 是“v3 定义的完整族集合”。
- 一个源板块跨多族，正是交叉覆盖的来源；不是架构冲突。
- 308 张概念卡的域分布（IM53 / QE33 / MT65 / DT26 / TF67 / EL3 / DS53 / AL8）是**已填充内容的分布**，不是 v3 的目标分布。

### 2.3 为什么会有“架构完全不一样”的错觉

因为项目里同时出现了三套编号，它们各自回答不同问题：

| 编号 | 例子 | 回答的问题 | 不是 |
|---|---|---|---|
| v3 域/族编号 | `IM04`、`DT02`、`TF02` | 这份内容在 v3 架构的哪个域、哪个族 | 不是 chunk_id，也不是源板块编号 |
| 源板块编号 | `A01`、`C01`、`I05` | 这份内容来自哪类资料分区 | 不是 v3 族，也不要求与族一一对应 |
| 运行时块编号 | `A01-01`、`I01-07` | 具体可引用的一条事实 | 不是架构层级 |

把“源板块编号”误当成“架构分区”，就会觉得 40 和 54 对不上；把“v3 覆盖基准”误当成“另一套运行时库”，就会觉得有两套知识库。实际是**同一套 v3 架构的 L1 基准 + L2 已填充子集 + L3 原子卡**。

### 2.4 当前覆盖与缺口

当前 `BOARD_MAP` 覆盖 **39/54 个 v3 族**：

| 域 | v3 族数 | 已映射族 | 概念卡 |
|---|---:|---:|---:|
| TF 基础理论 | 9 | 7 | 67 |
| MT 材料与器件 | 7 | 7 | 65 |
| DS 设计与仿真 | 8 | 6 | 53 |
| IM 成像与光谱 | 7 | 5 | 53 |
| AL 算法与信号 | 7 | 2 | 8 |
| EL 电子与电路 | 6 | 4 | 3 |
| DT 检测与计量 | 4 | 4 | 26 |
| QE 质量与可靠性 | 6 | 4 | 33 |
| **合计** | **54** | **39** | **308** |

剩余 15 族（TF04/TF08、DS05/DS06、IM01/IM06、AL01/02/03/05/07、EL04/06、QE03/06）还没有运行时条目，按缺口处理，不用通用常识补。3.1.1 没有把 324 条重写成 470 条——那是内容迁移，不是机制版本；但骨架、维度、主题卡和映射已经按 v3 建好。

### 2.5 叠在运行时 KB 上的三个只读层

| 文件 | 内容 | 作用 |
|---|---|---|
| `data/assist-playbooks.json` | 16 张主题卡、98 条维度声明、`relations` + `cross_check`、每步带 `dimension_id` | 跨域覆盖在这里显式声明，不靠检索碰运气 |
| `data/concept-cards.json` | 308 张原子卡，一条 present 块一卡，逐字抽取（不改写、不加数值）；8 域分布 IM53/QE33/MT65/DT26/TF67/EL3/DS53/AL8，每张带 `applies_to` | 把 v3 叶子压缩成可复用原子，不重复建库 |
| `data/cross-dimensions.json` | 6 个通用维度：原理 / 设计 / 计算 / 实现 / 验证 / 风险 | 没有主题卡命中时兜底，保证交叉仍是默认行为 |

---

## 3. 一次任务怎么跑

```
问题
 │
 ├─ opticforge_assist ── 受理与路由（不联网）
 │    ├─ brief              目标 / 交付物 / 约束 / 待澄清 / active_playbooks
 │    ├─ alignment          KB 查询 / matched / unmatched / verdict（按维度）
 │    ├─ dimensions         每维 evidence / hit_chunk_ids / concept_cards / gap_reason / source_matrix
 │    ├─ relations          交叉关系 + cross_checks
 │    ├─ web_gate           默认关闭；KB gap / 版本 / 厂商参数 / 价格时效才打开
 │    ├─ plan               分阶段步骤；dimension_id、blocked_by、coordinates_with
 │    ├─ report_outline     固定五段呈现骨架 + 来源名称 + 关键数值提示
 │    ├─ search_pack        KB 查询 + 按缺口维度分组的外部查询
 │    └─ acceptance         验收清单 + 风险 + 可交接 Markdown
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
      ├─ 计算：formula_id、输入、单位、输出、复算路径
      └─ 呈现：五段齐、表格≤3、内部字段名不入正文、待补只在第⑤段
```

**边界**：`assist` 与 `verify` 是辅助、只读的。它们不联网、不写文件、不执行命令。这些由执行层做。

### 3.1 交付结构：固定五段

`assist.report_outline` 给出五段骨架，用户看到的正文按这个顺序写，不把 15+ 个内部字段原样倒出来：

1. **结论**：≤3 句，先给判断，再给决定性分叉和立即行动。
2. **严重性对号入座**：一张表，列只放工况、判据/量级、相对裕度、处理。
3. **分流判断**：只给一个实验或一个判据，说明它把哪两条路线分开。
4. **路线建议**：≤3 条，每条一句话适用条件，最后给明确推荐。
5. **验证与待补**：验证≤3 条；待补参数≤4 个，只在本段出现一次。

硬规则：全文表格≤3；正文不写 `alignment`、`web_gate`、`source_matrix`、`coverage_matrix`、`blocked_by`、`active_playbooks` 等内部字段名，也不出现 `chunk_id`、`A01-01`、`IM04` 这类知识库层级/条目编号；来源只写文献、标准、厂商手册或 URL 名称。讲解顺序固定：一句话原理 → 关键公式/判据 → 具体思路 → 操作步骤。图片只作辅助理解，不替代公式和依据。口径分歧给默认值，不把选择题丢给用户。

### 3.2 联网门禁

先调 `assist`，执行 `alignment.kb_queries`，记录 matched/unmatched 与 `verdict`，再核对 `web_gate`。`alignment.verdict` **只描述覆盖度**，从不放行联网。

`web_gate` 默认拒绝，需命中四个条件之一：`kb_gap`、`standard_version`、`vendor_params`、`price_timeliness`。即便命中，某条联网查询仍须其条件 `granted` 且该步 `blocked_by` 解除后才执行；web 步骤不与取证并行。随包 `skills/opticforge-task/SKILL.md` 给 DSH 固定同一流程。

**维度缺口显式表达**：某维度 KB 零命中时，`source_matrix.web.status = "required"`，并生成中英双语 `缺口·X` 外部查询组；交付物必须标 `covered_by_web` 与来源等级。这补上了“检索为空”与“插件悄悄编造”之间的空档。

### 3.3 采信闸门

放行闸门管“能不能联网”；采信闸门管“联网拿回来的知识可不可信、算不算覆盖”。带日期的 URL 不等于正确。

| 判据 | 规则 |
|---|---|
| 来源分级 | 一手源（标准原文、厂商 datasheet、官方手册、论文）可采信；二手源（博客、论坛、聚合站、自媒体）标 `untrusted`——只作线索，不作依据 |
| 多源交叉 | 关键数值（带宽、效率、温度、精度）需 ≥2 个独立一手源，或 1 个一手源并明确标“单源待核” |
| KB 冲突 | 联网事实与 KB present 条目冲突时标 `conflict_with_kb`；优先 KB，或解释差异（测试条件 / 版本 / 型号） |
| 时效 | 价格、型号、标准版本、交期类必须带访问日期；超阈值（如价格 30 天）标 `stale` |

只有采信通过的联网证据才会把维度从 `gap` 翻转为 `covered_by_web` 并计入覆盖；二手源/冲突源标 `unverified`，不计入。`verify` 输出 `adoption`（四判据 + pass），严格模式下失败判为错误。

---

## 4. 五个工具

| 工具 | 层 | 用途 |
|---|---|---|
| `opticforge_assist` | 辅助 | **主入口**。问题 → 简报 + 证据 + 路由 + 计划 + 检索包 + 验收 + 五段骨架 + handoff |
| `opticforge_verify` | 辅助 | 交付自检。传 `text` 或 `.md/.txt/.json/.csv` 路径；0–100 分与问题清单。可选 `dimensions`、`relations`、`now`、`presentation` |
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
- `report_outline` / `report_style`——五段呈现骨架与风格硬规则
- `search_pack`——KB 查询 + 带 `trigger` / `gated` / `gate_id` / `blocked_by` / `dimension_id` 的外部查询组
- `handoff`、`acceptance`、`risks`

### 4.2 计算与自检

`calc_specs` 从 19 张公式卡中选卡（公式、变量、单位、假设、合理范围、算例、KB 来源 ID）。插件不计算；执行层计算并记录 `formula_id`、输入、输出、单位与复算路径。

docx/pdf 先用 word/pdf Skill 导出 `.md` / `.txt`，再交给 `verify`。报告/方案再传 `presentation: true`，强制检查五段呈现。

---

## 5. 运行时知识库

### 5.1 内容

40 板块 / 324 条 / 308 `present`，按来源类型（A–E）或工程主题（F–I）组织：

| 系列 | 板块 | 内容 | 条目 |
|---|---|---|---|
| A–E | 9 | 厂商原文改写：共焦传感器、光谱仪搭建、公差分析、DOE、白光干涉、RCWA 光栅、光电二极管、计量规范 | 67（51 present） |
| F | 10 | 基础理论：几何光学、干涉衍射、偏振、激光、辐射度与色度、薄膜、探测与噪声、光谱学、干涉计量、材料工艺 | 83 |
| G | 7 | 工程系统：光机装调、公差与不确定度、热光学、光谱/辐射定标、检测与图像处理、COMSOL、SolidWorks | 53 |
| H | 8 | 前沿交叉：超表面与 DOE、光波导与光子集成、量子光学、高光谱、激光三角/共焦/雷达、失效现场、前沿专题、半导体光源 | 61 |
| I | 6 | 场景深化：像差判读、物理光学与传递函数、光学检测、光学设计、高光谱推扫/快照、Czerny–Turner 与 Offner 分光系统 | 60 |

### 5.2 准确性规则

由 `scripts/build-kb.mjs` 强制：

**A–E（原文型，67 条）**——`chunk_id` 集合与厂商原文快照完全一致；条目为改写事实（`is_original_excerpt = false`），以`【标题】`开头；每个数字都能在同块原文里逐字找到；公开仓库不放逐字原文长段（`_kb-raw/` 只留本地）。

**F/G/H/I（编译型，257 条）**——无单一原文，来源是教材、标准与综述的共识；`source` 为可核对的真实文献；正文 ≥300 字、至少 3 个字段行；`disclaimer` 注明“非原文摘录”；不写具体产品型号与厂商指标。

### 5.3 缺口与口径

三处原文层缺口：A03（峰值定位综述，1 条）、C01（ZYGO CSI 白皮书，5 条）、E01（JJF 1990-2022，6 条）。合计 16 条非 present：11 条 `missing_source`、5 条 `substitute`（同类公开资料，明确标注非原出处）。`assist` 将其单列为 `library_gaps`；`verify` 把引用非 present 条目判为错误。两条主题按要求不覆盖：光刻工艺与空间光学。检索为空即无依据，不编造。

焦深口径：`I01-07` 的 `±λ/NA²` 与 `G02-07` 的 `±λ/(2NA²)` 相差 2 倍，原因是半焦深/全焦深定义不同；本库默认采用 `G02-07` 的 `±λ/(2NA²)`（折合全深 `4λF²`，保守）。差异只影响装调余量取值，不改变路线判断。

---

## 6. 安装与市场

### 6.1 安装

当前不发布 npm 包，推荐从 GitHub 仓库安装：

```bash
git clone https://github.com/WBMGGGG/dsh-opticforge.git
cd dsh-opticforge
node scripts/install-local.mjs            # 写 profile 依赖 + bundles + 目录链接
node scripts/install-local.mjs --dry-run  # 只预览，不改文件
node scripts/install-local.mjs --uninstall
```

重启 DSH 后生效；之后改仓库代码或数据，重启即加载最新版本。安装器会把 `skills/opticforge-task` 链接到 `~/.dsh/skills/opticforge-task`；目标已是普通目录则不覆盖，卸载只删除链接。

### 6.2 为什么 dsh-market 里搜不到

dsh-market 只读 `https://awesome-dsh-plugin.com/plugins.json`；OpticForge 的 awesome 条目还在 PR **#15752**，状态 OPEN，尚未合并。合并前该 JSON 里没有这个条目，所以市场搜不到。PR 的两个检查（`check`、`Submission gate`）已通过，`mergeable=MERGEABLE`；合并后通常 1 天内自动收录。市场收录只看 awesome 条目，与是否发布 npm 无关。

---

## 7. 开发与测试

```bash
node test/run.mjs                              # 集成测试（30 例）
node test/assist-contract.test.mjs             # assist/verify 契约（26 例）
node test/entry-contract.test.mjs              # 入口契约（5 例）
node scripts/verify-all.mjs                    # 发布门禁（61 项）
node eval/run-kb-first.mjs                     # 13 类任务 + 交叉契约 + 结构合规率
node scripts/build-kb.mjs --all --version 3.1.1
node scripts/build-kb.mjs --check
node eval/run-kb-first.mjs --trace <trace.jsonl>   # 真实工具轨迹评分
```

改知识库：编辑 `data/kb/<板块>.json` → `--doc` 自检 → `--all` 重建 → 跑测试；重建会同步刷新概念卡与 `kb_version`。

改主题卡：编辑 `data/assist-playbooks.json`，无需改代码。

改映射：编辑 `scripts/build-concept-cards.mjs` 的 `BOARD_MAP`，再重建概念卡；映射只落到 v3 族级，不硬塞叶子。

CI（`.github/workflows/test.yml`）在 Ubuntu + Windows、Node 20 + 22 上跑同一套检查。

---

## 8. 边界

- 只覆盖 §5 列出的 40 个板块；光刻工艺、空间光学明确不覆盖
- 编译型条目是工程整理，对外引用前按 `source` 回原始文献核对
- 厂商指标只出现在有原文快照的 A–E
- 缺口条目只说明“这里没有依据”，不能当事实引用
- 插件不联网、不执行动作；外部检索与 Skill/MCP 调用由执行层完成
- `verify` 只做文本级检查；docx/pdf 需先导出为文本
- `alignment.verdict` 只报覆盖度，不等于可联网；联网与否取决于 `web_gate`
- 40 个源板块不是 v3 的 54 族；两者是多对多映射，别按编号强行一一对应

## 许可

MIT。第三方资料版权归各原作者，本仓库只收录改写后的工程事实与来源标注。
