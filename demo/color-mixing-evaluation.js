/* =====================================================================
 * color-mixing-evaluation.js — 评估套件 + 页面 UI
 *
 * 算法来自 ../javascript/color-mixing.js（window.ColorMixing.mixPbm）。
 * 本文件只包含评估所需的部分：色度度量（CIELAB / ΔE76 / CIEDE2000，
 * 含 Sharma 34 对复刻校验）、对照模型（RGB 插值 / 显示值 Kubelka–Munk）、
 * T1–T5E 测试集、__Suite 导出，以及评估页 UI。
 *
 * 浏览器：<script src="../javascript/color-mixing.js"></script>
 *         <script src="color-mixing-evaluation.js"></script>
 * Node：  tools/suite-loader.js 无头加载（vm）。
 * =================================================================== */
'use strict';
const { mixPbm } = ColorMixing;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (A, B, t) => [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
const HEX2RGB = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];

/* ---- 色度度量：sRGB 显示值 → CIELAB（D65），ΔE76 / ΔE00 ---- */
const SRGB2LIN = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const LABF = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
function rgbToLab(rgb){
  const r = SRGB2LIN(rgb[0]), g = SRGB2LIN(rgb[1]), b = SRGB2LIN(rgb[2]);
  let x = 0.4124564*r + 0.3575761*g + 0.1804375*b;
  let y = 0.2126729*r + 0.7151522*g + 0.0721750*b;
  let z = 0.0193339*r + 0.1191920*g + 0.9503041*b;
  x /= 0.95047; z /= 1.08883;
  const fx = LABF(x), fy = LABF(y), fz = LABF(z);
  return [116*fy - 16, 500*(fx - fy), 200*(fy - fz)];
}
const de76 = (a, b) => {
  const x = rgbToLab(a), y = rgbToLab(b);
  return Math.hypot(x[0]-y[0], x[1]-y[1], x[2]-y[2]);
};
/* CIEDE2000（Sharma/Wu/Dalal 2005 实现说明，kL=kC=kH=1） */
const D2R = Math.PI / 180;
function deltaE2000(lab1, lab2){
  const [L1,a1,b1] = lab1, [L2,a2,b2] = lab2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar,7) / (Math.pow(Cbar,7) + Math.pow(25,7))));
  const a1p = (1+G)*a1, a2p = (1+G)*a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  let h1p = Math.atan2(b1, a1p) / D2R; if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) / D2R; if (h2p < 0) h2p += 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * D2R);
  const Lbarp = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;
  const T = 1 - 0.17*Math.cos((hbarp-30)*D2R) + 0.24*Math.cos(2*hbarp*D2R)
              + 0.32*Math.cos((3*hbarp+6)*D2R) - 0.20*Math.cos((4*hbarp-63)*D2R);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(Cbarp,7) / (Math.pow(Cbarp,7) + Math.pow(25,7)));
  const SL = 1 + 0.015*Math.pow(Lbarp-50, 2) / Math.sqrt(20 + Math.pow(Lbarp-50, 2));
  const SC = 1 + 0.045*Cbarp;
  const SH = 1 + 0.015*Cbarp*T;
  const RT = -Math.sin(2*dTheta*D2R) * RC;
  const tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
  return Math.sqrt(tL*tL + tC*tC + tH*tH + RT*tC*tH);
}
/* Sharma (2005) 34 组参考色差对（公开学术参考数据，见评估方法学文档） */
const SHARMA = [
  [50.0000,2.6772,-79.7751, 50.0000,0.0000,-82.7485, 2.0425],
  [50.0000,3.1571,-77.2803, 50.0000,0.0000,-82.7485, 2.8615],
  [50.0000,2.8361,-74.0200, 50.0000,0.0000,-82.7485, 3.4412],
  [50.0000,-1.3802,-84.2814, 50.0000,0.0000,-82.7485, 1.0000],
  [50.0000,-1.1848,-84.8006, 50.0000,0.0000,-82.7485, 1.0000],
  [50.0000,-0.9009,-85.5211, 50.0000,0.0000,-82.7485, 1.0000],
  [50.0000,0.0000,0.0000, 50.0000,-1.0000,2.0000, 2.3669],
  [50.0000,-1.0000,2.0000, 50.0000,0.0000,0.0000, 2.3669],
  [50.0000,2.4900,-0.0010, 50.0000,-2.4900,0.0009, 7.1792],
  [50.0000,2.4900,-0.0010, 50.0000,-2.4900,0.0010, 7.1792],
  [50.0000,2.4900,-0.0010, 50.0000,-2.4900,0.0011, 7.2195],
  [50.0000,2.4900,-0.0010, 50.0000,-2.4900,0.0012, 7.2195],
  [50.0000,-0.0010,2.4900, 50.0000,0.0009,-2.4900, 4.8045],
  [50.0000,-0.0010,2.4900, 50.0000,0.0010,-2.4900, 4.8045],
  [50.0000,-0.0010,2.4900, 50.0000,0.0011,-2.4900, 4.7461],
  [50.0000,2.5000,0.0000, 50.0000,0.0000,-2.5000, 4.3065],
  [50.0000,2.5000,0.0000, 73.0000,25.0000,-18.0000, 27.1492],
  [50.0000,2.5000,0.0000, 61.0000,-5.0000,29.0000, 22.8977],
  [50.0000,2.5000,0.0000, 56.0000,-27.0000,-3.0000, 31.9030],
  [50.0000,2.5000,0.0000, 58.0000,24.0000,15.0000, 19.4535],
  [50.0000,2.5000,0.0000, 50.0000,3.1736,0.5854, 1.0000],
  [50.0000,2.5000,0.0000, 50.0000,3.2972,0.0000, 1.0000],
  [50.0000,2.5000,0.0000, 50.0000,1.8634,0.5757, 1.0000],
  [50.0000,2.5000,0.0000, 50.0000,3.2592,0.3350, 1.0000],
  [60.2574,-34.0099,36.2677, 60.4626,-34.1751,39.4387, 1.2644],
  [63.0109,-31.0961,-5.8663, 62.8187,-29.7946,-4.0864, 1.2630],
  [61.2901,3.7196,-5.3901, 61.4292,2.2480,-4.9620, 1.8731],
  [35.0831,-44.1164,3.7933, 35.0232,-40.0716,1.5901, 1.8645],
  [22.7233,20.0904,-46.6940, 23.0331,14.9730,-42.5619, 2.0373],
  [36.4612,47.8580,18.3852, 36.2715,50.5065,21.2231, 1.4146],
  [90.8027,-2.0831,1.4410, 91.1528,-1.6435,0.0447, 1.4441],
  [90.9257,-0.5406,-0.9208, 88.6381,-0.8985,-0.7239, 1.5381],
  [6.7747,-0.2908,-2.4247, 5.8714,-0.0985,-2.2286, 0.6377],
  [2.0776,0.0795,-1.1350, 0.9033,-0.0636,-0.5514, 0.9082]
];
function validateDeltaE2000(){
  let maxAbs = 0, worst = null;
  for (const row of SHARMA){
    const [L1,a1,b1, L2,a2,b2, ref] = row;
    const got = deltaE2000([L1,a1,b1], [L2,a2,b2]);
    const dev = Math.abs(got - ref);
    if (dev > maxAbs){ maxAbs = dev; worst = {i: SHARMA.indexOf(row), ref, got, dev}; }
  }
  return { maxAbsDev: maxAbs, worst, pass: maxAbs < 0.001, n: SHARMA.length };
}

