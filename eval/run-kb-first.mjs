#!/usr/bin/env node
// KB-first 评测：默认只做离线契约评测，不联网；--trace 可评分真实工具调用 JSONL。
//
// 轨迹格式（每行一个事件）：
// {"case_id":"pushbroom_hyperspectral","tool":"opticforge_assist"}
// {"case_id":"pushbroom_hyperspectral","tool":"opticforge_search"}
// {"case_id":"pushbroom_hyperspectral","tool":"general_search"}
// {"case_id":"pushbroom_hyperspectral","tool":"opticforge_verify"}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../lib/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CASES_URL = new URL("./kb-first-cases.json", import.meta.url);
const args = process.argv.slice(2);
const traceIndex = args.indexOf("--trace");
const tracePath = traceIndex >= 0 ? path.resolve(args[traceIndex + 1] || "") : "";
const jsonOnly = args.includes("--json");

const WEB_TOOLS = new Set(["general_search", "web_search", "web_fetch"]);
const KB_TOOLS = new Set(["opticforge_assist", "opticforge_search", "opticforge_get", "opticforge_docs"]);
const EXPECTED_CARDS = {
  pushbroom_hyperspectral: "pushbroom_gsd",
  grating_spectrometer: "grating_equation",
  optomechanical_tolerance: "rss_tolerance",
  interferometry: "interference_visibility",
  detector_selection: "responsivity"
};

function pct(n, d) { return d ? Number((n / d).toFixed(4)) : 0; }
function ratePass(value, threshold) { return value >= threshold; }

async function boot() {
  const registered = [];
  apply({ tools: { register(tool) { registered.push(tool); } } });
  return Object.fromEntries(registered.map((t) => [t.name, t]));
}

/**
 * 用 assist 的五段骨架合成一份最小呈现样例，专测 L4 结构，不改写技术结论。
 */
function outlineToReport(a) {
  const o = a.report_outline || [];
  const c = o[0] || {};
  const sev = o[1] || {};
  const branch = o[2] || {};
  const routes = o[3] || {};
  const verify = o[4] || {};
  return [
    "## ① 结论",
    (c.hints || []).slice(0, 1).join("；") || "先给判断。",
    "",
    "## ② 严重性对号入座",
    "| 工况 | 判据/量级 | 相对裕度 | 处理 |",
    "| --- | --- | --- | --- |",
    ...(sev.rows || []).slice(0, 3).map((r) => `| ${r.dimension} | ${r.status || "covered"} | 待定 | 按依据核对 |`),
    "",
    "## ③ 分流判断",
    branch.criterion || "做一个对照实验，判断主约束。",
    "",
    "## ④ 路线建议",
    ...(routes.routes || []).slice(0, 3).map((r, i) => `${i + 1}. ${r.goal}；适用条件：按第 ${i + 1} 条路线复核。`),
    "推荐：先做第 1 条。",
    "",
    "## ⑤ 验证与待补",
    ...(verify.verifications || []).slice(0, 3).map((x, i) => `${i + 1}. ${x}`),
    ...(verify.open_params || []).slice(0, 4).map((x) => `待补：${x}`)
  ].join("\n").replace(/chunk_id/g, "依据编号");
}

