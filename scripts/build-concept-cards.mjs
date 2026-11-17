// 从 data/kb-data.json 的 present 条目生成 data/concept-cards.json（L2 概念卡）。
// 规则：一块一卡，statement 逐字取自原文对应段落（定义/公式/判据/误差来源），不改写、不新增数值。
// 用法：
//   node scripts/build-concept-cards.mjs --write
//   node scripts/build-concept-cards.mjs --check
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KB_DATA = path.join(ROOT, "data", "kb-data.json");
const KB_META = path.join(ROOT, "data", "kb-meta.json");
const PLAYBOOKS = path.join(ROOT, "data", "assist-playbooks.json");
const OUT = path.join(ROOT, "data", "concept-cards.json");

// 40 个现有板块 → v3 八个域 / 54 板块族。只落到族级，不落到叶子。
const BOARD_MAP = {
  A01: { domain: "IM", v3: ["IM04", "DT02", "TF02"] },
  A02: { domain: "IM", v3: ["IM02", "DS03", "TF02"] },
  A03: { domain: "AL", v3: ["AL03"] },
  B01: { domain: "QE", v3: ["QE01"] },
  B02: { domain: "MT", v3: ["MT06", "DS02"] },
  C01: { domain: "DT", v3: ["DT02", "IM05", "TF02"] },
  C02: { domain: "MT", v3: ["MT06", "DS07", "TF02"] },
  D01: { domain: "MT", v3: ["MT04"] },
  E01: { domain: "DT", v3: ["DT03", "DT04"] },
  F01: { domain: "TF", v3: ["TF01"] },
  F02: { domain: "TF", v3: ["TF02"] },
  F03: { domain: "TF", v3: ["TF03"] },
  F04: { domain: "TF", v3: ["TF06"] },
  F05: { domain: "TF", v3: ["TF07"] },
  F06: { domain: "MT", v3: ["MT02"] },
  F07: { domain: "MT", v3: ["MT04"] },
  F08: { domain: "TF", v3: ["TF02", "IM02", "DS03"] },
  F09: { domain: "DT", v3: ["DT02", "IM05", "TF02"] },
  F10: { domain: "MT", v3: ["MT01", "MT07"] },
  G01: { domain: "DS", v3: ["DS04"] },
  G02: { domain: "QE", v3: ["QE01", "DT04"] },
  G03: { domain: "QE", v3: ["QE02"] },
  G04: { domain: "DT", v3: ["DT03"] },
  G05: { domain: "AL", v3: ["AL04"] },
  G06: { domain: "DS", v3: ["DS07"] },
  G07: { domain: "DS", v3: ["DS08"] },
  H01: { domain: "MT", v3: ["MT06"] },
  H02: { domain: "MT", v3: ["MT05"] },
  H03: { domain: "TF", v3: ["TF09"] },
  H04: { domain: "IM", v3: ["IM03", "DS03"] },
  H05: { domain: "IM", v3: ["IM04"] },
  H06: { domain: "QE", v3: ["QE04", "QE05"] },
  H07: { domain: "IM", v3: ["IM07", "AL06"] },
  H08: { domain: "MT", v3: ["MT03"] },
  I01: { domain: "DS", v3: ["DS01", "TF01"] },
  I02: { domain: "TF", v3: ["TF05"] },
  I03: { domain: "DT", v3: ["DT01"] },
  I04: { domain: "DS", v3: ["DS01", "TF01"] },
  I05: { domain: "IM", v3: ["IM03", "DS03", "TF02"] },
  I06: { domain: "DS", v3: ["DS03", "TF02", "DS01"] }
};

// 个别块确实是电子学内容，单独改域，避免为了凑域而错分。
const CHUNK_OVERRIDE = {
  "F07-07": { domain: "EL", v3: ["EL01", "EL03"] },
  "F07-08": { domain: "EL", v3: ["EL01", "EL02"] },
  "H08-05": { domain: "EL", v3: ["EL02", "EL05"] }
};

// 没有板块交集时的域级兜底维度，只用于概念卡检索，不改变主题卡契约。
const DOMAIN_FALLBACK_DIMS = {
  TF: ["principle", "calc"],
  DS: ["design", "spec"],
  MT: ["design", "detector"],
  DT: ["metrology", "verification"],
  AL: ["algorithm"],
  IM: ["chain", "principle"],
  QE: ["risk", "tolerance"],
  EL: ["circuit", "frontend"]
};

