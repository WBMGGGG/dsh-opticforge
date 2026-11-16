// OpticForge 集成测试（node:test）——直接运行：node test/run.mjs
// 全程只读源码；唯一写入是 test/.asar-runtime/ 下的依赖抽取缓存（由 _asar_loader.mjs 完成），
// 测试结束会自动清理该缓存，保持 test/ 目录干净。
// 设计要点：用 DSH 安装目录 asar 里的【真实】@deepseek-ai/dsh-tools 校验 lib/index.js 注册的两个
// defineTool（DSL schema / output.render / execute 返回值），并做端到端检索、计算与统计断言。
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRuntime, LOADER } from "./_asar_loader.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, "..");
const LIB = path.join(PLUGIN, "lib");
const idxUrl = pathToFileURL(path.join(LIB, "index.js")).href;

// ---- 加载真实 defineTool 运行时（必须在任何 import lib/index.js 之前） ----
let RUNTIME;
let dshTools;
let plugin;
let registered;
let kbData;
let kbEngine;
let calculators;

async function boot() {
  const info = ensureRuntime();
  RUNTIME = info;
  register(pathToFileURL(LOADER).href, import.meta.url);
  dshTools = await import("@deepseek-ai/dsh-tools");
  plugin = await import(idxUrl);
  // 用最小 ctx 收集 ctx.tools.register 注册的工具定义
  const defs = [];
  const ctx = { tools: { register(def) { defs.push(def); } } };
  plugin.apply(ctx);
  registered = defs;
  // 队友模块：容忍尚未写完，读取失败时保留 null 让用例给出清晰失败信息
  try { kbData = await import(pathToFileURL(path.join(LIB, "kb-data.js")).href); } catch { kbData = null; }
  try { kbEngine = await import(pathToFileURL(path.join(LIB, "kb-engine.js")).href); } catch { kbEngine = null; }
  try { calculators = await import(pathToFileURL(path.join(LIB, "calculators.js")).href); } catch { calculators = null; }
  return info;
}
const booted = boot();

function tool(name) {
  const t = registered.find((d) => d.name === name);
  assert.ok(t, "lib/index.js 未注册工具 " + name + "（当前注册：" + registered.map((d) => d.name).join(",") + "）");
  return t;
}
function requireModule(m, label) {
  assert.ok(m, label + " 模块尚未就绪（队友可能仍在编写）；请等待该文件写完后再运行本测试。集成测试不会静默跳过。");
  return m;
}

// =====================================================================
// A. 真实 defineTool 契约校验
// =====================================================================
test("A1 真实 defineTool 可用：apply/inject/name 导出正确", async () => {
  await booted;
  assert.equal(typeof dshTools.defineTool, "function", "未能从 asar 抽取的 @deepseek-ai/dsh-tools 载入 defineTool");
  assert.equal(typeof plugin.apply, "function", "lib/index.js 未导出 apply");
  assert.equal(plugin.name, "opticforge", "lib/index.js name 应为 opticforge");
  assert.deepEqual(plugin.inject, ["tools"], "lib/index.js inject 应为 [tools]");
  assert.equal(registered.length, 2, "应恰好注册 2 个工具，实际 " + registered.length);
  assert.deepEqual(registered.map((d) => d.name).sort(), ["opticforge_calc", "opticforge_search"]);
});

test("A2 两个工具定义合法：parameters/output.schema 通过真实校验，output.render 可调用", async () => {
  await booted;
  for (const name of ["opticforge_search", "opticforge_calc"]) {
    const t = tool(name);
    assert.equal(typeof t.execute, "function", name + ".execute 必须是函数");
    assert.ok(t.output && typeof t.output === "object", name + " 缺少 output");
    assert.equal(typeof t.output.render, "function", name + ".output.render 必须是函数");
    assert.ok(t.output.schema, name + " 缺少 output.schema");
    // defineTool 内部已用 assertSupportedJsonSchema 校验过；这里再用导出函数显式复核
    assert.doesNotThrow(() => dshTools.assertSupportedJsonSchema(t.output.schema), name + ".output.schema 未被真实校验器接受");
    assert.doesNotThrow(() => dshTools.assertSupportedJsonSchema(t.parameters), name + ".parameters 未被真实校验器接受");
    // render 必须能调用且返回文本块
    const rendered = t.output.render({}, {});
    assert.ok(Array.isArray(rendered), name + ".output.render 应返回数组");
    assert.equal(rendered[0].type, "text", name + ".output.render 首项 type 应为 text");
    assert.equal(typeof rendered[0].text, "string", name + ".output.render 首项 text 应为字符串");
  }
});

