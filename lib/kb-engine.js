// OpticForge KB —— Okapi BM25 检索引擎（kb_tool.py 的纯 JS 忠实移植）
// 运行时纯 Node.js，无第三方依赖。中文按「单字 + 相邻双字」切分，英文/数字按词小写。
// 只索引 / 只检索 status === "present" 的知识块；返回 BM25 分数（round 4）并按 (-score, chunk_id) 排序。

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

const K1 = BM25_K1;
const B = BM25_B;

// 与 kb_tool.py 完全一致的 CJK 字符类
const _CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
// 非 CJK 段内，以 [A-Za-z0-9] 起头的词（保留 . - + / µ λ × ° ^ ~ 等符号）
const _LATIN = /[A-Za-z0-9][A-Za-z0-9_.\-+\/µλ×°^~]*/g;

function _isCJK(ch) {
  return _CJK.test(ch);
}

function _cjkTokens(chars) {
  const out = [];
  const L = chars.length;
  for (let k = 0; k < L; k++) out.push(chars[k]);            // 单字（召回）
  for (let k = 0; k < L - 1; k++) out.push(chars[k] + chars[k + 1]); // 相邻双字（区分度）
  return out;
}

/**
 * 中英混合分词：CJK 连续段产出单字+双字；非 CJK 段按正则收集拉丁词并转小写。
 * @param {unknown} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (text == null) return [];
  const s = String(text);
  if (!s) return [];
  const tokens = [];
  let i = 0;
  const n = s.length;
  let buf = [];
  while (i < n) {
    if (_isCJK(s[i])) {
      buf.push(s[i]);
      i += 1;
      continue;
    }
    if (buf.length) {
      tokens.push(..._cjkTokens(buf));
      buf = [];
    }
    // 收集一段连续的非 CJK 字符
    let j = i;
    while (j < n && !_isCJK(s[j])) j += 1;
    const seg = s.slice(i, j);
    for (const m of seg.matchAll(_LATIN)) tokens.push(m[0].toLowerCase());
    i = j;
  }
  if (buf.length) tokens.push(..._cjkTokens(buf));
  return tokens;
}

function _coerce(v) {
  return v == null ? "" : String(v);
}

/**
 * 建立 BM25 索引，仅纳入 status === "present" 的块。
 * 可检索字段 = text + keywords_zh + page_or_section + source + disclaimer（空格/换行拼接）。
 * @param {Array<object>} chunks
 */
export function buildIndex(chunks) {
  const docs = [];
  const tf = [];        // Map<token, count>[] —— 每块词频
  const lens = [];      // 每块 token 总数（dl）
  const df = new Map(); // Map<token, 含该词的文档数>
  let totalLen = 0;

  for (const rec of chunks || []) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
    if (rec.status !== "present") continue;          // 只索引 present
    const docId = rec.doc_id;
    const text = _coerce(rec.text);
    if (!docId || !text.trim()) continue;            // 与 Python 一致：缺 doc_id / 空正文跳过

    const searchable = [
      text,
      _coerce(rec.keywords_zh),
      _coerce(rec.page_or_section),
      _coerce(rec.source),
      _coerce(rec.disclaimer),
    ].join(" \n");

    const toks = tokenize(searchable);
    if (!toks.length) continue;
    const c = new Map();
    for (const t of toks) c.set(t, (c.get(t) || 0) + 1);
    let dl = 0;
    for (const v of c.values()) dl += v;

    docs.push({
      doc_id: docId,
      chunk_id: (rec.chunk_id == null || rec.chunk_id === "")
        ? docId + "-" + String(docs.length + 1).padStart(2, "0")
        : rec.chunk_id,
      text,
      status: rec.status,
      is_original_excerpt: rec.is_original_excerpt,
      source: _coerce(rec.source),
      page_or_section: _coerce(rec.page_or_section),
      disclaimer: _coerce(rec.disclaimer),
    });
    tf.push(c);
    lens.push(dl);
    totalLen += dl;
    for (const t of c.keys()) df.set(t, (df.get(t) || 0) + 1);
  }

  const N = docs.length;
  const avgdl = N ? totalLen / N : 0;
  const idf = new Map();
  for (const [t, d] of df) {
    idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  }
  return { docs, tf, lens, df, avgdl, N, idf };
}

function _scoreAll(index, query) {
  const q = tokenize(query == null ? "" : query);
  const qcounts = new Map();
  for (const t of q) qcounts.set(t, (qcounts.get(t) || 0) + 1);

  const { tf, lens, avgdl, N, idf } = index;
  const out = new Array(N).fill(0);
  for (const [t, qtf] of qcounts) {
    const idfVal = idf.get(t);
    if (idfVal === undefined) continue;
    const qw = Math.min(qtf, 3);
    for (let i = 0; i < N; i++) {
      const f = tf[i].get(t) || 0;
      if (!f) continue;
      const dl = lens[i];
      const denom = f + K1 * (1 - B + (B * dl) / (avgdl || 1.0));
      out[i] += (idfVal * (f * (K1 + 1)) / denom) * qw;
    }
  }
  return out;
}

// 以数组引用为键缓存索引，避免同一 KB 数组反复重建（51 块很小但可省开销）
const _indexCache = new WeakMap();
function _getIndex(chunks) {
  const hit = _indexCache.get(chunks);
  if (hit && hit.length === chunks.length) return hit.index;
  const index = buildIndex(chunks);
  _indexCache.set(chunks, { index, length: chunks.length });
  return index;
}

/**
 * BM25 检索。
 * @param {Array<object>} chunks 67 块完整数据（getKBData() 返回值）
 * @param {string} query 中文/英文检索词
 * @param {number} [topK=5] 最多返回条数
 * @param {string|null} [docFilter=null] 为 doc_id 字符串时，仅返回该 doc_id 的命中
 * @returns {Array<{chunk_id,doc_id,status,score,text,source,page_or_section}>}
 */
export function searchKB(chunks, query, topK = 5, docFilter = null) {
  if (!Array.isArray(chunks)) return [];
  const k = (typeof topK === "number" && Number.isFinite(topK))
    ? Math.max(0, Math.trunc(topK))
    : 5;
  const filter = (typeof docFilter === "string" && docFilter.length) ? docFilter : null;
  if (k === 0) return [];

  const index = _getIndex(chunks);
  const sc = _scoreAll(index, query);
  const { docs } = index;

  const cands = [];
  for (let i = 0; i < docs.length; i++) {
    if (sc[i] <= 0) continue;                   // score<=0 不返回
    if (filter && docs[i].doc_id !== filter) continue;
    cands.push({ doc: docs[i], score: sc[i] });
  }
  cands.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;       // -score 降序
    return a.doc.chunk_id < b.doc.chunk_id ? -1
         : a.doc.chunk_id > b.doc.chunk_id ? 1 : 0;          // 并列按 chunk_id 升序
  });

  return cands.slice(0, k).map(({ doc, score }) => ({
    chunk_id: doc.chunk_id,
    doc_id: doc.doc_id,
    status: doc.status,
    score: Math.round(score * 1e4) / 1e4,
    text: doc.text,
    source: doc.source,
    page_or_section: doc.page_or_section,
  }));
}