async function runContractEvaluation(tools, cases) {
  const rows = [];
  for (const c of cases) {
    const failures = [];
    const events = [];
    const check = (condition, message) => { if (!condition) failures.push(message); };
    const a = await tools.opticforge_assist.execute({
      problem: c.problem,
      deliverable: c.deliverable,
      constraints: c.constraints || "",
      known_capabilities: ["opticforge-task", "sheet", "word", "general_search"]
    }, {});
    events.push({ tool: "opticforge_assist" });
    check(a && a.ok === true, "assist 返回失败：" + (a?.error || "unknown"));
    if (!a || a.ok !== true) {
      rows.push({ id: c.id, pass: false, failures, events });
      continue;
    }

    check(a.alignment && Array.isArray(a.alignment.kb_queries) && a.alignment.kb_queries.length > 0, "缺 alignment.kb_queries");
    check(["covered", "partial", "gap"].includes(a.alignment?.verdict), "alignment.verdict 非法：" + a.alignment?.verdict);
    check(Array.isArray(a.alignment?.matched) && Array.isArray(a.alignment?.unmatched), "alignment 缺 matched/unmatched");
    check(Array.isArray(a.coverage_matrix), "缺 coverage_matrix");
    check(Array.isArray(a.dimensions) && a.dimensions.length > 0, "缺 dimensions（交叉维度）");
    check(a.dimensions.every((d) => d.source_matrix && d.source_matrix.kb && d.source_matrix.web), "维度行缺 source_matrix（维度×来源）");
    check(a.dimensions.filter((d) => d.status === "covered").every((d) => (d.hit_chunk_ids || []).length > 0), "covered 维度没有 chunk 证据");
    check(Array.isArray(a.relations), "缺 relations（交叉关系）");
    check(Array.isArray(a.plan?.cross_checks), "plan 缺 cross_checks");
    if (a.relations.length > 0) {
      check(a.plan.cross_checks.length > 0, "有关系但没有交叉复核清单");
    }
    check(a.web_gate?.policy === "default_deny_explicit_allowlist", "web_gate 不是 default deny");
    check(typeof a.web_gate?.allowed === "boolean" && Array.isArray(a.web_gate?.conditions), "web_gate 字段不全");
    const must = (a.execution_contract?.must || []).join("\n");
    check(/alignment/i.test(must) && /general_search|web_search/.test(must), "execution_contract.must 未明确 alignment 前禁网");

    // 模拟执行层：先跑完 KB 查询，再考虑外部查询；不发起真实网络请求。
    for (const q of (a.alignment?.kb_queries || []).slice(0, 8)) {
      const r = await tools.opticforge_search.execute({ query: q, top_k: 3 }, {});
      events.push({ tool: "opticforge_search", query: q });
      check(r.ok === true, "KB 查询失败：" + q);
    }
    for (const e of (a.evidence || []).slice(0, 2)) {
      const r = await tools.opticforge_get.execute({ chunk_id: e.chunk_id }, {});
      events.push({ tool: "opticforge_get", chunk_id: e.chunk_id });
      check(r.ok === true && r.status === "present", "证据不是 present：" + e.chunk_id);
    }

    const external = (a.search_pack || []).filter((g) => g.scope === "external");
    check(external.every((g) => typeof g.trigger === "string" && g.trigger && Array.isArray(g.blocked_by)), "外部查询缺 trigger/blocked_by");
    if (!a.web_gate.allowed) {
      check(external.every((g) => g.gated === true), "web_gate=false 但仍有外部查询被放行");
    }
    for (const g of external.filter((x) => x.gated === false)) {
      events.push({ tool: "external_allowed", gate_id: g.gate_id, queries: g.queries });
    }

    const webSteps = (a.plan?.steps || []).filter((s) => s.web_gated);
    check(webSteps.every((s) => Array.isArray(s.blocked_by) && s.blocked_by.includes("web_gate") && s.blocked_by.includes(a.plan.kb_evidence_step)), "web 步骤缺 blocked_by");
    check(webSteps.every((s) => !(a.plan.parallelizable || []).includes(s.id)), "web 步骤不应进入无约束 parallelizable");
    if (!a.web_gate.allowed) {
      check(webSteps.every((s) => s.blocked && (s.external_queries || []).length === 0), "web_gate=false 但 plan 仍给可执行外部查询");
    }

    check(Array.isArray(a.calc_specs), "calc_specs 不是数组");
    for (const card of a.calc_specs || []) {
      check(card.card_id && card.formula && Array.isArray(card.variables), "公式卡字段不全：" + card.card_id);
      for (const id of card.source_chunk_ids || []) {
        const hit = await tools.opticforge_get.execute({ chunk_id: id }, {});
        check(hit.ok === true && hit.status === "present", "公式卡来源不是 present：" + id);
      }
    }
    if (EXPECTED_CARDS[c.id]) {
      check((a.calc_specs || []).some((card) => card.card_id === EXPECTED_CARDS[c.id]), "未命中预期公式卡：" + EXPECTED_CARDS[c.id]);
    }

    // 每个案例都走 verify；文本只验证结构，不伪造数值结果。
    const evidenceId = a.evidence?.[0]?.chunk_id || "无（gap）";
    const text = [
      "## KB 对齐",
      `verdict: ${a.alignment.verdict}；依据：${evidenceId}。`,
      "## 结论",
      `本案例仅验证执行契约；证据索引为 ${evidenceId}。`,
      "## 假设",
      "离线契约评测不代表技术结论已经验证。",
      "## 缺口",
      (a.gaps || []).map((g) => g.aspect).join("；") || "无新增缺口；A03/C01/E01 原文缺口仍按 library_gaps 处理。",
      "## 复现",
      "运行 node eval/run-kb-first.mjs。",
      "## 来源",
      evidenceId
    ].join("\n");
    const v = await tools.opticforge_verify.execute({ problem: c.problem, text, strict: true }, {});
    events.push({ tool: "opticforge_verify" });
    check(v.ok === true, "verify 调用失败：" + (v.error || "unknown"));
    check(v.pass === true, "verify 未通过：" + JSON.stringify(v.issues || []));
    check(v.dimensions && typeof v.dimensions.total === "number" && v.adoption && typeof v.adoption.pass === "boolean", "verify 缺 dimensions/adoption 输出");

    // L4 呈现契约：用 report_outline 合成最小五段样例，专测结构合规。
    const structureText = outlineToReport(a);
    const sv = await tools.opticforge_verify.execute({ text: structureText, presentation: true }, {});
    check(sv.ok === true && sv.presentation?.applicable === true && sv.presentation?.pass === true,
      "结构合规样例未通过：" + JSON.stringify(sv.issues || []));
    check(Array.isArray(a.report_outline) && a.report_outline.length === 5, "assist 未输出五段 report_outline");

    const firstWeb = events.findIndex((e) => e.tool === "external_allowed" || WEB_TOOLS.has(e.tool));
    const lastKb = events.map((e, i) => ({ e, i })).filter((x) => KB_TOOLS.has(x.e.tool)).at(-1)?.i ?? -1;
    const kbBeforeWeb = firstWeb < 0 || (lastKb >= 0 && lastKb < firstWeb);
    check(kbBeforeWeb, "模拟执行中 KB 未先于 web");
    rows.push({
      id: c.id,
      domain: a.brief?.domain?.id,
      active_playbooks: (a.brief?.active_playbooks || []).map((p) => p.id),
      dimensions_total: a.dimensions.length,
      dimensions_covered: a.dimensions.filter((d) => d.status === "covered").length,
      relations: a.relations.length,
      cross_checks: a.plan.cross_checks.length,
      source_matrix_rows: a.dimensions.filter((d) => d.source_matrix?.kb && d.source_matrix?.web).length,
      verdict: a.alignment?.verdict,
      web_allowed: a.web_gate?.allowed,
      calc_cards: (a.calc_specs || []).map((x) => x.card_id),
      verify_called: true,
      verify_pass: v.pass === true,
      structure_compliant: sv.presentation?.pass === true && sv.presentation?.applicable === true,
      report_outline_sections: (a.report_outline || []).length,
      kb_before_web: kbBeforeWeb,
      pass: failures.length === 0,
      failures,
      events
    });
  }
  const n = rows.length;
  const dimTotal = rows.reduce((s, r) => s + r.dimensions_total, 0);
  const dimCovered = rows.reduce((s, r) => s + r.dimensions_covered, 0);
  const withRels = rows.filter((r) => r.relations > 0);
  const sourceRows = rows.reduce((s, r) => s + r.source_matrix_rows, 0);
  return {
    scope: "offline_contract_harness_no_real_network",
    cases: n,
    metrics: {
      contract_pass_rate: pct(rows.filter((r) => r.pass).length, n),
      assist_first_rate_in_harness: pct(rows.filter((r) => r.events[0]?.tool === "opticforge_assist").length, n),
      kb_before_web_rate_in_harness: pct(rows.filter((r) => r.kb_before_web).length, n),
      verify_usage_rate_in_harness: pct(rows.filter((r) => r.verify_called).length, n),
      verify_pass_rate: pct(rows.filter((r) => r.verify_pass).length, n),
      structure_compliance_rate: pct(rows.filter((r) => r.structure_compliant).length, n),
      multi_playbook_rate: pct(rows.filter((r) => r.active_playbooks.length >= 2).length, n),
      dimension_coverage_rate: pct(dimCovered, dimTotal),
      source_matrix_rate: pct(sourceRows, dimTotal),
      cross_relation_rate: pct(withRels.filter((r) => r.cross_checks > 0).length, withRels.length || 1)
    },
    rows
  };
}

