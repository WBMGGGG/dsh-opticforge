// capabilities.js —— 本机能力与素材盘点（只读，不联网）
//
// 目的：让 opticforge_assist 给出的步骤不是空话，而是能落到具体 Skill / MCP /
// 本地文件。扫描范围有上限，失败一律降级为空列表并写 note，不阻断任务。

import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

/** 默认 Skill 根目录：DSH / 豆包 / 通用 agents 三条常见路径。 */
export function defaultSkillRoots() {
  return uniq([
    process.env.OPTICFORGE_SKILL_ROOTS || "",
    path.join(HOME, ".dsh", "skills"),
    path.join(HOME, ".agents", "skills"),
    path.join(HOME, "Doubao", "skills"),
    path.join(HOME, "AppData", "Local", "Doubao", "User Data", "Default", ".doubao", "agent_mode", "workspace", ".skills"),
    path.join(HOME, "AppData", "Local", "Doubao", "User Data", "Default", ".doubao", "agent_mode", "workspace", ".user_skills")
  ].flatMap((s) => (typeof s === "string" && s.includes(";") ? s.split(";") : [s])).map((s) => String(s || "").trim()).filter(Boolean));
}

function parseFrontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/** 在根目录下找 SKILL.md（深度 ≤ 3），返回 name/description/path。 */
export async function discoverSkills(options = {}) {
  const roots = Array.isArray(options.roots) && options.roots.length ? options.roots : defaultSkillRoots();
  const workspace = typeof options.workspace === "string" && options.workspace.trim() ? path.resolve(options.workspace.trim()) : "";
  if (workspace) roots.push(path.join(workspace, ".skills"));
  const limit = Math.max(1, Math.min(300, Number(options.limit) || 150));
  const found = [];
  const seen = new Set();
  const seenDirs = new Set();
  const notes = [];

  async function walk(dir, depth) {
    if (found.length >= limit || depth > 3) return;
    try {
      const canonical = await realpath(dir);
      if (seenDirs.has(canonical)) return;
      seenDirs.add(canonical);
    } catch {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const skillFile = entries.find((e) => e.isFile() && e.name.toLowerCase() === "skill.md");
    if (skillFile) {
      const file = path.join(dir, skillFile.name);
      if (!seen.has(file)) {
        seen.add(file);
        try {
          const text = (await readFile(file, "utf8")).slice(0, 4000);
          const fm = parseFrontmatter(text);
          const fallbackName = path.basename(dir);
          const desc = (fm.description || "").replace(/\s+/g, " ").slice(0, 180);
          found.push({ name: fm.name || fallbackName, description: desc, path: file, root: dir });
        } catch {
          /* 单个 Skill 不可读不影响其余 */
        }
      }
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) {
        try { isDir = (await stat(full)).isDirectory(); } catch { isDir = false; }
      }
      if (!isDir) continue;
      await walk(full, depth + 1);
    }
  }

  for (const root of roots) {
    if (!root || !existsSync(root)) {
      notes.push("未找到 Skill 根目录：" + root);
      continue;
    }
    await walk(path.resolve(root), 0);
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return { skills: found, roots, notes, truncated: found.length >= limit };
}

/** 扫描常见 MCP 配置文件，只取服务器名，不读凭据内容。 */
export async function discoverMcp(options = {}) {
  const workspace = typeof options.workspace === "string" && options.workspace.trim() ? path.resolve(options.workspace.trim()) : "";
  const candidates = uniq([
    path.join(HOME, ".dsh", ".mcp.json"),
    path.join(HOME, ".dsh", "mcp.json"),
    path.join(HOME, ".dsh", "profiles", "desktop", ".mcp.json"),
    path.join(HOME, ".dsh", "profiles", "desktop", "mcp.json"),
    path.join(HOME, ".cursor", "mcp.json"),
    workspace ? path.join(workspace, ".mcp.json") : ""
  ]);
  const servers = new Set();
  const notes = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const j = JSON.parse(await readFile(file, "utf8"));
      const groups = [j.mcpServers, j.mcp, j.servers, j["mcp-servers"]];
      for (const g of groups) {
        if (g && typeof g === "object" && !Array.isArray(g)) {
          for (const name of Object.keys(g)) servers.add(name);
        }
      }
    } catch {
      notes.push("MCP 配置解析失败：" + file);
    }
  }
  return { mcp_servers: [...servers].sort(), notes };
}

