---
name: Bug report
about: 报告可复现的问题
title: "[bug] "
labels: bug
---

## 现象

<!-- 期望发生什么，实际发生了什么 -->

## 复现步骤

1.
2.
3.

## 环境

- DSH 版本：
- 操作系统：
- Node 版本（`node -v`）：
- 插件版本（工具返回里的 `kb_version` 或 `package.json`）：

## 调用记录

<!-- 贴出工具调用的参数与返回（可隐去无关内容） -->

```json
{}
```

## 自检

- [ ] 跑过 `node test/run.mjs`，结果：通过 / 失败
- [ ] 跑过 `node scripts/verify-all.mjs`，结果：通过 / 失败
- [ ] 若是数据问题，已确认 `node scripts/build-kb.mjs --check` 的结果
