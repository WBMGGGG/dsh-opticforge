// OpticForge KB —— 数据模块
// 内置 67 块完整知识数据（data/kb-data.json），并提供 ModelScope 云端同步（失败静默回退内置）。
// 运行时纯 Node.js，无新增 npm 依赖。getKBData() 永远返回 67 块、含全部 9 个字段的对象数组。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const KB_SOURCE = "OpticForge KB (ModelScope Datasets GrestestOptics/optics-kb)";
export const TOTAL_CHUNKS = 67;
export const PRESENT_CHUNKS = 51;

const BUILTIN_URL = new URL("../data/kb-data.json", import.meta.url);
const REQUIRED_FIELDS = [
  "doc_id", "chunk_id", "status", "is_original_excerpt", "text",
  "source", "page_or_section", "keywords_zh", "disclaimer",
];

const DATASET = "GrestestOptics/optics-kb";
const CACHE_DIR = join(homedir(), ".dsh", "opticforge-cache");
const CACHE_FILE = join(CACHE_DIR, "kb-data.json");
const CANDIDATE_URLS = [
  "https://www.modelscope.cn/api/v1/datasets/" + DATASET + "/repo?Revision=master&FilePath=kb-data.json",
  "https://www.modelscope.cn/api/v1/datasets/" + DATASET + "/repo?Revision=master&FilePath=kb.json",
  "https://www.modelscope.cn/datasets/" + DATASET + "/resolve/master/kb-data.json",
];
const SYNC_TIMEOUT_MS = 4000;
const SYNC_TTL_MS = 60 * 60 * 1000;

let _builtin = null;       // 内置 67 块（缓存）
let _active = null;        // 当前对外提供的数据
let _source = "builtin";   // "builtin" | "cloud"
let _lastSyncOk = false;
let _lastSyncAt = 0;
let _inFlight = null;

/** 校验是否为「67 块、每块含全部 9 字段且类型正确」的合法 KB 数组。 */
function isValidKB(data) {
  if (!Array.isArray(data) || data.length !== TOTAL_CHUNKS) return false;
  for (const r of data) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return false;
    for (const f of REQUIRED_FIELDS) if (!(f in r)) return false;
    if (typeof r.doc_id !== "string" || !r.doc_id) return false;
    if (typeof r.chunk_id !== "string" || !r.chunk_id) return false;
    if (typeof r.status !== "string" || !r.status) return false;
    if (typeof r.text !== "string") return false;
  }
  return true;
}

async function loadBuiltin() {
  if (_builtin) return _builtin;
  const raw = await readFile(BUILTIN_URL, "utf8");
  const parsed = JSON.parse(raw);
  if (!isValidKB(parsed)) {
    throw new Error("内置 KB 数据校验失败：应为 67 块且每块含全部 9 个字段");
  }
  _builtin = parsed;
  return parsed;
}

async function loadCloudCache() {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return isValidKB(parsed) ? parsed : null;
  } catch {
    return null; // 无缓存 / 缓存损坏 → 静默回退
  }
}

/** 把云端响应解析成数组：支持 JSON 数组 / {chunks:[...]} / {data:[...]} / JSONL。 */
function parseCloudPayload(text) {
  const t = (text || "").trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.chunks)) return j.chunks;
    if (j && Array.isArray(j.data)) return j.data;
  } catch {
    const out = [];
    for (const line of t.split(/\r?\n/)) {
      const ln = line.trim();
      if (!ln) continue;
      try { out.push(JSON.parse(ln)); } catch { return null; }
    }
    return out.length ? out : null;
  }
  return null;
}

async function fetchCloud() {
  let lastErr = "未知云端错误";
  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        headers: { Accept: "application/json, text/plain, */*" },
      });
      if (!res.ok) {
        lastErr = "HTTP " + res.status + " @ " + url;
        continue;
      }
      const parsed = parseCloudPayload(await res.text());
      if (parsed && isValidKB(parsed)) return parsed;
      lastErr = "响应不是合法的 67 块 KB 数据 @ " + url;
    } catch (e) {
      lastErr = url + " → " + (e && e.message ? e.message : String(e));
    }
  }
  throw new Error(lastErr);
}

async function writeCache(data) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * 始终返回 67 块完整对象数组（含全部 9 个字段），绝不因云端异常而阻塞或抛错。
 * 优先使用「已成功同步的本地云端缓存」，否则回退内置数据。
 */
export async function getKBData() {
  if (_active) return _active;
  const cached = await loadCloudCache();
  if (cached) {
    _active = cached;
    _source = "cloud";
  } else {
    _active = await loadBuiltin();
    _source = "builtin";
  }
  return _active;
}

/** 当前数据来源标记（"builtin" | "cloud"），便于诊断。 */
export function getKBSource() {
  return _source;
}

/**
 * 尝试从 ModelScope Dataset GrestestOptics/optics-kb 拉取数据。
 * 成功 → 写入本地缓存并标记来源 cloud；任何网络/解析失败 → 静默回退内置数据。
 * @param {boolean} [force=false] 为 true 时忽略「近期已成功」的短路，强制重新拉取。
 * @returns {Promise<{updated:boolean, source:string, error?:string}>}
 */
export async function syncFromCloud(force = false) {
  if (_inFlight) return _inFlight;
  if (!force && _lastSyncOk && (Date.now() - _lastSyncAt) < SYNC_TTL_MS) {
    return { updated: false, source: _source };
  }
  _inFlight = (async () => {
    try {
      const data = await fetchCloud();
      try { await writeCache(data); } catch { /* 写缓存失败不影响本次成功 */ }
      _active = data;
      _source = "cloud";
      _lastSyncOk = true;
      _lastSyncAt = Date.now();
      return { updated: true, source: "cloud" };
    } catch (e) {
      const err = e && e.message ? e.message : String(e);
      // 失败：静默回退内置数据，绝不阻塞 getKBData()
      try {
        _active = await loadBuiltin();
      } catch { /* 内置数据缺失时保留已有 _active */ }
      _source = "builtin";
      _lastSyncOk = false;
      _lastSyncAt = Date.now();
      return { updated: false, source: "builtin", error: err };
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}