// validateJsonSchemaValue 返回空数组表示合法；用它断言 execute 返回值符合 output.schema
function assertOutputMatchesSchema(name, value) {
  const t = tool(name);
  const violations = dshTools.validateJsonSchemaValue(t.output.schema, value, "");
  assert.deepEqual(violations, [], name + " 的 execute 返回值不符合其 output.schema: " + JSON.stringify(violations) + " 实际值: " + JSON.stringify(value));
}

// =====================================================================
// B. 统计断言：67 块 / 51 present
// =====================================================================
test("B1 KB 统计：67 块、51 present、状态分布与 doc_id 分布", async () => {
  await booted;
  const m = requireModule(kbData, "lib/kb-data.js");
  assert.equal(m.TOTAL_CHUNKS, 67, "kb-data.js TOTAL_CHUNKS 应为 67");
  assert.equal(m.PRESENT_CHUNKS, 51, "kb-data.js PRESENT_CHUNKS 应为 51");
  assert.equal(typeof m.KB_SOURCE, "string", "kb-data.js KB_SOURCE 应为非空字符串");
  const chunks = await m.getKBData();
  assert.ok(Array.isArray(chunks), "getKBData() 应返回数组");
  assert.equal(chunks.length, 67, "getKBData() 应返回 67 块，实际 " + chunks.length);
  const statuses = {};
  const docs = {};
  for (const c of chunks) {
    statuses[c.status] = (statuses[c.status] || 0) + 1;
    docs[c.doc_id] = (docs[c.doc_id] || 0) + 1;
    for (const f of ["doc_id", "chunk_id", "status", "text", "source", "page_or_section", "keywords_zh"]) {
      assert.ok(f in c, "第 " + c.chunk_id + " 块缺少字段 " + f);
    }
  }
  assert.equal(statuses.present, 51, "present 应为 51 块");
  assert.equal(statuses.missing_source, 11, "missing_source 应为 11 块");
  assert.equal(statuses.substitute, 5, "substitute 应为 5 块");
  assert.deepEqual(docs, { A01: 13, A02: 9, A03: 1, B01: 11, B02: 4, C01: 5, C02: 7, D01: 11, E01: 6 },
    "doc_id 分布与数据源不一致：" + JSON.stringify(docs));
});

// =====================================================================
// C. opticforge_search 端到端
// =====================================================================
function execSearch(args) {
  return tool("opticforge_search").execute(args, {});
}

test("C1 检索「共焦色散 测量原理」命中 A01，返回结构合法且只含 present", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "共焦色散 测量原理" });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.equal(value.query, "共焦色散 测量原理");
  assert.ok(value.total_hits > 0, "应命中 A01 相关知识块，实际 total_hits=0");
  assert.equal(value.total_hits, value.results.length, "total_hits 应等于 results.length");
  assert.ok(value.results.some((r) => r.doc_id === "A01"), "结果中应含 doc_id=A01：" + JSON.stringify(value.results.map((r) => r.chunk_id)));
  for (const r of value.results) {
    assert.equal(r.status, "present", "检索结果不应出现 status!==present 的块：" + r.chunk_id);
    assert.ok(r.score > 0, "命中分数应为正数：" + r.chunk_id);
    assert.ok(r.excerpt.length <= 300, "excerpt 应为正文前 300 字以内：" + r.chunk_id);
    assert.equal(typeof r.source, "string");
    assert.equal(typeof r.page, "string");
  }
  assert.equal(typeof value.source, "string");
  assert.ok(value.source.length > 0, "source 应为非空字符串");
});