/* ---- 确定性随机（mulberry32） ---- */
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---- 被测模型（入参/出参均为 sRGB 显示值浮点 [0,1]，与参考系同空间） ---- */
/* ② RGB 插值（基准对照） */
function mixLerp(base, tint, a){ return lerp3(base, tint, a); }
/* ③ Kubelka–Munk 双参数（K/S 分开叠加，演示页现行实现） */
function kmDual(a0, b0, t){
  const K = v => { const d = 1 - v; return d * d / 2; };
  const S = v => Math.max(v, 0.005);
  const R = f => 1 + f - Math.sqrt(f*f + 2*f);
  const mix = (ka, kb, sa, sb) => {
    const k = ka + (kb - ka) * t, s = sa + (sb - sa) * t;
    return R(k / s);
  };
  return [mix(K(a0[0]),K(b0[0]),S(a0[0]),S(b0[0])),
          mix(K(a0[1]),K(b0[1]),S(a0[1]),S(b0[1])),
          mix(K(a0[2]),K(b0[2]),S(a0[2]),S(b0[2]))];
}

const MODELS = [
  { name: '我们的方法（PBM）', fn: mixPbm, note: 'K-M 核心 + 逐通道幂律插值（唯一算法）' },
  { name: 'RGB 插值', fn: mixLerp, note: '基准' },
  { name: 'Kubelka–Munk', fn: kmDual, note: 'K/S 叠加' },

];

/* ---- 测试集 ---- */
const PRESETS_BASE = [['白','#F2F2EF'],['灰','#8A8A93'],['黑','#141417'],['红','#E23B3B'],['橙','#F07A2A'],['黄','#F0C94B'],['绿','#3FA76F'],['青','#3AA8B8'],['蓝','#3B6FE0'],['紫','#8A5BE0']];
const PRESETS_TINT = [['镉黄','#FFD61A'],['群青','#2E5EFF'],['朱红','#E8321F'],['翠绿','#00B359'],['品红','#E33BA8'],['橙红','#FF7A1A'],['青','#00D5C0'],['白','#FFFFFF']];
const ALPHAS = [0.25, 0.5, 0.75];
/* T5 深色+白 专项：高饱和深色 × 钛白(#FFFFFF)，全 α 扫描（0.1~0.9 步进 0.1）。
 * 量化定义：max 通道 ∈ [0.30,0.60]（近黑软门之上、家族亮端阈值之下）、
 * min ≤ 0.08、色度范围 max−min ≥ 0.25；痛点色（含近黑边界）无条件保留。
 * 随机深色：mulberry32 独立 seed 20260810（与 T3 的 20260808 区分），拒绝采样。 */
