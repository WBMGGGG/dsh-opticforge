// OpticForge 集成测试（node:test）——直接运行：node test/run.mjs
// 全程只读源码，不写任何缓存、不依赖 DSH 安装目录。
// 设计要点：插件走原生 JSON Schema 注册（不 import 任何 @deepseek-ai 包），
// 所以这里用最小 ctx 收集 ctx.tools.register 的定义，直接对定义形状、参数校验、
// 端到端检索与计算做断言。
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, "..");
const LIB = path.join(PLUGIN, "lib");
const idxUrl = pathToFileURL(path.join(LIB, "index.js")).href;

let plugin;
let registered;
let kbData;
let kbEngine;
let calculators;

async function boot() {
  plugin = await import(idxUrl);
  const defs = [];
  const ctx = { tools: { register(def) { defs.push(def); } } };
  plugin.apply(ctx);
  registered = defs;
  // 模块读取失败时保留 null，让用例给出清晰失败信息
  try { kbData = await import(pathToFileURL(path.join(LIB, "kb-data.js")).href); } catch { kbData = null; }
  try { kbEngine = await import(pathToFileURL(path.join(LIB, "kb-engine.js")).href); } catch { kbEngine = null; }
  try { calculators = await import(pathToFileURL(path.join(LIB, "calculators.js")).href); } catch { calculators = null; }
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
// A. 原生注册契约校验（不依赖 @deepseek-ai/dsh-tools）
// =====================================================================
test("A1 插件可加载：apply/inject/name 正确，注册 4 个工具", async () => {
  await booted;
  assert.equal(typeof plugin.apply, "function", "lib/index.js 未导出 apply");
  assert.equal(plugin.name, "opticforge", "lib/index.js name 应为 opticforge");
  assert.deepEqual(plugin.inject, ["tools"], "lib/index.js inject 应为 [tools]");
  assert.equal(registered.length, 4, "应恰好注册 4 个工具，实际 " + registered.length);
  assert.deepEqual(
    registered.map((d) => d.name).sort(),
    ["opticforge_calc", "opticforge_docs", "opticforge_get", "opticforge_search"]
  );
});

test("A2 工具定义合法：parameters 是标准 JSON Schema，output.schema/render 齐备", async () => {
  await booted;
  for (const t of registered) {
    assert.equal(typeof t.execute, "function", t.name + ".execute 必须是函数");
    assert.equal(typeof t.description, "string", t.name + " 缺少 description");
    assert.ok(t.description.length > 10, t.name + " description 过短");

    const p = t.parameters;
    assert.ok(p && typeof p === "object", t.name + " 缺少 parameters");
    assert.equal(p.type, "object", t.name + ".parameters.type 应为 object");
    assert.equal(typeof p.properties, "object", t.name + ".parameters.properties 缺失");
    // 每个属性只能有标准 JSON Schema 关键字，不能残留内部 DSL 的 required 布尔位
    for (const [key, node] of Object.entries(p.properties)) {
      assert.ok(node && typeof node === "object", t.name + "." + key + " 属性定义非法");
      assert.notEqual(typeof node.required, "boolean", t.name + "." + key + " 残留 DSL 的 required 布尔位");
      if (node.type) assert.ok(["string", "number", "integer", "boolean", "array", "object"].includes(node.type), t.name + "." + key + " 未知 type");
      if (node.enum) assert.ok(Array.isArray(node.enum) && node.enum.length > 0, t.name + "." + key + " enum 应为非空数组");
    }
    // required 必须是 properties 里存在的名字
    for (const r of p.required || []) assert.ok(r in p.properties, t.name + " required 里的 " + r + " 不在 properties");

    assert.ok(t.output && typeof t.output === "object", t.name + " 缺少 output");
    assert.ok(t.output.schema, t.name + " 缺少 output.schema");
    assert.equal(typeof t.output.render, "function", t.name + ".output.render 必须是函数");
    const rendered = t.output.render({}, { ok: true });
    assert.ok(Array.isArray(rendered), t.name + ".output.render 应返回数组");
    assert.equal(rendered[0].type, "text", t.name + ".output.render 首项 type 应为 text");
    assert.equal(typeof rendered[0].text, "string", t.name + ".output.render 首项 text 应为字符串");
  }
});

// output.schema 是注解形式（不限字段），这里只确认 execute 返回值是可序列化的对象
function assertOutputShape(name, value) {
  assert.ok(value && typeof value === "object", name + " 的 execute 应返回对象，实际 " + typeof value);
  assert.doesNotThrow(() => JSON.stringify(value), name + " 的返回值应可 JSON 序列化");
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
  assertOutputShape("opticforge_search", value);
  assert.equal(value.query, "共焦色散 测量原理");
  assert.ok(value.total_hits > 0, "应命中 A01 相关知识块，实际 total_hits=0");
  assert.equal(value.total_hits, value.results.length, "total_hits 应等于 results.length");
  assert.ok(value.results.some((r) => r.doc_id === "A01"), "结果中应含 doc_id=A01：" + JSON.stringify(value.results.map((r) => r.chunk_id)));
  for (const r of value.results) {
    assert.equal(r.status, "present", "检索结果不应出现 status!==present 的块：" + r.chunk_id);
    assert.ok(r.score > 0, "命中分数应为正数：" + r.chunk_id);
    assert.ok(r.excerpt.length <= 520, "excerpt 应在 520 字以内（标题 + 命中词窗口）：" + r.chunk_id);
    assert.ok(r.excerpt.length > 0, "excerpt 不应为空：" + r.chunk_id);
    assert.ok(Array.isArray(r.matched_terms), "应回显命中词 matched_terms：" + r.chunk_id);
    assert.ok(typeof r.chars === "number" && r.chars > 0, "应回显条目长度 chars：" + r.chunk_id);
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
  assertOutputShape("opticforge_search", value);
  assert.ok(value.total_hits > 0, "应命中 RCWA 相关知识块");
  assert.ok(value.results.some((r) => r.doc_id === "C02"), "结果中应含 doc_id=C02：" + JSON.stringify(value.results.map((r) => r.chunk_id)));
  for (const r of value.results) assert.equal(r.status, "present");
});

test("C3 doc_filter 生效：结果全部属于指定 doc_id", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "共焦色散 测量原理", top_k: 20, doc_filter: "A01" });
  assertOutputShape("opticforge_search", value);
  assert.ok(value.total_hits > 0, "doc_filter=A01 时应仍有命中");
  for (const r of value.results) {
    assert.equal(r.doc_id, "A01", "doc_filter=A01 却返回了 " + r.doc_id + " 的块：" + r.chunk_id);
    assert.equal(r.status, "present");
  }
  const c02 = await execSearch({ query: "共焦色散 测量原理", top_k: 20, doc_filter: "C02" });
  assertOutputShape("opticforge_search", c02);
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
  assertOutputShape("opticforge_search", v1);
  assertOutputShape("opticforge_search", v3);
  assertOutputShape("opticforge_search", v20);
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
  assertOutputShape("opticforge_search", value);
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
  assertOutputShape("opticforge_search", value);
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
  assertOutputShape("opticforge_search", value);
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
  assertOutputShape("opticforge_search", value);
  assert.equal(value.total_hits, 0,
    "『白光干涉』在 present 块可检索字段中 0 出现，应仍短路为空；实际命中：" +
    JSON.stringify(value.results.map((r) => r.chunk_id)));
  assert.equal(value.note, "知识库中未找到相关依据");
});

