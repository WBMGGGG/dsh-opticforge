# 变更记录

## 0.1.0

首个公开发布版本。相较早期内部版本的变化：

### 包与安装

- 包名由 `@deepseek-ai/dsh-opticforge` 改为 `dsh-opticforge`
- 移除 `peerDependencies`（`@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis`）
- 工具改为原生 JSON Schema 注册，不再 `import @deepseek-ai/dsh-tools`
  - 不再需要从 `app.asar` 抽取依赖闭包
  - `link:` 安装即可用，参数校验由插件自身完成
- `scripts/install-local.mjs` 重写：只写 profile 依赖项、bundles 项与目录链接

### 知识库

- 数据按板块拆分为 `data/kb/*.json`，由 `scripts/build-kb.mjs` 合并为 `data/kb-data.json`
- 全部 `present` 条目改写为事实条目：`is_original_excerpt=false`、以`【标题】`开头、数字逐字回查原文
- 逐字厂商原文块清零（早期版本有 55 块逐字原文）
- 发布数据由 308 KB 降到约 103 KB
- 修正知识缺口条目的内部排障痕迹（临时快照路径、抓取细节）
- 新增 `data/kb-meta.json`：`kb_version`、`content_sha256`、板块清单、空白词表、覆盖锚点

### 检索与调用

- 新增 `opticforge_docs`（板块目录）与 `opticforge_get`（取完整条目）
- 检索摘录由"正文前 300 字"改为`【标题】` + 命中词周围 400 字窗口
- 检索回显 `matched_terms`、`chars`、`kb_version`、`total_matched`、`has_more`
- 新增 `offset` 翻页与 `max_per_doc` 同板块限流
- 三个知识库工具统一输出信封 `{ ok, kb_version, action, ... }`

### 移除

- 删除 ModelScope 云端同步链路与本地缓存（旧缓存会遮蔽新版数据）
- 删除 `scripts/upload_dataset.py`、`scripts/export_dataset.py`
- 删除 `syncFromCloud()` 与 `CANDIDATE_URLS`

### 测试

- 集成测试改为纯本地宿主桩，不再依赖 asar 抽取的真实 `defineTool`
- 用例由 23 增至 25（新增分页/去重、统一信封）
- `scripts/verify-all.mjs` 重写为 29 项发布门前置检查
- 新增 GitHub Actions（Ubuntu + Windows × Node 20 + 22）
