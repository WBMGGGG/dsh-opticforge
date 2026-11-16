import { defineTool } from "@deepseek-ai/dsh-tools";

/**
 * OpticForge 插件骨架：向 DSH 注册 2 个工具。
 * - opticforge_search：光电知识库 BM25 检索（知识空白如实告知，不编造）
 * - opticforge_calc  ：5 类工程计算（输出完整计算过程，参数不足不编造数值）
 *
 * 数据模块（kb-data.js / kb-engine.js / calculators.js）通过 execute 内的
 * 动态 import 按需加载：骨架与数据/算法解耦，模块缺失时结构化降级而不编造。
 */

const name = "opticforge";
const inject = ["tools"];

// kb-data.js 导出 KB_SOURCE；模块不可用时回退到知识库的标准标注，不编造来源内容。
const DEFAULT_SOURCE = "OpticForge KB (ModelScope Datasets GrestestOptics/optics-kb)";
const NO_HIT_NOTE = "知识库中未找到相关依据";

/**
 * §4.3 / §8.5「知识空白如实告知」守卫。
 *
 * PLUGIN_PLAN.md 明确声明下列主题在当前 67 块 KB 中为 0 覆盖（或极薄）：
 *   §8.5 硬约束「知识空白如实告知」、§4.3 知识空白清单、
 *   §2.2 另列 21 项、用户补录 2 项。
 * 注意：词表只是「已声明 0 覆盖主题」清单，是否真的短路由运行时 KB 数据
 * 判定（见 isZeroCoverageQuery）——避免词表与 KB 实际覆盖漂移造成误伤。
 *
 * 但 kb-engine.js 忠实移植 kb_tool.py 的中文「单字 + 相邻双字」分词，
 * 会把「光学 / 光 / 学 / 量 / 子 / 处理 / 检测」等通用字拆出并计分，
 * 于是「量子计算 光学」这类 0 覆盖查询会拿到 E01-06 等低分伪命中
 * （实测 5 条，最高 14.5232）。把这些伪命中当作「依据」返回会违反
 * 「不编造 / 知识空白如实告知」硬约束。
 *
 * 因此骨架层（唯一同时不改动 kb-engine 移植契约、又能满足 §8.5 的位置）
 * 对 0 覆盖主题短路：跳过 searchKB，返回空 results + NO_HIT_NOTE。
 * 判据（三重，全部满足才短路）：
 *   ① query 命中 ZERO_COVERAGE_TOPICS；
 *   ② query 不含 COVERED_ANCHORS（混合查询放行，避免误伤）；
 *   ③ 命中的主题词在 status=present 块的可检索字段
 *      （text / keywords_zh / page_or_section / source / disclaimer，与
 *       kb-engine.js buildIndex 对齐）中确实 0 出现 —— 用运行时数据核实。
 *   ③ 很关键：实测「不确定度」在 E01-06 的 keywords_zh、「自由曲面」在
 *      B01-10 的 keywords_zh 是 present 真实依据，不能屏蔽；而「白光干涉」
 *      等词在 present 块 0 出现，短路才是如实告知。
 * 不用「所有查询词必须在正文出现」的全局判据——「共焦色散」「公差分析」
 * 等合法查询整词同样不在正文中，那会误杀正常检索；此处只对词表命中词核查。
 */
const ZERO_COVERAGE_TOPICS = [
  // §4.3 知识空白清单 / §8.5 硬约束点名
  "量子计算", "量子信息", "量子光学", "量子比特",
  "COMSOL", "SolidWorks",
  "图像处理", "缺陷检测",
  "热光学", "无热化", "热稳定",
  // §2.2 另列（21 项）中其余 0 覆盖主题
  "多物理场", "波动光学", "工程图",
  "衍射光波导", "光波导", "光子集成", "白光干涉",
  "非球面", "自由曲面",
  "光谱定标", "辐射度学", "黑体", "红外测温", "信号解调", "光谱与信号解调",
  "激光三角", "光学测厚", "光机结构",
  "不确定度", "公差链",
  // 用户补录（2）
  "物理光学", "光学检测"
];

// KB 明确覆盖的核心主题：query 命中任一则照常检索（只用于「放行」，不造成错误短路）。
const COVERED_ANCHORS = [
  "共焦色散", "共焦", "色散", "IFS2402", "IFS",
  "RCWA", "光栅", "衍射效率",
  "镀膜", "膜系", "热漂移", "dn/dT",
  "公差分析", "Monte Carlo", "RSS", "均方根", "公差分配",
  "photodiode", "光电二极管",
  "数值孔径", "Airy", "Rayleigh",
  "线性度", "量程", "分辨率"
];

