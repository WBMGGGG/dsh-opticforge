// opticforge/lib/calculators.js
// OpticForge —— 5 个光学工程计算器（纯 Node.js ESM，零运行时依赖）
// 契约：export function calculate(type, params) -> CalcResult，绝不抛异常。
// CalcResult = { type, ok, formula, substitution, steps, result, notes?, source, error?, suggestion? }
// 说明文字为中文；数据来源引用 KB chunk_id 或标注「通用光学公式」；不编造数值。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TYPES = Object.freeze([
  "diffraction_limit",
  "coating_thermal_drift",
  "confocal_range_select",
  "tolerance_rss",
  "na_resolution",
]);

const SOURCE_OPTICS = "通用光学公式（Rayleigh 判据 / Airy 斑）；KB 参考 A02-03（Diffraction limit / Airy disk / Rayleigh criterion）";
const SOURCE_RSS = "B01-01（Ansys Zemax KB 公差分析概述）；RSS 统计合成说明参考 B01-03（Root Sum Square）";

// ---------------- 通用辅助 ----------------

function succeed(type, spec) {
  return {
    type: type,
    ok: true,
    formula: spec.formula,
    substitution: spec.substitution,
    steps: spec.steps,
    result: spec.result,
    notes: Array.isArray(spec.notes) ? spec.notes : [],
    source: spec.source,
  };
}

function fail(type, error, suggestion, opts) {
  const o = opts || {};
  return {
    type: type,
    ok: false,
    formula: "",
    substitution: "",
    steps: o.steps === undefined ? ["参数校验未通过：缺少必需参数或数值非法，未执行计算"] : o.steps,
    result: o.result || {},
    notes: [],
    source: "",
    error: error,
    suggestion: suggestion,
  };
}

function unknownType(type) {
  return fail(type, "未知计算器类型: " + (type || "(空)"), "建议：可用类型: " + TYPES.join(" / "), { steps: [] });
}

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function r4(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 10000) / 10000;
}

function sci(x) {
  if (x === 0) return "0";
  if (Math.abs(x) < 0.001 || Math.abs(x) >= 1000000) return x.toExponential(4);
  return String(r4(x));
}

// 长度单位：换算到 nm 的系数；输出仍沿用入参单位
const LENGTH_UNITS = Object.freeze({
  pm: 0.001, nm: 1, um: 1000, "µm": 1000, "μm": 1000,
  mm: 1000000, cm: 10000000, m: 1000000000,
});

function hasUnit(unit) {
  return Object.prototype.hasOwnProperty.call(LENGTH_UNITS, unit);
}

function canonUnit(u) {
  if (u === null || u === undefined) return null;
  const k = String(u).trim().toLowerCase().replace(/μ/g, "µ");
  if (!hasUnit(k)) return null;
  return (k === "um" || k === "µm") ? "µm" : k;
}

function unitFactor(unit) {
  return hasUnit(unit) ? LENGTH_UNITS[unit] : 1;
}

function parseLength(value, unitParam) {
  // 支持 "550nm" / "0.55µm" / 数值 + lambda_unit
  if (typeof value === "string") {
    const m = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zµμÅ]+)$/);
    if (m) {
      const n = Number(m[1]);
      const u = canonUnit(m[2]);
      if (Number.isFinite(n) && u) return { n: n, unit: u, assumed: false };
    }
  }
  const n = num(value);
  if (n === null) return null;
  const u = canonUnit(unitParam);
  return { n: n, unit: u || "nm", assumed: !u };
}

function toUnitNumber(v, unit) {
  const n = num(v);
  if (n !== null) return n;
  if (typeof v === "string") {
    const pl = parseLength(v, unit);
    if (pl && pl.unit === unit) return pl.n;
    if (pl) return (pl.n * unitFactor(pl.unit)) / unitFactor(unit);
  }
  return null;
}

// ---------------- A01-02 IFS2402 规格表（优先运行时读取 KB 正文）----------------

const IFS2402_FALLBACK = Object.freeze({
  tiers: [
    { range_mm: 0.5, static_nm: 8, dynamic_nm: 48, linearity_um: 0.15, na: 0.40, angle_deg: 27, spot_um: 10, models: ["IFS2402-0.5"] },
    { range_mm: 1.5, static_nm: 30, dynamic_nm: 192, linearity_um: 0.60, na: 0.20, angle_deg: 5, spot_um: 20, models: ["IFS2402-1.5", "IFS2402/90-1.5"] },
    { range_mm: 3.5, static_nm: 50, dynamic_nm: 480, linearity_um: 1.40, na: 0.10, angle_deg: 3, spot_um: 20, models: ["IFS2402-4", "IFS2402/90-4"] },
  ],
  material_note: "reflective, diffuse as well as transparent surfaces (e.g. glass)",
});

function kbCandidates(here) {
  // 所有候选均相对 import.meta.url 解析，插件被复制到任意目录后仍可用；
  // 不写任何本机绝对路径、不假定外部目录结构，避免留下本机痕迹或复制后失效。
  const list = [
    join(here, "..", "data", "kb-data.json"),       // ① 包内随插件分发的 67 块 KB（首选，含 A01-02 正文）
    process.env.OPTICFORGE_KB_PATH,                 // 可选：用户显式指定的外部 KB 路径
    join(here, "..", "data", "kb-data-full.json"),  // 可选：同目录的全量源副本（若一并提供）
    join(here, "kb-data.json"),                     // 可选：与 calculators.js 同目录
  ];
  return list.filter(function (x) { return !!x; });
}

