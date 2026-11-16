#!/usr/bin/env node
/**
 * verify-all.mjs — OpticForge 插件端到端契约验证（只读源码，不修改项目内任何文件）。
 *
 * 用 DSH 安装目录 asar 归档里【真实】的 defineTool / validateJsonSchemaValue 校验插件：
 *   1. 所有必需文件存在
 *   2. import lib/index.js 拿到 apply/name/inject
 *   3. 构造 fake ctx 收集 ctx.tools.register(...) 的两个 defineTool 定义
 *   4. 对每个定义：execute 真实调用 + output.render 可调用 + 返回值通过 output.schema 校验
 *   5. 端到端断言：检索命中 / 知识空白 / doc_filter / 5 计算器示例 / 67 块统计
 *
 * 为什么需要内联 loader：独立 node.exe 没有 Electron asar patch，
 *   - 直接 import asar 归档内路径会报 ERR_MODULE_NOT_FOUND，fs.existsSync() 归档内路径返回 false；
 *   - lib/index.js 的裸 specifier "@deepseek-ai/dsh-tools" 也不在 require.paths 里（MODULE_NOT_FOUND）。
 * 本脚本内联实现：解析 app.asar 归档头 -> 提取依赖闭包到 os.tmpdir() 缓存 ->
 * module.register() + resolve hook 把裸 specifier 按 package.json exports 重定向到缓存里的真实文件。
 * 不硬依赖 opticforge/test/ 目录（test/ 是否存在都不影响本脚本），纯 Node.js、零新增 npm 依赖。
 * 唯一的运行时写入是系统临时目录缓存，项目内任何文件（含 lib/ data/ test/）都不会被改动。
 *
 * 运行：node opticforge/scripts/verify-all.mjs
 *       C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe opticforge/scripts/verify-all.mjs
 * 环境变量（可选）：DSH_ASAR 指向 app.asar 文件；或 DSH_INSTALL_DIR 指向 .../app.asar/dsh 目录。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------------------------------------------------------------------
// 定位 DSH app.asar 归档（Electron asar 是单个只读文件，不是真实目录）
// ---------------------------------------------------------------------------
function resolveAsar() {
  const cands = [];
  if (process.env.DSH_ASAR) cands.push(process.env.DSH_ASAR);
  if (process.env.DSH_INSTALL_DIR) {
    const d = process.env.DSH_INSTALL_DIR;
    // .../app.asar/dsh -> .../app.asar ; 本身已是 .asar 文件则直接用
    cands.push(/\.asar$/i.test(d) ? d : path.join(d, '..'));
  }
  cands.push('D:/Deepseek/resources/app.asar');
  cands.push('D:\\Deepseek\\resources\\app.asar');
  for (const c of cands) {
    if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Error('找不到 DSH app.asar 归档（已尝试: ' + cands.filter(Boolean).join(' / ') +
    '）。可设置环境变量 DSH_ASAR 指向 app.asar 文件，或 DSH_INSTALL_DIR 指向 .../app.asar/dsh 目录');
}

// ---------------------------------------------------------------------------
// 从 asar 归档提取依赖闭包到 os.tmpdir() 缓存，并生成 module.register 用的 loader.mjs
// 思路参考 opticforge/test/_asar_loader.mjs 与 test/.asar-runtime/loader.mjs，但完全内联、不依赖 test/
// ---------------------------------------------------------------------------
const WANTED_EXT = new Set(['.js', '.cjs', '.mjs', '.json']);

function ensureRuntime(asar) {
  const fd = fs.openSync(asar, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(12);
    const headerBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, headerBuf, 0, headerSize, 16);
    const header = JSON.parse(headerBuf.toString('utf8'));
    const dataBase = 16 + headerSize + ((4 - (headerSize % 4)) % 4);
    const nm = header && header.files && header.files.dsh && header.files.dsh.files &&
      header.files.dsh.files.node_modules && header.files.dsh.files.node_modules.files;
    if (!nm) throw new Error('app.asar 内未找到 dsh/node_modules 节点，归档结构不符合预期');

    function nodeAt(rel) {
      let n = nm;
      for (const part of rel.split('/')) {
        n = (n.files && n.files[part]) || n[part];
        if (!n) return null;
      }
      return n.files || n;
    }
    function entryAt(rel) {
      const n = nodeAt(rel);
      return n && typeof n.size === 'number' ? n : null;
    }
    function readEntry(e) {
      const buf = Buffer.alloc(e.size);
      fs.readSync(fd, buf, 0, e.size, dataBase + Number(e.offset));
      return buf;
    }

    const cache = path.join(os.tmpdir(), 'dsh-opticforge-verify-runtime');
    const metaPath = path.join(cache, '_meta.json');
    const stat = fs.statSync(asar);
    // 把脚本自身内容纳入 stamp：本脚本一旦改动（loader 逻辑变化）缓存自动重建，
    // 避免复用上一次生成的旧 loader.mjs。
    const selfHash = createHash('sha256')
      .update(fs.readFileSync(fileURLToPath(import.meta.url)))
      .digest('hex').slice(0, 16);
    const stamp = asar + '|' + stat.size + '|' + Math.floor(stat.mtimeMs) + '|' + selfHash;
    let reuse = false;
    if (fs.existsSync(metaPath)) {
      try { reuse = JSON.parse(fs.readFileSync(metaPath, 'utf8')).stamp === stamp; } catch { /* 缓存损坏则重建 */ }
    }
    if (reuse && fs.existsSync(path.join(cache, 'loader.mjs')) &&
        fs.existsSync(path.join(cache, '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'))) {
      return { cache, loader: path.join(cache, 'loader.mjs'), copied: 0, deps: 0, reused: true };
    }

    // 重建缓存目录
    fs.rmSync(cache, { recursive: true, force: true });
    fs.mkdirSync(cache, { recursive: true });

    function copyEntry(rel) {
      const e = entryAt(rel);
      if (!e) return false;
      const dest = path.join(cache, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, readEntry(e));
      return true;
    }
    function copyTree(rel) {
      const n = nodeAt(rel);
      if (!n) return 0;
      let count = 0;
      for (const [name, child] of Object.entries(n)) {
        const cr = rel + '/' + name;
        if (child && child.files) count += copyTree(cr);
        else if (child && typeof child.size === 'number' && WANTED_EXT.has(path.extname(name).toLowerCase())) {
          if (copyEntry(cr)) count++;
        }
      }
      return count;
    }

    // 种子包 + 依赖闭包迭代：既读 package.json 的 dependencies/peerDependencies，
    // 也扫描已提取 .js 里的裸 import/require，补齐运行时真正会用到的包。
    const SEEDS = [
      '@deepseek-ai/dsh-tools', '@deepseek-ai/cordis', '@deepseek-ai/cosmokit',
      '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-util-values',
      '@deepseek-ai/dsh-util-crypto', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/schemastery', '@standard-schema/spec',
      '@deepseek-ai/cordis-plugin-loader', 'zod', 'js-yaml', 'argparse'
    ];
    let copied = 0;
    for (const p of SEEDS) copied += copyTree(p);
    const depSet = new Set(SEEDS);

    const bareRe = /(?:\bfrom\s*|\bimport\s*\(?\s*|require\s*\(\s*|export\s+\*\s+from\s*)["']([^"']+)["']/g;
    function collectJsFiles(dir, out) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collectJsFiles(p, out);
        else if (/\.(js|cjs|mjs)$/i.test(e.name)) out.push(p);
      }
    }

    for (let round = 0; round < 6; round++) {
      const before = depSet.size;
      for (const name of [...depSet]) {
        const pj = path.join(cache, ...name.split('/'), 'package.json');
        if (!fs.existsSync(pj)) continue;
        let o;
        try { o = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { continue; }
        const deps = [...Object.keys(o.dependencies || {}), ...Object.keys(o.peerDependencies || {})];
        for (const d of deps) {
          if (d.startsWith('node:') || depSet.has(d)) continue;
          if (nodeAt(d)) depSet.add(d);
        }
      }
      const jsFiles = [];
      collectJsFiles(cache, jsFiles);
      for (const f of jsFiles) {
        let t;
        try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
        for (const m of t.matchAll(bareRe)) {
          const sp = m[1];
          if (sp.startsWith('.') || sp.startsWith('/') || sp.startsWith('node:') ||
              sp.startsWith('file:') || sp.startsWith('data:')) continue;
          const parts = sp.split('/');
          const pkg = sp.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
          if (!depSet.has(pkg) && nodeAt(pkg)) depSet.add(pkg);
        }
      }
      if (depSet.size === before) break;
    }
    for (const p of depSet) copied += copyTree(p);

    // 生成 resolve hook（module.register 用），NM 指向本次缓存目录
    const loaderSrc = [
      'import { pathToFileURL } from "node:url";',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const NM = ' + JSON.stringify(cache) + ';',
      'function pick(exp) {',
      '  if (!exp) return null;',
      '  if (typeof exp === "string") return exp;',
      '  for (const k of ["node", "import", "default", "require"]) {',
      '    const v = exp[k];',
      '    if (typeof v === "string") return v;',
      '    if (v && typeof v === "object") { const d = v.default || v.import || v.node; if (typeof d === "string") return d; }',
      '  }',
      '  return null;',
      '}',
      'export async function resolve(specifier, context, nextResolve) {',
      '  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:") ||',
      '      specifier.startsWith("file:") || specifier.startsWith("data:")) return nextResolve(specifier, context);',
      '  const parts = specifier.split("/");',
      '  const pkg = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];',
      '  const rawSub = specifier.slice(pkg.length);',
      '  const sub = rawSub.charAt(0) === "/" ? rawSub.slice(1) : rawSub;',
      '  const pjPath = path.join(NM, ...pkg.split("/"), "package.json");',
      '  if (!fs.existsSync(pjPath)) return nextResolve(specifier, context);',
      '  let pj; try { pj = JSON.parse(fs.readFileSync(pjPath, "utf8")); } catch { return nextResolve(specifier, context); }',
      '  let rel = null;',
      '  if (sub) {',
      '    const exp = pj.exports && (pj.exports["./" + sub] || pj.exports[sub]);',
      '    rel = pick(exp) || sub;',
      '  } else {',
      '    rel = pick(pj.exports && pj.exports["."]) || pj.main || "index.js";',
      '  }',
      '  if (!rel) return nextResolve(specifier, context);',
      '  if (rel.slice(0, 2) === "./") rel = rel.slice(2);',
      '  const base = path.join(NM, ...pkg.split("/"), rel);',
      '  const candidates = [base, base + ".js", base + ".mjs", base + ".cjs", path.join(base, "index.js")];',
      '  for (const full of candidates) if (fs.existsSync(full) && fs.statSync(full).isFile()) {',
      '    return { url: pathToFileURL(full).href, shortCircuit: true };',
      '  }',
      '  return nextResolve(specifier, context);',
      '}',
    ].join('\n');
    const loader = path.join(cache, 'loader.mjs');
    fs.writeFileSync(loader, loaderSrc + '\n');
    fs.writeFileSync(metaPath, JSON.stringify({ stamp, deps: depSet.size, copied }));
    return { cache, loader, copied, deps: depSet.size, reused: false };
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  // ---- 加载 asar 里的真实 defineTool 运行时（必须在任何动态 import 之前 register） ----
  const asar = resolveAsar();
  const runtime = ensureRuntime(asar);
  console.log('DSH asar 归档:', asar);
  console.log('依赖缓存目录:', runtime.cache,
    runtime.reused ? '(复用)' : '(提取 ' + runtime.copied + ' 个文件 / ' + runtime.deps + ' 个包)');
  register(pathToFileURL(runtime.loader).href, import.meta.url);

  const dshTools = await import('@deepseek-ai/dsh-tools');
  const { defineTool, validateJsonSchemaValue } = dshTools;
  console.log('defineTool:', typeof defineTool === 'function' ? 'OK' : 'MISSING');
  console.log('validateJsonSchemaValue:', typeof validateJsonSchemaValue === 'function' ? 'OK' : 'MISSING');

  section('1. 必需文件');
  const must = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/kb-engine.js', 'lib/kb-data.js', 'lib/calculators.js', 'data/kb-data.json'];
  for (const m of must) ok(fs.existsSync(path.join(ROOT, m)), m);

  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  ok(pj.name === '@deepseek-ai/dsh-opticforge', 'package.json name');
  ok(pj.type === 'module', 'package.json type=module');
  ok(pj.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch');
  const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf-8');
  ok(/id:\s*opticforge/.test(patch), 'cordis.patch.yml 含 id: opticforge');
  ok(patch.includes('@deepseek-ai/dsh-opticforge'), 'cordis.patch.yml 含包名');

  // peer 兼容性（runtime 0.2.2-rc.1）：@deepseek-ai/dsh-tools 范围必须能匹配
  const peerStr = JSON.stringify(pj.peerDependencies||{});
  ok(/0\.2\.2-rc\.1|\^0\.2\.0-rc\.1|~0\.2\.2-rc/.test(peerStr), 'peerDependencies 含兼容 0.2.2-rc.1 的 dsh-tools');

  section('2. 数据统计');
  const { getKBData, TOTAL_CHUNKS, PRESENT_CHUNKS, KB_SOURCE } = await import(pathToFileURL(path.join(ROOT, 'lib/kb-data.js')).href + '?v=' + Date.now());
  const chunks = await getKBData();
  ok(chunks.length === 67, 'getKBData() 返回 67 块，实际 ' + chunks.length);
  ok(chunks.filter(c => c.status === 'present').length === 51, 'present=51，实际 ' + chunks.filter(c => c.status === 'present').length);
  ok(TOTAL_CHUNKS === 67, 'TOTAL_CHUNKS=67');
  ok(PRESENT_CHUNKS === 51, 'PRESENT_CHUNKS=51');
  ok(typeof KB_SOURCE === 'string' && KB_SOURCE.includes('optics-kb'), 'KB_SOURCE 标注 ModelScope Dataset');
  const fields = ['doc_id','chunk_id','status','is_original_excerpt','text','source','page_or_section','keywords_zh','disclaimer'];
  ok(fields.every(f => Object.hasOwn(chunks[0], f)), 'chunk 含全部 9 字段');

  section('3. apply(ctx) 注册两个 defineTool');
  const mod = await import(pathToFileURL(path.join(ROOT, 'lib/index.js')).href + '?v=' + Date.now());
  ok(mod.name === 'opticforge', 'export name === opticforge');
  ok(Array.isArray(mod.inject) && mod.inject.includes('tools'), 'inject 含 tools');
  ok(typeof mod.apply === 'function', 'export apply 是函数');
  const registered = [];
  const fakeCtx = { tools: { register: (def) => registered.push(def) } };
  await mod.apply(fakeCtx);
  ok(registered.length === 2, '注册 2 个工具，实际 ' + registered.length);
  const byName = Object.fromEntries(registered.map(d => [d.name, d]));
  ok(!!byName.opticforge_search, '注册 opticforge_search');
  ok(!!byName.opticforge_calc, '注册 opticforge_calc');

  section('4. 两个工具契约（execute / render / schema）');
  for (const [name, def] of Object.entries(byName)) {
    ok(typeof def.output?.render === 'function', name + ' 有 output.render');
    ok(!!def.output?.schema, name + ' 有 output.schema');
    ok(typeof def.execute === 'function', name + ' 有 execute');
  }

  async function call(name, args) {
    const def = byName[name];
    const value = await def.execute(args, {});
    const violations = validateJsonSchemaValue(def.output.schema, value, '');
    const rendered = def.output.render(args, value);
    return { value, violations, rendered };
  }

  section('5. opticforge_search 端到端');
  const s1 = await call('opticforge_search', { query: '共焦色散 测量原理' });
  ok(s1.violations.length === 0, 'search 返回符合 output.schema（' + s1.violations.join(';') + '）');
  ok(Array.isArray(s1.rendered) && typeof s1.rendered[0]?.text === 'string', 'render 返回 text 数组');
  ok(s1.value.total_hits > 0 && s1.value.results[0]?.doc_id === 'A01', '「共焦色散 测量原理」top1=A01');
  ok(s1.value.results.every(r => r.status === 'present'), '结果全部 status=present');
  const s2 = await call('opticforge_search', { query: 'RCWA 光栅 衍射效率' });
  ok(s2.value.results[0]?.doc_id === 'C02', '「RCWA 光栅 衍射效率」top1=C02');
  const s3 = await call('opticforge_search', { query: '量子计算 光学 量子比特' });
  ok(s3.value.total_hits === 0, '知识空白查询返回空');
  ok(/未找到|无相关|没有/.test(s3.value.note || ''), '知识空白 note 如实告知');
  const s4 = await call('opticforge_search', { query: '公差分析 Monte Carlo', doc_filter: 'B01' });
  ok(s4.value.results.every(r => r.doc_id === 'B01'), 'doc_filter=B01 生效');
  const s5 = await call('opticforge_search', { query: '共焦色散', top_k: 2 });
  ok(s5.value.results.length <= 2, 'top_k=2 生效');

  // H1 数据驱动守卫不误伤回归：lib/index.js 的 isZeroCoverageQuery(query, chunks) 第三重
  // 判据 topicHasPresentBasis 会用运行时 KB 数据核实「词表命中主题词是否在 status=present
  // 块的可检索字段中真实出现」。「不确定度」(E01-06)、「自由曲面」(B01-10) 虽在
  // ZERO_COVERAGE_TOPICS 词表内，但实测在 present 块 keywords_zh 中有真实依据，守卫必须
  // 放行照常检索，不得短路成「知识库中未找到相关依据」。每条断言同时核验：返回值经真实
  // validateJsonSchemaValue 校验符合编译后 output.schema、total_hits>0、top1 命中指定块、
  // note 不是未命中告知。
  const H1_GUARD_CASES = [
    { query: '不确定度 评定', docId: 'E01', chunkId: 'E01-06' },
    { query: '自由曲面 光学设计', docId: 'B01', chunkId: 'B01-10' },
  ];
  for (const h of H1_GUARD_CASES) {
    const hit = await call('opticforge_search', { query: h.query });
    const v = hit.value;
    const top = v.results[0] || {};
    ok(
      hit.violations.length === 0 && v.total_hits > 0 &&
      top.doc_id === h.docId && top.chunk_id === h.chunkId &&
      !/知识库中未找到相关依据/.test(v.note || ''),
      'H1 守卫不误伤「' + h.query + '」→ total_hits=' + v.total_hits +
        ' top1=' + (top.doc_id || '-') + '/' + (top.chunk_id || '-') +
        ' 且 note 非未命中（符合 schema=' + (hit.violations.length === 0) + '）'
    );
  }

  section('6. opticforge_calc 端到端（5 类型）');
  const calcCases = [
    ['diffraction_limit', { lambda: 550, lambda_unit: 'nm', NA: 0.95 }],
    ['coating_thermal_drift', { lambda: 1064, lambda_unit: 'nm', dn_dT: 1e-5, alpha: 5e-7, delta_T: 40 }],
    ['confocal_range_select', { range_min: 0, range_max: 1, unit: 'mm', accuracy: 100, accuracy_unit: 'nm', material: '反射' }],
    ['tolerance_rss', { tolerances: [0.5, 0.3, 0.2], unit: 'µm' }],
    ['na_resolution', { lambda: 550, lambda_unit: 'nm', NA: 0.95 }],
  ];
  for (const [type, params] of calcCases) {
    const c = await call('opticforge_calc', { type, params });
    ok(c.violations.length === 0, type + ' 返回符合 output.schema（' + c.violations.join(';') + '）');
    ok(c.value.ok === true, type + ' ok=true');
    ok(typeof c.value.formula === 'string' && c.value.formula.length > 0, type + ' 有公式');
    ok(Array.isArray(c.value.steps) && c.value.steps.length > 0, type + ' 有 steps 数组');
    ok(typeof c.value.source === 'string' && c.value.source.length > 0, type + ' 有数据来源');
  }
  // 未知 type 分两层核验：真实 defineTool 的 parameters.type 带 enum，工具层在参数校验
  // 阶段就会干净拒绝（抛 ToolArgsError），这是框架层合法行为、不是崩溃——见
  // opticforge/test/run.mjs 的 D6b。「ok=false 且绝不抛异常」是 lib/calculators.js
  // 契约层（calculate()）的行为。原脚本把该断言经 call() 跑到工具层，二者天然冲突。
  let enumErr = null;
  try {
    await byName.opticforge_calc.execute({ type: 'not_exist', params: {} }, {});
  } catch (e) { enumErr = e; }
  ok(!!enumErr && /must be one of|enum|invalid arguments/i.test(String((enumErr && enumErr.message) || enumErr)),
     '未知 type 工具层由 enum 校验干净拒绝（框架合法行为，非崩溃）');

  const calcMod = await import(pathToFileURL(path.join(ROOT, 'lib/calculators.js')).href + '?v=' + Date.now());
  ok(typeof calcMod.calculate === 'function', 'lib/calculators.js 导出 calculate');
  let badThrew = false, badValue = null;
  try { badValue = await calcMod.calculate('not_exist', {}); }
  catch (e) { badThrew = true; console.log('    note: calculate(not_exist) 抛出 ' + ((e && e.message) || e)); }
  ok(badThrew === false, '未知 type calculate() 不抛异常');
  ok(badValue?.ok === false, '未知 type ok=false');
  const badViolations = validateJsonSchemaValue(byName.opticforge_calc.output.schema, badValue, '');
  ok(badViolations.length === 0, '未知 type 返回符合 schema（' + badViolations.join(';') + '）');

  const miss = await call('opticforge_calc', { type: 'diffraction_limit', params: {} });
  ok(miss.value.ok === false, '缺参 ok=false 且不抛异常');
  ok(/建议|范围|缺少|需要|提供/.test((miss.value.suggestion||'') + (miss.value.error||'')), '缺参给出建议');

  section('汇总');
  const total = pass + fail;
  console.log('总计 ' + total + ' 项断言：PASS ' + pass + ' / FAIL ' + fail);
  console.log('PASS:', pass, ' FAIL:', fail);
  console.log(fail === 0 ? 'RESULT: ALL PASS' : 'RESULT: FAIL');
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => {
  console.error('验证脚本异常:', e.stack || e.message);
  console.error('RESULT: ERROR');
  process.exitCode = 1;
});