test("C7 生僻无意义词未命中时同样如实告知", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "zzzqwerty_nonexistenttoken" });
  assertOutputShape("opticforge_search", value);
  assert.equal(value.total_hits, 0, "无意义生僻词不应命中");
  assert.equal(value.note, "知识库中未找到相关依据");
});

test("C8 分页与板块去重：offset 生效、total_matched 稳定、同一板块不超过 max_per_doc", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");

  const p1 = await execSearch({ query: "光栅 衍射 效率", top_k: 3, max_per_doc: 2 });
  const p2 = await execSearch({ query: "光栅 衍射 效率", top_k: 3, max_per_doc: 2, offset: 3 });
  assert.equal(p1.offset, 0, "默认 offset 应为 0");
  assert.equal(p2.offset, 3, "offset 应原样回显");
  assert.equal(p1.total_matched, p2.total_matched, "同一查询的 total_matched 不应随分页变化");
  assert.equal(p1.returned, p1.results.length, "returned 应等于本页条数");
  // 两页不应重复同一 chunk
  const ids1 = p1.results.map((r) => r.chunk_id);
  const ids2 = p2.results.map((r) => r.chunk_id);
  for (const id of ids2) assert.ok(!ids1.includes(id), "分页出现重复 chunk：" + id);
  // 同一板块限流
  for (const page of [p1, p2]) {
    const perDoc = {};
    for (const r of page.results) perDoc[r.doc_id] = (perDoc[r.doc_id] || 0) + 1;
    for (const [doc, n] of Object.entries(perDoc)) {
      assert.ok(n <= 2, "板块 " + doc + " 超过 max_per_doc=2，实际 " + n);
    }
  }
  assert.equal(typeof p1.has_more, "boolean", "应回显 has_more");
});

