#!/usr/bin/env node
// verify-all.mjs —— 发布前全量验收（只读，不改任何文件）
//
// 跑法：node scripts/verify-all.mjs
//
// 七组检查：
//   A. package.json 发布契约（包名、files、dsh.bundle.patch、无宿主依赖）
//   B. 源码不 import 任何 @deepseek-ai 包（否则 link 安装会解析失败）
//   C. 知识库产物一致性（build-kb --check）
//   D. 集成测试（test/run.mjs）
//   E. 打包清单（npm pack --dry-run），确认该发的都发、不该发的一个都没发
//   F. 版本一致（package.json version == kb-meta.kb_version）
//   G. 公式卡、Skill、KB-first 评测与安装 dry-run
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
  assert("files 含 skills/", (pkg.files || []).includes("skills/"), "files=" + JSON.stringify(pkg.files));
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
  for (const file of ["assist-contract.test.mjs", "entry-contract.test.mjs"]) {
    const r = runNode([path.join(ROOT, "test", file)]);
    const p = /\n# pass (\d+)/.exec(r.out);
    assert(file + " 全部通过", r.code === 0 && p, (p ? "pass=" + p[1] : "") + (r.code === 0 ? "" : " exit=" + r.code));
    if (p) console.log("       " + file + "：" + p[1] + " 个用例通过");
  }

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
  const mustHave = ["lib/index.js", "lib/kb-data.js", "lib/kb-engine.js", "lib/assist.js", "lib/capabilities.js", "lib/verify.js", "data/kb-data.json", "data/kb-meta.json", "data/assist-playbooks.json", "data/concept-cards.json", "data/cross-dimensions.json", "data/formula-cards.json", "skills/opticforge-task/SKILL.md", "cordis.patch.yml", "package.json", "README.md", "LICENSE"];
  for (const f of mustHave) assert("打包含 " + f, files.includes(f), "实际清单：" + files.join(", "));
  const mustNot = files.filter((f) => f.startsWith("_kb-raw/") || f.startsWith("test/") || f.startsWith("scripts/") || f.includes("HANDOVER"));
  assert("打包不含私有/内部文件", mustNot.length === 0, mustNot.join(", "));
  // 34 个板块文件 + lib + data + 契约文档，上限随板块增长而放宽
  assert("打包文件数在 8–120 之间", files.length >= 8 && files.length <= 120, "实际 " + files.length + " 个");

  console.log("== F. 版本一致 ==");
  const meta = JSON.parse(await readFile(path.join(ROOT, "data", "kb-meta.json"), "utf8"));
  assert("package.json 与 kb_version 一致", pkg.version === meta.kb_version, "pkg=" + pkg.version + " kb=" + meta.kb_version);

  console.log("== G. 公式卡、Skill、评测与安装契约 ==");
  const cards = JSON.parse(await readFile(path.join(ROOT, "data", "formula-cards.json"), "utf8"));
  const chunks = JSON.parse(await readFile(path.join(ROOT, "data", "kb-data.json"), "utf8"));
  const byId = new Map(chunks.map((c) => [c.chunk_id, c]));
  assert("公式卡共 19 张且 id 唯一", Array.isArray(cards) && cards.length === 19 && new Set(cards.map((c) => c.id)).size === 19, "实际 " + (Array.isArray(cards) ? cards.length : "非数组"));
  let cardFields = true;
  let cardSources = true;
  for (const c of cards) {
    if (!(c.id && c.title && c.formula && Array.isArray(c.variables) && c.variables.length && Array.isArray(c.assumptions) && c.assumptions.length && c.sanity_range && c.worked_example)) cardFields = false;
    for (const id of c.source_chunk_ids || []) if (byId.get(id)?.status !== "present") cardSources = false;
  }
  assert("公式卡字段完整", cardFields, "缺 formula/variables/assumptions/sanity_range/worked_example");
  assert("公式卡来源全部为 present", cardSources, "存在无效 source_chunk_ids");
  const skill = await readFile(path.join(ROOT, "skills", "opticforge-task", "SKILL.md"), "utf8");
  assert("Skill frontmatter 与工作流完整", /^---\nname: opticforge-task\ndescription: /.test(skill) && skill.includes("opticforge_assist") && skill.includes("web_gate") && skill.includes("opticforge_verify") && !skill.includes("TODO"), "检查 name/description/assist/web_gate/verify/TODO");
  const evalRun = runNode([path.join(ROOT, "eval", "run-kb-first.mjs")]);
  assert("13 类 KB-first 契约评测通过", evalRun.code === 0, evalRun.out.trim().split("\n").slice(-5).join(" | "));
  const installDry = runNode([path.join(ROOT, "scripts", "install-local.mjs"), "--dry-run"]);
  assert("安装器 dry-run 通过且包含 Skill 链接", installDry.code === 0 && installDry.out.includes("Skill"), installDry.out.trim().split("\n").slice(-4).join(" | "));

  console.log("== H. 交叉数据层 ==");
  const concept = JSON.parse(await readFile(path.join(ROOT, "data", "concept-cards.json"), "utf8"));
  assert("概念卡一块一卡（数量=present 块数）", concept.card_count === concept.cards.length && concept.cards.length === meta.present_chunks,
    "card_count=" + concept.card_count + " cards=" + concept.cards.length + " present=" + meta.present_chunks);
  assert("概念卡 kb_version 与包版本一致", concept.kb_version === pkg.version, "concept=" + concept.kb_version + " pkg=" + pkg.version);
  assert("概念卡 id 唯一", new Set(concept.cards.map((c) => c.id)).size === concept.cards.length, "存在重复 id");
  let conceptBadSource = 0;
  let conceptBadApplies = 0;
  let conceptTooShort = 0;
  for (const c of concept.cards) {
    if (!Array.isArray(c.source_chunk_ids) || !c.source_chunk_ids.length || c.source_chunk_ids.some((id) => byId.get(id)?.status !== "present")) conceptBadSource += 1;
    if (!Array.isArray(c.applies_to) || c.applies_to.length === 0) conceptBadApplies += 1;
    if (String(c.statement || "").length < 30) conceptTooShort += 1;
  }
  assert("概念卡来源全部为 present", conceptBadSource === 0, conceptBadSource + " 张来源无效");
  assert("概念卡 applies_to 非空", conceptBadApplies === 0, conceptBadApplies + " 张缺 applies_to");
  assert("概念卡正文不短于 30 字", conceptTooShort === 0, conceptTooShort + " 张过短");

  const crossDims = JSON.parse(await readFile(path.join(ROOT, "data", "cross-dimensions.json"), "utf8"));
  const dimIds = (crossDims.dimensions || crossDims.cross_dimensions || []).map((d) => d.id);
  assert("通用维度模板 6 个", dimIds.length === 6, "实际 " + dimIds.length);
  assert("通用维度 id 不重复", new Set(dimIds).size === dimIds.length, "存在重复 id");

  const playbooks = JSON.parse(await readFile(path.join(ROOT, "data", "assist-playbooks.json"), "utf8"));
  assert("主题卡 16 张且 version=3", playbooks.version === 3 && playbooks.playbooks.length === 16, "version=" + playbooks.version + " n=" + playbooks.playbooks.length);
  let pbIssues = [];
  let dimDeclarations = 0;
  for (const pb of playbooks.playbooks) {
    const ids = new Set((pb.required_dimensions || []).map((d) => d.id));
    dimDeclarations += ids.size;
    if (!ids.size) pbIssues.push(pb.id + " 缺 required_dimensions");
    if (!Array.isArray(pb.cross_check) || pb.cross_check.length === 0) pbIssues.push(pb.id + " 缺 cross_check");
    for (const r of pb.relations || []) {
      if (!ids.has(r.from) || !ids.has(r.to)) pbIssues.push(pb.id + " 关系端点不存在：" + r.from + "->" + r.to);
    }
    for (const s of pb.steps || []) {
      if (!s.dimension_id || !ids.has(s.dimension_id)) pbIssues.push(pb.id + " 步骤 " + (s.phase || "?") + " 的 dimension_id 无效");
    }
  }
  assert("主题卡维度声明 ≥96 条", dimDeclarations >= 96, "实际 " + dimDeclarations);
  assert("主题卡维度/关系/步骤闭合", pbIssues.length === 0, pbIssues.slice(0, 5).join("；"));

  const indexMod = await import(new URL("../lib/index.js", import.meta.url).href);
  const registered = [];
  indexMod.apply({ tools: { register(t) { registered.push(t); } } });
  const assistTool = registered.find((t) => t.name === "opticforge_assist");
  const echo = assistTool ? await assistTool.execute({ problem: "共焦位移传感器选型" }, {}) : null;
  assert("assist 工具回显版本与 package.json 一致", echo?.ok === true && echo.kb_version === pkg.version,
    "echo=" + (echo?.kb_version || echo?.error || "no-tool") + " pkg=" + pkg.version);

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
