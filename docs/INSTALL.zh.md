# OpticForge 安装与激活说明（中文）

> 本文件说明如何把插件安装到本机 DSH 并在真实会话里启用。
> 插件源码位于 \`D:\\AI\\DeepSeek Harness\\opticforge\\\`；安装动作**只由 lead 执行**（用户明确要求时），子智能体不得修改 profile / DSH 安装目录。

## 1. 插件是什么

- 包名：\`@deepseek-ai/dsh-opticforge\`，version 0.1.0，ESM。
- 类型：DSH 服务端 **cordis 组合包（bundle）**，注册 2 个 \`defineTool\`：
  - \`opticforge_search\`：BM25 检索 67 块光学知识库（仅返回 51 块 status=present）。
  - \`opticforge_calc\`：5 个光学工程计算器，输出完整计算过程。
- 纯 Node.js，无新增 npm 运行时依赖、不依赖 Python/torch。

## 2. DSH 加载机制（已核对 0.2.2-rc.1 源码，非猜测）

1. profile 的 \`package.json\` 里 \`dsh.profile.bundles\` 是**有序组合包列表**。
2. 每个 bundle 的 \`package.json\` 必须声明 \`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }\`。
3. 启动时按 bundles 顺序叠加每个 bundle 的 patch 层 → profile 的 \`cordis.patch.yml\` → home 层 \`~/.dsh/cordis.patch.yml\` → \`--patch\` 覆盖，作用在空的根 \`cordis.yml\` 上。
4. bundle 名解析采用**两锚点**：先按「DSH 安装目录」解析，再按「profile 目录」解析（源码 \`dsh-app-boot/lib/index.js\` 的 \`resolveBundleDir\`）。
5. \`cordis.patch.yml\` 的 \`- insert:\` 行让 Loader import 包并调用 \`apply(ctx)\`，进而 \`ctx.tools.register(defineTool(...))\`。
6. **兼容性门槛**（\`unmetRequirements\`）：若 bundle 声明 \`peerDependencies\`，则每个 \`@deepseek-ai/dsh-*\` peer 的版本范围必须满足当前 runtime \`0.2.2-rc.1\`（\`semver.satisfies(..., {includePrerelease:true})\`）；不满足的 bundle 会被跳过并记入 \`skippedBundles\`。\`engines.dsh\` 一旦声明则完全取代 peer 检查。
   - 因此 \`"@deepseek-ai/dsh-tools": "0.2.2-rc.1"\` 精确匹配；\`"@deepseek-ai/cordis": "~4.1.0"\` 不以 \`dsh-\` 开头会被忽略。
7. **defineTool 真实契约**（已用 DSH 自带 \`defineTool\` 实测）：必须带 \`output: { schema, render }\`；schema 用「值 schema DSL」（必填写在属性上 \`required: true\`、每个 object 节点必须显式 \`additionalProperties\`），不是原生 JSON Schema。缺 output 会直接抛错。

本机实测关键路径：

| 项 | 路径 |
|---|---|
| DSH 安装目录（第一锚点，**只读 asar**） | \`D:\\Deepseek\\resources\\app.asar\\dsh\` |
| asar 归档文件（数据区来源） | \`D:\\Deepseek\\resources\\app.asar\`（213,202,918 B） |
| asar 原生解包目录 | \`D:\\Deepseek\\resources\\app.asar.unpacked\\dsh\\node_modules\\...\` |
| \`@deepseek-ai/dsh-tools\` 在归档内 | \`dsh/node_modules/@deepseek-ai/dsh-tools\`（v0.2.2-rc.1） |
| \`@deepseek-ai/cordis\` 在归档内 | \`dsh/node_modules/@deepseek-ai/cordis\`（v4.1.0） |
| 当前 profile | \`C:\\Users\\Lenovo\\.dsh\\profiles\\desktop\` |
| profile bundles 列表示例 | 含 \`@deepseek-ai/dsh-experimental-tool-worktree\` 等 29 项 |
| 参考插件源码 | \`...\\node_modules\\@deepseek-ai\\dsh-experimental-tool-worktree\\lib\\index.js\` |

### 2.1 peer 依赖解析：为什么不能用 junction（重要）

- \`lib/index.js\` 顶部是 \`import { defineTool } from "@deepseek-ai/dsh-tools"\`。插件装到 profile 第二锚点后，
  Node 会从 \`<profile>/node_modules/@deepseek-ai/dsh-opticforge/lib/index.js\` 沿目录向上找 \`node_modules\`。
- **普通 Node（独立 \`node.exe\`，无 Electron asar patch）实测**：\`fs.existsSync("D:\\Deepseek\\resources\\app.asar\\dsh\\...")\` 全部返回 \`false\`；直接 \`import\` asar 内 \`dsh-tools/lib/index.js\` 报 \`ERR_MODULE_NOT_FOUND\`。
  因此在插件包内建 \`junction\` 指向 asar 虚拟路径是**无效**的：junction 目标在 OS 文件系统层不存在，
  实测 \`existsSync(link)===false\`、读 \`package.json\` / \`lib/index.js\` 报 \`ENOENT\`。
- \`C:\\Users\\Lenovo\\.dsh\\profiles\\desktop\\node_modules\\@deepseek-ai\\\` 实测**没有**真实的 \`dsh-tools\` / \`cordis\` 副本
  （只有 \`cosmokit\` / \`dsh-atomic-write\` / \`dsh-home-paths\` / \`schemastery\`），\`createRequire(插件路径).resolve("@deepseek-ai/dsh-tools")\` 报 \`MODULE_NOT_FOUND\`。
- \`dsh-tools\` 自身还有传递依赖（\`@deepseek-ai/dsh-llm\`、\`@deepseek-ai/dsh-scope\`、\`@deepseek-ai/dsh-util-values\`、
  \`@deepseek-ai/schemastery\`、\`@deepseek-ai/cosmokit\`、\`zod\`、\`js-yaml\` 等）。**只提供种子包不够**：
  实测只放 \`dsh-tools\`+\`cordis\` 时 \`import\` 在 \`lib/shared-DTdn5dXO.js\` 处报
  \`Cannot find package '@deepseek-ai/dsh-llm'\`。必须提供整条依赖闭包（本机实测 29 包 / 1453 文件 / 约 11.8 MB）。
- **workspace 里 \`opticforge/node_modules/@deepseek-ai/\` 下的 \`dsh-tools\` / \`cordis\` 是早期探测留下的坏 junction**
  （target 指向 asar 虚拟路径，\`existsSync===false\`），不是有效 peer 副本，安装脚本的 \`copyDir\` 会跳过 \`node_modules\`，不会把它们复制进去。

### 2.2 asar 头格式（安装脚本自带解析，不依赖 test/ 目录）

本机 \`app.asar\` 实测：前 16 字节是 pickle 头，\`UInt32LE@12\` = 5,748,124（header JSON 字节数），
JSON 从 offset 16 开始，数据区起点 = \`16 + headerSize\` = 5,748,140；\`header.files\` 是文件树，
每个文件条目 \`{ size, offset }\`（offset 相对数据区起点），目录条目带 \`files\`。
少数条目标记为 \`unpacked: true\`（如 \`node-addon-require-builtin-win32-x64-msvc/prebuilt/win32-x64-msvc-napi-v9.node\`，356,840 B），
其 \`offset\` 为 \`undefined\`，字节不在归档内，而在同级 \`app.asar.unpacked\` 目录里，脚本会从磁盘读取该文件。

## 3. 安装步骤（由 lead 执行）

\`\`\`bash
# 预览（零副作用：只读文件 / 只读打开 asar 头，不写任何文件）
node "D:\\AI\\DeepSeek Harness\\opticforge\\scripts\\install-local.mjs" --dry-run

# 实际安装（写 profile node_modules + package.json + 兜底 patch 行；DSH 安装目录只读不写）
node "D:\\AI\\DeepSeek Harness\\opticforge\\scripts\\install-local.mjs"

# 测试安装到临时 home，不碰真实 profile（验收用）
node "D:\\AI\\DeepSeek Harness\\opticforge\\scripts\\install-local.mjs" \\
  --home "D:\\AI\\DeepSeek Harness\\_install_probe\\home" \\
  --install-dir "D:\\Deepseek\\resources\\app.asar\\dsh"

# 卸载
node "D:\\AI\\DeepSeek Harness\\opticforge\\scripts\\install-local.mjs" --uninstall
\`\`\`

参数（语义保持不变）：\`--dry-run\`（零副作用）、\`--uninstall\`、\`--profile <名>\`、\`--install-dir <DSH 安装目录>\`、
\`--home <home 根目录>\`（默认 \`~/.dsh\`，改它可把 profile 指向临时目录做测试）、\`--help\`。

脚本 \`scripts/install-local.mjs\` 做三件事（全部幂等，重复执行不重复追加 bundles / patch insert 行）：

1. 把 \`opticforge\\\` 目录复制到 **\`<home>/profiles/<profile>/node_modules/@deepseek-ai/dsh-opticforge/\`**
   （profile 第二锚点；跳过源目录里的 \`node_modules\` / \`.git\`，因此不会带入 workspace 的坏 junction）。
   \`D:\\Deepseek\\resources\\app.asar\\dsh\` 是 Electron asar 只读归档（\`mkdirSync\` / \`writeFileSync\` 报 \`ENOTDIR\`），无法写入；只有 profile 的 \`node_modules\` 可写。
2. **把 peer 依赖做成插件包内的真实文件**（不再建任何 junction），按优先级选择方式：
   - \`upward\`：profile 的 \`node_modules/@deepseek-ai\` 下已有 \`dsh-tools\`+\`cordis\` 真实副本，且 \`createRequire\` 能解析
     **整条依赖闭包** → 什么都不做，靠 Node 目录向上解析。
   - \`copy-real\`：\`--install-dir\` 指向真实落盘的 \`node_modules\` → 复制依赖闭包为真实文件。
   - \`asar-extract\`：\`--install-dir\` 位于 Electron asar 归档内 → **脚本自带 asar 头解析**，从归档数据区
     （及 \`app.asar.unpacked\` 的 unpacked 文件）提取 \`@deepseek-ai/dsh-tools\`、\`@deepseek-ai/cordis\`
     及其传递依赖的真实字节，写入插件包内 \`node_modules\`。本机实测提取 29 包 / 1453 文件。
   - \`unavailable\`：以上都找不到 → 明确警告「可能仅 DSH Electron 进程内可加载」，不假装成功。
   该方式**不依赖 \`test/\` 目录**，交付脚本可独立运行；也不创建任何符号链接。
3. 确保 \`<profile>/package.json\` 的 \`dsh.profile.bundles\` 含 \`@deepseek-ai/dsh-opticforge\`；
   兜底：若 profile 的 \`cordis.patch.yml\` 未含 opticforge insert 行则追加（bundle 自带 patch 已含该行，通常幂等无改动）。
   \`--home\` 指向全新目录时，脚本会生成最小 profile 骨架，避免报 ENOENT。

安装完成后脚本在**同一个独立 node.exe 进程**里自检：\`createRequire(插件入口).resolve("@deepseek-ai/dsh-tools")\`、
\`import(lib/index.js)\` 并校验 \`name/inject/apply\` 导出；失败时给出可定位的错误信息。

### 3.1 独立 node.exe 验收实测（task-9，全部通过）

使用 \`C:\\Users\\Lenovo\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe\`（v24.21.0，无 asar patch）：

| 实测项 | 结论 |
|---|---|
| \`--dry-run\`（自动探测 asar 安装目录） | EXIT=0，报告 \`asar-extract\`，零副作用 |
| \`--dry-run\` 后真实 profile | bundles 仍 29 项、不含 opticforge，patch 未改，插件目录不存在 |
| 临时 home 真实安装（\`--home\` + \`--install-dir\`） | 提取 29 包 / 1453 文件，\`模块可加载: 是\` |
| \`createRequire(...).resolve("@deepseek-ai/dsh-tools")\` | 解析到插件包内 \`node_modules/@deepseek-ai/dsh-tools/lib/index.js\` |
| \`import(lib/index.js)\` | \`{ apply, inject, name }\`，\`name=opticforge\`、\`inject=["tools"]\` |
| 独立进程 \`apply(fakeCtx)\` 端到端 | 注册 \`opticforge_search\` / \`opticforge_calc\`；检索 \`共焦色散 测量原理\` top1=A01；\`tolerance_rss\` 得 0.62 µm |
| 重复安装（幂等） | \`bundles 选择: 已存在\`、\`patch 兜底行: 已存在\`，无重复 |
| \`upward\` 分支（完整闭包在 profile） | 不提取、不建 junction，\`模块可加载: 是\` |
| \`upward\` 分支（闭包不全，仅种子包） | 自动回退 \`asar-extract\`，\`模块可加载: 是\` |
| \`copy-real\` 分支 | 复制 29 包 / 1453 文件，\`模块可加载: 是\` |
| \`--uninstall --dry-run\` / 真实 \`--uninstall\` | 前者零副作用；后者删除插件目录并从 bundles 移除，计数归 0 |

结论：**插件 \`lib/index.js\` 能被独立 node.exe 成功 import**（并非「仅 DSH Electron 进程内可加载」），
因为脚本已把 peer 及其依赖闭包的真实文件随插件一并安装。

## 4. 生效与验证

- **需重启 DSH**：本会话是在插件安装前启动的，正在运行的组合不会自动出现新 bundle（HMR 仅对 client-plugin 的 Web 产物有效）。重启后新工具才进入工具列表。
- 重启后在任意会话里验证：
  - \`opticforge_search({ query: "共焦色散 测量原理" })\` → 命中 \`A01\`，\`total_hits>0\`。
  - \`opticforge_search({ query: "量子计算 光学" })\` → 空结果 + \`note: "知识库中未找到相关依据"\`（知识空白如实告知）。
  - \`opticforge_calc({ type: "diffraction_limit", params: { lambda: 550, lambda_unit: "nm", NA: 0.95 } })\` → **\`d = 706.3158 nm\`（公式精确值）**，含 formula/substitution/steps/result/source。PLUGIN_PLAN.md §3.2 的方案示例记作 \`≈708 nm\`，与公式精确值不一致，**疑为取整/笔误**；\`result.plan_example_d_nm = 708\` 仅为方案示例值的如实标注、供交叉核对，精确答案以 \`value\` / \`d\` 字段为准，不改动公式去凑示例值。
  - \`opticforge_calc({ type: "tolerance_rss", params: { tolerances: [0.5, 0.3, 0.2], unit: "µm" } })\` → \`0.62 µm\`。
- 若工具未出现，检查 \`skippedBundles\`：常见原因是 peer 版本范围不匹配 runtime、或 \`cordis.patch.yml\` 的 \`name\` 与包名不一致、或 \`dsh.bundle.patch\` 声明缺失。

## 5. 云端 Dataset（方案 A，需用户本人操作）

- Dataset：ModelScope Datasets \`GrestestOptics/optics-kb\`（67 行结构化数据）。
- **云端同步口径（按需显式调用，不自动联网）**：\`lib/kb-data.js\` 导出 \`syncFromCloud(force=false)\` 供宿主在需要时显式调用；本插件的 \`apply()\` / 两个工具不会自动发网络请求。\`syncFromCloud()\` 才会通过 ModelScope HTTP API 尝试拉取 \`GrestestOptics/optics-kb\` 并缓存到 \`~/.dsh/opticforge-cache/\`；\`getKBData()\` 只读取已成功同步的本地缓存，否则回退内置 67 块数据。任何网络/解析失败都静默回退内置数据，离线完全可用。
- 上传脚本：\`scripts/export_dataset.py\`（导出 JSONL+CSV）、\`scripts/upload_dataset.py\`（ModelScope SDK 上传，\`--dry-run\` 只校验）。
- **上传需用户本人登录**（\`modelscope login\` 或网页扫码），AI 无法代登；这是方案文档明确的前提。

## 6. 硬约束（与 PLUGIN_PLAN.md §8 一致）

1. 不链接之前的 AI：不含创空间/模型/API 入口。
2. 不编造：检索未命中如实告知；计算参数不足说明并给范围建议。
3. 纯 Node.js、不装 torch。
4. 中文交互。
5. 知识空白如实告知（量子计算 / COMSOL / SolidWorks / 图像处理 / 热光学等 KB 无覆盖）。

---

## 7. 从 GitHub 安装（推荐的新路径）

插件源码托管于 GitHub 仓库（本仓库）。在新机器上安装只需三步：

```bash
# 1) 克隆仓库
git clone <仓库地址> opticforge
cd opticforge

