'use strict';
/* spectral/pigments.js — 合成颜料光谱数据（第一性原理两常数 K–M 模型）
 *
 * 合成模型：颜料光学由发色团化学决定——两常数 K–M 模型（与真实颜料光学一致）：
 *    K(λ) = κ_base + Σ_i A_i·g(λ; μ_i, σ_i)         吸收系数
 *    S(λ) = S_base（散射系数）
 *
 * 带形分两类（物理来源不同）：
 *   - 'g' 高斯吸收带：过渡金属 d–d 跃迁 / 有机 π–π* 宽带，参数 [A, μ, σ]；
 *   - 'e' 逻辑斯蒂下降吸收边：半导体型颜料的陡峭吸收边（黄/橙/红/土色
 *     系），参数 [A, λ₀, w]；λ < λ₀ 强吸收、λ > λ₀ 透明；
 *   - 'E' 逻辑斯蒂上升吸收边：红侧吸收（蓝/绿系）[A, λ₀, w]。
 *
 * 带位置（μ / λ₀）为第一性原理物理常数：黄/橙/红在蓝-绿区（~490–585 nm）
 * 陡吸收边（半导体带隙）、蓝/绿在红侧（~610–660 nm）上升边、品红在绿区
 * （~555 nm）吸收带、过渡金属与有机色料在可见区各特征跃迁带。
 *
 * 数值参考来源——公开测量数据标定（[Pascale 2012]：BabelColor X-Rite
 * ColorChecker Classic Avg30，30 张色卡平均、24 个配方色卡补丁、10 nm）：
 * 幅度/宽度/基底/散射等数值参数标定自该公开光谱经本管线（D65 × CIE 1931
 * 2° → sRGB）的渲染色（坐标下降，目标 ΔE00 ≤ 1.2、多数 ≤ 0.2）。K–M
 * 方程对任意反射光谱封闭，配方色卡光谱的有效 K/S 混色完全自洽；色卡面向
 * RGB 显示器设计，补丁渲染色全部落在 sRGB 色域内，无需显示校准，混色
 * 物理（黄×蓝→绿、深+白保色相）天然保持。数据来源：[Pascale 2012] BabelColor X-Rite ColorChecker Classic Avg30
 * （站点公开测量数据）。运行 tools/spectral/calibrate.js 可复现拟合目标
 * 与形状统计。
 *
 * 深色组（deep_*）为对应色相的高吸收低散射派生（L* 压暗，P5 深色+白
 * 套件需要）。全部 29 个颜料（24 色相 + 5 深色派生）由同一模型生成，
 * 参数保证色相覆盖与光谱行为。
 *
 * 波长网格：380–750 nm @ 10 nm（38 点），与 CIE 15:2004 标准表及 Mixbox
 * 论文（λ ∈ [380, 750]）一致，完整包含紫端 z̄ 与红端 x̄ 贡献。
 * 同时内嵌 CIE 标准数据（公开标准表，CIE 15:2004）：CIE 1931 2° 标准
 * 观察者与 D65 相对光谱功率分布（10 nm 网格）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PigmentData = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  /* 波长网格（nm，10 nm 间隔，380–750 nm，与 CIE 15:2004 及 Mixbox 论文一致） */
  var WAVELENGTHS = [];
  for (var w = 380; w <= 750; w += 10) WAVELENGTHS.push(w);

  /* CIE 1931 2° 标准观察者（x̄, ȳ, z̄），CIE 15:2004 Table 1（380–750 nm） */
  var CMF_2DEG = [
    [0.001368, 0.000039, 0.006450], [0.004243, 0.000120, 0.020050],
    [0.014310, 0.000396, 0.067850], [0.043510, 0.001210, 0.207400],
    [0.134380, 0.004000, 0.645600], [0.283900, 0.011600, 1.385600],
    [0.348280, 0.023000, 1.747060], [0.336200, 0.038000, 1.772110],
    [0.290800, 0.060000, 1.669200], [0.195360, 0.090980, 1.287640],
    [0.095640, 0.139020, 0.813000], [0.032010, 0.208020, 0.465180],
    [0.004900, 0.323000, 0.272000], [0.009300, 0.503000, 0.158200],
    [0.063270, 0.710000, 0.078250], [0.165500, 0.862000, 0.042160],
    [0.290400, 0.954000, 0.020300], [0.433450, 0.994950, 0.008750],
    [0.594500, 0.995000, 0.003900], [0.762100, 0.952000, 0.002100],
    [0.916300, 0.870000, 0.001650], [1.026300, 0.757000, 0.001100],
    [1.062200, 0.631000, 0.000800], [1.002600, 0.503000, 0.000340],
    [0.854450, 0.381000, 0.000190], [0.642400, 0.265000, 0.000050],
    [0.447900, 0.175000, 0.000020], [0.283500, 0.107000, 0.000000],
    [0.164900, 0.061000, 0.000000], [0.087400, 0.032000, 0.000000],
    [0.046770, 0.017000, 0.000000], [0.022700, 0.008210, 0.000000],
    [0.011359, 0.004102, 0.000000], [0.005790, 0.002091, 0.000000],
    [0.002899, 0.001047, 0.000000], [0.001440, 0.000520, 0.000000],
    [0.000690, 0.000249, 0.000000], [0.000332, 0.000120, 0.000000]
  ];

  /* D65 相对光谱功率分布（560 nm = 100），CIE 15:2004 Table T.2（380–750 nm） */
  var D65_SPD = [49.9755, 54.6482, 82.7549, 91.4860, 93.4318, 86.6770,
    104.8650, 117.0080, 117.8120, 114.8610, 115.9230, 108.8110, 109.3540,
    107.8020, 104.8650, 107.6890, 104.4050, 104.0460, 100.0000, 96.3342,
    95.7880, 88.6856, 90.0062, 89.5991, 87.6987, 83.2886, 83.6992, 80.0268,
    80.2146, 82.2778, 78.2842, 69.7216, 71.6091, 74.3490, 61.6040, 69.8856,
    75.0870, 63.5927];

  /* 合成模型参数。
   * 每个颜料：kBase 平坦吸收基底（K 单位）；bands 吸收带（见头注释）；
   * sBase 散射系数基准（K 同单位，相对值决定混色物理）。
   *
   * 29 个颜料 = 24 色相 + 5 深色派生（deep_*，P5 深色+白套件需要）。
   * 带结构按色相族第一性原理给定（位置为物理常数，见头注释）；幅度/
   * 宽度/基底/散射标定自公开测量数据（BabelColor X-Rite ColorChecker
   * Classic Avg30，[Pascale 2012]，见
   * calibrate.js 复现流程）。灰色阶（gray_*）为无带形的中性色（κ_base
   * 递增、sBase 递减），白色为高散射基底。
   */
  var PIGMENT_DEFS = [
  { id: 'white', name: 'White', kBase: 0.0128, sBase: 3, bands: [] },
  { id: 'black', name: 'Black', kBase: 0.5066, sBase: 0.034, bands: [] },
  { id: 'buff', name: 'Buff', kBase: 0.0996, sBase: 0.686, bands: [] },
  { id: 'gray_light', name: 'Gray light', kBase: 0.2302, sBase: 0.399, bands: [] },
  { id: 'gray_mid', name: 'Gray mid', kBase: 0.3574, sBase: 0.214, bands: [] },
  { id: 'gray_dark', name: 'Gray dark', kBase: 0.5066, sBase: 0.11, bands: [] },
  { id: 'gray_blue', name: 'Gray blue', kBase: 0.0648, sBase: 0.697, bands: [['g', 1.85, 600, 80], ['g', 0.42, 430, 72.2]] },
  { id: 'yellow_1', name: 'Yellow', kBase: 0.0165, sBase: 0.308, bands: [['e', 1.63, 495, 9.5], ['g', 0.42, 435, 38]] },
  { id: 'yellow_2', name: 'Yellow orange', kBase: 0.0284, sBase: 0.23, bands: [['e', 1.35, 515, 10], ['g', 0.12, 445, 48.3]] },
  { id: 'orange_1', name: 'Orange', kBase: 0.0244, sBase: 0.2, bands: [['e', 1.35, 525, 16.2], ['g', 0.27, 455, 50.72]] },
  { id: 'orange_2', name: 'Orange red', kBase: 0.0165, sBase: 0.308, bands: [['e', 0.83, 585, 11.4], ['g', 0.66, 540, 31.5], ['g', 0.13, 445, 28.9]] },
  { id: 'red_1', name: 'Red', kBase: 0.0181, sBase: 0.14, bands: [['e', 1, 585, 9.5], ['g', 0.69, 540, 25], ['g', 0.4, 440, 65.2]] },
  { id: 'red_2', name: 'Red brown', kBase: 0.0531, sBase: 0.236, bands: [['e', 1.7, 520, 25], ['g', 0.68, 575, 76]] },
  { id: 'magenta_1', name: 'Magenta', kBase: 0.0053, sBase: 0.24, bands: [['g', 1.8, 555, 31.59], ['g', 0.22, 435, 80]] },
  { id: 'magenta_2', name: 'Lavender', kBase: 0.1325, sBase: 0.517, bands: [['g', 0.66, 555, 80], ['g', 0.01, 445, 15]] },
  { id: 'purple_1', name: 'Purple', kBase: 0.1211, sBase: 0.165, bands: [['g', 1.47, 550, 74.8], ['g', 0.15, 435, 23.56]] },
  { id: 'blue_1', name: 'Blue deep', kBase: 0.0136, sBase: 0.143, bands: [['E', 1.63, 515, 16.16], ['g', 0.84, 660, 37.19], ['g', 0.14, 430, 28.5]] },
  { id: 'blue_2', name: 'Blue', kBase: 0.0141, sBase: 0.154, bands: [['g', 1.15, 610, 55], ['g', 0.14, 435, 30]] },
  { id: 'blue_3', name: 'Blue violet', kBase: 0.0825, sBase: 0.164, bands: [['g', 0.79, 565, 47.5], ['g', 0.51, 630, 42.4]] },
  { id: 'cyan_1', name: 'Cyan', kBase: 0.018, sBase: 0.308, bands: [['g', 0.53, 640, 60], ['g', 0.14, 435, 59.54]] },
  { id: 'green_1', name: 'Green', kBase: 0.0243, sBase: 0.169, bands: [['g', 0.35, 500, 28.93], ['E', 1.94, 610, 14.25], ['g', 1.06, 435, 40.25]] },
  { id: 'green_2', name: 'Yellow green', kBase: 0.0083, sBase: 0.147, bands: [['g', 0.2, 510, 17.69], ['E', 0.68, 620, 8.72], ['g', 0.87, 435, 47.25]] },
  { id: 'earth_1', name: 'Olive', kBase: 0.2131, sBase: 0.297, bands: [['e', 2.03, 495, 3], ['g', 1.3, 580, 42.29]] },
  { id: 'earth_2', name: 'Tan', kBase: 0.0064, sBase: 0.723, bands: [['e', 1.2, 490, 25], ['g', 0.53, 560, 52.25]] },
  { id: 'deep_blue', name: 'Deep blue', kBase: 0.0382, sBase: 0.048, bands: [['E', 1.63, 515, 11.96], ['g', 1.81, 660, 80], ['g', 0.12, 430, 28.5]] },
  { id: 'deep_red', name: 'Deep red', kBase: 0.0397, sBase: 0.057, bands: [['e', 3.12, 585, 9.02], ['g', 0.19, 540, 33.77], ['g', 1.02, 440, 56.73]] },
  { id: 'deep_green', name: 'Deep green', kBase: 0.0291, sBase: 0.03, bands: [['g', 0.07, 500, 15], ['E', 2.2, 610, 18.28], ['g', 2.54, 435, 49.61]] },
  { id: 'deep_magenta', name: 'Deep magenta', kBase: 0.0022, sBase: 0.06, bands: [['g', 2.67, 555, 40.51], ['g', 0.29, 435, 80]] },
  { id: 'deep_purple', name: 'Deep purple', kBase: 0.1228, sBase: 0.06, bands: [['g', 2.09, 550, 71.89], ['g', 0.13, 435, 17.44]] },
  ];

  /* 合成 K/S：按定义生成（确定性） */
  function synthesize(def) {
    var k = new Array(WAVELENGTHS.length);
    var s = new Array(WAVELENGTHS.length);
    for (var i = 0; i < WAVELENGTHS.length; i++) {
      var lam = WAVELENGTHS[i];
      var v = def.kBase;
      for (var b = 0; b < def.bands.length; b++) {
        var band = def.bands[b];
        var A = band[1], mu = band[2], sig = band[3];
        if (band[0] === 'g') {
          var d = (lam - mu) / sig;
          v += A * Math.exp(-d * d);
        } else if (band[0] === 'e') {
          v += A / (1 + Math.exp((lam - mu) / sig));
        } else { /* 'E' 上升边 */
          v += A / (1 + Math.exp(-(lam - mu) / sig));
        }
      }
      k[i] = v;
      var shp = 0;
      if (def.sBlue) shp = def.sBlue * Math.exp(-((lam - (def.sMu || 430)) / (def.sSig || 90)) *
        ((lam - (def.sMu || 430)) / (def.sSig || 90)));
      s[i] = def.sBase * (1 + shp);
    }
    return { k: k, s: s };
  }

  var KS_DATA = {};
  for (var i = 0; i < PIGMENT_DEFS.length; i++) {
    KS_DATA[PIGMENT_DEFS[i].id] = synthesize(PIGMENT_DEFS[i]);
  }

  return {
    WAVELENGTHS: WAVELENGTHS,
    CMF_2DEG: CMF_2DEG,
    D65_SPD: D65_SPD,
    PIGMENTS: PIGMENT_DEFS,
    KS_DATA: KS_DATA,
    /** 按 id 取颜料定义（找不到返回 null） */
    pigment: function (id) {
      for (var i = 0; i < PIGMENT_DEFS.length; i++) if (PIGMENT_DEFS[i].id === id) return PIGMENT_DEFS[i];
      return null;
    },
    /** 取颜料两常数 K/S（浅拷贝）：{ k: [36], s: [36] } */
    ksOf: function (id) {
      var ks = KS_DATA[id];
      if (!ks) return null;
      return { k: ks.k.slice(), s: ks.s.slice() };
    },
    /** 单常数视角：K/S(λ) 比值（两常数模型的等价 R∞ 比） */
    ksRatioOf: function (id) {
      var ks = KS_DATA[id];
      if (!ks) return null;
      var r = new Array(WAVELENGTHS.length);
      for (var i = 0; i < WAVELENGTHS.length; i++) r[i] = ks.k[i] / Math.max(ks.s[i], 1e-12);
      return r;
    }
  };
}));
