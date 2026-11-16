// OpticForge 插件骨架：向 DSH 注册工具。
// - opticforge_docs   ：板块目录（先看有什么，再决定检索词）
// - opticforge_search ：光电知识库 BM25 检索（知识空白如实告知，不编造）
// - opticforge_get    ：按 chunk_id 取完整条目
//
// 注册方式：直接构造 JSON Schema 形状的 ToolDefinition 交给 ctx.tools.register()，
// 不 import 任何 @deepseek-ai 包。这样插件装完即用：不必从 app.asar 抽 dsh-tools
// 依赖闭包，也不必在宿主侧解析 peer 依赖。参数校验由本文件自己做。
//
// 数据模块（kb-data.js / kb-engine.js）通过 execute 内的动态 import 按需加载：
// 骨架与数据/算法解耦，模块缺失时结构化降级而不编造。

const name = "opticforge";
const inject = ["tools"];

// kb-data.js 导出 KB_SOURCE；模块不可用时回退到知识库的标准标注，不编造来源内容。
const DEFAULT_SOURCE = "OpticForge KB（本地内置 · data/kb/*.json 合并生成）";
const NO_HIT_NOTE = "知识库中未找到相关依据";

/**
 * 「知识空白如实告知」守卫。
 *
 * 词表来源：data/kb-meta.json 的 zero_coverage_topics / covered_anchors（由
 * scripts/build-kb.mjs 生成）。增补 KB 或调整空白清单只改数据、不改代码。
 *
 * 为什么需要这个守卫：kb-engine.js 忠实移植 kb_tool.py 的中文「单字 + 相邻双字」
 * 分词，会把「光学 / 光 / 学 / 量 / 子 / 处理 / 检测」等通用字拆出并计分，
 * 于是「量子计算 光学」这类 0 覆盖查询会拿到 E01-06 等低分伪命中。
 * 把这些伪命中当作「依据」返回会违反「不编造」硬约束。
 *
 * 判据（三重，全部满足才短路）：
 *   ① query 命中 blankTopics；
 *   ② query 不含 anchors（混合查询放行，避免误伤）；
 *   ③ 命中的主题词在 status=present 块的可检索字段中确实 0 出现 —— 用运行时数据核实。
 *   ③ 很关键：实测「不确定度」在 E01-06 的 keywords_zh、「自由曲面」在
 *      B01-10 的 keywords_zh 是 present 真实依据，不能屏蔽；而「白光干涉」
 *      等词在 present 块 0 出现，短路才是如实告知。
 * 不用「所有查询词必须在正文出现」的全局判据——「共焦色散」「公差分析」
 * 等合法查询整词同样不在正文中，那会误杀正常检索；此处只对词表命中词核查。
 */
// 与 kb-engine.js buildIndex 一致的可检索字段。
const SEARCHABLE_FIELDS = ["text", "keywords_zh", "page_or_section", "source", "disclaimer"];
// 按 chunks 数组引用缓存 present 块可检索文本，避免每次检索重复拼接 308 块全文。
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
function isZeroCoverageQuery(query, chunks, lists) {
  if (typeof query !== "string" || !query.trim()) return false;
  const topics = lists && Array.isArray(lists.topics) ? lists.topics : [];
  const anchors = lists && Array.isArray(lists.anchors) ? lists.anchors : [];
  if (topics.length === 0) return false;
  const q = query.toLowerCase();
  const hitTopics = topics.filter((t) => q.includes(String(t).toLowerCase()));
  if (hitTopics.length === 0) return false;
  if (anchors.some((a) => q.includes(String(a).toLowerCase()))) return false;
  // 命中的主题词只要在 present 可检索字段中真实出现，KB 就有依据，不短路。
  if (hitTopics.some((t) => topicHasPresentBasis(t, chunks))) return false;
  return true;
}

