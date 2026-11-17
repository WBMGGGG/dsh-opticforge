# OpticForge

光电工程师的**任务辅助插件**，DeepSeek Harness（DSH）。
输入一个具体问题，输出一套能直接执行的作战包：任务简报、维度化知识证据、交叉关系、能力路由、分阶段计划、定向检索词、验收清单。

纯 Node.js，零运行时依赖。**3.1.0 起把“交叉覆盖”落成可检查的执行契约：多剧本激活、按维度取证、维度×来源覆盖矩阵、交叉核对与采信闸门；插件仍不联网、不执行动作。**

---

## 它解决什么

做光机设计、装调、验收时，真正卡人的不是公式，而是三件事：

1. **依据散**：口径怎么换算、公差看哪个数、光谱仪配多少像素、共焦量程怎么选——散在手册、标准和论文里。
2. **路径乱**：知道要查资料、要算、要画图、要写报告，但不确定先做什么、该调哪个 Skill、哪些能并行。
3. **交付虚**：报告写完没人核对引用、单位、假设和缺口，数字看着都对，一追问就露。

OpticForge 把这三件事收进一个插件：

- **证据层**：40 个板块、324 条带来源的事实条目 + 16 张主题卡、308 张概念卡、6 个通用维度；检索命中给 chunk_id + 来源 + 摘录，按维度取证，没依据就明说。
- **路由层**：按问题激活最多 3 张主题卡，融合必答维度，盘点本机 Skill / MCP / 工作目录素材，生成带能力标签与 dimension_id 的执行计划；`alignment` 固定维度覆盖判定，`web_gate` 决定何时才允许联网。
- **验收层**：交付前检查引用、数量、KB 对齐段、外部来源日期、公式卡计算轨迹、维度齐全/每面有据/耦合一致，以及来源分级、多源交叉、KB 冲突、时效四项采信判据。

---

## 三层架构

```
问题
 │
 ├─ opticforge_assist ── 受理与路由
 │    ├─ brief          目标 / 交付物 / 约束 / 待澄清 / active_playbooks
 │    ├─ alignment      KB 查询 / matched / unmatched / verdict（按维度）
 │    ├─ web_gate       默认关闭；缺口、版本、厂商规格或时效才打开
 │    ├─ dimensions      按维度取证 + 概念卡 + 缺口原因 + source_matrix
 │    ├─ relations       交叉关系 + cross_checks 核对清单
 │    ├─ evidence       知识库证据 + 维度×来源覆盖矩阵 + 缺口
 │    ├─ capabilities   本机 Skill / MCP / 工作目录素材
 │    ├─ calc_specs     公式卡（公式、单位、假设、算例；不执行计算）
 │    ├─ plan           分阶段步骤；专业步带 dimension_id，web 步骤带 blocked_by，耦合步 coordinates_with
 │    ├─ search_pack    KB 查询与带 trigger/gated 条件的外部查询；缺口维度单列
 │    └─ acceptance     验收清单 + 风险 + 可交接 Markdown
 │
 ├─ 执行层（agent）── 按 plan 调用
 │    ├─ Skill：opticforge-task / sheet / word / ppt / browser …
 │    ├─ MCP：桌面、浏览器、GitHub 等
 │    ├─ 本地：PowerShell / Python / 文件读写
 │    └─ 检索：仅在 web_gate 打开后 general_search + web_fetch
 │
 └─ opticforge_verify ── 交付自检
      ├─ 引用：chunk_id 是否存在、是否 present
      ├─ 数量：数字是否有引用或计算说明
      ├─ 结构：假设 / 缺口 / 复现 / 来源
      ├─ KB-first：对齐段、verdict、外部 URL 日期与来源细节
      ├─ 交叉：维度齐全、每面有据、耦合一致
      ├─ 采信：来源分级、多源交叉、KB 冲突、时效
      ├─ 计算：formula_id、输入、单位、输出与复算路径
      └─ 措辞：绝对化与营销词
```

**边界**：插件本身不联网、不执行外部动作。它负责“想清楚怎么干”，执行层负责“真的去干”。

---

## 五个工具

| 工具 | 层 | 用途 |
|---|---|---|
| `opticforge_assist` | 辅助 | **主入口**。问题 → 简报 + 证据 + 能力路由 + 计划 + 检索包 + 验收 + handoff |
| `opticforge_verify` | 辅助 | 交付自检。传 `text` 或 `.md/.txt/.json/.csv` 路径，给 0–100 分与问题清单 |
| `opticforge_search` | 证据 | BM25 检索，返回 chunk_id、分数、命中词、摘录、来源、章节 |
| `opticforge_get` | 证据 | 按 chunk_id 取完整条目（9 个字段），引用与核数值时用 |
| `opticforge_docs` | 证据 | 列出 40 个板块与每块标题，先看目录再检索 |

统一信封：`{ ok, kb_version, action, ... }`。`assist` 与 `verify` 也回显 `kb_version`。

### 一次典型调用