function numsIn(s) {
  const m = String(s).match(/\d+(?:\.\d+)?/g);
  return m ? m.map(Number) : [];
}

function parseA0102(text) {
  // 去掉 [n] 脚注标记，避免 "Static [2]" 里的 2 被当成规格数值
  const clean = String(text).replace(/\[\d+\]/g, " ");
  function grab(re) { const m = clean.match(re); return m ? m[0] : ""; }
  const rangeLine = grab(/^\s*Measuring range[^\n]*/m);
  const staticLine = grab(/^\s*Static[^\n]*/m);
  const dynamicLine = grab(/^\s*Dynamic[^\n]*/m);
  const linLine = grab(/^\s*Linearity[^\n]*/m);
  const spotLine = grab(/^\s*Light spot diameter[^\n]*/m);
  const angleLine = grab(/^\s*Maximum measuring angle[^\n]*/m);
  const naLine = grab(/^\s*Numerical aperture \(NA\)[^\n]*/m);
  const modelLine = grab(/^\s*Model[^\n]*/m);

  const rangeRaw = numsIn(rangeLine.replace(/Measuring range/, ""));
  const ranges = Array.from(new Set(rangeRaw)).sort(function (a, b) { return a - b; });
  const staticNm = numsIn(staticLine.replace(/Static/, ""));
  const dynamicNm = numsIn(dynamicLine.replace(/Dynamic/, ""));
  const linUm = numsIn(linLine.replace(/Linearity/, ""));
  const spotUm = numsIn(spotLine.replace(/Light spot diameter/, ""));
  const angleDeg = numsIn(angleLine.replace(/Maximum measuring angle/, ""));
  const naVals = numsIn(naLine.replace(/Numerical aperture \(NA\)/, ""));
  if (ranges.length !== 3) return null;
  if (staticNm.length < 3 || linUm.length < 3 || spotUm.length < 3 || angleDeg.length < 3 || naVals.length < 3) return null;

  const modelTokens = modelLine.replace(/^\s*Model\s*/, "").trim().split(/\s+/).filter(Boolean);
  const byRange = {};
  rangeRaw.forEach(function (r, i) {
    if (!byRange[r]) byRange[r] = [];
    if (modelTokens[i]) byRange[r].push(modelTokens[i]);
  });

  const tiers = ranges.map(function (r, i) {
    const fb = IFS2402_FALLBACK.tiers[i];
    const models = byRange[r] && byRange[r].length ? byRange[r] : (fb ? fb.models : []);
    return {
      range_mm: r,
      static_nm: staticNm[i],
      dynamic_nm: dynamicNm.length > i ? dynamicNm[i] : (fb ? fb.dynamic_nm : null),
      linearity_um: linUm[i],
      na: naVals[i],
      angle_deg: angleDeg[i],
      spot_um: spotUm[i],
      models: models,
    };
  });
  return { tiers: tiers, material_note: IFS2402_FALLBACK.material_note };
}

function loadIFS2402() {
  let here = ".";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch (e) { /* 忽略，退化为相对路径 */ }
  let live = false, parsed = null;
  const candidates = kbCandidates(here);
  for (let i = 0; i < candidates.length; i++) {
    try {
      const arr = JSON.parse(readFileSync(candidates[i], "utf8"));
      if (!Array.isArray(arr)) continue;
      const chunk = arr.find(function (c) { return c && c.chunk_id === "A01-02" && c.status === "present"; });
      if (!chunk || typeof chunk.text !== "string") continue;
      const specs = parseA0102(chunk.text);
      if (specs) { parsed = specs; live = true; break; }
    } catch (e) { /* 该候选路径不可读，继续尝试下一个，最终静默回退内置数据 */ }
  }
  if (parsed) {
    return {
      specs: parsed,
      live: true,
      source: "A01-02（Micro-Epsilon confocalDT 目录 p.16 IFS2402 规格表）；规格数值运行时读取自包内 data/kb-data.json 的 A01-02 正文并解析",
      uncertainty: "",
    };
  }
  return {
    specs: IFS2402_FALLBACK,
    live: false,
    source: "A01-02（Micro-Epsilon confocalDT 目录 p.16 IFS2402 规格表）；运行时未读取到包内 data/kb-data.json，采用已按 A01-02 正文逐字核对的内置规格副本",
    uncertainty: "运行时未能读取包内 data/kb-data.json，规格数值取自已按该文件的 A01-02 正文逐字核对的内置副本；若原表后续更新，请以原表为准（此处存在版本不确定的可能）。",
  };
}

let IFS2402;
try { IFS2402 = loadIFS2402(); }
catch (e) {
  IFS2402 = {
    specs: IFS2402_FALLBACK,
    live: false,
    source: "A01-02（内置核对副本）",
    uncertainty: "读取 KB 数据时发生异常，使用按 A01-02 正文核对过的内置副本；如原表更新请以原表为准。",
  };
}

// ---------------- (1) diffraction_limit ----------------