// 与 kb-engine.js buildIndex 一致的可检索字段。
const SEARCHABLE_FIELDS = ["text", "keywords_zh", "page_or_section", "source", "disclaimer"];
// 按 chunks 数组引用缓存 present 块可检索文本，避免每次检索重复拼接 51 块全文。
const presentTextCache = new WeakMap();

/** 主题词在 status=present 块的可检索字段中是否真实出现（KB 是否真有依据）。 */
function topicHasPresentBasis(topic, chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return false;
  let haystack = presentTextCache.get(chunks);
  if (haystack === undefined) {
    haystack = chunks
      .filter((c) => c && c.status === "present")
      .map((c) => SEARCHABLE_FIELDS.map((f) => (typeof c[f] === "string" ? c[f] : "")).join(" \n"))
      .join(" \n")
      .toLowerCase();
    presentTextCache.set(chunks, haystack);
  }
  return haystack.includes(topic.toLowerCase());
}

/** 返回 true 表示该查询属于 KB 0 覆盖主题、应短路为空结果并如实告知。 */
function isZeroCoverageQuery(query, chunks) {
  if (typeof query !== "string" || !query.trim()) return false;
  const q = query.toLowerCase();
  const hitTopics = ZERO_COVERAGE_TOPICS.filter((t) => q.includes(t.toLowerCase()));
  if (hitTopics.length === 0) return false;
  if (COVERED_ANCHORS.some((a) => q.includes(a.toLowerCase()))) return false;
  // 命中的主题词只要在 present 可检索字段中真实出现，KB 就有依据，不短路。
  if (hitTopics.some((t) => topicHasPresentBasis(t, chunks))) return false;
  return true;
}

// 统一渲染：把工具返回值按 2 空格缩进序列化为文本块。
function render(_args, value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

// 两个工具已实测通过的 output.schema（值 schema DSL，原样使用）。
const SEARCH_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", required: true },
    total_hits: { type: "number", required: true },
    source: { type: "string", required: true },
    note: { type: "string" },
    results: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          chunk_id: { type: "string", required: true },
          doc_id: { type: "string", required: true },
          status: { type: "string", required: true },
          score: { type: "number", required: true },
          excerpt: { type: "string", required: true },
          source: { type: "string", required: true },
          page: { type: "string", required: true }
        }
      }
    }
  }
};

const CALC_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", required: true },
    ok: { type: "boolean", required: true },
    formula: { type: "string", required: true },
    substitution: { type: "string", required: true },
    steps: { type: "array", required: true, items: { type: "string" } },
    result: { type: "object", additionalProperties: true, required: true },
    notes: { type: "array", items: { type: "string" } },
    source: { type: "string", required: true },
    error: { type: "string" },
    suggestion: { type: "string" }
  }
};

/** 把 searchKB 返回的一条命中映射为工具输出结构（缺字段补空值，避免 schema 缺必填项）。 */
function toSearchResult(r) {
  const text = typeof r.text === "string" ? r.text : "";
  return {
    chunk_id: r.chunk_id ?? "",
    doc_id: r.doc_id ?? "",
    status: r.status ?? "",
    score: typeof r.score === "number" ? r.score : 0,
    excerpt: text.slice(0, 300),
    source: r.source ?? "",
    page: r.page_or_section ?? ""
  };
}

/**
 * 规整 calculate() 的返回值：补齐所有必填字段（空串/空数组/{}），
 * 只保留 output.schema 允许的键。不修改 calculators.js，只在骨架层兜底。
 */
function normalizeCalcResult(value, requestedType) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {
    type: typeof raw.type === "string" && raw.type ? raw.type : (typeof requestedType === "string" ? requestedType : ""),
    ok: typeof raw.ok === "boolean" ? raw.ok : false,
    formula: typeof raw.formula === "string" ? raw.formula : "",
    substitution: typeof raw.substitution === "string" ? raw.substitution : "",
    steps: Array.isArray(raw.steps) ? raw.steps.map((s) => (typeof s === "string" ? s : String(s ?? ""))) : [],
    result: raw.result && typeof raw.result === "object" && !Array.isArray(raw.result) ? raw.result : {},
    source: typeof raw.source === "string" ? raw.source : ""
  };
  if (Array.isArray(raw.notes)) {
    out.notes = raw.notes.map((n) => (typeof n === "string" ? n : String(n ?? "")));
  }
  if (typeof raw.error === "string") out.error = raw.error;
  if (typeof raw.suggestion === "string") out.suggestion = raw.suggestion;
  return out;
}

