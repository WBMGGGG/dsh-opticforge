// OpticForge —— 交付物前置自检（不替代技术判断）
//
// 这是交付流水线的最后一道检查：文本结构、KB 引用、数量断言、KB-first 对齐段、
// 外部来源信息与公式卡计算轨迹。它不重新推导光学结论，也不判断物理结果正确。

import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MARKETING = ["零公差", "零缺陷", "绝对精度", "绝对完美", "完美无误差", "无懈可击", "永不漂移", "百分之百准确", "完美", "最佳", "全球领先", "世界领先", "顶级", "保证", "绝不", "唯一", "颠覆"];
const QUANTITY_RE = /\d+(?:\.\d+)?\s*(?:nm|µm|μm|mm|cm|m|km|ms|s|Hz|kHz|MHz|GHz|W|mW|dB|K|°|%|倍|像元|像素|lp\/mm|mrad|urad|μrad|lines\/mm|g\/mm)/g;
const SECTION_RE = {
  assumptions: /(?:^|\n)\s*#{1,6}\s*假设|(?:^|\n)假设[与和]?边界|(?:^|\n)\s*假设[:：]/,
  gaps: /(?:^|\n)\s*#{1,6}\s*(?:缺口|限制|风险)|(?:^|\n)(?:缺口|限制|风险)[与和]?|(?:^|\n)\s*(?:缺口|限制)[:：]/,
  reproduce: /复现|重跑|如何重复|计算过程|推导过程|复算|计算轨迹/,
};
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const ALIGNMENT_RE = /KB\s*对齐|知识库对齐|覆盖判定|coverage_matrix|kb_alignment/i;
const VERDICT_RE = /\b(?:covered|partial|gap)\b|已覆盖|部分覆盖|未覆盖/i;
const CALC_TRACE_RE = /计算轨迹|formula_id|公式卡|输入.{0,30}输出|复算过程/i;

let FORMULA_CARDS = [];
try {
  const parsed = JSON.parse(fs.readFileSync(new URL("../data/formula-cards.json", import.meta.url), "utf8"));
  FORMULA_CARDS = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cards) ? parsed.cards : []);
} catch {
  FORMULA_CARDS = [];
}
const FORMULA_IDS = new Set(FORMULA_CARDS.map((c) => c.id));