// 少量中英对照，让英文检索也能命中卡片；只加词，不改事实。
const EN_TERMS = [
  ["光栅", "grating"], ["衍射", "diffraction"], ["干涉", "interference"], ["薄膜", "thin film"],
  ["镀膜", "coating"], ["像差", "aberration"], ["公差", "tolerance"], ["装调", "alignment"],
  ["标定", "calibration"], ["定标", "calibration"], ["探测器", "detector"], ["噪声", "noise"],
  ["激光", "laser"], ["偏振", "polarization"], ["波前", "wavefront"], ["面形", "surface form"],
  ["光谱", "spectrum"], ["高光谱", "hyperspectral"], ["棱镜", "prism"], ["透镜", "lens"],
  ["相机", "camera"], ["电路", "circuit"], ["放大器", "amplifier"], ["采样", "sampling"],
  ["算法", "algorithm"], ["不确定度", "uncertainty"], ["热", "thermal"], ["红外", "infrared"],
  ["光纤", "fiber"], ["波导", "waveguide"], ["超表面", "metasurface"], ["量子", "quantum"],
  ["杂散光", "stray light"], ["鬼像", "ghost"], ["分辨率", "resolution"], ["灵敏度", "sensitivity"],
  ["动态范围", "dynamic range"], ["带宽", "bandwidth"], ["信噪比", "SNR"], ["狭缝", "slit"],
  ["准直", "collimation"], ["色散", "dispersion"], ["共焦", "confocal"], ["位姿", "pose"],
  ["对准", "alignment"], ["标尺", "scale"], ["温漂", "thermal drift"], ["焦深", "depth of focus"]
];

function pickKind(title, text) {
  if (/公式|方程|定律|换算|关系/.test(title)) return "formula";
  if (/判据|条件|标准|规范|验收|要求/.test(title)) return "criterion";
  if (/参数|指标|典型|量级|范围|选型/.test(title)) return "typical_value";
  if (/失效|故障|损伤|漂移|脱膜|霉变|杂散|鬼像|误差|噪声|串扰/.test(title)) return "failure_mode";
  if (/定义|概念|分类|结构|型式/.test(title)) return "definition";
  return "method";
}

const PREFIX_BY_KIND = {
  formula: ["公式：", "定义：", "判据："],
  criterion: ["判据：", "定义：", "边界："],
  typical_value: ["参数：", "典型值：", "典型：", "定义："],
  failure_mode: ["误差来源：", "边界：", "工程要点：", "定义："],
  definition: ["定义：", "工程要点："],
  method: ["定义：", "工程要点：", "判据："]
};

function cleanOneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function cutSentence(s, max = 200) {
  s = cleanOneLine(s);
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const stop = Math.max(head.lastIndexOf("。"), head.lastIndexOf("；"));
  if (stop >= 80) return head.slice(0, stop + 1);
  return head.replace(/[，、：,]$/, "") + "…";
}

function extractStatement(text, kind) {
  const body = String(text || "").replace(/^【[^】]*】\s*\n?/, "");
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  // 优先找语义完整（≥30 字）的首选段落
  for (const prefix of PREFIX_BY_KIND[kind] || PREFIX_BY_KIND.method) {
    const line = lines.find((l) => l.startsWith(prefix) && l.length - prefix.length >= 30);
    if (line) return cutSentence(line.slice(prefix.length));
  }
  // 再退一步：任一核心段落
  for (const prefix of ["定义：", "公式：", "判据：", "工程要点：", "误差来源："]) {
    const line = lines.find((l) => l.startsWith(prefix) && l.length - prefix.length >= 30);
    if (line) return cutSentence(line.slice(prefix.length));
  }
  // 最后：把前两句拼成一条自洽事实
  const head = lines.filter((l) => !l.startsWith("【")).slice(0, 2);
  if (head.length) return cutSentence(head.map((l) => l.replace(/[。；，,;]$/, "")).join("；"));
  return "";
}

function buildKeywords(title, keywordsZh, text) {
  const out = new Set();
  for (const k of String(keywordsZh || "").split(/[,，]/)) {
    const t = cleanOneLine(k);
    if (t && t.length <= 12) out.add(t);
  }
  const cleanTitle = cleanOneLine(title);
    if (cleanTitle) out.add(cleanTitle);
  for (const [zh, en] of EN_TERMS) {
    if (out.has(zh) || cleanTitle.includes(zh) || String(keywordsZh || "").includes(zh) || String(text || "").includes(zh)) {
      out.add(en);
    }
  }
  return [...out].slice(0, 14);
}

function dimensionIndex(playbooks) {
  const byBoard = new Map();
  for (const p of playbooks) {
    for (const d of p.required_dimensions || []) {
      for (const b of d.boards || []) {
        if (!byBoard.has(b)) byBoard.set(b, new Set());
        byBoard.get(b).add(d.id);
      }
    }
  }
  return byBoard;
}