# 2) 预览安装（零副作用）
node scripts/install-local.mjs --dry-run

# 3) 实际安装（写入 profile 锚点，需重启 DSH 生效）
node scripts/install-local.mjs
```

安装脚本会自动：复制插件到 profile 第二锚点 `node_modules/@deepseek-ai/dsh-opticforge/`、
把 `@deepseek-ai/dsh-tools` / `@deepseek-ai/cordis` 及整条传递依赖闭包提取为插件包内真实文件、
把 bundle 注册进 profile 的 `dsh.profile.bundles`。全程幂等，重复执行安全。

## 8. 命令行参数总表（`scripts/install-local.mjs`）

| 参数 | 作用 | 说明 |
|---|---|---|
| `--dry-run` | 预览安装 | 零副作用：只读文件、只读打开 asar 头，不写任何文件 |
| `--uninstall` | 卸载 | 删除插件目录、从 profile bundles 移除（配 `--dry-run` 可先预览） |
| `--profile <名>` | 指定 profile | 默认 `desktop` |
| `--install-dir <目录>` | 指定 DSH 安装目录 | 默认自动探测 `D:\Deepseek\resources\app.asar\dsh`；也可指向真实落盘的 node_modules |
| `--home <目录>` | 指定 home 根 | 默认 `~/.dsh`；指向全新目录时自动生成最小 profile 骨架（测试用） |
| `--help` | 帮助 | 打印用法后退出 |

## 9. peer 依赖四级解析机制

插件入口 `lib/index.js` 裸导入 `@deepseek-ai/dsh-tools`，而 profile 锚点通常没有该包的真实副本，
且 DSH 安装目录是 Electron asar 只读归档（普通 Node 读不到归档内文件，junction 指向虚拟路径也无效）。
安装脚本按以下优先级提供 peer 依赖（**不创建任何符号链接**）：

1. `upward`：profile 的 `node_modules/@deepseek-ai/` 下已有 `dsh-tools` + `cordis` 真实副本，
   且 `createRequire` 能解析**整条依赖闭包** → 什么都不做，靠 Node 目录向上解析；
2. `copy-real`：`--install-dir` 指向真实落盘的 `node_modules` → 把依赖闭包复制为真实文件；
3. `asar-extract`：`--install-dir` 位于 Electron asar 归档内 → 脚本自带 asar 头解析
   （`UInt32LE@12` = header JSON 字节数，数据区起点 `16 + headerSize`；`unpacked:true` 的原生 .node 条目
   从同级 `app.asar.unpacked/` 读取），把 `@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis` 及其传递依赖
   的真实字节写入插件包内 `node_modules`（本机实测 29 包 / 1453 文件 / 约 11.8 MB）；
4. `unavailable`：以上都找不到 → 明确警告"可能仅 DSH Electron 进程内可加载"，不假装成功。

**为什么需要整条闭包**：只放 `dsh-tools` + `cordis` 种子包时，`import` 会在 `lib/shared-DTdn5dXO.js`
处报 `Cannot find package '@deepseek-ai/dsh-llm'`——`dsh-tools` 的传递依赖（`dsh-llm` / `dsh-scope` /
`dsh-util-values` / `schemastery` / `cosmokit` / `zod` / `js-yaml` 等）必须一并可用。

## 10. 常见问题排查

- **`node` 不在 PATH**：DSH 自带独立 Node，路径示例：
  `C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0）。
  把上文所有 `node` 替换为该完整路径即可；
- **`python` 报 9009 / Microsoft Store 占位符**：用 DSH 自带 Python：
  `C:/Users/Lenovo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe`（3.12.14）；
- **测试环境没有该 asar 路径**：设 `DSH_ASAR=<app.asar 完整路径>` 环境变量覆盖；
- **装完没生效**：必须**重启 DSH**（用户本人操作；运行中的组合不会自动加载新 bundle）；
- **`skippedBundles` 出现 opticforge**：peer 版本范围与 runtime 不匹配、或 `cordis.patch.yml` 的 `name`
  与包名不一致、或 `dsh.bundle.patch` 声明缺失；
- **`--dry-run` 报找不到 DSH 安装目录**：用 `--install-dir` 显式指定。

---

