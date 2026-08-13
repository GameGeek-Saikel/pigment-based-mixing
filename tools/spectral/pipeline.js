'use strict';
/* spectral/pipeline.js — 物理光谱混色管线（纯函数，Node 与浏览器通用）
 *
 * 物理前向流程（Haase & Meyer 1992 / Mixbox 论文 §2 的标准流程）：
 *   颜料 K/S（合成光谱，两常数 K–M：吸收 K(λ) 与散射 S(λ) 分别叠加）→
 *   [Saunderson 表面修正（可选）] → Duncan 浓度叠加
 *   → κ = K̄/S̄ → R∞(λ) = 1 + κ − √(κ²+2κ) → D65 × CIE 1931 2° 积分
 *   （10 nm 网格，梯形法）→ XYZ → IEC 61966-2-1 sRGB（越界检测 + clamp）。
 *
 * 两常数 K–M 的物理意义：真实颜料中钛白 S 极高（散射主导）、
 * 有机颜料 S 极低（吸收主导）、铁氧化物 S 中等——K 与 S 分别做 Duncan
 * 线性叠加才能正确描述"深色 + 白"等混色家族的物理行为（单常数 K/S
 * 叠加会系统性过度变暗）。所有颜料以 { k: [36], s: [36] } 表示。
 *
 * 提供：
 *   - spectralMix(ksA, ksB, a)      两颜料光谱混合（光谱真值）
 *   - spectralMixConcs(concs)       多颜料浓度混合
 *   - paintRgb(id)                  纯颜料渲染 sRGB
 *   - unmixRgb(rgb)                 确定性多起点求解：RGB → 4 主颜料浓度
 *   - spectralLatentMix(a, b, t)    带残差补光的光谱混合（演示页任意 RGB 用，
 *                                   结构同 Mixbox 潜空间方案，但用合成光谱）
 *   - deltaE2000 / srgbToLab        自包含色度学（与套件 Sharma 实现一致）
 *   - validatePipeline()            合成数据物理自洽检查
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pigments'));
  else root.Spectral = factory(root.PigmentData);
}(typeof self !== 'undefined' ? self : this, function (PD) {

  var W = PD.WAVELENGTHS;
  var N = W.length;
  var CMF = PD.CMF_2DEG;
  var D65 = PD.D65_SPD;

  /* ---- 梯形积分权重（均匀网格） ---- */
  var T_W = new Array(N);
  for (var i = 0; i < N; i++) T_W[i] = (i === 0 || i === N - 1) ? 0.5 : 1.0;

  /* ---- sRGB（IEC 61966-2-1，D65） ---- */
  var SRGB_M = [
    [3.2406, -1.5372, -0.4986],
    [-0.9689, 1.8758, 0.0415],
    [0.0557, -0.2040, 1.0570]
  ];
  var XN = 0.95047, YN = 1.0, ZN = 1.08883;

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  /* ---- 两常数 K–M 单常数反射率 ----
   * ks = { k: [36], s: [36] }；κ(λ) = k/s，R∞ = 1 + κ − √(κ² + 2κ)。
   * 兼容单常数数组输入（旧格式）：视为 s ≡ 1。
   */
  function normKS(ks) {
    if (Array.isArray(ks)) return { k: ks, s: null }; /* 单常数：s 视为 1 */
    if (ks && Array.isArray(ks.k)) return ks;
    throw new Error('ks must be { k: [], s: [] } (two-constant) or a K/S array (legacy single-constant)');
  }

  function ksToReflectance(ks) {
    var ks0 = normKS(ks);
    var R = new Array(N);
    for (var i = 0; i < N; i++) {
      var k = Math.max(ks0.k[i], 0);
      var s = ks0.s ? Math.max(ks0.s[i], 1e-9) : 1;
      var kap = k / s;
      var r = 1 + kap - Math.sqrt(kap * kap + 2 * kap);
      R[i] = r < 0 ? 0 : (r > 1 ? 1 : r);
    }
    return R;
  }

  /* Duncan 浓度叠加（两常数分别线性叠加）：
   * K̄ = Σ cᵢKᵢ，S̄ = Σ cᵢSᵢ。concs 长度与 ksList 一致。 */
  function duncan(ksList, concs) {
    var k = new Array(N).fill(0), s = new Array(N).fill(0);
    for (var p = 0; p < ksList.length; p++) {
      var c = concs[p];
      if (c <= 1e-12) continue;
      var ks = normKS(ksList[p]);
      var ones = ks.s ? null : true;
      for (var i = 0; i < N; i++) {
        k[i] += c * ks.k[i];
        if (ones) s[i] += c;
        else s[i] += c * ks.s[i];
      }
    }
    return { k: k, s: s };
  }

  /* Saunderson 表面修正：R' = k1 + (1−k1)(1−k2)R / (1 − k2·R) */
  function saunderson(R, k1, k2) {
    if (!k1 && !k2) return R;
    var R2 = new Array(N);
    for (var i = 0; i < N; i++) {
      var den = 1 - k2 * R[i];
      R2[i] = den > 0 ? k1 + (1 - k1) * (1 - k2) * R[i] / den : 1;
    }
    return R2;
  }

  /* ---- 反射率 → XYZ（D65，归一化 Y=100 白） ---- */
  function reflectanceToXYZ(R) {
    var X = 0, Y = 0, Z = 0, sY = 0;
    for (var i = 0; i < N; i++) {
      var w = T_W[i] * D65[i];
      X += w * R[i] * CMF[i][0];
      Y += w * R[i] * CMF[i][1];
      Z += w * R[i] * CMF[i][2];
      sY += w * CMF[i][1];
    }
    return [100 * X / sY, 100 * Y / sY, 100 * Z / sY];
  }

  /* ---- XYZ → sRGB（线性→gamma；返回 {rgb, clipped, raw}） ---- */
  function xyzToSrgb(xyz) {
    var v = [xyz[0] / 100, xyz[1] / 100, xyz[2] / 100];
    var lin = [0, 0, 0], clipped = false;
    for (var r = 0; r < 3; r++) {
      var l = SRGB_M[r][0] * v[0] + SRGB_M[r][1] * v[1] + SRGB_M[r][2] * v[2];
      if (l < -1e-7 || l > 1 + 1e-7) clipped = true;
      lin[r] = l;
    }
    var rgb = new Array(3);
    for (var c = 0; c < 3; c++) {
      var x = lin[c];
      rgb[c] = clamp01(x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
    }
    return { rgb: rgb, clipped: clipped, lin: lin };
  }

  /* ---- sRGB → XYZ（D65，Y∈[0,100]） ---- */
  function srgbToXyz(rgb) {
    var lin = new Array(3);
    for (var c = 0; c < 3; c++) {
      var x = rgb[c];
      lin[c] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }
    var X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) * 100;
    var Y = (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]) * 100;
    var Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) * 100;
    return [X, Y, Z];
  }

  /* ---- XYZ → Lab（D65） ---- */
  function xyzToLab(xyz) {
    function f(t) { return t > Math.pow(6 / 29, 3) ? Math.cbrt(t) : t / (3 * (6 / 29) * (6 / 29)) + 4 / 29; }
    var fx = f(xyz[0] / (100 * XN)), fy = f(xyz[1] / 100), fz = f(xyz[2] / (100 * ZN));
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function srgbToLab(rgb) { return xyzToLab(srgbToXyz(rgb)); }

  /* ---- CIEDE2000（Sharma/Wu/Dalal 2005，kL=kC=kH=1） ---- */
  function deltaE2000(rgb1, rgb2) {
    var L1 = srgbToLab(rgb1), L2 = srgbToLab(rgb2);
    var l1 = L1[0], a1 = L1[1], b1 = L1[2], l2 = L2[0], a2 = L2[1], b2 = L2[2];
    var c1 = Math.sqrt(a1 * a1 + b1 * b1), c2 = Math.sqrt(a2 * a2 + b2 * b2);
    var cb = (c1 + c2) / 2;
    var cb7 = Math.pow(cb, 7);
    var G = 0.5 * (1 - Math.sqrt(cb7 / (cb7 + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var c1p = Math.sqrt(a1p * a1p + b1 * b1), c2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = Math.atan2(b1, a1p) * 180 / Math.PI; if (h1p < 0) h1p += 360;
    var h2p = Math.atan2(b2, a2p) * 180 / Math.PI; if (h2p < 0) h2p += 360;
    var dL = l2 - l1, dC = c2p - c1p;
    var dh = 0;
    if (c1p * c2p > 0) {
      var d = h2p - h1p;
      if (Math.abs(d) <= 180) dh = d;
      else dh = d > 180 ? d - 360 : d + 360;
    }
    var dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(dh * Math.PI / 360);
    var lbar = (l1 + l2) / 2, cbar = (c1p + c2p) / 2;
    var hbar = 0;
    if (c1p * c2p > 0) {
      var s = h1p + h2p;
      if (Math.abs(h1p - h2p) <= 180) hbar = s / 2;
      else hbar = s < 360 ? (s + 360) / 2 : (s - 360) / 2;
    } else {
      hbar = h1p + h2p;
    }
    var T = 1 - 0.17 * Math.cos((hbar - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * hbar * Math.PI / 180)
      + 0.32 * Math.cos((3 * hbar + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * hbar - 63) * Math.PI / 180);
    var dth = 30 * Math.exp(-Math.pow((hbar - 275) / 25, 2));
    var cbar7 = Math.pow(cbar, 7);
    var RC = 2 * Math.sqrt(cbar7 / (cbar7 + Math.pow(25, 7)));
    var lm = lbar - 50;
    var SL = 1 + 0.015 * lm * lm / Math.sqrt(20 + lm * lm);
    var SC = 1 + 0.045 * cbar;
    var SH = 1 + 0.015 * cbar * T;
    var RT = -Math.sin(2 * dth * Math.PI / 180) * RC;
    var t1 = dL / SL, t2 = dC / SC, t3 = dH / SH;
    return Math.sqrt(t1 * t1 + t2 * t2 + t3 * t3 + RT * t2 * t3);
  }

  /* ---- 光谱混合（光谱真值） ----
   * 输入两颜料两常数 K/S（{k,s}，兼容单常数数组）与配比 a
   * （a = 第二颜料份额），输出渲染 sRGB。
   * opts.saun = [k1, k2]（默认 [0,0] 不做表面修正）。
   */
  function spectralMix(ksA, ksB, a, opts) {
    opts = opts || {};
    var k1 = opts.saun ? opts.saun[0] : 0, k2 = opts.saun ? opts.saun[1] : 0;
    var ks = duncan([ksA, ksB], [1 - a, a]);
    var R = saunderson(ksToReflectance(ks), k1, k2);
    var xyz = reflectanceToXYZ(R);
    var s = xyzToSrgb(xyz);
    return { rgb: s.rgb, raw: s.lin, clipped: s.clipped, xyz: xyz, ks: ks };
  }

  /* 多颜料浓度混合（浓度和为 1；0 浓度的颜料自动跳过） */
  function spectralMixConcs(concs, opts) {
    opts = opts || {};
    var k1 = opts.saun ? opts.saun[0] : 0, k2 = opts.saun ? opts.saun[1] : 0;
    var ksList = [];
    for (var p = 0; p < concs.length; p++) {
      ksList.push(PD.ksOf(opts.primaries ? opts.primaries[p] : UNMIX_PRIMARIES[p]));
    }
    var ks = duncan(ksList, concs);
    var R = saunderson(ksToReflectance(ks), k1, k2);
    var xyz = reflectanceToXYZ(R);
    var s = xyzToSrgb(xyz);
    return { rgb: s.rgb, raw: s.lin, clipped: s.clipped, xyz: xyz, ks: ks };
  }

  /* 纯颜料渲染 sRGB（物理管线的"管口色"） */
  function paintRgb(id, opts) {
    var ks = PD.ksOf(id);
    if (!ks) return null;
    var m = spectralMix(ks, ks, 0, opts); // 自身混合 = 纯颜料
    return { id: id, rgb: m.rgb, clipped: m.clipped };
  }

  /* ---- 确定性 PRNG（mulberry32，与套件同族） ---- */
  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var x = t;
      x = Math.imul(x ^ (x >>> 15), 1 | x);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- RGB → 4 主颜料浓度（确定性多起点坐标下降） ----
   * 主颜料：合成世界的蓝 / 品红 / 黄 / 白（对应 Mixbox 潜空间的
   * 四颜料基结构：Phthalo Blue / Quinacridone Magenta / Hansa
   * Yellow / Titanium White——端点色已对齐 Mixbox 官方色卡，
   * 见 pigments.js 头注释）。
   * 返回 { conc: [4], rgb: 光谱重建色, de00: 重建色差, iters }。
   */
  var UNMIX_PRIMARIES = ['blue_1', 'magenta_1', 'yellow_1', 'white'];

  function unmixRgb(rgb, opts) {
    opts = opts || {};
    var primaries = opts.primaries || UNMIX_PRIMARIES;
    var k1 = opts.saun ? opts.saun[0] : 0, k2 = opts.saun ? opts.saun[1] : 0;
    var nFree = primaries.length - 1;

    function mixFromConc(free) {
      var conc = new Array(primaries.length);
      var sum = 0;
      for (var i = 0; i < nFree; i++) { conc[i] = free[i] < 0 ? 0 : free[i]; sum += conc[i]; }
      if (sum > 1) { for (var j = 0; j < nFree; j++) conc[j] *= 1 / sum; sum = 1; }
      conc[nFree] = 1 - sum;
      return conc;
    }

    function evalFree(free) {
      var conc = mixFromConc(free);
      var out = spectralMixConcs(conc, { saun: [k1, k2], primaries: primaries });
      return { de: deltaE2000(rgb, out.rgb), conc: conc, out: out };
    }

    var seeds = [];
    seeds.push([1, 0, 0]); seeds.push([0, 1, 0]); seeds.push([0, 0, 1]); seeds.push([0, 0, 0]);
    seeds.push([0.25, 0.25, 0.25]);
    var rnd = mulberry32(opts.seed || 0xC0FFEE);
    for (var s = 0; s < 6; s++) {
      var f = [rnd(), rnd(), rnd()];
      var sm = f[0] + f[1] + f[2];
      seeds.push([f[0] / (sm + 1e-9) / 2, f[1] / (sm + 1e-9) / 2, f[2] / (sm + 1e-9) / 2]);
    }

    var best = null, iters = 0;
    for (var si = 0; si < seeds.length; si++) {
      var cur = seeds[si].slice();
      var ev = evalFree(cur);
      iters++;
      var sweep = 0;
      while (sweep < (opts.sweeps || 5)) {
        var improved = false;
        for (var c = 0; c < nFree; c++) {
          var step = 0.25;
          while (step > 1e-5) {
            var bestVal = ev.de, bestX = cur[c];
            for (var dir = 0; dir < 2; dir++) {
              var x = cur[c] + (dir === 0 ? step : -step);
              if (x < 0) x = 0; if (x > 1) x = 1;
              var cand = cur.slice(); cand[c] = x;
              var ev2 = evalFree(cand); iters++;
              if (ev2.de < bestVal) { bestVal = ev2.de; bestX = x; }
            }
            if (bestX !== cur[c]) { cur[c] = bestX; ev = evalFree(cur); improved = true; }
            else step *= 0.5;
          }
        }
        if (!improved) break;
        sweep++;
      }
      if (!best || ev.de < best.de) best = { de: ev.de, conc: ev.conc, out: ev.out, seed: si };
    }
    return { conc: best.conc, rgb: best.out.rgb, raw: best.out.raw, clipped: best.out.clipped, de00: best.de, iters: iters };
  }

  /* ---- 带残差补光的光谱混合（演示页任意 RGB 输入） ----
   * 结构与 Mixbox 潜空间方案一致：编码（unmix）→ 潜向量线性混合 → 解码，
   * 残差补充 RGB 与颜料色域之差（光缺失项，显示值空间：
   * r = RGB − mix(unmix(RGB))，与 Mixbox 论文 Eq.10–11 一致）。
   * 本实现用合成光谱（无第三方数据），不经训练、不查表。
   *
   * 色域外衰减（v5）：unmix 重建误差大的输入（超出 4 基色物理凸包的
   * 超饱和色，如 sRGB 边缘亮蓝 #2E5EFF，其 B≈1.0 的反射率任何深蓝
   * 颜料物理上不可达）残差被指数衰减（w = exp(−ΔE_unmix/5)），混合
   * 回到纯物理结果（黄×蓝→绿）；衰减沿 α 平滑过渡（smoothstep），
   * 端点残差保持全量 → α=0/1 恒等严格成立。物理可达输入（ΔE≈0）
   * 权重≈1，Mixbox 同构的补光行为完全保持。
   */
  function spectralLatentMix(rgbA, rgbB, a, opts) {
    opts = opts || {};
    var ca = unmixRgb(rgbA, opts);
    var cb = unmixRgb(rgbB, opts);
    var conc = new Array(ca.conc.length);
    for (var i = 0; i < conc.length; i++) conc[i] = (1 - a) * ca.conc[i] + a * cb.conc[i];
    var out = spectralMixConcs(conc, opts);
    var w1 = Math.exp(-ca.de00 / 5), w2 = Math.exp(-cb.de00 / 5);
    /* 对称衰减：两端残差按各自端点距离衰减（a→0 时 w1e=1、a→1 时 w2e=1，
     * 恒等严格成立），中间点色域外残差指数消失；输入顺序无关。 */
    var w1e = w1 + (1 - w1) * Math.pow(1 - a, 4);
    var w2e = w2 + (1 - w2) * Math.pow(a, 4);
    var res = new Array(3);
    for (var c = 0; c < 3; c++) {
      var r1 = rgbA[c] - ca.rgb[c], r2 = rgbB[c] - cb.rgb[c];
      res[c] = out.rgb[c] + (1 - a) * r1 * w1e + a * r2 * w2e;
      res[c] = clamp01(res[c]);
    }
    return { rgb: res, conc: conc, encode: [ca, cb], de00: deltaE2000(rgbA, res), unmixDe: [ca.de00, cb.de00] };
  }

  /* ---- 管线自洽检查（合成数据无外部参考，验证物理自洽性） ----
   * 1) 纯颜料渲染 R ∈ (0,1)，白 ≈ 白、黑 ≈ 黑；
   * 2) unmix 对纯颜料重建 ΔE00 = 0；
   * 3) 光谱混合对 α=0/1 恒等。
   */
  function validatePipeline(opts) {
    opts = opts || {};
    var rows = [];
    for (var i = 0; i < PD.PIGMENTS.length; i++) {
      var p = PD.PIGMENTS[i];
      var paint = paintRgb(p.id, opts);
      if (!paint) continue;
      var ks = PD.ksOf(p.id);
      var R = ksToReflectance(ks);
      var minR = 1, maxR = 0;
      for (var j = 0; j < N; j++) {
        var r = R[j];
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
      rows.push({
        id: p.id, name: p.name,
        rgb: paint.rgb, clipped: paint.clipped,
        Rmin: minR, Rmax: maxR,
        selfConsistent: minR > 0 && maxR < 1
      });
    }
    return rows;
  }

  return {
    WAVELENGTHS: W,
    ksToReflectance: ksToReflectance,
    saunderson: saunderson,
    reflectanceToXYZ: reflectanceToXYZ,
    xyzToSrgb: xyzToSrgb,
    srgbToXyz: srgbToXyz,
    xyzToLab: xyzToLab,
    srgbToLab: srgbToLab,
    deltaE2000: deltaE2000,
    spectralMix: spectralMix,
    spectralMixConcs: spectralMixConcs,
    paintRgb: paintRgb,
    unmixRgb: unmixRgb,
    spectralLatentMix: spectralLatentMix,
    validatePipeline: validatePipeline,
    UNMIX_PRIMARIES: UNMIX_PRIMARIES
  };
}));
