# 工具用法

五个工具，分两层：

| 层 | 工具 | 用途 |
|---|---|---|
| 辅助层 | `opticforge_assist` | 一个问题 → 简报/证据/能力路由/计划/检索包/验收/handoff |
| 辅助层 | `opticforge_verify` | 交付前自检引用、数量、结构、措辞 |
| 证据层 | `opticforge_docs` | 板块与条目目录 |
| 证据层 | `opticforge_search` | BM25 检索 |
| 证据层 | `opticforge_get` | 按 chunk_id 取全文 |

统一信封：

```json
{ "ok": true, "kb_version": "3.1.1", "action": "assist", "...": "各工具字段" }
```

---

## 先用哪个

```
接一个具体任务/问题      → opticforge_assist
要核对交付物               → opticforge_verify
不确定库里有什么           → opticforge_docs
知道要查什么               → opticforge_search
拿到 chunk_id 想看全文     → opticforge_get
```

典型顺序：**assist → 执行 alignment.kb_queries → 记录 matched/unmatched 与 verdict → 检查 web_gate → 按 blocked_by 执行 plan（专业步按 dimension_id，交叉步逐对核对）→ verify（传 dimensions/relations）→ 交付**。不要让 general_search/web_search 成为第一个工具；只有 KB 缺口、标准版本、厂商规格、价格/时效等条件满足才联网。随包 `opticforge-task` Skill 固定同一流程。

---

## opticforge_assist

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `problem` | string | 是 | 用户原始问题，越具体越好 |
| `workspace` | string | 否 | 本地工作目录，用于素材盘点 |
| `deliverable` | string | 否 | 报告/表格/PPT/代码/SOP；省略则推断 |
| `constraints` | string | 否 | 硬约束（波段、精度、预算、工期） |
| `depth` | string | 否 | `quick` / `standard` / `deep`，默认 standard |
| `locale` | string | 否 | `zh` / `en` |
| `known_capabilities` | array | 否 | 当前会话实际可用的 Skill 名 |
| `known_mcp` | array | 否 | 当前会话实际可用的 MCP 服务器名 |

**返回**

| 字段 | 说明 |
|---|---|
| `brief` | 目标、领域、意图、交付物、约束、待澄清（≤3 问）、`active_playbooks`（激活的主题卡与得分） |
| `alignment` | KB 查询、matched/unmatched（带 dimension_id）、coverage_matrix、source_summary、verdict |
| `web_gate` | 默认关闭；只有 KB 缺口、标准版本、厂商规格、价格/时效等条件才打开 |
| `dimensions[]` | 必答维度：status、evidence、hit_chunk_ids、queries、concept_cards、gap_reason、source_matrix（维度×来源） |
| `relations[]` | 交叉关系：from/to/type/note，只保留两端存在的维度 |
| `cross_checks[]` | 交叉核对清单（对应「交叉复核」步） |
| `report_outline[]` | 五段呈现骨架：结论/严重性/分流/路线/验证待补；带来源名称、关键数值提示与上限 |
| `report_style` | 呈现红线：表格≤3、讲解顺序（原理→公式→思路→步骤）、不暴露层级/条目编号、图片仅辅助 |
| `coverage` | 维度覆盖数与置信度 |
| `evidence[]` | chunk_id、doc_id、status、标题、来源、摘录、命中的检索面 |
| `gaps[]` | 主题未覆盖 / 声明不覆盖；缺口维度带 gap_reason 与外部查询组 |
| `library_gaps[]` | 原文缺口：A03、C01、E01 的缺失条数 |
| `capabilities` | 扫描到的 Skill、MCP 服务器、说明 |
| `local_assets` | workspace 文件清单（名称/类型/大小/相关度） |
| `plan.steps[]` | 每步 phase/goal/capability/actions/output/routing；专业步带 dimension_id，web 步骤带 blocked_by；relation 两端步骤互写 coordinates_with |
| `calc_specs[]` | 公式卡：公式、变量单位、假设、合理范围、算例、KB 来源；不执行计算 |
| `search_pack` | KB 查询与带 trigger/gated 条件的外部查询；缺口维度另带 `缺口·X` 中英双语组 |
| `acceptance[]` | 验收清单（含维度齐全、交叉核对、采信留痕） |
| `success_criteria[]` | 前 6 条验收标准 |
| `execution_contract` | 必须做什么、可调哪些 Skill/MCP/工具、何时停下 |
| `risks[]` | 知识缺口、原文缺口、维度耦合、采信、能力、输入、边界 |
| `handoff` | 可直接交给子 agent 的 Markdown |

**示例**

```json
{
  "problem": "设计 400–1000 nm 推扫高光谱，光谱分辨率 5 nm，GSD 0.5 m@1 km，幅宽 30 km",
  "deliverable": "方案报告",
  "workspace": "D:/AI/projects/hyperspectral",
  "known_capabilities": ["sheet", "word", "general_search"]
}
```

`plan` 会把任务拆成澄清 → 取证 → 盘点 → 指标 → 方案 → 预算 → 定标 → 结构/杂散光/效率等专业步 → 缺口补证（仅 gap 时）→ 交叉复核 → 交付 → 自检 → 收口。步骤里的 `routing.recommended_skills` 是候选，不是保证可用；执行层按当前会话实际工具替换。同一问题会激活最多 3 张主题卡，维度去重合并后上限 12 个。

