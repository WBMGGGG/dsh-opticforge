# 知识库与检索

数据不是一大坨 JSON，而是按板块拆分、可逐条审阅的事实条目。本文说明它怎么组织、怎么改、怎么保证不编造。

---

## 规模与结构

- **324 个条目，40 个板块**
- 其中 **308 条可用**（`status=present`），构成检索的证据池
- 16 条是**宣告的缺口**：11 条 `missing_source`（原文没拿到）、5 条 `substitute`（用同类公开资料顶上，明确注明不是原出处）

五个系列：

| 系列 | 板块 | 性质 |
|---|---|---|
| A–E | A01 A02 A03 B01 B02 C01 C02 D01 E01 | 厂商原文改写，有 `_kb-raw/` 原文快照 |
| F | F01–F10 | 基础理论，教材与标准编译 |
| G | G01–G07 | 工程系统，教材、标准与工具文档编译 |
| H | H01–H08 | 前沿交叉，综述与标准编译 |
| I | I01–I06 | 场景深化（0.2.1）：几何光学判读、物理光学与传递函数、光学检测、光学设计、高光谱推扫/快照、CT/Offner 分光系统 |

```
data/kb/<板块>.json   按板块拆分的事实条目（人可读、可 diff、可单条审）
data/kb-data.json     合并产物，插件运行时读它
data/kb-meta.json     版本、内容 sha256、板块清单、空白词表、覆盖锚点
_kb-raw/<板块>.json   A–E 的厂商原文快照，只留本地，已 gitignore，永不发布
docs/KB-OUTLINE.zh.md 板块与条目总纲（chunk_id 契约，新增板块先改这里）
```

`_kb-raw/` 的唯一用途是改写时回查数字和原始措辞。它不进公开仓库，也不进 npm 包。

---

## 三种状态

| status | 含义 | 能否作依据 |
|---|---|---|
| `present` | 有依据，已写成事实条目 | 能，检索只会返回这一种 |
| `missing_source` | 原文没拿到，条目写的是"缺什么、为什么缺、怎么补" | 不能，只作缺口提示 |
| `substitute` | 原出处不可得，用同类公开资料补充一般原理 | 不能，正文会注明非原出处 |

缺口不是缺陷。模型看到 `note: 知识库中未找到相关依据` 时会告诉你没有依据，而不是编一个——这是设计目标。

---

## 两类板块，两套写作规则

### A–E：原文型（67 条）

每个条目固定 9 个字段：`doc_id / chunk_id / status / is_original_excerpt / text / source / page_or_section / keywords_zh / disclaimer`。

`present` 条目的 `text` 必须满足：

1. 以 `【标题】` 开头，之后逐行"字段：值"
2. `is_original_excerpt = false`（全部为改写，不是原文转载）
3. **数字必须逐字回查原文**：原文写 `three cycles` 就写"三个循环"，不能写成 `3`
4. 多档位参数用 ` / ` 分隔，并注明列序
5. 不跨块合并、不补充原文没有的解释、不写营销词
6. 长度下限 120 字，**上限不设**；内容多就照实写长
7. 一条原文块对应一条条目（`chunk_id` 集合必须与 `_kb-raw` 严格相等）

规范：`docs/KB-SPEC.zh.md`。

### F/G/H/I：编译型（257 条）

没有单一原文，来源是教材、标准与综述的通用结论。规则更严：

1. 正文 ≥ 300 字、至少 3 个字段行（定义/公式/判据/边界/工程要点）
2. `source` 必须是真实可核对的来源（作者《书名》版次，或标准编号）
3. `disclaimer` 必须注明"非原文摘录"
4. **不写具体产品型号、厂商指标、某镜头的实测数值**——那类内容只在有原文的 A–E 里出现
5. `chunk_id` 按 `docs/KB-OUTLINE.zh.md` 顺序编号，不得增删改名

规范：`docs/KB-SPEC-COMPILED.zh.md`。

---

## 构建与校验

```bash
node scripts/build-kb.mjs --doc F02       # 改单板块时自检
node scripts/build-kb.mjs --all           # 全量校验 + 生成 kb-data.json 与 kb-meta.json
node scripts/build-kb.mjs --check         # CI 用：只校验产物与分部文件一致
node scripts/build-kb.mjs --all --version 0.2.0
```

校验项（任一不过即失败）：

- 9 个字段齐全、类型正确、`doc_id` 与文件名一致
- `present` 条目以`【`开头、长度达标、`is_original_excerpt=false`、不含营销词
- A–E：`chunk_id` 集合与原文完全一致；**数字逐字回查**
- F/G/H：`chunk_id` 连续编号；字段行 ≥3；`source` 非空；`keywords_zh` ≥4；`disclaimer` 含"非原文摘录"
- `--check`：合并产物必须与分部文件完全一致，`content_sha256` 与 `total/present` 对得上

这套规则抓过真问题：把原文的 "three cycles" 写成 `3`、"one hundredth" 写成 `1/100`，校验器全部拦下——这些数字原文里并不存在。

---

## 版本与指纹

`data/kb-meta.json` 存：

- `kb_version`：与 `package.json` 版本一致，由 `--version` 指定
- `content_sha256`：合并后数据的指纹，`verify-all.mjs` 与测试都会复核
- `total_chunks` / `present_chunks` / `docs`
- `zero_coverage_topics` / `covered_anchors`：知识空白守卫用的词表

工具返回里的 `kb_version` 来自这里。如果它没变，说明你改了分部文件但没重建产物。

---

## 新增一个板块

1. 先在 `docs/KB-OUTLINE.zh.md` 登记：板块 ID、标题、每条要写什么
2. 原文型：把原文快照放 `_kb-raw/<ID>.json`；编译型：确认来源清单
3. 复制 `data/kb/F01.json` 当模板，按对应规范逐条写
4. `node scripts/build-kb.mjs --doc <ID>` 跑到 OK
5. `--all` 重建，同步 `lib/kb-data.js` 的 `TOTAL_CHUNKS` / `PRESENT_CHUNKS`、`test/run.mjs` 的统计断言、README 表格
6. 跑 `test/run.mjs` 与 `verify-all.mjs`

## 补一个缺口

缺口条目已经写清了"缺什么、为什么缺、需要什么"。拿到原文后，把该条 `status` 从 `missing_source` 改成 `present`，按规范改写 `text`，重建即可。`present` 数会变，记得同步基线。

---

## 已知空白

当前明确不覆盖：光刻工艺与光刻胶、空间光学与热控。其他主题若检索为空，说明本库没有依据，按缺口处理，不要用通用常识补。

词表在 `kb-meta.json` 的 `zero_coverage_topics`，改数据即可，不用改代码。守卫只在"查询命中主题词、且该词在 present 条目里确实 0 出现"时才短路，避免误伤有依据的查询。

---

## 版权边界

公开仓库只放改写后的工程事实和来源标注，不放厂商原文长段。A–E 的逐字原文只存在于本地 `_kb-raw/`，用于核对数字，不随包发布。F/G/H 是教材通用结论的工程整理，按 `source` 可回溯。
