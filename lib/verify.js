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

// 采信闸门用的词表：一手源优先，二手源降级，未标等级要提示。
const PRIMARY_MARKERS = /datasheet|规格书|manual|手册|白皮书|标准原文|标准号|ISO\s*\d|IEC\s*\d|JJF\s*\d|GB\/?T|厂商|原厂|官方|论文|doi|专利|检定证书/i;
const SECONDARY_MARKERS = /博客|论坛|知乎|公众号|自媒体|百科|CSDN|medium|reddit|quora|stackoverflow|wikipedia|转载|聚合/i;
const CONFLICT_MARKER = /与\s*KB\s*冲突|与知识库冲突|conflict_with_kb/i;
const RELATION_MARKER = /约束|决定|依赖|耦合|协调|取舍|折中|矛盾|同时|一致/;
const STALE_SCOPE_RE = /价格|报价|交期|供货|现货|型号|标准|版本|最新/i;

let FORMULA_CARDS = [];
try {
  const parsed = JSON.parse(fs.readFileSync(new URL("../data/formula-cards.json", import.meta.url), "utf8"));
  FORMULA_CARDS = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cards) ? parsed.cards : []);
} catch {
  FORMULA_CARDS = [];
}
const FORMULA_IDS = new Set(FORMULA_CARDS.map((c) => c.id));

/** 维度入参归一：支持字符串或 assist 的 dimension 行。 */
function normalizeDimensions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((d) => {
      if (typeof d === "string") return { id: d, label: d, status: null };
      if (!d || typeof d !== "object") return null;
      const label = String(d.label || d.id || "").trim();
      if (!label) return null;
      return { id: String(d.id || label), label, status: d.status || null };
    })
    .filter(Boolean);
}

function windowAround(src, index, before = 240, after = 700) {
  return src.slice(Math.max(0, index - before), Math.min(src.length, index + after));
}

/** 取包含该位置的段落（空行分段，够长时退到句段）。 */
function paragraphAt(src, index) {
  const start = src.lastIndexOf("\n\n", index);
  const end = src.indexOf("\n\n", index);
  return src.slice(start >= 0 ? start + 2 : 0, end >= 0 ? end : src.length);
}

const PRESENTATION_SECTIONS = [
  { id: "conclusion", label: "结论", re: /^(?:[①②③④⑤]\s*)?(?:[0-9]+[.、]\s*)?结论/ },
  { id: "severity", label: "严重性", re: /^(?:[①②③④⑤]\s*)?(?:[0-9]+[.、]\s*)?(?:严重性|影响|工况|风险等级)/ },
  { id: "branch", label: "分流", re: /^(?:[①②③④⑤]\s*)?(?:[0-9]+[.、]\s*)?(?:分流|判据|分叉|分流判断)/ },
  { id: "routes", label: "路线", re: /^(?:[①②③④⑤]\s*)?(?:[0-9]+[.、]\s*)?(?:路线|方案建议|推荐方案)/ },
  { id: "verification", label: "验证", re: /^(?:[①②③④⑤]\s*)?(?:[0-9]+[.、]\s*)?(?:验证|待补|定案)/ }
];

function presentationHits(src) {
  const hits = {};
  let offset = 0;
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s+/.test(trimmed) || /^[①②③④⑤]/.test(trimmed);
    if (isHeading) {
      const title = trimmed.replace(/^#{1,6}\s+/, "").trim();
      for (const s of PRESENTATION_SECTIONS) {
        if (!hits[s.id] && s.re.test(title)) hits[s.id] = { index: offset, title };
      }
    }
    offset += line.length + 1;
  }
  return hits;
}

function countMarkdownTables(src) {
  return (src.match(/(?:^|\n)\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*(?:\n|$)/g) || []).length;
}