test("C2 检索「RCWA 光栅 衍射效率」命中 C02", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "RCWA 光栅 衍射效率" });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.ok(value.total_hits > 0, "应命中 RCWA 相关知识块");
  assert.ok(value.results.some((r) => r.doc_id === "C02"), "结果中应含 doc_id=C02：" + JSON.stringify(value.results.map((r) => r.chunk_id)));
  for (const r of value.results) assert.equal(r.status, "present");
});

test("C3 doc_filter 生效：结果全部属于指定 doc_id", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "共焦色散 测量原理", top_k: 20, doc_filter: "A01" });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.ok(value.total_hits > 0, "doc_filter=A01 时应仍有命中");
  for (const r of value.results) {
    assert.equal(r.doc_id, "A01", "doc_filter=A01 却返回了 " + r.doc_id + " 的块：" + r.chunk_id);
    assert.equal(r.status, "present");
  }
  const c02 = await execSearch({ query: "共焦色散 测量原理", top_k: 20, doc_filter: "C02" });
  assertOutputMatchesSchema("opticforge_search", c02);
  for (const r of c02.results) {
    assert.equal(r.doc_id, "C02", "doc_filter=C02 却返回了 " + r.doc_id + " 的块：" + r.chunk_id);
  }
  // 与无过滤结果对比：过滤后不应出现其它 doc_id（A01/D01/A02 等）
  const unfiltered = await execSearch({ query: "共焦色散 测量原理", top_k: 20 });
  const otherDocs = new Set(unfiltered.results.filter((r) => r.doc_id !== "C02").map((r) => r.doc_id));
  assert.ok(otherDocs.size > 0, "无过滤结果应包含非 C02 的块，否则无法证明过滤生效");
  for (const r of c02.results) assert.ok(!otherDocs.has(r.doc_id), "过滤结果混入了非 C02 块：" + r.chunk_id);
});

test("C4 top_k 生效：返回条数不超过 top_k", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const q = { query: "共焦色散 测量原理" };
  const v1 = await execSearch({ ...q, top_k: 1 });
  const v3 = await execSearch({ ...q, top_k: 3 });
  const v20 = await execSearch({ ...q, top_k: 20 });
  assertOutputMatchesSchema("opticforge_search", v1);
  assertOutputMatchesSchema("opticforge_search", v3);
  assertOutputMatchesSchema("opticforge_search", v20);
  assert.equal(v1.results.length, 1, "top_k=1 应恰好返回 1 条");
  assert.equal(v3.results.length, 3, "top_k=3 应恰好返回 3 条");
  assert.ok(v20.results.length > 3, "top_k=20 应返回多于 3 条以证明确有更多可命中块");
  assert.ok(v20.results.length <= 20, "top_k=20 不应超过 20 条");
});

test("C5 status=present 过滤生效：missing_source / substitute 不出现在任何结果里", async () => {
  await booted;
  const eng = requireModule(kbEngine, "lib/kb-engine.js");
  const m = requireModule(kbData, "lib/kb-data.js");
  const chunks = await m.getKBData();
  // 直接对引擎做全量查询（多组合），逐条核验状态
  const queries = ["共焦色散 测量原理", "RCWA 光栅 衍射效率", "公差分析 Monte Carlo", "暗电流 噪声等效功率", "Si photodiodes", "光栅方程 分辨率"];
  let total = 0;
  for (const q of queries) {
    for (const r of eng.searchKB(chunks, q, 20)) {
      total++;
      assert.equal(r.status, "present", "searchKB 返回了非 present 块 " + r.chunk_id + "（status=" + r.status + "），查询=" + q);
      assert.ok(r.score > 0, "score<=0 不应返回：" + r.chunk_id);
    }
  }
  assert.ok(total > 0, "多组查询应产生命中（用于验证过滤）");
  // 缺失/替代状态的 chunk_id 集合，确保它们从未被检索到
  const nonPresent = new Set(chunks.filter((c) => c.status !== "present").map((c) => c.chunk_id));
  assert.ok(nonPresent.size === 16, "应有 16 个非 present 块（11 missing_source + 5 substitute），实际 " + nonPresent.size);
  for (const q of queries) {
    for (const r of eng.searchKB(chunks, q, 20)) {
      assert.ok(!nonPresent.has(r.chunk_id), "非 present 块 " + r.chunk_id + " 泄漏进检索结果（查询=" + q + "）");
    }
  }
});