const KIND_BY_EXT = {
  ".csv": "数据", ".xlsx": "表格", ".xls": "表格", ".json": "数据", ".txt": "文本", ".md": "文档",
  ".pdf": "文档", ".docx": "文档", ".doc": "文档", ".pptx": "演示", ".ppt": "演示",
  ".png": "图像", ".jpg": "图像", ".jpeg": "图像", ".tif": "图像", ".tiff": "图像", ".bmp": "图像",
  ".step": "三维模型", ".stp": "三维模型", ".igs": "三维模型", ".iges": "三维模型",
  ".sldprt": "三维模型", ".sldasm": "三维模型", ".zmx": "光学设计", ".seq": "光学设计",
  ".py": "代码", ".m": "代码", ".js": "代码", ".mjs": "代码", ".cpp": "代码", ".h": "代码",
  ".yaml": "配置", ".yml": "配置", ".ini": "配置", ".log": "日志"
};

function kindOf(ext) {
  return KIND_BY_EXT[ext.toLowerCase()] || "其他";
}

function relevanceOf(name, keywords) {
  const lower = name.toLowerCase();
  let hit = 0;
  for (const k of keywords) {
    const t = String(k || "").toLowerCase().trim();
    if (t.length >= 2 && lower.includes(t)) hit += 1;
  }
  return hit;
}

/** 盘点工作目录：只列文件名/大小/类型，不读内容。 */
export async function scanWorkspace(workspace, keywords = [], options = {}) {
  const root = typeof workspace === "string" && workspace.trim() ? path.resolve(workspace.trim()) : "";
  if (!root) return { workspace: "", files: [], notes: ["未提供 workspace，跳过本地素材扫描"] };
  if (!existsSync(root)) return { workspace: root, files: [], notes: ["工作目录不存在：" + root] };
  const maxFiles = Math.max(10, Math.min(500, Number(options.maxFiles) || 240));
  const maxDepth = Math.max(0, Math.min(4, Number(options.maxDepth) ?? 2));
  const files = [];
  const notes = [];
  const skip = new Set(["node_modules", ".git", ".dsh", "__pycache__", ".venv", "dist", "build"]);

  async function walk(dir, depth) {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      notes.push("目录不可读：" + dir);
      return;
    }
    for (const e of entries) {
      if (files.length >= maxFiles) break;
      if (e.name.startsWith(".") || skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name);
      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        /* 大小读不到不影响列出 */
      }
      files.push({
        path: full,
        name: e.name,
        ext: ext.toLowerCase(),
        kind: kindOf(ext),
        size_bytes: size,
        relevance: relevanceOf(e.name, keywords)
      });
    }
  }
  await walk(root, 0);
  files.sort((a, b) => (b.relevance - a.relevance) || a.name.localeCompare(b.name));
  return {
    workspace: root,
    scanned: files.length,
    truncated: files.length >= maxFiles,
    files: files.slice(0, 40),
    notes
  };
}

/** 把用户提供的 known_capabilities 合并进发现结果（声明项排在最前，已发现的同名前移）。 */
export function mergeKnownCapabilities(discovered, known) {
  const skills = Array.isArray(discovered?.skills) ? discovered.skills.slice() : [];
  const declaredNames = [...new Set((Array.isArray(known) ? known : []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (declaredNames.length === 0) return { ...discovered, skills };
  const byName = new Map(skills.map((s) => [s.name, s]));
  const declared = declaredNames.map((name) => byName.get(name) || {
    name,
    description: "由调用方声明为当前会话可用",
    path: "",
    root: ""
  });
  const rest = skills.filter((s) => !declaredNames.includes(s.name));
  return { ...discovered, skills: [...declared, ...rest] };
}
