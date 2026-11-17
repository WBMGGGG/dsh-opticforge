// 知识库构建与校验：data/kb/*.json → data/kb-data.json + data/kb-meta.json
//
// 用法：
//   node scripts/build-kb.mjs --doc F01     只校验单个板块（写作时自检）
//   node scripts/build-kb.mjs --all         校验全部并生成 kb-data.json / kb-meta.json
//   node scripts/build-kb.mjs --check       校验已生成产物与分部文件一致（CI 用）
//
// 两类板块，两套校验：
//   A–E（原文型）：chunk_id 集合必须与 _kb-raw/<doc>.json 完全一致；数字逐字回查原文。
//   F/G/H（编译型）：无原文层，按 docs/KB-OUTLINE.zh.md 的顺序编号；正文 ≥300 字、
//                    字段行 ≥3 条；不做数字回查（来源是教材通用结论，不是单一文本）。
 //
// 公共校验：9 字段齐全、doc_id 一致、present 条目以【开头、is_original_excerpt=false、无营销词。

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KB_DIR = join(ROOT, "data", "kb");
const RAW_DIR = join(ROOT, "_kb-raw");
const OUT_DATA = join(ROOT, "data", "kb-data.json");
const OUT_META = join(ROOT, "data", "kb-meta.json");

const FIELDS = ["doc_id", "chunk_id", "status", "is_original_excerpt", "text", "source", "page_or_section", "keywords_zh", "disclaimer"];
const MARKETING = ["low cost", "high performance", "best in class", "领先", "优异", "完美", "最佳选择"];
const COMPILED_SERIES = new Set(["F", "G", "H", "I"]);

// 编译型板块的下限：比原文型更严，因为读者拿不到原文可核对。
const COMPILED_MIN_LEN = 300;
const COMPILED_MIN_FIELDS = 3;

// 知识空白：只列真正没有覆盖、且维护者确认不再补充的主题。命中且正文确实无依据时才短路。
const DEFAULT_TOPICS = ["光刻工艺", "空间光学"];
const DEFAULT_ANCHORS = [
  "共焦色散", "共焦", "色散", "IFS2402", "IFS", "RCWA", "光栅", "衍射效率",
  "镀膜", "膜系", "热漂移", "dn/dT", "公差分析", "Monte Carlo", "RSS", "均方根", "公差分配",
  "photodiode", "光电二极管", "数值孔径", "Airy", "Rayleigh", "线性度", "量程", "分辨率",
  "几何光学", "像差", "MTF", "偏振", "激光", "高斯光束", "薄膜", "探测器", "噪声",
  "高光谱", "波导", "量子", "超表面", "白光干涉", "定标", "装调", "可靠性",
  "红外", "无热化", "光纤传感", "OCT", "增强现实", "信号链", "不确定度",
  "杂散光", "鬼像", "推扫", "分光", "光谱仪", "相机", "照明",
];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : null;
};

const loadJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const numTokens = (text) => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
const isCompiled = (docId) => COMPILED_SERIES.has(String(docId).charAt(0));

function validateRawDoc(docId, entries, rawChunks) {
  const issues = [];
  const rawIds = rawChunks.map((c) => c.chunk_id);
  const gotIds = entries.map((e) => e.chunk_id);
  const missing = rawIds.filter((id) => !gotIds.includes(id));
  const extra = gotIds.filter((id) => !rawIds.includes(id));
  if (missing.length) issues.push(`缺少 chunk：${missing.join(", ")}`);
  if (extra.length) issues.push(`多出未知 chunk：${extra.join(", ")}`);
  return issues;
}

function validateCompiledDoc(docId, entries) {
  const issues = [];
  const gotIds = entries.map((e) => e.chunk_id);
  const expect = [];
  for (let i = 1; i <= entries.length; i++) expect.push(`${docId}-${String(i).padStart(2, "0")}`);
  if (new Set(gotIds).size !== gotIds.length) issues.push("chunk_id 有重复");
  const notInOrder = gotIds.filter((id, i) => id !== expect[i]);
  if (notInOrder.length) issues.push(`chunk_id 未按顺序编号（应为 ${expect[0]} … ${expect[expect.length - 1]}，异常：${notInOrder.join(", ")}）`);
  return issues;
}