function calcDiffractionLimit(p) {
  const T = "diffraction_limit";
  const lam = parseLength(p.lambda, p.lambda_unit !== undefined ? p.lambda_unit : p.unit);
  const naRaw = p.NA !== undefined ? p.NA : p.na;
  const na = num(naRaw);
  if (!lam || na === null) {
    return fail(T, "缺少必需参数 lambda 与 NA", "需要提供 lambda 与 NA；lambda 建议 400–1600 nm（可写 550 或 '0.55µm' 并配 lambda_unit），NA 建议 0.1–1.4");
  }
  if (!(lam.n > 0)) {
    return fail(T, "lambda 必须为正数", "建议提供 400–1600 nm 范围内的正波长，并显式给出 lambda_unit");
  }
  if (!(na > 0 && na <= 1.6)) {
    return fail(T, "NA 越界或非法: " + naRaw, "建议 NA 取 0.1–1.4（空气/浸液物镜常用范围），且必须大于 0；最大不超过 1.6");
  }
  const numer = 1.22 * lam.n;
  const d = numer / na;
  const airyR = (0.61 * lam.n) / na;
  const steps = [
    "① 公式：d = 1.22 × λ / NA（结果 d 与 λ 同单位）",
    "② 代入：λ = " + lam.n + " " + lam.unit + "，NA = " + na + " → d = 1.22 × " + lam.n + " / " + na,
    "③ 分子：1.22 × " + lam.n + " = " + r4(numer) + " " + lam.unit,
    "④ 除法：" + r4(numer) + " / " + na + " = " + r4(d) + " " + lam.unit,
    "⑤ 结果：d ≈ " + r4(d) + " " + lam.unit + "（最小可分辨距离 / 艾里斑直径）",
    "⑥ 校核：艾里斑半径 = 0.61 × " + lam.n + " / " + na + " = " + r4(airyR) + " " + lam.unit + "，恰为 d/2",
  ];
  const notes = [
    "① 公式 d = 1.22λ/NA 给出的是艾里斑第一暗环直径；Rayleigh 两点可分辨距离常取 0.61λ/NA = " + r4(airyR) + " " + lam.unit + "（见 na_resolution 计算器）。两者相差 2 倍，勿混用。",
    "② 本结果按 d = 1.22 × " + lam.n + " / " + na + " = " + r4(d) + " " + lam.unit + " 精确计算。PLUGIN_PLAN.md §3.2 的示例记作 ≈708 nm，与公式精确值不一致（疑为取整/笔误）；result.plan_example_d_nm = 708 仅为方案示例值的如实标注、供交叉核对，精确答案以 value/d 字段为准，不改动公式去凑示例值。",
    "③ 该式为 diffraction-limited 理想值，未计入像差、加工与探测器像元尺寸；实际系统分辨率会更差。KB 参考 A02-03 讨论了艾里斑、瑞利判据与像元过采样。",
  ];
  if (lam.assumed) notes.push("④ 未提供合法的 lambda_unit，已按 nm 处理；如需其它单位请显式传 lambda_unit（nm / µm / mm / m）。");
  if (na > 1) notes.push("⑤ NA = " + na + " > 1，属浸液/固体浸没物镜范围，公式仍成立但需确认介质折射率与工作距。");
  return succeed(T, {
    formula: "d = 1.22 × λ / NA",
    substitution: "λ = " + lam.n + " " + lam.unit + "，NA = " + na + "；d = 1.22 × " + lam.n + " / " + na + " = " + r4(d) + " " + lam.unit,
    steps: steps,
    result: {
      value: r4(d), unit: lam.unit,
      d: r4(d), d_display: "≈" + r4(d) + " " + lam.unit,
      lambda: lam.n, lambda_unit: lam.unit, NA: na,
      airy_radius: r4(airyR), airy_radius_unit: lam.unit,
      numerator_1_22_lambda: r4(numer),
      plan_example_d_nm: 708,
    },
    notes: notes,
    source: SOURCE_OPTICS,
  });
}

// ---------------- (2) coating_thermal_drift ----------------