const ALPHAS_T5 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const T5_SEED = 20260810;
const T5_RANDOM_N = 24;
const T5_DEF = [
  // 痛点色（历史验证点，与拟合记录可比；含近黑软门边界 #280501/#250903）
  ['深色+白', '#0D1B44'], ['深色+白', '#000080'], ['深色+白', '#001B75'], ['深色+白', '#001E80'],
  ['深色+白', '#080248'], ['深色+白', '#5F1708'], ['深色+白', '#5E0F1A'], ['深色+白', '#4A3A05'],
  ['深色+白', '#280501'], ['深色+白', '#250903'],
  // 家族扩展（严格满足量化定义，门控为通道结构公式，家族覆盖必要）
  ['深色+白', '#0A2A6E'], ['深色+白', '#8E1F0A'], ['深色+白', '#005A32'], ['深色+白', '#00552B'],
  ['深色+白', '#00585E'], ['深色+白', '#2A0A5E'], ['深色+白', '#4A0B6E'], ['深色+白', '#6E0B4A'],
  ['深色+白', '#7A3B00'], ['深色+白', '#6E4A00']
];
const T2_DEF = [
  ['互补对', '#E8321F', '#00D5C0'], ['互补对', '#FFD61A', '#2E5EFF'], ['互补对', '#E33BA8', '#00B359'],
  ['RYB错配', '#E8321F', '#00B359'], ['RYB错配', '#2E5EFF', '#FF7A1A'], ['RYB错配', '#E8321F', '#2E5EFF'],
  ['RYB错配', '#FFD61A', '#00B359'], ['RYB错配', '#FFD61A', '#00D5C0'], ['RYB错配', '#E33BA8', '#00D5C0'],
  ['白黑混合', '#E8321F', '#FFFFFF'], ['白黑混合', '#2E5EFF', '#FFFFFF'], ['白黑混合', '#FFD61A', '#FFFFFF'],
  ['白黑混合', '#E8321F', '#000000'], ['白黑混合', '#2E5EFF', '#000000'], ['白黑混合', '#00B359', '#000000'],
  ['相似色', '#E8321F', '#FF7A1A'], ['相似色', '#FFD61A', '#FF7A1A'], ['相似色', '#2E5EFF', '#8A5BE0'], ['相似色', '#00B359', '#00D5C0']
];
function buildT1(){
  const out = [];
  for (const [, hb] of PRESETS_BASE)
    for (const [, ht] of PRESETS_TINT)
      for (const a of ALPHAS)
        out.push({ set: 'T1', cat: '调色板', base: HEX2RGB(hb), tint: HEX2RGB(ht), a });
  return out;
}
function buildT2(){
  const out = [];
  for (const [cat, hb, ht] of T2_DEF)
    for (const a of ALPHAS)
      out.push({ set: 'T2', cat, base: HEX2RGB(hb), tint: HEX2RGB(ht), a });
  return out;
}
function buildT3(seed, n){
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++)
    out.push({ set: 'T3', cat: '随机',
      base: [rnd(), rnd(), rnd()], tint: [rnd(), rnd(), rnd()], a: rnd() });
  return out;
}
/* T5 随机深色：拒绝采样，直到满足量化定义（max∈[0.30,0.60]、min≤0.08、maxd≥0.25），
 * 每对展开为 ALPHAS_T5 全 α 扫描样本 */
function buildT5Random(seed, n){
  const rnd = mulberry32(seed);
  const out = [];
  let guard = 0;
  while (out.length < n * ALPHAS_T5.length && guard++ < 100000){
    const v = [rnd(), rnd(), rnd()];
    const mx = Math.max(v[0], v[1], v[2]), mn = Math.min(v[0], v[1], v[2]);
    if (mx < 0.30 || mx > 0.60 || mn > 0.08 || (mx - mn) < 0.25) continue;
    for (const a of ALPHAS_T5)
      out.push({ set: 'T5', cat: '深色+白·随机', base: v, tint: [1, 1, 1], a });
  }
  return out;
}
function buildT5(){
  const out = [];
  for (const [cat, hb] of T5_DEF)
    for (const a of ALPHAS_T5)
      out.push({ set: 'T5', cat, base: HEX2RGB(hb), tint: [1, 1, 1], a });
  out.push(...buildT5Random(T5_SEED, T5_RANDOM_N));
  return out;
}
/* T5E 双侧尾端专项（φ 动态进度的监督集）：
 * 深重侧 α∈{0.001..0.1}：T5 原 α 网格从 0.1 起步，深重尾端完全无覆盖（φ 动态进度前
 *   #FFFFFF+#0D1B44 α=0.99 实测 ΔE 2.6——"99% 更像 99.9%"）；色度深色走修复分支 a_eff→0，
 *   近中性深色（maxd<0.0648 盲区，gate=0）走纯核心。
 * 浅重侧 α∈{0.92..0.99}×近中性深色：盲区浅重侧（#F2F2EF+#000B2E α=0.05 实测 ΔE 6.5）。
 * 近中性深色量化定义：max∈[0.04,0.10]、maxd∈[0.02,0.06]（深白门 maxd≥0.0648 之下）。 */