function validateEntries(docId, entries, rawChunks) {
  const issues = [];
  const compiled = isCompiled(docId);

  for (const e of entries) {
    const tag = `${docId}/${e.chunk_id}`;
    for (const f of FIELDS) if (!(f in e)) issues.push(`${tag} 缺字段 ${f}`);
    if (e.doc_id !== docId) issues.push(`${tag} doc_id 不一致：${e.doc_id}`);
    const minLen = compiled ? COMPILED_MIN_LEN : 120;
    if (e.status !== "present") {
      if (compiled) issues.push(`${tag} 编译型板块不应出现非 present 条目`);
      continue;
    }
    const text = String(e.text || "");
    if (!text.startsWith("【")) issues.push(`${tag} text 未以【标题】开头`);
    if (text.length < minLen) issues.push(`${tag} text 过短（${text.length} < ${minLen}）`);
    if (!compiled && text.length > 2000) console.log(`  ~ ${tag} 较长（${text.length} 字），可考虑按语义拆条，但不影响校验`);
    if (e.is_original_excerpt !== false) issues.push(`${tag} is_original_excerpt 应为 false`);
    for (const w of MARKETING) if (text.toLowerCase().includes(w.toLowerCase())) issues.push(`${tag} 含营销词「${w}」`);

    if (compiled) {
      const fieldLines = text.split("\n").filter((l) => /^[\u4e00-\u9fa5A-Za-z]{2,12}：/.test(l.trim()));
      if (fieldLines.length < COMPILED_MIN_FIELDS) issues.push(`${tag} 字段行不足（${fieldLines.length} < ${COMPILED_MIN_FIELDS}）`);
      if (!String(e.source || "").trim()) issues.push(`${tag} source 为空`);
      if (!String(e.page_or_section || "").trim()) issues.push(`${tag} page_or_section 为空`);
      const kw = String(e.keywords_zh || "").split(/[,，]/).filter(Boolean);
      if (kw.length < 4) issues.push(`${tag} keywords_zh 少于 4 个`);
      if (!String(e.disclaimer || "").includes("非原文摘录")) issues.push(`${tag} disclaimer 需注明「非原文摘录」`);
    } else if (rawChunks.length) {
      const raw = rawChunks.find((x) => x.chunk_id === e.chunk_id);
      const rawText = raw && typeof raw.text === "string" ? raw.text : "";
      const bad = numTokens(text).filter((n) => !rawText.includes(n));
      if (bad.length) issues.push(`${tag} 这些数字在原文里找不到：${[...new Set(bad)].join(", ")}`);
    }
  }

  return issues;
}

async function docList() {
  const files = (await readdir(KB_DIR)).filter((f) => /^[A-Z]\d{2}\.json$/.test(f));
  return files.map((f) => f.slice(0, 3)).sort();
}

