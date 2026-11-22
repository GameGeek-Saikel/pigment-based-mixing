# 实现说明

本文件记录实现层面的工程约定与测量注意事项，不重复论文内容。

## 测量

- 性能必须在宿主 V8 上下文（`require` / `new Function`）中测量。`node:vm` 上下文内 `Math.*` 比宿主慢 50–100 倍（sqrt 1.8→62 ns、pow 0.7→69 ns），实测把 PBM 放大 8.9×、参考放大 8.7×，而纯算术的 RGB 插值几乎不受影响。`tools/run-bench.js` 默认在宿主中计时，`--vm-control` 复现该假象用于审计。
- 精度评估在 `tools/suite-loader.js` 的 vm 沙箱中执行（只影响速度，不影响数值）。
- `node tools/run-regression.js` 断言 20 项指标（8 套件 mean/max、端点恒等、交换对称、邻域连续性、CIEDE2000 复刻）；基线由 `--update` 生成，只随已审阅的算法改动更新。

## 工具

| 脚本 | 用途 |
|---|---|
| `tools/run-bench.js` | 单次混色运行时间（PBM / Mixbox / RGB 插值 / 光谱 K–M 两条路径） |
| `tools/run-heldout.js` | 样本内与留出指标、bootstrap 区间 |
| `tools/run-ablation.js` | 组件消融（补丁目标从库源码正则提取，重拟合后不会失效） |
| `tools/run-sensitivity.js` | 门控阈值敏感性 |
| `tools/run-continuity-probe.js` | 邻域连续性 |
| `tools/fit-gamma.js` | 谐波系数线性拟合与评估（`--basis old|trigfree`、`--pnorm`、`--seeds`、`--emit`） |
| `tools/run-figures.js` 等 | 论文插图 |

## 试过但未采纳

| 方案 | 结果 |
|---|---|
| `resE` 三次 Hermite 包络 | 导数连续正确，但比二次包络慢约 6%，且 T5 均值略差 |
| `σ_k/σ_8` 改 smoothstep | T3 +0.025、T5 +0.067、最大 6.1→7.4；与门阈值耦合，需联合重拟合 |
| 核心输出矩阵改用自由 3×3 并联合重拟合 | 端到端只换来 T1 最大值 26.1→20.7，T3/T5E 变差 |
| K/S 波段从 3 增到 4（3×4 前向 + 4→3 回映射） | 优化把第 4 列压到 0：加 K/S 波段不等于加潜空间维度 |
| 谐波拟合的 p 范数（p=4/8，RGB 与 CIEDE2000 残差） | 同时恶化均值与最大值 |
| `Math.pow` → `log`+`exp` | JS 中无收益（pow 15.4 ns vs log+exp 20.5 ns） |

## 已知缺口

- 误差结构：最坏 5% 样本按 CIELAB 分解以色相与色度（跨通道）为主，而非明度。参考模型的 7 维潜空间中多出的是 3 个**加性残差**通道，不是光谱波段；要进一步降低尾端误差，需要在模型侧引入残差通道，而不是加 K/S 波段。
- 近中性深色（`maxd` 小于门控阈值）仅由核心混色，是 T5E 最大值 9.5 的来源。
