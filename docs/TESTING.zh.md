# OpticForge 测试与验证体系说明

> 两套独立验证，都可离线运行；本文与 `scripts/verify-all.mjs`、`test/run.mjs` 实际代码一致。

## 1. 两套验证的定位

| | `scripts/verify-all.mjs` | `test/run.mjs` |
|---|---|---|
| 断言数 | **74 项** | **23 用例**（node:test） |
| 定位 | 端到端契约总审查（独立 node.exe 可跑） | 集成测试（真实 defineTool 校验 + 检索/计算/统计） |
| 运行方式 | `node scripts/verify-all.mjs`（cwd 建议为仓库根） | `cd opticforge && node test/run.mjs` 或 `node --test test/run.mjs` |
| 写入 | 仅 `os.tmpdir()/dsh-opticforge-verify-runtime` 缓存 | 仅 `test/.asar-runtime/`（收尾自动清理） |

## 2. verify-all.mjs 工作原理（asar 只读归档下的依赖解决）

1. **内联解析 app.asar 归档头**：前 16 字节 pickle 头，`UInt32LE@12` = header JSON 字节数，数据区起点 = `16 + headerSize`；`header.files` 为文件树，每条目 `{size, offset}`（offset 相对数据区起点）；
2. **提取依赖闭包**到 `os.tmpdir()/dsh-opticforge-verify-runtime`（实测约 22 包 / 1248 文件）：把 `@deepseek-ai/dsh-tools` 及其传递依赖（dsh-llm / dsh-scope / dsh-util-values / schemastery / cosmokit / zod / js-yaml 等）写成真实文件；`unpacked:true` 的原生 .node 条目从同级 `app.asar.unpacked/` 读取；
3. **module.register() + resolve hook**：按 package.json `exports`/`main` 把裸 specifier 重定向到缓存真实文件；
4. **用真实 defineTool / validateJsonSchemaValue 校验**：不是手写 mock——valueSchemaSpecToJsonSchema 会把 DSL 的 `required:true` 编译进 root.required，必须用**编译后**的 `def.output.schema` 校验返回值；
5. **缓存 stamp 含脚本自身 sha256**：代码一改缓存自动重建。

非默认安装路径可用 `DSH_ASAR=<app.asar 完整路径>` 环境变量覆盖。

## 3. test/run.mjs 用例分组

- **A**：真实 defineTool 契约——`lib/index.js` 注册的两个工具 `parameters`/`output.schema` 通过真实 `assertSupportedJsonSchema`，`output.render` 可调用，`execute` 返回值通过 `validateJsonSchemaValue` 符合 schema；
- **B**：KB 统计——67 块 / 51 present / 9 字段 / status 与 doc_id 分布；
- **C1-C7 检索**：C1 共焦色散→A01、C2 RCWA→C02、C3 doc_filter、C4 top_k、C5 status=present 过滤、**C6 "量子计算 光学" 硬断言空+note**、C6b 不确定度→E01-06（H1 回归）、C6c 自由曲面→B01-10、C6d 白光干涉仍短路、C7 纯 ASCII 乱码未命中 note；
- **D1-D7 计算器**：D1 五示例数值（±6 容差）、D1b 精确值/方案示例值双口径（706.3158 与 plan_example_d_nm=708 都核验）、D6 缺参 ok=false、**D6b 未知 type 两层契约**（工具层 enum 干净拒绝抛 ToolArgsError 属框架合法行为；契约层直接 `calculate('not_exist',{})` 不抛、ok=false、符合 schema）、D7 直接调用 calculate；
- **E1**：内置 `data/kb-data.json` 与源文件逐字段一致。

## 4. 运行示例（本机实测）

```bash
# ① verify-all（独立 node.exe，74/74 ALL PASS）
C:/Users/Lenovo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe scripts/verify-all.mjs

# ② 集成测试（23/23 PASS，~0.2s）
cd opticforge && node test/run.mjs
```

- 测试用真实 dsh-tools（0.2.2-rc.1）跑通：A2 schema 校验、C6 硬断言、D6b 两层行为均按框架实测定义；
- 测试脚本**只读源码**，唯一写入是依赖缓存且收尾自动清理；队友模块缺失时给出清晰失败信息，不静默跳过。
