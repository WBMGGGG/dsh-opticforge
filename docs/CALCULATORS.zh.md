# OpticForge 计算器完整说明（5 类）

> 实现于 `lib/calculators.js`（纯 Node ESM，零运行时依赖，绝不抛异常）。本文所有数值均为实跑输出，与代码一致。

## 通用返回结构

所有分支同形：`type / ok / formula / substitution / steps / result / source` 必填，`notes / error / suggestion` 可选。参数不足或非法时 `ok=false` 并给出中文 `error` 与 `suggestion`（含"建议/需要/缺少"类提示词），**不编造数值**。参数别名由 `normalizeParams()` 自动映射（如 `lambda_nm` = `lambda`、`dndT` = `dn_dT`、`deltaT` = `delta_T`、`range_min_mm` = `range_min` 等）。

---

## 1. `diffraction_limit` 衍射极限

- **公式**：`d = 1.22 × λ / NA`（艾里斑第一暗环直径；Rayleigh 两点判据常取 0.61λ/NA，为 d/2）
- **参数**：`lambda`（波长，配 `lambda_unit`，默认 nm）、`NA`（数值孔径，0<NA≤1.5 典型）
- **示例**：`{"type":"diffraction_limit","params":{"lambda":550,"lambda_unit":"nm","NA":0.95}}`
- **实跑输出要点**：`result.value = 706.3158`（nm），`airy_radius = 353.1579`，`numerator_1_22_lambda = 671`；steps 6 步含公式→代入→分子→除法→结果→半径校核。
- **708 裁决**：方案示例 708 nm 疑笔误，作为 `plan_example_d_nm=708` 如实标注，精确值不改动公式去凑。
- **来源**：通用光学公式（Rayleigh 判据 / Airy 斑）；KB 参考 A02-03。

## 2. `coating_thermal_drift` 镀膜中心波长温漂

- **公式**：`Δλ/λ ≈ (dn/dT + α) × ΔT`
- **参数**：`lambda`、`dn_dT`（折射率温度系数 /K）、`alpha`（热膨胀系数 /K）、`delta_T`（温度变化 K）
- **示例**：`{"type":"coating_thermal_drift","params":{"lambda":1064,"dn_dT":1e-5,"alpha":5e-7,"delta_T":40}}`
- **实跑输出要点**：`relative_drift = 4.2e-4`，`delta_lambda ≈ 0.4469 nm`（红移）。热光项 4e-4 是热膨胀项 2e-5 的 **20 倍**——量级上 dn/dT 主导。notes 给出 TiO₂ dn/dT≈+8e-5/K、SiO₂≈+1e-5/K（均为正），选 dn/dT 符号相反的膜系材料做热补偿。
- **来源**：通用光学薄膜公式；KB 参考 B02 镀膜相关块。

## 3. `confocal_range_select` 共焦量程选型

- **判据**（三步）：①量程覆盖 → ②静态分辨率满足精度 → ③线性度满足要求
- **参数**：`range_min`/`range_max`（配 `unit`，默认 mm）、`accuracy`（配 `accuracy_unit`，nm/µm）、`material`（反射/散射/透明）
- **示例**：`{"type":"confocal_range_select","params":{"range_min":0,"range_max":1,"unit":"mm","accuracy":100,"accuracy_unit":"nm","material":"反射"}}`
- **实跑输出要点**：推荐 **IFS2402-1.5**（1.5mm 档：静态分辨率 <30nm 满足 100nm 精度；线性度 <±0.6µm）。**如实报告**："线性度 600nm 不满足 100nm 精度要求"——不隐瞒规格缺陷。
- **规格来源**：A01-02 IFS2402 规格表（0.5/1.5/3.5mm 档，静态 <8/<30/<50 nm，线性度 <±0.15/±0.60/±1.40 µm）。运行时优先从包内 `data/kb-data.json` 的 A01-02 正文解析（`live` 模式）；可用环境变量 `OPTICFORGE_KB_PATH` 指向外部全量源；解析失败回退内置副本并在 source/uncertainty 如实标注。不编造表外型号。

## 4. `tolerance_rss` 公差 RSS 合成

- **公式**：`σ_total = √(Σ σᵢ²)`
- **参数**：`tolerances`（正数数组）、`unit`（默认 µm）
- **示例**：`{"type":"tolerance_rss","params":{"tolerances":[0.5,0.3,0.2],"unit":"µm"}}`
- **实跑输出要点**：`rss = 0.6164 µm`（≈0.62）；notes 对照**最差线性叠加** 1.0 µm，说明 RSS 是独立随机变量的统计合成、非最差情况。
- **来源**：B01-01 公差分析概述。

## 5. `na_resolution` 数值孔径与分辨率

- **公式**：`δ = 0.61 × λ / NA`（Rayleigh）；共焦模式提升 ≈1/√2
- **参数**：`lambda`、`NA`
- **示例**：`{"type":"na_resolution","params":{"lambda":550,"lambda_unit":"nm","NA":0.95}}`
- **实跑输出要点**：`rayleigh = 353.1579 nm`，`lambda_over_2NA = 289.4737`，`confocal ≈ 249.7203`。
- **来源**：通用光学公式；KB 参考 A01-02（NA 关联）与 A02-03。

---

## 错误处理（全部实测）

| 输入 | 行为 |
|---|---|
| 未知 `type`（如 `"not_exist"`） | `ok=false`，`error` 说明未知类型，`suggestion` 列出 5 个合法值；**不抛异常** |
| 缺参（如 `diffraction_limit` 空 params） | `ok=false`，`error` 指出缺少的参数，`suggestion` 给出参数名与合理范围 |
| 非法值（`lambda:0` / `NA:0` / `tolerances:[]` / `tolerances:"bad"`） | `ok=false`，结构化返回七键，不抛异常 |

工具层（`opticforge_calc`）另有 defineTool `parameters.type` 的 enum 校验：非法 type 在进入 calculate() 之前就被干净拒绝（抛 ToolArgsError 属框架合法行为）；两层契约都有测试覆盖（test D6b、verify-all 未知 type 两层断言）。
