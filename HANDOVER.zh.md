# OpticForge 插件 — 交接文件

> 生成时间：2026-11-16（Asia/Shanghai）｜交接人：Team Lead（lead）｜会话工作目录：D:\AI\DeepSeek Harness
> 本文件是唯一权威交接文档；接管者无需回读本会话历史即可继续工作。

## 0. 目标（必须首先理解）

**总目标（用户原始需求，尚未 100% 关闭）**：
搭建一个可安装、可激活的 DeepSeek Harness（DSH）本地插件 **`@deepseek-ai/dsh-opticforge`**（cordis bundle），提供两个工具：

1. `opticforge_search` —— BM25 中文检索 67 块光学知识库（KB），其中 51 块 status=present 可检索、11 块 missing_source、5 块 substitute；
2. `opticforge_calc` —— 5 个光学工程计算器（衍射极限 / 镀膜热漂移 / 共焦量程选择 / RSS 公差合成 / NA 分辨率）。

外加：云端 ModelScope Dataset 上传/导出脚本、集成测试、全中文文档。

**用户原始话术（逐字，出处 m00769/m00179）**：
> "我是中文用户。 @D:\AI\OpticsGPT\opticsgpt-space\_kb_inventory.json @D:\AI\OpticsGPT\opticsgpt-space\kb-data-full.json @D:\AI\OpticsGPT\opticsgpt-space\PLUGIN_PLAN.md 优先读取plan文件。需要的文件创建在D:\AI\DeepSeek Harness。同时创建多个子智能体来进行这项dsh插件搭建工作。"

后续指令（m00771）："继续任务，唤醒子智能体，继续搭建和优化"。

**硬约束（来自 PLUGIN_PLAN.md §8.5，路径 D:\AI\OpticsGPT\opticsgpt-space\PLUGIN_PLAN.md，任何修改都不得违反）**：
1. 全程中文回复与文档；
2. 不链接之前的 AI（不得包含创空间/模型/API 推理入口）；
3. 不编造——检索未命中必须如实告知「知识库中未找到相关依据」，计算参数不足时说明而非编造数值；
4. 纯 Node.js 实现，不装 torch；
5. 知识空白如实告知（量子计算/COMSOL/SolidWorks/图像处理/热光学等主题 KB 无覆盖，检索返回空是**正确行为**）；
6. 审批禁用：本会话 file policy=danger-full-access，不得请求 sandbox_permissions。

## 1. 当前完成度（截至交接时刻）

| 模块 | 状态 | 验证方式 |
|---|---|---|
| 插件代码（lib/ 4 个文件） | ✅ 完成 | node --check 全 rc=0；真实 defineTool 契约校验通过 |
| 知识库数据（data/kb-data.json） | ✅ 完成 | 67 块/51 present/9 字段，与源 kb-data-full.json 逐字段一致 |
| 知识空白守卫（数据驱动三重判据） | ✅ 完成 | 8 个知识空白查询→空+如实 note；「不确定度→E01-06」「自由曲面→B01-10」不误伤 |
| 5 个计算器 | ✅ 完成 | 5 数值精确（见 §5），错误路径结构化 ok=false |
| 集成测试 test/run.mjs | ✅ 完成 | 23/23 PASS（独立 node.exe 实跑） |
| 端到端断言 scripts/verify-all.mjs | ✅ 完成 | 74/74 PASS（独立 node.exe 实跑） |
| Dataset 导出/上传脚本 | ✅ 完成 | --check 67行/9列；--dry-run 零网络 |
| 安装脚本 scripts/install-local.mjs | ✅ 完成 | --dry-run 零副作用；全新 --home 实装实测可加载 |
| 中文文档（README/INSTALL/USAGE/CALCULATORS/KB/TESTING） | ✅ 完成 | 三份口径一致，39 项静态断言通过 |
| **安装到真实 profile 并激活** | ⏳ **未做** | profile 未写入（见 §7 待办 T1） |
| **云端 Dataset 创建与上传** | ⏳ **未做** | 需用户本人 ModelScope 登录（见 §7 待办 T2） |

