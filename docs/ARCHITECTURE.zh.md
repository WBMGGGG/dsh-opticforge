# OpticForge 架构（3.1.1）

## 一句话

把“查知识库”升级成“接一个具体问题，多剧本激活、按维度取证、交叉核对后产出可执行、可验收的交付路径”。

插件不替 agent 干活，而是把活拆清楚：这个问题属于哪几张主题卡、必须回答哪些维度、每个维度有哪些依据、维度之间怎么相互约束、哪些维度只能联网补、该调哪个 Skill/MCP、按什么顺序、每步产出什么、最后怎么验收。

---

## 三层与五个工具

```
┌─────────────────────────────────────────────────────────────┐
│ 辅助层                                                       │
│  opticforge_assist   受理 + 取证 + 能力路由 + 计划 + 检索包   │
│  opticforge_verify   交付自检（引用/数量/结构/措辞）          │
└──────────────────────────┬──────────────────────────────────┘
                           │ 计划与验收
┌──────────────────────────▼──────────────────────────────────┐
│ 执行层（agent / DSH 运行时）                                  │
│  Skill（opticforge-task/sheet/word/ppt/browser…）             │
│  MCP（桌面、浏览器、GitHub…）                                  │
│  本地工具（PowerShell/Python/文件读写）                        │
│  检索（general_search / web_search / web_fetch · 受 web_gate 门禁）│
└──────────────────────────┬──────────────────────────────────┘
                           │ 取证与引用
┌──────────────────────────▼──────────────────────────────────┐
│ 证据层                                                       │
│  opticforge_search   BM25，present-only，带来源与摘录          │
│  opticforge_get      单条全文，9 字段                          │
│  opticforge_docs     40 板块目录与标题                         │
└─────────────────────────────────────────────────────────────┘
```

---

## opticforge_assist 输入输出

### 输入

| 字段 | 必填 | 说明 |
|---|---|---|
| `problem` | 是 | 用户原始问题，自然语言 |
| `workspace` | 否 | 本地工作目录，用于素材盘点 |
| `deliverable` | 否 | 报告/表格/PPT/代码/SOP；省略则按关键词推断 |
| `constraints` | 否 | 硬约束，会并入 brief |
| `depth` | 否 | `quick` / `standard` / `deep`；quick 只留 6 条证据 |
| `locale` | 否 | `zh` / `en` |
| `known_capabilities` | 否 | 当前会话实际可用的 Skill 名，声明项排最前 |
| `known_mcp` | 否 | 当前会话实际可用的 MCP 服务器名 |

### 输出