test("C6 知识空白如实告知：「量子计算 光学」返回空且 note=「知识库中未找到相关依据」", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "量子计算 光学" });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.equal(value.total_hits, 0,
    "知识空白查询「量子计算 光学」应返回空结果(PLUGIN_PLAN 8.5/4.3)，实际 total_hits=" + value.total_hits + "，命中: " + JSON.stringify(value.results.map((r) => r.chunk_id + "(" + r.score + ")")) + "；应由 lib/index.js 的 isZeroCoverageQuery(query,chunks) 数据驱动守卫短路（topicHasPresentBasis 在 present 块可检索字段中 0 出现才成立），本用例按规范硬断言不静默跳过；H1 回归见 C6b/C6c/C6d。");
  assert.deepEqual(value.results, [], "知识空白查询的 results 应为空数组");
  assert.equal(value.note, "知识库中未找到相关依据", "note 应如实告知「知识库中未找到相关依据」，实际：" + value.note);
});

// H1 回归：词表里「不确定度」「自由曲面」等词虽被列为 0 覆盖主题，
// 但 KB 里确有 status=present 的真实依据（E01-06 / B01-10 的 keywords_zh），
// 数据驱动守卫 isZeroCoverageQuery(query,chunks) 的 topicHasPresentBasis 必须放行，
// 绝不能把有依据的查询短路成「知识库中未找到相关依据」。C6 仍保持硬断言不放宽。
test("C6b H1 回归：「不确定度 评定」应命中 E01-06，不被知识空白守卫误屏蔽", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "不确定度 评定", top_k: 10 });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.ok(value.total_hits > 0,
    "H1：『不确定度』在 E01-06(present) 的 keywords_zh 中真实出现，数据驱动守卫必须放行；" +
    "实际 total_hits=" + value.total_hits + "（若为 0 说明守卫仍按静态词表误屏蔽）");
  assert.ok(value.results.some((r) => r.chunk_id === "E01-06"),
    "H1：结果应含真实依据 E01-06，实际：" + JSON.stringify(value.results.map((r) => r.chunk_id)));
  assert.notEqual(value.note, "知识库中未找到相关依据",
    "H1：有 present 依据的查询不应被标注为知识空白");
  for (const r of value.results) assert.equal(r.status, "present");
});

test("C6c H1 回归：「自由曲面 光学设计」应命中 B01-10，不被知识空白守卫误屏蔽", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "自由曲面 光学设计", top_k: 10 });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.ok(value.total_hits > 0,
    "H1：『自由曲面』在 B01-10(present) 的 keywords_zh 中真实出现，数据驱动守卫必须放行；" +
    "实际 total_hits=" + value.total_hits + "（若为 0 说明守卫仍按静态词表误屏蔽）");
  assert.ok(value.results.some((r) => r.chunk_id === "B01-10"),
    "H1：结果应含真实依据 B01-10，实际：" + JSON.stringify(value.results.map((r) => r.chunk_id)));
  assert.notEqual(value.note, "知识库中未找到相关依据",
    "H1：有 present 依据的查询不应被标注为知识空白");
  for (const r of value.results) assert.equal(r.status, "present");
});

test("C6d H1 回归：真 0 覆盖主题仍短路（白光干涉 present 块 0 出现）", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "白光干涉 测量" });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.equal(value.total_hits, 0,
    "『白光干涉』在 present 块可检索字段中 0 出现，应仍短路为空；实际命中：" +
    JSON.stringify(value.results.map((r) => r.chunk_id)));
  assert.equal(value.note, "知识库中未找到相关依据");
});

test("C7 生僻无意义词未命中时同样如实告知", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "zzzqwerty_nonexistenttoken" });
  assertOutputMatchesSchema("opticforge_search", value);
  assert.equal(value.total_hits, 0, "无意义生僻词不应命中");
  assert.equal(value.note, "知识库中未找到相关依据");
});

