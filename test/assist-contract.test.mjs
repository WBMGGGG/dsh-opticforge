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
  kb_version: "3.1.1",
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

// ---- 14. 多剧本激活：交叉问题至少激活两个主题卡，且维度来自多卡 ----
test("C14 多剧本激活：高光谱装调定标同时激活 hyperspectral 与 testing_alignment", async () => {
  const v = await assist.buildAssist(
    { problem: "高光谱系统的装调与定标怎么做" },
    baseDeps()
  );
  const ids = v.brief.active_playbooks.map((p) => p.id);
  assert.ok(ids.includes("hyperspectral"), "应激活 hyperspectral，实际：" + JSON.stringify(ids));
  assert.ok(ids.includes("testing_alignment"), "应激活 testing_alignment，实际：" + JSON.stringify(ids));
  assert.ok(v.brief.active_playbooks.length >= 2, "交叉问题应激活 ≥2 张主题卡");
  for (const p of v.brief.active_playbooks) {
    assert.ok(Array.isArray(p.dimensions) && p.dimensions.length > 0, p.id + " 应回显维度");
    assert.ok(typeof p.score === "number");
  }
  // 维度去重合并：同 id 只出现一次
  const dimIds = v.dimensions.map((d) => d.id);
  assert.equal(new Set(dimIds).size, dimIds.length, "融合后维度 id 不应重复");
});

test("C14b 通用词不误激活：只说「光谱分辨率 5 nm」不应带进共焦剧本", async () => {
  const v = await assist.buildAssist(
    { problem: "设计一台 400-1000 nm 推扫式高光谱成像仪，光谱分辨率 5 nm" },
    baseDeps()
  );
  const ids = v.brief.active_playbooks.map((p) => p.id);
  assert.ok(ids.includes("hyperspectral"));
  assert.ok(!ids.includes("confocal_sensing"), "「分辨率」是通用词，不应单独激活共焦剧本，实际：" + JSON.stringify(ids));
  assert.ok(!ids.includes("imaging_camera"), "「成像」是通用词，不应单独激活相机剧本，实际：" + JSON.stringify(ids));
});