const T5E_DEEP_ALPHAS = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1];
const T5E_LIGHT_ALPHAS = [0.92, 0.95, 0.98, 0.99];
const T5E_SEED = 20260816;
const T5E_RANDOM_N = 8;
const T5E_NEAR_NEUTRAL_FIXED = ['#000B2E', '#06052E', '#1A0F22', '#0A1A18'];
function buildT5ENearNeutral(seed, n){
  const rnd = mulberry32(seed);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 100000){
    const v = [rnd(), rnd(), rnd()];
    const mx = Math.max(v[0], v[1], v[2]), mn = Math.min(v[0], v[1], v[2]);
    if (mx < 0.04 || mx > 0.10 || (mx - mn) < 0.02 || (mx - mn) > 0.06) continue;
    out.push(v);
  }
  return out;
}
function buildT5E(){
  const out = [];
  for (const [cat, hb] of T5_DEF)
    for (const a of T5E_DEEP_ALPHAS)
      out.push({ set: 'T5E', cat: '深重侧·色度', base: HEX2RGB(hb), tint: [1, 1, 1], a });
  const nearNeutral = [...T5E_NEAR_NEUTRAL_FIXED.map(HEX2RGB), ...buildT5ENearNeutral(T5E_SEED, T5E_RANDOM_N)];
  for (const v of nearNeutral)
    for (const a of T5E_DEEP_ALPHAS)
      out.push({ set: 'T5E', cat: '深重侧·近中性', base: v, tint: [1, 1, 1], a });
  for (const v of nearNeutral)
    for (const a of T5E_LIGHT_ALPHAS)
      out.push({ set: 'T5E', cat: '浅重侧·近中性', base: v, tint: [1, 1, 1], a });
  return out;
}

/* ---- 评估 ---- */
function statsOf(es){
  if (!es.length) return null;
  const s76 = es.map(e => e.de76).sort((x,y) => x - y);
  const s00 = es.map(e => e.de00).sort((x,y) => x - y);
  const sum = a => a.reduce((x,y) => x + y, 0);
  const p95 = a => a[Math.min(a.length - 1, Math.ceil(0.95 * a.length) - 1)];
  return {
    n: es.length,
    de76: { max: s76[s76.length-1], mean: sum(s76)/s76.length, p95: p95(s76) },
    de00: { max: s00[s00.length-1], mean: sum(s00)/s00.length, p95: p95(s00) }
  };
}
function evaluateSet(model, samples, ref){
  return samples.map(s => {
    const m = model.fn(s.base, s.tint, s.a);
    const r = ref(s.base, s.tint, s.a);
    return { base: s.base, tint: s.tint, a: s.a, m, r, de76: de76(m, r), de00: deltaE2000(rgbToLab(m), rgbToLab(r)) };
  });
}
function runT4(model){
  const colors = [
    [1,1,1],[0,0,0],[1,0,0],[0,1,0],[0,0,1],[0.5,0.5,0.5],[1,1,0],[0,1,1],[1,0,1],[1,0.5,0]
  ];
  let maxErr = 0, worst = null;
  for (const c of colors){
    for (const a of [0, 1]){
      const r = model.fn(c, c, a);
      const err = Math.max(Math.abs(r[0]-c[0]), Math.abs(r[1]-c[1]), Math.abs(r[2]-c[2]));
      if (err > maxErr){ maxErr = err; worst = { color: c.slice(), a, err }; }
    }
  }
  return { maxChannelError: maxErr, worst, pass: maxErr <= 0.01, n: colors.length * 2 };
}
const THRESHOLDS = { de00Mean: 5.0, de00Max: 15.0 };
/* 参考系：外部 mixbox.js 全局（CDN 加载；避免与局部命名冲突用 globalThis） */
const mixboxRef = (typeof globalThis.mixbox !== 'undefined' && typeof globalThis.mixbox.lerpFloat === 'function')
  ? globalThis.mixbox.lerpFloat : null;

