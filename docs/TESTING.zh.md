# 测试与验收

两套检查，都离线运行，不依赖 DSH 进程、不写缓存。

| 命令 | 内容 | 用时 |
|---|---|---|
| `node test/run.mjs` | 25 个集成用例（node:test） | 约 1 秒 |
| `node scripts/verify-all.mjs` | 29 项发布前验收 | 约 5 秒（含 npm pack） |

CI（`.github/workflows/test.yml`）在 Ubuntu + Windows、Node 20 + 22 上跑这两套。

---

## 集成测试的六组

**A. 注册契约**
插件可加载，`apply/inject/name` 正确，恰好注册 4 个工具；每个工具 `parameters` 是标准 JSON Schema（根 `type=object`、`required` 名字都在 `properties` 里、不残留内部 DSL 的 `required` 布尔位），`output.schema` 与 `output.render` 齐备且可调用。

**B. 数据统计**
67 块 / 51 present；9 个字段齐全；`chunk_id` 唯一；`status` 只取三种值。

**C. 检索端到端**
命中 A01/C02、`doc_filter` 生效、`top_k` 上限、0 覆盖主题短路、有依据的查询不被误判为空白、分页不重不漏、同一板块条数受限、三个工具共享 `ok/kb_version/action` 信封。

**D. 计算器**
5 个类型逐一核对验收值（706.3158 nm / 0.4469 nm / IFS2402-1.5 / 0.6164 µm / 353.1579 nm），非法参数返回 `ok:false` 且不抛，`calculate()` 直接调用同样不抛。

**E. 产物一致性**
`data/kb-data.json` 必须等于 `data/kb/*.json` 的合并结果；`kb-meta.json` 的 `content_sha256` 必须与数据实际内容匹配；`total_chunks` / `present_chunks` 对得上；空白词表与覆盖锚点非空。

**F. 版本一致**
`package.json` 版本 == `kb-meta.kb_version`。

---

## verify-all 的六组

- **A 发布契约**：包名 `dsh-opticforge`、semver、`type=module`、`main`、`files`、`dsh.bundle.patch`、无 `peerDependencies`、无 `dependencies`、`repository`、`engines`
- **B 零宿主依赖**：`lib/` 全部文件不得出现 `@deepseek-ai/`，否则 link 安装会解析失败
- **C 产物一致**：跑 `build-kb.mjs --check`
- **D 集成测试**：跑 `test/run.mjs`，必须是全绿
- **E 打包清单**：`npm pack --dry-run` 必须包含 `lib/`、`data/kb-data.json`、`data/kb-meta.json`、`cordis.patch.yml`、`README.md`、`LICENSE`；不得包含 `_kb-raw/`、`test/`、`scripts/`、内部文档
- **F 版本一致**

任一项失败即退出码 1，不做"警告后继续"。

---

## 为什么不再需要 asar

插件走原生 JSON Schema 注册，不 import 任何 `@deepseek-ai` 包。因此测试不需要从 `app.asar` 抽取 `dsh-tools` 依赖闭包，也不需要模拟 Electron 的 asar 读取。

代价是参数校验必须自己做——`lib/index.js` 的 `validateArgs` 负责，D6b 用例专门验证它拦得住未知 `type`。

---

## 手工抽查

```bash
node scripts/build-kb.mjs --doc A02    # 单板块校验
node scripts/build-kb.mjs --check      # 产物一致性
node scripts/verify-all.mjs            # 发布门禁
```

数字校验抓过真实错误：改写 B01 时把原文 "three cycles" 写成 `3`、"one hundredth" 写成 `1/100`，被逐字回查拦下。这说明"防编造"是可执行的规则，不是口号。