// ---- 15. 维度行与 维度×来源 覆盖矩阵 ----
test("C15 coverage_matrix 升为维度×来源：每行带 kb/web 两列且与 dimensions 同源", async () => {
  const v = await assist.buildAssist(
    { problem: "高光谱系统的装调与定标怎么做" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  assert.ok(Array.isArray(v.dimensions) && v.dimensions.length >= 6, "交叉任务应有 ≥6 个维度");
  assert.deepEqual(v.coverage_matrix, v.alignment.coverage_matrix, "顶层矩阵应与 alignment 一致");
  for (const row of v.coverage_matrix) {
    for (const f of ["id", "label", "status", "evidence", "hit_chunk_ids", "queries", "concept_cards", "gap_reason", "source_matrix"]) {
      assert.ok(f in row, "维度行缺少字段 " + f);
    }
    assert.equal(row.source_matrix.kb.status, "covered", row.id + " 在 alwaysHit 下 KB 应 covered");
    assert.ok(row.source_matrix.kb.hits > 0);
    assert.equal(row.source_matrix.web.status, "not_required");
  }
  assert.equal(v.alignment.source_summary.kb_covered, v.dimensions.length);
  assert.equal(v.alignment.source_summary.web_required, 0);
  for (const m of v.alignment.matched) {
    assert.ok(typeof m.dimension_id === "string" && m.dimension_id.length > 0, "matched 应带 dimension_id");
    assert.ok(Array.isArray(m.hit_chunk_ids));
  }
});

// ---- 16. 缺口 → 按维度的外部检索组 ----
test("C16 缺口维度生成中英双语外部检索组，带 dimension_id 与 kb_gap 门禁", async () => {
  const emptyKB = () => [];
  const v = await assist.buildAssist(
    { problem: "高光谱系统的装调与定标怎么做" },
    baseDeps({ searchKB: emptyKB })
  );
  assert.equal(v.alignment.verdict, "gap");
  const gapGroups = v.search_pack.filter((g) => g.dimension_id);
  assert.ok(gapGroups.length >= 2, "每个缺口维度都应有外部检索组");
  assert.equal(gapGroups.length, v.dimensions.length, "缺口数应与维度数一致");
  for (const g of gapGroups) {
    assert.equal(g.scope, "external");
    assert.equal(g.gate_id, "kb_gap");
    assert.ok(g.facet.includes("缺口·"), "面名应标缺口：" + g.facet);
    assert.ok(Array.isArray(g.queries) && g.queries.length >= 2, "应有中英双语查询");
    assert.ok(g.queries.some((q) => /[\u4e00-\u9fa5]/.test(q)) && g.queries.some((q) => /[a-zA-Z]/.test(q)), "应中英各一");
  }
  assert.equal(v.alignment.source_summary.web_required, v.dimensions.length);
  for (const row of v.coverage_matrix) assert.equal(row.source_matrix.web.status, "required");
  assert.ok(v.web_gate.conditions.find((c) => c.id === "kb_gap").granted, "有缺口应放行 kb_gap");
});

// ---- 17. plan：维度步、交叉步、coordinates_with 与并行约束 ----
test("C17 plan 带 dimension_id / 交叉复核步 / coordinates_with 且并行步不拆耦合", async () => {
  const v = await assist.buildAssist(
    { problem: "设计一台 400-1000 nm 推扫式高光谱成像仪，光谱分辨率 5 nm，含分光方案与指标预算" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  const plan = v.plan;
  assert.ok(Array.isArray(plan.cross_checks) && plan.cross_checks.length > 0, "应有交叉检查清单");
  const crossStep = plan.steps.find((s) => s.phase === "交叉复核");
  assert.ok(crossStep, "应有「交叉复核」步");
  assert.ok(crossStep.actions.length >= plan.cross_checks.length, "每条关系应有核对动作");
  assert.ok(crossStep.actions.every((a) => /核对/.test(a)), "交叉步动作应以「核对」开头");
  assert.ok(crossStep.output.includes("交叉检查"), "交叉步应输出 cross_checks");

  for (const s of plan.steps) {
    if (["澄清", "取证", "盘点", "缺口补证", "交叉复核", "交付", "自检", "收口"].includes(s.phase)) continue;
    if (s.capability === "clarify" || s.capability === "local_scan" || s.web_gated) continue;
    assert.ok(typeof s.dimension_id === "string" && s.dimension_id.length > 0,
      s.id + " 专业步应带 dimension_id");
  }
  // coordinates_with 必须双向
  for (const s of plan.steps) {
    for (const other of s.coordinates_with || []) {
      const peer = plan.steps.find((x) => x.id === other || x.dimension_id === other);
      if (peer) assert.ok((peer.coordinates_with || []).some((x) => x === s.id || x === s.dimension_id),
        s.id + " 的 coordinates_with 应双向");
    }
  }
  // 有耦合的步不能进并行集
  for (const id of plan.parallelizable) {
    const s = plan.steps.find((x) => x.id === id);
    assert.ok(s, "parallelizable 引用了不存在的步 " + id);
    assert.equal((s.coordinates_with || []).length, 0, id + " 有 coordinates_with 不应并行");
    assert.ok(!s.web_gated, id + " web 步不应并行");
  }
  const coveredIds = plan.dimensions_covered ? String(plan.dimensions_covered).split(",").filter(Boolean) : [];
  const gapIds = plan.dimensions_gap ? String(plan.dimensions_gap).split(",").filter(Boolean) : [];
  assert.equal(coveredIds.length + gapIds.length, v.dimensions.length,
    "计划应覆盖全部维度（covered+gap=" + (coveredIds.length + gapIds.length) + "）");
});

// ---- 18. verify 交叉检查与采信闸门 ----
test("C18 verify：缺维度/缺耦合报错，采信四判据可机器核对", async () => {
  const verifyMod = await import(pathToFileURL(path.join(LIB, "verify.js")).href);
  const chunks = makeChunks();
  const dims = [
    { id: "spectrometer", label: "分光结构设计", status: "covered" },
    { id: "aberration", label: "像差与光机", status: "covered" }
  ];
  const rels = [{ from: "spectrometer", to: "aberration", type: "constrains", note: "分光方案决定像差形式" }];
  const good = [
    "## 结论",
    "分光结构设计采用 Offner 结构，依据 A01-01；像差与光机按消像散条件分配，依据 F01-01，两者相互约束：分光结构决定狭缝像弯曲。",
    "",
    "## 外部来源",
    "一手源：厂商 datasheet https://example.com/offner 型号 OFF-100，访问日期：2026-11-10。",
    "",
    "## 假设",
    "近轴。",
    "",
    "## 缺口",
    "无。",
    "",
    "## 复现",
    "略。"
  ].join("\n");
  const r = verifyMod.verifyText(good, chunks, { dimensions: dims, relations: rels, now: "2026-11-17" });
  assert.equal(r.dimensions.total, 2);
  assert.equal(r.dimensions.missing, 0);
  assert.equal(r.dimensions.unevidenced, 0);
  assert.equal(r.adoption.external_source_tier.primary, 1);
  assert.equal(r.adoption.pass, true);
  assert.equal(r.checklist.dimensions_complete, true);
  assert.equal(r.checklist.coupling_consistent, true);

  const bad = good.replace("像差与光机按消像散条件分配，依据 F01-01，两者相互约束：分光结构决定狭缝像弯曲。", "");
  const b = verifyMod.verifyText(bad, chunks, { dimensions: dims, relations: rels, now: "2026-11-17" });
  assert.equal(b.dimensions.missing, 1, "删掉一面应报缺维度");
  assert.equal(b.dimensions.coupling_missing, 1, "关系两端缺一应报耦合缺失");
  const types = b.issues.map((i) => i.type);
  assert.ok(types.includes("missing_dimension"));
  assert.ok(types.includes("relation_not_reflected"));
  assert.equal(b.checklist.dimensions_complete, false);
  assert.equal(b.checklist.coupling_consistent, false);

  // 四判据：二手源 + 单源数值 + 混用 KB/URL 未说明 + 过期
  const risky = [
    "## 结论",
    "A01-01 给出 5 nm 分辨率。博客 https://blog.example.com/a 说 3 nm 分辨率，报价 2 万元，访问日期：2026-09-01。",
    "",
    "## 假设",
    "无。",
    "",
    "## 缺口",
    "无。"
  ].join("\n");
  const q = verifyMod.verifyText(risky, chunks, { now: "2026-11-17" });
  assert.equal(q.adoption.external_source_tier.untrusted, 1);
  assert.equal(q.adoption.corroborated.single_source, 1);
  assert.equal(q.adoption.conflict_with_kb.undeclared, 1);
  assert.equal(q.adoption.stale.stale, 1);
  assert.equal(q.adoption.pass, false);
  for (const t of ["external_untrusted_source", "external_single_source", "conflict_with_kb_unstated", "external_stale"]) {
    assert.ok(q.issues.some((i) => i.type === t), "应报 " + t);
  }
});

// ---- 19. report_outline：固定五段与上限 ----
test("C19 assist：report_outline 固定五段，带 chunk_id/关键数值提示与硬上限", async () => {
  const v = await assist.buildAssist(
    { problem: "高光谱相机光谱分辨率 5 nm，狭缝宽度怎么定" },
    baseDeps({ searchKB: alwaysHitKB })
  );
  assert.equal(v.ok, true);
  assert.ok(Array.isArray(v.report_outline), "应输出 report_outline[]");
  assert.equal(v.report_outline.length, 5, "必须是五段");
  assert.deepEqual(v.report_outline.map((s) => s.id), ["conclusion", "severity", "branch", "routes", "verification"]);
  assert.deepEqual(v.report_outline.map((s) => s.title), ["结论", "严重性对号入座", "分流判断", "路线建议", "验证与待补"]);
  const c = v.report_outline[0];
  assert.equal(c.max_sentences, 3);
  assert.ok(c.must_include.includes("一句话原理") && c.must_include.includes("关键公式/判据"));
  assert.ok(!("chunk_ids" in c), "呈现骨架不应暴露条目编号");
  assert.ok(Array.isArray(c.sources) && c.sources.length > 0, "结论段应带来源名称");
  const severity = v.report_outline[1];
  assert.equal(severity.max_tables, 1);
  assert.deepEqual(severity.table_columns, ["工况", "判据/量级", "相对裕度", "处理"]);
  assert.ok(severity.rows.length <= 3, "严重性表最多 3 行");
  assert.ok(!("dimension_id" in severity.rows[0]), "表格行不应暴露维度编号");
  const routes = v.report_outline[3];
  assert.equal(routes.max_routes, 3);
  assert.equal(routes.recommendation_required, true);
  assert.ok(routes.routes.length <= 3);
  assert.ok(!("dimension_id" in routes.routes[0]), "路线不应暴露维度编号");
  const verification = v.report_outline[4];
  assert.equal(verification.max_verifications, 3);
  assert.equal(verification.max_open_params, 4);
  assert.ok(verification.verifications.length <= 3);
  assert.ok(verification.open_params.length <= 4);
  assert.equal(v.report_style.evidence_ids, "hidden");
  assert.ok(Array.isArray(v.report_style.explain) && v.report_style.explain.includes("一句话原理"));
  assert.equal(v.report_style.images, "optional_aid_only");
  assert.ok(v.execution_contract.must.some((m) => /report_outline|五段/.test(m)), "执行契约应写五段呈现");
});

// ---- 20. presentation：五段齐/表格≤3/内部字段名/待补位置 ----
test("C20 verify：presentation 五段结构可判 pass，表格/内部字段/chunk_id/待补位置可报错", async () => {
  const verifyMod = await import(pathToFileURL(path.join(LIB, "verify.js")).href);
  const text = [
    "## ① 结论",
    "先做狭缝宽度对照实验，判断主约束是分辨率还是信噪比。",
    "",
    "## ② 严重性对号入座",
    "| 工况 | 判据/量级 | 相对裕度 | 处理 |",
    "| --- | --- | --- | --- |",
    "| 5 nm | 狭缝 20 µm | 中 | 复测 |",
    "",
    "## ③ 分流判断",
    "比较 10 µm 与 20 µm 两条路线的信噪比，判断哪条先满足 5 nm。",
    "",
    "## ④ 路线建议",
    "1. 先用 20 µm 验证；推荐此路线。",
    "",
    "## ⑤ 验证与待补",
    "1. 复测分辨率。待补：物方 NA。",
    "",
    "依据：《光学系统设计》。"
  ].join("\n");
  const good = verifyMod.verifyText(text, makeChunks(), { presentation: true });
  assert.equal(good.presentation.applicable, true);
  assert.equal(good.presentation.pass, true);
  assert.equal(good.presentation.table_count, 1);
  assert.equal(good.checklist.presentation_structure, true);

  const bad = text
    .replace("| 5 nm | 狭缝 20 µm | 中 | 复测 |", "| 5 nm | 狭缝 20 µm | 中 | 复测 |\n| 3 nm | 狭缝 10 µm | 低 | 复测 |\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| c | d |\n| --- | --- |\n| 3 | 4 |\n\n| e | f |\n| --- | --- |\n| 5 | 6 |")
    .replace("先做狭缝宽度对照实验", "先做狭缝宽度对照实验，alignment=covered，chunk_id 在主段，IM04 域")
    .replace("## ⑤ 验证与待补", "待补：先补一个参数。\n\n## ⑤ 验证与待补");
  const r = verifyMod.verifyText(bad, makeChunks(), { presentation: true });
  assert.equal(r.presentation.pass, false);
  assert.ok(r.issues.some((i) => i.type === "presentation_table_overload"));
  assert.ok(r.issues.some((i) => i.type === "presentation_internal_field"));
  assert.ok(r.issues.some((i) => i.type === "presentation_chunk_id_in_body"));
  assert.ok(r.issues.some((i) => i.type === "presentation_layer_code"));
  assert.ok(r.issues.some((i) => i.type === "presentation_open_params_early"));
});