## 2. 文件位置清单（全部在 D:\AI\DeepSeek Harness\opticforge\）

### 2.1 npm 发布包内容（8 文件，npm pack --dry-run 实测恰好 8 个）
| 文件 | 大小 | 作用 |
|---|---|---|
| package.json | 680B | name=@deepseek-ai/dsh-opticforge, version=0.1.0, type=module, main=lib/index.js, dsh.bundle.patch=./cordis.patch.yml, peerDependencies {cordis:~4.1.0, dsh-tools:0.2.2-rc.1} |
| cordis.patch.yml | 74B | cordis 插件插入补丁：- insert: [ - id: opticforge, name: '@deepseek-ai/dsh-opticforge' ] |
| lib/index.js | 14086B | 骨架：apply(ctx) 注册两个 defineTool；含数据驱动守卫 isZeroCoverageQuery(query,chunks)（三重判据：①命中 ZERO_COVERAGE_TOPICS 词表 ②不含 COVERED_ANCHORS ③命中词在 present 块可检索字段确实 0 出现——第③条保证「不确定度/自由曲面」不误伤） |
| lib/kb-data.js | 6280B | KB 数据模块：KB_SOURCE/TOTAL_CHUNKS=67/PRESENT_CHUNKS=51/getKBData()/syncFromCloud(force=false)；BUILTIN_URL 用 import.meta.url 相对读 data/kb-data.json；缓存写 ~/.dsh/opticforge-cache/ |
| lib/kb-engine.js | 6518B | BM25 引擎：BM25_K1=1.5/BM25_B=0.75/tokenize/buildIndex/searchKB；CJK 单字+双字分词；与 Python 参考实现 kb_tool.py 逐分比对 25/25 一致 |
| lib/calculators.js | 36560B | 5 计算器：calculate(type,params) 同步返回、绝不抛异常；IFS2402 规格运行时从包内 data/kb-data.json 的 A01-02 正文解析（kbCandidates 首位 join(here,"..","data","kb-data.json")，无本机绝对路径） |
| data/kb-data.json | 308424B | 67 块 KB 数据（9 字段：doc_id,chunk_id,status,is_original_excerpt,text,source,page_or_section,keywords_zh,disclaimer） |
| README.zh.md | 18840B | 主文档（用法/守卫说明/npm 包内容/708 裁决/云端口径） |

### 2.2 开发仓库专用（不进 npm 包）
| 文件 | 大小 | 作用 |
|---|---|---|
| scripts/install-local.mjs | 26120B | 安装脚本（详见 §4）；支持 --dry-run/--uninstall/--profile/--install-dir/--home |
| scripts/verify-all.mjs | 22119B | 只读端到端断言 74 条；内联解析 app.asar 提取依赖到 os.tmpdir() 缓存，不依赖 test/ |
| scripts/export_dataset.py | 9497B | 导出 67 行/9 列（8 列+disclaimer）JSONL+CSV；--check 校验模式；DEFAULT_INPUT=插件内置 data/kb-data.json |
| scripts/upload_dataset.py | 18734B | ModelScope 上传；默认 --dry-run 零网络；必须显式 --upload；官方 HubApi.upload_file(repo_type="dataset") + CLI 回退 |
| test/run.mjs | 27814B | node:test 集成测试 23 用例（A 契约/B 数据/C 检索含守卫回归/D 计算器/E 数据一致性） |
| test/_asar_loader.mjs | 8775B | 测试辅助：从只读 app.asar 抽取 dsh-tools 依赖闭包到 test/.asar-runtime/（运行时生成、测完自动清理） |
| docs/INSTALL.zh.md | 17602B | 安装文档（四分支 peer 解析说明、验收值 d=706.3158nm） |
| docs/USAGE.zh.md | 23843B | 使用文档（检索/计算/Dataset 上传/测试；§6.1 说明 9 列与方案 §2.4 的 8 列差异） |
| docs/CALCULATORS.zh.md | 4940B | 5 计算器说明 |
| docs/KB.zh.md | 5425B | 知识库说明（67 块来源/字段/status 含义） |
| docs/TESTING.zh.md | 3601B | 测试说明 |
| LICENSE | 1080B | MIT |
| .gitignore | 214B | — |