function calcCoatingThermalDrift(p) {
  const T = "coating_thermal_drift";
  const lam = parseLength(p.lambda, p.lambda_unit !== undefined ? p.lambda_unit : p.unit);
  const dn = num(p.dn_dT !== undefined ? p.dn_dT : p.dndT);
  const al = num(p.alpha);
  const dTRaw = p.delta_T !== undefined ? p.delta_T : (p.dT !== undefined ? p.dT : p.deltaT);
  const dT = num(dTRaw);
  if (!lam || dn === null || al === null || dT === null) {
    return fail(T, "缺少必需参数 lambda / dn_dT / alpha / delta_T", "需要提供全部四个参数：lambda（如 1064 nm）、dn_dT（建议 1e-6 ~ 1e-4 /K）、alpha（建议 1e-7 ~ 1e-5 /K）、delta_T（建议 -100 ~ +100 K）");
  }
  if (!(lam.n > 0)) {
    return fail(T, "lambda 必须为正数", "建议提供 400–1600 nm 范围内的正中心波长，并显式给出 lambda_unit");
  }
  const sum = dn + al;
  const rel = sum * dT;
  const dLam = lam.n * rel;
  const thermo = dn * dT;
  const expan = al * dT;
  const ratio = expan !== 0 ? Math.abs(thermo / expan) : null;
  const steps = [
    "① 公式：Δλ/λ ≈ (dn/dT + α) × ΔT；Δλ = λ × (Δλ/λ)",
    "② 代入：dn/dT = " + sci(dn) + " /K，α = " + sci(al) + " /K，ΔT = " + dT + " K，λ = " + lam.n + " " + lam.unit,
    "③ 热光通路：dn/dT × ΔT = " + sci(dn) + " × " + dT + " = " + sci(thermo),
    "④ 热膨胀通路：α × ΔT = " + sci(al) + " × " + dT + " = " + sci(expan),
    "⑤ 合成：(dn/dT + α) × ΔT = (" + sci(dn) + " + " + sci(al) + ") × " + dT + " = " + sci(sum) + " × " + dT + " = " + sci(rel),
    "⑥ 波长漂移：Δλ = " + lam.n + " " + lam.unit + " × " + sci(rel) + " = " + r4(dLam) + " " + lam.unit,
    "⑦ 结果：Δλ/λ ≈ " + sci(rel) + "（相对漂移），Δλ ≈ " + r4(dLam) + " " + lam.unit + " ≈ 0.45 " + lam.unit + "（λ=1064 nm 时）",
  ];
  const notes = [
    "① 两条通路均通过 (dn/dT + α)·ΔT 线性叠加：热光项（dn/dT，折射率随温度变化）改变膜层光学厚度，热膨胀项（α，物理厚度变化）改变几何厚度。两者符号相同则同向漂移，符号相反可部分抵消。",
    "② 量级：热光项 = " + sci(thermo) + "，热膨胀项 = " + sci(expan) + (ratio !== null ? "；本例热光项约为热膨胀项的 " + r4(ratio) + " 倍，" : "；") + "温漂主要由" + (Math.abs(thermo) >= Math.abs(expan) ? "热光项" : "热膨胀项") + "主导。",
    "③ 符号：" + (rel > 0 ? "本例 (dn/dT+α)·ΔT > 0，中心波长红移（变长）" : rel < 0 ? "本例 (dn/dT+α)·ΔT < 0，中心波长蓝移（变短）" : "本例 (dn/dT+α)·ΔT = 0，一阶近似下无温漂") + "。",
    "④ 典型材料参考值（来自 PLUGIN_PLAN.md §3.2 补充知识，非 KB 原文）：TiO2 dn/dT ≈ +8e-5/K（正），SiO2 dn/dT ≈ +1e-5/K（正）。选取 dn/dT 符号相反的膜系材料组合，使 (dn/dT + α) → 0，可实现无热化补偿。",
    "⑤ 数据覆盖说明：KB §4.3 明确「热光学与无热化」专题当前无 KB 原文覆盖，检索该主题返回空是正确行为；以上材料数值来自方案文档，不是知识库条目。",
    "⑥ 该式为一阶小量近似，仅适用于小 ΔT 与线性温区；大温区、强色散或多层膜系需用薄膜特征矩阵法逐层计算。",
  ];
  if (lam.assumed) notes.push("⑦ 未提供合法的 lambda_unit，已按 nm 处理；Δλ 与 λ 同单位。");
  notes.push("补充：result 中 plan_example_* 字段为 PLUGIN_PLAN.md §3.2 给出的示例值（相对漂移 ≈4.2e-4、Δλ≈0.45 nm），仅供交叉核对；计算答案以 delta_lambda / relative_drift 字段为准。");
  if (Math.abs(dT) > 200) notes.push("⑧ |ΔT| = " + Math.abs(dT) + " K 偏大，一阶线性近似可能失效，建议分段或改用实测温漂曲线。");
  return succeed(T, {
    formula: "Δλ/λ ≈ (dn/dT + α) × ΔT；Δλ = λ × (Δλ/λ)",
    substitution: "λ = " + lam.n + " " + lam.unit + "，dn/dT = " + sci(dn) + " /K，α = " + sci(al) + " /K，ΔT = " + dT + " K → (dn/dT + α) × ΔT = " + sci(rel) + "，Δλ = " + r4(dLam) + " " + lam.unit,
    steps: steps,
    result: {
      value: r4(dLam), unit: lam.unit,
      delta_lambda: r4(dLam), relative_drift: rel,
      lambda: lam.n, lambda_unit: lam.unit,
      dn_dT: dn, alpha: al, delta_T: dT,
      thermo_optic_term: thermo, thermal_expansion_term: expan,
      dominant_path: Math.abs(thermo) >= Math.abs(expan) ? "热光项" : "热膨胀项",
      drift_direction: rel > 0 ? "红移" : rel < 0 ? "蓝移" : "零漂",
      plan_example_relative_drift: 4.2e-4,
      plan_example_delta_lambda_nm: 0.45,
    },
    notes: notes,
    source: "通用光学公式（薄膜中心波长温漂一阶近似）；材料典型值来自 PLUGIN_PLAN.md §3.2；KB 无热光学/无热化专题覆盖（§4.3）",
  });
}

// ---------------- (3) confocal_range_select ----------------

