#!/usr/bin/env node
// install-local.mjs —— 把本插件以 link: 方式装进 DSH profile（个人本机安装 / 开发热更新）
//
// 用法（在插件目录或任意 cwd 均可）：
//   node scripts/install-local.mjs             安装：写 profile 依赖 + bundles + 建目录链接
//   node scripts/install-local.mjs --dry-run   只打印将要做的事，不写任何文件
//   node scripts/install-local.mjs --uninstall 卸载：只移除本插件相关项，不动其它插件
//   node scripts/install-local.mjs --profile "C:\Users\X\.dsh\profiles\desktop"
//
// 为什么这么简单：插件不 import 任何 @deepseek-ai 包（直接原生 JSON Schema 注册），
// 所以不需要从 app.asar 抽取 peer 依赖闭包，也不需要 pnpm/npm 重新装一遍。
// 只要 profile 的 package.json 里有 link: 依赖、bundles 列表里有这个名字、
// node_modules 里有指回本仓库的目录链接，DSH 重启后就会加载。
//
// 已核对的加载约定（DSH 0.2.2-rc.1）：
//   - profile 的 package.json 里 dsh.profile.bundles 是有序组合包列表；
//   - 每个 bundle 的 package.json 必须声明 dsh.bundle.patch = ./cordis.patch.yml；
//   - bundle 名先按 DSH 安装目录解析，再按 profile 目录解析（所以放在 profile node_modules 即可）。
//
// 安全边界：只改 profile 的 package.json（写前留 .bak-时间戳 备份）和一条目录链接；
// 卸载只删本插件相关项，不触碰其它插件、不删仓库文件。

import { readFile, writeFile, rename, symlink, lstat, unlink, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "dsh-opticforge";
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, "..");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const DRY = has("--dry-run");
const UNINSTALL = has("--uninstall");
const PROFILE = resolve(opt("--profile", join(homedir(), ".dsh", "profiles", "desktop")));
const PKG_PATH = join(PROFILE, "package.json");
const LINK_PATH = join(PROFILE, "node_modules", PLUGIN_NAME);

const log = (msg) => console.log((DRY ? "[dry-run] " : "") + msg);

async function readPkg() {
  if (!existsSync(PKG_PATH)) throw new Error("profile 不存在或缺少 package.json：" + PKG_PATH);
  return JSON.parse(await readFile(PKG_PATH, "utf8"));
}

async function writePkg(pkg) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const bak = PKG_PATH + ".bak-" + stamp;
  await writeFile(bak, await readFile(PKG_PATH, "utf8"), "utf8");
  const tmp = PKG_PATH + ".tmp-" + process.pid;
  await writeFile(tmp, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  await rename(tmp, PKG_PATH);
  log("已更新 " + PKG_PATH + "（备份 " + bak + "）");
}

async function makeLink() {
  let exists = false;
  try {
    const st = await lstat(LINK_PATH);
    exists = st.isSymbolicLink() || st.isDirectory();
  } catch {
    exists = false;
  }
  if (exists) return log("目录链接已存在，跳过：" + LINK_PATH);
  if (DRY) return log("将创建目录链接 " + LINK_PATH + " → " + PLUGIN_DIR);
  await symlink(PLUGIN_DIR, LINK_PATH, "junction");
  log("已创建目录链接 " + LINK_PATH + " → " + PLUGIN_DIR);
}

async function removeLink() {
  if (!existsSync(LINK_PATH)) return log("目录链接不存在，跳过");
  if (DRY) return log("将删除目录链接 " + LINK_PATH);
  await unlink(LINK_PATH);
  log("已删除目录链接 " + LINK_PATH);
}

async function main() {
  await access(join(PLUGIN_DIR, "package.json")).catch(() => {
    throw new Error("插件目录异常（缺少 package.json）：" + PLUGIN_DIR);
  });

  const pkg = await readPkg();
  pkg.dependencies = pkg.dependencies || {};
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [];

  if (UNINSTALL) {
    const had = PLUGIN_NAME in pkg.dependencies || pkg.dsh.profile.bundles.includes(PLUGIN_NAME);
    if (!had) {
      log("profile 里没有 " + PLUGIN_NAME + "，无需卸载");
    } else {
      delete pkg.dependencies[PLUGIN_NAME];
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== PLUGIN_NAME);
      if (DRY) log("将从依赖与 bundles 中移除 " + PLUGIN_NAME);
      else await writePkg(pkg);
    }
    await removeLink();
    log("");
    log("卸载完成。重启 DSH 生效；仓库文件未改动。");
    return;
  }

  const value = "link:" + PLUGIN_DIR.replace(/\\/g, "/");
  if (pkg.dependencies[PLUGIN_NAME] !== value) {
    pkg.dependencies[PLUGIN_NAME] = value;
    log("依赖：" + PLUGIN_NAME + " = " + value);
  } else {
    log("依赖已是目标值，跳过");
  }
  if (!pkg.dsh.profile.bundles.includes(PLUGIN_NAME)) {
    pkg.dsh.profile.bundles.push(PLUGIN_NAME);
    log("bundles：已追加 " + PLUGIN_NAME + "（共 " + pkg.dsh.profile.bundles.length + " 项）");
  } else {
    log("bundles 已包含该插件，跳过");
  }
  if (DRY) {
    log("将写回 package.json");
  } else {
    await writePkg(pkg);
  }
  await makeLink();

  log("");
  log("完成。重启 DSH 后生效，然后用 opticforge_search / opticforge_calc 验证。");
  log("以后升级：直接改这个仓库（数据、代码），重启 DSH 就加载最新版本。");
}

main().catch((e) => {
  console.error("ERROR " + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