### 2.3 外部关键路径（不在 opticforge/ 内）
- 用户原始需求文件：D:\AI\OpticsGPT\opticsgpt-space\PLUGIN_PLAN.md（权威规范，注意 §2.4 原写 8 列与实现 9 列差异已在文档中如实说明）、kb-data-full.json（源 KB，67 块）、_kb_inventory.json
- DSH 实现只读归档：D:\Deepseek\resources\app.asar\dsh\（peer 依赖 dsh-tools 0.2.2-rc.1 与 cordis 4.1.0 在其 node_modules/@deepseek-ai/ 下）
- 独立 Node：C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe（v24.21.0，无 asar patch）
- DSH 自带 Python：C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe（3.12.14；本机 PATH 的 python 是 Microsoft Store 占位符 9009，勿用）
- 目标安装锚点：C:\Users\Lenovo\.dsh\profiles\desktop\node_modules\@deepseek-ai\dsh-opticforge\（**当前不存在**）
- profile bundle 注册文件：C:\Users\Lenovo\.dsh\profiles\desktop\package.json 的 dsh.profile.bundles（当前 27 项，不含 opticforge）
- 云端同步缓存目录：C:\Users\Lenovo\.dsh\opticforge-cache\（当前不存在）

## 3. 架构与关键技术事实（接管者必须知道）