/**
 * 交叉契约评测：用同一案例的维度与关系合成一份“最小合规”文本，
 * 再让 verify 走 dimensions/relations 与采信闸门，确认交叉链路真的接通。
 */
async function runCrossContract(tools, c) {
  const a = await tools.opticforge_assist.execute({ problem: c.problem, deliverable: c.deliverable }, {});
  const dims = a.dimensions || [];
  const rels = a.relations || [];
  const byId = new Map(dims.map((d) => [d.id, d]));
  const allCovered = dims.length > 0 && dims.every((d) => d.status === "covered" && (d.hit_chunk_ids || []).length > 0);
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "## KB 对齐",
    `verdict: ${a.alignment?.verdict}；维度覆盖 ${dims.filter((d) => d.status === "covered").length}/${dims.length}。`,
    "",
    "## 结论",
    dims.map((d) => `${d.label}：依据 ${d.hit_chunk_ids[0]}，按该面判据给结论。`).join("\n"),
    "",
  ];
  if (rels.length) {
    lines.push(
      "## 交叉核对",
      rels.slice(0, 4).map((r) => {
        const from = byId.get(r.from);
        const to = byId.get(r.to);
        return `${from.label}（依据 ${from.hit_chunk_ids[0]}）与 ${to.label}（依据 ${to.hit_chunk_ids[0]}）相互约束：${r.note}。`;
      }).join("\n"),
      ""
    );
  }
  lines.push(
    "## 外部来源",
    `一手源：厂商 datasheet https://example.com/spec 型号 X-100，访问日期：${today}，与 KB 一致。`,
    "",
    "## 假设",
    "仅验证交叉契约，不代表光学结论已复核。",
    "",
    "## 缺口",
    "无新增缺口；A03/C01/E01 仍按 library_gaps 处理。",
    "",
    "## 复现",
    "运行 node eval/run-kb-first.mjs --json。"
  );
  const v = await tools.opticforge_verify.execute({
    problem: c.problem,
    text: lines.join("\n"),
    strict: true,
    dimensions: dims,
    relations: rels,
    now: today
  }, {});
  const failures = [];
  if (!allCovered) failures.push("案例存在 gap 维度，无法合成全覆盖文本");
  if (!v || v.ok !== true) failures.push("verify 调用失败：" + (v?.error || "unknown"));
  if (v?.dimensions?.missing !== 0) failures.push("维度未被识别：" + v?.dimensions?.missing);
  if (v?.dimensions?.unevidenced !== 0) failures.push("维度缺证据：" + v?.dimensions?.unevidenced);
  if (v?.dimensions?.coupling_missing !== 0) failures.push("耦合两端缺失：" + v?.dimensions?.coupling_missing);
  if (v?.dimensions?.coupling_unstated !== 0) failures.push("耦合关系未写：" + v?.dimensions?.coupling_unstated);
  if (v?.adoption?.pass !== true) failures.push("采信闸门未过：" + JSON.stringify(v?.adoption || {}));
  if (v?.checklist?.adoption_gate !== true) failures.push("checklist.adoption_gate 未通过");
  return {
    case_id: c.id,
    dimensions: dims.length,
    relations: rels.length,
    pass: failures.length === 0,
    failures,
    verify: { pass: v?.pass, missing: v?.dimensions?.missing, adoption: v?.adoption?.pass }
  };
}

