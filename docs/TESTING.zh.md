# 测试与验收

两套检查，都离线运行，不依赖 DSH 进程、不写缓存。

| 命令 | 内容 | 用时 |
|---|---|---|
| `node test/run.mjs` | 30 个集成用例（node:test） | 约 1 秒 |
| `node test/assist-contract.test.mjs` | 26 个 KB-first / 公式卡 / 交叉 / 呈现契约用例 | 约 1 秒 |
| `node test/entry-contract.test.mjs` | 5 个五工具与入口契约用例 | 约 1 秒 |
| `node eval/run-kb-first.mjs` | 13 类任务离线契约评测 + 交叉契约 + 结构合规 | 约 2 秒 |
| `node scripts/verify-all.mjs` | 61 项发布前验收 | 约 8 秒（含 npm pack） |

CI（`.github/workflows/test.yml`）在 Ubuntu + Windows、Node 20 + 22 上跑 `verify-all`，由它统一执行上述测试与评测。

---

## 集成测试的分组

**A. 注册契约**

插件可加载，`apply/inject/name` 正确，恰好注册 5 个工具（assist / verify / docs / search / get）；每个工具 `parameters` 是标准 JSON Schema（根 `type=object`、`required` 名字都在 `properties` 里、不残留内部 DSL 的 `required` 布尔位），`output.schema` 与 `output.render` 齐备且可调用。

**B. 数据统计**

324 块 / 308 present；A–E 九个板块的块数不漂移；F/G/H/I 四个系列分别为 83 / 53 / 61 / 60；板块总数 40；`missing_source` 11、`substitute` 5；9 个字段齐全；`chunk_id` 唯一。

**C. 检索端到端**

命中 A01/C02；`doc_filter` 生效；`top_k` 上限；0 覆盖主题（空间光学、光刻工艺）短路；有依据的查询不被误判为空白；分页不重不漏；同板块条数受限；五个工具共享 `ok/kb_version/action` 信封；非 present 块从不进入检索结果。

**D. 目录与取用**

`opticforge_docs` 列出 40 个板块与逐块标题；`doc_id` 大小写不敏感、未知板块干净报错；`opticforge_get` 返回 9 字段完整条目、不存在时回 `ok:false` 与已知前缀；缺口块带 `note` 且明确"不可当作事实依据"；编译型板块能被检索命中（F01/F02/I01/I02）。

**E. 产物一致性**

`data/kb-data.json` 必须等于 `data/kb/*.json` 的合并结果；`kb-meta.json` 的 `content_sha256` 必须与数据实际内容匹配；`total_chunks` / `present_chunks` 对得上；空白词表与覆盖锚点非空。

**F. 辅助层**

`opticforge_assist` 对高光谱问题必须识别剧本、给出证据、≥8 步计划、能力路由、检索包、验收与 handoff；声明不覆盖主题必须进 `gaps` 且证据只含 present；`known_capabilities` 必须并入能力清单且排在前面，`workspace` 盘点不阻断任务。KB-first 检查覆盖 `alignment`、`web_gate`、`blocked_by` 与禁网条款；公式卡检查覆盖直接关键词命中、来源均为 present；`opticforge_verify` 检查有效引用、KB 对齐段、外部 URL 日期/来源细节、formula_id 与计算轨迹，并对不存在引用/无来源数量/营销词判问题；`kb_version` 为 3.1.1；`library_gaps` 恰好是 A03/C01/E01。

**F2 交叉契约（v3.1.0 新增）**：多剧本激活 ≥2 且维度去重；`coverage_matrix` 每行带 `source_matrix`（kb/web 两列）；缺口维度生成中英双语 `缺口·X` 外部组并带 `dimension_id`；plan 专业步带 `dimension_id`、存在「交叉复核」步、`coordinates_with` 双向、有耦合的步不进 `parallelizable`；verify 在缺面/缺耦合时分别报 `missing_dimension` / `relation_not_reflected`，并在二手源、单源数值、KB 冲突未说明、超 30 天时效四种情况下让 `adoption.pass=false`。

**F3 呈现契约（v3.1.1 新增）**：`assist.report_outline` 必须固定五段，且带 `max_sentences=3`、`max_tables=1`、`max_routes=3`、`max_verifications=3`、`max_open_params=4`；verify 传 `presentation:true` 时检查五段齐、表格≤3、内部字段名不入正文、正文不出现 `chunk_id`/源板块/域族编码、待补参数只在第⑤段；评测输出 `structure_compliance_rate`。

---

## verify-all 的八组

- **A 发布契约**：包名 `dsh-opticforge`、semver、`type=module`、`main`、`files`、`dsh.bundle.patch`、无 `peerDependencies`、无 `dependencies`、`repository`、`engines`
- **B 零宿主依赖**：`lib/` 全部文件不得出现 `@deepseek-ai/`，否则 link 安装会解析失败
- **C 产物一致**：跑 `build-kb.mjs --check`
- **D 集成测试**：跑主集成、assist 契约、入口契约三套，必须全绿
- **E 打包清单**：`npm pack --dry-run` 必须包含 `lib/` 全部模块、`data/kb-data.json`、`data/kb-meta.json`、`data/assist-playbooks.json`、`data/concept-cards.json`、`data/cross-dimensions.json`、`data/formula-cards.json`、`skills/opticforge-task/SKILL.md`、`cordis.patch.yml`、`README.md`、`LICENSE`；不得包含 `_kb-raw/`、`test/`、`scripts/`、内部文档
- **F 版本一致**：`package.json`、`kb-meta.kb_version`、概念卡 `kb_version` 与 assist 工具回显四处相同
- **G 新增契约**：19 张公式卡字段与 present 来源、Skill 工作流、13 类 KB-first 评测、安装器 dry-run
- **H 交叉数据层**：概念卡一块一卡（数量=present 数）、id 唯一、来源全 present、applies_to 非空、正文 ≥30 字；通用维度 6 个；主题卡 16 张、version=3、维度声明 ≥96 条、关系端点与步骤 `dimension_id` 全部闭合

任一项失败即退出码 1，不做"警告后继续"。

真实 DSH 轨迹可另存为 JSONL，每行一个事件：`{"case_id":"case-1","tool":"opticforge_assist"}`，再运行 `node eval/run-kb-first.mjs --trace <jsonl>`。轨迹评分门槛为 assist 首调率 ≥90%、KB 先于 web ≥80%、verify 使用率 100%；离线 harness 的 100% 不等于真实模型行为已达标。

---

## 为什么不再需要 asar

插件走原生 JSON Schema 注册，不 import 任何 `@deepseek-ai` 包。因此测试不需要从 `app.asar` 抽取 `dsh-tools` 依赖闭包，也不需要模拟 Electron 的 asar 读取。

代价是参数校验必须自己做——`lib/index.js` 的 `validateArgs` 负责。

---

## 手工抽查

```bash
node scripts/build-kb.mjs --doc F02    # 单板块校验
node scripts/build-kb.mjs --check      # 产物一致性
node eval/run-kb-first.mjs             # 13 类任务离线契约评测 + 交叉契约
node scripts/verify-all.mjs            # 发布门禁
```

数字校验抓过真实错误：改写 B01 时把原文 "three cycles" 写成 `3`、"one hundredth" 写成 `1/100`，被逐字回查拦下。这说明"防编造"是可执行的规则，不是口号。