```json
{
  "problem": "设计一台 400–1000 nm 推扫式高光谱成像仪，光谱分辨率 5 nm，空间分辨率 0.5 m@1 km，幅宽 30 km，给出分光方案、指标预算和定标流程",
  "deliverable": "方案报告",
  "workspace": "D:/AI/projects/hyperspectral",
  "known_capabilities": ["sheet", "word", "general_search"]
}
```

返回的 `plan` 会把任务拆成：澄清 → 取证 → 本地盘点 → 指标 → 方案 → 预算 → 定标 → 外部核验 → 交付 → 自检 → 收口。每步都有：

- `capability`：`kb` / `calc` / `skill_sheet` / `skill_doc` / `web_search` / `verify` …
- `actions`：具体动作，例如“opticforge_search('推扫 速高比')”“调用表格 Skill 建预算表”
- `routing`：候选 Skill、工具、MCP，以及不可用时的降级方案
- `output`：这一步必须产出什么

`handoff` 是一段可直接交给子 agent 的 Markdown，包含目标、依据、执行顺序与验收。另附 `execution_contract`：必须做什么、可调哪些 Skill/MCP/工具、什么情况必须停下。

**KB-first 执行契约**：先 `assist`，再按 `dimensions` 逐面执行 `alignment.kb_queries` 形成 matched/unmatched 与 `verdict`，然后核对 `relations` / `cross_checks`，最后才检查 `web_gate`。KB 已覆盖的原理不允许直接改用网页；只有 KB 缺口、标准版本、厂商规格、价格/时效等条件满足时才联网。`search_pack` 中 KB 查询与外部查询分开，外部查询带 `trigger/gated/gate_id/blocked_by`，只有 `gated=true` 才可执行；web 步骤带 `blocked_by`。随包 `skills/opticforge-task/SKILL.md` 给 DSH 固定同一流程。

### 公式卡与文档前置提取

`calc_specs` 从 `data/formula-cards.json` 选择公式卡，给出公式、变量单位、假设、合理范围、算例和 `source_chunk_ids`。执行层用 run_code / Python / PowerShell / 表格 Skill 计算，并在交付中写 `formula_id`、输入、输出、单位与复算路径；插件没有计算器。

docx/pdf 不直接交给 `verify`。先用 word/pdf Skill 导出 `.md` 或 `.txt`，再检查 KB 对齐段、外部 URL 的访问日期与型号/标准号、计算轨迹和单位闭合。

---

## 能力发现

`opticforge_assist` 会做三件只读扫描：

1. **Skill**：扫常见根目录（`~/.dsh/skills`、`~/.agents/skills`、`~/Doubao/skills`、豆包 workspace 的 `.skills` / `.user_skills`），读 `SKILL.md` 的 name/description。
2. **MCP**：读常见 `.mcp.json` / `mcp.json` 配置，只取服务器名，不读凭据。
3. **本地素材**：给了 `workspace` 就扫两层目录，按扩展名识别图纸、数据、代码、文档，按文件名相关度排序；只读文件名与大小，不读内容。

扫描失败只降级为空列表并写 note，不阻断任务。`known_capabilities` 可把当前会话实际可用的 Skill 名传进来，`known_mcp` 可声明实际可用的 MCP 服务器，声明项会排在候选列表最前。

---

## 知识库现状（3.1.0，内容基线不变）

**40 个板块、324 条条目，其中 308 条可作为依据**（`status=present`）。在此之上叠了三层只读数据：16 张主题卡（98 条维度声明）、308 张概念卡（一块一卡，逐字抽取）、6 个通用维度模板。

| 系列 | 板块 | 内容 | 条目 |
|---|---|---|---|
| A–E | 9 | 厂商原文改写：共焦传感器、光谱仪、公差分析、DOE、白光干涉、RCWA 光栅、光电二极管、计量规范 | 67（51 present） |
| F | 10 | 基础理论：几何光学、干涉衍射、偏振、激光、辐射度与色度、薄膜、探测与噪声、光谱学、干涉计量、材料工艺 | 83 |
| G | 7 | 工程系统：光机装调、公差与不确定度、热光学、光谱/辐射定标、检测与图像处理、COMSOL、SolidWorks | 53 |
| H | 8 | 前沿交叉：超表面与 DOE、光波导与光子集成、量子光学、高光谱、激光三角/共焦/雷达、失效现场、前沿专题、半导体光源 | 61 |
| I | 6 | 场景深化：像差判读、物理光学与传递函数、光学检测、光学设计、高光谱推扫/快照、Czerny-Turner 与 Offner 分光系统 | 60 |

**L2 数据层**

- `data/assist-playbooks.json`：16 张主题卡，每张声明 `required_dimensions`（合计 98 条）、`relations`、`cross_check`，每个步骤绑定 `dimension_id`。
- `data/concept-cards.json`：308 张概念卡，来自 308 条 present 块的**一块一卡**逐字抽取，不改写、不加数值；8 域分布 IM53/QE33/MT65/DT26/TF67/EL3/DS53/AL8，全部带 applies_to。
- `data/cross-dimensions.json`：principle/design/calc/implementation/verification/risk 六个通用维度，无命中主题卡时兜底。