function apply(ctx) {
  // 工具 1：知识库检索
  ctx.tools.register(defineTool({
    name: "opticforge_search",
    description: "检索 OpticForge 光电工程师知识库（67 块 / 9 篇来源，Okapi BM25）。仅返回 status=present 的原文块，附 chunk_id、doc_id、status、BM25 分数、正文前 300 字摘录、来源与页码；检索未命中时如实返回「知识库中未找到相关依据」，知识空白如实告知（量子计算/COMSOL/SolidWorks/图像处理/热光学等主题当前 KB 无覆盖，返回空是正确行为），绝不编造。Search the OpticForge optical knowledge base with BM25; returns present-only chunks with excerpt, source and page, and honestly reports knowledge gaps when nothing matches.",
    parameters: {
      query: { type: "string", required: true, description: "中文/英文检索词" },
      top_k: { type: "number", default: 5, description: "最多返回条数" },
      doc_filter: { type: "string", description: "可选：按 doc_id 过滤（A01/B01/C02 等）" }
    },
    output: { schema: SEARCH_OUTPUT_SCHEMA, render },
    async execute(args, _exec) {
      // 队友模块并行开发：动态 import 缺失时只报告、不中断，且如实返回未命中，绝不编造。
      let kbData = null, kbEngine = null;
      try {
        kbData = await import("./kb-data.js");
        kbEngine = await import("./kb-engine.js");
      } catch (err) {
        console.warn("[opticforge_search] 队友模块尚未就绪：" + (err && err.message ? err.message : String(err)));
      }
      let chunks = [], hits = [];
      try {
        if (kbData && typeof kbData.getKBData === "function") chunks = await kbData.getKBData();
        const data = Array.isArray(chunks) ? chunks : [];
        // 知识空白守卫：0 覆盖主题不把 BM25 的通用字伪命中当作依据返回。
        const blocked = isZeroCoverageQuery(args.query, data);
        if (kbEngine && typeof kbEngine.searchKB === "function" && !blocked) {
          hits = kbEngine.searchKB(data, args.query, args.top_k || 5, args.doc_filter) || [];
        }
      } catch (err) {
        console.warn("[opticforge_search] KB 检索失败，按未命中处理：" + (err && err.message ? err.message : String(err)));
      }
      const results = hits.map(toSearchResult);
      return {
        query: args.query,
        total_hits: results.length,
        source: kbData && typeof kbData.KB_SOURCE === "string" && kbData.KB_SOURCE ? kbData.KB_SOURCE : DEFAULT_SOURCE,
        note: results.length === 0 ? NO_HIT_NOTE : "仅返回知识库中 status=present 的原文块；量子计算/COMSOL/SolidWorks/图像处理/热光学等主题 KB 暂无覆盖，未命中属正常，知识空白如实告知。",
        results
      };
    }
  }));

  // 工具 2：工程计算
  ctx.tools.register(defineTool({
    name: "opticforge_calc",
    description: "光电工程计算器（5 类：diffraction_limit / coating_thermal_drift / confocal_range_select / tolerance_rss / na_resolution）。输出完整计算过程：公式（符号形式）→ 代入数值 → 中间步骤 → 最终结果（含单位）与数据来源；知识空白如实告知，参数不足或非法时说明原因并给出合理范围建议，不编造数值。Optical engineering calculator that returns the full calculation process (formula, substitution, steps, result with units and source), honestly reports knowledge gaps, and never fabricates missing values.",
    parameters: {
      type: {
        type: "string",
        required: true,
        enum: ["diffraction_limit", "coating_thermal_drift", "confocal_range_select", "tolerance_rss", "na_resolution"],
        description: "计算器类型"
      },
      params: { type: "object", additionalProperties: true, required: true, description: "各计算器参数对象" }
    },
    output: { schema: CALC_OUTPUT_SCHEMA, render },
    async execute(args, _exec) {
      // 队友模块并行开发：动态 import 缺失时只报告、不中断，返回 ok=false 并说明原因，绝不编造数值。
      let calculate = null;
      try {
        ({ calculate } = await import("./calculators.js"));
      } catch (err) {
        console.warn("[opticforge_calc] 队友模块尚未就绪：" + (err && err.message ? err.message : String(err)));
      }
      if (typeof calculate !== "function") {
        return normalizeCalcResult({
          type: args.type, ok: false,
          error: "工程计算模块 calculators.js 尚未就绪，无法执行计算",
          suggestion: "请稍后重试或联系插件维护者；不会编造任何数值结果"
        }, args.type);
      }
      let value;
      try {
        value = await calculate(args.type, args.params);
      } catch (err) {
        value = { type: args.type, ok: false, error: "计算执行失败：" + (err && err.message ? err.message : String(err)), suggestion: "请检查参数后重试；不会编造任何数值结果" };
      }
      return normalizeCalcResult(value, args.type);
    }
  }));
}

export { apply, inject, name };