/* ---- 报告 ---- */
function buildReport(opts){
  const seed = (opts && opts.seed) | 0 || 20260808;
  const n = (opts && opts.n) || 2000;
  const modelFilter = (opts && opts.modelNames) || null;
  const ref = mixboxRef ? (b, t, a) => mixboxRef(b, t, a) : null;
  const t1 = buildT1(), t2 = buildT2(), t3 = buildT3(seed, n), t5 = buildT5(), t5e = buildT5E();
  const ciede = validateDeltaE2000();
  const models = {};
  const worstAll = [];
  for (const model of MODELS){
    if (modelFilter && !modelFilter.includes(model.name)) continue;
    const e1 = ref ? evaluateSet(model, t1, ref) : [];
    const e2 = ref ? evaluateSet(model, t2, ref) : [];
    const e3 = ref ? evaluateSet(model, t3, ref) : [];
    const e5 = ref ? evaluateSet(model, t5, ref) : [];
    const e5e = ref ? evaluateSet(model, t5e, ref) : [];
    const s1 = statsOf(e1), s2 = statsOf(e2), s3 = statsOf(e3), s5 = statsOf(e5), s5e = statsOf(e5e);
    const pass = !!(s1 && s2 && s3 && s5
                 && s1.de00.mean < THRESHOLDS.de00Mean && s1.de00.max <= THRESHOLDS.de00Max
                 && s2.de00.mean < THRESHOLDS.de00Mean && s2.de00.max <= THRESHOLDS.de00Max
                 && s3.de00.mean < THRESHOLDS.de00Mean && s3.de00.max <= THRESHOLDS.de00Max
                 && s5.de00.mean < THRESHOLDS.de00Mean && s5.de00.max <= THRESHOLDS.de00Max);
    const worst = [...e1, ...e2, ...e3, ...e5].sort((x,y) => y.de00 - x.de00).slice(0, 5);
    worstAll.push({ model: model.name, worst });
    models[model.name] = {
      note: model.note,
      T1: s1, T2: s2, T3: s3, T5: s5, T5E: s5e,
      T4: runT4(model),
      pass
    };
  }
  return {
    suite: 'texturge-color-mixing-evaluation',
    version: '0.1',
    date: new Date().toISOString().slice(0, 10),
    reference: mixboxRef ? 'mixbox 2.0 (lerpFloat, sRGB display)' : null,
    seed, randomPairs: n,
    thresholds: THRESHOLDS,
    ciede2000Validation: ciede,
    models, worst: worstAll
  };
}

/* 暴露核心（node 无头验证用） */
if (typeof window !== 'undefined'){
  window.__Suite = { validateDeltaE2000, deltaE2000, de76, buildReport, runT4, evaluateSet, MODELS, SHARMA, THRESHOLDS, buildT5, buildT5Random, buildT5E };
}


/* =====================================================================
 * 评估页 UI（仅浏览器；默认英文，可切换中文）
 * =================================================================== */
