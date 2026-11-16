// OpticForge KB —— 数据模块（纯本地，无网络请求）
//
// 数据来源：data/kb-data.json，由 scripts/build-kb.mjs 从 data/kb/<板块>.json 合并生成。
// 设计取舍：不读任何旧缓存，也不做云端同步。插件永远使用与当前包版本一致的
// 内置数据 —— 这是「改完知识库 → 装上就生效」的前提；任何形式的缓存遮蔽都会让
// 用户改了 KB 却仍被旧数据回答，属于正确性问题而不是性能问题。

import { readFile } from "node:fs/promises";

export const KB_SOURCE = "OpticForge KB（本地内置 · data/kb/*.json 合并生成）";

// 期望基线：改板块结构时同步更新，构建脚本会用同样的数字卡住不一致。
export const TOTAL_CHUNKS = 67;
export const PRESENT_CHUNKS = 51;

const DATA_URL = new URL("../data/kb-data.json", import.meta.url);
const META_URL = new URL("../data/kb-meta.json", import.meta.url);

const REQUIRED_FIELDS = [
  "doc_id", "chunk_id", "status", "is_original_excerpt", "text",
  "source", "page_or_section", "keywords_zh", "disclaimer",
];

let _data = null;
let _meta = null;
let _byId = null;

/** 结构校验：每块 9 个字段齐全、chunk_id 唯一、status 合法。 */
function isValidKB(data) {
  const STATUSES = new Set(["present", "missing_source", "substitute"]);
  if (!Array.isArray(data) || data.length === 0) return false;
  const seen = new Set();
  for (const r of data) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return false;
    for (const f of REQUIRED_FIELDS) if (!(f in r)) return false;
    if (typeof r.doc_id !== "string" || !r.doc_id) return false;
    if (typeof r.chunk_id !== "string" || !r.chunk_id) return false;
    if (typeof r.status !== "string" || !STATUSES.has(r.status)) return false;
    if (typeof r.text !== "string") return false;
    if (r.is_original_excerpt !== true && r.is_original_excerpt !== false) return false;
    if (seen.has(r.chunk_id)) return false;
    seen.add(r.chunk_id);
  }
  return true;
}

export async function getKBData() {
  if (_data) return _data;
  const raw = await readFile(DATA_URL, "utf8");
  const parsed = JSON.parse(raw);
  if (!isValidKB(parsed)) {
    throw new Error("内置 KB 数据校验失败：字段不全、chunk_id 重复或 status 非法");
  }
  _data = parsed;
  return parsed;
}

/** 元数据：kb_version / content_sha256 / 板块清单 / 知识空白主题。缺失时按数据现场推导。 */
export async function getKBMeta() {
  if (_meta) return _meta;
  const data = await getKBData();
  const derived = {
    kb_version: "unknown",
    content_sha256: "",
    built_at: "",
    total_chunks: data.length,
    present_chunks: data.filter((c) => c.status === "present").length,
    docs: [],
    zero_coverage_topics: [],
    covered_anchors: [],
  };
  try {
    const parsed = JSON.parse(await readFile(META_URL, "utf8"));
    _meta = { ...derived, ...parsed };
  } catch {
    _meta = derived;
  }
  return _meta;
}

/** 按 chunk_id 取单块（供 opticforge_get 用）；未命中返回 null。 */
export async function getChunkById(chunkId) {
  const data = await getKBData();
  if (!_byId) {
    _byId = new Map();
    for (const c of data) _byId.set(c.chunk_id, c);
  }
  return _byId.get(String(chunkId).trim().toUpperCase()) ?? null;
}

/** 板块清单（供 opticforge_docs 用）：doc_id / 来源 / 块数 / present 数 / chunk 列表。 */
export async function listDocs() {
  const data = await getKBData();
  const out = [];
  for (const c of data) {
    let d = out.find((x) => x.doc_id === c.doc_id);
    if (!d) {
      d = { doc_id: c.doc_id, source: c.source, chunks: 0, present: 0, chunk_ids: [] };
      out.push(d);
    }
    d.chunks += 1;
    d.chunk_ids.push(c.chunk_id);
    if (c.status === "present") d.present += 1;
  }
  return out;
}

/** 数据来自哪里：固定 builtin（保留该函数是为了让上层不必关心实现）。 */
export function getKBSource() {
  return "builtin";
}