### 缺口

**原文层只剩三处**：A03（《光学学报》峰值定位综述，1 条）、C01（ZYGO CSI 白皮书，5 条）、E01（JJF 1990-2022，6 条）的原始条文未取得。合计 16 条非 present：11 条 `missing_source`、5 条 `substitute`（用同类公开资料补一般原理，并注明非原出处）。

`opticforge_assist` 会把这三处单列为 `library_gaps`，`opticforge_verify` 会把引用非 present 条目直接判错。**维度缺口另算**：某维度 0 命中时 `source_matrix.web.status=required`，生成 `缺口·X` 中英双语外部检索组，交付物必须标 `covered_by_web` 与来源等级。

主题层另有两条按维护者要求不纳入：光刻工艺与光刻胶、空间光学与热控。检索为空即无依据，不编造；其他未列主题同理。

---

## 数据怎么保证准确

两类板块，两套规则，都由 `scripts/build-kb.mjs` 强制检查：

**A–E（原文型，67 条）**

- 每条对应一段厂商原文快照，`chunk_id` 集合必须与原文完全一致，引用锚点不可漂移
- 正文改写为事实条目（`is_original_excerpt=false`），以`【标题】`开头
- **数字逐字回查原文**：写进去的每个数字都必须能在同块原文里找到
- 公开仓库不放逐字原文长段，`_kb-raw/` 只留本地

**F/G/H/I（编译型，257 条）**

- 无单一原文，来源是教材、标准与综述的通用结论，`source` 必须是可核对的真实来源
- 正文 ≥300 字、至少 3 个字段行，`disclaimer` 必须注明“非原文摘录”
- **不写具体产品型号与厂商指标**——那类内容只出现在有原文的 A–E 里

---

## 目录结构

```
lib/index.js          工具注册（5 个）
lib/assist.js         任务受理、取证、能力路由、计划、验收
lib/capabilities.js   Skill / MCP / 本地素材只读扫描
lib/verify.js         交付自检
lib/kb-engine.js      BM25 检索引擎
lib/kb-data.js        数据加载与统计
data/kb/              40 个板块的事实条目（人可读、git diff 可审）
data/kb-data.json     合并产物，运行时读它
data/kb-meta.json     版本、sha256、板块清单、缺口词表
data/assist-playbooks.json  任务剧本（触发词/步骤/检索面）
data/formula-cards.json 19 张公式卡（不执行计算）
skills/opticforge-task/ DSH 的 KB-first 工作流 Skill
eval/                 KB-first 契约评测与真实轨迹评分入口
docs/KB-OUTLINE.zh.md 板块与条目总纲（chunk_id 契约）
docs/ARCHITECTURE.zh.md 架构与扩展点
```

---

## 安装

### 从插件市场（推荐，已提交收录）

在 DSH 里打开插件市场，搜 `OpticForge` 安装。

### 本机 link 安装（开发用）

```bash
node scripts/install-local.mjs            # 写入 profile 依赖 + bundles + 建目录链接
node scripts/install-local.mjs --dry-run  # 只打印，不动文件
node scripts/install-local.mjs --uninstall
```

重启 DSH 生效。之后改仓库代码或数据，重启即加载最新版本。安装器还会把 `skills/opticforge-task` 链接到 `~/.dsh/skills/opticforge-task`；若目标已是普通目录则不覆盖，卸载只删除链接。

---

## 开发

```bash
node test/run.mjs                        # 集成测试
node scripts/verify-all.mjs              # 发布前验收
node eval/run-kb-first.mjs               # 13 类任务的 KB-first 契约评测 + 交叉契约
node scripts/build-kb.mjs --all --version 3.1.0
node scripts/build-kb.mjs --check
```

改知识库：编辑 `data/kb/<板块>.json` → `--doc` 自检 → `--all` 重建 → 跑测试。
改任务剧本：编辑 `data/assist-playbooks.json`，加触发词、板块、步骤或检索面，不必改代码。

CI（`.github/workflows/test.yml`）在 Ubuntu + Windows、Node 20 + 22 上跑同一套检查。

---

## 边界

- 只覆盖上面列出的 40 个板块；光刻工艺、空间光学明确不覆盖
- 编译型条目是教材通用结论的工程整理，引用时按 `source` 回原始文献核对
- 厂商指标只出现在 A–E 且有原文快照，其余板块不写具体型号参数
- 16 条缺口只用来告诉你“这里没有依据”，不能当事实引用
- 插件不联网、不执行动作；外部检索与 Skill/MCP 调用由执行层完成
- `verify` 只做文本级检查，不解析 docx/pdf；需先导出为文本

## 许可

MIT。第三方资料版权归各原作者，本仓库只收录改写后的工程事实与来源标注。