// =====================================================================
// D. opticforge_calc 端到端（5 个类型 + 错误路径）
// =====================================================================
function execCalc(type, params) {
  return tool("opticforge_calc").execute({ type, params }, {});
}
function resultNumbers(v) {
  // 从 result 对象里收集所有数值，便于与方案示例比对（容忍不同字段命名）
  const out = [];
  const walk = (o) => {
    if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, val] of Object.entries(o)) { if (typeof val === "number") out.push([k, val]); else walk(val); }
  };
  walk(v.result);
  return out;
}
function assertHasNumberNear(v, expected, tol, label) {
  const nums = resultNumbers(v);
  assert.ok(nums.length > 0, label + "：result 中没有任何数值字段，无法核对示例值：" + JSON.stringify(v.result));
  const near = nums.find(([, n]) => Math.abs(n - expected) <= tol);
  assert.ok(near, label + "：result 中找不到 ≈" + expected + "(±" + tol + ") 的数值，实际：" + JSON.stringify(nums));
  return near;
}
function assertCalcShape(v, label) {
  assertOutputMatchesSchema("opticforge_calc", v);
  for (const f of ["type", "ok", "formula", "substitution", "steps", "result", "source"]) {
    assert.ok(f in v, label + "：返回对象缺少必填字段 " + f);
  }
  assert.ok(Array.isArray(v.steps), label + "：steps 应为数组");
  assert.equal(typeof v.formula, "string", label + "：formula 应为字符串");
  assert.equal(typeof v.substitution, "string", label + "：substitution 应为字符串");
}

// 注：方案 §3.2 示例写 d=708nm，但公式精确值 1.22×550/0.95=706.3158nm（差 0.24%）。
// calculators.js 按「不编造」保留精确值，并在 result.plan_example_d_nm=708 与 notes 标注差异；
// 断言用 ±6 容差同时兼容两种口径，D1b 显式核验精确值与方案示例值都被如实保留。
test("D1 diffraction_limit：λ=550nm, NA=0.95 → d≈708nm", async () => {
  await booted;
  requireModule(calculators, "lib/calculators.js");
  const v = await execCalc("diffraction_limit", { lambda_nm: 550, NA: 0.95 });
  assertCalcShape(v, "diffraction_limit");
  assert.equal(v.ok, true, "diffraction_limit 应成功，error=" + (v.error || "无"));
  assertHasNumberNear(v, 708, 6, "衍射极限 d");
});

test("D1b diffraction_limit 精确值与方案示例值均如实保留（不编造）", async () => {
  await booted;
  const m = requireModule(calculators, "lib/calculators.js");
  const v = await m.calculate("diffraction_limit", { lambda_nm: 550, NA: 0.95 });
  assert.equal(v.ok, true);
  const nums = resultNumbers(v);
  const has = (n, tol) => nums.some(([, x]) => Math.abs(x - n) <= tol);
  assert.ok(has(706.3158, 0.5), "应保留公式精确值 706.3158 nm（1.22×550/0.95），实际：" + JSON.stringify(nums));
  assert.ok(has(708, 0.5), "应如实保留方案示例值 708（plan_example_d_nm），不偷偷改写公式凑数");
  assert.ok(Array.isArray(v.notes) && v.notes.some((n) => /708|706|方案|示例/.test(n)),
    "notes 应说明 708(方案示例) 与 706.3158(公式精确值) 的差异");
});


test("D2 coating_thermal_drift：1064nm, dn/dT=1e-5, α=5e-7, ΔT=40 → Δλ/λ≈4.2e-4, Δλ≈0.45nm", async () => {
  await booted;
  requireModule(calculators, "lib/calculators.js");
  const v = await execCalc("coating_thermal_drift", { lambda_nm: 1064, dndT: 1e-5, alpha: 5e-7, deltaT: 40 });
  assertCalcShape(v, "coating_thermal_drift");
  assert.equal(v.ok, true, "coating_thermal_drift 应成功，error=" + (v.error || "无"));
  assertHasNumberNear(v, 4.2e-4, 1e-5, "相对漂移 Δλ/λ");
  assertHasNumberNear(v, 0.45, 0.05, "中心波长漂移 Δλ(nm)");
});