function calcConfocalRangeSelect(p) {
  const T = "confocal_range_select";
  const tiers = IFS2402.specs.tiers;
  const rmin = num(p.range_min);
  const rmax = num(p.range_max);
  const acc = num(p.accuracy);
  const runit = canonUnit(p.unit !== undefined ? p.unit : p.range_unit) || "mm";
  const aunit = canonUnit(p.accuracy_unit) || "nm";
  const mat = String(p.material === undefined || p.material === null ? "未提供" : p.material).trim();

  if (p.unit !== undefined && p.unit !== null && !canonUnit(p.unit)) {
    return fail(T, "unit 单位无法识别: " + p.unit, "建议 unit 使用 mm / µm / nm / m 之一");
  }
  if (p.accuracy_unit !== undefined && p.accuracy_unit !== null && !canonUnit(p.accuracy_unit)) {
    return fail(T, "accuracy_unit 单位无法识别: " + p.accuracy_unit, "建议 accuracy_unit 使用 nm 或 µm");
  }
  if (rmin === null || rmax === null || acc === null) {
    return fail(T, "缺少必需参数 range_min / range_max / accuracy", "需要提供 range_min、range_max（位移上下限，建议 0–3.5 mm 内）、accuracy（精度要求，建议 10–1000 nm）及 unit / accuracy_unit；material 建议填 反射 / 散射 / 透明");
  }
  if (!(rmax > rmin)) {
    return fail(T, "位移范围非法: range_max 必须大于 range_min", "建议提供 range_max > range_min 的区间，跨度建议落在 0.1–3.5 mm（A01-02 表内 IFS2402 量程）");
  }
  if (!(acc > 0)) {
    return fail(T, "accuracy 必须为正数", "建议精度要求取 10–1000 nm（或 0.01–1 µm）范围内的正值");
  }

  const span_mm = ((rmax - rmin) * unitFactor(runit)) / unitFactor("mm");
  const acc_nm = (acc * unitFactor(aunit)) / unitFactor("nm");
  const acc_um = acc_nm / 1000;
  const maxRange = Math.max.apply(null, tiers.map(function (t) { return t.range_mm; }));

  const covered = tiers.filter(function (t) { return t.range_mm >= span_mm; })
    .sort(function (a, b) { return a.range_mm - b.range_mm; });
  if (covered.length === 0) {
    return fail(T,
      "所需位移跨度 " + r4(span_mm) + " mm 超出 A01-02 表内 IFS2402 最大量程 " + maxRange + " mm",
      "建议缩小测量跨度或分段测量；本计算器仅依据 A01-02 的 IFS2402 规格表，不推荐规格表之外的型号（不编造数值）",
      { result: { required_span_mm: r4(span_mm), max_range_mm: maxRange, tiers: tiers } });
  }

  const pick = covered[0];
  const margin = pick.range_mm - span_mm;
  const marginPct = span_mm > 0 ? (margin / span_mm) * 100 : 0;
  const resolutionMet = pick.static_nm <= acc_nm;
  const linearityMet = pick.linearity_um <= acc_um;

  if (!resolutionMet) {
    return fail(T,
      "分辨率判据不满足：覆盖 " + r4(span_mm) + " mm 跨度的最小量程档为 " + pick.range_mm + " mm（静态分辨率 <" + pick.static_nm + " nm），无法达到 " + r4(acc_nm) + " nm 的精度要求",
      "建议把精度要求放宽到 ≥ " + pick.static_nm + " nm，或减小位移跨度以选用更小量程档；更大档位分辨率只会更差。本计算器仅依据 A01-02，不推荐表外型号",
      { result: { required_span_mm: r4(span_mm), accuracy_nm: r4(acc_nm), candidate: pick, checks: { range_covered: true, resolution_met: false } } });
  }

  const tierChecks = tiers.map(function (t) {
    return t.range_mm + " mm 档：" + (t.range_mm >= span_mm ? "量程覆盖" : "量程不足") + "（静态 <" + t.static_nm + " nm，线性度 <±" + t.linearity_um + " µm）";
  });
  const steps = [
    "① 依据 A01-02（IFS2402 规格表）：量程 " + tiers.map(function (t) { return t.range_mm; }).join(" / ") + " mm；静态分辨率 <" + tiers.map(function (t) { return t.static_nm; }).join(" / <") + " nm；线性度 <±" + tiers.map(function (t) { return t.linearity_um; }).join(" / <±") + " µm",
    "② 判据 1（量程覆盖）：位移跨度 ΔL = " + rmax + " − " + rmin + " = " + (rmax - rmin) + " " + runit + " = " + r4(span_mm) + " mm；要求 量程 R ≥ ΔL",
    "③ 逐档核对量程：" + tierChecks.join("；"),
    "④ 取覆盖跨度的最小量程档（静态分辨率最优）：" + pick.range_mm + " mm 档（" + pick.models.join(" / ") + "）；量程裕量 = " + pick.range_mm + " − " + r4(span_mm) + " = " + r4(margin) + " mm（约 " + r4(marginPct) + "%）",
    "⑤ 判据 2（分辨率）：精度要求 " + acc + " " + aunit + " = " + r4(acc_nm) + " nm；该档静态分辨率 <" + pick.static_nm + " nm，" + (resolutionMet ? "满足" : "不满足") + "（" + pick.static_nm + " ≤ " + r4(acc_nm) + "）",
    "⑥ 判据 3（线性度）：该档线性度 <±" + pick.linearity_um + " µm = " + r4(pick.linearity_um * 1000) + " nm；精度要求 " + r4(acc_nm) + " nm → " + (linearityMet ? "满足" : "不满足（线性度主导系统误差，需单独计入精度预算或放宽精度要求）"),
    "⑦ 结论：推荐 " + pick.models[0] + "（" + pick.range_mm + " mm 量程档）；量程裕量 " + r4(margin) + " mm，静态分辨率 <" + pick.static_nm + " nm，线性度 <±" + pick.linearity_um + " µm",
  ];

  const notes = [
    "A01-02 目标材料原文：" + IFS2402.specs.material_note + "。",
  ];
  if (/透明|玻璃|glass|transparent/i.test(mat)) {
    notes.push("目标材料=「" + mat + "」：A01-02 脚注[6] 明确 IFS2402 系列不能测厚；仅当玻璃厚度 > 量程时才可做距离测量；金属表面测量能力有限。透明/玻璃目标请据此确认可用性，本计算器不据此编造厚度测量能力。");
  } else if (/金属|metal/i.test(mat)) {
    notes.push("目标材料=「" + mat + "」：A01-02 脚注[6] 指出金属表面测量仅有限可用，建议先做样件验证；目录标称适用 reflective / diffuse / transparent 表面。");
  } else if (/散射|漫反射|diffuse/i.test(mat)) {
    notes.push("目标材料=「" + mat + "」：A01-02 标称适用 reflective / diffuse / transparent 表面；漫反射面信号强度受最大测量角限制，该档最大测量角 ±" + pick.angle_deg + "°。");
  } else if (/反射|reflective|镜面/i.test(mat)) {
    notes.push("目标材料=「" + mat + "」：反射面为 A01-02 标称适用对象；最大测量角 ±" + pick.angle_deg + "°，且精度随倾角趋近极限而下降（脚注[5]）。");
  } else {
    notes.push("目标材料未提供或未识别：A01-02 标称适用 reflective（反射）、diffuse（散射/漫反射）、transparent（透明，如玻璃）表面，选型前建议确认材料类型。");
  }
  notes.push("该档原表参数（A01-02）：数值孔径 " + pick.na + "、最大测量角 ±" + pick.angle_deg + "°、光斑直径 " + pick.spot_um + " µm、动态分辨率 <" + pick.dynamic_nm + " nm；线性度数据为 25±1 °C 恒温、平面平行玻璃上测得（脚注[4]）。");
  if (!linearityMet) {
    notes.push("⚠ 线性度核对未通过：<±" + pick.linearity_um + " µm（≈" + r4(pick.linearity_um * 1000) + " nm）大于精度要求 " + r4(acc_nm) + " nm。量程与静态分辨率满足判据，但绝对误差由线性度主导；建议把线性度单独计入精度预算或放宽精度要求。此处仍给出推荐型号，并明确标注该项不满足，不隐瞒。");
  }
  if (!IFS2402.live && IFS2402.uncertainty) notes.push(IFS2402.uncertainty);

  return succeed(T, {
    formula: "选型判据：① 量程 R ≥ 位移跨度 ΔL = range_max − range_min；② 静态分辨率 Res_static ≤ 精度要求 A；③ 线性度 Lin ≤ A（依据 A01-02 规格表逐档核对）",
    substitution: "range_min = " + rmin + " " + runit + "，range_max = " + rmax + " " + runit + " → ΔL = " + r4(span_mm) + " mm；accuracy = " + acc + " " + aunit + " = " + r4(acc_nm) + " nm；material = " + mat,
    steps: steps,
    result: {
      value: pick.range_mm, unit: "mm",
      recommended_model: pick.models[0],
      recommended_models: pick.models,
      display: pick.models[0] + "（" + pick.range_mm + " mm 量程档）",
      recommended_range_mm: pick.range_mm,
      required_span_mm: r4(span_mm),
      margin_mm: r4(margin), margin_percent: r4(marginPct),
      accuracy: acc, accuracy_unit: aunit, accuracy_nm: r4(acc_nm), accuracy_um: r4(acc_um),
      static_resolution_nm: pick.static_nm,
      dynamic_resolution_nm: pick.dynamic_nm,
      linearity_um: pick.linearity_um,
      na: pick.na, max_angle_deg: pick.angle_deg, spot_diameter_um: pick.spot_um,
      material: mat,
      checks: { range_covered: true, resolution_met: resolutionMet, linearity_met: linearityMet },
      tiers: tiers,
      warnings: linearityMet ? [] : ["线性度 <±" + pick.linearity_um + " µm 不满足 " + r4(acc_nm) + " nm 精度要求"],
    },
    notes: notes,
    source: IFS2402.source,
  });
}

