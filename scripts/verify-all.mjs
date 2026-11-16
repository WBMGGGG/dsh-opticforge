#!/usr/bin/env node
// verify-all.mjs —— 发布前全量验收（只读，不改任何文件）
//
// 跑法：node scripts/verify-all.mjs
//
// 六组检查：
//   A. package.json 发布契约（包名、files、dsh.bundle.patch、无宿主依赖）
//   B. 源码不 import 任何 @deepseek-ai 包（否则 link 安装会解析失败）
//   C. 知识库产物一致性（build-kb --check）
//   D. 集成测试（test/run.mjs）
//   E. 打包清单（npm pack --dry-run），确认该发的都发、不该发的一个都没发
//   F. 版本一致（package.json version == kb-meta.kb_version）
//
// 任何一项失败即整体失败（exit 1），不做「警告后继续」。

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const checks = [];

function ok(name) {
  checks.push(name);
  console.log("  ok   " + name);
}
function bad(name, detail) {
  failures.push(name + "：" + detail);
  console.log("  FAIL " + name + "：" + detail);
}
function assert(name, cond, detail) {
  if (cond) ok(name);
  else bad(name, detail);
}

function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

async function main() {
  console.log("== A. package.json 发布契约 ==");
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert("包名为 dsh-opticforge", pkg.name === "dsh-opticforge", "实际 " + pkg.name);
  assert("版本号是合法 semver", /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version || ""), "实际 " + pkg.version);
  assert("type=module", pkg.type === "module", "实际 " + pkg.type);
  assert("main 指向 lib/index.js", pkg.main === "lib/index.js", "实际 " + pkg.main);
  assert("files 含 lib/", (pkg.files || []).includes("lib/"), "files=" + JSON.stringify(pkg.files));
  assert("files 含 data/", (pkg.files || []).includes("data/"), "files=" + JSON.stringify(pkg.files));
  assert("files 含 cordis.patch.yml", (pkg.files || []).includes("cordis.patch.yml"), "files=" + JSON.stringify(pkg.files));
  assert("声明 dsh.bundle.patch", pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "实际 " + JSON.stringify(pkg.dsh));
  assert("无 peerDependencies", !pkg.peerDependencies || Object.keys(pkg.peerDependencies).length === 0, JSON.stringify(pkg.peerDependencies));
  assert("无运行时 dependencies", !pkg.dependencies || Object.keys(pkg.dependencies).length === 0, JSON.stringify(pkg.dependencies));
  assert("有 repository 指向本仓库", String(pkg.repository?.url || "").includes("dsh-opticforge"), String(pkg.repository?.url));
  assert("有 engines.node", typeof pkg.engines?.node === "string", JSON.stringify(pkg.engines));

  console.log("== B. 源码不依赖宿主包 ==");
  const libFiles = (await readdir(path.join(ROOT, "lib"))).filter((f) => f.endsWith(".js"));
  let hostImports = 0;
  for (const f of libFiles) {
    const src = await readFile(path.join(ROOT, "lib", f), "utf8");
    const hits = src.match(/@deepseek-ai\//g);
    if (hits) {
      hostImports += hits.length;
      bad("lib/" + f + " 不含宿主包引用", "命中 " + hits.length + " 处 @deepseek-ai/");
    }
  }
  assert("lib/ 全部文件零宿主包引用", hostImports === 0, hostImports + " 处引用");
  assert("lib/index.js 存在", existsSync(path.join(ROOT, "lib", "index.js")), "缺失");

  console.log("== C. 知识库产物一致性 ==");
  const kb = runNode([path.join(ROOT, "scripts", "build-kb.mjs"), "--check"]);
  assert("build-kb --check 通过", kb.code === 0, kb.out.trim().split("\n").slice(-3).join(" | "));

  console.log("== D. 集成测试 ==");
  const t = runNode([path.join(ROOT, "test", "run.mjs")]);
  const pass = /\n# pass (\d+)/.exec(t.out);
  assert("test/run.mjs 全部通过", t.code === 0 && pass, (pass ? "pass=" + pass[1] : "") + (t.code === 0 ? "" : " exit=" + t.code));
  if (pass) console.log("       " + pass[1] + " 个用例通过");

  console.log("== E. 打包清单 ==");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const pack = spawnSync(npmCmd, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  let files = [];
  try {
    const j = JSON.parse(pack.stdout || "[]");
    files = (j[0]?.files || []).map((f) => f.path);
  } catch {
    bad("npm pack 可解析", (pack.stderr || pack.stdout || "无输出").slice(0, 200));
  }
  const mustHave = ["lib/index.js", "lib/kb-data.js", "lib/kb-engine.js", "data/kb-data.json", "data/kb-meta.json", "cordis.patch.yml", "package.json", "README.md", "LICENSE"];
  for (const f of mustHave) assert("打包含 " + f, files.includes(f), "实际清单：" + files.join(", "));
  const mustNot = files.filter((f) => f.startsWith("_kb-raw/") || f.startsWith("test/") || f.startsWith("scripts/") || f.includes("HANDOVER"));
  assert("打包不含私有/内部文件", mustNot.length === 0, mustNot.join(", "));
  // 34 个板块文件 + lib + data + 契约文档，上限随板块增长而放宽
  assert("打包文件数在 8–120 之间", files.length >= 8 && files.length <= 120, "实际 " + files.length + " 个");

  console.log("== F. 版本一致 ==");
  const meta = JSON.parse(await readFile(path.join(ROOT, "data", "kb-meta.json"), "utf8"));
  assert("package.json 与 kb_version 一致", pkg.version === meta.kb_version, "pkg=" + pkg.version + " kb=" + meta.kb_version);

  console.log("");
  if (failures.length) {
    console.error("FAIL  共 " + failures.length + " 项未通过：");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("OK  " + checks.length + " 项检查全部通过");
}

main().catch((e) => {
  console.error("ERROR " + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
