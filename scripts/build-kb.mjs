// 知识库构建与校验：data/kb/*.json → data/kb-data.json + data/kb-meta.json
//
// 用法：
//   node scripts/build-kb.mjs --doc A01     只校验单个板块（改写时自检）
//   node scripts/build-kb.mjs --all         校验全部并生成 kb-data.json / kb-meta.json
//   node scripts/build-kb.mjs --check       只校验已生成产物的一致性（CI 用，不需要 _kb-raw）
//
// 校验项：
//   1. chunk_id 集合与 _kb-raw 原文完全一致（引用锚点不可漂移）
//   2. 9 个字段齐全、类型正确
//   3. present 条目 text 以【开头、长度 ≥120（不设上限：完整性优先于字数）
//   4. 数字校验：text 里每个数字都必须能在同 chunk 原文中逐字找到（防编造）
//   5. 营销词黑名单
//
// _kb-raw/ 是私有原文层（.gitignore），缺失时数字校验自动跳过并明确提示。

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

const DOCS = ["A01", "A02", "A03", "B01", "B02", "C01", "C02", "D01", "E01"];
const FIELDS = ["doc_id", "chunk_id", "status", "is_original_excerpt", "text", "source", "page_or_section", "keywords_zh", "disclaimer"];
const MARKETING = ["low cost", "high performance", "best in class", "领先", "优异", "完美", "最佳选择"];
const EXPECTED = { total: 67, present: 51 };

const DEFAULT_TOPICS = [
  "量子计算", "量子信息", "量子光学", "量子比特",
  "COMSOL", "SolidWorks",
  "图像处理", "缺陷检测",
  "热光学", "无热化", "热稳定",
  "多物理场", "波动光学", "工程图",
  "衍射光波导", "光波导", "光子集成", "白光干涉",
  "非球面", "自由曲面",
  "光谱定标", "辐射度学", "黑体", "红外测温", "信号解调", "光谱与信号解调",
  "激光三角", "光学测厚", "光机结构",
  "不确定度", "公差链",
  "物理光学", "光学检测",
];

const DEFAULT_ANCHORS = [
  "共焦色散", "共焦", "色散", "IFS2402", "IFS",
  "RCWA", "光栅", "衍射效率",
  "镀膜", "膜系", "热漂移", "dn/dT",
  "公差分析", "Monte Carlo", "RSS", "均方根", "公差分配",
  "photodiode", "光电二极管",
  "数值孔径", "Airy", "Rayleigh",
  "线性度", "量程", "分辨率",
];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : null;
};

async function loadJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

function numTokens(text) {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

function rawTextOf(rawChunks, chunkId) {
  const c = rawChunks.find((x) => x.chunk_id === chunkId);
  return c && typeof c.text === "string" ? c.text : "";
}

function validateDoc(docId, entries, rawChunks) {
  const issues = [];
  const rawIds = rawChunks.map((c) => c.chunk_id);
  const gotIds = entries.map((e) => e.chunk_id);

  const missing = rawIds.filter((id) => !gotIds.includes(id));
  const extra = gotIds.filter((id) => !rawIds.includes(id));
  if (missing.length) issues.push(`缺少 chunk：${missing.join(", ")}`);
  if (extra.length) issues.push(`多出未知 chunk：${extra.join(", ")}`);
  if (new Set(gotIds).size !== gotIds.length) issues.push("chunk_id 有重复");

  for (const e of entries) {
    const tag = `${docId}/${e.chunk_id}`;
    for (const f of FIELDS) {
      if (!(f in e)) issues.push(`${tag} 缺字段 ${f}`);
    }
    if (e.doc_id !== docId) issues.push(`${tag} doc_id 不一致：${e.doc_id}`);
    if (e.status !== "present") continue;

    const text = String(e.text || "");
    if (!text.startsWith("【")) issues.push(`${tag} text 未以【标题】开头`);
    if (text.length < 120) issues.push(`${tag} text 过短（${text.length} < 120）`);
    // 不设上限：知识库的价值在完整性，压字数会逼着删事实。
    // 只提示「过长可考虑按语义拆条」，不作为失败条件。
    if (text.length > 2000) console.log(`  ~ ${tag} 较长（${text.length} 字），可考虑按语义拆条，但不影响校验`);
    if (e.is_original_excerpt !== false) issues.push(`${tag} is_original_excerpt 应为 false`);

    for (const w of MARKETING) {
      if (text.toLowerCase().includes(w.toLowerCase())) issues.push(`${tag} 含营销词「${w}」`);
    }

    if (!rawChunks.length) continue;
    const raw = rawTextOf(rawChunks, e.chunk_id);
    const bad = numTokens(text).filter((n) => !raw.includes(n));
    if (bad.length) issues.push(`${tag} 这些数字在原文里找不到：${[...new Set(bad)].join(", ")}`);
  }

  return issues;
}

async function readDoc(docId) {
  return loadJson(join(KB_DIR, `${docId}.json`));
}

async function readRaw(docId) {
  const p = join(RAW_DIR, `${docId}.json`);
  return existsSync(p) ? loadJson(p) : [];
}

async function main() {
  const onlyDoc = flag("--doc");
  const all = flag("--all");
  const checkOnly = flag("--check");
  const versionArg = flag("--version");

  if (checkOnly) {
    const data = await loadJson(OUT_DATA);
    const present = data.filter((c) => c.status === "present").length;
    const issues = [];
    if (data.length !== EXPECTED.total) issues.push(`总块数 ${data.length} ≠ ${EXPECTED.total}`);
    if (present !== EXPECTED.present) issues.push(`present ${present} ≠ ${EXPECTED.present}`);
    for (const c of data) for (const f of FIELDS) if (!(f in c)) issues.push(`${c.chunk_id} 缺字段 ${f}`);
    if (issues.length) {
      console.error("FAIL\n" + issues.join("\n"));
      process.exit(1);
    }
    console.log(`OK  ${data.length} 块 / present ${present}`);
    return;
  }

  const docs = onlyDoc ? [onlyDoc] : DOCS;
  let totalIssues = 0;
  const merged = [];

  for (const docId of docs) {
    if (!existsSync(join(KB_DIR, `${docId}.json`))) {
      if (onlyDoc || all) console.log(`${docId}: 未提供 data/kb/${docId}.json，跳过`);
      continue;
    }
    const entries = await readDoc(docId);
    const raw = await readRaw(docId);
    const issues = validateDoc(docId, entries, raw);
    const present = entries.filter((e) => e.status === "present").length;
    const digits = entries.filter((e) => e.status === "present").reduce((a, e) => a + e.text.length, 0);
    console.log(`${docId}: ${entries.length} 块 (present ${present}) ${digits} 字符${raw.length ? "" : " [无原文层，数字校验跳过]"}`);
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
    if (merged.length !== EXPECTED.total) throw new Error(`总块数 ${merged.length} ≠ ${EXPECTED.total}（板块还没补齐？）`);
    if (present !== EXPECTED.present) throw new Error(`present ${present} ≠ ${EXPECTED.present}`);

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
  } else {
    console.log(`\nOK  ${docs.join(", ")} 校验通过`);
  }
}

main().catch((e) => {
  console.error("ERROR " + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