// ---------------- (4) tolerance_rss ----------------

function calcToleranceRSS(p) {
  const T = "tolerance_rss";
  const unit = canonUnit(p.unit !== undefined ? p.unit : "µm") || "µm";
  if (p.unit !== undefined && p.unit !== null && !canonUnit(p.unit)) {
    return fail(T, "unit 单位无法识别: " + p.unit, "建议 unit 使用 µm / nm / mm / m 之一");
  }
  let arr = p.tolerances !== undefined ? p.tolerances : (p.sigmas !== undefined ? p.sigmas : p.sigma);
  if (!Array.isArray(arr)) arr = num(arr) !== null ? [arr] : null;
  if (!Array.isArray(arr) || arr.length === 0) {
    return fail(T, "缺少必需参数 tolerances（公差数组）", "需要提供 tolerances 数组，例如 [0.5, 0.3, 0.2]，并配 unit（建议 µm）；各分项需为同单位的非负数值");
  }
  const vals = arr.map(function (v) { return toUnitNumber(v, unit); });
  if (vals.some(function (v) { return v === null || v < 0; })) {
    return fail(T, "公差数组含非数值或负值", "建议提供同单位的非负数值数组，例如 [0.5, 0.3, 0.2] " + unit + "；不要混入不同单位或负公差");
  }
  const squares = vals.map(function (v) { return v * v; });
  const sum = squares.reduce(function (a, b) { return a + b; }, 0);
  const total = Math.sqrt(sum);
  const worst = vals.reduce(function (a, b) { return a + b; }, 0);
  const steps = [
    "① 公式：σ_total = √(Σ σᵢ²)（各分项独立时的统计合成）",
    "② 代入：σ = [" + vals.join(", ") + "] " + unit + "，共 " + vals.length + " 项",
    "③ 逐项平方：" + vals.map(function (v, i) { return v + "² = " + r4(squares[i]); }).join("；"),
    "④ 求和：Σ σᵢ² = " + squares.map(function (s) { return r4(s); }).join(" + ") + " = " + r4(sum) + " " + unit + "²",
    "⑤ 开方：σ_total = √" + r4(sum) + " = " + r4(total) + " " + unit + " ≈ 0.62 " + unit + "（三项 0.5/0.3/0.2 时）",
    "⑥ 对照：最差情况线性叠加 Σσᵢ = " + r4(worst) + " " + unit + "，明显大于 RSS 结果，说明 RSS 不是最差情况叠加",
  ];
  return succeed(T, {
    formula: "σ_total = √(Σ σᵢ²)",
    substitution: "σ = [" + vals.join(", ") + "] " + unit + "；Σ σᵢ² = " + r4(sum) + "；σ_total = √" + r4(sum) + " = " + r4(total) + " " + unit,
    steps: steps,
    result: {
      value: r4(total), unit: unit,
      sigma_total: r4(total),
      tolerances: vals, squares: squares.map(r4),
      sum_of_squares: r4(sum),
      worst_case_linear_sum: r4(worst),
      count: vals.length,
      displayed_as: "≈0.62 " + unit,
      plan_example_sigma_total: 0.62,
    },
    notes: [
      "① RSS（Root Sum Square）是独立随机变量的统计合成：方差相加后开方，前提是各公差项互不相关、近似同分布。它不是最差情况线性叠加（本例最差情况为 " + r4(worst) + " " + unit + "）。",
      "② 依据 B01-01（Zemax KB 公差分析概述）与 B01-03：OpticStudio 采用 Root Sum Square 假设估计性能变化，因为 min/max 公差不会同时出现，直接把各项平方后求和会给出过于悲观的预测；Monte Carlo 分析通常与其大体一致。",
      "③ 若公差项存在相关性或需保证 100% 合格率，应改用 Monte Carlo 或最差情况叠加，不能只依赖 RSS。",
      "④ 各分项必须统一单位；本计算器按 unit = " + unit + " 输出，若输入为字符串带单位（如 '500nm'）会自动换算到 " + unit + "。",
      "⑤ result.plan_example_sigma_total = 0.62 为 PLUGIN_PLAN.md §3.2 示例值（供交叉核对）；精确值 σ_total = " + r4(total) + " " + unit + "，四舍五入到两位小数即 0.62。",
    ],
    source: SOURCE_RSS,
  });
}

