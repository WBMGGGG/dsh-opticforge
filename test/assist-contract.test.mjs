// assist-contract.test.mjs —— assist 架构优化契约测试
// 直接运行：node test/assist-contract.test.mjs
// 不依赖 test/run.mjs、不联网、不读 DSH；通过注入 deps 直接测 buildAssist。
//
// 覆盖：
//   1. web_gate 默认禁网（无触发条件时 allowed=false）
//   2. 条件放行（KB gap / 标准版本 / 厂商参数 / 价格时效）
//   3. search_pack 区分 KB 查询与外部查询；外部查询带 gate_id/trigger/blocked_by
//   4. plan 依赖：所有专业步骤 blocked_by 指向 KB 取证步；web 步骤额外依赖 web_gate
//   5. data/formula-cards.json 缺失时降级为 calc_specs=[] 且不阻断
//   6. 注入公式卡 fixture 时，按领域匹配返回 calc_specs
//   7. alignment 字段齐全（kb_queries/matched/unmatched/coverage_matrix/verdict）

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, "..", "lib");
const assist = await import(pathToFileURL(path.join(LIB, "assist.js")).href);

// ---- 注入用假 KB：两条 present 块，按 query 命中其一 ----
function makeChunks() {
  return [
    {
      chunk_id: "A01-01", doc_id: "A01", status: "present",
      text: "【共焦色散原理】色散共焦探头按波长解码位移，不同波长聚焦在不同深度。",
      source: "internal", page_or_section: "A01.1", keywords_zh: ["共焦", "色散", "位移"],
      disclaimer: ""
    },
    {
      chunk_id: "F01-01", doc_id: "F01", status: "present",
      text: "【薄透镜公式】1/f = 1/u + 1/v，近轴条件下适用。",
      source: "internal", page_or_section: "F01.1", keywords_zh: ["薄透镜", "焦距"],
      disclaimer: ""
    }
  ];
}
function fakeSearchKB(chunks, query, k) {
  const q = String(query || "").toLowerCase();
  const hits = [];
  for (const c of chunks) {
    const blob = (c.text + " " + (c.keywords_zh || []).join(" ")).toLowerCase();
    let score = 0;
    for (const t of q.split(/\s+/)) if (t && blob.includes(t)) score += 1;
    if (score > 0) hits.push({ ...c, score });
  }
  return hits.slice(0, k || 5);
}
const fakeMeta = {
  kb_version: "1.2.0",
  zero_coverage_topics: ["空间光学", "光刻工艺"],
  covered_anchors: [],
  docs: [
    { doc_id: "A03", chunks: 1, present: 0 },
    { doc_id: "C01", chunks: 5, present: 0 },
    { doc_id: "E01", chunks: 6, present: 0 }
  ]
};
const emptyCaps = { skills: [], mcp_servers: [], notes: [] };

// 用真实 catalog（从 data/assist-playbooks.json 读），保证 playbook 触发词一致
const catalog = await assist.loadCatalog();

function baseDeps(overrides = {}) {
  return {
    chunks: makeChunks(),
    searchKB: fakeSearchKB,
    meta: fakeMeta,
    caps: emptyCaps,
    catalog,
    ...overrides
  };
}

// 永远命中的 searchKB：用于"KB 完全覆盖"场景，避免 kb_gap 误触发
function alwaysHitKB(chunks, query, k) {
  return [{ ...chunks[0], score: 1, query: String(query || "") }];
}