1. **DSH 插件加载机制（两锚点）**：DSH 启动时先在安装目录（asar 内）找 @deepseek-ai/* 包，再在 profile 目录 C:\Users\Lenovo\.dsh\profiles\desktop\node_modules\ 找。安装目录是 Electron asar 只读归档（写操作报 ENOTDIR/ENOENT），所以插件必须装到 profile 第二锚点。
2. **asar 兼容性**：独立 node.exe 无 asar patch，读不到归档内文件；run_code 宿主进程带 asar patch 可以。因此 verify-all.mjs 与 test/ 都内联了解析 asar 归档头的逻辑（UInt32LE@12=header size，数据区 16+headerSize），把依赖闭包提取为真实文件后 import。安装脚本的 asar-extract 分支同理。
3. **peer 依赖四级解析（install-local.mjs）**：upward（profile 已有真实副本且整条闭包可解析）→ copy-real → asar-extract（脚本自带解析，不依赖 test/）→ unavailable（明确警告）。实测 profile 目前没有 dsh-tools/cordis，真实安装必走 asar-extract（29 包/1453 文件/~11.8MB）。
4. **知识空白守卫（lib/index.js isZeroCoverageQuery）**：三重判据，第③条「运行时校验该词在 present 块可检索字段确实 0 出现」是关键——使守卫数据驱动而非词表硬编码，规避词表漂移误伤（历史上「不确定度」「自由曲面」曾被误伤，已修复并有回归用例 C6b/C6c）。
5. **708 裁决**：衍射极限保持公式精确值 706.3158nm；方案示例 708 作为 plan_example_d_nm 如实标注「疑为笔误」，绝不凑数。理由：不编造是硬约束。
6. **云端口径（三份文档统一）**：syncFromCloud(force=false) 供宿主显式调用；apply()/两工具不自动联网；getKBData() 只读已同步缓存否则回退内置 67 块；网络/解析失败静默回退、离线完全可用。
7. **defineTool 契约**：工具返回值必须过 defineTool 编译后的 output.schema 校验（valueSchemaSpecToJsonSchema 会把 DSL required:true 编进 root.required）；未知 type 在 parameters.type enum 层被框架拒绝（ToolArgsError），这是框架合法行为，不是崩溃（test D6b 双路径覆盖）。
8. **插件模块可用性**：lib/index.js 已被独立 node.exe 从全新 --home 安装目录成功 import 并端到端跑通两工具，不是仅 Electron 可加载。

## 4. 安装脚本用法（scripts/install-local.mjs）

- `node scripts/install-local.mjs --dry-run` — 预演，零副作用
- `node scripts/install-local.mjs` — 真实安装到 profile 两锚点（复制插件 + peer 闭包 + 幂等追加 dsh.profile.bundles + 幂等追加 cordis.patch.yml 兜底 insert 行）
- `node scripts/install-local.mjs --uninstall` — 卸载
- `node scripts/install-local.mjs --home <dir> --install-dir <dir>` — 指定环境实测
- copyDir 跳过：node_modules/.git/__pycache__/_task13_tmp/_lead_*/.asar-runtime/*.pyc/*.tgz 等

## 5. 五计算器精确值（用户验收标准）

| type | 入参 | 精确值 | 方案示例值（如实标注） |
|---|---|---|---|
| diffraction_limit | lambda=550nm, NA=0.95 | **706.3158nm**（艾里斑半径 353.1579nm） | 708nm（疑笔误） |
| coating_thermal_drift | lambda=1064nm, dn_dT=1e-5, alpha=5e-7, delta_T=40K | relative_drift=4.2e-4, Δλ=**0.4469nm** | 0.45nm |
| confocal_range_select | 0~1mm, 精度 100nm, 反射 | 推荐 **IFS2402-1.5**（1.5mm 档），如实报告「线性度 600nm 不满足 100nm 精度要求」 | — |
| tolerance_rss | tolerances=[0.5,0.3,0.2]µm | **0.6164µm** | 0.62µm |
| na_resolution | lambda=550nm, NA=0.95 | **353.1579nm**（共焦 ≈249.7203nm，1/√2） | — |

## 6. 验证与回归命令（全部实跑通过，接管后可复跑）

```bash
NODE="C:/Users/Lenovo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
PY="C:/Users/Lenovo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe"
cd "D:/AI/DeepSeek Harness"

# 语法
for f in opticforge/lib/*.js opticforge/scripts/*.mjs opticforge/test/*.mjs; do "$NODE" --check "$f"; done

# 端到端 74 断言
"$NODE" opticforge/scripts/verify-all.mjs          # 期望 RESULT: ALL PASS（PASS 74/FAIL 0）

# 集成测试 23 用例
cd opticforge && "$NODE" test/run.mjs; cd ..       # 期望 ℹ pass 23 / ℹ fail 0

# Dataset 校验 / dry-run
"$PY" opticforge/scripts/export_dataset.py --check # 期望 67 行/9 列/51-11-5
"$PY" opticforge/scripts/upload_dataset.py --dry-run # 期望零网络

# 打包 / 安装预演
cd opticforge && npm pack --dry-run --json; cd ..  # 期望 entryCount 8
"$NODE" opticforge/scripts/install-local.mjs --dry-run # 期望零副作用
```

## 7. 待办（接管者按优先级执行）

**T1【最重要】安装到真实 profile 并激活** —— 用户已被告知但尚未确认执行：
1. 运行 `node opticforge/scripts/install-local.mjs`（真实写入 profile 两锚点 + bundle 注册）；
2. **用户本人重启 DSH**（AI 无法代做 GUI 重启）；
3. 重启后在新会话验证：让 DSH 调用 opticforge_search({query:"共焦色散 测量原理"}) 期望 top1 doc_id=A01、total_hits=5；调用 opticforge_calc({type:"tolerance_rss",params:{tolerances:[0.5,0.3,0.2],unit:"µm"}}) 期望 result≈0.62µm。
注意：切勿在未备份 profile/package.json 的情况下手动改注册文件，一律用 install-local.mjs 的幂等逻辑。

**T2 云端 Dataset（需用户本人操作，AI 不代登）**：
1. 用户在 modelscope.cn 网页创建 Dataset **GrestestOptics/optics-kb**（当前实测 404「不存在的数据集」）；
2. `modelscope login --token <本人 Access Token>`；
3. `python scripts/upload_dataset.py --upload`（默认 dry-run，必须显式 --upload）。
注意：PLUGIN_PLAN.md §2.4 原写 8 列，实现为 9 列（补 disclaimer 以闭合云端同步校验），文档已如实说明差异。

**T3 可选优化（不阻塞交付）**：
- kb-data.js 的 syncFromCloud 目前零调用者（设计如此，文档已如实写「供宿主显式调用」），若未来希望启动时自动同步需新增宿主钩子并同步改三份文档；
- test/.asar-runtime 每次跑测试会重新生成并自动清理，无需手动干预；
- 如需发布 npm 包，package.json files 已锁 8 文件，直接 npm publish 即可（需 npm 凭据，与 GitHub 插件无关）。

**T4 明确不做（防止接管者误扩 scope）**：
- 不改 BM25 算法（忠实移植 kb_tool.py 契约，逐分比对 25/25）；
- 不放宽知识空白硬断言（C6 保持「量子计算 光学」返回空）；
- 不添加创空间/模型/API 推理入口（硬约束）；
- 不在本会话请求 sandbox_permissions（审批禁用）；
- 不编写 Python 虚拟环境/依赖安装（两脚本纯标准库）。

## 8. 团队与任务板状态

- 5 个具名队友（kb-engine / calculators / plugin-core / test-docs / verify-runner）全部任务（task-5~18）已 completed 并汇报，当前 inactive；
- 任务板 task-1~4 为旧空任务，忽略；task-5~18 全部 completed，无 in_progress；
- 关键历史裁决（708 精确值、守卫三重判据、M2 统一口径、9 列数据集）均已写入对应文档，接管者读文档即可，无需回溯对话。

## 9. 已知限制与坑

1. 独立 node.exe 读 asar 会失败——任何新脚本要访问 DSH 归档内文件，必须复用 verify-all.mjs / test/_asar_loader.mjs / install-local.mjs 已内联的归档头解析逻辑，不要直接 import 归档内路径；
2. run_code 宿主进程 os.tmpdir() 曾返回 undefined（历史 bug），写临时目录请显式指定已知可写路径；
3. compress 工具需系统 nudge 伴随才可用，多次尝试会报 requireNudge 拒绝——不要主动反复压缩；
4. 本机 PATH 的 python 是 Microsoft Store 占位符（退出码 9009），必须用 §2.3 列出的 DSH 自带 python.exe；
5. ModelScope 官方 HubApi 无 push_dataset 方法（PLUGIN_PLAN.md:87 的写法本身不实），upload_dataset.py 已改用官方 upload_file，不要改回去；
6. cloud Dataset ID 拼写是 **GrestestOptics**（用户拼写，勿"纠正"为 Greatest）；
7. test/run.mjs 与 verify-all.mjs 均依赖 DSH 安装目录存在（DSH_ASAR 环境变量可覆盖，默认 D:/Deepseek/resources/app.asar）；在别的机器上跑需先设 DSH_ASAR。

## 10. 一句话交接

> 插件本体已完成并全量回归通过（74/74 断言 + 23/23 测试 + npm pack 8 文件 + dry-run 零副作用），代码在 D:\AI\DeepSeek Harness\opticforge\；剩余两步——① 经用户确认后跑 install-local.mjs 写入真实 profile 并重启 DSH 验证两工具；② 用户本人创建并上传 ModelScope Dataset。接管者从 §7 待办 T1 开始。