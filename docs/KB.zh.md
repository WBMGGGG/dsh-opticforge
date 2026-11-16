# 知识库与检索

数据不是一大坨 JSON，而是按板块拆分、可逐条审阅的事实条目。本文说明它怎么组织、怎么改、怎么保证不编造。

---

## 规模与结构

- **67 个条目，9 个板块（A01–E01）**
- 其中 **51 条可用**（`status=present`），构成检索的证据池
- 16 条是**宣告的缺口**：11 条 `missing_source`（原文没拿到）、5 条 `substitute`（用同类公开资料顶上，明确注明不是原出处）

```
data/kb/A01.json … E01.json   按板块拆分的事实条目（人可读、可 diff、可单条审）
data/kb-data.json             合并产物，插件运行时读它
data/kb-meta.json             版本、内容 sha256、板块清单、空白词表、覆盖锚点
_kb-raw/<板块>.json            厂商原文快照，只留本地，已 gitignore，永不发布
```

`_kb-raw/` 的唯一用途是改写时回查数字和原始措辞。它不进公开仓库，也不进 npm 包。

---

## 三种状态

| status | 含义 | 能否作依据 |
|---|---|---|
| `present` | 有原文依据，已改写成事实条目 | 能，检索只会返回这一种 |
| `missing_source` | 原文没拿到，条目写的是"缺什么、为什么缺、怎么补" | 不能，只作缺口提示 |
| `substitute` | 原出处不可得，用同类公开资料补充一般原理 | 不能，正文会注明非原出处 |

缺口不是缺陷。模型看到 `note: 知识库中未找到相关依据` 时会告诉你没有依据，而不是编一个——这是设计目标。

---

## 事实条目的九条规矩

每个条目固定 9 个字段：`doc_id / chunk_id / status / is_original_excerpt / text / source / page_or_section / keywords_zh / disclaimer`。

`present` 条目的 `text` 必须满足：

1. 以 `【标题】` 开头
2. 之后逐行"字段：值"，一个字段一行
3. `is_original_excerpt = false`（全部为改写，不是原文转载）
4. **数字必须逐字回查原文**：写进去的每个数字都要能在同块原文里逐字找到。原文写 `three cycles` 就写"三个循环"，不能写成 `3`
5. 多档位参数用 ` / ` 分隔，并注明列序
6. 不跨块合并、不补充原文没有的解释
7. 不写营销词
8. 长度下限 120 字，**上限不设**——完整性优先，内容多就按语义拆条，不许为了字数删事实
9. 不确定的、原文没写的，宁可不写

规范全文见 `docs/KB-SPEC.zh.md`。

---

## 构建与校验

```bash
node scripts/build-kb.mjs --doc A02       # 改单板块时自检
node scripts/build-kb.mjs --all           # 全量校验 + 生成 kb-data.json 与 kb-meta.json
node scripts/build-kb.mjs --check         # CI 用：只校验已生成产物的一致性
node scripts/build-kb.mjs --all --version 0.1.0
```

校验项（任一不过即失败）：

- `chunk_id` 集合必须与 `_kb-raw` 完全一致，不多不少不重复——引用锚点不可漂移
- 9 个字段齐全、类型正确
- `present` 条目以`【`开头、≥120 字、`is_original_excerpt=false`、不含营销词
- **数字逐字回查**：`text` 里的每个数字 token 必须出现在同块原文中
- 合并后总块数与 present 数必须等于基线（67 / 51）

这套规则抓过真问题：把原文的 "three cycles" 写成 `3`、"one hundredth" 写成 `1/100`，校验器全部拦下——这些数字原文里并不存在。

---

## 版本与指纹

`data/kb-meta.json` 存：

- `kb_version`：与 `package.json` 版本一致，由 `--version` 指定
- `content_sha256`：合并后数据的指纹，`verify-all.mjs` 会复核
- `total_chunks` / `present_chunks` / `docs`
- `zero_coverage_topics` / `covered_anchors`：知识空白守卫用的词表

工具返回里的 `kb_version` 来自这里。如果它没变，说明你改了分部文件但没重建产物。

---

## 新增一个板块

1. 拿到原文，按块切分，写入 `_kb-raw/<新ID>.json`（含 `chunk_id / status / source / page_or_section / keywords_zh / text`）
2. 复制 `data/kb/A01.json` 当模板，按 `docs/KB-SPEC.zh.md` 逐块改写
3. `node scripts/build-kb.mjs --doc <新ID>` 跑到 OK
4. 把新 ID 加进 `scripts/build-kb.mjs` 的 `DOCS` 数组，更新 `EXPECTED` 基线
5. `--all` 重建，跑 `test/run.mjs` 与 `verify-all.mjs`

## 补一个缺口

缺口条目已经写清了"缺什么、为什么缺、需要什么"。拿到原文后，把该条 `status` 从 `missing_source` 改成 `present`，按规范改写 `text`，重建即可。`present` 数会变，记得同步 `EXPECTED` 与文档里的统计。

---

## 已知空白

当前明确不覆盖：量子计算 / 量子光学、COMSOL、SolidWorks、图像处理与缺陷检测、热光学与无热化、多物理场、光波导、非球面与自由曲面、光谱定标与辐射度学、不确定度与公差链、物理光学。

词表在 `kb-meta.json` 的 `zero_coverage_topics`，改数据即可，不用改代码。

---

## 版权边界

公开仓库只放改写后的工程事实和来源标注，不放厂商原文长段。逐字原文只存在于本地 `_kb-raw/`，用于核对数字，不随包发布。
