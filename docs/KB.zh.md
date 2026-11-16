# OpticForge 知识库与检索机制说明

> 数据：`data/kb-data.json`（308,424 字节，UTF-8 JSON 数组）；检索引擎：`lib/kb-engine.js`；云端同步：`lib/kb-data.js`。本文数值与代码实跑一致。

## 1. 知识库结构（67 块 / 9 篇来源 / 9 字段）

### 1.1 status 三种取值

| status | 数量 | 含义 | 是否参与检索 |
|---|---|---|---|
| `present` | **51** | 有原文摘录，可检索 | 是（唯一进入索引的状态） |
| `missing_source` | 11 | 原文来源缺失（如 403 / 未取得） | 否 |
| `substitute` | 5 | 用替代文本占位（非原摘录） | 否 |

### 1.2 每块 9 字段（`REQUIRED_FIELDS`）

`doc_id`（文档标识，如 A01）、`chunk_id`（块标识，如 A01-02）、`status`、`is_original_excerpt`（是否原文摘录）、`text`（正文）、`source`（来源）、`page_or_section`（页码/章节）、`keywords_zh`（中文关键词）、`disclaimer`（免责/说明）。

### 1.3 doc_id 主题分布

| doc_id | 主题 | 块数 |
|---|---|---|
| A01 | Micro-Epsilon confocalDT 共焦色散位移/厚度传感器 | 13 |
| A02 | Ansys Zemax KB 光谱仪（LGL 理论+实操） | 9 |
| A03 | 《光学学报》峰值定位综述 | 1 |
| B01 | Ansys Zemax KB 公差分析 | 11 |
| B02 | Ansys Zemax KB DOE / 超透镜 | 4 |
| C01 | ZYGO CSI 白皮书 / ISO 25178 | 5 |
| C02 | Ansys Zemax KB RCWA / Kogelnik 光栅效率 | 7 |
| D01 | 滨松《Si photodiodes》技术说明 | 11 |
| E01 | JJF 1990-2022 校准规范 / 光学制图 | 6 |
| **合计** | | **67** |

## 2. BM25 检索引擎（`lib/kb-engine.js`）

- 导出：`BM25_K1 = 1.5`、`BM25_B = 0.75`、`tokenize(text)`、`buildIndex(chunks)`、`searchKB(chunks, query, topK=5, docFilter=null)`。
- 分词：CJK 连续段（\u3400-\u4dbf / \u4e00-\u9fff / \uf900-\ufaff）产出**单字 + 相邻双字**（单字保召回、双字保区分度）；非 CJK 段按正则收集拉丁词（保留 `.-+/µλ×°^~` 符号）并转小写。
- 可检索字段：`text + keywords_zh + page_or_section + source + disclaimer`（以 `" \n"` 拼接）。
- 索引：只纳入 `status==="present"`；`idf = log(1 + (N - df + 0.5)/(df + 0.5))`；`denom = f + K1*(1 - B + B*dl/avgdl)`；查询词频取 `min(qtf, 3)`。
- 排序：`score <= 0` 不返回；按 `(-score, chunk_id)` 排序；分数 round 4 位。返回 7 字段 `{chunk_id, doc_id, status, score, text, source, page_or_section}`。
- **忠实移植**：与 Python 参考 `kb_tool.py` **逐分比对 25/25 完全一致**（top-5 chunk_id+score），未改算法、未硬编码过滤。
- 索引以 `WeakMap` 按 chunks 引用缓存。

## 3. 云端同步机制（`lib/kb-data.js`）

- **云端同步口径（如实）**：`syncFromCloud(force=false)` 由**宿主显式调用**；本插件的 `apply()` / 两个工具**不会自动发网络请求**。
- `CANDIDATE_URLS`：3 条 ModelScope Dataset 文件下载地址（`GrestestOptics/optics-kb` 的 `kb-data.json`，非推理 API）。
- 缓存：`~/.dsh/opticforge-cache/`；`SYNC_TIMEOUT_MS = 4000`、`SYNC_TTL_MS = 3600000`（1 小时）。
- `getKBData()`：优先读**已成功同步**的本地缓存，否则回退内置 67 块；任何网络/解析失败静默回退，**离线完全可用**。
- `isValidKB()`：67 块且每块 9 字段；`parseCloudPayload()` 兼容 JSON 数组 / `{chunks}` / `{data}` / JSONL。
- 实测（Dataset 未上传时）：`syncFromCloud()` 返回 `{"updated":false,"source":"builtin","error":"HTTP 404 ..."}`，属预期。

## 4. 知识空白与数据驱动守卫

### 4.1 0 覆盖主题清单（`ZERO_COVERAGE_TOPICS`，来自 PLUGIN_PLAN §4.3/§8.5/§2.2/用户补录）

量子计算、量子信息、量子光学、量子比特、COMSOL、SolidWorks、图像处理、缺陷检测、热光学、无热化、热稳定、多物理场、波动光学、工程图、衍射光波导、光波导、光子集成、白光干涉、非球面、自由曲面、光谱定标、辐射度学、黑体、红外测温、信号解调、激光三角、光学测厚、光机结构、不确定度、公差链、物理光学、光学检测。

### 4.2 `isZeroCoverageQuery(query, chunks)` 三重判据（全部满足才短路返回空 + `note`）

1. 查询命中 `ZERO_COVERAGE_TOPICS` 中至少一个词；
2. 查询**不含** `COVERED_ANCHORS`（共焦色散/IFS2402/RCWA/光栅/公差分析/RSS/photodiode 等 KB 明确覆盖的核心主题）——保护混合查询不被误伤；
3. **数据驱动**：命中词在 `status=present` 块的可检索字段（与 buildIndex 对齐的 5 字段）中确实 **0 出现**（`topicHasPresentBasis()` 运行时核实，结果按 chunks 引用缓存）。

### 4.3 为什么第 3 条关键（H1 教训）

- 「不确定度」在 `E01-06`（present）的 `keywords_zh`、「自由曲面」在 `B01-10`（present）的 `keywords_zh` **真实存在**——是可检索的真实依据，**不能屏蔽**；
- 「白光干涉」只出现在 C01-01..C01-05（均非 present），0 出现，短路返回空**才是如实告知**；
- 词表只是"已声明 0 覆盖"清单，**是否短路由运行时 KB 数据判定**，根治词表与 KB 实际覆盖漂移造成的误伤。

集成测试 `test/run.mjs`：C6（"量子计算 光学"→空+note 硬断言）、C6b（不确定度→E01-06 必须命中）、C6c（自由曲面→B01-10）、C6d（白光干涉仍短路）、C7（纯 ASCII 乱码未命中 note）。