test("D3 confocal_range_select：输出 A01-02 IFS2402 选型与裕量说明", async () => {
  await booted;
  requireModule(calculators, "lib/calculators.js");
  const v = await execCalc("confocal_range_select", { range_min_mm: 0, range_max_mm: 2, precision_nm: 100, material: "反射" });
  assertCalcShape(v, "confocal_range_select");
  assert.equal(v.ok, true, "confocal_range_select 应成功，error=" + (v.error || "无"));
  const blob = JSON.stringify(v);
  assert.ok(/IFS2402/.test(blob), "共焦选型结果应引用 IFS2402 系列型号（PLUGIN_PLAN §3.2(3)）");
  assert.ok(v.steps.length > 0, "应给出量程/分辨率/线性度的判定步骤");
});

test("D4 tolerance_rss：σ=[0.5,0.3,0.2]µm → σ_total≈0.62µm", async () => {
  await booted;
  requireModule(calculators, "lib/calculators.js");
  const v = await execCalc("tolerance_rss", { tolerances: [0.5, 0.3, 0.2], unit: "µm" });
  assertCalcShape(v, "tolerance_rss");
  assert.equal(v.ok, true, "tolerance_rss 应成功，error=" + (v.error || "无"));
  assertHasNumberNear(v, 0.62, 0.02, "RSS 合成 σ_total");
});

test("D5 na_resolution：λ=550nm, NA=0.95 → δ≈0.61λ/NA≈353nm（含共焦提升说明）", async () => {
  await booted;
  requireModule(calculators, "lib/calculators.js");
  const v = await execCalc("na_resolution", { lambda_nm: 550, NA: 0.95 });
  assertCalcShape(v, "na_resolution");
  assert.equal(v.ok, true, "na_resolution 应成功，error=" + (v.error || "无"));
  assertHasNumberNear(v, 353, 10, "Rayleigh 分辨率 δ(nm)");
});

test("D6 缺参 / 非法参数（工具层）：ok=false 且绝不抛异常", async () => {
  await booted;
  requireModule(calculators, "lib/calculators.js");
  const cases = [
    { label: "缺参 diffraction_limit", type: "diffraction_limit", params: {} },
    { label: "缺参 tolerance_rss", type: "tolerance_rss", params: {} },
    { label: "非法 NA=0", type: "diffraction_limit", params: { lambda_nm: 550, NA: 0 } },
    { label: "非法负波长", type: "na_resolution", params: { lambda_nm: -1, NA: 0.95 } },
    { label: "非法 tolerances 类型", type: "tolerance_rss", params: { tolerances: "bad" } },
  ];
  for (const c of cases) {
    let v;
    try {
      v = await execCalc(c.type, c.params);
    } catch (e) {
      assert.fail(c.label + "：execute 抛出异常（应返回结构化 ok:false 对象）：" + (e && e.message ? e.message : String(e)));
    }
    assertCalcShape(v, c.label);
    assert.equal(v.ok, false, c.label + "：应返回 ok=false，实际 ok=" + v.ok);
    assert.equal(typeof v.error, "string", c.label + "：应含 error 说明");
    assert.ok(v.error.length > 0, c.label + "：error 不应为空");
    if ("suggestion" in v) assert.equal(typeof v.suggestion, "string", c.label + "：suggestion 应为字符串");
  }
});

