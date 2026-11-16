// verify.js —— 交付物自检：引用、单位、假设、缺口与营销词
//
// 只做文本级检查：不解析 docx/pdf（无第三方依赖），遇到二进制文件明确说明
// “请先导出为文本/ Markdown 再自检”，不假装检查过。

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const CITE_RE = /\b([A-I]\d{2})-(\d{2})\b/g;
const CITE_TEST = /\b[A-I]\d{2}-\d{2}\b/;
const UNIT_RE = /\d+(?:\.\d+)?\s*(?:nm|μm|µm|um|mm|cm|m|°|℃|K|%|ms|μs|us|s|fps|Hz|kHz|MHz|GHz|W|mW|dB|kg|g|元|万|px|lp\/mm)/i;
const MARKETING = ["完美", "最佳", "全球领先", "世界领先", "顶级", "保证", "绝不", "唯一", "颠覆"];

function textStats(text) {
  const s = String(text || "");
  return {
    chars: s.length,
    lines: s.split(/\r?\n/).length,
    numbers: (s.match(UNIT_RE) || []).length
  };
}

function sentences(text) {
  return String(text || "")
    .split(/[。！？\n；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

export function verifyText(text, chunks, options = {}) {
  const src = String(text || "");
  const strict = options.strict === true;
  const issues = [];
  const byId = new Map((chunks || []).map((c) => [c.chunk_id, c]));

  // 1. 引用有效性
  const cited = [...new Set([...src.matchAll(CITE_RE)].map((m) => m[1] + "-" + m[2]))];
  const valid = [];
  const invalid = [];
  for (const id of cited) {
    const c = byId.get(id);
    if (!c) {
      invalid.push(id);
      issues.push({ level: "error", type: "invalid_citation", message: "引用了不存在的条目 " + id, evidence: id });
    } else if (c.status !== "present") {
      invalid.push(id);
      issues.push({ level: "error", type: "non_present_citation", message: id + " 的 status=" + c.status + "，不可作为逐字原文引用", evidence: id });
    } else {
      valid.push(id);
    }
  }

  // 2. 数量断言是否带引用或计算说明
  const unsupported = [];
  for (const s of sentences(src)) {
    if (unsupported.length >= 20) break;
    if (!UNIT_RE.test(s)) continue;
    if (CITE_TEST.test(s)) continue;
    if (/[=＝]/.test(s)) continue;
    if (/计算|估算|预算|实测|仿真|按公式|推导|测得|标称|规格书|数据表|来源|引用/.test(s)) continue;
    unsupported.push(s.slice(0, 140));
    issues.push({ level: strict ? "error" : "warning", type: "unsupported_quantity", message: "数量断言缺少引用或计算说明：" + s.slice(0, 100), evidence: s.slice(0, 140) });
  }

  // 3. 营销词/绝对化表述
  for (const w of MARKETING) {
    if (src.includes(w)) {
      issues.push({ level: "warning", type: "marketing_word", message: "出现绝对化/营销表述「" + w + "」，改为可验证指标", evidence: w });
    }
  }

  // 4. 缺口与假设是否单列
  const hasAssumption = /假设|前提|边界条件|适用条件/.test(src);
  const hasGap = /缺口|未覆盖|待补|无原文|不可引用|知识库未找到/.test(src);
  const hasRepro = /复现|步骤|输入|运行|命令|文件清单/.test(src);
  const hasSourceSection = /来源|参考|引用|参考文献/.test(src) || cited.length > 0;

  if (!hasAssumption) issues.push({ level: "warning", type: "missing_assumptions", message: "未看到假设/适用条件；关键结论需要写明前提" });
  if (!hasGap) issues.push({ level: "warning", type: "missing_gap_statement", message: "未看到缺口声明；A03/C01/E01 原文缺口或未覆盖方向应单列" });
  if (!hasRepro) issues.push({ level: "warning", type: "missing_repro", message: "未看到复现步骤/输入清单" });
  if (!hasSourceSection) issues.push({ level: "warning", type: "missing_sources", message: "未看到来源/引用段" });

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const score = Math.max(0, 100 - errors * 18 - warnings * 6);

  return {
    ok: true,
    action: "verify",
    pass: errors === 0,
    score,
    stats: textStats(src),
    citations: { total: cited.length, valid, invalid, non_present: invalid.filter((id) => byId.get(id) && byId.get(id).status !== "present") },
    issues,
    checklist: {
      citations_resolvable: cited.length === 0 ? "no-citation" : invalid.length === 0,
      quantities_sourced: unsupported.length === 0,
      assumptions_stated: hasAssumption,
      gaps_stated: hasGap,
      reproducible: hasRepro,
      sources_present: hasSourceSection,
      no_marketing_words: !MARKETING.some((w) => src.includes(w))
    },
    summary: "错误 " + errors + " 项、警告 " + warnings + " 项；" + (errors === 0 ? "结构自检通过" : "需先修正错误项")
  };
}

const TEXT_EXT = new Set([".md", ".txt", ".json", ".csv", ".html", ".xml", ".yaml", ".yml", ".js", ".mjs", ".ts", ".py", ".m", ".tex", ".log"]);

export async function verifyPath(filePath, chunks, options = {}) {
  const p = path.resolve(String(filePath || ""));
  let st;
  try {
    st = await stat(p);
  } catch {
    return { ok: false, action: "verify", error: "文件不存在：" + p };
  }
  if (!st.isFile()) return { ok: false, action: "verify", error: "不是文件：" + p };
  const ext = path.extname(p).toLowerCase();
  if (!TEXT_EXT.has(ext)) {
    return {
      ok: false,
      action: "verify",
      path: p,
      error: "不支持直接解析 " + ext + "；请先导出为 .md/.txt 再自检，或把正文作为 text 传入",
      supported_extensions: [...TEXT_EXT]
    };
    }
  if (st.size > 2 * 1024 * 1024) {
    return { ok: false, action: "verify", path: p, error: "文件超过 2 MB，请截取关键章节后再自检" };
  }
  let text;
  try {
    text = await readFile(p, "utf8");
  } catch (err) {
    return { ok: false, action: "verify", path: p, error: "读取失败：" + (err && err.message ? err.message : String(err)) };
  }
  return { ...verifyText(text, chunks, options), path: p, bytes: st.size };
}