// 统一渲染：把工具返回值按 2 空格缩进序列化为文本块。
function render(_args, value) {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (value === undefined || value === null) return [{ type: "text", text: "(无结果)" }];
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

/** 简化参数声明 → 标准 JSON Schema（对象根开放，模型多塞一个字段不该让整次调用失败）。 */
function toJsonSchemaParameters(spec) {
  const properties = {};
  const required = [];
  for (const [key, node] of Object.entries(spec ?? {})) {
    const copy = { ...node };
    const isRequired = copy.required === true;
    delete copy.required;
    delete copy.default;
    properties[key] = copy;
    if (isRequired) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: true,
  };
}

/** 原生注册路径没有框架层校验，这里按声明逐项检查类型与必填。 */
function validateArgs(toolName, spec, args) {
  const problems = [];
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  for (const [key, node] of Object.entries(spec ?? {})) {
    const v = a[key];
    if (v === undefined || v === null) {
      if (node.required === true) problems.push("缺少必填参数 " + key);
      continue;
    }
    const actual = Array.isArray(v) ? "array" : typeof v;
    if (node.type === "number" && actual !== "number") problems.push(key + " 应为数字");
    else if (node.type === "string" && actual !== "string") problems.push(key + " 应为字符串");
    else if (node.type === "boolean" && actual !== "boolean") problems.push(key + " 应为布尔值");
    else if (node.type === "array" && actual !== "array") problems.push(key + " 应为数组");
    else if (node.type === "object" && (actual !== "object" || Array.isArray(v))) problems.push(key + " 应为对象");
    if (Array.isArray(node.enum) && !node.enum.includes(v)) {
      problems.push(key + " 取值必须是 " + node.enum.join(" / ") + " 之一");
    }
  }
  if (problems.length > 0) {
    throw new Error("参数校验失败（" + toolName + "）：" + problems.join("；"));
  }
  return a;
}

// 输出 schema 用「注解形式」，表示结果是一个未约束的 JSON 值；
// 具体字段由下方 normalize* 函数保证齐全，而不是依赖框架层编译。
const SEARCH_OUTPUT_SCHEMA = { description: "opticforge_search 的结构化结果" };
const GET_OUTPUT_SCHEMA = { description: "opticforge_get 的结构化结果（单块完整条目）" };
const DOCS_OUTPUT_SCHEMA = { description: "opticforge_docs 的结构化结果（板块与条目目录）" };

/** 把 searchKB 返回的一条命中映射为工具输出结构（缺字段补空值，避免 schema 缺必填项）。 */
/** 检索词切成用于定位摘录的词元（中文按原串，英文按空格/标点切）。 */
function queryTokens(query) {
  if (typeof query !== "string") return [];
  return [...new Set(
    query
      .split(/[\s,，、;；:：/|()（）]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  )];
}

/** 摘录：以【标题】开头，正文取命中词附近的一段，让模型先看到最相关的证据。 */
function makeExcerpt(text, tokens, budget = 400) {
  const full = typeof text === "string" ? text : "";
  const m = /^【([^】]{1,60})】/.exec(full);
  const title = m ? m[0] : "";
  const body = m ? full.slice(m[0].length).trim() : full;
  if (body.length <= budget) return (title + (title ? "\n" : "") + body).trim();

  let at = -1;
  for (const t of tokens) {
    const i = body.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return title + "\n" + body.slice(0, budget) + " …";

  const half = Math.floor((budget - 2) / 2);
  let start = Math.max(0, at - half);
  const end = Math.min(body.length, start + budget);
  start = Math.max(0, end - budget);
  const piece = body.slice(start, end);
  return title + "\n" + (start > 0 ? "…" : "") + piece + (end < body.length ? " …" : "");
}

function toSearchResult(r, query) {
  const text = typeof r.text === "string" ? r.text : "";
  const tokens = queryTokens(query);
  const matched = tokens.filter((t) => text.includes(t));
  return {
    chunk_id: r.chunk_id ?? "",
    doc_id: r.doc_id ?? "",
    status: r.status ?? "",
    score: typeof r.score === "number" ? r.score : 0,
    matched_terms: matched,
    chars: text.length,
    excerpt: makeExcerpt(text, matched),
    source: r.source ?? "",
    page: r.page_or_section ?? ""
  };
}

function apply(ctx) {
  const SEARCH_PARAMS = {
    query: { type: "string", required: true, description: "中文/英文检索词" },
    top_k: { type: "number", default: 5, description: "本页最多返回条数（1–20，默认 5）" },
    offset: { type: "number", default: 0, description: "跳过前 N 条，用于翻页（0–100，默认 0）" },
    max_per_doc: { type: "number", default: 3, description: "同一板块最多返回几条，避免单个板块刷屏（1–10，默认 3）" },
    doc_filter: { type: "string", description: "可选：只检索某个板块（A01/B01/C02 等）" }
  };

  // 工具 1：知识库检索
  ctx.tools.register({
    name: "opticforge_search",
    description: "检索 OpticForge 光电工程师知识库（40 个板块、324 条事实条目，Okapi BM25）。仅返回 status=present 的条目，附 chunk_id、doc_id、status、BM25 分数、正文摘录、来源与章节；检索未命中时如实返回「知识库中未找到相关依据」，知识空白如实告知，绝不编造。Search the OpticForge optical knowledge base with BM25; returns present-only chunks with excerpt, source and section, and honestly reports knowledge gaps when nothing matches.",
    parameters: toJsonSchemaParameters(SEARCH_PARAMS),
    output: { schema: SEARCH_OUTPUT_SCHEMA, render },
    async execute(args, _exec) {
      const a = validateArgs("opticforge_search", SEARCH_PARAMS, args);
      const limit = Math.max(1, Math.min(20, Math.trunc(Number(a.top_k) || 5)));
      const offset = Math.max(0, Math.min(100, Math.trunc(Number(a.offset) || 0)));
      const maxPerDoc = Math.max(1, Math.min(10, Math.trunc(Number(a.max_per_doc) || 3)));
      // 模块缺失时只报告、不中断，并如实返回未命中，绝不编造。
      let kbData = null, kbEngine = null;
      try {
        kbData = await import("./kb-data.js");
        kbEngine = await import("./kb-engine.js");
      } catch (err) {
        console.warn("[opticforge_search] 数据模块未就绪：" + (err && err.message ? err.message : String(err)));
      }
      let chunks = [], hits = [], meta = null, blocked = false;
      try {
        if (kbData && typeof kbData.getKBData === "function") chunks = await kbData.getKBData();
        if (kbData && typeof kbData.getKBMeta === "function") meta = await kbData.getKBMeta();
        const data = Array.isArray(chunks) ? chunks : [];
        // 知识空白守卫：0 覆盖主题不把 BM25 的通用字伪命中当作依据返回。
        const lists = {
          topics: meta && Array.isArray(meta.zero_coverage_topics) ? meta.zero_coverage_topics : [],
          anchors: meta && Array.isArray(meta.covered_anchors) ? meta.covered_anchors : [],
        };
        blocked = isZeroCoverageQuery(a.query, data, lists);
        if (kbEngine && typeof kbEngine.searchKB === "function" && !blocked) {
          // 先取足够大的候选池，再做多样性限制与分页（kb-engine 的 BM25 打分逻辑原样不动）。
          hits = kbEngine.searchKB(data, a.query, 100, a.doc_filter) || [];
        }
      } catch (err) {
        console.warn("[opticforge_search] KB 检索失败，按未命中处理：" + (err && err.message ? err.message : String(err)));
      }

      const ranked = hits
        .map((h) => toSearchResult(h, a.query))
        .filter((r) => r && Number(r.score) > 0);
      // 同一板块限流：避免 Top5 全被同一个长板块占满，换取跨板块的覆盖面。
      const perDoc = new Map();
      const diversified = [];
      for (const r of ranked) {
        const n = perDoc.get(r.doc_id) || 0;
        if (n >= maxPerDoc) continue;
        perDoc.set(r.doc_id, n + 1);
        diversified.push(r);
      }
      const totalMatched = diversified.length;
      const page = diversified.slice(offset, offset + limit);
      const kbVersion = meta && meta.kb_version ? meta.kb_version : "unknown";
      // note 只做「有没有」的判定（保持稳定可断言），补充建议放 guidance，两者不混。
      const note = totalMatched === 0 ? NO_HIT_NOTE : "仅返回 status=present 的条目；需要完整正文用 opticforge_get(chunk_id)。";
      const guidance = blocked
        ? "该主题在知识库中没有覆盖，返回空是正确行为；不要用通用常识替代知识库依据。"
        : (totalMatched === 0 ? "不要编造依据；可换关键词，或先用 opticforge_docs 看有哪些板块。" : "");

      return {
        ok: true,
        kb_version: kbVersion,
        action: "search",
        query: a.query,
        total_matched: totalMatched,
        offset,
        returned: page.length,
        has_more: offset + page.length < totalMatched,
        total_hits: page.length,
        source: kbData && typeof kbData.KB_SOURCE === "string" && kbData.KB_SOURCE ? kbData.KB_SOURCE : DEFAULT_SOURCE,
        note,
        guidance,
        results: page
      };
    }
  });

  const GET_PARAMS = {
    chunk_id: { type: "string", required: true, description: "形如 A01-02 的块 ID，可从 opticforge_search 结果里取" }
  };

  // 工具 2：取单块完整正文（检索只给摘录，需要原文时用这个，避免模型凭摘录猜）。
  ctx.tools.register({
    name: "opticforge_get",
    description: "按 chunk_id 读取知识库中某一块的完整条目（9 个字段全给）。search 只返回摘录，引用原文、核对数值或需要完整上下文时用本工具；块不存在或该块无可用来源(status≠present)时如实说明，不编造内容。",
    parameters: toJsonSchemaParameters(GET_PARAMS),
    output: { schema: GET_OUTPUT_SCHEMA, render },
    async execute(args, _exec) {
      const a = validateArgs("opticforge_get", GET_PARAMS, args);
      let kbData = null;
      try {
        kbData = await import("./kb-data.js");
      } catch (err) {
        console.warn("[opticforge_get] 数据模块未就绪：" + (err && err.message ? err.message : String(err)));
        return { ok: false, action: "get", chunk_id: a.chunk_id, error: "知识库数据模块未就绪，无法读取该块" };
      }
      const meta = typeof kbData.getKBMeta === "function"
        ? await kbData.getKBMeta().catch(() => ({}))
        : {};
      const kbVersion = meta && meta.kb_version ? meta.kb_version : "unknown";
      let chunk = null;
      try {
        if (typeof kbData.getChunkById === "function") chunk = await kbData.getChunkById(a.chunk_id);
      } catch (err) {
        return { ok: false, action: "get", kb_version: kbVersion, chunk_id: a.chunk_id, error: "读取失败：" + (err && err.message ? err.message : String(err)) };
      }
      if (!chunk) {
        const docs = typeof kbData.listDocs === "function" ? await kbData.listDocs() : [];
        return {
          ok: false,
          action: "get",
          kb_version: kbVersion,
          chunk_id: a.chunk_id,
          error: "知识库中不存在该 chunk_id",
          known_prefixes: docs.map((d) => d.doc_id),
          hint: "先调用 opticforge_docs 查看可用块清单"
        };
      }
      if (chunk.status !== "present") {
        return {
          ok: true,
          action: "get",
          kb_version: kbVersion,
          chunk_id: chunk.chunk_id,
          doc_id: chunk.doc_id,
          status: chunk.status,
          text: chunk.text,
          source: chunk.source,
          page_or_section: chunk.page_or_section,
          keywords_zh: chunk.keywords_zh,
          disclaimer: chunk.disclaimer,
          note: "该块 status=" + chunk.status + "，无逐字原文可引用，仅可作为「已知缺口」提示，不可当作事实依据。"
        };
      }
      return { ok: true, action: "get", kb_version: kbVersion, ...chunk };
    }
  });

  const DOCS_PARAMS = {
    doc_id: { type: "string", description: "可选：只看某一板块（如 A01/C02），省略则列出全部板块" }
  };

  // 工具 3：板块目录（先看有哪些主题，再决定检索词，减少盲目搜索）。
  ctx.tools.register({
    name: "opticforge_docs",
    description: "列出知识库的板块与条目：doc_id、来源、块数、present 数、每块的 chunk_id 与标题。用于「这个知识库能查什么」以及定位 chunk_id；不含正文。",
    parameters: toJsonSchemaParameters(DOCS_PARAMS),
    output: { schema: DOCS_OUTPUT_SCHEMA, render },
    async execute(args, _exec) {
      const a = validateArgs("opticforge_docs", DOCS_PARAMS, args);
      let kbData = null;
      try {
        kbData = await import("./kb-data.js");
      } catch (err) {
        return { ok: false, error: "知识库数据模块未就绪" };
      }
      const all = typeof kbData.listDocs === "function" ? await kbData.listDocs() : [];
      const chunks = typeof kbData.getKBData === "function" ? await kbData.getKBData() : [];
      const meta = typeof kbData.getKBMeta === "function"
        ? await kbData.getKBMeta().catch(() => ({}))
        : {};
      const kbVersion = meta && meta.kb_version ? meta.kb_version : "unknown";
      const titleMap = new Map();
      for (const c of chunks) {
        const m = /^【([^】]{1,40})】/.exec(String(c.text || ""));
        titleMap.set(c.chunk_id, m ? m[1] : "");
      }
      const filter = typeof a.doc_id === "string" && a.doc_id.trim() ? a.doc_id.trim().toUpperCase() : "";
      const docs = all
        .filter((d) => !filter || d.doc_id === filter)
        .map((d) => ({
          doc_id: d.doc_id,
          source: d.source,
          chunks: d.chunks,
          present: d.present,
          items: d.chunk_ids.map((id) => ({
            chunk_id: id,
            status: (chunks.find((c) => c.chunk_id === id) || {}).status || "",
            title: titleMap.get(id) || ""
          }))
        }));
      if (docs.length === 0) {
        return { ok: false, action: "docs", kb_version: kbVersion, doc_id: filter, error: "没有该板块", available: all.map((d) => d.doc_id) };
      }
      return { ok: true, action: "docs", kb_version: kbVersion, total_docs: docs.length, docs };
    }
  });
}

export { apply, inject, name };
