# 参与方式

欢迎提 Issue 和 PR。这个仓库的核心资产是知识库条目，所以贡献内容时请优先看 `docs/KB-SPEC.zh.md`。

## 提交前必跑

```bash
node scripts/build-kb.mjs --check   # 若改了数据
node test/run.mjs
node scripts/verify-all.mjs
```

CI 会在 Ubuntu + Windows、Node 20 + 22 上跑同一套检查，任何一项失败都会挡掉合并。

## 补一条知识库条目

1. 把原文快照放到 `_kb-raw/<板块>.json`（本地保留，**已 gitignore，不要提交**）
2. 在 `data/kb/<板块>.json` 里按规范改写，`is_original_excerpt` 必须为 `false`
3. `node scripts/build-kb.mjs --doc <板块>` 跑到 OK
4. 若新增板板块，同步更新 `scripts/build-kb.mjs` 的 `DOCS` 与 `EXPECTED` 基线，以及 README 的统计表
5. `node scripts/build-kb.mjs --all --version <新版本>`

**数字必须逐字回查原文**：原文写 `three cycles`，条目就写"三个循环"，不要写成 `3`。校验器会逐 token 比对，写错就红。

长度不设上限。内容多就按语义拆条，不要为了压缩删判据。

## 补一个缺口

缺口条目里已经写了"缺什么、为什么缺、需要什么"。拿到原文后把该条 `status` 改成 `present`，按规范改写 `text`，重建、更新统计数字。

## 不要做的事

- 不要把厂商原文长段贴进公开仓库——只放改写后的事实与来源标注
- 不要为了凑数把 `missing_source` 伪造成 `present`
- 不要改 `lib/kb-engine.js` 的打分逻辑：它是既有移植契约，改动会让检索分数不可复现
- 不要在插件里加网络请求或凭据读取