export async function buildConceptCards({ kbVersion } = {}) {
  const chunks = JSON.parse(await readFile(KB_DATA, "utf8"));
  const meta = JSON.parse(await readFile(KB_META, "utf8"));
  const playbooks = JSON.parse(await readFile(PLAYBOOKS, "utf8")).playbooks || [];
  const version = kbVersion || meta.kb_version;
  const byBoard = dimensionIndex(playbooks);

  const cards = [];
  const counters = new Map();
  for (const chunk of chunks) {
    if (chunk.status !== "present") continue;
    const board = CHUNK_OVERRIDE[chunk.chunk_id] || BOARD_MAP[chunk.doc_id];
    if (!board) continue;
    const titleMatch = String(chunk.text || "").match(/^【([^】]+)】/);
    const title = titleMatch ? titleMatch[1] : chunk.chunk_id;
    const kind = pickKind(title, chunk.text);
    const statement = extractStatement(chunk.text, kind);
    if (!statement || statement.length < 8) continue;

    const n = (counters.get(chunk.doc_id) || 0) + 1;
    counters.set(chunk.doc_id, n);

    const dims = new Set();
    for (const b of board.v3) {
      for (const id of byBoard.get(b) || []) dims.add(id);
    }
    const appliesTo = dims.size ? [...dims].sort() : (DOMAIN_FALLBACK_DIMS[board.domain] || []);

    cards.push({
      id: chunk.doc_id + "-ATOM-" + String(n).padStart(2, "0"),
      title,
      domain: board.domain,
      v3_boards: board.v3,
      kind,
      statement,
      source_chunk_ids: [chunk.chunk_id],
      keywords: buildKeywords(title, chunk.keywords_zh, chunk.text),
      applies_to: appliesTo
    });
  }

  const domains = {};
  for (const c of cards) domains[c.domain] = (domains[c.domain] || 0) + 1;
  const payload = {
    version: 3,
    kb_version: version,
    generated_by: "scripts/build-concept-cards.mjs",
    note: "L2 概念卡：一块一卡，statement 逐字取自该块对应段落（定义/公式/判据/误差来源），不改写、不新增数值；applies_to 为维度 id。",
    total_chunks: chunks.filter((c) => c.status === "present").length,
    card_count: cards.length,
    domains,
    cards
  };
  return { payload, cards };
}

async function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const { payload, cards } = await buildConceptCards();

  if (write) {
    await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log(`OK 已写出 data/concept-cards.json（${cards.length} 张 / kb_version ${payload.kb_version}）`);
    console.log("domains " + JSON.stringify(payload.domains));
    return;
  }

  if (check) {
    const issues = [];
    let saved;
    try {
      saved = JSON.parse(await readFile(OUT, "utf8"));
    } catch (e) {
      console.error("FAIL 读不到 data/concept-cards.json：" + e.message);
      process.exit(1);
    }
    if (saved.kb_version !== payload.kb_version) issues.push(`kb_version 不一致：文件 ${saved.kb_version} / 应为 ${payload.kb_version}`);
    if (saved.card_count !== cards.length || (saved.cards || []).length !== cards.length) {
      issues.push(`卡片数不一致：文件 ${(saved.cards || []).length} / 应为 ${cards.length}`);
    }
    if (cards.length < 300 || cards.length > 600) issues.push(`卡片数 ${cards.length} 不在 300-600`);
    const ids = new Set();
    const chunkIds = new Set(JSON.parse(await readFile(KB_DATA, "utf8")).filter((c) => c.status === "present").map((c) => c.chunk_id));
    for (const c of saved.cards || []) {
      if (ids.has(c.id)) issues.push("id 重复：" + c.id);
      ids.add(c.id);
      if (!c.statement || c.statement.length > 200) issues.push("statement 超长或为空：" + c.id);
      if (!Array.isArray(c.source_chunk_ids) || c.source_chunk_ids.length === 0) issues.push("缺 source：" + c.id);
      for (const id of c.source_chunk_ids || []) {
        if (!chunkIds.has(id)) issues.push("source 不是 present：" + c.id + " -> " + id);
      }
      if (!Array.isArray(c.applies_to)) issues.push("applies_to 非数组：" + c.id);
    }
    const sample = createHash("sha256").update(JSON.stringify(saved.cards)).digest("hex").slice(0, 12);
    if (JSON.stringify(saved.cards) !== JSON.stringify(cards)) issues.push("卡片内容与源数据不一致（先跑 --write）");
    if (issues.length) {
      console.error("FAIL");
      for (const i of issues.slice(0, 20)) console.error(" - " + i);
      process.exit(1);
    }
    console.log(`OK  ${cards.length} 张概念卡 / 8 域 / sha256 ${sample}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error("ERROR " + (e && e.message ? e.message : String(e)));
    process.exit(1);
  });
}