function presentationCheck(src) {
  const hits = presentationHits(src);
  const sections = Object.fromEntries(PRESENTATION_SECTIONS.map((s) => [s.id, Boolean(hits[s.id])]));
  const missing = PRESENTATION_SECTIONS.filter((s) => !sections[s.id]).map((s) => s.label);
  const body = src;
  const internalFields = ["alignment", "web_gate", "source_matrix", "coverage_matrix", "blocked_by", "active_playbooks", "board_map", "source_board"];
  const internalHits = internalFields.filter((f) => new RegExp("\\b" + f + "\\b", "i").test(body));
  const chunkOutside = /\bchunk_id\b/i.test(body);
  const layerCodeHits = [...body.matchAll(/\b(?:[A-I]\d{2}(?:-\d{2})?|(?:IM|QE|MT|DT|TF|EL|DS|AL)\d{2})\b/g)].map((m) => m[0]);
  const tableCount = countMarkdownTables(src);
  const pendingRe = /待补|需补|定案需/g;
  const pending = [...src.matchAll(pendingRe)];
  const finalStart = hits.verification?.index ?? Number.POSITIVE_INFINITY;
  const pendingBeforeFinal = pending.some((m) => m.index < finalStart);
  return {
    applicable: false,
    pass: true,
    sections,
    missing_sections: missing,
    table_count: tableCount,
    max_tables: 3,
    internal_field_hits: internalHits,
    chunk_id_in_body: chunkOutside,
    layer_code_hits: layerCodeHits,
    pending_params_before_final: pendingBeforeFinal,
    pending_params_count: pending.length,
    rules: [
      "五段齐：结论/严重性/分流/路线/验证",
      "全文表格≤3",
      "正文不出现内部字段名",
      "正文不出现 chunk_id、源板块编号或域/族编码",
      "待补参数只在第⑤段出现，且≤4个"
    ]
  };
}

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

  // ---------- 7. 交叉契约：维度齐全、每面有据、耦合一致 ----------
  const dims = normalizeDimensions(options.dimensions);
  const dimRows = [];
  let dimsMissing = 0;
  let dimsUnevidenced = 0;
  for (const d of dims) {
    const labelIdx = src.indexOf(d.label);
    const idIdx = d.id !== d.label ? src.indexOf(d.id) : -1;
    const idx = labelIdx >= 0 ? labelIdx : idIdx;
    if (idx < 0) {
      dimsMissing += 1;
      add(options.strict ? "error" : "warning", "missing_dimension", `交付物没有回答必答维度「${d.label}」（${d.id}）。`, d.id);
      dimRows.push({ id: d.id, label: d.label, found: false, evidenced: false });
      continue;
    }
    const win = windowAround(src, idx);
    const hasChunk = /\b[A-I]\d{2}-\d{2}\b/.test(win);
    const hasUrl = /https?:\/\//i.test(win);
    if (!hasChunk && !hasUrl) {
      dimsUnevidenced += 1;
      add(options.strict ? "error" : "warning", "dimension_without_evidence", `维度「${d.label}」附近没有 chunk_id 或 URL，属于无据结论。`, d.label);
    }
    dimRows.push({ id: d.id, label: d.label, found: true, evidenced: hasChunk || hasUrl, chunk: hasChunk, web: hasUrl });
  }

  const rels = Array.isArray(options.relations) ? options.relations : [];
  let relMissing = 0;
  let relUnstated = 0;
  for (const r of rels) {
    const byId = new Map(dims.map((d) => [d.id, d.label]));
    const fromLabel = byId.get(r.from) || String(r.from || "");
    const toLabel = byId.get(r.to) || String(r.to || "");
    if (!fromLabel || !toLabel) continue;
    if (!src.includes(fromLabel) || !src.includes(toLabel)) {
      relMissing += 1;
      add(options.strict ? "error" : "warning", "relation_not_reflected", `交叉关系两端没有同时出现：「${fromLabel}」↔「${toLabel}」。`, `${r.from}->${r.to}`);
      continue;
    }
    const i1 = src.indexOf(fromLabel);
    const i2 = src.indexOf(toLabel);
    const between = src.slice(Math.min(i1, i2), Math.max(i1, i2) + 220);
    if (!RELATION_MARKER.test(between)) {
      relUnstated += 1;
      add(options.strict ? "error" : "warning", "relation_not_stated", `交叉关系「${fromLabel}」↔「${toLabel}」没有写出约束/取舍关系。`, r.note || r.type || "");
    }
  }

  // ---------- 8. 采信闸门：来源分级 / 多源交叉 / KB 冲突 / 时效 ----------
  const paragraphs = src.split(/\n{2,}/).filter((p) => p.trim());
  const external = [];
  for (const url of externalUrls) {
    const idx = src.indexOf(url);
    const ctx = idx >= 0 ? (paragraphAt(src, idx) || "") : "";
    let tier = "unknown";
    if (SECONDARY_MARKERS.test(ctx)) tier = "untrusted";
    else if (PRIMARY_MARKERS.test(ctx)) tier = "primary";
    external.push({ url, tier, ctx });
  }
  const tierCounts = { total: external.length, primary: 0, secondary: 0, unknown: 0, untrusted: 0 };
  for (const e of external) {
    if (e.tier === "primary") tierCounts.primary += 1;
    else if (e.tier === "untrusted") { tierCounts.untrusted += 1; tierCounts.secondary += 1; }
    else tierCounts.unknown += 1;
  }
  if (tierCounts.unknown > 0) {
    add(options.strict ? "error" : "warning", "external_source_tier", `有 ${tierCounts.unknown} 条外部来源未标来源等级（一手源/二手源）。`, "在 URL 旁写「一手源：厂商 datasheet/标准原文/论文」或「二手源：博客/百科」。");
  }
  if (tierCounts.untrusted > 0) {
    add("warning", "external_untrusted_source", `有 ${tierCounts.untrusted} 条外部来源属于二手/不可追溯渠道，不能单独支撑关键结论。`, external.filter((e) => e.tier === "untrusted").map((e) => e.url).slice(0, 5));
  }

  let keyValues = 0;
  let corroborated = 0;
  const singleSource = [];
  for (const p of paragraphs) {
    if (!/https?:\/\//i.test(p)) continue;
    const nums = p.match(QUANTITY_RE) || [];
    if (!nums.length) continue;
    keyValues += 1;
    const urls = p.match(URL_RE) || [];
    if (urls.length >= 2 || /单源待核|单源/.test(p)) corroborated += 1;
    else singleSource.push(p.trim().slice(0, 160));
  }
  if (singleSource.length) {
    add(options.strict ? "error" : "warning", "external_single_source", `有 ${singleSource.length} 处关键数值只有单一外部来源，未标「单源待核」。`, singleSource.slice(0, 3));
  }

  let conflictDeclared = 0;
  let conflictUndeclared = 0;
  for (const p of paragraphs) {
    if (!/\b[A-I]\d{2}-\d{2}\b/.test(p) || !/https?:\/\//i.test(p)) continue;
    if (CONFLICT_MARKER.test(p)) { conflictDeclared += 1; continue; }
    if (/冲突/.test(p)) {
      conflictUndeclared += 1;
      add(options.strict ? "error" : "warning", "conflict_not_labelled", "写了「冲突」但没有 conflict_with_kb 标签，无法机器核对采信口径。", p.trim().slice(0, 140));
      continue;
    }
    if (!/一致|不冲突|差异|口径不同|以.*为准/.test(p)) {
      conflictUndeclared += 1;
      add(options.strict ? "error" : "warning", "conflict_with_kb_unstated", "同段混用了 KB 引用与外部 URL，但没有说明两者是一致、差异还是以谁为准。", p.trim().slice(0, 140));
    }
  }

  const now = options.now ? new Date(options.now) : new Date();
  let staleChecked = 0;
  const stale = [];
  for (const e of external) {
    const idx = src.indexOf(e.url);
    const p = idx >= 0 ? (paragraphAt(src, idx) || "") : e.ctx;
    const dates = [...p.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)];
    if (!dates.length) continue;
    staleChecked += 1;
    const d = new Date(dates[0][0] + "T00:00:00Z");
    if (STALE_SCOPE_RE.test(p) && (now - d) / 86400000 > 30) stale.push(e.url);
  }
  if (stale.length) {
    add(options.strict ? "error" : "warning", "external_stale", `有 ${stale.length} 条外部来源的访问日期超过 30 天，涉及价格/型号/标准版本等时效内容。`, stale.slice(0, 5));
  }

  const adoptionPass = !issues.some((i) => /^(external_source_tier|external_single_source|external_stale|conflict_not_labelled|conflict_with_kb_unstated|external_untrusted_source)$/.test(i.type));

  // ---------- L4 呈现检查：只在文本已经带五段标记（或显式要求）时启用 ----------
  const presentation = presentationCheck(src);
  const detectedSections = Object.values(presentation.sections).filter(Boolean).length;
  presentation.applicable = options.presentation === true || detectedSections >= 3;
  if (presentation.applicable) {
    if (presentation.missing_sections.length) {
      add("error", "presentation_section_missing", "交付正文缺五段中的 " + presentation.missing_sections.join("、") + "；按 report_outline 补齐后再交付。", presentation.missing_sections);
    }
    if (presentation.table_count > presentation.max_tables) {
      add("error", "presentation_table_overload", `正文有 ${presentation.table_count} 张表，超过上限 ${presentation.max_tables}；拆表或只留决策量。`, presentation.table_count);
    }
    if (presentation.internal_field_hits.length) {
      add("error", "presentation_internal_field", "正文出现内部字段名：" + presentation.internal_field_hits.join("、") + "；改成用户能读的表述。", presentation.internal_field_hits);
    }
    if (presentation.chunk_id_in_body) {
      add("error", "presentation_chunk_id_in_body", "chunk_id 不能出现在正文；正文只写来源名称，不写条目编号。", "chunk_id");
    }
    if (presentation.layer_code_hits.length) {
      add("error", "presentation_layer_code", "正文出现知识库层级/条目编号：" + [...new Set(presentation.layer_code_hits)].join("、") + "；改成文献、标准或手册名称。", [...new Set(presentation.layer_code_hits)]);
    }
    if (presentation.pending_params_before_final) {
      add("warning", "presentation_open_params_early", "待补参数在第⑤段之前出现；统一挪到「验证与待补」，只出现一次。", "待补参数位置");
    }
    if (presentation.pending_params_count > 4) {
      add("warning", "presentation_open_params_overload", `待补参数出现 ${presentation.pending_params_count} 次，超过 4 个；只留真正影响定案的。`, presentation.pending_params_count);
    }
  }
  presentation.pass = !issues.some((i) => i.type.startsWith("presentation_") && i.severity === "error");

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const score = Math.max(0, 100 - errors.length * 18 - warnings.length * 6);
  return {
    ok: true,
    action: "verify",
    pass: errors.length === 0,
    score,
    stats: { chars: src.length, lines: src.split(/\r?\n/).length, numbers: quantityTotal },
    summary: `错误 ${errors.length}，警告 ${warnings.length}；KB 引用 ${cited.valid.length}/${cited.total} 有效；外部 URL ${externalUrls.length}；公式卡 ${usedFormulaIds.length}；维度 ${dims.length - dimsMissing}/${dims.length} 覆盖；采信 ${adoptionPass ? "通过" : "未通过"}；呈现 ${presentation.applicable ? (presentation.pass ? "通过" : "未通过") : "不适用"}。`,
    presentation,
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
    dimensions: {
      total: dims.length,
      covered: dims.length - dimsMissing,
      missing: dimsMissing,
      unevidenced: dimsUnevidenced,
      coupling_missing: relMissing,
      coupling_unstated: relUnstated,
      rows: dimRows
    },
    adoption: {
      external_source_tier: tierCounts,
      corroborated: { key_values: keyValues, corroborated, single_source: singleSource.length },
      conflict_with_kb: { declared: conflictDeclared, undeclared: conflictUndeclared },
      stale: { checked: staleChecked, stale: stale.length },
      pass: adoptionPass
    },
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
      dimensions_complete: dims.length === 0 || dimsMissing === 0,
      dimensions_evidenced: dims.length === 0 || dimsUnevidenced === 0,
      coupling_consistent: rels.length === 0 || (relMissing === 0 && relUnstated === 0),
      adoption_gate: adoptionPass,
      presentation_structure: presentation.pass,
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