if (typeof document !== 'undefined'){
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hexOf = rgb => '#' + rgb.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
  const fmt = (v, d) => Number(v).toFixed(d);

  const TEXT = {
    en: {
      brand_sub: 'pigment-based mixing', nav_demo: 'Demo', nav_eval: 'Evaluation', nav_paper: 'Paper',
      h1: 'Treat mixing as a measurement.',
      lede: 'One test set, one reference, one metric: CIEDE2000 on sRGB display values. A run reports the mean and maximum for the palette, stress-pair, random and dark-plus-white suites, plus each model’s five worst pairs.',
      ciede_ok: 'CIEDE2000 replication passed · max deviation {d} ({n} reference pairs)',
      ciede_bad: 'CIEDE2000 replication failed · max deviation {d}',
      ref_ok: 'Reference: Mixbox 2.0 lerpFloat (display-value float path)',
      ref_bad: 'Reference unavailable: scrtwpns.com is not reachable',
      cfg_h: 'Run configuration', cfg_seed: 'Random seed', cfg_seed_h: 'T3 draws with a fixed seed, so results reproduce',
      cfg_n: 'Random pairs', cfg_n_h: 'uniform sRGB × α ∈ [0,1]', cfg_models: 'Models',
      run: 'Run full suite', idle: 'Not run yet',
      tile_t1: 'T1 palette', tile_t2: 'T2 stress pairs', tile_t3: 'T3 random', tile_t5: 'T5 dark + white',
      k_sum: 'Summary', h_sum: 'ΔE00 by suite',
      p_sum: 'The acceptance target applies to dark + white only: mean below 5, maximum at most 15. The main-suite maxima come from pairs with a large lightness gap and hue opposition; they are recorded, not used as an acceptance criterion.',
      k_fam: 'Families', h_fam: 'Mean error by colour family',
      p_fam: 'The same samples split by family: complementary and mismatched pairs exercise cross-channel coupling, dark + white exercises the structural defect of K/S superposition.',
      k_t4: 'Identity', h_t4: 'Endpoint behaviour (T4)',
      p_t4: 'α = 0 and α = 1 must return the input exactly; channel tolerance 0.01.',
      k_tail: 'Tail', h_tail: 'Five worst pairs',
      p_tail: 'Sorted by ΔE00, descending; swatches are the model output and the reference.',
      worst_idle: 'Runs appear here',
      exp_h: 'Export', exp_copy: 'Copy JSON', exp_dl: 'Download JSON',
      th_model: 'model', th_family: 'family', th_mean: 'mean', th_max: 'max', th_accept: 'dark + white',
      th_err: 'max channel error', th_samples: 'samples', th_tol: 'tolerance 0.01',
      pass: 'pass', fail: 'over',
      st_running: 'running…', st_done: 'done · {ms} ms · seed {seed} · {n} random pairs',
      st_neednet: 'needs network access to load mixbox.js', st_nomodel: 'select at least one model',
      st_first: 'run the suite first', st_copied: 'copied', st_downloaded: 'downloaded',
      foot_left: 'Pigment-Based Mixing · evaluation suite', foot_demo: 'Mixing bench', foot_paper: 'Technical paper'
    },
    zh: {
      brand_sub: '颜料基混色', nav_demo: '演示', nav_eval: '评估', nav_paper: '论文',
      h1: '把混色当测量。',
      lede: '同一套测试集、同一参考系、同一个度量：sRGB 显示值上的 CIEDE2000。运行后给出调色板、压力对、随机对与深色加白四组的均值与最大值，并列出每个模型最差的五对颜色。',
      ciede_ok: 'CIEDE2000 复刻通过 · 最大偏差 {d}（{n} 组参考对）',
      ciede_bad: 'CIEDE2000 复刻未通过 · 最大偏差 {d}',
      ref_ok: '参考系：Mixbox 2.0 lerpFloat（显示值浮点路径）',
      ref_bad: '参考系不可用：无法访问 scrtwpns.com',
      cfg_h: '运行配置', cfg_seed: '随机 seed', cfg_seed_h: 'T3 随机集固定 seed，结果可复现',
      cfg_n: '随机对数', cfg_n_h: '均匀 sRGB × α ∈ [0,1]', cfg_models: '被测模型',
      run: '运行全套件', idle: '尚未运行',
      tile_t1: 'T1 调色板', tile_t2: 'T2 压力对', tile_t3: 'T3 随机', tile_t5: 'T5 深色+白',
      k_sum: '汇总', h_sum: '各套件 ΔE00',
      p_sum: '验收目标只针对深色加白：均值 < 5、最大值 ≤ 15。主套件的最大值由“大变明度差叠加色相对立”的颜色对决定，如实记录，不作为验收标准。',
      k_fam: '分族', h_fam: '按颜色族细分',
      p_fam: '同一批样本按族拆开看均值：互补与错配族最考验跨通道关联，深色加白族最考验 K/S 叠加的结构性缺陷。',
      k_t4: '恒等', h_t4: '端点行为 T4',
      p_t4: 'α = 0 与 α = 1 必须精确返回输入；通道容差 0.01。',
      k_tail: '尾端', h_tail: '最差五对',
      p_tail: '按 ΔE00 降序列出；色块为模型输出与参考。',
      worst_idle: '运行后显示',
      exp_h: '导出', exp_copy: '复制 JSON', exp_dl: '下载 JSON',
      th_model: '模型', th_family: '颜色族', th_mean: '均值', th_max: '最大', th_accept: '深色加白验收',
      th_err: '最大通道误差', th_samples: '样本数', th_tol: '容差 0.01',
      pass: '通过', fail: '超出',
      st_running: '运行中…', st_done: '完成 · {ms} ms · seed {seed} · {n} 个随机对',
      st_neednet: '需要网络加载 mixbox.js 才能运行。', st_nomodel: '至少选择一个模型。',
      st_first: '请先运行', st_copied: '已复制', st_downloaded: '已下载',
      foot_left: 'Pigment-Based Mixing · 评估套件', foot_demo: '混色台', foot_paper: '技术论文'
    }
  };

  const MODEL_LABEL = {
    '我们的方法（PBM）': { en: 'our model (PBM)', zh: '我们的方法（PBM）' },
    'RGB 插值': { en: 'RGB interpolation', zh: 'RGB 插值' },
    'Kubelka–Munk': { en: 'Kubelka–Munk', zh: 'Kubelka–Munk' }
  };
  const CAT_LABEL = {
    '互补对': { en: 'complementary', zh: '互补对' },
    'RYB错配': { en: 'RYB mismatch', zh: 'RYB 错配' },
    '白黑混合': { en: 'white / black', zh: '白黑混合' },
    '相似色': { en: 'similar', zh: '相似色' },
    '调色板': { en: 'palette', zh: '调色板' },
    '随机': { en: 'random', zh: '随机' },
    '深色+白': { en: 'dark + white', zh: '深色+白' },
    '深色+白·随机': { en: 'dark + white (random)', zh: '深色+白·随机' }
  };

  let LANG = (() => {
    const q = new URLSearchParams(location.search).get('lang');
    if (q) return q === 'zh' ? 'zh' : 'en';
    try { if (localStorage.getItem('pbm-lang') === 'zh') return 'zh'; } catch (e) {}
    return 'en';
  })();
  const t = k => (TEXT[LANG][k] !== undefined ? TEXT[LANG][k] : TEXT.en[k]);
  const mLabel = n => (MODEL_LABEL[n] ? MODEL_LABEL[n][LANG] : n);
  const cLabel = n => (CAT_LABEL[n] ? CAT_LABEL[n][LANG] : n);

  const MIXBOX_OK = !!mixboxRef;
  const OURS = MODELS[0].name;
  let lastReport = null;

  /* ---- 静态文案 ---- */
  function applyStatic(){
    document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
    document.title = (LANG === 'zh' ? '评估套件' : 'Evaluation suite') + ' · Pigment-Based Mixing';
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('#lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === LANG));
    const paper = LANG === 'zh' ? '../docs/color-mixing-algorithm.zh-CN.pdf' : '../docs/color-mixing-algorithm.pdf';
    document.querySelectorAll('a[data-i18n="nav_paper"], a[data-i18n="foot_paper"]').forEach(a => { a.href = paper; });
    const brand = document.querySelector('.brand');
    if (brand) brand.href = LANG === 'zh' ? '../README.zh-CN.md' : '../README.md';
    renderBadges();
  }

  function renderBadges(){
    const r = validateDeltaE2000();
    $('ciedeStatus').textContent = (r.pass ? t('ciede_ok') : t('ciede_bad'))
      .replace('{d}', r.maxAbsDev.toExponential(2)).replace('{n}', String(r.n));
    $('ciedeBadge').className = 'badge ' + (r.pass ? 'ok' : 'bad');
    $('refState').textContent = MIXBOX_OK ? t('ref_ok') : t('ref_bad');
    $('refBadge').className = 'badge ' + (MIXBOX_OK ? 'ok' : 'bad');
  }

  /* ---- 模型选择 ---- */
  const enabled = {};
  function buildModels(){
    $('modelList').innerHTML = '';
    MODELS.forEach((m, i) => {
      if (enabled[i] === undefined) enabled[i] = true;
      const label = document.createElement('label');
      label.className = 'mchip';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = enabled[i];
      cb.onchange = () => { enabled[i] = cb.checked; };
      label.appendChild(cb);
      label.appendChild(document.createTextNode(mLabel(m.name)));
      $('modelList').appendChild(label);
    });
  }

  /* ---- 表格工具 ---- */
  function headRow(labels){
    const tr = document.createElement('tr');
    labels.forEach(l => { const th = document.createElement('th'); th.textContent = l; tr.appendChild(th); });
    return tr;
  }
  function td(txt, cls){
    const cell = document.createElement('td');
    if (cls) cell.className = cls;
    cell.textContent = txt;
    return cell;
  }

  /* ---- 顶部四格 ---- */
  function renderTiles(report){
    const tiles = $('tiles');
    tiles.hidden = false;
    const d = report.models[OURS];
    if (!d) return;
    [['t1','T1'],['t2','T2'],['t3','T3'],['t5','T5']].forEach(([id, key]) => {
      const s = d[key];
      if (!s){ $(id + 'm').textContent = '—'; return; }
      $(id + 'n').textContent = 'n=' + s.n;
      $(id + 'm').textContent = fmt(s.de00.mean, 2);
      $(id + 'x').textContent = 'max ' + fmt(s.de00.max, 1) + ' · p95 ' + fmt(s.de00.p95, 2);
    });
  }

  /* ---- 汇总表 ---- */
  function renderSummary(report){
    const tbl = $('summaryTbl');
    const thead = tbl.querySelector('thead'), tbody = tbl.querySelector('tbody');
    thead.innerHTML = ''; tbody.innerHTML = '';
    const head = [t('th_model')];
    for (const k of ['T1','T2','T3','T5']) head.push(k + ' ' + t('th_mean'), k + ' ' + t('th_max'));
    head.push('T5E ' + t('th_mean'), t('th_accept'));
    thead.appendChild(headRow(head));
    for (const m of MODELS){
      const d = report.models[m.name];
      if (!d) continue;
      const tr = document.createElement('tr');
      tr.appendChild(td(mLabel(m.name), 'name'));
      for (const key of ['T1','T2','T3','T5']){
        tr.appendChild(td(d[key] ? fmt(d[key].de00.mean, 3) : '—', 'mono'));
        tr.appendChild(td(d[key] ? fmt(d[key].de00.max, 1) : '—', 'mono'));
      }
      tr.appendChild(td(d.T5E ? fmt(d.T5E.de00.mean, 3) : '—', 'mono'));
      const target = d.T5 && d.T5E && d.T5.de00.mean < 5 && d.T5.de00.max <= 15 && d.T5E.de00.mean < 5;
      tr.appendChild(td(target ? t('pass') : t('fail'), target ? 'pass' : 'fail'));
      tbody.appendChild(tr);
    }
  }

  /* ---- 分族均值 ---- */
  const CATS = ['互补对', 'RYB错配', '白黑混合', '相似色', '调色板', '随机', '深色+白', '深色+白·随机'];
  function renderCategories(report){
    const tbl = $('catTbl');
    const thead = tbl.querySelector('thead'), tbody = tbl.querySelector('tbody');
    thead.innerHTML = ''; tbody.innerHTML = '';
    const active = MODELS.filter(m => report.models[m.name]);
    thead.appendChild(headRow([t('th_family'), ...active.map(m => mLabel(m.name))]));
    const t2 = buildT2(), t5 = buildT5();
    const pool = {
      '互补对': t2.filter(s => s.cat === '互补对'),
      'RYB错配': t2.filter(s => s.cat === 'RYB错配'),
      '白黑混合': t2.filter(s => s.cat === '白黑混合'),
      '相似色': t2.filter(s => s.cat === '相似色'),
      '调色板': buildT1(),
      '随机': buildT3(report.seed, report.randomPairs),
      '深色+白': t5.filter(s => s.cat === '深色+白'),
      '深色+白·随机': t5.filter(s => s.cat === '深色+白·随机')
    };
    for (const cat of CATS){
      const tr = document.createElement('tr');
      tr.appendChild(td(cLabel(cat), 'name'));
      for (const m of active){
        const s = statsOf(evaluateSet(m, pool[cat], mixboxRef));
        tr.appendChild(td(s ? fmt(s.de00.mean, 3) : '—', 'mono'));
      }
      tbody.appendChild(tr);
    }
  }

  /* ---- T4 ---- */
  function renderT4(report){
    const tbl = $('t4Tbl');
    const thead = tbl.querySelector('thead'), tbody = tbl.querySelector('tbody');
    thead.innerHTML = ''; tbody.innerHTML = '';
    thead.appendChild(headRow([t('th_model'), t('th_err'), t('th_samples'), t('th_tol')]));
    for (const m of MODELS){
      const d = report.models[m.name];
      if (!d) continue;
      const tr = document.createElement('tr');
      tr.appendChild(td(mLabel(m.name), 'name'));
      tr.appendChild(td(d.T4.maxChannelError.toFixed(5), 'mono'));
      tr.appendChild(td(String(d.T4.n), 'mono'));
      tr.appendChild(td(d.T4.pass ? t('pass') : t('fail'), d.T4.pass ? 'pass' : 'fail'));
      tbody.appendChild(tr);
    }
  }

  /* ---- 最差对 ---- */
  function renderWorst(report){
    const box = $('worstBox');
    box.innerHTML = '';
    for (const { model, worst } of report.worst){
      const col = document.createElement('div');
      const h = document.createElement('div');
      h.style.cssText = 'font-size:11.5px;color:var(--ink3);margin:0 0 4px';
      h.textContent = mLabel(model);
      col.appendChild(h);
      for (const w of worst){
        const item = document.createElement('div');
        item.className = 'wrow';
        item.innerHTML =
          '<span class="sw" style="background:' + hexOf(w.m) + '"></span>' +
          '<span class="sw" style="background:' + hexOf(w.r) + '"></span>' +
          '<span class="meta">α=' + w.a.toFixed(2) + ' · ' + hexOf(w.m) + ' → ' + hexOf(w.r) + '</span>' +
          '<span class="d">' + w.de00.toFixed(2) + '</span>';
        col.appendChild(item);
      }
      box.appendChild(col);
    }
  }

  function renderAll(report){
    renderTiles(report);
    renderSummary(report);
    renderCategories(report);
    renderT4(report);
    renderWorst(report);
    $('summaryWrap').hidden = false; $('catWrap').hidden = false; $('t4Wrap').hidden = false;
  }

  /* ---- 运行 ---- */
  $('runBtn').onclick = () => {
    if (!MIXBOX_OK){
      $('runStatus').textContent = t('st_neednet');
      $('runStatus').className = 'status err';
      return;
    }
    const seed = parseInt($('seed').value, 10) || 20260808;
    const n = clamp(parseInt($('randN').value, 10) || 2000, 10, 20000);
    const names = MODELS.filter((_, i) => enabled[i]).map(m => m.name);
    if (!names.length){
      $('runStatus').textContent = t('st_nomodel');
      $('runStatus').className = 'status err';
      return;
    }
    $('runBtn').disabled = true;
    $('runStatus').className = 'status';
    $('runStatus').textContent = t('st_running');
    setTimeout(() => {
      const t0 = performance.now();
      const report = buildReport({ seed, n, modelNames: names });
      lastReport = report;
      renderAll(report);
      $('runBtn').disabled = false;
      $('runStatus').textContent = t('st_done')
        .replace('{ms}', String(Math.round(performance.now() - t0)))
        .replace('{seed}', String(seed))
        .replace('{n}', String(n));
      $('exportState').textContent = '';
    }, 20);
  };

  /* ---- 导出 ---- */
  const asText = () => JSON.stringify(lastReport, null, 2);
  $('copyBtn').onclick = () => {
    if (!lastReport){ $('exportState').textContent = t('st_first'); return; }
    const done = () => { $('exportState').textContent = t('st_copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(asText()).then(done, done);
    else done();
  };
  $('dlBtn').onclick = () => {
    if (!lastReport){ $('exportState').textContent = t('st_first'); return; }
    const blob = new Blob([asText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pbm-eval-' + lastReport.date + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    $('exportState').textContent = t('st_downloaded');
  };

  /* ---- 语言切换 ---- */
  function setLang(lang){
    LANG = lang === 'zh' ? 'zh' : 'en';
    try { localStorage.setItem('pbm-lang', LANG); } catch (e) {}
    applyStatic();
    buildModels();
    if (lastReport) renderAll(lastReport);
    if ($('exportState').textContent && lastReport) $('exportState').textContent = '';
  }
  $('lang').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-lang]');
    if (b) setLang(b.dataset.lang);
  });

  /* ---- 启动 ---- */
  applyStatic();
  buildModels();

  (function(){
    const q = new URLSearchParams(location.search);
    if (q.has('seed')) $('seed').value = q.get('seed');
    if (q.has('n')) $('randN').value = q.get('n');
    if (q.get('run') === '1' && MIXBOX_OK) setTimeout(() => $('runBtn').click(), 60);
  })();
}