---
name: opticforge-task
description: "OpticForge 光电任务端到端工作流。用于光学设计、光机装调、光学检测、干涉/衍射/偏振、激光与探测器、薄膜、光谱仪、共焦传感、高光谱推扫/快照、DOE/超透镜、光机公差、杂光排查、标准/白皮书调研等具体任务。任何光电问题先调用 opticforge_assist 并完成知识库对齐，再决定是否联网；不要一开始就用 general_search/web_search。"
---

# OpticForge 任务工作流

## 总原则

先对齐知识库，再执行；先取证，再计算；交付前必须自检。插件只提供规划与检查，不联网、不替你执行动作。

## 1. 受理

第一个工具调用 `opticforge_assist`，传入 `problem`；有本地素材时传 `workspace`，需要报告/表格/代码时传 `deliverable` 与 `constraints`。能确定当前可用 Skill/MCP 时传 `known_capabilities` / `known_mcp`。

不要先调用 `general_search`、`web_search`、`web_fetch`。即使问题要求最新型号、价格或标准版本，也先用 KB 建立基线。

若 `opticforge_assist` 不可用，先调用 `opticforge_search`；两者都不可用，明确说插件未加载，不要假装完成 KB 对齐。

## 2. 知识库对齐

按返回的 `alignment.kb_queries` 调用 `opticforge_search`，对高价值条目调用 `opticforge_get`。记录：

- `alignment.verdict`：`covered` / `partial` / `gap`
- `coverage_matrix`：每个检索面的依据与缺口
- `gaps`、`library_gaps`
- 证据的 `chunk_id`、`status`、来源、页码/章节

只引用 `status=present` 的条目。A03、C01、E01 的原始条文缺口必须单列，不得拿 substitute 冒充原文。

## 3. 联网门禁

读取 `web_gate`，不要自行放宽条件。

- `web_gate.allowed=false`：不要调用 `general_search` / `web_search` / `web_fetch`
- 只有满足 `allowed_if` 中的条件才允许联网：KB 未覆盖、标准版本核对、厂商规格、价格或时效性信息
- 外部检索只执行 `search_pack.external_queries` 中满足 `when` 的查询
- 外部事实记录 URL、访问日期、厂商/型号/标准号与测试条件

KB 已覆盖的物理原理、公式和判据，不要重复用网页替代。

## 4. 执行

按 `plan.steps` 的 `blocked_by` 和关键路径推进。先完成澄清与 KB 取证，再并行做计算、设计、检测或文档步骤。

计算使用 `calc_specs` 中的公式卡，不调用任何已删除的计算器：

- 写 `formula_id`、公式、变量、单位与假设
- 用 `run_code`、PowerShell/Python 或表格 Skill 计算
- 记录输入、输出、单位闭合和 `sanity_range`
- 关键数字给出复算路径，超出合理范围先检查单位与假设

## 5. 交付物

报告/方案中固定包含：

1. `KB 对齐`：覆盖判定、依据、缺口、为何需要或不需要联网
2. `计算轨迹`：`formula_id`、输入、公式、结果、单位、假设、复算说明
3. `假设与边界`
4. `缺口与风险`
5. `复现步骤`
6. `来源`

docx/pdf 交付前先用 `word` / `pdf` Skill 导出 `.md` 或 `.txt`，不要把二进制文件直接交给 `opticforge_verify`。

## 6. 自检

交付前调用 `opticforge_verify`，传 `problem` 与导出后的 `text`/`path`。修正所有 error，再处理 warning。

`verify` 只检查文本结构与证据，不判断技术结论一定正确；关键技术结论仍需人工或独立 agent 复核。

## 禁止

- 不要绕过 KB 直接联网
- 不要把外部检索当作 KB 已覆盖原理的替代品
- 不要引用不存在或非 present 的 chunk_id
- 不要把公式卡当作已完成的计算
- 不要在 `web_gate` 未打开时自行执行 `external_queries`
- 不要跳过 `opticforge_verify` 直接交付