async function scoreRealTrace(file) {
  const raw = await readFile(file, "utf8");
  const events = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error(`轨迹第 ${i + 1} 行不是 JSON`); }
  });
  const groups = new Map();
  for (const e of events) {
    const id = String(e.case_id || e.case || e.problem_id || "default");
    const tool = String(e.tool || e.name || "");
    if (!tool) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ ...e, tool });
  }
  const rows = [];
  for (const [id, list] of groups) {
    const first = list[0]?.tool;
    const firstWeb = list.findIndex((e) => WEB_TOOLS.has(e.tool));
    const firstKb = list.findIndex((e) => KB_TOOLS.has(e.tool));
    rows.push({
      case_id: id,
      events: list.length,
      assist_first: first === "opticforge_assist",
      kb_before_web: firstWeb < 0 || (firstKb >= 0 && firstKb < firstWeb),
      verify_used: list.some((e) => e.tool === "opticforge_verify")
    });
  }
  const n = rows.length;
  const metrics = {
    cases: n,
    assist_first_rate: pct(rows.filter((r) => r.assist_first).length, n),
    kb_before_web_rate: pct(rows.filter((r) => r.kb_before_web).length, n),
    verify_usage_rate: pct(rows.filter((r) => r.verify_used).length, n)
  };
  const thresholds = { assist_first_rate: 0.9, kb_before_web_rate: 0.8, verify_usage_rate: 1.0 };
  return {
    scope: "real_tool_trace",
    metrics,
    thresholds,
    pass: n > 0 && Object.entries(thresholds).every(([k, v]) => ratePass(metrics[k], v)),
    rows
  };
}

