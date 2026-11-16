#!/usr/bin/env node
/**
 * install-local.mjs — 把 OpticForge 插件安装到本机 DSH，使其在会话中可调用。
 *
 * 用法（在插件目录或任意 cwd 均可）：
 *   node opticforge/scripts/install-local.mjs            # 安装（默认 profile: desktop）
 *   node opticforge/scripts/install-local.mjs --profile desktop --dry-run
 *   node opticforge/scripts/install-local.mjs --uninstall
 *   node opticforge/scripts/install-local.mjs --home <临时目录>   # 测试安装到临时 home，不碰真实 profile
 *
 * 原理（已核对 DSH 0.2.2-rc.1 源码 + 本机实测）：
 *  - profile 的 package.json 里 dsh.profile.bundles 是有序组合包列表；
 *    每个 bundle 的 package.json 必须声明 dsh.bundle.patch = ./cordis.patch.yml。
 *  - 启动顺序：各 bundle 的 patch 层 → profile 的 cordis.patch.yml → home 层 → --patch 覆盖。
 *  - bundle 名先按「DSH 安装目录」解析，再按「profile 目录」解析（resolveBundleDir 两锚点）。
 *    实测：D:\\Deepseek\\resources\\app.asar\\dsh 是 Electron asar 只读归档，普通 Node 的
 *    fs.existsSync() 对归档内路径返回 false、且 mkdir/write 报 ENOTDIR，无法写入。
 *    因此本脚本把插件复制到「profile 目录」的 node_modules/@deepseek-ai/dsh-opticforge/（可写，第二锚点）。
 *
 *  - 关键修复（peer 依赖解析）：
 *    lib/index.js 顶部是 import { defineTool } from "@deepseek-ai/dsh-tools"。
 *    旧版 linkPeers() 在插件包内建 junction 指向 asar 虚拟路径，普通 OS 文件系统层
 *    不存在该目标（existsSync(junction)===false、读文件报 ENOENT），因此无效。
 *    现改为按优先级提供「真实文件」：
 *      (1) profile 的 node_modules/@deepseek-ai 下已有真实 dsh-tools/cordis 副本
 *          → 什么都不做，靠 Node 目录向上解析（createRequire(...).resolve 实测通过）；
 *      (2) --install-dir 指向的是真实落盘的 node_modules → 复制 peer 依赖闭包进插件包；
 *      (3) --install-dir 位于 Electron asar 归档内 → 自带 asar 头解析，从归档的数据区
 *          把 peer 及其传递依赖的真实字节提取成插件包内的 node_modules 真实文件。
 *    这样插件自带可解析的 peer 副本，独立 node.exe（无 asar patch）也能 import；
 *    同时不再依赖任何 junction、不再依赖 test/ 目录，交付脚本可独立运行。
 *
 *  - asar 头布局（本机 app.asar 实测）：前 16 字节为 pickle 头，UInt32LE@12 是 header JSON
 *    的字节数，JSON 从 offset 16 开始，数据区起点 = 16 + headerSize；header.files 是文件树，
 *    每个文件条目 { size, offset }（offset 相对数据区起点）。
 *
 *  - 插件的 cordis.patch.yml 用 - insert: 插入一行
 *    { id: opticforge, name: '@deepseek-ai/dsh-opticforge' }，Loader 会 import 该包并调用
 *    apply(ctx) 注册两个 defineTool。
 *
 * 注意：
 *  - 安装/激活需要写用户 profile 目录，属于跨目录修改，由 lead 统一执行；
 *    本脚本不会自动运行，只在用户明确要求时执行。
 *  - DSH 正在运行时，配置变更可能需要重启 DSH 才会生效（HMR 仅对 client-plugin 有效）。
 *  - 卸载只移除本脚本创建的文件与 bundles 列表项，不动其他插件。
 *  - --dry-run 是零副作用：只读文件/只读打开 asar 头，不写任何文件。
 *  - copyDir 只复制运行时需要的文件：仓库里的 Python 缓存、探针目录、asar 运行时缓存、
 *    临时打包文件等由 SKIP_NAMES / SKIP_PREFIX / SKIP_SUFFIX 过滤，不进入安装产物（task-17）。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_SRC = path.resolve(SCRIPT_DIR, '..');
const PKG_NAME = '@deepseek-ai/dsh-opticforge';
const BUNDLE_ID = 'opticforge';
const PATCH_ROW = "- insert:\n    - id: opticforge\n      name: '@deepseek-ai/dsh-opticforge'\n";
const PEER_PKGS = ['dsh-tools', 'cordis'];
const SEED_PKGS = ['@deepseek-ai/dsh-tools', '@deepseek-ai/cordis'];

function parseArgs(argv) {
  const out = { profile: 'desktop', dryRun: false, uninstall: false, installDir: null, home: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--uninstall') out.uninstall = true;
    else if (a === '--profile') out.profile = argv[++i];
    else if (a === '--install-dir') out.installDir = argv[++i];
    else if (a === '--home') out.home = argv[++i];
    else if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

/**
 * 向上找出 installDir 对应的真实 *.asar 文件，以及它在归档内的前缀。
 * 例：D:\Deepseek\resources\app.asar\dsh -> { file: ...app.asar, prefix: 'dsh' }。
 */