export function verifyText(text, chunks, options = {}) {
  const src = String(text || "");
  const known = new Map(chunks.map((c) => [String(c.chunk_id).toUpperCase(), c]));
  const issues = [];
  const add = (severity, type, message, evidence) => issues.push({ level: severity, severity, type, message, evidence });

  // ---------- 1. KB 引用核验：只接受 present ----------
  const refIds = new Set();
  for (const m of src.matchAll(/\b([A-I]\d{2}-\d{2})\b/g)) refIds.add(m[1].toUpperCase());
  // 引用只认具体 chunk_id；A03/C01/E01 这类板块名可出现在缺口说明中，不算引用。
  const cited = { total: refIds.size, valid: [], invalid: [] };
  for (const id of refIds) {
    const hit = known.get(id) || chunks.find((c) => c.doc_id === id);
    if (hit && hit.status === "present") cited.valid.push(id);
    else cited.invalid.push(id);
  }
  for (const id of cited.invalid) {
    const hit = known.get(id) || chunks.find((c) => c.doc_id === id);
    add(
      "error",
      "invalid_citation",
      hit ? `引用的 ${id} 存在但 status=${hit.status}，不能当 present 证据。` : `引用了知识库中不存在的 chunk_id：${id}。`,
      id
    );
  }

  // ---------- 2. 数量断言必须能落到 present 证据或假设/推导 ----------
  const sentences = src.split(/(?<=[。！？；!?;])\s*/).filter(Boolean);
  let quantityTotal = 0;
  let unsupported = 0;
  for (const s of sentences) {
    const quantities = s.match(QUANTITY_RE);
    if (!quantities) continue;
    quantityTotal += quantities.length;
    if (/=|≈|约|因此|所以|推导|计算|假设|设计目标|目标值|预算|取值|建议/.test(s)) continue;
    const ids = [...s.matchAll(/\b([A-I]\d{2}(?:-\d{2})?)\b/g)].map((m) => m[1].toUpperCase());
    const backed = ids.some((id) => cited.valid.includes(id));
    if (!backed) {
      unsupported += 1;
      add(options.strict ? "error" : "warning", "unsupported_quantity", "数量断言没有同句的 present KB 证据，也未标为计算/假设/设计目标。", s.trim().slice(0, 200));
    }
  }

  // ---------- 3. 结构与措辞 ----------
  for (const w of MARKETING) {
    if (src.includes(w)) add("warning", "marketing_word", `出现绝对化/营销措辞「${w}」。`, w);
  }
  const hasAssumption = SECTION_RE.assumptions.test(src) || /假设[:：]/.test(src);
  const hasGaps = SECTION_RE.gaps.test(src) || /缺口[:：]/.test(src);
  const hasReproduce = SECTION_RE.reproduce.test(src);
  if (!hasAssumption) add("warning", "missing_assumptions", "缺少「假设/边界」段。", "请单列模型假设、适用范围与不确定度。");
  if (!hasGaps) add("warning", "missing_gaps", "缺少「缺口/限制」段。", "请列出 missing_source、substitute 或待实测项。");
  if (!hasReproduce && quantityTotal > 0) add("warning", "missing_reproduce", "有数量结果但没有复现/计算过程。", "请给输入、公式、命令或复算路径。");

  // ---------- 4. P2：KB-first 对齐段 ----------
  const hasAlignment = ALIGNMENT_RE.test(src);
  const hasVerdict = VERDICT_RE.test(src);
  if (options.problem && !hasAlignment) {
    add(options.strict ? "error" : "warning", "missing_kb_alignment", "缺少「KB 对齐」段，无法审计是否先对齐知识库再执行。", "写明 coverage_matrix 的 covered/partial/gap、依据 chunk_id 与缺口。");
  }
  if (hasAlignment && !hasVerdict) {
    add(options.strict ? "error" : "warning", "missing_alignment_verdict", "KB 对齐段没有 covered / partial / gap 判定。", "补覆盖矩阵与 verdict。");
  }

  // ---------- 5. P2：外部来源必须带访问日期与来源细节 ----------
  const externalUrls = [...new Set((src.match(URL_RE) || []).map((u) => u.replace(/[.,;，。；)）\]]+$/g, "")))];
  const hasAccessDate = /(?:访问|检索|获取)日期|accessed|retrieved/i.test(src);
  const sourceTextWithoutUrls = src.replace(URL_RE, " ");
  const hasSourceDetail = /厂商|型号|标准号|白皮书|datasheet|manual|ISO\s*\d|IEC\s*\d|JJF\s*\d|GB\/?T?\s*\d/i.test(sourceTextWithoutUrls);
  if (externalUrls.length > 0 && !hasAccessDate) {
    add(options.strict ? "error" : "warning", "external_missing_date", "外部 URL 缺少访问/检索日期。", "为外部来源统一补「访问日期：YYYY-MM-DD」。");
  }
  if (externalUrls.length > 0 && !hasSourceDetail) {
    add(options.strict ? "error" : "warning", "external_missing_detail", "外部 URL 缺少厂商/型号/标准号等来源细节。", "至少写厂商或机构、文档标题，以及型号或标准号。");
  }
  if (externalUrls.length > 0 && cited.valid.length === 0 && !hasAlignment) {
    add(options.strict ? "error" : "warning", "external_without_kb", "使用了外部来源，但没有 KB 对齐或有效 KB 证据。", "先补 KB 对齐段；若确实无覆盖，明确标 gap 并解释联网理由。");
  }

  // ---------- 6. P1：公式卡与计算轨迹 ----------
  const usedFormulaIds = FORMULA_CARDS.filter((c) => c.id && src.includes(c.id)).map((c) => c.id);
  const labelledFormulaIds = [];
  for (const m of src.matchAll(/formula_id\s*["'`:：=\s]+([A-Za-z0-9_-]+)/gi)) labelledFormulaIds.push(m[1]);
  for (const id of labelledFormulaIds) {
    if (!FORMULA_IDS.has(id)) add("error", "invalid_formula_id", `formula_id 不在内置公式卡中：${id}。`, id);
  }
  const hasCalcTrace = CALC_TRACE_RE.test(src);
  const hasQuantities = new RegExp(QUANTITY_RE.source, "i").test(src);
  if (options.problem && hasQuantities && usedFormulaIds.length === 0) {
    add(options.strict ? "error" : "warning", "missing_formula_id", "有数值计算/指标，但没有可核验的公式卡 formula_id。", "从 assist.calc_specs 选卡，并在计算轨迹中写 formula_id。");
  }
  if (usedFormulaIds.length > 0 && !hasCalcTrace) {
    add(options.strict ? "error" : "warning", "missing_calc_trace", "引用了公式卡但没有计算轨迹。", "补输入、单位、假设、输出与复算路径。");
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const score = Math.max(0, 100 - errors.length * 18 - warnings.length * 6);
  return {
    ok: true,
    action: "verify",
    pass: errors.length === 0,
    score,
    stats: { chars: src.length, lines: src.split(/\r?\n/).length, numbers: quantityTotal },
    summary: `错误 ${errors.length}，警告 ${warnings.length}；KB 引用 ${cited.valid.length}/${cited.total} 有效；外部 URL ${externalUrls.length}；公式卡 ${usedFormulaIds.length}。`,
    citations: {
      ...cited,
      non_present: cited.invalid.filter((id) => {
        const hit = known.get(id) || chunks.find((c) => c.doc_id === id);
        return hit && hit.status !== "present";
      })
    },
    external_citations: {
      total: externalUrls.length,
      has_access_date: hasAccessDate,
      has_source_detail: hasSourceDetail,
    },
    alignment: { present: hasAlignment, verdict: hasVerdict },
    formula_cards: { used: usedFormulaIds, has_trace: hasCalcTrace },
    quantities: { total: quantityTotal, unsupported },
    issues,
    checklist: {
      citations_valid: cited.invalid.length === 0,
      quantities_supported: unsupported === 0,
      no_marketing_words: !issues.some((i) => i.type === "marketing_word"),
      assumptions_listed: hasAssumption,
      gaps_listed: hasGaps,
      reproduction_present: hasReproduce || quantityTotal === 0,
      kb_alignment: !options.problem || (hasAlignment && hasVerdict),
      external_citations_complete: externalUrls.length === 0 || (hasAccessDate && hasSourceDetail),
      formula_trace: !options.problem || !hasQuantities || (usedFormulaIds.length > 0 && hasCalcTrace),
      citations_resolvable: cited.total === 0 ? "no-citation" : cited.invalid.length === 0,
      quantities_sourced: unsupported === 0,
      assumptions_stated: hasAssumption,
      gaps_stated: hasGaps,
      reproducible: hasReproduce,
      sources_present: /来源|参考|引用|参考文献/.test(src) || cited.total > 0 || externalUrls.length > 0,
    },
  };
}

export function normalizeText(input) {
  return String(input || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
}

export async function readTextArgument(args, { maxChars = 200000 } = {}) {
  if (typeof args.text === "string" && args.text.trim()) {
    const t = normalizeText(args.text);
    if (t.length > maxChars) throw new Error(`text 超过 ${maxChars} 字符，请分段自检。`);
    return { text: t, source: "inline" };
  }
  if (typeof args.path === "string" && args.path.trim()) {
    const ext = path.extname(args.path).toLowerCase();
    if (ext === ".docx" || ext === ".pdf") {
      throw new Error("verify 不直接解析 docx/pdf。请先用 word/pdf Skill 导出 .md 或 .txt，再传导出文本；导出路径与原文路径一并写入交付记录。");
    }
    if (!fs.existsSync(args.path)) throw new Error("文件不存在：" + args.path);
    const st = fs.statSync(args.path);
    if (st.size > maxChars * 4) throw new Error(`文件过大（${st.size} bytes），请导出为文本并分段自检。`);
    const t = normalizeText(await readFile(args.path, "utf8"));
    if (t.length > maxChars) throw new Error(`文本超过 ${maxChars} 字符，请分段自检。`);
    return { text: t, source: path.resolve(args.path) };
  }
  throw new Error("必须提供 text 或 path（.md/.txt）之一。");
}

const TEXT_EXT = new Set([".md", ".txt", ".json", ".csv", ".html", ".xml", ".yaml", ".yml", ".js", ".mjs", ".ts", ".py", ".m", ".tex", ".log"]);

/** 兼容插件入口的路径自检；docx/pdf 明确引导先由对应 Skill 导出文本。 */
export async function verifyPath(filePath, chunks, options = {}) {
  const p = path.resolve(String(filePath || ""));
  let st;
  try { st = fs.statSync(p); } catch { return { ok: false, action: "verify", error: "文件不存在：" + p }; }
  if (!st.isFile()) return { ok: false, action: "verify", error: "不是文件：" + p };
  const ext = path.extname(p).toLowerCase();
  if (!TEXT_EXT.has(ext)) {
    const hint = ext === ".docx" || ext === ".pdf"
      ? "请先用 word/pdf Skill 导出为 .md 或 .txt，再把导出文本交给 verify"
      : "请先导出为 .md/.txt 再自检，或把正文作为 text 传入";
    return { ok: false, action: "verify", path: p, error: "不支持直接解析 " + ext + "；" + hint, supported_extensions: [...TEXT_EXT] };
  }
  if (st.size > 2 * 1024 * 1024) return { ok: false, action: "verify", path: p, error: "文件超过 2 MB，请截取关键章节后再自检" };
  try {
    const text = await readFile(p, "utf8");
    return { ...verifyText(text, chunks, options), path: p, bytes: st.size };
  } catch (err) {
    return { ok: false, action: "verify", path: p, error: "读取失败：" + (err && err.message ? err.message : String(err)) };
  }
}