const cases = JSON.parse(await readFile(CASES_URL, "utf8"));
const tools = await boot();
const contract = await runContractEvaluation(tools, cases);
const crossCase = cases.find((c) => c.id === "pushbroom_hyperspectral") || cases[0];
const crossContract = await runCrossContract(tools, crossCase);
const report = {
  kb_version: "3.1.1",
  contract,
  cross_contract: crossContract,
  model_trace: tracePath ? await scoreRealTrace(tracePath) : null,
  note: tracePath ? "真实轨迹指标与离线契约分开报告。" : "未提供 --trace；assist 首调率等只代表评测 harness，不代表真实模型行为已达标。"
};
const contractPass = contract.metrics.contract_pass_rate === 1 && contract.metrics.verify_usage_rate_in_harness === 1 && contract.metrics.structure_compliance_rate === 1;
const crossPass = crossContract.pass === true;
const tracePass = !report.model_trace || report.model_trace.pass;
report.pass = contractPass && crossPass && tracePass;

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("== KB-first 离线契约评测 ==");
  for (const r of contract.rows) {
    console.log(`${r.pass ? "ok" : "FAIL"} ${r.id} verdict=${r.verdict || "-"} web=${r.web_allowed} cards=${(r.calc_cards || []).join(",") || "-"}`);
    for (const f of r.failures || []) console.log("  - " + f);
  }
  console.log(JSON.stringify(contract.metrics, null, 2));
  console.log(`== 交叉契约 ==\n${crossContract.pass ? "ok" : "FAIL"} ${crossContract.case_id} dims=${crossContract.dimensions} rels=${crossContract.relations}`);
  for (const f of crossContract.failures || []) console.log("  - " + f);
  if (report.model_trace) console.log("== 真实轨迹 ==\n" + JSON.stringify(report.model_trace, null, 2));
  else console.log("NOTE " + report.note);
  console.log(report.pass ? "OK KB-first 评测通过" : "FAIL KB-first 评测未通过");
}
if (!report.pass) process.exit(1);