function findAsarFile(installDir) {
  let cur = path.resolve(installDir);
  const inner = [];
  for (let i = 0; i < 16; i++) {
    let st = null;
    try { st = fs.statSync(cur); } catch {}
    if (st && st.isFile() && /\.asar$/i.test(cur)) {
      return { file: cur, prefix: inner.slice().reverse().join('/') };
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    inner.push(path.basename(cur));
    cur = parent;
  }
  return null;
}

/**
 * 打开 asar 归档并返回一个只读句柄，可读取 peer 包的真实字节；找不到/格式不符返回 null。
 * 句柄持有 fd，调用方必须用 try/finally 调用 handle.close()。
 */
function openAsarPeerSource(installDir) {
  const found = findAsarFile(installDir);
  if (!found) return null;
  let fd;
  try {
    fd = fs.openSync(found.file, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(12);
    if (!Number.isFinite(headerSize) || headerSize <= 0 || headerSize > 64 * 1024 * 1024) {
      fs.closeSync(fd);
      return null;
    }
    const hb = Buffer.alloc(headerSize);
    fs.readSync(fd, hb, 0, headerSize, 16);
    const header = JSON.parse(hb.toString('utf8'));
    const dataBase = 16 + headerSize + ((4 - (headerSize % 4)) % 4);

    // 在归档里定位含 @deepseek-ai/dsh-tools 的 node_modules 容器。
    const candidates = [];
    if (found.prefix) candidates.push(found.prefix.split('/').concat('node_modules'));
    candidates.push(['dsh', 'node_modules']);
    candidates.push(['node_modules']);
    let nm = null;
    for (const segs of candidates) {
      let n = header;
      for (const s of segs) { n = n && n.files ? n.files[s] : null; if (!n) break; }
      if (n && n.files && n.files['@deepseek-ai'] && n.files['@deepseek-ai'].files &&
          n.files['@deepseek-ai'].files['dsh-tools']) { nm = n.files; break; }
    }
    if (!nm) { fs.closeSync(fd); return null; }

    function nodeAt(rel) {
      let n = { files: nm };
      for (const s of rel.split('/')) {
        n = n && n.files ? n.files[s] : null;
        if (!n) return null;
      }
      return n;
    }
    function readEntry(rel) {
      const n = nodeAt(rel);
      if (!n || n.files || n.size === undefined) return null;
      // Electron 对部分文件（如原生 .node 插件）标记为 unpacked：字节不在 asar 数据区，
      // 而是落在同级的 <asar>.unpacked 目录里。此时 offset 为 undefined，必须从磁盘读取。
      if (n.unpacked || n.offset === undefined || !Number.isFinite(Number(n.offset))) {
        const unpacked = found.file.replace(/\.asar$/i, '.asar.unpacked');
        const relInArchive = found.prefix ? found.prefix + '/node_modules/' + rel : 'node_modules/' + rel;
        const disk = path.join(unpacked, ...relInArchive.split('/'));
        try { return fs.readFileSync(disk); } catch { return null; }
      }
      const b = Buffer.alloc(n.size);
      fs.readSync(fd, b, 0, n.size, dataBase + Number(n.offset));
      return b;
    }
    return {
      asarFile: found.file,
      nodeAt,
      readEntry,
      close() { try { fs.closeSync(fd); } catch {} },
    };
  } catch {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    return null;
  }
}

function findInstallDir() {
  // 本机实测路径；可用 --install-dir 覆盖
  const candidates = [
    process.env.DSH_INSTALL_DIR,
    'D:\\Deepseek\\resources\\app.asar\\dsh',
    path.join(os.homedir(), '.dsh', 'runtimes'),
  ].filter(Boolean);
  for (const c of candidates) {
    const tools = path.join(c, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js');
    if (fs.existsSync(tools)) return c;
    const a = openAsarPeerSource(c);
    if (a) { a.close(); return c; }
  }
  throw new Error('找不到 DSH 安装目录（既无真实 node_modules/@deepseek-ai/dsh-tools，也不是含该包的 Electron asar 归档）。请用 --install-dir 指定。');
}

function assertPluginSrc() {
  const must = ['package.json', 'cordis.patch.yml', 'lib/index.js'];
  for (const m of must) {
    const p = path.join(PLUGIN_SRC, m);
    if (!fs.existsSync(p)) throw new Error('插件源文件缺失: ' + p);
  }
  const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, 'package.json'), 'utf-8'));
  if (pj.name !== PKG_NAME) throw new Error('package.json name 应为 ' + PKG_NAME + '，实际 ' + pj.name);
  if (pj.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('package.json 缺少 dsh.bundle.patch');
  return pj;
}

// 安装产物只需插件运行时文件；以下仓库内的临时/缓存/探针条目一律不复制进 profile。
// 大小写不敏感（Windows 文件系统本身不区分大小写，但 Node 的 Dirent.name 保留原样）。
// - SKIP_NAMES：精确匹配的目录名或文件名
// - SKIP_PREFIX：前缀匹配（_lead_* 探针、_task13_tmp 等）
// - SKIP_SUFFIX：后缀匹配（*.pyc / *.tgz 等）
const SKIP_NAMES = new Set([
  'node_modules', '.git', '__pycache__', '_task13_tmp',
  '_lead_guard_probe', '_lead_verify2', '.asar-runtime',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'venv',
  '.ds_store', 'thumbs.db',
]);
const SKIP_PREFIX = ['_lead_', '_task13_tmp', '_of_probe', '_install_probe', '_asar_runtime'];
const SKIP_SUFFIX = ['.pyc', '.pyo', '.tgz', '.log', '.tmp', '.bak', '.orig', '.swp', '~'];

function shouldSkip(name) {
  const low = String(name).toLowerCase();
  if (SKIP_NAMES.has(low)) return true;
  if (SKIP_PREFIX.some(p => low.startsWith(p))) return true;
  if (SKIP_SUFFIX.some(s => low.endsWith(s))) return true;
  return false;
}

function copyDir(src, dst) {
  let skipped = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(e.name)) { skipped++; continue; }
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      skipped += copyDir(s, d);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
    }
    // 符号链接（含 workspace 里指向 asar 虚拟路径的坏 junction）既非目录也非文件，天然跳过。
  }
  return skipped;
}

