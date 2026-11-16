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

async function boot() {
  plugin = await import(idxUrl);
  const defs = [];
  const ctx = { tools: { register(def) { defs.push(def); } } };
  plugin.apply(ctx);
  registered = defs;
  // 模块读取失败时保留 null，让用例给出清晰失败信息
  try { kbData = await import(pathToFileURL(path.join(LIB, "kb-data.js")).href); } catch { kbData = null; }
  try { kbEngine = await import(pathToFileURL(path.join(LIB, "kb-engine.js")).href); } catch { kbEngine = null; }
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
test("A1 插件可加载：apply/inject/name 正确，注册 3 个工具", async () => {
  await booted;
  assert.equal(typeof plugin.apply, "function", "lib/index.js 未导出 apply");
  assert.equal(plugin.name, "opticforge", "lib/index.js name 应为 opticforge");
  assert.deepEqual(plugin.inject, ["tools"], "lib/index.js inject 应为 [tools]");
  assert.equal(registered.length, 3, "应恰好注册 3 个工具，实际 " + registered.length);
  assert.deepEqual(
    registered.map((d) => d.name).sort(),
    ["opticforge_docs", "opticforge_get", "opticforge_search"]
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
// B. 统计断言：264 块 / 248 present
// =====================================================================
test("B1 KB 统计：324 块、308 present、状态分布与板块分布", async () => {
  await booted;
  const m = requireModule(kbData, "lib/kb-data.js");
  assert.equal(m.TOTAL_CHUNKS, 324, "kb-data.js TOTAL_CHUNKS 应为 324");
  assert.equal(m.PRESENT_CHUNKS, 308, "kb-data.js PRESENT_CHUNKS 应为 308");
  assert.equal(typeof m.KB_SOURCE, "string", "kb-data.js KB_SOURCE 应为非空字符串");
  const chunks = await m.getKBData();
  assert.ok(Array.isArray(chunks), "getKBData() 应返回数组");
  assert.equal(chunks.length, 324, "getKBData() 应返回 324 块，实际 " + chunks.length);
  const statuses = {};
  const docs = {};
  for (const c of chunks) {
    statuses[c.status] = (statuses[c.status] || 0) + 1;
    docs[c.doc_id] = (docs[c.doc_id] || 0) + 1;
    for (const f of ["doc_id", "chunk_id", "status", "text", "source", "page_or_section", "keywords_zh"]) {
      assert.ok(f in c, "第 " + c.chunk_id + " 块缺少字段 " + f);
    }
  }
  assert.equal(statuses.present, 308, "present 应为 308 块");
  assert.equal(statuses.missing_source, 11, "missing_source 应为 11 块");
  assert.equal(statuses.substitute, 5, "substitute 应为 5 块");
  // 原有九个板块的分布不得漂移
  for (const [id, n] of Object.entries({ A01: 13, A02: 9, A03: 1, B01: 11, B02: 4, C01: 5, C02: 7, D01: 11, E01: 6 })) {
    assert.equal(docs[id], n, "板块 " + id + " 块数应为 " + n + "，实际 " + docs[id]);
  }
  // 新增系列的规模（F 基础 / G 工程 / H 前沿 / I 场景深化）
  const sum = (prefix) => Object.entries(docs).filter(([k]) => k.startsWith(prefix)).reduce((a, [, n]) => a + n, 0);
  assert.equal(sum("F"), 83, "F 系列应为 83 块，实际 " + sum("F"));
  assert.equal(sum("G"), 53, "G 系列应为 53 块，实际 " + sum("G"));
  assert.equal(sum("H"), 61, "H 系列应为 61 块，实际 " + sum("H"));
  assert.equal(sum("I"), 60, "I 系列应为 60 块，实际 " + sum("I"));
  assert.equal(Object.keys(docs).length, 40, "板块总数应为 40，实际 " + Object.keys(docs).length);
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

test("C6 知识空白如实告知：「空间光学 热控」返回空且 note=「知识库中未找到相关依据」", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "空间光学 热控 仿真" });
  assertOutputShape("opticforge_search", value);
  assert.equal(value.total_hits, 0,
    "知识空白查询「空间光学 热控」应返回空结果，实际 total_hits=" + value.total_hits + "，命中: " + JSON.stringify(value.results.map((r) => r.chunk_id + "(" + r.score + ")")) + "；应由 lib/index.js 的 isZeroCoverageQuery(query,chunks) 数据驱动守卫短路（topicHasPresentBasis 在 present 块可检索字段中 0 出现才成立），本用例按规范硬断言不静默跳过；H1 回归见 C6b/C6c/C6d。");
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

test("C6d H1 回归：真 0 覆盖主题仍短路（光刻工艺 在 present 块 0 出现）", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const value = await execSearch({ query: "光刻工艺 光刻胶 涂胶" });
  assertOutputShape("opticforge_search", value);
  assert.equal(value.total_hits, 0,
    "『光刻工艺』在 present 块可检索字段中 0 出现，应仍短路为空；实际命中：" +
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
// D. opticforge_docs / opticforge_get 端到端（板块目录与完整条目）
// =====================================================================
test("D1 opticforge_docs：40 个板块、逐块列出 chunk_id 与标题", async () => {
  await booted;
  const v = await tool("opticforge_docs").execute({}, {});
  assertOutputShape("opticforge_docs", v);
  assert.equal(v.ok, true, "docs 应返回 ok=true");
  assert.equal(v.action, "docs");
  assert.equal(v.total_docs, 40, "应列出 40 个板块，实际 " + v.total_docs);
  const a01 = v.docs.find((d) => d.doc_id === "A01");
  assert.ok(a01, "缺少 A01 板块");
  assert.equal(a01.chunks, 13, "A01 应为 13 块");
  assert.equal(a01.present, 12, "A01 应为 12 条 present");
  assert.ok(Array.isArray(a01.items) && a01.items.length === 13, "docs 应逐块列出 items");
  const withTitle = a01.items.filter((i) => typeof i.title === "string" && i.title.length > 0);
  assert.ok(withTitle.length >= 12, "items 应带标题（从 text 的【】提取），实际带标题 " + withTitle.length + " 条");
  // 基础、前沿与 0.2.1 场景深化板块都要出现
  assert.ok(v.docs.some((d) => d.doc_id === "F01"), "缺少 F01（基础理论板块）");
  assert.ok(v.docs.some((d) => d.doc_id === "H08"), "缺少 H08（前沿板块）");
  assert.ok(v.docs.some((d) => d.doc_id === "I06"), "缺少 I06（0.2.1 分光系统设计板块）");
});

test("D2 opticforge_docs：doc_filter 生效，未知板块干净报错", async () => {
  await booted;
  const one = await tool("opticforge_docs").execute({ doc_id: "f02" }, {});
  assert.equal(one.ok, true, "小写板块名应被规范化为大写后命中");
  assert.equal(one.total_docs, 1);
  assert.equal(one.docs[0].doc_id, "F02");
  const bad = await tool("opticforge_docs").execute({ doc_id: "Z99" }, {});
  assert.equal(bad.ok, false, "未知板块应返回 ok=false");
  assert.equal(bad.error, "没有该板块");
  assert.ok(Array.isArray(bad.available) && bad.available.length >= 34, "应回显可用板块清单");
});

test("D3 opticforge_get：返回 9 个字段的完整条目；不存在的 chunk_id 干净报错", async () => {
  await booted;
  const full = await tool("opticforge_get").execute({ chunk_id: "F01-01" }, {});
  assert.equal(full.ok, true);
  assert.equal(full.action, "get");
  for (const f of ["doc_id", "chunk_id", "status", "is_original_excerpt", "text", "source", "page_or_section", "keywords_zh", "disclaimer"]) {
    assert.ok(f in full, "get 返回缺少字段 " + f);
  }
  assert.equal(full.status, "present");
  assert.ok(full.text.length >= 300, "编译型条目正文应 ≥300 字");
  const miss = await tool("opticforge_get").execute({ chunk_id: "A99-99" }, {});
  assert.equal(miss.ok, false, "不存在的 chunk_id 应返回 ok=false");
  assert.equal(miss.error, "知识库中不存在该 chunk_id");
  assert.ok(Array.isArray(miss.known_prefixes), "应回显已知板块前缀");
});

test("D4 opticforge_get：非 present 块如实标注为缺口，不当依据", async () => {
  await booted;
  const v = await tool("opticforge_get").execute({ chunk_id: "A03-01" }, {});
  assert.equal(v.ok, true, "缺口块仍应可读取（用于说明缺什么）");
  assert.notEqual(v.status, "present", "A03-01 应为缺口块");
  assert.ok(typeof v.note === "string" && /缺口|不可当作事实依据/.test(v.note),
    "缺口块应带 note 说明不可作为依据，实际：" + v.note);
});

test("D5 编译型板块可被检索：几何光学与干涉衍射主题命中 F/I 系列", async () => {
  await booted;
  requireModule(kbEngine, "lib/kb-engine.js");
  const geo = await execSearch({ query: "薄透镜 成像公式 放大率", top_k: 5 });
  assert.ok(geo.total_hits > 0, "几何光学查询应命中");
  assert.ok(geo.results.some((r) => ["F01", "I01"].includes(r.doc_id)), "应命中 F01/I01，实际：" + JSON.stringify(geo.results.map((r) => r.chunk_id)));
  const diff = await execSearch({ query: "艾里斑 衍射 分辨", top_k: 5 });
  assert.ok(diff.total_hits > 0, "衍射查询应命中");
  assert.ok(diff.results.some((r) => ["F02", "F01", "I02"].includes(r.doc_id)), "应命中 F02/F01/I02，实际：" + JSON.stringify(diff.results.map((r) => r.chunk_id)));
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
  assert.ok(parts.length >= 40, "分板块文件应至少 40 个，实际 " + parts.length);
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
