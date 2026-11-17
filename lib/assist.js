// assist.js —— 任务受理、知识取证、能力路由与交付编排
//
// 输入是一个具体问题，输出是一个可直接执行的作战包：
//   brief（目标/交付物/约束/待澄清）
//   alignment（KB 覆盖与缺口的机器可读视图：kb_queries/matched/unmatched/coverage_matrix/verdict）
//   evidence（可引用的 KB 条目 + 缺口）
//   web_gate（默认禁网；只有 KB gap / 标准版本 / 厂商参数 / 价格时效等明确条件命中才放行）
//   plan（分阶段步骤，每步绑定 capability、blocked_by、门禁标记）
//   search_pack（区分 KB 查询与外部查询；外部查询带触发条件与依赖）
//   calc_specs（按问题领域匹配 data/formula-cards.json 的公式卡，只读、不计算）
//   acceptance / risks / handoff
//
// 本模块不联网、不写文件；能力发现交给 capabilities.js，数值计算由执行层完成。
// web_gate 只做判断，不发起任何检索。

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const CATALOG_URL = new URL("../data/assist-playbooks.json", import.meta.url);
const FORMULA_CARDS_URL = new URL("../data/formula-cards.json", import.meta.url);
const CONCEPT_CARDS_URL = new URL("../data/concept-cards.json", import.meta.url);
const CROSS_DIMENSIONS_URL = new URL("../data/cross-dimensions.json", import.meta.url);
let catalogCache = null;
let formulaCardsCache = null;
let formulaCardsTried = false;
let conceptCardsCache = null;
let crossDimensionsCache = null;

export async function loadCatalog() {
  if (catalogCache) return catalogCache;
  catalogCache = JSON.parse(await readFile(CATALOG_URL, "utf8"));
  return catalogCache;
}

/**
 * 只读加载 L2 概念卡。缺失或损坏时降级为空数组，不阻断取证。
 * 成功才缓存；失败下次重试。
 */
export async function loadConceptCards() {
  if (conceptCardsCache) return conceptCardsCache;
  try {
    const parsed = JSON.parse(await readFile(CONCEPT_CARDS_URL, "utf8"));
    conceptCardsCache = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cards) ? parsed.cards : []);
  } catch {
    return [];
  }
  return conceptCardsCache;
}

/** 只读加载通用交叉维度模板；缺失时内置 6 面兜底。 */
export async function loadCrossDimensions() {
  if (crossDimensionsCache) return crossDimensionsCache;
  try {
    const parsed = JSON.parse(await readFile(CROSS_DIMENSIONS_URL, "utf8"));
    const dims = Array.isArray(parsed) ? parsed : parsed.dimensions;
    if (Array.isArray(dims) && dims.length) {
      crossDimensionsCache = dims;
      return crossDimensionsCache;
    }
  } catch {
    // 落到内置兜底
  }
  crossDimensionsCache = [
    { id: "principle", label: "原理与依据", domains: ["TF"], boards: ["TF01"], anchor: "原理/公式/判据", queries: ["原理 机理 公式", "判据 适用边界"], priority: 1 },
    { id: "design", label: "设计与选型", domains: ["DS"], boards: ["DS01"], anchor: "方案/结构/选型", queries: ["设计 选型 方案", "参数 分解 权衡"], priority: 1 },
    { id: "calc", label: "计算与预算", domains: ["QE"], boards: ["QE01"], anchor: "预算/指标/误差分配", queries: ["预算 指标 计算", "误差 分配 量纲"], priority: 1 },
    { id: "implementation", label: "实现与工艺", domains: ["DS", "MT"], boards: ["DS04", "MT07"], anchor: "装调/加工/流程", queries: ["装调 装配 工艺", "加工 实现 流程"], priority: 2 },
    { id: "verification", label: "验证与测试", domains: ["DT"], boards: ["DT01"], anchor: "检测/标定/验收", queries: ["检测 测试 标定", "验收 判据 不确定度"], priority: 2 },
    { id: "risk", label: "误差与风险", domains: ["QE"], boards: ["QE05"], anchor: "误差/失效/环境", queries: ["误差 失效 漂移", "杂散光 环境 可靠性"], priority: 2 }
  ];
  return crossDimensionsCache;
}

/**
 * 只读加载 data/formula-cards.json。文件不存在或解析失败时降级为 []，不阻断。
 * 约定：成功加载才缓存；缺文件/解析失败不永久缓存，下次调用会重试，
 * 这样 MainAgent 后续把文件放进来后，同进程下次请求即可加载，不会永远停在 []。
 * 测试可通过 deps.formulaCards 注入，不触达磁盘。
 */
export async function loadFormulaCards() {
  if (formulaCardsTried && formulaCardsCache) return formulaCardsCache;
  try {
    const txt = await readFile(FORMULA_CARDS_URL, "utf8");
    const parsed = JSON.parse(txt);
    formulaCardsCache = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cards) ? parsed.cards : []);
    formulaCardsTried = true;
  } catch {
    // 不缓存失败结果，下次重试
    formulaCardsCache = null;
    formulaCardsTried = false;
    return [];
  }
  return formulaCardsCache;
}

const STOPWORDS = new Set([
  "一个", "这个", "那个", "如何", "怎么", "怎样", "什么", "为什么", "可以", "需要", "帮我",
  "进行", "实现", "问题", "要求", "以及", "并且", "然后", "现在", "目前", "我们", "我的",
  "the", "and", "for", "with", "that", "this", "from", "have", "will", "your", "about"
]);