| 字段 | 内容 |
|---|---|
| `brief` | problem_id、目标、领域、意图、交付物、约束、待澄清问题、`active_playbooks`（多剧本及得分） |
| `dimensions` | 按维度取证：id/label/priority/domains/boards/anchor/sources/status/evidence/hit_chunk_ids/queries/concept_cards/gap_reason/**source_matrix**（kb covered/gap + web 是否必须补） |
| `relations` | 融合后的交叉关系：from/to/type/note/sources，只保留两端都存在的维度 |
| `cross_checks` | 交叉核对清单（每条关系一行取舍/耦合说明），对应 plan 的「交叉复核」步 |
| `report_outline` | L4 五段呈现骨架：结论/严重性/分流/路线/验证待补；带来源名称、关键数值提示与硬上限，不输出 chunk_id |
| `report_style` | 呈现红线：表格≤3、讲解顺序（原理→公式→思路→步骤）、不暴露层级/条目编号、图片仅辅助 |
| `coverage` | 维度总数/覆盖数/证据数/置信度 |
| `coverage_matrix` | 每个检索面的命中 chunk_id 与状态 |
| `evidence` | ≤10 条：chunk_id、doc_id、status、标题、分数、来源、章节、摘录、命中的检索面 |
| `gaps` | 主题未覆盖 + 声明不覆盖（光刻工艺、空间光学） |
| `library_gaps` | 原文层缺口：A03 / C01 / E01 的缺失条数 |
| `capabilities` | 扫描到的 Skill、MCP 服务器、扫描说明 |
| `local_assets` | workspace 内文件清单（名称/类型/大小/相关度） |
| `plan` | 步骤数组 + 关键路径 + 可并行步骤 |
| `search_pack` | 按 facet 分组的检索词（标准/论文/厂商/报错/成本） |
| `acceptance` | 验收清单 |
| `success_criteria` | 前 6 条验收标准，作为完成判据 |
| `execution_contract` | 执行契约：agent 必须做什么、可调哪些 Skill/MCP/工具、何时停下 |
| `risks` | 知识缺口、原文缺口、能力发现、输入缺失、边界 |
| `handoff` | 可直接交给子 agent 的 Markdown |

### 每个计划步骤

```json
{
  "id": "S6",
  "phase": "预算",
  "goal": "做光通量、SNR、积分时间、运动模糊与数据率预算",
  "capability": "calc",
  "why": "…",
  "output": "预算表与瓶颈结论",
  "actions": ["明确输入量、单位、假设与公式", "…"],
  "routing": {
    "recommended_skills": [{ "name": "sheet", "source": "local-skill" }],
    "recommended_tools": [{ "name": "run_code", "availability": "check-at-runtime" }],
    "mcp_servers": [],
    "fallback": "Skill 不可用时用本地文件/脚本直接完成"
  }
}
```

---

## 任务剧本与 L2 数据层（16 张主题卡）

`data/assist-playbooks.json`（version 3）现有 16 张主题卡：高光谱、光学设计、检测装调、共焦传感、光谱仪光栅、成像相机、薄膜镀膜、故障排查、技术调研，加 3.1.0 新增的位置姿态、红外系统、光纤传感、干涉/OCT、波导 AR、信号链、不确定度与定标。每张卡除原有触发词/板块/检索面/步骤外，还声明：

```json
{
  "required_dimensions": [{ "id": "spec", "label": "指标分解与互斥", "domains": ["IM","DS"], "boards": ["IM03"], "anchor": "…", "priority": 1 }],
  "relations": [{ "from": "spectrometer", "to": "aberration", "type": "constrains", "note": "分光方案决定像差形式" }],
  "cross_check": ["幅宽与光谱分辨率的取舍", "推扫几何与信噪比耦合"],
  "steps": [{ "phase": "指标", "capability": "calc", "dimension_id": "spec" }]
}
```

**多剧本激活**：主剧本必选；其余剧本分数 ≥2 且必须命中至少一个非通用词才激活，最多 3 张。`GENERIC_KEYWORDS` 覆盖分辨率、噪声、灵敏度、精度、误差、带宽、动态范围、视场、设计、选型、检测、测量、标定、校准、预算、成本、方案、对比、调研、分析、成像——避免“光谱分辨率 5 nm”把共焦剧本、“高光谱成像”把相机剧本误带进来。

**维度融合**：同 id 维度合并，保留最小 priority，合并 domains/boards 并记录 sources，上限 12；`fuseRelations` 只保留两端都存在的维度关系。

另有两只只读数据文件：

- `data/concept-cards.json`：308 张概念卡，来自 `kb-data.json` 的 308 条 present 块**一块一卡**逐字抽取（定义/公式/判据/误差来源/前两句），不改写、不加数值；带 domain、v3_boards、kind、statement、source_chunk_ids、keywords、applies_to。由 `scripts/build-concept-cards.mjs` 生成，`build-kb --all` 写完 meta 后自动重建；`--check` 校验 sha256。
- `data/cross-dimensions.json`：6 个通用维度模板（principle/design/calc/implementation/verification/risk），含 queries/boards/priority，供无命中剧本时兜底。

---

## 能力类别与路由

| capability | 典型候选 |
|---|---|
| `clarify` | `interaction.ask` |
| `kb` | `opticforge_search` / `opticforge_get` |
| `local_scan` | `Glob` / `Read` / `Grep` / `PowerShell` |
| `calc` | `run_code` / `PowerShell` / `sheet` |
| `skill_doc` | `word` / `lark-doc` / `markdown` |
| `skill_sheet` | `sheet` |
| `skill_ppt` | `ppt` |
| `skill_code` | `Write` / `Edit` / `PowerShell` |
| `skill_image` | `seedream-55` / `image_gen` |
| `mcp_desktop` | `computer_use_tool` / `mac_computer_use_tool` |
| `web_search` | `general_search` / `web_search`（受 web_gate 门禁，先 KB 后联网） |
| `web_fetch` | `web_fetch`（受 web_gate 门禁，先 KB 后联网） |
| `analysis` | `PowerShell` / `sheet` / `run_code` |
| `verify` | `opticforge_verify` |
| `deliver` | `present_files` |

Skill 候选按名称匹配打分：精确匹配 > 前缀匹配 > 包含匹配，`doc` 不会误命中 `docker`。每个候选带 `source: local-skill | declared`，工具带 `availability: check-at-runtime`——因为插件无法知道当前会话到底开了哪些工具。

---

## 能力发现（只读）

| 对象 | 路径 | 读什么 |
|---|---|---|
| Skill | `~/.dsh/skills`、`~/.agents/skills`、`~/Doubao/skills`、豆包 workspace `.skills` / `.user_skills`、`<workspace>/.skills` | `SKILL.md` 的 name/description |
| MCP | `~/.dsh/.mcp.json`、`mcp.json`、profile `.mcp.json`、`~/.cursor/mcp.json`、`<workspace>/.mcp.json` | 服务器名 |
| 素材 | `<workspace>` 两层目录 | 文件名、扩展名、大小 |

上限：Skill 150 个、素材 240 个、深度 2 层、单文件大小只读元数据。失败降级为空并写 note。

**不读**：凭据内容、用户文档正文、浏览器数据。

---

## 取证与缺口（按维度）

1. 维度来源 = 激活剧本的 `required_dimensions` 融合 + 通用维度补缺，上限 12。
2. 每个维度独立检索：`label + anchor + anchorTerms + queries`，深度决定 topK（quick 2 / standard 4 / deep 5）。
3. 每面输出 `evidence`、`hit_chunk_ids`、`queries`、`used_queries`、`concept_cards`、`gap_reason`；同块按最高分聚合。
4. 全局证据优先剧本 `sections`，跨板块最多补 2 条，避免被单一长板块占满。
5. 维度 0 命中 → `status=gap`，`source_matrix.web=required`，生成按维度的中英双语外部检索组（`facet:"缺口·X"`、`gate_id:"kb_gap"`、带 `dimension_id`）。
6. `library_gaps` 由 `kb-meta.docs` 计算，固定检查 A03/C01/E01，给出缺失条数。

---

## 先知识库、后联网（显式契约）

「先查本地知识库，后联网」是**显式契约**，已在 `lib/assist.js` 落地。`opticforge_assist` 是光电/光学任务第一入口；在它完成 KB 对齐并给出放行之前，执行层不得调用任何外部检索工具。该契约同时写在 `opticforge_assist` 的工具描述里，可被入口契约测试静态检查。

### alignment（KB 对齐，已实现）

assist 返回体顶层 `alignment` 块，机器可读地留痕 KB 取证过程：

| 字段 | 实际结构 |
|---|---|
| `kb_queries` | 本次全部维度的查询去重后的字符串列表 |
| `matched` | `[{query, dimension_id, hit_chunk_ids[]}]`，命中的维度 |
| `unmatched` | `[{query, dimension_id, reason:"KB 无命中"}]`，gap 维度 |
| `coverage_matrix` | 与 `dimensions` 同源：逐维度行，含 status、hit_chunk_ids 与 `source_matrix`（维度×来源） |
| `source_summary` | `{kb_covered, kb_gap, web_required}`，一眼看出多少面必须联网补 |
| `verdict` | **`covered`**（全部维度命中）/ **`partial`**（部分命中）/ **`gap`**（0 维命中，含 total=0） |
| `evidence_count` | 证据条数 |
| `declared_gaps` | 命中「声明不覆盖」主题的检索面列表 |

顶层另有 `kb_queries`（同 alignment.kb_queries）与 `external_queries`（search_pack 中 `scope=external` 的子集），供执行层直接分账。

### web_gate（默认拒绝，已实现）

顶层 `web_gate` 只做判断、不发起任何检索：

| 字段 | 实际结构 |
|---|---|
| `policy` | 固定 `"default_deny_explicit_allowlist"` |
| `allowed` | 布尔，任一条件 `granted=true` 才为 true |
| `reason` | 命中条件 id 列表，或 default_deny 提示 |
| `conditions` | 四条 `{id, when, granted, evidence?}` 放行条件 |

四个放行条件 id：

| id | 触发（`when`） |
|---|---|
| `kb_gap` | KB 取证后仍存在主题缺口或「声明不覆盖」主题 |
| `standard_version` | 问题提及标准/规范/ISO/GB/T/JJF/版本号 |
| `vendor_params` | 问题提及厂商/型号/datasheet/选型/供应商/具体器件 |
| `price_timeliness` | 问题提及预算/成本/报价/最新年份/交期时效 |

`allowed=false` 时，`general_search`、`web_search`、`web_fetch` 一律不得调用；放行只对应该 id 下的那组查询，KB 已 present 的事实不得联网重复确认。

### search_pack：KB 查询与外部查询分账（已实现）

`search_pack` 是数组，每条 facet 带分账字段：

- `scope: "kb"`（首条「KB·主题」）：`blocked_by=null`、`gate_id=null`，立即走 `opticforge_search`，不联网；
- `scope: "external"`：带 `gate_id`（对应 web_gate 条件 id）、`trigger`（该条件的 when 文案）、`gated`（布尔，该条件当前是否已放行）、`blocked_by: ["kb_evidence","web_gate"]`；未放行时保留意图、不执行。

### plan 步骤：web 步骤 blocked_by + external_queries + 门禁拦截（已实现）

plan 对象除 `steps/critical_path/parallelizable` 外，还暴露 `kb_evidence_step`（取证步 id）与 `web_gated_steps[]`（被门禁的步 id）。

- 每个步骤带 `blocked_by[]`、`gate_id`（普通步为 null）、`blocked`、`web_gated`、`external_queries[]`；
- **playbook 具体 web 步**：`blocked_by=[取证步id,"web_gate"]`，`gate_id` 对应某个 web_gate 条件 id，严格按该 `condition.granted` 判定；放行时 `external_queries` 只装入该 gate_id 下已放行且 `scope=external` 的查询，`blocked` 时为空数组；
- **聚合「外部核验」步**：`gate_id="any"`，按 `web_gate.allowed` 判定（任一条件命中即放行）；放行时 `external_queries` 装入所有已放行外部查询；
- 条件未放行时该步 `blocked=true`、`web_gated=true`、`external_queries=[]`，且 `actions` 被替换为三条拦截提示（禁止发起外部检索 / 满足触发条件 / 本步仅保留意图）；
- `parallelizable` 不含 web_gated 步——**不允许无约束并行**：先 KB 取证、出 gap、再按放行条件联网；专业步可并行，取证与门禁步不可跳过、不可越序。

### plan 的交叉约束（3.1.0）

- 专业步带 `dimension_id`；KB 取证步的 `dimension_ids` 覆盖全部维度；
- 新增「缺口补证」web 步（只在有 gap 维度时出现）与「交叉复核」步：逐条 relation 写核对动作，要求两面数字同表比较并回写 `cross_checks`；
- relation 两端步骤互写 `coordinates_with`，`parallelizable` 自动排除 critical、web_gated 与任何有 `coordinates_with` 的步——耦合对不许拆开并行。

---

## DSH Skill 软约束与 KB-first 评测

- `skills/opticforge-task/SKILL.md` 固定执行顺序：assist → KB 对齐 → web_gate → 按 blocked_by 执行 → 公式卡计算轨迹 → docx/pdf 导出文本 → verify。
- `scripts/install-local.mjs` 将 Skill 链接到 `~/.dsh/skills/opticforge-task`；目标是普通目录时不覆盖，卸载只删除链接。它是软约束，不是 DSH 中间件级硬拦截。
- `eval/run-kb-first.mjs` 跑 13 类任务的离线契约评测，检查第一入口、多剧本、维度与 `source_matrix`、交叉清单、alignment、web_gate、blocked_by、公式卡来源与 verify 使用；另用同一案例的维度/关系合成最小合规文本，单独跑一遍 verify 交叉契约。
- 指标：契约通过率、assist 首调率、KB 先于 web、verify 使用率/通过率、`multi_playbook_rate`、`dimension_coverage_rate`、`source_matrix_rate`、`cross_relation_rate`。
- 真实模型行为必须用 DSH 工具轨迹另测：`node eval/run-kb-first.mjs --trace <jsonl>` 统计 assist 首调率（门槛 ≥90%）、KB 先于 web（≥80%）、verify 使用率（100%）。没有轨迹时，评测结果只代表 harness，不宣称模型已达标。

---

## 公式卡片（data/formula-cards.json，可选只读）

`data/formula-cards.json` 是**可选**的只读数据文件，按问题返回计算卡片，辅助执行层做光通量、SNR、积分时间等预算。

- **只读**：assist 只读取它，不写、不创建；
- **不计算**：只返回卡片原文，**不替执行层代入数值**；计算由执行层（run_code / sheet / PowerShell）完成；
- **降级**：文件缺失或 JSON 解析失败时，返回体里 `calc_specs` 为空数组 `[]`，并在 risks 里写一条 info 提示，不报错、不编造公式；**失败结果不永久缓存**，下次请求会重试加载，文件后续补入后即可自动读到。

单张卡片 schema（在基础字段外，用 `domains[]` / `keywords[]` 做路由）：

```json
{
  "id": "formula-hyperspectral-snr",
  "title": "高光谱 SNR 预算",
  "domains": ["hyperspectral", "imaging_camera"],
  "keywords": ["高光谱", "SNR", "积分时间", "推扫"],
  "formula": "SNR = N_ph / sqrt(N_ph + N_dark + N_read^2)",
  "variables": [
    { "symbol": "t_int", "unit": "s", "meaning": "积分时间" }
  ],
  "assumptions": ["线性响应", "暗电流已扣除"],
  "sanity_range": "SNR 50–500 为合理区间",
  "worked_example": "…",
  "source_chunk_ids": ["I05-03", "I06-01"]
}
```

`calc_specs` 下发的每条为 `{card_id, title, formula, variables[], assumptions[], sanity_range, worked_example, domains[], keywords[], source_chunk_ids[], match_reason}`，`match_reason` 记录命中依据。匹配是**四层分桶、只返回最高非空层**：

1. **Tier 0（problem_keyword）**：问题原文直接命中卡片 `keywords[]`，优先满足具体计算意图，避免宽泛领域桶淹没相关卡；
2. **Tier 1（domains）**：卡片 `domains[]` 命中问题领域（playbook.id 或问题文本包含领域标签）；
3. **Tier 2（keywords）**：前两层无命中时，卡片 `keywords[]` 命中问题关键词；
4. **Tier 3（fallback）**：前三层均无命中时，标题 / 公式 / 变量 symbol 或 meaning 命中问题关键词，或 `source_chunk_ids` 与本次证据 chunk_id 有交集。

实现上只返回第一个非空桶；Tier 0 最多 8 张。若同卡同时命中关键词与领域，`match_reason` 同时保留两类依据。

- `domains[]`：适用领域 id 列表（对应 playbook.id），用于 Tier 1 领域匹配；
- `keywords[]`：该卡片覆盖的中文/英文关键词列表，用于 Tier 0 原文直接命中与 Tier 2 关键词匹配；
- `source_chunk_ids`：数据层保证，卡片中的 id 必须全部指向现有 `status=present` 条目；assist 不为此新增过滤或拒绝逻辑，引用时仍以 chunk_id 为准。

卡片本身不作为独立证据，引用时仍以 chunk_id 为准。

---

## L4 呈现层（3.1.1）

`assist` 不只给作战包，还给用户正文的固定骨架。执行层按 `report_outline` 写，不把 15+ 个内部字段原样倒出来。

| 段 | 内容 | 硬上限 |
|---|---|---|
| ① 结论 | 一句话原理 + 关键公式/判据 + 最可能诊断 + 立即行动 | 3 句 |
| ② 严重性对号入座 | 工况 / 判据量级 / 相对裕度 / 处理 | 1 张表、≤3 行 |
| ③ 分流判断 | 一个实验或一个判据，把两条路线分开 | 1 条判据 |
| ④ 路线建议 | 每条一句话适用条件，最后给明确推荐 | 3 条 |
| ⑤ 验证与待补 | 验证项 + 待补参数，说明补上后能给出什么 | 3 验证、4 待补 |

`report_style` 红线：

- 全文表格 ≤3；一段超过 5 个带单位数字时拆表或只留决策量。
- 讲解顺序固定：一句话原理 → 关键公式/判据 → 具体思路 → 操作步骤；图片只辅助理解，不替代依据。
- 正文不出现 `alignment` / `web_gate` / `source_matrix` / `coverage_matrix` / `blocked_by` / `active_playbooks` 等内部字段名。
- 正文不出现 `chunk_id`、`A01-01`、`IM04` 这类层级/条目编号；来源只写文献、标准、厂商手册或 URL 名称。内部证据仍保留 ID，供审计与复核。
- 待补参数只在第⑤段出现一次；口径分歧给默认值和差异倍数，不把选择题丢给用户。

`verify` 传 `presentation: true` 时检查五段齐、表格≤3、内部字段名、`chunk_id`、源板块/域族编码、待补参数位置；文本已带 3 个以上五段标题时自动启用，避免误伤普通短答。

## 交付自检（opticforge_verify）

| 检查 | 判据 | 级别 |
|---|---|---|
| 引用存在 | `chunk_id` 在 KB 中 | error |
| 引用可引用 | `status=present` | error |
| 数量有来源 | 含单位的句子带引用或“计算/实测/仿真/来源”等说明 | warning（strict 下 error） |
| 假设 | 出现“假设/前提/边界条件” | warning |
| 缺口 | 出现“缺口/未覆盖/无原文” | warning |
| 复现 | 出现“复现/步骤/输入/命令” | warning |
| 来源段 | 有引用或“来源/参考” | warning |
| KB 对齐 | 有对齐段与 covered/partial/gap verdict（传 problem 时） | warning（strict 下 error） |
| 外部来源 | URL 带访问日期、厂商/型号/标准号等细节 | warning（strict 下 error） |
| 公式卡 | 有数值时给 formula_id；用卡后有计算轨迹；未知 id 为 error | warning / error |
| 维度齐全 | 传 `dimensions` 时，每个 label/id 必须出现；缺面报 `missing_dimension` | warning（strict 下 error） |
| 每面有据 | 维度出现处前后 240/700 字内必须有 chunk_id 或 URL；否则 `dimension_without_evidence` | warning（strict 下 error） |
| 耦合一致 | 传 `relations` 时两端必须同时出现（`relation_not_reflected`），且中间 220 字内写出约束/取舍（`relation_not_stated`） | warning（strict 下 error） |
| 来源分级 | URL 段落标「一手 datasheet/标准/论文」或「二手博客/百科」；未标 `external_source_tier`，二手 `external_untrusted_source` | warning（strict 下 error） |
| 多源交叉 | 含 URL 且含数值的段落至少 2 个来源，或标「单源待核」；否则 `external_single_source` | warning（strict 下 error） |
| KB 冲突 | 同段混用 chunk_id 与 URL 必须说明一致/差异/以谁为准；写「冲突」须带 `conflict_with_kb` | warning（strict 下 error） |
| 时效 | 价格/型号/标准/版本等 URL 段落有日期且超过 30 天 → `external_stale`（`now` 可注入） | warning（strict 下 error） |
| 营销词 | 完美/最佳/领先/保证/唯一/颠覆 等 | warning |

分数 = 100 − 18×error − 6×warning，下限 0；`pass` 只看 error。输出新增 `dimensions`（total/covered/missing/unevidenced/coupling_missing/coupling_unstated/rows）与 `adoption`（source_tier/corroborated/conflict_with_kb/stale/pass），checklist 增 `dimensions_complete` / `dimensions_evidenced` / `coupling_consistent` / `adoption_gate`。

只支持文本：`.md/.txt/.json/.csv/.html/.xml/.yaml/.yml/.js/.mjs/.ts/.py/.m/.tex/.log`，≤2 MB。docx/pdf 需先导出文本。

---

## 不变式

1. **不编造**：证据只来自 present 条目；没命中写缺口。
2. **不越权**：插件不联网、不写文件、不执行命令。
3. **可核对**：每个证据带 chunk_id 与 source；每个数字要么有引用，要么有计算说明。
4. **可降级**：数据/能力/素材任一缺失，都输出降级结果而不是失败；`formula-cards.json` 缺失时 `calc_specs` 为空列表。
5. **版本一致**：`package.json`、`kb-meta.kb_version`、概念卡 `kb_version`、工具回显四处一致。
6. **先 KB 后联网**：assist 完成 KB 对齐且 web_gate 放行前，不调用 `general_search` / `web_search` / `web_fetch`；web 步骤必须 `blocked_by` 取证与门禁，禁止无约束并行。
7. **交叉闭合**：必答维度一个不落；每个维度有 chunk_id/URL；关系两端必须同时出现并写出约束；缺面不补就过不了 verify 的 dimensions 检查。
8. **采信可审计**：外部来源分级、多源交叉、KB 冲突口径、时效四项必须留痕；`adoption.pass=false` 不得交付。

---

## 已知限制

- 能力发现依赖文件系统路径；DSH 内建 Skill 若在 app.asar 中，扫描不到，需用 `known_capabilities` 声明。
- 多剧本激活是规则匹配（分数 + 非通用词门槛），不做语义消歧；跨义项词（如“分辨率”）靠通用词表压误激活，仍可能有边界情况。
- 计划粒度到“步骤 + 动作”，不生成具体代码或参数；参数由执行层计算并用 verify 复核。
- `verify` 不判断技术正确性，只判断“是否有依据、是否有结构、采信是否留痕”。