// ---- 1. 默认禁网：问题不带任何触发条件，且 KB 全覆盖 ----
test("C01 web_gate 默认禁网：纯技术问题无触发条件且 KB 全覆盖时 allowed=false", async () => {
  const v = await assist.buildAssist(
    { problem: "用近轴成像公式计算薄透镜焦距与物距像距的关系" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  assert.equal(v.ok, true);
  assert.ok(v.web_gate, "应输出 web_gate");
  assert.equal(v.web_gate.allowed, false, "无触发条件时应默认禁网，实际：" + v.web_gate.reason);
  assert.equal(v.web_gate.policy, "default_deny_explicit_allowlist");
  assert.ok(Array.isArray(v.web_gate.conditions) && v.web_gate.conditions.length === 4);
  for (const c of v.web_gate.conditions) {
    assert.ok(typeof c.id === "string" && typeof c.when === "string" && typeof c.granted === "boolean",
      "门禁条件字段不全：" + JSON.stringify(c));
  }
  // 所有 web 步骤 blocked=true
  const webSteps = v.plan.steps.filter((s) => s.web_gated);
  assert.ok(webSteps.length > 0, "应有 web 步骤");
  for (const s of webSteps) {
    assert.equal(s.blocked, true, s.id + " 门禁未放行时应 blocked=true");
    assert.ok(s.blocked_by.includes("web_gate"), s.id + " 应依赖 web_gate");
    assert.ok(s.blocked_by.includes(v.plan.kb_evidence_step), s.id + " 应依赖 KB 取证步");
  }
  // execution_contract.must 明确禁网
  assert.ok(v.execution_contract.must.some((m) => /web_gate/.test(m)),
    "execution_contract.must 应提及 web_gate");
});

// ---- 2. 条件放行 ----
test("C02 条件放行：提及标准版本/厂商/预算时对应条件 granted=true", async () => {
  const vStd = await assist.buildAssist(
    { problem: "按 ISO 10110 光学图纸标注规范整理一份镜头图纸" },
    baseDeps()
  );
  assert.equal(vStd.web_gate.allowed, true, "提及 ISO 标准应放行");
  assert.ok(vStd.web_gate.conditions.find((c) => c.id === "standard_version").granted);

  const vVendor = await assist.buildAssist(
    { problem: "推荐一款工业相机探测器，给出型号和 datasheet 参数" },
    baseDeps()
  );
  assert.equal(vVendor.web_gate.allowed, true);
  assert.ok(vVendor.web_gate.conditions.find((c) => c.id === "vendor_params").granted);

  const vPrice = await assist.buildAssist(
    { problem: "预算 5 万元，做一套共焦位移测量方案，需要报价" },
    baseDeps()
  );
  assert.equal(vPrice.web_gate.allowed, true);
  assert.ok(vPrice.web_gate.conditions.find((c) => c.id === "price_timeliness").granted);
});

test("C02b KB gap 放行：KB 取证存在缺口时 kb_gap 条件命中", async () => {
  // 问题用 KB 里完全没有的词（"鬼像"不在 fake chunks 里），制造缺口
  const v = await assist.buildAssist(
    { problem: "分析光学系统鬼像与多次反射杂散光抑制方法" },
    baseDeps()
  );
  assert.ok(v.gaps.length > 0, "应有 KB 缺口");
  assert.ok(v.web_gate.conditions.find((c) => c.id === "kb_gap").granted,
    "存在缺口时 kb_gap 应 granted=true");
  assert.equal(v.web_gate.allowed, true);
});

// ---- 3. search_pack 区分 KB / 外部 ----
test("C03 search_pack 区分 KB 查询与外部查询", async () => {
  const v = await assist.buildAssist(
    { problem: "预算 5 万元，推荐一款工业相机探测器，给出型号和 datasheet 参数" },
    baseDeps()
  );
  assert.ok(Array.isArray(v.search_pack) && v.search_pack.length >= 4);
  const kbGroups = v.search_pack.filter((g) => g.scope === "kb");
  const extGroups = v.search_pack.filter((g) => g.scope === "external");
  assert.ok(kbGroups.length >= 1, "至少一个 KB 检索面");
  assert.ok(extGroups.length >= 1, "至少一个外部检索面");
  for (const g of kbGroups) {
    assert.equal(g.gate_id, null, "KB 检索面不应带 gate_id");
    assert.equal(g.blocked_by, null, "KB 检索面不应带外部依赖");
  }
  for (const g of extGroups) {
    assert.ok(typeof g.gate_id === "string", "外部检索面应带 gate_id");
    assert.ok(typeof g.trigger === "string" && g.trigger.length > 0, "外部检索面应带 trigger");
    assert.ok(Array.isArray(g.blocked_by) && g.blocked_by.includes("web_gate"),
      "外部检索面应 blocked_by 含 web_gate");
    assert.ok(g.blocked_by.includes("kb_evidence"), "外部检索面应依赖 KB 取证");
    assert.ok(Array.isArray(g.queries) && g.queries.length > 0);
  }
  // 顶层视图
  assert.ok(Array.isArray(v.kb_queries) && v.kb_queries.length > 0);
  assert.ok(Array.isArray(v.external_queries) && v.external_queries.length === extGroups.length);
});

// ---- 4. plan 依赖 ----
test("C04 plan：所有专业步骤 blocked_by 指向 KB 取证步；web 步骤额外依赖 web_gate", async () => {
  const v = await assist.buildAssist(
    { problem: "按 ISO 10110 光学图纸标注规范整理一份镜头图纸" },
    baseDeps()
  );
  const kbId = v.plan.kb_evidence_step;
  assert.ok(kbId, "应回显 kb_evidence_step");
  const kbStep = v.plan.steps.find((s) => s.id === kbId);
  assert.equal(kbStep.capability, "kb");
  // KB 步不能 blocked_by 自己
  assert.ok(!kbStep.blocked_by.includes(kbId), "KB 步不能依赖自己");
  // 每个非 KB、非 clarify 的步骤都应 blocked_by 含 kbId
  for (const s of v.plan.steps) {
    if (s.id === kbId) continue;
    if (s.capability === "clarify") continue;
    assert.ok(s.blocked_by.includes(kbId),
      s.id + " (" + s.phase + "/" + s.capability + ") 应 blocked_by 含 KB 取证步 " + kbId + "，实际 " + JSON.stringify(s.blocked_by));
  }
  // web 步骤必须同时 blocked_by web_gate
  for (const s of v.plan.steps.filter((x) => x.web_gated)) {
    assert.ok(s.blocked_by.includes("web_gate"), s.id + " web 步应依赖 web_gate");
    assert.ok(typeof s.gate_id === "string", s.id + " 应带 gate_id");
  }
  // 门禁放行时 web 步 blocked=false
  const webSteps = v.plan.steps.filter((s) => s.web_gated);
  assert.ok(webSteps.length > 0);
  for (const s of webSteps) assert.equal(s.blocked, false, "门禁放行时 web 步不应 blocked");
});

// ---- 5. 缺失公式卡降级 ----
test("C05 公式卡为空：calc_specs=[] 且不阻断", async () => {
  // 注入空数组模拟"文件缺失/未就绪"
  const v = await assist.buildAssist(
    { problem: "用薄透镜公式算焦距" },
    baseDeps({ formulaCards: [] })
  );
  assert.equal(v.ok, true);
  assert.deepEqual(v.calc_specs, [], "空公式卡应返回空 calc_specs");
});

// ---- 5b. 缺文件不永久缓存：loadFormulaCards 连续调用不抛错；注入等价"后补文件" ----
test("C05b 缺文件不永久缓存：loadFormulaCards 可重试且不抛错；后补注入即可命中", async () => {
  // 连续两次调用：文件可能存在也可能不存在，都应返回数组且不抛错
  const r1 = await assist.loadFormulaCards();
  const r2 = await assist.loadFormulaCards();
  assert.ok(Array.isArray(r1), "loadFormulaCards 应返回数组");
  assert.ok(Array.isArray(r2), "loadFormulaCards 第二次调用应返回数组");
  // 等价"文件后补"：先注入空，再注入有卡，buildAssist 第二次应命中
  const empty = await assist.buildAssist(
    { problem: "薄透镜 焦距 计算" },
    baseDeps({ formulaCards: [] })
  );
  assert.deepEqual(empty.calc_specs, []);
  const populated = await assist.buildAssist(
    { problem: "薄透镜 焦距 计算" },
    baseDeps({ formulaCards: [{
      id: "FC-LENS", title: "薄透镜高斯公式", formula: "1/f=1/u+1/v",
      variables: [{ symbol: "f", unit: "mm", meaning: "焦距" }],
      assumptions: [], sanity_range: "", worked_example: "u=200→f=100",
      domains: ["optical_design"], keywords: ["薄透镜"], source_chunk_ids: ["F01-01"]
    }] })
  );
  assert.equal(populated.calc_specs.length, 1, "后补公式卡应被加载并匹配");
  assert.equal(populated.calc_specs[0].card_id, "FC-LENS");
  assert.equal(populated.calc_specs[0].worked_example, "u=200→f=100");
});

// ---- 6. 公式卡匹配（注入 fixture）----
test("C06 公式卡匹配：注入 fixture 后按 domains/keywords 优先匹配，降级匹配兜底", async () => {
  const fixtureCards = [
    {
      id: "FC-LENS",
      title: "薄透镜高斯公式",
      formula: "1/f = 1/u + 1/v",
      variables: [
        { symbol: "f", unit: "mm", meaning: "焦距" },
        { symbol: "u", unit: "mm", meaning: "物距" },
        { symbol: "v", unit: "mm", meaning: "像距" }
      ],
      assumptions: ["近轴", "薄透镜"],
      sanity_range: "f>0",
      worked_example: "u=200, v=200 → f=100",
      domains: ["optical_design"],
      keywords: ["薄透镜", "焦距", "高斯公式"],
      source_chunk_ids: ["F01-01"]
    },
    {
      id: "FC-CONFOCAL",
      title: "色散共焦位移解码",
      formula: "d = k(λ - λ0)",
      variables: [
        { symbol: "d", unit: "mm", meaning: "位移" },
        { symbol: "λ", unit: "nm", meaning: "解码波长" }
      ],
      assumptions: ["线性标定区间内"],
      sanity_range: "|d|<量程",
      worked_example: "λ0=550nm, k=0.01",
      domains: ["confocal_sensing"],
      keywords: ["共焦", "色散", "位移"],
      source_chunk_ids: ["A01-01"]
    },
    {
      id: "FC-UNRELATED",
      title: "衍射光栅方程",
      formula: "d(sinα+sinβ)=mλ",
      variables: [{ symbol: "d", unit: "mm", meaning: "光栅常数" }],
      assumptions: [""],
      sanity_range: "",
      worked_example: "",
      domains: ["spectrometer"],
      keywords: ["光栅", "衍射"],
      source_chunk_ids: ["A02-01"]
    }
  ];
  const v = await assist.buildAssist(
    { problem: "用薄透镜公式算一个近轴镜头的焦距与放大率" },
    baseDeps({ formulaCards: fixtureCards })
  );
  assert.equal(v.ok, true);
  assert.ok(Array.isArray(v.calc_specs));
  const ids = v.calc_specs.map((c) => c.card_id);
  assert.ok(ids.includes("FC-LENS"), "应匹配到薄透镜公式卡，实际：" + JSON.stringify(ids));
  assert.ok(!ids.includes("FC-UNRELATED"), "不应匹配到无关公式卡");
  // 字段齐全
  const lens = v.calc_specs.find((c) => c.card_id === "FC-LENS");
  for (const f of ["card_id", "title", "formula", "variables", "assumptions", "sanity_range", "worked_example", "domains", "keywords", "source_chunk_ids", "match_reason"]) {
    assert.ok(f in lens, "calc_spec 缺少字段 " + f);
  }
  assert.equal(lens.worked_example, "u=200, v=200 → f=100", "应保留 worked_example");
  assert.ok(Array.isArray(lens.variables) && lens.variables.length === 3);
  // 优先命中 domains 或 keywords
  assert.ok(/domain|keyword/.test(lens.match_reason),
    "薄透镜卡应通过 domains/keywords 命中，实际 reason：" + lens.match_reason);
  // 不执行计算：没有数值字段
  assert.ok(!("result" in lens) && !("value" in lens), "calc_specs 不应包含计算结果");
});

// ---- 6b. domains 优先：同一问题领域标签直接命中 ----
test("C06b 公式卡 domains 优先匹配：confocal 问题命中 confocal_sensing 卡", async () => {
  const fixtureCards = [
    {
      id: "FC-CONFOCAL",
      title: "色散共焦位移解码",
      formula: "d = k(λ - λ0)",
      variables: [{ symbol: "d", unit: "mm", meaning: "位移" }],
      assumptions: [],
      sanity_range: "",
      worked_example: "",
      domains: ["confocal_sensing"],
      keywords: ["共焦"],
      source_chunk_ids: ["A01-01"]
    }
  ];
  const v = await assist.buildAssist(
    { problem: "色散共焦位移传感器的量程与分辨率怎么选？" },
    baseDeps({ formulaCards: fixtureCards })
  );
  assert.equal(v.calc_specs.length, 1);
  assert.ok(v.calc_specs[0].match_reason.includes("domain:confocal_sensing"),
    "应优先按 domains 命中，实际：" + v.calc_specs[0].match_reason);
});

// ---- 7. alignment 结构 ----
test("C07 alignment 字段齐全且 verdict 正确", async () => {
  const v = await assist.buildAssist(
    { problem: "用薄透镜公式算焦距" },
    baseDeps()
  );
  const a = v.alignment;
  assert.ok(a, "应输出 alignment");
  for (const f of ["kb_queries", "matched", "unmatched", "coverage_matrix", "verdict"]) {
    assert.ok(f in a, "alignment 缺少字段 " + f);
  }
  assert.ok(Array.isArray(a.kb_queries) && a.kb_queries.length > 0);
  assert.ok(Array.isArray(a.matched) && Array.isArray(a.unmatched));
  assert.ok(Array.isArray(a.coverage_matrix));
  assert.ok(["covered", "partial", "gap"].includes(a.verdict),
    "verdict 应为 covered/partial/gap 之一，实际：" + a.verdict);
  // coverage_matrix 与顶层 coverage_matrix 一致
  assert.deepEqual(a.coverage_matrix, v.coverage_matrix);
});

// ---- 7b. 零命中 verdict 明确为 "gap" ----
test("C07b 零命中时 verdict 为 gap（不是 gaps/covered/partial）", async () => {
  // searchKB 返回空 → 所有 aspect 都是 gap
  const emptyKB = () => [];
  const v = await assist.buildAssist(
    { problem: "薄透镜 焦距 计算" },
    baseDeps({ searchKB: emptyKB })
  );
  assert.equal(v.alignment.verdict, "gap",
    "零命中时 verdict 应为 gap，实际：" + v.alignment.verdict);
  assert.equal(v.alignment.matched.length, 0);
  assert.ok(v.alignment.unmatched.length > 0);
});

// ---- 8. 门禁拦截动作：默认禁网时 web 步动作里要有"禁止"提示 ----
test("C08 默认禁网时 web 步动作被替换为门禁拦截提示", async () => {
  const v = await assist.buildAssist(
    { problem: "用薄透镜公式算焦距" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  assert.equal(v.web_gate.allowed, false, "前置条件：应默认禁网");
  for (const s of v.plan.steps.filter((x) => x.web_gated)) {
    assert.equal(s.blocked, true);
    const blob = s.actions.join(" ");
    assert.ok(/禁止|未放行|blocked/i.test(blob),
      s.id + " 门禁拦截动作应包含禁止/未放行提示，实际：" + blob);
  }
});

// ---- 13. execution_contract.must 显式含第一入口与 alignment 前置禁网 ----
test("C13 execution_contract.must 含第一入口与 alignment 前置禁网条款", async () => {
  const v = await assist.buildAssist(
    { problem: "薄透镜 焦距 计算" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  const must = v.execution_contract.must;
  assert.ok(Array.isArray(must) && must.length >= 5);
  assert.ok(
    must.some((m) => /opticforge_assist.*第一入口/.test(m) && /alignment/.test(m) && /general_search|web_search|web_fetch/.test(m)),
    "must 应含 opticforge_assist 第一入口 + alignment 前置禁网条款，实际：" + JSON.stringify(must)
  );
  assert.ok(
    must.some((m) => /web_gate\.allowed=false/.test(m)),
    "must 应含 web_gate 禁网条款"
  );
});
test("C09 A03/C01/E01 原文缺口不变", async () => {
  const v = await assist.buildAssist(
    { problem: "共焦位移传感器选型" },
    baseDeps()
  );
  assert.deepEqual(
    v.library_gaps.map((g) => g.doc_id).sort(),
    ["A03", "C01", "E01"],
    "原文缺口应仍只有 A03/C01/E01"
  );
});

// ---- 10. 按 gate_id 逐门禁判定：仅 standard_version 命中时，kb_gap 步仍 blocked ----
test("C10 按 gate_id 逐门禁判定：仅 standard_version 命中时 kb_gap 步仍 blocked", async () => {
  // alwaysHitKB 保证无 KB 缺口；问题只提 ISO 标准，不提厂商/预算
  const v = await assist.buildAssist(
    { problem: "按 ISO 10110 规范做一个光学设计 图纸 标注" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  assert.equal(v.web_gate.allowed, true);
  assert.ok(v.web_gate.conditions.find((c) => c.id === "standard_version").granted);
  assert.equal(v.web_gate.conditions.find((c) => c.id === "kb_gap").granted, false, "KB 全覆盖时 kb_gap 不应命中");
  // playbook optical_design 含 web_search 步 gate_id=vendor_params；聚合步 gate_id=any
  for (const s of v.plan.steps.filter((x) => x.web_gated)) {
    if (s.gate_id === "kb_gap") {
      assert.equal(s.blocked, true, "kb_gap 步在无缺口时应 blocked");
    }
    if (s.gate_id === "vendor_params") {
      assert.equal(s.blocked, true, "vendor_params 步在无厂商词时应 blocked");
    }
  }
  // 聚合步 gate_id=any 应放行
  const anyStep = v.plan.steps.find((s) => s.web_gated && s.gate_id === "any");
  assert.ok(anyStep, "应有聚合外部核验步");
  assert.equal(anyStep.blocked, false);
  // 聚合步的 external_queries 不应混入 KB 检索面，且只含已放行外部查询
  for (const q of anyStep.external_queries || []) {
    assert.ok(typeof q === "string" && q.length > 0);
  }
  // KB 检索面（scope=kb）不应出现在任何 web 步的 external_queries
  const kbFacetQueries = v.search_pack.filter((g) => g.scope === "kb").flatMap((g) => g.queries);
  for (const s of v.plan.steps.filter((x) => x.web_gated)) {
    for (const q of s.external_queries || []) {
      assert.ok(!kbFacetQueries.includes(q), s.id + " 不应混入 KB 查询：" + q);
    }
  }
});

// ---- 11. web 步 external_queries 只含本 gate_id 已放行查询 ----
test("C11 web 步 external_queries 按 gate_id 隔离，不混入未放行/KB 查询", async () => {
  // 提厂商 + 预算，保证 vendor_params 与 price_timeliness 都命中
  const v = await assist.buildAssist(
    { problem: "预算 5 万元，推荐一款工业相机探测器型号与 datasheet 参数" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  assert.ok(v.web_gate.conditions.find((c) => c.id === "vendor_params").granted);
  const kbGroups = v.search_pack.filter((g) => g.scope === "kb").flatMap((g) => g.queries);
  for (const s of v.plan.steps.filter((x) => x.web_gated)) {
    // 未放行步 external_queries 必须为空
    if (s.blocked) {
      assert.deepEqual(s.external_queries, [], s.id + " 被 blocked 步不应带外部查询");
    }
    // 所有 external_queries 都不应是 KB 查询
    for (const q of s.external_queries || []) {
      assert.ok(!kbGroups.includes(q), s.id + " 混入 KB 查询：" + q);
    }
  }
});

// ---- 12. 公式卡分层优先级：domains 命中时不混入 fallback 诱饵卡 ----
test("C12 公式卡分层优先级：domains 命中时只返回 tier1，诱饵 fallback 卡不混入", async () => {
  const cards = [
    {
      id: "REAL", title: "薄透镜高斯公式", formula: "1/f=1/u+1/v",
      variables: [{ symbol: "f", unit: "mm", meaning: "焦距" }],
      assumptions: [], sanity_range: "", worked_example: "u=200→f=100",
      domains: ["optical_design"], keywords: ["薄透镜"],
      source_chunk_ids: ["F01-01"]
    },
    {
      id: "DECOY", title: "光栅方程", formula: "d(sinα+sinβ)=mλ",
      variables: [{ symbol: "d", unit: "mm", meaning: "光栅常数" }],
      assumptions: [], sanity_range: "", worked_example: "1200g/mm → 430nm",
      domains: ["spectrometer"], keywords: [],
      source_chunk_ids: ["F01-01"]
      // 诱饵：无 domains/keywords 命中，但 source_chunk_ids 与证据交集会触发 tier3 fallback
    }
  ];
  const v = await assist.buildAssist(
    { problem: "薄透镜 焦距 物距 像距" },
    baseDeps({ formulaCards: cards, searchKB: alwaysHitKB })
  );
  const ids = v.calc_specs.map((c) => c.card_id);
  assert.ok(ids.includes("REAL"), "应返回 REAL：" + JSON.stringify(ids));
  assert.ok(!ids.includes("DECOY"), "domains 命中时不应混入 fallback 诱饵卡，实际：" + JSON.stringify(ids));
});

// ---- 12b. 无 domains 命中时退到 keywords；keywords 命中时不混入 fallback ----
test("C12b 无 domains 命中时退到 keywords，仍不混入 fallback 卡", async () => {
  const cards = [
    {
      id: "KW_HIT", title: "某无关标题", formula: "x=y",
      variables: [], assumptions: [], sanity_range: "", worked_example: "",
      domains: [], keywords: ["薄透镜"],
      source_chunk_ids: []
    },
    {
      id: "FALLBACK_ONLY", title: "薄透镜公差表", formula: "Δ=...",
      variables: [], assumptions: [], sanity_range: "", worked_example: "",
      domains: [], keywords: [],
      source_chunk_ids: []
    }
  ];
  const v = await assist.buildAssist(
    { problem: "薄透镜 焦距 计算" },
    baseDeps({ formulaCards: cards, searchKB: alwaysHitKB })
  );
  const ids = v.calc_specs.map((c) => c.card_id);
  assert.ok(ids.includes("KW_HIT"), "keywords 层应命中 KW_HIT：" + JSON.stringify(ids));
  assert.ok(!ids.includes("FALLBACK_ONLY"), "keywords 命中时不应混入 fallback 卡，实际：" + JSON.stringify(ids));
});