/** 完整递归复制（含嵌套 node_modules），用于从真实落盘的 peer 目录复制闭包。 */
function copyAll(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isSymbolicLink()) {
      try {
        const st = fs.statSync(s);
        if (st.isDirectory()) copyAll(s, d);
        else if (st.isFile()) fs.copyFileSync(s, d);
      } catch {}
    } else if (e.isDirectory()) {
      copyAll(s, d);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

/** 从真实落盘的 node_modules 计算 peer 传递依赖闭包。 */
function realPeerClosure(realRoot) {
  const seen = new Set();
  const q = [...SEED_PKGS];
  while (q.length) {
    const pkg = q.shift();
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    let pj;
    try { pj = JSON.parse(fs.readFileSync(path.join(realRoot, pkg, 'package.json'), 'utf-8')); } catch { continue; }
    const deps = { ...(pj.dependencies || {}), ...(pj.peerDependencies || {}), ...(pj.optionalDependencies || {}) };
    for (const d of Object.keys(deps)) {
      if (d.startsWith('node:') || seen.has(d)) continue;
      if (fs.existsSync(path.join(realRoot, d, 'package.json'))) q.push(d);
    }
  }
  return seen;
}

/** 从 asar 头计算 peer 传递依赖闭包（只读）。 */
function asarPeerClosure(asar) {
  const seen = new Set();
  const q = [...SEED_PKGS];
  while (q.length) {
    const pkg = q.shift();
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const b = asar.readEntry(pkg + '/package.json');
    if (!b) continue;
    let pj;
    try { pj = JSON.parse(b.toString('utf8')); } catch { continue; }
    const deps = { ...(pj.dependencies || {}), ...(pj.peerDependencies || {}), ...(pj.optionalDependencies || {}) };
    for (const d of Object.keys(deps)) {
      if (d.startsWith('node:') || seen.has(d)) continue;
      const n = asar.nodeAt(d);
      if (n && n.files) q.push(d);
    }
  }
  return seen;
}

// profile 里只有种子包（dsh-tools/cordis）并不够：dsh-tools 自身还有传递依赖，
// 若闭包不全，import 会在 shared-DTdn5dXO.js 处报
// "Cannot find package '@deepseek-ai/dsh-llm'"。因此 upward 分支要求整条闭包可解析。
function profileClosureResolvable(req, profileScope) {
  for (const p of PEER_PKGS) {
    let pj;
    try { pj = JSON.parse(fs.readFileSync(path.join(profileScope, p, 'package.json'), 'utf-8')); }
    catch { return false; }
    const deps = { ...(pj.dependencies || {}), ...(pj.peerDependencies || {}), ...(pj.optionalDependencies || {}) };
    for (const d of Object.keys(deps)) {
      if (d.startsWith('node:') || PEER_PKGS.some(x => '@deepseek-ai/' + x === d)) continue;
      try { req.resolve(d); } catch { return false; }
    }
  }
  return true;
}

/** 只读判断本次安装会采用哪种 peer 提供方式。 */
function planPeers(installDir, dst, profileDir) {
  const entry = path.join(dst, 'lib', 'index.js');
  const req = createRequire(entry);
  const profileScope = path.join(profileDir, 'node_modules', '@deepseek-ai');
  const hasRealProfilePeers = PEER_PKGS.every(p => fs.existsSync(path.join(profileScope, p, 'lib', 'index.js')));
  let resolvable = true;
  for (const p of PEER_PKGS) {
    try { req.resolve('@deepseek-ai/' + p); } catch { resolvable = false; break; }
  }
  if (hasRealProfilePeers && resolvable && profileClosureResolvable(req, profileScope)) return 'upward';
  const realRoot = path.join(installDir, 'node_modules');
  if (fs.existsSync(path.join(realRoot, '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'))) return 'copy-real';
  const a = openAsarPeerSource(installDir);
  if (a) { a.close(); return 'asar-extract'; }
  return 'unavailable';
}

/**
 * 修复后的 peer 提供逻辑：不再创建任何 junction，只提供真实文件。
 * 返回 { mode, ... } 供自检报告使用。
 */
function ensurePeers(installDir, dst, profileDir) {
  const destScope = path.join(dst, 'node_modules');
  const entry = path.join(dst, 'lib', 'index.js');
  const profileScope = path.join(profileDir, 'node_modules', '@deepseek-ai');

  // 优先级 1：profile 目录已有真实 peer 副本 → 靠 Node 目录向上解析，无需任何动作。
  const hasRealProfilePeers = PEER_PKGS.every(p => fs.existsSync(path.join(profileScope, p, 'lib', 'index.js')));
  let resolvable = true;
  const req = createRequire(entry);
  for (const p of PEER_PKGS) {
    try { req.resolve('@deepseek-ai/' + p); } catch { resolvable = false; break; }
  }
  if (hasRealProfilePeers && resolvable && profileClosureResolvable(req, profileScope)) {
    console.log('  peer 已可解析：profile 目录存在真实副本且依赖闭包齐全，靠目录向上解析（未创建 junction / 未提取）');
    return { mode: 'upward' };
  }

  // 优先级 2：--install-dir 是真实落盘的 node_modules → 复制依赖闭包（真实文件）。
  const realRoot = path.join(installDir, 'node_modules');
  if (fs.existsSync(path.join(realRoot, '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'))) {
    const pkgs = realPeerClosure(realRoot);
    fs.rmSync(destScope, { recursive: true, force: true });
    fs.mkdirSync(destScope, { recursive: true });
    for (const pkg of pkgs) {
      const src = path.join(realRoot, pkg);
      const target = path.join(destScope, pkg);
      if (fs.existsSync(src)) copyAll(src, target);
    }
    const files = countFiles(destScope);
    console.log('  已复制真实 peer 闭包:', pkgs.size, '包 /', files, '文件 ->', destScope);
    return { mode: 'copy-real', packages: pkgs.size, files };
  }

  // 优先级 3：installDir 位于 Electron asar 归档内 → 自带 asar 头解析，提取真实字节。
  const asar = openAsarPeerSource(installDir);
  if (asar) {
    try {
      const pkgs = asarPeerClosure(asar);
      fs.rmSync(destScope, { recursive: true, force: true });
      fs.mkdirSync(destScope, { recursive: true });
      let files = 0;
      function copyTree(rel) {
        const n = asar.nodeAt(rel);
        if (!n || !n.files) return;
        fs.mkdirSync(path.join(destScope, rel), { recursive: true });
        for (const [name, child] of Object.entries(n.files)) {
          const childRel = rel + '/' + name;
          if (child && child.files) {
            copyTree(childRel);
          } else if (child && child.size !== undefined) {
            const b = asar.readEntry(childRel);
            if (b) {
              const dest = path.join(destScope, childRel);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.writeFileSync(dest, b);
              files++;
            }
          }
        }
      }
      for (const pkg of pkgs) copyTree(pkg);
      console.log('  已从 asar 归档提取 peer 闭包:', pkgs.size, '包 /', files, '文件 ->', destScope);
      console.log('  asar 归档:', asar.asarFile);
      return { mode: 'asar-extract', packages: pkgs.size, files, asarFile: asar.asarFile };
    } finally {
      asar.close();
    }
  }

  console.warn('  警告：既无真实 peer 副本，也找不到可用的 asar 归档；插件可能仅能在 DSH Electron 进程内（其 fs 支持 asar）加载。');
  return { mode: 'unavailable' };
}

function readManifest(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function writeManifest(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf-8'); }

/** profile package.json 不存在时（例如 --home 指向全新临时目录）给出最小骨架，保持幂等。 */
function readManifestOrInit(pjPath) {
  try { return { data: readManifest(pjPath), existed: true }; }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { data: { name: 'dsh-profile', private: true, dsh: { profile: { bundles: [] } } }, existed: false };
  }
}

function ensureBundleSelected(profileDir, dryRun) {
  const pjPath = path.join(profileDir, 'package.json');
  const { data: pj } = readManifestOrInit(pjPath);
  const bundles = pj.dsh?.profile?.bundles ?? [];
  if (!bundles.includes(PKG_NAME)) {
    if (!dryRun) {
      pj.dsh = pj.dsh ?? {};
      pj.dsh.profile = pj.dsh.profile ?? {};
      pj.dsh.profile.bundles = [...bundles, PKG_NAME];
      writeManifest(pjPath, pj);
    }
    return { changed: true, bundles: [...bundles, PKG_NAME] };
  }
  return { changed: false, bundles };
}

function ensurePatchRow(profileDir, dryRun) {
  // bundle 自带的 cordis.patch.yml 已含 insert 行，profile 用户层无需重复。
  // 但为兼容「只在 profile 层挂载」的部署，这里也提供追加能力（幂等）。
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  let text = '';
  try { text = fs.readFileSync(patchPath, 'utf-8'); } catch {}
  if (text.includes("name: '@deepseek-ai/dsh-opticforge'") || text.includes('name: "@deepseek-ai/dsh-opticforge"')) {
    return { changed: false, path: patchPath };
  }
  if (!dryRun) {
    const sep = text.length && !text.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(patchPath, text + sep + '\n# OpticForge — 由 install-local.mjs 追加\n' + PATCH_ROW, 'utf-8');
  }
  return { changed: true, path: patchPath };
}

async function verifyInstalled(profileDir) {
  const dst = path.join(profileDir, 'node_modules', '@deepseek-ai', PKG_NAME.replace('@deepseek-ai/', ''));
  const entry = path.join(dst, 'lib', 'index.js');
  if (!fs.existsSync(entry)) return { ok: false, error: '插件入口未找到: ' + entry };
  const req = createRequire(entry);
  const resolved = {};
  for (const p of PEER_PKGS) {
    try { resolved['@deepseek-ai/' + p] = req.resolve('@deepseek-ai/' + p); }
    catch (e) { resolved['@deepseek-ai/' + p] = 'UNRESOLVED: ' + (e && e.code ? e.code : String(e)); }
  }
  let mod = null;
  let importError = null;
  try {
    mod = await import(pathToFileURL(entry).href + '?t=' + Date.now());
  } catch (e) {
    importError = String(e && e.message ? e.message : e);
  }
  const keys = mod ? Object.keys(mod) : [];
  const ok = !!mod && ['name', 'inject', 'apply'].every(k => keys.includes(k)) && mod.name === 'opticforge';
  return { ok, keys, name: mod ? mod.name : null, inject: mod ? mod.inject : null, resolved, importError };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('*/')[0] + '*/');
    return;
  }
  const pj = assertPluginSrc();
  const installDir = args.installDir || findInstallDir();
  const home = args.home || path.join(os.homedir(), '.dsh');
  const profileDir = path.join(home, 'profiles', args.profile);
  const dst = path.join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-opticforge');

  console.log('插件源:', PLUGIN_SRC);
  console.log('DSH 安装目录（peer 来源，只读）:', installDir);
  console.log('目标目录（profile 第二锚点）:', dst);
  console.log('profile:', profileDir);
  console.log('版本:', pj.version, '| dry-run:', args.dryRun, '| uninstall:', args.uninstall);

  if (args.uninstall) {
    if (args.dryRun) { console.log('[dry-run] 将删除', dst, '并从 bundles 移除', PKG_NAME); return; }
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    const pjPath = path.join(profileDir, 'package.json');
    if (fs.existsSync(pjPath)) {
      const m = readManifest(pjPath);
      const b = m.dsh?.profile?.bundles ?? [];
      m.dsh.profile.bundles = b.filter(x => x !== PKG_NAME);
      writeManifest(pjPath, m);
    }
    console.log('已卸载。请重启 DSH 使剩余组合生效。');
    return;
  }

  if (args.dryRun) {
    const plan = planPeers(installDir, dst, profileDir);
    console.log('[dry-run] 将复制插件到', dst);
    console.log('[dry-run] 将跳过临时/缓存条目：__pycache__ / _task13_tmp / _lead_* / .asar-runtime / *.pyc / *.tgz / node_modules / .git 等');
    console.log('[dry-run] peer 提供方式:', plan === 'upward' ? 'profile 已有真实副本，靠目录向上解析（不建 junction / 不提取）'
      : plan === 'copy-real' ? '从真实落盘的 node_modules 复制 peer 依赖闭包（真实文件）'
      : plan === 'asar-extract' ? '自带 asar 头解析，从归档提取 peer 依赖闭包为真实文件'
      : '未找到可用 peer 来源（仅 DSH Electron 进程内可能加载）');
    console.log('[dry-run] 将确保', path.join(profileDir, 'package.json'), '的 dsh.profile.bundles 含', PKG_NAME);
    console.log('[dry-run] 将确保 profile 用户层含 opticforge insert 行（兜底）');
    console.log('[dry-run] 零副作用：未写入任何文件。');
    return;
  }

  const skipped = copyDir(PLUGIN_SRC, dst);
  console.log('已复制插件 ->', dst, '（已跳过临时/缓存条目', skipped, '个）');
  const peerResult = ensurePeers(installDir, dst, profileDir);
  const b = ensureBundleSelected(profileDir, false);
  console.log('bundles 选择:', b.changed ? '已追加' : '已存在');
  const p = ensurePatchRow(profileDir, false);
  console.log('profile patch 兜底行:', p.changed ? '已追加' : '已存在');

  verifyInstalled(profileDir).then(v => {
    console.log('\n== 安装后模块自检（独立 node.exe / 无 asar patch） ==');
    console.log('peer 提供方式:', peerResult.mode, peerResult.packages ? ('(' + peerResult.packages + ' 包 / ' + peerResult.files + ' 文件)') : '');
    console.log('createRequire().resolve():', JSON.stringify(v.resolved, null, 2));
    console.log('导出:', JSON.stringify({ keys: v.keys, name: v.name, inject: v.inject }));
    if (v.importError) console.log('import(lib/index.js) 失败:', v.importError);
    console.log('模块可加载:', v.ok ? '是' : '否');
    if (!v.ok) {
      console.log('\n提示：本机普通 node.exe 无 asar patch（existsSync(asar 内路径)===false、');
      console.log('      ERR_MODULE_NOT_FOUND），这是「仅 DSH Electron 进程内可加载」的典型证据。');
      console.log('      本脚本已把 peer 真实文件随插件一并安装；若仍失败，说明本次 peer 来源不可用');
      console.log('      （mode=' + peerResult.mode + '），请检查 --install-dir 是否指向含 dsh-tools 的 DSH 安装或 app.asar。');
    }
    console.log('\n完成。请重启 DSH（本会话需重启后新插件才会出现在工具列表）。');
    console.log('重启后可在会话中调用 opticforge_search / opticforge_calc 验证。');
    if (!v.ok) process.exitCode = 1;
  });
}

try { main(); } catch (e) { console.error('安装失败:', e.message); process.exitCode = 1; }