test("D6b 未知 type：工具层由 enum 干净拒绝，计算器层 calculate() 返回 ok:false 不抛", async () => {
  await booted;
  const m = requireModule(calculators, "lib/calculators.js");
  // 1) 工具层：parameters.type 是 enum，未知 type 会被真实 defineTool 的参数校验拦截。
  //    这是框架层的合法行为（不是崩溃）：抛出的应是带 enum 说明的 ToolArgsError，
  //    而不是 TypeError / 未捕获异常。
  let toolErr = null;
  try {
    await execCalc("not_a_calculator", {});
  } catch (e) {
    toolErr = e;
  }
  assert.ok(toolErr, "未知 type 应被工具的 enum 参数校验拒绝（不应静默执行）");
  assert.ok(/type.*one of|must be one of|enum|invalid arguments/i.test(toolErr.message),
    "未知 type 的拒绝信息应说明 enum 约束，实际：" + toolErr.message);
  // 2) 计算器契约层：calculate() 对未知 type 必须返回结构化 ok:false、绝不抛异常。
  let v;
  try {
    v = await m.calculate("not_a_calculator", {});
  } catch (e) {
    assert.fail("calculate(未知 type) 抛异常（契约要求绝不抛异常）：" + (e && e.message ? e.message : String(e)));
  }
  assert.ok(v && typeof v === "object", "calculate(未知 type) 应返回对象");
  assert.equal(v.ok, false, "calculate(未知 type) 应为 ok=false");
  for (const f of ["type", "ok", "formula", "substitution", "steps", "result", "source"]) {
    assert.ok(f in v, "calculate(未知 type) 返回对象缺少字段 " + f);
  }
  assert.equal(typeof v.error, "string", "应含 error 说明");
  assert.ok(v.error.length > 0, "error 不应为空");
  assert.equal(typeof v.suggestion, "string", "应含 suggestion 合理建议");
});

test("D7 calculate() 直接调用也不抛异常（契约：任何分支返回同一形状）", async () => {
  await booted;
  const m = requireModule(calculators, "lib/calculators.js");
  assert.equal(typeof m.calculate, "function", "lib/calculators.js 未导出 calculate");
  for (const [type, params] of [["unknown_type", {}], ["diffraction_limit", {}], ["na_resolution", null], ["tolerance_rss", { tolerances: "bad" }]]) {
    let v;
    try { v = await m.calculate(type, params); }
    catch (e) { assert.fail("calculate(" + type + ") 抛异常：" + (e && e.message ? e.message : String(e))); }
    assert.ok(v && typeof v === "object", "calculate 应返回对象");
    for (const f of ["type", "ok", "formula", "substitution", "steps", "result", "source"]) {
      assert.ok(f in v, "calculate(" + type + ") 返回对象缺少字段 " + f);
    }
    assert.equal(v.ok, false, "calculate(" + type + ") 应为 ok=false");
  }
});

// =====================================================================
// E. 数据源文件一致性（kb-data.json 与 kb-data-full.json）
// =====================================================================
test("E1 内置 67 块数据与源 kb-data-full.json 一致", async () => {
  await booted;
  const builtinPath = path.join(PLUGIN, "data", "kb-data.json");
  const sourcePath = "D:/AI/OpticsGPT/opticsgpt-space/kb-data-full.json";
  assert.ok(fs.existsSync(builtinPath), "内置数据文件不存在：" + builtinPath);
  assert.ok(fs.existsSync(sourcePath), "源数据文件不存在：" + sourcePath);
  const builtin = JSON.parse(fs.readFileSync(builtinPath, "utf8"));
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  assert.equal(builtin.length, 67, "内置数据应为 67 块");
  assert.equal(source.length, 67, "源数据应为 67 块");
  const pick = (r) => [r.doc_id, r.chunk_id, r.status, r.text, r.source, r.page_or_section, r.keywords_zh, String(r.is_original_excerpt), String(r.disclaimer)].join("\u0001");
  const a = builtin.map(pick).sort();
  const b = source.map(pick).sort();
  assert.deepEqual(a, b, "内置 67 块与源 kb-data-full.json 内容不一致（逐字段比对）");
});

// 收尾：清理依赖抽取缓存（只删测试自己生成的目录，不碰任何源码）
process.on("beforeExit", () => {
  if (RUNTIME && fs.existsSync(RUNTIME.cacheDir)) {
    try {
      fs.rmSync(RUNTIME.cacheDir, { recursive: true, force: true });
      console.log("[OpticForge 集成测试] 已清理临时依赖缓存：" + RUNTIME.cacheDir);
    } catch (e) {
      console.warn("[OpticForge 集成测试] 缓存清理失败（不影响测试结果）：" + (e && e.message ? e.message : String(e)));
    }
  }
});
