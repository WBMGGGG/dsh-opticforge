// test/_asar_loader.mjs —— 把 DSH 安装目录 asar 内的 @deepseek-ai/dsh-tools 及其依赖抽取到临时缓存，
// 并通过 Node ESM loader hook 让 lib/index.js 的裸导入 "@deepseek-ai/dsh-tools" 能被解析。
// 全程只读 asar、只写 test/.asar-runtime/ 缓存；不修改任何源码文件。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// DSH 安装目录 asar（Electron 归档）。可用 DSH_ASAR 环境变量覆盖到其他安装位置。
const ASAR = process.env.DSH_ASAR || "D:/Deepseek/resources/app.asar";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, ".asar-runtime");
const LOADER = path.join(CACHE, "loader.mjs");
// 只需这些包的传递闭包即可加载 defineTool（均来自 asar 的 node_modules）。
const SEED_PKGS = [
  "@deepseek-ai/dsh-tools", "@deepseek-ai/cordis", "@deepseek-ai/cosmokit",
  "@deepseek-ai/dsh-scope", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-util-values",
  "@deepseek-ai/dsh-util-crypto", "@deepseek-ai/dsh-brand", "@deepseek-ai/dsh-timeout",
  "@deepseek-ai/dsh-typert-protocol", "@deepseek-ai/schemastery", "@standard-schema/spec", "zod"
];

function nodeAt(root, rel) {
  let n = { files: root };
  for (const part of rel.split("/")) {
    n = (n.files && n.files[part]) || n[part];
    if (!n) return null;
  }
  return n.files || n;
}

