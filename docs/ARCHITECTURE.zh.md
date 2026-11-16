# OpticForge 架构（1.1.0）

## 一句话

把“查知识库”升级成“接一个具体问题，产出可执行、可验收的交付路径”。

插件不替 agent 干活，而是把活拆清楚：需要哪些依据、哪些本地素材、该调哪个 Skill/MCP、按什么顺序、每步产出什么、最后怎么验收。

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
│  Skill（sheet/word/ppt/seedream/browser…）                   │
│  MCP（桌面、浏览器、GitHub…）                                  │
│  本地工具（PowerShell/Python/文件读写）                        │
│  检索（general_search + web_fetch）                           │
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
| `brief` | problem_id、目标、领域、意图、交付物、约束、待澄清问题 |
| `coverage` | 检索面总数/覆盖数/证据数/置信度 |
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
    "recommended_tools": [{ "name": "calculator", "availability": "check-at-runtime" }],
    "mcp_servers": [],
    "fallback": "Skill 不可用时用本地文件/脚本直接完成"
  }
}
```

---

## 任务剧本（data/assist-playbooks.json）

每条 playbook 描述一类任务：

```json
{
  "id": "hyperspectral",
  "label": "高光谱成像",
  "keywords": ["高光谱", "推扫", "快照", "Offner"],
  "sections": ["I05", "I06", "G01"],
  "aspects": ["推扫几何 速高比 幅宽", "Czerny-Turner 消像散"],
  "focus": ["…"],
  "steps": [{ "phase": "指标", "goal": "…", "capability": "calc", "output": "…" }],
  "search": [{ "facet": "标准", "zh": "…", "en": "…" }]
}
```

现有 9 类：高光谱、光学设计、检测装调、共焦传感、光谱仪光栅、成像相机、薄膜镀膜、故障排查、技术调研。未命中任何剧本时用通用剧本，仍会产出取证、盘点、交付、自检四段。

**扩展方式**：加一个对象，不改代码。触发词、板块、检索面、步骤、交付物都能独立调。

---

## 能力类别与路由

| capability | 典型候选 |
|---|---|
| `clarify` | `interaction.ask` |
| `kb` | `opticforge_search` / `opticforge_get` |
| `local_scan` | `Glob` / `Read` / `Grep` / `PowerShell` |
| `calc` | `calculator` / `PowerShell` / `sheet` |
| `skill_doc` | `word` / `lark-doc` / `markdown` |
| `skill_sheet` | `sheet` |
| `skill_ppt` | `ppt` |
| `skill_code` | `Write` / `Edit` / `PowerShell` |
| `skill_image` | `seedream-55` / `image_gen` |
| `mcp_desktop` | `computer_use_tool` / `mac_computer_use_tool` |
| `web_search` | `general_search` / `web_search` |
| `web_fetch` | `web_fetch` |
| `analysis` | `PowerShell` / `sheet` / `calculator` |
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

## 取证与缺口

1. 检索面 = 剧本 `aspects` + 问题关键词（去掉纯数字和量值，避免造出“400-1000”这种假主题）。
2. 每个面 `searchKB(query, 6)`，只返回 present。
3. 按 chunk 聚合，命中面越多排名越前，最多 10 条。
4. 某面 0 命中 → `gaps`；问题命中声明不覆盖主题 → 追加“声明不覆盖”。
5. `library_gaps` 由 `kb-meta.docs` 计算，固定检查 A03/C01/E01，给出缺失条数。
6. 证据摘录取命中词附近 220 字，保留标题与来源。

---

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
| 营销词 | 完美/最佳/领先/保证/唯一/颠覆 等 | warning |

分数 = 100 − 18×error − 6×warning，下限 0；`pass` 只看 error。

只支持文本：`.md/.txt/.json/.csv/.html/.xml/.yaml/.yml/.js/.mjs/.ts/.py/.m/.tex/.log`，≤2 MB。docx/pdf 需先导出文本。

---

## 不变式

1. **不编造**：证据只来自 present 条目；没命中写缺口。
2. **不越权**：插件不联网、不写文件、不执行命令。
3. **可核对**：每个证据带 chunk_id 与 source；每个数字要么有引用，要么有计算说明。
4. **可降级**：数据/能力/素材任一缺失，都输出降级结果而不是失败。
5. **版本一致**：`package.json`、`kb-meta.kb_version`、工具回显三处一致。

---

## 已知限制

- 能力发现依赖文件系统路径；DSH 内建 Skill 若在 app.asar 中，扫描不到，需用 `known_capabilities` 声明。
- 剧本是规则匹配，不做语义理解；问题跨多个领域时只选得分最高的一个，其余领域靠证据覆盖。
- 计划粒度到“步骤 + 动作”，不生成具体代码或参数；参数由执行层计算并用 verify 复核。
- `verify` 不判断技术正确性，只判断“是否有依据、是否有结构”。