test("C9 统一输出信封：docs/get/search 共享 ok + kb_version + action", async () => {
  await booted;
  const docs = await tool("opticforge_docs").execute({}, {});
  const one = docs.docs[0];
  const firstChunkId = one.items[0].chunk_id;
  const got = await tool("opticforge_get").execute({ chunk_id: firstChunkId }, {});
  const hit = await execSearch({ query: "共焦 色散", top_k: 1 });

  for (const [name, v] of [["docs", docs], ["get", got], ["search", hit]]) {
    assert.equal(v.ok, true, name + " 应返回 ok=true");
    assert.equal(typeof v.kb_version, "string", name + " 应回显 kb_version");
    assert.ok(v.kb_version.length > 0, name + " 的 kb_version 不应为空");
    assert.ok(["docs", "get", "search"].includes(v.action), name + " 应回显 action，实际 " + v.action);
  }
  assert.equal(got.action, "get");
  assert.equal(hit.action, "search");
  assert.equal(docs.action, "docs");
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
  assertOutputShape("opticforge_calc", v);
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
  // 1) 工具层：parameters.type 是 enum，未知 type 由插件自己的参数校验拦截。
  //    这是合法行为（不是崩溃）：抛出的应是带可选值清单的普通 Error，
  //    而不是 TypeError / 未捕获异常。
  let toolErr = null;
  try {
    await execCalc("not_a_calculator", {});
  } catch (e) {
    toolErr = e;
  }
  assert.ok(toolErr, "未知 type 应被工具的 enum 参数校验拒绝（不应静默执行）");
  assert.ok(/取值必须是|one of|enum|invalid arguments/i.test(toolErr.message),
    "未知 type 的拒绝信息应列出可选值，实际：" + toolErr.message);
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
// E. 数据一致性：kb-data.json 必须等于 data/kb/*.json 的合并结果
// =====================================================================
test("E1 内置 kb-data.json 与 data/kb/*.json 合并结果逐字段一致", async () => {
  await booted;
  const fs = await import("node:fs");
  const crypto = await import("node:crypto");
  const builtinPath = path.join(PLUGIN, "data", "kb-data.json");
  assert.ok(fs.existsSync(builtinPath), "内置数据文件不存在：" + builtinPath);
  const builtin = JSON.parse(fs.readFileSync(builtinPath, "utf8"));

  const kbDir = path.join(PLUGIN, "data", "kb");
  assert.ok(fs.existsSync(kbDir), "缺少 data/kb 分板块目录");
  const parts = fs.readdirSync(kbDir).filter((f) => f.endsWith(".json")).sort();
  assert.ok(parts.length >= 9, "分板块文件应至少 9 个，实际 " + parts.length);
  const merged = [];
  for (const f of parts) merged.push(...JSON.parse(fs.readFileSync(path.join(kbDir, f), "utf8")));
  merged.sort((a, b) => (a.doc_id + a.chunk_id).localeCompare(b.doc_id + b.chunk_id));

  assert.equal(builtin.length, merged.length, "内置块数应等于分板块合并块数");
  const pick = (r) => [r.doc_id, r.chunk_id, r.status, r.is_original_excerpt, r.text, r.source, r.page_or_section, JSON.stringify(r.keywords_zh), r.disclaimer].join("\u0001");
  assert.deepEqual(builtin.map(pick), merged.map(pick), "kb-data.json 与 data/kb/*.json 合并结果不一致（先跑 node scripts/build-kb.mjs --all）");

  // 元数据指纹：kb-meta.json 的 sha256 必须与 kb-data.json 的实际内容匹配
  const metaPath = path.join(PLUGIN, "data", "kb-meta.json");
  assert.ok(fs.existsSync(metaPath), "缺少 data/kb-meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const sha = crypto.createHash("sha256").update(JSON.stringify(builtin)).digest("hex");
  assert.equal(meta.content_sha256, sha, "kb-meta.json 的 content_sha256 与 kb-data.json 实际内容不匹配");
  assert.equal(meta.total_chunks, builtin.length, "kb-meta.json total_chunks 不一致");
  assert.equal(meta.present_chunks, builtin.filter((c) => c.status === "present").length, "kb-meta.json present_chunks 不一致");
  assert.ok(Array.isArray(meta.zero_coverage_topics) && meta.zero_coverage_topics.length > 0, "kb-meta.json 缺少 zero_coverage_topics");
  assert.ok(Array.isArray(meta.covered_anchors) && meta.covered_anchors.length > 0, "kb-meta.json 缺少 covered_anchors");
});

// 测试不写任何缓存、不启动任何后台进程，无需收尾清理。
