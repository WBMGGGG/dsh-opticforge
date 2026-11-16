# OpticForge

光电工程师的本地知识库与工程计算器，DeepSeek Harness（DSH）插件。

纯 Node.js，零运行时依赖，装完即用。

---

## 它解决什么

做光机设计、装调、验收时，真正卡人的不是公式，而是那些**散落在厂商手册和知识库里的具体判据**：这个镜片口径怎么换算、公差分析该看哪个数、光谱仪该配多少像素、共焦传感器量程怎么选。

这些东西查一次要半小时，下次还得再查。OpticForge 把它们整理成可检索的事实条目，让模型直接查到依据，而不是凭记忆编。

同时把常算的 5 个工程计算固化成计算器，输出完整计算过程，方便复核。

---

## 四个工具

| 工具 | 用途 |
|---|---|
| `opticforge_docs` | 列出知识库有哪些板块、每块讲什么。先看目录再检索，减少盲目搜索 |
| `opticforge_search` | BM25 检索，返回 chunk_id、分数、摘录、来源、页码 |
| `opticforge_get` | 按 chunk_id 取完整条目（9 个字段全给）。引用原文、核对数值时用 |
| `opticforge_calc` | 5 类工程计算，输出公式 → 代入 → 步骤 → 结果（含单位） |

检索结果的 `kb_version` 会回显，方便确认当前用的是哪版数据。

---

## 知识库现状

9 个板块（A01–E01），67 个条目，其中 **51 条可作为依据**（`status=present`）。

| 板块 | 内容 | 条目 / 可用 |
|---|---|---|
| A01 | 共焦色散传感器（Micro-Epsilon 目录） | 13 / 12 |
| A02 | 光谱仪搭建：理论、实现、杂散光、公差 | 9 / 7 |
| A03 | 峰值定位综述 | 1 / 0 |
| B01 | 序列模式公差分析（Zemax KB） | 11 / 11 |
| B02 | DOE / 超透镜设计 | 4 / 4 |
| C01 | 白光干涉（ZYGO CSI） | 5 / 0 |
| C02 | RCWA 光栅衍射效率 | 7 / 7 |
| D01 | 滨松 Si 光电二极管 | 11 / 9 |
| E01 | 计量规范（JJF / ISO / GB） | 6 / 1 |

剩下 16 条是**如实标注的知识缺口**：11 条 `missing_source`（原文没拿到）、5 条 `substitute`（用同类公开资料顶上，并注明不是原出处）。

缺口不是缺陷，是设计。模型看到缺口会告诉你"这里没有依据"，而不是编一个。

### 当前已知空白

量子计算 / 量子光学、COMSOL、SolidWorks、图像处理与缺陷检测、热光学与无热化、多物理场、光波导、非球面与自由曲面、光谱定标与辐射度学、不确定度与公差链、物理光学 —— 这些主题知识库没有覆盖，检索返回空是正确行为。

---

## 数据怎么保证准确

每条 `present` 条目是**事实条目**，不是原文转载：

- `is_original_excerpt = false`：全部为改写后的工程事实
- 正文以 `【标题】` 开头，之后逐行写"字段：值"
- **数字逐字回查原文**：写进去的每个数字都必须能在对应原文块里逐字找到。原文写 `three cycles` 就必须写"三个循环"，不能自己写成 `3`
- 不跨块合并、不加营销词、不写原文没有的结论

这套规则由 `scripts/build-kb.mjs` 强制检查，不是靠自觉：

```bash
node scripts/build-kb.mjs --doc A02    # 改单个板块时自检
node scripts/build-kb.mjs --all        # 全量校验 + 生成 kb-data.json / kb-meta.json
node scripts/build-kb.mjs --check      # CI 用，只校验产物一致性
```

数字校验抓过真问题：改写 B01 时把原文的 "three cycles""four standard deviations""twice"写成 `3 / 4 / 2`，校验器全部报错——这些数字原文里不存在。

### 目录结构

```
data/kb/            按板块拆分的事实条目（人可读，git diff 可审）
data/kb-data.json   合并产物，插件运行时读它
data/kb-meta.json   版本、内容 sha256、板块清单、空白词表
_kb-raw/            厂商原文快照，仅本地保留，不进仓库（.gitignore）
```

`_kb-raw/` 只用于改写时回查数字，永远不发布。公开仓库里没有逐字原文长段。

---

## 安装

### 从插件市场（推荐，需已收录）

在 DSH 里打开插件市场，搜 `OpticForge` 安装。市场只允许收录列表内的来源，收录状态见仓库 Issues。

### 本机 link 安装（开发用）

```bash
node scripts/install-local.mjs            # 写入 profile 依赖 + bundles + 建目录链接
node scripts/install-local.mjs --dry-run  # 只打印，不动文件
node scripts/install-local.mjs --uninstall
```

重启 DSH 生效。之后改仓库里的代码或数据，重启即加载最新版本，不用重新安装。

---

## 计算器

| type | 算什么 | 验收值 |
|---|---|---|
| `diffraction_limit` | 衍射极限半径 | 706.3158 nm |
| `coating_thermal_drift` | 镀膜热漂移 Δλ | 0.4469 nm |
| `confocal_range_select` | 共焦传感器量程选型 | 推荐 IFS2402-1.5（线性度 600 nm 不满足 100 nm 要求） |
| `tolerance_rss` | 公差 RSS 合成 | 0.6164 µm |
| `na_resolution` | 数值孔径 / 分辨率 | 353.1579 nm（共焦 249.7203 nm） |

参数不够或非法时，明确告诉你缺什么、合理范围是多少，不会凑一个数给你。

---

## 开发

```bash
node test/run.mjs                      # 集成测试（23 个用例）
node scripts/verify-all.mjs            # 全量回归
node scripts/build-kb.mjs --all        # 重建知识库
```

改知识库的流程：编辑 `data/kb/<板块>.json` → `--doc` 自检 → `--all` 重建 → 跑测试。

---

## 边界

- 知识库只覆盖上面列出的 9 个板块，别指望它回答量子光学或热光学
- 事实条目是对公开资料的工程改写，引用时请回到 `source` 字段指向的原始文档核对
- 计算器给的是工程估算，不是设计终稿；正式设计请用自己的模型复核
- 16 条缺口条目只用来告诉你"这里没有依据"，不能当事实引用

## 许可

MIT。第三方资料版权归各原作者，本仓库只收录改写后的工程事实与来源标注。