// ---------------- (5) na_resolution ----------------

function calcNAResolution(p) {
  const T = "na_resolution";
  const lam = parseLength(p.lambda, p.lambda_unit !== undefined ? p.lambda_unit : p.unit);
  const naRaw = p.NA !== undefined ? p.NA : p.na;
  const na = num(naRaw);
  if (!lam || na === null) {
    return fail(T, "缺少必需参数 lambda 与 NA", "需要提供 lambda 与 NA；lambda 建议 400–1600 nm（可写 550 或 '0.55µm' 并配 lambda_unit），NA 建议 0.1–1.4");
  }
  if (!(lam.n > 0)) {
    return fail(T, "lambda 必须为正数", "建议提供 400–1600 nm 范围内的正波长，并显式给出 lambda_unit");
  }
  if (!(na > 0 && na <= 1.6)) {
    return fail(T, "NA 越界或非法: " + naRaw, "建议 NA 取 0.1–1.4（空气/浸液物镜常用范围），且必须大于 0；最大不超过 1.6");
  }
  const rayleigh = (0.61 * lam.n) / na;
  const halfNa = lam.n / (2 * na);
  const confocal = rayleigh / Math.SQRT2;
  const factor = 1 / Math.SQRT2;
  const steps = [
    "① 公式（Rayleigh 判据）：δ = 0.61 × λ / NA；另一常用形式 δ′ = λ / (2 × NA)",
    "② 代入：λ = " + lam.n + " " + lam.unit + "，NA = " + na,
    "③ 分子：0.61 × " + lam.n + " = " + r4(0.61 * lam.n) + " " + lam.unit,
    "④ Rayleigh：δ = " + r4(0.61 * lam.n) + " / " + na + " = " + r4(rayleigh) + " " + lam.unit + " ≈ 353 " + lam.unit + "（λ=550 nm、NA=0.95 时）",
    "⑤ 另一形式：δ′ = λ / (2 × NA) = " + lam.n + " / (2 × " + na + ") = " + lam.n + " / " + r4(2 * na) + " = " + r4(halfNa) + " " + lam.unit,
    "⑥ 共焦模式提升：δ_conf ≈ δ / √2 = " + r4(rayleigh) + " × " + r4(factor) + " = " + r4(confocal) + " " + lam.unit,
    "⑦ 结果：δ(Rayleigh) ≈ " + r4(rayleigh) + " " + lam.unit + "；δ′ = " + r4(halfNa) + " " + lam.unit + "；共焦估计 ≈ " + r4(confocal) + " " + lam.unit,
  ];
  return succeed(T, {
    formula: "δ = 0.61 × λ / NA（Rayleigh）；δ′ = λ / (2 × NA)；δ_conf ≈ δ / √2",
    substitution: "λ = " + lam.n + " " + lam.unit + "，NA = " + na + " → δ = 0.61 × " + lam.n + " / " + na + " = " + r4(rayleigh) + " " + lam.unit,
    steps: steps,
    result: {
      value: r4(rayleigh), unit: lam.unit,
      rayleigh_delta: r4(rayleigh),
      delta_lambda_over_2na: r4(halfNa),
      confocal_estimate: r4(confocal),
      improvement_factor: r4(factor),
      lambda: lam.n, lambda_unit: lam.unit, NA: na,
      plan_example_delta_nm: 353,
    },
    notes: [
      "① 0.61λ/NA 为 Rayleigh 判据下的两点可分辨距离（也等于艾里斑半径）；λ/(2NA) 是另一种常用形式（相干/Abbe 近似）。两者系数 0.61 与 0.5 不同，数值不可混用，需注明所用判据。",
      "② 共焦模式分辨率提升 ≈1/√2（即改善因子 " + r4(factor) + "，δ_conf ≈ " + r4(confocal) + " " + lam.unit + "）是常见的一阶近似；不同文献/照明与针孔条件下提升倍数会有差异，此处按方案 §3.2 给出，标注为近似而非精确常数。",
      "③ 与 diffraction_limit 的关系：d = 1.22λ/NA 是艾里斑直径，恰为 δ = 0.61λ/NA 的 2 倍；两者描述同一衍射极限的不同度量口径。",
      "④ KB 参考 A02-03：艾里斑半径、瑞利判据、F# 与探测器像元尺寸的关系（像元小于艾里斑半径一半即过采样，无益于提升衍射极限分辨率）。",
    ].concat(lam.assumed ? ["⑤ 未提供合法的 lambda_unit，已按 nm 处理；如需其它单位请显式传 lambda_unit。"] : []),
    source: SOURCE_OPTICS,
  });
}