export function keywordsOf(text) {
  const unitOnly = new Set(["nm", "um", "μm", "µm", "mm", "cm", "m", "°", "℃", "k", "%", "ms", "s", "fps", "hz", "w", "db"]);
  const raw = String(text || "")
    .toLowerCase()
    .split(/[\s,，。、;；:：/|()（）\[\]【】“”"'=+<>]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 24 && !STOPWORDS.has(s))
    // 纯数字、带单位的量值、单个符号不作为检索面（否则会造出 "400-1000" 这种假主题）
    .filter((s) => !/^[\d±%°.,-]+$/.test(s))
    .filter((s) => !/^\d+(?:\.\d+)?\s*(nm|μm|µm|um|mm|cm|m|°|℃|k|%|ms|s|fps|hz|w|db)$/i.test(s))
    .filter((s) => !unitOnly.has(s))
    .filter((s) => s.length >= 2);
  return [...new Set(raw)].slice(0, 40);
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function shortHash(text) {
  return createHash("sha1").update(String(text)).digest("hex").slice(0, 10);
}

/** 通用剧本：没有任何主题卡命中时兜底，仍走六个通用维度。 */
export function makeGenericPlaybook() {
  return {
    id: "generic",
    label: "通用光电任务",
    keywords: [],
    sections: [],
    aspects: ["任务目标 交付物 约束", "关键指标 判据", "现有资料 数据", "风险 缺口"],
    focus: ["先把目标、交付物、验收标准写清楚，再决定查什么、算什么", "缺关键输入时先问，不要用默认值硬算", "结论必须能追到知识库条目或外部来源"],
    steps: [],
    required_dimensions: [],
    relations: [],
    cross_check: [],
    search: [
      { facet: "标准", zh: "光电 标准 规范", en: "optics standard specification" },
      { facet: "资料", zh: "技术方案 选型 对比", en: "technical approach comparison" }
    ]
  };
}

function scorePlaybook(pb, text) {
  let score = 0;
  const matched = [];
  for (const kw of pb.keywords || []) {
    const k = String(kw).toLowerCase();
    if (k && text.includes(k)) {
      score += k.length >= 4 ? 3 : 2;
      matched.push(kw);
    }
  }
  let aspectHits = 0;
  for (const aspect of pb.aspects || []) {
    for (const term of String(aspect).split(/\s+/)) {
      const t = term.toLowerCase();
      if (t.length >= 2 && text.includes(t)) aspectHits += 1;
    }
  }
  score += Math.min(1, aspectHits);
  return { score, matched };
}

const GENERIC_KEYWORDS = new Set([
  "分辨率", "噪声", "灵敏度", "精度", "误差", "带宽", "动态范围", "视场", "设计", "选型",
  "检测", "测量", "标定", "校准", "预算", "成本", "方案", "对比", "调研", "分析", "成像"
]);

/**
 * 多剧本激活：主剧本必选；其余剧本除分数达标外，还必须命中至少一个
 * 非通用触发词（避免“分辨率”这类词把共焦剧本带进高光谱任务）。
 */
export function detectPlaybooks(problem, catalog, options = {}) {
  const text = String(problem || "").toLowerCase();
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 2;
  const max = Number.isFinite(options.max) ? options.max : 3;
  const scored = (catalog.playbooks || [])
    .map((playbook) => ({ playbook, ...scorePlaybook(playbook, text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.matched.length - a.matched.length) || String(a.playbook.id).localeCompare(String(b.playbook.id)));

  const generic = makeGenericPlaybook();
  if (!scored.length) {
    return { primary: generic, active: [generic], scored: [], generic, matched_keywords: [] };
  }
  const hasSpecific = (x) => x.matched.some((k) => !GENERIC_KEYWORDS.has(String(k).toLowerCase()));
  let active = scored.filter((x, i) => i === 0 || (x.score >= threshold && hasSpecific(x))).slice(0, max);
  if (!active.length) active = [scored[0]];
  // 最高分剧本必须在 active 中
  if (!active.some((x) => x.playbook.id === scored[0].playbook.id)) active.unshift(scored[0]);
  return {
    primary: scored[0].playbook,
    active: active.map((x) => x.playbook),
    scored,
    generic,
    matched_keywords: scored[0].matched
  };
}

/** 兼容旧签名：返回单一最佳剧本。 */
export function detectPlaybook(problem, catalog) {
  const r = detectPlaybooks(problem, catalog);
  return { playbook: r.primary, score: r.scored[0] ? r.scored[0].score : 0, matched_keywords: r.matched_keywords };
}

/**
 * 维度融合：同 id 合并，保留最高优先级（数字最小）、最长锚点，并记录来源剧本。
 * 主题卡维度为空时用通用模板；总数上限 12。
 */
export function fuseDimensions(activePlaybooks, genericDims) {
  const map = new Map();
  const add = (d, sourceId, isGeneric) => {
    const key = d.id;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        id: d.id,
        label: d.label,
        priority: Number.isFinite(d.priority) ? d.priority : 2,
        domains: [...new Set(d.domains || [])],
        boards: [...new Set(d.boards || [])],
        anchor: d.anchor || d.label,
        queries: [...new Set([...(d.queries || []), d.label].filter(Boolean))],
        sources: [sourceId],
        generic: !!isGeneric,
        ask: d.ask || ""
      });
    } else {
      if (!prev.sources.includes(sourceId)) prev.sources.push(sourceId);
      prev.priority = Math.min(prev.priority, Number.isFinite(d.priority) ? d.priority : prev.priority);
      prev.domains = [...new Set([...prev.domains, ...(d.domains || [])])];
      prev.boards = [...new Set([...prev.boards, ...(d.boards || [])])];
      prev.queries = [...new Set([...prev.queries, ...(d.queries || []), d.label].filter(Boolean))];
      if (d.anchor && String(d.anchor).length > String(prev.anchor).length) prev.anchor = d.anchor;
      if (!prev.ask && d.ask) prev.ask = d.ask;
    }
  };

  const topicDims = [];
  for (const pb of activePlaybooks) {
    if (pb.id === "generic") continue;
    for (const d of pb.required_dimensions || []) {
      topicDims.push(d);
      add(d, pb.id, false);
    }
  }
  if (!topicDims.length) {
    for (const d of genericDims || []) add(d, "generic", true);
  }
  return [...map.values()]
    .sort((a, b) => (a.priority - b.priority) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 12);
}

/** 合并多剧本关系，只保留两端都在本次维度内的关系。 */
export function fuseRelations(activePlaybooks, dimensions) {
  const ids = new Set(dimensions.map((d) => d.id));
  const map = new Map();
  for (const pb of activePlaybooks) {
    for (const r of pb.relations || []) {
      if (!ids.has(r.from) || !ids.has(r.to)) continue;
      const key = r.from + "|" + r.to + "|" + (r.type || "rel");
      if (!map.has(key)) map.set(key, { ...r, sources: [pb.id] });
      else if (!map.get(key).sources.includes(pb.id)) map.get(key).sources.push(pb.id);
    }
  }
  return [...map.values()];
}

const INTENTS = [
  { id: "design", label: "设计", terms: ["设计", "选型", "方案", "架构", "布局"] },
  { id: "build", label: "搭建/装配", terms: ["搭建", "装配", "装调", "集成", "调试"] },
  { id: "measure", label: "测量/检测", terms: ["测量", "检测", "标定", "校准", "测试", "验收"] },
  { id: "diagnose", label: "诊断/排障", terms: ["故障", "异常", "报错", "排查", "漂移", "噪声"] },
  { id: "analyze", label: "分析/计算", terms: ["分析", "计算", "仿真", "预算", "评估", "拟合"] },
  { id: "research", label: "调研", terms: ["调研", "综述", "对比", "前沿", "可行性"] },
  { id: "document", label: "文档/汇报", terms: ["报告", "文档", "ppt", "汇报", "sop", "规范"] }
];

export function detectIntents(problem) {
  const text = String(problem || "").toLowerCase();
  const out = [];
  for (const it of INTENTS) {
    if (it.terms.some((t) => text.includes(t))) out.push(it.label);
  }
  return out.length ? out : ["综合"];
}

export function inferDeliverable(problem, explicit, catalog) {
  if (typeof explicit === "string" && explicit.trim()) {
    return { id: "explicit", label: explicit.trim(), skill: "", suffix: "", acceptance: [] };
  }
  const text = String(problem || "").toLowerCase();
  for (const d of catalog.deliverables || []) {
    if ((d.keywords || []).some((k) => text.includes(String(k).toLowerCase()))) return d;
  }
  return { id: "report", label: "分析报告", skill: "skill_doc", suffix: "docx", acceptance: [] };
}

const UNIT_RE = /(±\s*)?\d+(?:\.\d+)?\s*(nm|μm|µm|um|mm|cm|m|°|℃|K|%|ms|μs|us|s|fps|hz|khz|mhz|ghz|w|mw|db|kg|g|元|万|px|lp\/mm)/gi;

export function extractConstraints(problem) {
  const text = normalize(problem);
  const out = [];
  const units = [...text.matchAll(UNIT_RE)].map((m) => m[0].replace(/\s+/g, " "));
  if (units.length) out.push("已出现的量值：" + [...new Set(units)].slice(0, 10).join("、"));
  for (const [label, re] of [
    ["预算", /预算|成本|报价|价位|万元|元以内/],
    ["工期", /工期|交付时间|截止|天内|周内|本月|下周/],
    ["平台", /Windows|Linux|本机|桌面|浏览器|DSH|MATLAB|Python|ZEMAX|COMSOL|SolidWorks/],
    ["环境", /温度|湿度|真空|振动|车载|机载|空间|水下/]
  ]) {
    if (re.test(text)) out.push(label + "：文中已提及");
  }
  return out;
}

const QUESTION_RULES = {
  optical_design: [
    { q: "工作波段与视场角是多少？", unless: /nm|μm|um|波段|红外|可见|紫外|视场|°|度/i },
    { q: "F/# 或入瞳直径有硬约束吗？", unless: /f\/|f数|f\/#|入瞳|na\b|数值孔径/i },
    { q: "畸变、MTF、后截距的验收阈值是多少？", unless: /畸变|mtf|后截距|验收/i },
    { q: "有没有已有的初始结构或可复用镜头？", unless: /初始|结构|镜头|物镜|专利/i }
  ],
  hyperspectral: [
    { q: "光谱范围、光谱分辨率、空间分辨率与幅宽分别是多少？", unless: /nm|μm|um|光谱|分辨率|幅宽|gsd/i },
    { q: "推扫还是快照？平台速度/高度已知吗？", unless: /推扫|快照|速度|高度|平台/i },
    { q: "SNR 或辐亮度定标要求是什么？", unless: /snr|信噪比|辐亮度|定标/i },
    { q: "探测器型号、像元尺寸与帧频有约束吗？", unless: /探测器|像元|帧频|cmos|ccd/i }
  ],
  testing_alignment: [
    { q: "要测哪些量，基准件是什么？", unless: /测|基准|面形|波前|mtf|偏心|间隔/i },
    { q: "允许的测量不确定度与判据是多少？", unless: /不确定度|判据|公差|允差/i },
    { q: "现场有哪些仪器（干涉仪/自准直仪/MTF 台）？", unless: /干涉仪|自准直|mtf|仪器|设备/i },
    { q: "环境温湿度与振动条件如何？", unless: /温度|湿度|振动|环境/i }
  ],
  confocal_sensing: [
    { q: "量程、分辨率、工作距离与光斑要求？", unless: /量程|分辨率|工作距离|光斑/i },
    { q: "被测面材质/粗糙度/倾角范围？", unless: /材质|粗糙度|倾角|表面/i },
    { q: "采样率与运动速度匹配要求？", unless: /采样|速度|带宽|频率/i }
  ],
  spectrometer: [
    { q: "波段、分辨率、杂散光与效率指标？", unless: /nm|μm|um|波段|分辨率|杂散光|效率/i },
    { q: "体积/成本/装调难度哪个优先？", unless: /体积|成本|装调|优先/i },
    { q: "偏振敏感度有要求吗？", unless: /偏振/i }
  ],
  imaging_camera: [
    { q: "物方分辨率、视场、工作距离与景深？", unless: /分辨率|视场|工作距离|景深/i },
    { q: "运动速度与帧率/曝光约束？", unless: /速度|帧率|曝光/i },
    { q: "弱光还是高动态范围优先？", unless: /弱光|动态范围|信噪比/i }
  ],
  thin_film: [
    { q: "波段、入射角范围与偏振要求？", unless: /nm|μm|um|波段|入射角|偏振/i },
    { q: "温度循环与附着力/环境试验标准？", unless: /温度|附着|环境|试验/i },
    { q: "镀膜工艺与成本上限？", unless: /镀膜|工艺|成本|预算/i }
  ],
  troubleshooting: [
    { q: "故障现象、发生条件、频率？", unless: /现象|报错|异常|频率|条件/i },
    { q: "最近改过什么（硬件/软件/环境）？", unless: /改过|变更|升级|更换/i },
    { q: "手上有哪些原始数据与日志？", unless: /数据|日志|记录|原始/i }
  ],
  literature: [
    { q: "比较维度与权重？", unless: /维度|权重|指标|比较/i },
    { q: "预算/时间/供应链约束？", unless: /预算|成本|时间|供货|供应链/i },
    { q: "必须满足的硬指标与淘汰线？", unless: /硬指标|淘汰线|必须|阈值/i }
  ],
  generic: [
    { q: "最终要交付什么文件/结论？", unless: /交付|报告|表格|ppt|结论/i },
    { q: "有哪些硬约束（波段、精度、预算、工期）？", unless: /nm|μm|um|精度|预算|工期|约束/i },
    { q: "现有资料和数据在哪里？", unless: /资料|数据|文件|路径|workspace/i }
  ]
};

export function buildQuestions(problem, playbook) {
  const text = String(problem || "");
  const rules = QUESTION_RULES[playbook.id] || QUESTION_RULES.generic;
  const unknown = [];
  for (const r of rules) {
    if (r.unless.test(text)) continue;
    unknown.push(r.q);
    if (unknown.length >= 3) break;
  }
  return unknown;
}

function excerpt(text, tokens, budget = 220) {
  const full = String(text || "");
  const m = /^【([^】]{1,60})】/.exec(full);
  const title = m ? m[1] : "";
  const body = m ? full.slice(m[0].length).trim() : full;
  if (body.length <= budget) return { title, excerpt: body };
  let at = -1;
  for (const t of tokens) {
    const i = body.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return { title, excerpt: body.slice(0, budget) + " …" };
  const half = Math.floor((budget - 2) / 2);
  let start = Math.max(0, at - half);
  const end = Math.min(body.length, start + budget);
  start = Math.max(0, end - budget);
  return { title, excerpt: (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? " …" : "") };
}

/** 把 anchor 拆成可用检索短语，去掉过短的虚词。 */
function anchorTerms(anchor) {
  return String(anchor || "")
    .split(/[\/、|,，]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 18)
    .slice(0, 3);
}

/** 概念卡匹配：先看 applies_to 是否覆盖该维度，再看关键词重叠。 */
function matchConceptCards(cards, dim, limit = 2) {
  if (!Array.isArray(cards) || !cards.length) return [];
  const terms = [dim.label, ...anchorTerms(dim.anchor)].map((s) => String(s).toLowerCase()).filter(Boolean);
  const scored = [];
  for (const c of cards) {
    let score = 0;
    if (Array.isArray(c.applies_to) && c.applies_to.includes(dim.id)) score += 3;
    const blob = (Array.isArray(c.keywords) ? c.keywords.join(" ") : String(c.keywords || "")) + " " + String(c.statement || "");
    for (const t of terms) {
      if (t.length >= 2 && blob.includes(t)) score += 1;
    }
    if (score >= 3) scored.push({ card: c, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || String(a.card.id).localeCompare(String(b.card.id)))
    .slice(0, limit)
    .map(({ card }) => ({ id: card.id, kind: card.kind, title: card.title, statement: card.statement, source_chunk_ids: card.source_chunk_ids }));
}

/**
 * 分面取证：每个必答维度独立检索，互不覆盖。
 * 每面返回证据、概念卡、命中 id 与缺口原因；全局证据按维度优先级聚合。
 */
export function collectEvidenceByDimensions(problem, dimensions, playbook, chunks, searchKB, meta, options = {}) {
  const depth = options.depth || "standard";
  const topK = depth === "quick" ? 2 : depth === "deep" ? 5 : 4;
  const limit = depth === "quick" ? 6 : depth === "deep" ? 12 : 10;
  const conceptCards = Array.isArray(options.conceptCards) ? options.conceptCards : [];
  const rows = [];
  const all = [];
  const seen = new Set();

  for (const dim of dimensions) {
    const queries = [...new Set([dim.label, dim.anchor, ...anchorTerms(dim.anchor), ...(dim.queries || [])].filter(Boolean))].slice(0, 4);
    const hits = new Map();
    const usedQueries = [];
    for (const q of queries) {
      let found = [];
      try {
        found = searchKB(chunks, q, topK) || [];
      } catch {
        found = [];
      }
      let any = false;
      for (const h of found) {
        if (!h || !h.score || h.score <= 0) continue;
        any = true;
        const prev = hits.get(h.chunk_id);
        if (!prev) {
          const ex = excerpt(h.text, keywordsOf(q + " " + dim.label));
          hits.set(h.chunk_id, {
            chunk_id: h.chunk_id,
            doc_id: h.doc_id,
            status: h.status || "present",
            title: ex.title,
            score: h.score,
            source: h.source,
            page: h.page_or_section,
            excerpt: ex.excerpt,
            queries: [q],
            chars: String(h.text || "").length
          });
        } else if (prev.score < h.score) {
          prev.score = h.score;
          if (!prev.queries.includes(q)) prev.queries.push(q);
        } else if (!prev.queries.includes(q)) {
          prev.queries.push(q);
        }
      }
      if (any) usedQueries.push(q);
    }

    const evidence = [...hits.values()]
      .sort((a, b) => b.score - a.score || String(a.chunk_id).localeCompare(String(b.chunk_id)))
      .slice(0, topK);
    const concepts = matchConceptCards(conceptCards, dim, 2);

    rows.push({
      id: dim.id,
      label: dim.label,
      priority: dim.priority,
      domains: dim.domains,
      boards: dim.boards,
      anchor: dim.anchor,
      sources: dim.sources,
      status: evidence.length ? "covered" : "gap",
      // 维度 × 来源：KB 是否覆盖、是否必须外部补证；外部命中由 verify 采信闸门回填
      source_matrix: {
        kb: { status: evidence.length ? "covered" : "gap", hits: evidence.length, chunk_ids: evidence.map((e) => e.chunk_id) },
        web: { status: evidence.length ? "not_required" : "required", queries: evidence.length ? 0 : queries.length }
      },
      evidence,
      hit_chunk_ids: evidence.map((e) => e.chunk_id),
      queries,
      used_queries: usedQueries,
      concept_cards: concepts,
      gap_reason: evidence.length
        ? null
        : "该维度在 KB 中无 present 命中（queries: " + queries.join(" / ") + "）；可换关键词，或按 web_gate 走外部补证。"
    });

    for (const e of evidence) {
      if (seen.has(e.chunk_id)) {
        const prev = all.find((x) => x.chunk_id === e.chunk_id);
        if (prev && !prev.dimension_ids.includes(dim.id)) prev.dimension_ids.push(dim.id);
        continue;
      }
      seen.add(e.chunk_id);
      all.push({ ...e, dimension_ids: [dim.id], dimension_labels: [dim.label] });
    }
  }

  // 全局证据：优先剧本板块，跨板块最多补 2 条
  const preferred = new Set(playbook.sections || []);
  const hasPreferred = preferred.size > 0;
  const decorated = all.map((e) => ({ ...e, in_playbook: !hasPreferred || preferred.has(String(e.doc_id || "")) }));
  const primary = decorated.filter((e) => e.in_playbook);
  const secondary = decorated.filter((e) => !e.in_playbook).slice(0, 2);
  const evidence = [...primary, ...secondary].slice(0, limit);

  const covered = rows.filter((r) => r.status === "covered").length;
  const gaps = rows.filter((r) => r.status === "gap").map((r) => ({
    aspect: r.label,
    dimension_id: r.id,
    kind: "主题未覆盖",
    note: r.gap_reason
  }));

  const zeroTopics = meta && Array.isArray(meta.zero_coverage_topics) ? meta.zero_coverage_topics : [];
  const blockedTopics = zeroTopics.filter((t) => String(problem).toLowerCase().includes(String(t).toLowerCase()));
  for (const t of blockedTopics) {
    gaps.push({ aspect: t, kind: "声明不覆盖", note: "该主题按维护者要求不纳入知识库；检索为空是正确行为。" });
  }

  const rawGapSections = ["A03", "C01", "E01"];
  const referencedRawGaps = evidence
    .filter((e) => rawGapSections.includes(String(e.doc_id || "")))
    .map((e) => ({ doc_id: e.doc_id, note: "该板块存在原文层缺口，引用前用 opticforge_get 核对 status；status≠present 时不可当作逐字原文。" }));

  return {
    dimensions: rows,
    evidence,
    gaps,
    raw_source_gaps: [...new Map(referencedRawGaps.map((x) => [x.doc_id, x])).values()],
    coverage: {
      aspects_total: rows.length,
      aspects_covered: covered,
      dimensions_total: rows.length,
      dimensions_covered: covered,
      evidence_count: evidence.length,
      concept_card_count: rows.reduce((a, r) => a + r.concept_cards.length, 0),
      confidence: covered === 0 ? "none" : covered / Math.max(1, rows.length) >= 0.7 ? "high" : covered / Math.max(1, rows.length) >= 0.4 ? "medium" : "low"
    }
  };
}

const CAPABILITY_TOOLS = {
  clarify: ["interaction.ask"],
  kb: ["opticforge_search", "opticforge_get"],
  local_scan: ["Glob", "Read", "Grep", "PowerShell"],
  calc: ["run_code", "Python", "PowerShell", "sheet"],
  skill_doc: ["word", "lark-doc", "doubao-app-builder"],
  skill_sheet: ["sheet"],
  skill_ppt: ["ppt"],
  skill_code: ["Write", "Edit", "PowerShell", "Bash"],
  skill_image: ["seedream-55", "image_gen", "image_edit"],
  mcp_desktop: ["computer_use_tool", "mac_computer_use_tool"],
  web_search: ["general_search", "web_search", "video_search", "image_search"],
  web_fetch: ["web_fetch"],
  analysis: ["run_code", "Python", "PowerShell", "sheet"],
  verify: ["opticforge_verify"],
  deliver: ["present_files"]
};

const SKILL_HINTS = {
  skill_doc: ["word", "lark-doc", "lark-markdown", "markdown", "doc"],
  skill_sheet: ["sheet", "excel", "table", "csv"],
  skill_ppt: ["ppt", "slide", "presentation"],
  skill_image: ["image", "seedream", "draw", "design"],
  mcp_desktop: ["browser", "computer", "desktop", "gui"],
  calc: ["sheet", "python", "script"],
  skill_code: ["code", "python", "script"],
  analysis: ["sheet", "data", "analysis"]
};

function skillMatchScore(name, hint) {
  const n = String(name || "").toLowerCase();
  const h = String(hint || "").toLowerCase();
  if (!n || !h) return 0;
  if (n === h) return 4;
  if (n.startsWith(h + "-") || n.startsWith(h + "_") || n.startsWith(h + ".")) return 3;
  return 0;
}

function candidateSkills(capability, skills) {
  const hints = SKILL_HINTS[capability] || [];
  if (!hints.length) return [];
  const scored = [];
  for (const s of skills || []) {
    let score = 0;
    for (const h of hints) score = Math.max(score, skillMatchScore(s.name, h));
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.s.name).localeCompare(String(b.s.name)));
  return scored.slice(0, 4).map(({ s }) => ({
    name: s.name,
    description: s.description || "",
    source: s.path ? "local-skill" : "declared"
  }));
}

export function capabilityPlan(capability, caps) {
  const tools = CAPABILITY_TOOLS[capability] || [];
  const skills = candidateSkills(capability, caps?.skills);
  return {
    capability,
    recommended_skills: skills,
    recommended_tools: tools.map((t) => ({ name: t, availability: "check-at-runtime" })),
    mcp_servers: capability === "mcp_desktop" ? (caps?.mcp_servers || []).slice(0, 6) : [],
    fallback: skills.length ? "Skill 不可用时用本地文件/脚本直接完成" : "无对应 Skill 时用本地工具直接完成"
  };
}

function stepActions(step, ctx) {
  const q = ctx.topic;
  switch (step.capability) {
    case "clarify":
      return ["用 interaction.ask 一次性问清 " + (ctx.questions.length ? ctx.questions.join("；") : "缺失的硬约束"), "拿到回答后再改计划，不要先算"];
    case "kb":
      return ["opticforge_search(\"" + q + "\", top_k=6)", "对关键条目 opticforge_get(chunk_id) 取全文并记录来源", "没有命中就写缺口，不编造"];
    case "local_scan":
      return ctx.workspace
        ? ["扫描 " + ctx.workspace + " 下的图纸/数据/代码/文档", "按文件名与扩展名挑出可复用素材", "缺素材时列出需要用户提供的文件清单"]
        : ["先建工作目录并收集输入文件", "没有本地素材就说明将从零构建"];
    case "calc":
      return ["明确输入量、单位、假设与公式", "用 run_code/Python/PowerShell 跑数值并用表格留过程", "结果做量级与边界检查"];
    case "skill_sheet":
      return ["调用表格 Skill 建指标/预算/公差表", "每列写单位与来源", "冻结表头并留公式"];
    case "skill_doc":
      return ["调用文档 Skill 写报告/方案/SOP", "结论先行，关键数字带引用", "缺口与假设单列一节"];
    case "skill_ppt":
      return ["调用幻灯片 Skill 组页", "一页一个结论，图表标来源", "按汇报时长控制页数"];
    case "skill_code":
      return ["先写最小可运行版本", "用本地运行时跑样例数据", "补边界条件与失败提示"];
    case "skill_image":
      return ["调用图像 Skill 生成示意图/版式", "尺寸与标注符合交付场景"];
    case "mcp_desktop":
      return ["优先用网页/桌面 MCP 完成登录态操作", "操作前先观察当前界面", "每步验证结果，不盲点"];
    case "web_search":
      return (ctx.searchQueries.length ? ctx.searchQueries.slice(0, 3) : ["general_search(\"" + q + "\")"]).map((s) => "检索：" + s);
    case "web_fetch":
      return ["对高价值链接 web_fetch 精读", "只抽取原文事实并记 URL/日期", "厂商参数注明型号与测试条件"];
    case "analysis":
      return ["读入原始数据并做质量检查", "统计/拟合/图像处理，保留中间结果", "给出判据与置信区间"];
    case "verify":
      return ["opticforge_verify(text 或 path) 复核引用与单位", "逐条过验收清单", "不通过项回到对应步骤修正"];
    case "deliver":
      return ["统一命名（项目_内容_版本/日期）", "present_files 交付最终文件", "附一页说明：假设、缺口、复现方式"];
    default:
      return ["按步骤目标执行并留下可核查输出"];
  }
}

/**
 * web_gate：默认禁网。只有以下条件命中才放行：
 *   - kb_gap：KB 取证后仍有主题缺口或声明不覆盖主题
 *   - standard_version：问题提及标准/规范/ISO/GB/JJF/版本
 *   - vendor_params：问题提及厂商/型号/datasheet/选型/供应商
 *   - price_timeliness：问题提及预算/成本/报价/最新年份/交期
 * 门禁只做判断，不发起任何检索。所有字段机器可检查。
 */
export function evaluateWebGate(problem, constraints, evidencePack) {
  const text = String(problem || "") + " " + (constraints || []).join(" ");
  const lower = text.toLowerCase();
  const gaps = evidencePack.gaps || [];
  const hasTopicGap = gaps.some((g) => g.kind === "主题未覆盖");
  const hasDeclaredGap = gaps.some((g) => g.kind === "声明不覆盖");

  const conditions = [
    {
      id: "kb_gap",
      when: "KB 取证后仍存在主题缺口或声明不覆盖主题",
      granted: hasTopicGap || hasDeclaredGap,
      evidence: gaps.slice(0, 6).map((g) => g.aspect)
    },
    {
      id: "standard_version",
      when: "问题提及标准/规范/ISO/GB/JJF/版本号",
      granted: /标准|规范|iso\b|gb\/?t|jjf|国标|行标|版本号|条文号/i.test(lower)
    },
    {
      id: "vendor_params",
      when: "问题提及厂商/型号/datasheet/选型/供应商/具体器件",
      granted: /厂商|厂家|型号|datasheet|选型|供应商|供货|品牌|探测器|相机|镜头|干涉仪|探头/i.test(lower)
    },
    {
      id: "price_timeliness",
      when: "问题提及预算/成本/报价/价格/最新年份/交期时效",
      granted: /预算|成本|报价|价格|万元|元以内|最新|2024|2025|2026|现货|交期|时效/i.test(lower)
    }
  ];
  const grantedIds = conditions.filter((c) => c.granted).map((c) => c.id);
  return {
    policy: "default_deny_explicit_allowlist",
    allowed: grantedIds.length > 0,
    reason: grantedIds.length > 0
      ? "条件命中：" + grantedIds.join(",")
      : "default_deny：未命中任何放行条件，禁止联网",
    conditions,
    note: "本门禁只做判断，不发起任何检索；执行层须在 allowed=true 且 blocked_by 解除后才可调用 web_search/web_fetch。"
  };
}

function gateGranted(webGate, id) {
  return !!(webGate && Array.isArray(webGate.conditions) && webGate.conditions.find((c) => c.id === id && c.granted));
}

/**
 * 构建 plan：维度化。每个专业步骤带 dimension_id；每个必答维度都能被
 * 取证步或补证步覆盖；交叉关系落到 coordinates_with 的耦合步。
 * web_gate 未放行时，web 步骤保留但 blocked=true，动作改为门禁拦截提示。
 */
export function buildPlan(problem, playbooks, deliverable, evidencePack, caps, options = {}) {
  const list = Array.isArray(playbooks) ? playbooks : [playbooks];
  const playbook = list[0];
  const dimensions = options.dimensions || [];
  const relations = options.relations || [];
  const questions = options.questions || [];
  const workspace = options.workspace || "";
  const topic = playbook.label;
  const webGate = options.webGate || { allowed: false, conditions: [] };
  const searchPack = Array.isArray(options.searchPack) ? options.searchPack : [];
  const extGroups = searchPack.filter((g) => g.scope === "external");
  const extQueriesFor = (gateId) => extGroups
    .filter((g) => g.gate_id === gateId && !g.gated)
    .flatMap((g) => g.queries || []);
  const extQueriesForDimension = (gateId, dimId) => extGroups
    .filter((g) => g.gate_id === gateId && !g.gated && g.dimension_id === dimId)
    .flatMap((g) => g.queries || []);
  const allGrantedExtQueries = extGroups.filter((g) => !g.gated).flatMap((g) => g.queries || []);

  const steps = [];
  const push = (phase, goal, capability, output, why, extra, webQueries) => {
    const id = "S" + (steps.length + 1);
    const base = {
      id,
      phase,
      goal,
      capability,
      why: why || "",
      output,
      actions: stepActions({ capability }, {
        topic,
        questions,
        workspace,
        searchQueries: Array.isArray(webQueries) ? webQueries : (options.searchQueries || [])
      }),
      routing: capabilityPlan(capability, caps),
      blocked_by: [],
      gate_id: null,
      blocked: false,
      web_gated: false,
      external_queries: [],
      dimension_id: null,
      dimension_ids: [],
      coordinates_with: []
    };
    steps.push({ ...base, ...(extra || {}) });
    return steps[steps.length - 1];
  };

  let clarifyId = null;
  if (questions.length) {
    const s = push("澄清", "补齐会改变方案走向的硬约束", "clarify", "澄清清单（≤3 问）", "缺这些输入会导致方案选错或返工", { blocked_by: [] });
    clarifyId = s.id;
  }
  const dimsText = dimensions.length ? "按 " + dimensions.length + " 个必答维度分面取证（每面独立检索）" : "把问题拆成检索面，逐面找可引用条目并标缺口";
  const kbStep = push("取证", dimsText, "kb", "证据包（chunk_id + 来源 + 摘录 + 维度覆盖）", "先有依据再计算，避免用常识替代知识库", {
    blocked_by: clarifyId ? [clarifyId] : [],
    dimension_ids: dimensions.map((d) => d.id)
  });
  const kbId = kbStep.id;
  push("盘点", workspace ? "盘点本地素材，判断哪些能直接复用" : "确认输入文件与工作目录", "local_scan", "素材清单/缺口清单", "本地已有数据往往决定工作量与方案", { blocked_by: [kbId] });

  const seenStep = new Set();
  for (const pb of list) {
    for (const s of pb.steps || []) {
      const key = s.phase + "|" + s.goal;
      if (seenStep.has(key)) continue;
      seenStep.add(key);
      const isWeb = s.capability === "web_search" || s.capability === "web_fetch";
      const extra = {
        blocked_by: [kbId],
        dimension_id: s.dimension_id || null
      };
      if (isWeb) {
        const gateId = s.gate_id || "kb_gap";
        const unblocked = gateGranted(webGate, gateId);
        const queries = unblocked ? extQueriesFor(gateId) : [];
        Object.assign(extra, {
          blocked_by: [kbId, "web_gate"],
          gate_id: gateId,
          blocked: !unblocked,
          web_gated: true,
          external_queries: queries
        });
        const step = push(s.phase, s.goal, s.capability, s.output, (pb.focus || [])[0] || "", extra, queries);
        if (!unblocked) {
          step.actions = [
            "web_gate 未放行（条件 " + gateId + " 未命中），禁止发起外部检索",
            "如需联网，先满足触发条件：" + (webGate.conditions.find((c) => c.id === gateId) || {}).when,
            "本步骤仅保留意图，等门禁放行后再执行"
          ];
        }
      } else {
        push(s.phase, s.goal, s.capability, s.output, (pb.focus || [])[0] || "", extra);
      }
    }
  }

  // 缺口补证步：只针对 status=gap 且有独立外部查询组的维度
  for (const d of dimensions) {
    if (d.status !== "gap") continue;
    const group = extGroups.find((g) => g.dimension_id === d.id && g.gate_id === "kb_gap");
    if (!group) continue;
    const unblocked = !group.gated;
    const queries = unblocked ? extQueriesForDimension("kb_gap", d.id) : [];
    const step = push(
      "缺口补证",
      "只补「" + d.label + "」这一面：外部检索后把来源回写到该维度",
      "web_search",
      "外部证据（URL/日期/来源等级）",
      "KB 没有这一面的可引用条目，必须单独补，不能用相邻面的结论替代",
      {
        blocked_by: [kbId, "web_gate"],
        gate_id: "kb_gap",
        blocked: !unblocked,
        web_gated: true,
        external_queries: queries,
        dimension_id: d.id
      },
      queries
    );
    if (!unblocked) {
      step.actions = [
        "web_gate 未放行（kb_gap 未命中），禁止发起外部检索",
        "KB 已有该面证据时先补 KB，不要为凑覆盖而联网",
        "本步骤仅保留意图，等门禁放行后再执行"
      ];
    }
  }

  if (list.some((p) => (p.search || []).length)) {
    const unblocked = webGate.allowed;
    const queries = unblocked ? allGrantedExtQueries : [];
    const step = push(
      "外部核验",
      unblocked ? "只对知识库覆盖不足或需要最新/厂商事实的点做定向检索" : "门禁未放行：保留检索意图但禁止发起外部检索",
      "web_search",
      "外部来源清单（URL/日期/型号/来源等级）",
      "知识库是静态的，标准版本与厂商参数必须外部核对",
      {
        blocked_by: [kbId, "web_gate"],
        gate_id: "any",
        blocked: !unblocked,
        web_gated: true,
        external_queries: queries,
        dimension_ids: dimensions.filter((d) => d.status === "gap").map((d) => d.id)
      },
      queries
    );
    if (!unblocked) {
      step.actions = [
        "web_gate 未放行（allowed=false），禁止发起外部检索",
        "如需联网，先在 web_gate.conditions 中至少命中一条",
        "本步骤仅保留意图，等门禁放行后再执行"
      ];
    }
  }

  // 交叉复核步：关系两端合写在一处，避免各维度各写一遍
  let crossStep = null;
  if (relations.length) {
    const dimById = new Map(dimensions.map((d) => [d.id, d]));
    crossStep = push(
      "交叉复核",
      "把维度关系逐对核对，确保两面结论不互斥",
      "analysis",
      "交叉检查结论（每对关系的取舍与证据）",
      "单面都对、合起来矛盾，是交叉任务最常见的翻车点",
      { blocked_by: [kbId], dimension_ids: [...new Set(relations.flatMap((r) => [r.from, r.to]))] }
    );
    crossStep.actions = relations.map((r) => {
      const from = dimById.get(r.from)?.label || r.from;
      const to = dimById.get(r.to)?.label || r.to;
      return "核对「" + from + "」与「" + to + "」：" + (r.note || r.type || "约束关系") + "；两面数字放在同一张表里比较";
    });
    crossStep.cross_checks = [...new Set(list.flatMap((p) => p.cross_check || []))];
  }

  push("交付", "按交付物类型组织内容并生成文件", deliverable.skill || "skill_doc", deliverable.label + "（" + (deliverable.suffix || "文件") + "）", "交付物要能被直接使用，而不是只给建议", { blocked_by: [kbId] });
  push("自检", "复核引用、单位、假设、缺口、维度覆盖与验收清单", "verify", "自检报告（通过/不通过项）", "没有自检的交付物不能算完成", { blocked_by: [kbId], dimension_ids: dimensions.map((d) => d.id) });
  push("收口", "整理文件、命名、版本与复现说明", "deliver", "最终文件 + 交接说明", "让用户能复现和继续迭代", { blocked_by: [kbId] });

  // coordinates_with：关系两端的专业步骤两两联动，交叉步与所有相关步骤互指
  const professional = steps.filter((s) => s.dimension_id);
  for (const r of relations) {
    const fromSteps = professional.filter((s) => s.dimension_id === r.from).map((s) => s.id);
    const toSteps = professional.filter((s) => s.dimension_id === r.to).map((s) => s.id);
    for (const a of fromSteps) {
      for (const b of toSteps) {
        if (a === b) continue;
        const sa = steps.find((s) => s.id === a);
        const sb = steps.find((s) => s.id === b);
        if (!sa.coordinates_with.includes(b)) sa.coordinates_with.push(b);
        if (!sb.coordinates_with.includes(a)) sb.coordinates_with.push(a);
      }
    }
    if (crossStep) {
      const involved = [...fromSteps, ...toSteps];
      crossStep.coordinates_with = [...new Set([...crossStep.coordinates_with, ...involved])];
      for (const id of involved) {
        const s = steps.find((x) => x.id === id);
        if (s && !s.coordinates_with.includes(crossStep.id)) s.coordinates_with.push(crossStep.id);
      }
    }
  }

  // 关键路径：澄清→取证→交叉复核→交付→自检
  const critical = steps.filter((s) => ["澄清", "取证", "交叉复核", "交付", "自检"].includes(s.phase)).map((s) => s.id);
  const parallel = steps.filter((s) => !critical.includes(s.id) && !s.web_gated && !s.coordinates_with.length).map((s) => s.id);
  return {
    steps,
    critical_path: critical,
    parallelizable: parallel,
    estimated_steps: steps.length,
    kb_evidence_step: kbId,
    web_gated_steps: steps.filter((s) => s.web_gated).map((s) => s.id),
    cross_checks: [...new Set(list.flatMap((p) => p.cross_check || []))],
    dimensions_covered: dimensions.filter((d) => d.status === "covered").map((d) => d.id),
    dimensions_gap: dimensions.filter((d) => d.status === "gap").map((d) => d.id)
  };
}

const DIM_EN = {
  spec: "requirement breakdown",
  spectrometer: "spectrometer design",
  aberration: "aberration and optomechanics",
  detector: "detector and noise",
  algorithm: "data processing algorithm",
  circuit: "readout circuit and timing",
  calibration: "calibration",
  initial_structure: "initial lens structure",
  tolerance: "tolerance analysis",
  manufacturability: "manufacturability",
  stray_light: "stray light and ghost",
  metrology: "metrology",
  assembly: "alignment and assembly",
  environment: "environmental disturbance",
  criterion: "acceptance criteria",
  record: "traceability record",
  principle: "principle",
  probe: "probe and spot size",
  range: "range and resolution",
  signal: "signal demodulation",
  grating: "grating dispersion",
  structure: "spectrometer structure",
  efficiency: "grating efficiency",
  resolution: "spectral resolution",
  chain: "imaging chain",
  lens: "lens and interface",
  illumination: "illumination",
  interface: "interface and trigger",
  design: "coating design",
  material: "optical material",
  thermal: "thermal drift",
  stress: "film stress",
  process: "coating process",
  measurement: "thin film measurement",
  phenomenon: "failure phenomenon",
  isolation: "measurement chain isolation",
  root_cause: "root cause",
  optics: "optical path",
  electronics: "electronics and noise",
  criteria: "comparison criteria",
  maturity: "technology maturity",
  supply: "supply chain",
  verification: "verification",
  cost: "cost",
  standard: "standard compliance",
  mechanism: "adjustment mechanism",
  timing: "trigger and timing",
  athermal: "athermalization",
  image: "image quality",
  waveguide: "waveguide",
  source: "light source",
  demodulation: "demodulation",
  packaging: "packaging reliability",
  interference: "interference",
  uniformity: "uniformity and eyebox",
  manufacturing: "manufacturing yield",
  display: "display optics",
  frontend: "analog frontend",
  conversion: "ADC conversion",
  power: "power and grounding",
  model: "measurement model",
  components: "uncertainty components",
  combine: "combined uncertainty",
  traceability: "traceability chain",
  drift: "drift and recalibration",
  calc: "calculation and budget",
  implementation: "implementation and process",
  risk: "error and risk"
};

function enOf(dim) {
  return DIM_EN[dim.id] || String(dim.id || "").replace(/_/g, " ");
}

/**
 * 检索包：KB 查询（scope=kb）与外部查询（scope=external）分账。
 * v3.1 起外部查询按维度分组：缺一面就多一组，带 dimension_id，便于回写覆盖矩阵。
 */
export function buildSearchPack(problem, playbooks, dimensions, constraints, webGate) {
  const list = Array.isArray(playbooks) ? playbooks : [playbooks];
  const primary = list[0];
  const topic = primary.label;
  const out = [];
  const seen = new Set();
  const addExt = (g) => {
    const key = [g.facet, g.gate_id, ...(g.queries || [])].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(g);
  };

  // KB 检索面：本地 opticforge_search，不联网
  out.push({
    facet: "KB·主题",
    scope: "kb",
    purpose: "本地知识库定向检索（opticforge_search），不联网",
    queries: [...new Set([...(primary.aspects || []), ...dimensions.map((d) => d.label), topic])].filter(Boolean).slice(0, 10),
    blocked_by: null,
    gate_id: null
  });

  // 剧本自带的外部检索面（多剧本全部并入）
  for (const s of list.flatMap((p) => p.search || [])) {
    const gateId = s.gate_id || "kb_gap";
    addExt({
      facet: s.facet || "资料",
      scope: "external",
      purpose: "补齐知识库没有的最新/厂商/标准事实",
      queries: [s.zh, s.en].filter(Boolean),
      gate_id: gateId,
      trigger: (webGate.conditions.find((c) => c.id === gateId) || {}).when || "KB 取证存在缺口时",
      gated: !gateGranted(webGate, gateId),
      blocked_by: ["kb_evidence", "web_gate"],
      dimension_id: null
    });
  }

  addExt({
    facet: "标准与规范",
    scope: "external",
    purpose: "确认标准版本、适用范围与条文号",
    queries: [topic + " 标准 规范", topic + " ISO standard", topic + " GB/T 标准"],
    gate_id: "standard_version",
    trigger: "问题提及标准/规范/版本时放行",
    gated: !gateGranted(webGate, "standard_version"),
    blocked_by: ["kb_evidence", "web_gate"],
    dimension_id: null
  });
  addExt({
    facet: "误差与预算",
    scope: "external",
    purpose: "找同类系统的误差分配与验收口径",
    queries: [topic + " 误差 预算", topic + " error budget analysis"],
    gate_id: "kb_gap",
    trigger: "KB 取证存在缺口时放行",
    gated: !gateGranted(webGate, "kb_gap"),
    blocked_by: ["kb_evidence", "web_gate"],
    dimension_id: null
  });

  // 动态缺面：每个 gap 维度单独一组中英查询，便于把 web 证据回写到该维度
  for (const d of dimensions.filter((x) => x.status === "gap")) {
    addExt({
      facet: "缺口·" + d.label,
      scope: "external",
      purpose: "只补这一面的 KB 缺口，检索结果按维度回写",
      queries: [topic + " " + d.label + " 设计 判据", enOf(d) + " design guideline standard"],
      gate_id: "kb_gap",
      trigger: (webGate.conditions.find((c) => c.id === "kb_gap") || {}).when || "KB 取证存在缺口时",
      gated: !gateGranted(webGate, "kb_gap"),
      blocked_by: ["kb_evidence", "web_gate"],
      dimension_id: d.id
    });
  }

  if (constraints.some((c) => c.startsWith("预算"))) {
    addExt({
      facet: "成本",
      scope: "external",
      purpose: "核对成本区间与供货",
      queries: [topic + " 报价 选型", topic + " price vendor"],
      gate_id: "price_timeliness",
      trigger: "问题提及预算/成本/报价时放行",
      gated: !gateGranted(webGate, "price_timeliness"),
      blocked_by: ["kb_evidence", "web_gate"],
      dimension_id: null
    });
  }
  return out;
}

export function buildAcceptance(playbook, deliverable, dimensions = [], relations = []) {
  const base = [
    "每个关键结论能追到 KB chunk_id 或外部来源（URL/标准号/型号）",
    "覆盖 dimensions 中每个必答维度；缺面标 gap，外部补齐的标 covered_by_web",
    "交叉关系逐对核对，两面数字放在同一张表里，不出现互斥结论",
    "所有数值带单位、假设与计算过程，不出现无来源的精确数字",
    "外部事实标来源等级与访问日期；单源关键数值标「单源待核」",
    "缺口单列：A03/C01/E01 原文层缺口不得伪装成逐字引用",
    "web_gate.allowed=false 时不得发起任何外部检索",
    "交付文件可打开、命名含项目/内容/版本/日期",
    "给出复现步骤或输入清单，他人可重跑"
  ];
  const extra = [...(deliverable.acceptance || [])];
  for (const d of dimensions) {
    extra.push("已答维度：" + d.label + (d.status === "gap" ? "（缺面，需外部补证或明示不答）" : ""));
  }
  for (const r of relations) {
    extra.push("已核对耦合：" + r.from + " → " + r.to + (r.note ? "（" + r.note + "）" : ""));
  }
  for (const f of playbook.focus || []) extra.push("已回答：" + f);
  return [...new Set([...base, ...extra])];
}

export function buildRisks(evidencePack, caps, options = {}) {
  const risks = [];
  for (const g of evidencePack.gaps) risks.push({ level: "medium", type: "知识缺口", message: g.aspect + "：" + g.note });
  for (const g of evidencePack.raw_source_gaps) risks.push({ level: "medium", type: "原文缺口", message: g.doc_id + "：" + g.note });
  const dims = options.dimensions || [];
  const gapDims = dims.filter((d) => d.status === "gap");
  if (gapDims.length) {
    risks.push({ level: "medium", type: "交叉维度", message: "缺口维度：" + gapDims.map((d) => d.label).join("、") + "；交付物必须标 gap 或走 kb_gap 补证，不得用相邻面结论替代。" });
  } else if (dims.length) {
    risks.push({ level: "info", type: "交叉维度", message: "必答维度全覆盖；仍需在交付物中逐面留证据与判据。" });
  }
  if (!caps?.skills?.length) risks.push({ level: "low", type: "能力发现", message: "未扫描到本地 Skill；计划中的 Skill 名称需按当前会话实际可用工具替换。" });
  if (!caps?.mcp_servers?.length) risks.push({ level: "low", type: "能力发现", message: "未发现 MCP 配置；需要桌面/浏览器操作时以会话实际 MCP 为准。" });
  if (!options.workspace) risks.push({ level: "low", type: "输入", message: "未提供 workspace，无法盘点本地素材；执行前需确认输入文件位置。" });
  if (options.webGate && !options.webGate.allowed) {
    risks.push({ level: "info", type: "门禁", message: "web_gate 默认禁网：未命中 KB gap/标准版本/厂商参数/价格时效任一条件，外部检索步骤保持 blocked。" });
  }
  if (options.formulaCardsMissing) {
    risks.push({ level: "info", type: "公式卡", message: "data/formula-cards.json 暂不存在，calc_specs 返回空列表；文件就绪后自动加载，不阻断任务。" });
  }
  risks.push({ level: "info", type: "采信", message: "外部事实须过采信闸门：来源分级（一手源优先）、关键数值多源交叉、单源标待核、与 KB 冲突显式声明、访问日期不陈旧。" });
  risks.push({ level: "info", type: "边界", message: "插件本身不联网、不执行外部动作；检索/调用 Skill/MCP 由执行层按计划与 web_gate 完成。" });
  return risks;
}

function mdEscape(s) {
  return String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function buildHandoff(brief, evidencePack, plan, acceptance, libraryGaps = []) {
  const lines = [];
  lines.push("## 任务");
  lines.push("- 目标：" + brief.goal);
  lines.push("- 交付：" + brief.deliverable.label + (brief.deliverable.suffix ? "（." + brief.deliverable.suffix + "）" : ""));
  lines.push("- 领域：" + brief.domain.label + "；意图：" + brief.intents.join("、"));
  if (brief.constraints.length) lines.push("- 约束：" + brief.constraints.join("；"));
  lines.push("");
  lines.push("## 已有依据");
  for (const e of evidencePack.evidence.slice(0, 6)) lines.push("- [" + e.chunk_id + "] " + (e.title || e.doc_id) + "（" + e.doc_id + "）");
  if (evidencePack.gaps.length) lines.push("- 缺口：" + evidencePack.gaps.map((g) => g.aspect).join("、"));
  const libGaps = Array.isArray(libraryGaps) ? libraryGaps : [];
  if (libGaps.length) lines.push("- 原文缺口：" + libGaps.map((g) => g.doc_id + "（" + g.missing + "/" + g.chunks + "）").join("、") + "，引用条文前先核对 status");
  lines.push("");
  const dims = (evidencePack.dimensions || []);
  if (dims.length) {
    lines.push("## 必答维度");
    for (const d of dims) {
      const hit = d.status === "covered" ? "已覆盖：" + d.hit_chunk_ids.join("、") : "缺口：" + d.gap_reason;
      lines.push("- " + d.label + "（" + d.id + "）：" + hit + (d.concept_cards.length ? "；概念卡：" + d.concept_cards.map((c) => c.id).join("、") : ""));
    }
    lines.push("");
  }
  lines.push("## 执行顺序");
  for (const s of plan.steps) {
    const route = (s.routing.recommended_skills || []).map((x) => x.name);
    const block = s.blocked && s.web_gated ? "  [门禁拦截]" : "";
    lines.push(s.id + ". [" + s.phase + "] " + s.goal + " → " + s.output + (route.length ? "（Skill：" + route.join("/") + "）" : "") + block);
  }
  lines.push("");
  lines.push("## 验收");
  for (const a of acceptance.slice(0, 8)) lines.push("- " + mdEscape(a));
  return lines.join("\n");
}

/**
 * 按问题领域匹配公式卡，返回 calc_specs（只描述，不计算、不写文件）。
 * 选择是分层优先级：
 *   Tier 0 — 问题原文直接命中 keywords[]，优先解决具体计算意图
 *   Tier 1 — domains[] 命中（playbook.id 或问题文本含领域标签）
 *   Tier 2 — keywords[] 命中
 *   Tier 3 — 降级：标题/公式/变量符号/含义命中问题关键词；或 source_chunk_ids 与证据 chunk 交集
 * 只要某一层有命中，就只返回该层的卡，下层不再混入（避免诱饵卡把 fallback 命中的卡混进来）。
 */
export function matchFormulaCards(problem, cards, evidencePack, domainHint) {
  if (!Array.isArray(cards) || !cards.length) return [];
  const kws = keywordsOf(problem).slice(0, 12);
  const lower = String(problem || "").toLowerCase();
  const domain = String(domainHint || "").toLowerCase();
  const evIds = new Set((evidencePack.evidence || []).map((e) => e.chunk_id));

  const tier0 = [], tier1 = [], tier2 = [], tier3 = [];
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    const domains = Array.isArray(c.domains) ? c.domains.map(String) : [];
    const keywords = Array.isArray(c.keywords) ? c.keywords.map(String) : [];
    const srcIds = Array.isArray(c.source_chunk_ids) ? c.source_chunk_ids : [];

    const reason = [];
    let hitTier = 0;

    // Tier 0: 问题原文直接命中卡片关键词。优先于宽泛领域桶，避免“探测器选型”
    // 被 testing_alignment 领域里的全部卡片淹没，也避免排障任务只剩证据交集卡。
    const directHit = keywords.find((k) => {
      const key = String(k || "").trim().toLowerCase();
      return key.length >= 2 && lower.includes(key);
    });
    if (directHit) {
      reason.push("problem_keyword:" + directHit);
      hitTier = 4;
    }

    // Tier 1: domains。即已被 Tier 0 选中，也保留 domain 命中原因，便于审计。
    const domainHit = domain && domains.some((d) => d.toLowerCase() === domain)
      ? domain
      : domains.find((d) => lower.includes(String(d).toLowerCase()));
    if (domainHit) {
      reason.push("domain:" + domainHit);
      if (hitTier === 0) hitTier = 1;
    }

    // Tier 2: keywords[]
    if (hitTier === 0) {
      const kwHit = kws.find((kw) => keywords.some((k) => String(k).toLowerCase() === kw.toLowerCase()));
      if (kwHit) { reason.push("keyword:" + kwHit); hitTier = 2; }
    }

    // Tier 3: fallback title/formula/variables/evidence
    if (hitTier === 0) {
      const hay = [
        c.title, c.formula,
        ...((c.variables || []).map((v) => v.symbol)),
        ...((c.variables || []).map((v) => v.meaning || ""))
      ].filter(Boolean).join(" ").toLowerCase();
      const fbHit = kws.find((kw) => hay.includes(String(kw).toLowerCase()));
      if (fbHit) reason.push("fallback:" + fbHit);
      const intersect = srcIds.filter((id) => evIds.has(id));
      if (intersect.length) reason.push("evidence:" + intersect[0]);
      if (reason.length) hitTier = 3;
    }

    if (!hitTier) continue;
    const spec = {
      card_id: c.id,
      title: c.title,
      formula: c.formula,
      variables: c.variables || [],
      assumptions: c.assumptions || [],
      sanity_range: c.sanity_range,
      worked_example: c.worked_example,
      domains,
      keywords,
      source_chunk_ids: srcIds,
      match_reason: reason.join("; ")
    };
    if (hitTier === 4) tier0.push(spec);
    else if (hitTier === 1) tier1.push(spec);
    else if (hitTier === 2) tier2.push(spec);
    else tier3.push(spec);
  }
  if (tier0.length) return tier0.slice(0, 8);
  if (tier1.length) return tier1;
  if (tier2.length) return tier2;
  return tier3;
}

/**
 * 主入口。chunks/meta/searchKB 由 index.js 注入，便于测试与降级。
 * deps.formulaCards / conceptCards / crossDimensions 可注入（测试用）；缺省只读 data/ 下文件。
 */
export async function buildAssist(input, deps) {
  const problem = normalize(input.problem);
  if (!problem) throw new Error("problem 不能为空");
  const catalog = deps.catalog || (await loadCatalog());

  // 多剧本激活：主剧本用于简报与交付物，全部激活剧本共同贡献维度
  const detection = detectPlaybooks(problem, catalog);
  const activePlaybooks = detection.active;
  const playbook = detection.primary;
  const matched_keywords = detection.matched_keywords;

  const genericDims = Array.isArray(deps.crossDimensions) ? deps.crossDimensions : await loadCrossDimensions();
  const dimensions = fuseDimensions(activePlaybooks, genericDims);
  const relations = fuseRelations(activePlaybooks, dimensions);

  const deliverable = inferDeliverable(problem, input.deliverable, catalog);
  const intents = detectIntents(problem);
  const constraints = extractConstraints(problem);
  if (typeof input.constraints === "string" && input.constraints.trim()) constraints.push("用户补充：" + input.constraints.trim());
  const questions = buildQuestions(problem, playbook);

  const conceptCards = Array.isArray(deps.conceptCards) ? deps.conceptCards : await loadConceptCards();
  const evidencePack = collectEvidenceByDimensions(problem, dimensions, playbook, deps.chunks || [], deps.searchKB, deps.meta, {
    depth: input.depth || "standard",
    conceptCards
  });
  const caps = deps.caps || { skills: [], mcp_servers: [], notes: [] };

  // 门禁：先评估，再决定 plan/search_pack 中外部步骤的 blocked 状态
  const webGate = evaluateWebGate(problem, constraints, evidencePack);

  const searchPack = buildSearchPack(problem, activePlaybooks, evidencePack.dimensions, constraints, webGate);
  const plan = buildPlan(problem, activePlaybooks, deliverable, evidencePack, caps, {
    questions,
    workspace: input.workspace,
    searchPack,
    webGate,
    dimensions: evidencePack.dimensions,
    relations
  });
  const acceptance = buildAcceptance(playbook, deliverable, evidencePack.dimensions, relations);

  // 公式卡：优先注入，否则只读磁盘；缺失/失败降级为 []
  let formulaCards;
  let formulaCardsMissing = false;
  if (Array.isArray(deps.formulaCards)) {
    formulaCards = deps.formulaCards;
  } else {
    formulaCards = await loadFormulaCards();
    formulaCardsMissing = !Array.isArray(formulaCards) || formulaCards.length === 0;
  }
  const calcSpecs = matchFormulaCards(problem, formulaCards, evidencePack, playbook.id);

  const risks = buildRisks(evidencePack, caps, { workspace: input.workspace, webGate, formulaCardsMissing, dimensions: evidencePack.dimensions });

  // 原文层缺口：按板块汇总，明确只有 A03/C01/E01 存在整段原文缺失。
  const rawDocIds = ["A03", "C01", "E01"];
  const metaDocs = deps.meta && Array.isArray(deps.meta.docs) ? deps.meta.docs : [];
  const libraryGaps = rawDocIds.map((id) => {
    const row = metaDocs.find((d) => d.doc_id === id) || {};
    const total = Number(row.chunks) || (deps.chunks || []).filter((c) => c.doc_id === id).length;
    const present = Number(row.present) || (deps.chunks || []).filter((c) => c.doc_id === id && c.status === "present").length;
    return {
      doc_id: id,
      chunks: total,
      present,
      missing: Math.max(0, total - present),
      kind: "原文层缺口",
      note: "该板块的原始标准/白皮书条文未取得；引用具体条文前必须核对 status，非 present 不得当作逐字原文。"
    };
  }).filter((g) => g.chunks > 0 && g.present < g.chunks);
  for (const g of libraryGaps) {
    risks.push({ level: "medium", type: "原文缺口", message: g.doc_id + "：" + g.missing + "/" + g.chunks + " 条无原文，需按缺口处理" });
  }

  const activeView = detection.scored.length
    ? activePlaybooks.map((p) => {
        const s = detection.scored.find((x) => x.playbook.id === p.id);
        return { id: p.id, label: p.label, score: s ? s.score : 0, matched_keywords: s ? s.matched : [], dimensions: (p.required_dimensions || []).map((d) => d.id) };
      })
    : [{ id: "generic", label: "通用光电任务", score: 0, matched_keywords: [], dimensions: dimensions.map((d) => d.id) }];

  const brief = {
    problem_id: shortHash(problem + "|" + (input.workspace || "")),
    goal: problem.length > 160 ? problem.slice(0, 160) + "…" : problem,
    domain: { id: playbook.id, label: playbook.label, matched_keywords },
    active_playbooks: activeView,
    intents,
    deliverable: { id: deliverable.id, label: deliverable.label, skill: deliverable.skill || "skill_doc", suffix: deliverable.suffix || "docx" },
    constraints,
    unknowns: questions,
    depth: input.depth || "standard"
  };

  // alignment：机器可读的 KB 覆盖与缺口视图（按维度）
  const dimensionRows = evidencePack.dimensions;
  const matchedRows = dimensionRows.filter((r) => r.status === "covered").map((r) => ({ query: r.label, dimension_id: r.id, hit_chunk_ids: r.hit_chunk_ids }));
  const unmatchedRows = dimensionRows.filter((r) => r.status === "gap").map((r) => ({ query: r.label, dimension_id: r.id, reason: "KB 无命中" }));
  const total = dimensionRows.length;
  const verdict = total === 0 || matchedRows.length === 0 ? "gap" : matchedRows.length === total ? "covered" : "partial";
  const alignment = {
    kb_queries: [...new Set(dimensionRows.flatMap((r) => r.queries))],
    matched: matchedRows,
    unmatched: unmatchedRows,
    coverage_matrix: dimensionRows,
    verdict,
    evidence_count: evidencePack.evidence.length,
    dimensions_total: total,
    dimensions_covered: matchedRows.length,
    source_summary: {
      kb_covered: matchedRows.length,
      kb_gap: total - matchedRows.length,
      web_required: dimensionRows.filter((r) => r.source_matrix && r.source_matrix.web.status === "required").length
    },
    declared_gaps: evidencePack.gaps.filter((g) => g.kind === "声明不覆盖").map((g) => g.aspect)
  };

  return {
    ok: true,
    action: "assist",
    kb_version: deps.meta && deps.meta.kb_version ? deps.meta.kb_version : "unknown",
    problem_id: brief.problem_id,
    brief,
    execution_contract: {
      executor: "agent",
      must: [
        "opticforge_assist 为第一入口：完成 alignment 之前禁止调用 general_search/web_search/web_fetch",
        "按 plan 的 critical_path 推进，专业步骤可并行但不得跳过取证、交叉复核与自检",
        "覆盖 dimensions 中每个必答维度；缺面标 gap，外部补齐的标 covered_by_web，不得用相邻面结论替代",
        "交叉关系逐对核对：两面数字同表比较，coordinates_with 的步骤必须一起看",
        "每个结论引用 chunk_id；外部事实标 URL/标准号/型号、来源等级与访问日期",
        "缺口（gaps / library_gaps）单列，不用通用常识补",
        "web_gate.allowed=false 时禁止调用 web_search/web_fetch；web 步骤必须等 blocked_by 解除",
        "opticforge_verify 通过采信闸门（维度齐全/每面有据/多源交叉/时效）后才交付"
      ],
      may_call_skills: [...new Set(plan.steps.flatMap((s) => (s.routing.recommended_skills || []).map((x) => x.name)))],
      may_call_tools: [...new Set(plan.steps.flatMap((s) => (s.routing.recommended_tools || []).map((x) => x.name)))],
      may_call_mcp: [...new Set(plan.steps.flatMap((s) => s.routing.mcp_servers || []))],
      stop_conditions: [
        "关键澄清问题未回答且会改变方案走向",
        "关键输入文件/数据缺失",
        "交付物引用了无法解析或非 present 的条目",
        "web_gate 未放行却尝试联网检索",
        "采信闸门未通过（缺面未补、单源未标、来源等级不明）"
      ]
    },
    success_criteria: acceptance.slice(0, 6),
    coverage: evidencePack.coverage,
    alignment,
    dimensions: evidencePack.dimensions,
    relations,
    cross_checks: plan.cross_checks,
    evidence: evidencePack.evidence,
    coverage_matrix: evidencePack.dimensions,
    gaps: evidencePack.gaps,
    raw_source_gaps: evidencePack.raw_source_gaps,
    library_gaps: libraryGaps,
    web_gate: webGate,
    search_pack: searchPack,
    kb_queries: alignment.kb_queries,
    external_queries: searchPack.filter((g) => g.scope === "external"),
    calc_specs: calcSpecs,
    capabilities: {
      skills_found: (caps.skills || []).length,
      skills: (caps.skills || []).slice(0, 20).map((s) => ({ name: s.name, description: s.description || "" })),
      mcp_servers: caps.mcp_servers || [],
      notes: caps.notes || []
    },
    local_assets: deps.assets || null,
    plan,
    acceptance,
    risks,
    handoff: buildHandoff(brief, evidencePack, plan, acceptance, libraryGaps)
  };
}
