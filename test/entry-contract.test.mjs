// OpticForge 入口契约测试（node:test）——直接运行：node test/entry-contract.test.mjs
// 只守两件事：
//   E1/E2  五工具注册与定义形状不变（opticforge_search/get/docs/assist/verify）；
//   E3     opticforge_assist 是光电任务第一入口，且 KB 对齐前禁止外部搜索的门禁措辞存在；
//   E4     架构文档把「先 KB 后联网」契约与公式卡片只读集成写死。
// 全程只读源码与文档，不联网、不写文件、不依赖 DSH 安装目录。
// 与 test/run.mjs 互不依赖：本文件独立可运行，run.mjs 不引用本文件。
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, "..");
const idxUrl = pathToFileURL(path.join(PLUGIN, "lib", "index.js")).href;

const EXPECTED_TOOLS = [
  "opticforge_assist",
  "opticforge_docs",
  "opticforge_get",
  "opticforge_search",
  "opticforge_verify",
].sort();

let plugin;
let registered;

async function boot() {
  plugin = await import(idxUrl);
  const defs = [];
  // 最小 ctx：只收集 register 的定义，不 import 任何 @deepseek-ai 包。
  const ctx = { tools: { register(def) { defs.push(def); } } };
  plugin.apply(ctx);
  registered = defs;
}
const booted = boot();

function tool(name) {
  const t = registered.find((d) => d.name === name);
  assert.ok(t, "lib/index.js 未注册工具 " + name + "（当前注册：" + registered.map((d) => d.name).join(",") + "）");
  return t;
}

// =====================================================================
// E1/E2：五工具注册与定义形状不变
// =====================================================================
test("E1 插件导出与五工具注册不变", async () => {
  await booted;
  assert.equal(typeof plugin.apply, "function", "lib/index.js 未导出 apply");
  assert.equal(plugin.name, "opticforge", "lib/index.js name 应为 opticforge");
  assert.deepEqual(plugin.inject, ["tools"], "lib/index.js inject 应为 [tools]");
  assert.equal(registered.length, 5, "应恰好注册 5 个工具，实际 " + registered.length);
  assert.deepEqual(
    registered.map((d) => d.name).sort(),
    EXPECTED_TOOLS,
    "注册工具集合漂移：" + registered.map((d) => d.name).join(",")
  );
});

test("E2 五工具定义形状不变：execute/description/parameters/output.render", async () => {
  await booted;
  for (const t of registered) {
    assert.equal(typeof t.execute, "function", t.name + ".execute 必须是函数");
    assert.equal(typeof t.description, "string", t.name + " 缺少 description");
    assert.ok(t.description.length > 10, t.name + " description 过短");
    assert.ok(t.parameters && typeof t.parameters === "object", t.name + " 缺少 parameters");
    assert.equal(t.parameters.type, "object", t.name + ".parameters.type 应为 object");
    assert.ok(t.output && typeof t.output.render === "function", t.name + " 缺少 output.render");
  }
});

// =====================================================================
// E3：assist 第一入口 + verdict 只表覆盖度 + web_gate 三段放行条件
// =====================================================================
test("E3 assist 是光电任务第一入口，verdict 只表覆盖度，联网须 web_gate 三段放行", async () => {
  await booted;
  const assist = tool("opticforge_assist");
  const d = assist.description;

  // ① 第一入口：任何光电任务都应先经过 assist。
  assert.match(d, /第一入口/, "assist 描述必须声明自己是光电/光学任务第一入口");

  // ② 前置：先 KB 对齐；verdict 只表达覆盖度，不放行联网。
  assert.match(d, /KB\s*对齐/, "assist 描述必须声明 KB 对齐（alignment）是前置步骤");
  assert.match(d, /alignment\.verdict/, "assist 描述必须点名 alignment.verdict");
  assert.match(d, /覆盖度/, "assist 描述必须明确 alignment.verdict 只表达 KB 覆盖度");

  // ③ 联网门禁：web_gate 默认禁网，三段放行缺一不可。
  assert.match(d, /web_gate/, "assist 描述必须声明 web_gate 门禁");
  assert.match(d, /默认禁网|默认拒绝/, "assist 描述必须声明 web_gate 默认禁网");
  assert.match(d, /web_gate\.allowed/, "assist 描述必须把 web_gate.allowed=true 作为放行前提");
  assert.match(d, /granted/, "assist 描述必须把对应 condition.granted=true 作为放行前提");
  assert.match(d, /blocked_by/, "assist 描述必须把步骤 blocked_by 解除作为放行前提");

  // ④ 点名被门禁约束的外部检索工具，并用禁止性措辞。
  assert.match(d, /general_search/, "assist 描述必须点名 general_search 受门禁约束");
  assert.match(d, /web_search/, "assist 描述必须点名 web_search 受门禁约束");
  assert.match(d, /web_fetch/, "assist 描述必须点名 web_fetch 受门禁约束");
  assert.match(d, /(不得调用|不应调用|禁止调用)/, "assist 描述必须用禁止性措辞约束门禁未放行时的联网检索");

  // ⑤ 放行条件白名单。
  assert.match(d, /KB\s*gap/, "assist 描述须注明 KB gap 是放行条件之一");
});

// =====================================================================
// E4：架构文档把契约写死（静态守护，防止文档漂移）
// =====================================================================
test("E4 架构文档记录「先 KB 后联网」契约与公式卡片只读集成", () => {
  const doc = readFileSync(path.join(PLUGIN, "docs", "ARCHITECTURE.zh.md"), "utf8");
  for (const marker of [
    "先知识库、后联网",
    "alignment",
    "kb_queries",
    "matched",
    "unmatched",
    "coverage_matrix",
    "verdict",
    "covered",
    "partial",
    "gap",
    "web_gate",
    "default_deny_explicit_allowlist",
    "kb_gap",
    "standard_version",
    "vendor_params",
    "price_timeliness",
    "blocked_by",
    "gate_id",
    "gated",
    "web_gated",
    "external_queries",
    "formula-cards.json",
    "calc_specs",
    "domains",
    "keywords",
    "source_chunk_ids",
    "worked_example",
    "match_reason",
  ]) {
    assert.ok(doc.includes(marker), "docs/ARCHITECTURE.zh.md 缺少契约标记：" + marker);
  }
});

// =====================================================================
// E5：opticforge_verify 描述契约——KB 对齐段 / 外部 URL / formula_id
// =====================================================================
test("E5 opticforge_verify 描述包含三项新增自检契约", async () => {
  await booted;
  const v = tool("opticforge_verify");
  const d = v.description;

  // ① KB 对齐段检查：须有「KB 对齐」段与 covered/partial/gap 判定。
  assert.match(d, /KB\s*对齐/, "verify 描述须包含 KB 对齐段检查");
  assert.match(d, /covered.*partial.*gap|covered\/partial\/gap/, "verify 描述须提及 covered/partial/gap 判定");

  // ② 外部 URL 检查：访问日期 + 厂商/型号/标准号。
  assert.match(d, /URL/i, "verify 描述须包含外部 URL 检查");
  assert.match(d, /日期/, "verify 描述须要求外部来源带访问日期");
  assert.match(d, /(型号|标准号)/, "verify 描述须要求厂商/型号/标准号等来源细节");

  // ③ formula_id 与计算轨迹检查。
  assert.match(d, /formula_id/, "verify 描述须包含 formula_id 检查");
  assert.match(d, /计算轨迹/, "verify 描述须包含计算轨迹检查");
});
