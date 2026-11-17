---
name: opticforge-task
description: "OpticForge 光电任务端到端工作流。用于光学设计、光机装调、光学检测、干涉/衍射/偏振、激光与探测器、薄膜、光谱仪、共焦传感、高光谱推扫/快照、红外、光纤传感、波导 AR、DOE/超透镜、光机公差、杂光排查、标准/白皮书调研等具体任务。任何光电问题先调用 opticforge_assist 并完成知识库对齐，按激活的多张主题卡与必答维度取证、逐对核对交叉关系，再决定是否联网；不要一开始就用 general_search/web_search。"
---

# OpticForge 任务工作流

## 总原则

先对齐知识库，再执行；先取证，再计算；交付前必须自检。插件只提供规划与检查，不联网、不替你执行动作。

## 1. 受理

第一个工具调用 `opticforge_assist`，传入 `problem`；有本地素材时传 `workspace`，需要报告/表格/代码时传 `deliverable` 与 `constraints`。能确定当前可用 Skill/MCP 时传 `known_capabilities` / `known_mcp`。

不要先调用 `general_search`、`web_search`、`web_fetch`。即使问题要求最新型号、价格或标准版本，也先用 KB 建立基线。

若 `opticforge_assist` 不可用，先调用 `opticforge_search`；两者都不可用，明确说插件未加载，不要假装完成 KB 对齐。

## 2. 知识库对齐

按返回的 `alignment.kb_queries` 调用 `opticforge_search`，对高价值条目调用 `opticforge_get`。先读 `brief.active_playbooks` 确认激活了哪几张主题卡，再逐维度取证。记录：

- `alignment.verdict`：`covered` / `partial` / `gap`
- `dimensions[]`：每个必答维度的 status、evidence、hit_chunk_ids、concept_cards、gap_reason、`source_matrix`
- `relations[]` 与 `cross_checks[]`：哪些维度相互约束、核对要点
- `coverage_matrix`：维度×来源，KB 覆盖还是必须外部补证
- `gaps`、`library_gaps`
- 证据的 `chunk_id`、`status`、来源、页码/章节

只引用 `status=present` 的条目。A03、C01、E01 的原始条文缺口必须单列，不得拿 substitute 冒充原文。某个维度 `source_matrix.web.status=required` 时，该面必须先标 gap，再走外部补证，不得用相邻面结论替代。

## 3. 联网门禁

读取 `web_gate`，不要自行放宽条件。

- `web_gate.allowed=false`：不要调用 `general_search` / `web_search` / `web_fetch`
- 只有满足 `allowed_if` 中的条件才允许联网：KB 未覆盖、标准版本核对、厂商规格、价格或时效性信息
- 外部检索只执行 `search_pack` 中 `scope="external"` 且 `gated=true` 的条目；判断依据是 `trigger/gated/gate_id/blocked_by`。顶层 `external_queries` 只是已放行查询的汇总
- 外部事实记录 URL、访问日期、厂商/型号/标准号与测试条件

KB 已覆盖的物理原理、公式和判据，不要重复用网页替代。

## 4. 执行

按 `plan.steps` 的 `blocked_by` 和关键路径推进。先完成澄清与 KB 取证，再并行做计算、设计、检测或文档步骤。专业步按 `dimension_id` 归位；`coordinates_with` 的步骤必须结对看，不要拆开并行。

计算使用 `calc_specs` 中的公式卡，不调用任何已删除的计算器：

- 写 `formula_id`、公式、变量、单位与假设
- 用 `run_code`、PowerShell/Python 或表格 Skill 计算
- 记录输入、输出、单位闭合和 `sanity_range`
- 关键数字给出复算路径，超出合理范围先检查单位与假设

## 5. 交叉核对

单独跑 `plan` 里的「交叉复核」步，不要把它并进结论段。对每条 `relations`：

- 两端维度的数字放进同一张表比较，检查量纲、符号与取值区间
- 明确写出约束方向：谁决定谁、哪里取舍、冲突时以谁为准
- 把核对结论回写 `cross_checks`；发现互斥就回到对应维度补证或改方案，不要两边各说各话

缺面、单源、来源等级不明时，先补证；`adoption.pass=false` 的结论不得交付。

## 6. 交付物

报告/方案中固定包含：

1. `KB 对齐`：覆盖判定、逐维度依据、缺口、为何需要或不需要联网
2. `维度与交叉`：每个必答维度的结论与依据；每条关系的取舍/耦合说明
3. `计算轨迹`：`formula_id`、输入、公式、结果、单位、假设、复算说明
4. `外部来源`：URL、访问日期、来源等级（一手/二手）、与 KB 是否一致
5. `假设与边界`
6. `缺口与风险`
7. `复现步骤`
8. `来源`

docx/pdf 交付前先用 `word` / `pdf` Skill 导出 `.md` 或 `.txt`，不要把二进制文件直接交给 `opticforge_verify`。

## 7. 自检

交付前调用 `opticforge_verify`，传 `problem`、导出后的 `text`/`path`，并把 assist 的 `dimensions` 与 `relations` 原样传入；需要固定日期时传 `now`。修正所有 error，再处理 warning，重点看：

- `dimensions.missing` / `unevidenced` / `coupling_missing` / `coupling_unstated` 是否为 0
- `adoption.pass` 是否为 true（来源分级、多源交叉、KB 冲突、时效）
- `checklist.dimensions_complete` / `coupling_consistent` / `adoption_gate`

`verify` 只检查文本结构与证据，不判断技术结论一定正确；关键技术结论仍需人工或独立 agent 复核。

## 禁止

- 不要绕过 KB 直接联网
- 不要把外部检索当作 KB 已覆盖原理的替代品
- 不要引用不存在或非 present 的 chunk_id
- 不要用相邻维度的结论替代缺面，缺面必须补证或标 gap
- 不要把单源网页数字、二手博客或过期报价当作定论
- 不要把公式卡当作已完成的计算
- 不要在 `web_gate` 未打开时自行执行 `external_queries`
- 不要跳过 `opticforge_verify` 直接交付
