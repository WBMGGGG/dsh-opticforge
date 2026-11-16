# 工具用法

三个工具：`opticforge_docs`、`opticforge_search`、`opticforge_get`。都读写同一份本地知识库，共用一个输出信封。

---

## 先看该用哪个

```
不确定库里有什么   → opticforge_docs
知道要查什么       → opticforge_search
拿到 chunk_id 后
想看完整正文/核对数字 → opticforge_get
```

顺序建议：**docs → search → get**。先看目录能避免用错词检索，get 能避免凭 400 字摘录猜细节。

---

## 统一信封

```json
{
  "ok": true,
  "kb_version": "0.2.0",
  "action": "search",
  "...": "各工具自己的字段"
}
```

- `ok`：这次调用成功与否，失败时给 `error` 与 `hint`
- `kb_version`：当前数据版本，判断是否用上了最新知识库
- `action`：`docs` / `search` / `get`

---

## opticforge_docs

列板块和条目，不返回正文。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `doc_id` | string | 否 | 只看某个板块（`A01`/`F02`/`H03`…），省略则列全部 34 个 |

**返回**：每个板块的 `doc_id`、`source`、`chunks`、`present`，以及 `items[]`（`chunk_id` / `status` / `title`）。

```json
{ "ok": true, "action": "docs", "kb_version": "0.2.0", "total_docs": 34, "docs": [
  { "doc_id": "A01", "source": "confocalDT ...", "chunks": 13, "present": 12,
    "items": [ { "chunk_id": "A01-01", "status": "present", "title": "共焦色散位移传感器原理" } ] }
]}
```

板块不存在的处理：

```json
{ "ok": false, "error": "没有该板块", "available": ["A01","A02",...] }
```

---

## opticforge_search

BM25 检索，只返回 `status=present` 的条目。

**参数**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | 必填 | 中英文检索词，用工程术语比口语命中率高 |
| `top_k` | number | 5 | 本页条数，1–20 |
| `offset` | number | 0 | 翻页偏移，0–100 |
| `max_per_doc` | number | 3 | 同一板块最多几条，避免单个长板块刷屏 |
| `doc_filter` | string | — | 只检索某个板块 |

**返回**

| 字段 | 说明 |
|---|---|
| `total_matched` | 过滤后总条数（不随分页变化） |
| `returned` / `has_more` | 本页条数 / 是否还有下一页 |
| `results[].chunk_id` / `doc_id` / `status` / `score` | 定位信息与分数 |
| `results[].matched_terms` | 命中了哪些查询词——用来判断为什么召回 |
| `results[].chars` | 该条目总字数，据此决定要不要 `get` |
| `results[].excerpt` | `【标题】` + 命中词周围约 400 字 |
| `note` / `guidance` | 未命中时的如实告知与下一步建议 |

**示例**

```
query="光栅 衍射 效率", top_k=5
→ total_matched=19, returned=5, has_more=true
  C02-01 12.18 [光栅,衍射,效率] 505字
  B02-02 11.33
  A02-01 11.00
```

**未命中是正常结果**

```json
{ "ok": true, "total_hits": 0, "note": "知识库中未找到相关依据",
  "guidance": "该主题在知识库中没有覆盖，返回空是正确行为；不要用通用常识替代知识库依据。" }
```

光刻工艺、空间光学、太赫兹、X 射线等主题本库明确不覆盖，此时空结果就是正确答案。

---

## opticforge_get

按 `chunk_id` 取完整条目，9 个字段全给。

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `chunk_id` | string | 是 | 形如 `F02-04`，从 search 或 docs 里取；大小写不敏感 |

**返回**：`ok`、`kb_version`、`action`，以及 `doc_id` / `status` / `text` / `source` / `page_or_section` / `keywords_zh` / `disclaimer` / `is_original_excerpt`。

**注意**：`status≠present` 的块也会返回，但带一条 `note`——它只是缺口说明，不能当依据引用。

不存在时：

```json
{ "ok": false, "error": "知识库中不存在该 chunk_id",
  "known_prefixes": ["A01","A02",...], "hint": "先调用 opticforge_docs 查看可用块清单" }
```

---

## 三个常见组合

**查一个具体判据**

```
docs(doc_id="A01") → search("共焦 量程 线性度") → get("A01-02")
```

**补基础理论**

```
search("艾里斑 分辨率 判据") → get("F02-04") → 需要公式推导再看 F01-05
```

**确认某主题到底有没有**

```
docs() → 看是否有对应板块 → 没有就如实说明无覆盖，不要用通用常识硬答
```

---

## 为什么没有计算器

0.1.0 曾带 5 个工程计算器（衍射极限、膜层热漂移、共焦选型、公差 RSS、NA 分辨率）。0.2.0 按需求聚焦知识库，计算器整体下线；相关公式仍可在 F01（成像/NA/分辨率）、F06（膜层热漂移）、G02（RSS 与公差）、H05（共焦选型思路）里查到依据。