async function main() {
  const onlyDoc = flag("--doc");
  const all = flag("--all");
  const checkOnly = flag("--check");
  const versionArg = flag("--version");

  if (checkOnly) {
    const data = await loadJson(OUT_DATA);
    const meta = await loadJson(OUT_META);
    const issues = [];
    const docs = await docList();
    const parts = [];
    for (const d of docs) parts.push(...(await loadJson(join(KB_DIR, `${d}.json`))));
    parts.sort((a, b) => (a.doc_id + a.chunk_id).localeCompare(b.doc_id + b.chunk_id));
    if (JSON.stringify(parts) !== JSON.stringify(data)) issues.push("kb-data.json 与 data/kb/*.json 合并结果不一致（先跑 --all）");
    const present = data.filter((c) => c.status === "present").length;
    if (meta.total_chunks !== data.length) issues.push(`meta.total_chunks ${meta.total_chunks} ≠ ${data.length}`);
    if (meta.present_chunks !== present) issues.push(`meta.present_chunks ${meta.present_chunks} ≠ ${present}`);
    const sha = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    if (meta.content_sha256 !== sha) issues.push("meta.content_sha256 与数据不一致");
    for (const c of data) for (const f of FIELDS) if (!(f in c)) issues.push(`${c.chunk_id} 缺字段 ${f}`);
    if (issues.length) {
      console.error("FAIL\n" + issues.join("\n"));
      process.exit(1);
    }
    console.log(`OK  ${data.length} 块 / present ${present} / ${meta.kb_version}`);
    return;
  }

  const docs = onlyDoc ? [onlyDoc] : await docList();
  let totalIssues = 0;
  const merged = [];

  for (const docId of docs) {
    const partPath = join(KB_DIR, `${docId}.json`);
    if (!existsSync(partPath)) {
      console.log(`${docId}: 未提供 data/kb/${docId}.json，跳过`);
      continue;
    }
    const entries = await loadJson(partPath);
    const compiled = isCompiled(docId);
    const raw = compiled ? [] : (existsSync(join(RAW_DIR, `${docId}.json`)) ? await loadJson(join(RAW_DIR, `${docId}.json`)) : []);
    const issues = [
      ...(compiled ? validateCompiledDoc(docId, entries) : validateRawDoc(docId, entries, raw)),
      ...validateEntries(docId, entries, raw),
    ];
    const present = entries.filter((e) => e.status === "present").length;
    const chars = entries.filter((e) => e.status === "present").reduce((a, e) => a + e.text.length, 0);
    console.log(`${docId}: ${entries.length} 块 (present ${present}) ${chars} 字符${compiled ? " [编译型]" : raw.length ? "" : " [无原文层，数字校验跳过]"}`);
    for (const i of issues) console.log("  ! " + i);
    totalIssues += issues.length;
    if (all) merged.push(...entries);
  }

  if (totalIssues) {
    console.error(`\nFAIL  共 ${totalIssues} 个问题`);
    process.exit(1);
  }

  if (all) {
    merged.sort((a, b) => (a.doc_id + a.chunk_id).localeCompare(b.doc_id + b.chunk_id));
    const present = merged.filter((c) => c.status === "present").length;
    const body = JSON.stringify(merged);
    const sha = createHash("sha256").update(body).digest("hex");
    await writeFile(OUT_DATA, JSON.stringify(merged, null, 2) + "\n", "utf8");

    let prev = {};
    if (existsSync(OUT_META)) {
      try { prev = await loadJson(OUT_META); } catch { prev = {}; }
    }
    const version = typeof versionArg === "string" ? versionArg : (prev.kb_version || "0.0.0");
    const meta = {
      kb_version: version,
      built_at: new Date().toISOString(),
      content_sha256: sha,
      total_chunks: merged.length,
      present_chunks: present,
      docs: merged.reduce((acc, c) => {
        let d = acc.find((x) => x.doc_id === c.doc_id);
        if (!d) {
          d = { doc_id: c.doc_id, chunks: 0, present: 0, source: c.source };
          acc.push(d);
        }
        d.chunks += 1;
        if (c.status === "present") d.present += 1;
        return acc;
      }, []),
      zero_coverage_topics: Array.isArray(prev.zero_coverage_topics) ? prev.zero_coverage_topics : DEFAULT_TOPICS,
      covered_anchors: Array.isArray(prev.covered_anchors) ? prev.covered_anchors : DEFAULT_ANCHORS,
    };
    await writeFile(OUT_META, JSON.stringify(meta, null, 2) + "\n", "utf8");
    console.log(`\nOK  已写出 data/kb-data.json（${merged.length} 块 / present ${present}，sha256 ${sha.slice(0, 12)}…）`);
    console.log(`OK  已写出 data/kb-meta.json（version ${meta.kb_version}）`);

    // L2 概念卡随 KB 一起重建，保证 kb_version 与来源一致
    const { buildConceptCards } = await import(new URL("./build-concept-cards.mjs", import.meta.url).href);
    const { payload } = await buildConceptCards({ kbVersion: meta.kb_version });
    await writeFile(join(ROOT, "data", "concept-cards.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log(`OK  已写出 data/concept-cards.json（${payload.card_count} 张 / kb_version ${payload.kb_version}）`);
  } else {
    console.log(`\nOK  ${docs.join(", ")} 校验通过`);
  }
}

main().catch((e) => {
  console.error("ERROR " + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