export function ensureRuntime() {
  if (!fs.existsSync(ASAR)) {
    throw new Error("找不到 DSH 安装归档 app.asar: " + ASAR + "；可设置环境变量 DSH_ASAR 指向实际路径");
  }
  // ---- 目录模式（新版 DSH：app.asar 已是真实落盘目录，不再需要解析归档头） ----
  if (fs.statSync(ASAR).isDirectory()) {
    const nmRoot = path.join(ASAR, "dsh", "node_modules");
    fs.mkdirSync(CACHE, { recursive: true });
    let copied = 0;
    function copyDirReal(rel) {
      const srcDir = path.join(nmRoot, rel);
      if (!fs.existsSync(srcDir)) return 0;
      let n = 0;
      fs.cpSync(srcDir, path.join(CACHE, rel), { recursive: true, force: true });
      n = 1; // 目录计数
      return n;
    }
    for (const pkg of SEED_PKGS) copied += copyDirReal(pkg);
    // 生成 loader.mjs：把裸 specifier 重定向到 CACHE 下真实文件
    const loaderSrc = [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { pathToFileURL } from "node:url";',
      'const CACHE = ' + JSON.stringify(CACHE) + ';',
      'let map = null;',
      'function loadMap() {',
      '  if (map) return map;',
      '  map = {};',
      '  function walk(d, rel) {',
      '    let entries;',
      '    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }',
      '    for (const e of entries) {',
      '      const full = path.join(d, e.name);',
      '      const r = rel ? rel + "/" + e.name : e.name;',
      '      if (e.isDirectory()) walk(full, r);',
      '      else if (e.name === "package.json") {',
      '        try { const pj = JSON.parse(fs.readFileSync(full, "utf8"));',
      '          if (pj.name) map[pj.name] = pathToFileURL(path.dirname(full) + path.sep).href; } catch {}',
      '      }',
      '    }',
      '  }',
      '  walk(CACHE, "");',
      '  return map;',
      '}',
      'export async function resolve(specifier, context, next) {',
      '  if (specifier.startsWith(".") || specifier.startsWith("node:") || path.isAbsolute(specifier)) return next(specifier, context);',
      '  const m = loadMap();',
      '  const base = m[specifier];',
      '  if (base) {',
      '    try { return next(new URL(specifier + "/package.json", base).href, context); } catch {}',
      '    try { return next(new URL(specifier, base).href, context); } catch {}',
      '  }',
      '  return next(specifier, context);',
      '}',
    ].join("\n");
    fs.writeFileSync(LOADER, loaderSrc, "utf8");
    return { cacheDir: CACHE, loaderPath: LOADER, copied, deps: SEED_PKGS.length, mode: "dir" };
  }
  const fd = fs.openSync(ASAR, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(12);
    const headerBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, headerBuf, 0, headerSize, 16);
    const header = JSON.parse(headerBuf.toString("utf8"));
    const dataBase = 16 + headerSize + ((4 - (headerSize % 4)) % 4); // rc.3+: header 后有对齐 padding
    const root = header.files.dsh.files.node_modules.files;
    fs.mkdirSync(CACHE, { recursive: true });

    function copyEntry(rel) {
      const e = nodeAt(root, rel);
      if (!e || e.size === undefined) return false;
      const dest = path.join(CACHE, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const buf = Buffer.alloc(e.size);
      fs.readSync(fd, buf, 0, e.size, dataBase + Number(e.offset));
      fs.writeFileSync(dest, buf);
      return true;
    }
    function copyTree(rel) {
      const n = nodeAt(root, rel);
      if (!n) return 0;
      let count = 0;
      for (const [name, child] of Object.entries(n)) {
        const childRel = rel + "/" + name;
        if (child && child.files) count += copyTree(childRel);
        else if (child && child.size !== undefined && copyEntry(childRel)) count++;
      }
      return count;
    }

    // 第一遍：抽取种子包，便于读取 package.json 计算依赖闭包
    let copied = 0;
    for (const pkg of SEED_PKGS) copied += copyTree(pkg);
    const depSet = new Set(SEED_PKGS);
    // 迭代补齐依赖闭包（最多 8 轮，避免异常数据导致死循环）
    for (let round = 0; round < 8; round++) {
      const before = depSet.size;
      for (const name of [...depSet]) {
        const pjPath = path.join(CACHE, name, "package.json");
        if (!fs.existsSync(pjPath)) continue;
        let pj;
        try { pj = JSON.parse(fs.readFileSync(pjPath, "utf8")); } catch { continue; }
        const deps = Object.assign({}, pj.dependencies || {}, pj.peerDependencies || {});
        for (const d of Object.keys(deps)) {
          if (d.startsWith("node:") || depSet.has(d)) continue;
          if (nodeAt(root, d)) depSet.add(d);
        }
      }
      if (depSet.size === before) break;
    }
    // 第二遍：抽取闭包中尚未抽取的包
    for (const pkg of depSet) copied += copyTree(pkg);

    // 生成 loader.mjs（用 RegExp 构造器避开源码里写正则字面量导致的转义问题）
    const NL = String.fromCharCode(10);
    const lines = [
      'import { pathToFileURL } from "node:url";',
      'import fs from "node:fs";',
      'const NM = ' + JSON.stringify(CACHE) + ';',
      'export async function resolve(specifier, context, nextResolve) {',
      '  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:") && !specifier.startsWith("data:") && !specifier.startsWith("file:")) {',
      '    const parts = specifier.split("/");',
      '    const pkg = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];',
      '    const sub = specifier.slice(pkg.length).replace(new RegExp(String.fromCharCode(94) + String.fromCharCode(92) + "/"), "");',
      '    const pjPath = NM + "/" + pkg + "/package.json";',
      '    if (fs.existsSync(pjPath)) {',
      '      const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));',
      '      let rel = null;',
      '      if (sub) {',
      '        const exp = pj.exports && pj.exports["." + "/" + sub];',
      '        rel = typeof exp === "string" ? exp : (exp && (exp.import || exp.default || exp.require)) || sub;',
      '      } else {',
      '        const exp = pj.exports && pj.exports["."];',
      '        rel = exp ? (typeof exp === "string" ? exp : (exp.import || exp.default || exp.require || pj.main)) : (pj.main || "index.js");',
      '      }',
      '      if (rel) {',
      '        rel = rel.replace(new RegExp(String.fromCharCode(94) + String.fromCharCode(92) + "." + String.fromCharCode(92) + "/"), "");',
      '        const full = NM + "/" + pkg + "/" + rel;',
      '        if (fs.existsSync(full)) return { url: pathToFileURL(full).href, shortCircuit: true };',
      '        if (fs.existsSync(full + ".js")) return { url: pathToFileURL(full + ".js").href, shortCircuit: true };',
      '        if (fs.existsSync(full + "/index.js")) return { url: pathToFileURL(full + "/index.js").href, shortCircuit: true };',
      '      }',
      '    }',
      '  }',
      '  return nextResolve(specifier, context);',
      '}',
    ];
    fs.writeFileSync(LOADER, lines.join(NL) + NL);
    return { cacheDir: CACHE, loaderPath: LOADER, copied, deps: depSet.size };
  } finally {
    fs.closeSync(fd);
  }
}

export { CACHE, LOADER };