**缺口处理**：`gaps` 与 `library_gaps` 只是说明，不可当事实。`opticforge_assist` 不会用通用常识补缺口。某个维度 `status=gap` 时，`source_matrix.web.status=required`，必须走 `缺口·X` 外部检索组，并在交付物里标 `covered_by_web` 与来源等级。

---

## opticforge_verify

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 二选一 | 待检查正文 |
| `path` | string | 二选一 | 文本文件路径（.md/.txt/.json/.csv 等） |
| `strict` | boolean | 否 | true 时“数量无来源”“缺维度/缺证据/采信不全”判 error |
| `problem` | string | 否 | 原始问题，仅作上下文 |
| `dimensions` | array | 否 | assist 返回的 `dimensions`（含 id/label/status），或字符串数组；用于维度齐全/每面有据 |
| `relations` | array | 否 | assist 返回的 `relations`（from/to/type/note）；用于耦合一致检查 |
| `now` | string | 否 | 当前日期 `YYYY-MM-DD`，用于外部来源时效判定；缺省用系统时间 |
| `presentation` | boolean | 否 | 强制检查 L4 五段呈现；文本已带 3 个以上五段标题时自动启用 |

**检查项**

| 项 | error / warning |
|---|---|
| 引用不存在 | error |
| 引用非 present | error |
| 数量断言无引用/无计算说明 | warning（strict=error） |
| 缺假设 | warning |
| 缺缺口声明 | warning |
| 缺复现 | warning |
| 缺 KB 对齐段 / verdict | warning（strict=error） |
| 外部 URL 缺访问日期或型号/标准号 | warning（strict=error） |
| 有数值但缺 formula_id / 计算轨迹 | warning（strict=error） |
| 引用了不存在的 formula_id | error |
| 维度缺失 / 维度附近无据 | warning（strict=error） |
| 关系两端缺失 / 未写约束 | warning（strict=error） |
| 外部来源未标分级 / 二手源 / 单源数值 / 冲突未说明 / 超 30 天时效 | warning（strict=error） |
| 绝对化/营销词 | warning |

**返回**：`pass`、`score`（0–100）、`citations`、`external_citations`、`alignment`、`formula_cards`、`dimensions`（total/covered/missing/unevidenced/coupling_*）、`adoption`（source_tier/corroborated/conflict_with_kb/stale/pass）、`presentation`（applicable/pass/sections/missing_sections/table_count/layer_code_hits）、`issues[]`、`checklist`、`summary`。

**限制**：只解析文本，不解析 docx/pdf；超过 2 MB 拒绝。

---

## opticforge_docs

列板块和条目，不返回正文。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `doc_id` | string | 否 | 只看某个板块（`A01`/`F02`/`I06`…），省略列全部 40 个 |

返回每板块的 `doc_id`、`source`、`chunks`、`present`、`items[]`（`chunk_id` / `status` / `title`）。

---

## opticforge_search

BM25 检索，只返回 `status=present`。

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | 必填 | 中英文检索词 |
| `top_k` | number | 5 | 本页条数，1–20 |
| `offset` | number | 0 | 翻页偏移，0–100 |
| `max_per_doc` | number | 3 | 同板块上限，1–10 |
| `doc_filter` | string | — | 只检索某个板块 |

返回：`total_matched`、`returned`、`has_more`、`results[]`（`chunk_id`/`doc_id`/`status`/`score`/`matched_terms`/`chars`/`excerpt`/`source`/`page`）、`note`、`guidance`。

未命中：

```json
{ "ok": true, "total_hits": 0, "note": "知识库中未找到相关依据",
  "guidance": "该主题在知识库中没有覆盖，返回空是正确行为；不要用通用常识替代知识库依据。" }
```

光刻工艺、空间光学等主题明确不覆盖；其他主题检索为空，同样说明没有依据。

---

## opticforge_get

按 `chunk_id` 取完整条目，9 个字段全给。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `chunk_id` | string | 是 | 形如 `I06-05`，从 search/docs 取；大小写不敏感 |

`status≠present` 的块也会返回，但带 `note`：只是缺口说明，不能当依据引用。

---

## 三个常见组合

**端到端做一个方案**

```
assist(problem=..., workspace=..., known_capabilities=[...])
→ 执行 alignment.kb_queries，记录 coverage_matrix 与 verdict
→ web_gate 未打开则不联网；打开后才执行 `search_pack` 中 `scope=external` 且 `gated=true` 的查询
→ 按 plan 调 sheet 做指标表、word 写报告，必要时联网核标准/厂商资料
→ docx/pdf 先导出 .md/.txt
→ verify(problem=原始问题, path="报告.md")
→ present_files
```

**查一个具体判据**

```
search("共焦 量程 线性度") → get("A01-02")
```

**确认某主题到底有没有**

```
assist(problem="…") → 看 gaps / library_gaps → 没有就如实说明，不要硬答
```

---

## 计算在哪里做

插件不带计算器。`assist.calc_specs` 只从 `data/formula-cards.json` 返回公式卡，具体数值由执行层用 run_code、PowerShell/Python 或表格 Skill 计算。交付文本必须写 `formula_id`、输入、单位、输出、假设与复算路径，再用 `opticforge_verify` 检查。