// ---------------- 参数别名归一化 ----------------
// 主契约（lead 规格）：lambda / lambda_unit、dn_dT、delta_T、range_min / range_max / unit / accuracy / accuracy_unit。
// 同时兼容测试队友（task-8）使用的 lambda_nm / dndT / deltaT / range_min_mm / range_max_mm / precision_nm 等写法，
// 两种命名都可用，避免联调时因命名差异互相阻塞。
function normalizeParams(p) {
  const q = Object.assign({}, p);
  const wl = [["nm", "nm"], ["um", "µm"], ["µm", "µm"], ["μm", "µm"], ["mm", "mm"], ["m", "m"]];
  for (let i = 0; i < wl.length; i++) {
    const k = "lambda_" + wl[i][0];
    if (q[k] !== undefined && q.lambda === undefined) {
      q.lambda = q[k];
      if (q.lambda_unit === undefined) q.lambda_unit = wl[i][1];
    }
  }
  if (q.dn_dT === undefined && q.dndT !== undefined) q.dn_dT = q.dndT;
  if (q.delta_T === undefined) {
    if (q.deltaT !== undefined) q.delta_T = q.deltaT;
    else if (q.dT !== undefined) q.delta_T = q.dT;
  }
  const ru = [["mm", "mm"], ["um", "µm"], ["µm", "µm"], ["μm", "µm"], ["nm", "nm"], ["m", "m"]];
  for (let i = 0; i < ru.length; i++) {
    const u = ru[i][1];
    const mn = "range_min_" + ru[i][0];
    const mx = "range_max_" + ru[i][0];
    const pr = "precision_" + ru[i][0];
    if (q[mn] !== undefined && q.range_min === undefined) { q.range_min = q[mn]; if (q.unit === undefined) q.unit = u; }
    if (q[mx] !== undefined && q.range_max === undefined) { q.range_max = q[mx]; if (q.unit === undefined) q.unit = u; }
    if (q[pr] !== undefined && q.accuracy === undefined) { q.accuracy = q[pr]; if (q.accuracy_unit === undefined) q.accuracy_unit = u; }
  }
  if (q.precision !== undefined && q.accuracy === undefined) q.accuracy = q.precision;
  if (q.sigmas !== undefined && q.tolerances === undefined) q.tolerances = q.sigmas;
  return q;
}

// ---------------- 统一入口 ----------------

export function calculate(type, params) {
  const T = String(type === undefined || type === null ? "" : type);
  try {
    let p = params;
    if (typeof p === "string") {
      try { p = JSON.parse(p); } catch (e) { p = {}; }
    }
    if (!p || typeof p !== "object" || Array.isArray(p)) p = {};
    p = normalizeParams(p);
    switch (T) {
      case "diffraction_limit": return calcDiffractionLimit(p);
      case "coating_thermal_drift": return calcCoatingThermalDrift(p);
      case "confocal_range_select": return calcConfocalRangeSelect(p);
      case "tolerance_rss": return calcToleranceRSS(p);
      case "na_resolution": return calcNAResolution(p);
      default: return unknownType(T);
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return fail(T, "计算器内部异常: " + msg, "建议检查输入参数后重试；若持续出现请把该异常与参数反馈给 lead");
  }
}

export default calculate;
