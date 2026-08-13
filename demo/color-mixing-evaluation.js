/* =====================================================================
 * color-mixing-evaluation.js — 评估套件 + 页面 UI（评估页专用）
 *
 * PBM 混色公式来自 ../javascript/color-mixing.js（window.ColorMixing.mixPbm）；
 * 本文件只含评估所需的非算法部分：色度度量（CIELAB / ΔE76 / CIEDE2000、
 * Sharma 34 对复刻验证）、参考模型（RGB 插值 / Kubelka–Munk 双参数）、T1–T5 测试集、__Suite 导出与评估页 UI。
 * （提取自原内联脚本，勿手改）
 *
 * 浏览器：<script src="../javascript/color-mixing.js"></script>
 *          <script src="color-mixing-evaluation.js"></script>
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
 *   近中性深色（maxd<0.0656 盲区，gate=0）走纯核心。
 * 浅重侧 α∈{0.92..0.99}×近中性深色：盲区浅重侧（#F2F2EF+#000B2E α=0.05 实测 ΔE 6.5）。
 * 近中性深色量化定义：max∈[0.04,0.10]、maxd∈[0.02,0.06]（深白门 maxd≥0.0656 之下）。 */
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
 * UI（仅浏览器）
 * =================================================================== */
if (typeof document !== 'undefined'){
const $ = id => document.getElementById(id);
const fmt = v => (typeof v === 'number') ? v.toFixed(3) : String(v);
const hex = rgb => '#' + rgb.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const rgbChip = (el, c) => { el.style.background = hex(c); el.textContent = ''; };

const MIXBOX_OK = !!mixboxRef;
$('refState').textContent = MIXBOX_OK ? '参考系：Mixbox 2.0 可用' : '参考系：mixbox.js 未加载（需网络），无法运行';

/* CIEDE2000 验证（加载即自动运行） */
(function(){
  const r = validateDeltaE2000();
  const el = $('ciedeStatus');
  el.innerHTML = r.pass
    ? '34 组全部通过 <span class="chip ok">PASS</span> · 最大偏差 <span class="num">' + r.maxAbsDev.toExponential(2) + '</span>'
    : '34 组未通过 <span class="chip bad">FAIL</span> · 最大偏差 <span class="num">' + r.maxAbsDev.toExponential(2) + '</span>（第 ' + (r.worst.i+1) + ' 对）';
  el.className = 'status ' + (r.pass ? 'ok' : 'err');
})();

/* 模型选择 */
const enabled = {};
MODELS.forEach((m, i) => {
  enabled[i] = true;
  const chip = document.createElement('label');
  chip.className = 'model-chip';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = true;
  cb.onchange = () => { enabled[i] = cb.checked; };
  chip.appendChild(cb);
  chip.appendChild(document.createTextNode(m.name));
  const note = document.createElement('span');
  note.className = 'note'; note.textContent = m.note;
  chip.appendChild(note);
  $('modelList').appendChild(chip);
});

/* 运行 */
let lastReport = null;
$('runBtn').onclick = () => {
  if (!MIXBOX_OK){ $('runStatus').textContent = '错误：需要网络加载 mixbox.js 才能运行。'; $('runStatus').className = 'status err'; return; }
  const seed = parseInt($('seed').value) || 20260808;
  const n = Math.min(20000, Math.max(10, parseInt($('randN').value) || 2000));
  const names = MODELS.filter((_, i) => enabled[i]).map(m => m.name);
  const t0 = performance.now();
  const report = buildReport({ seed, n, modelNames: names });
  lastReport = report;
  $('runStatus').textContent = '完成：' + (performance.now() - t0).toFixed(0) + ' ms（seed=' + seed + '，随机 ' + n + ' 对）';
  $('runStatus').className = 'status ok';
  renderSummary(report);
  renderCategories(report);
  renderT4(report);
  renderWorst(report);
  $('exportState').textContent = '';
};

function cell(txt, cls){ const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = txt; return td; }
function headRow(labels){ const tr = document.createElement('tr'); labels.forEach(l => { const th = document.createElement('th'); th.textContent = l; tr.appendChild(th); }); return tr; }

function renderSummary(r){
  const tbl = $('summaryTbl');
  const thead = tbl.querySelector('thead'), tbody = tbl.querySelector('tbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  thead.appendChild(headRow([
    '模型', 'T1 max', 'T1 mean', 'T1 p95', 'T1 ΔE76', 'T2 max', 'T2 mean', 'T2 p95', 'T2 ΔE76',
    'T3 max', 'T3 mean', 'T3 p95', 'T3 ΔE76',
    'T5 max', 'T5 mean', 'T5 p95', 'T5 ΔE76', '通过'
  ]));
  for (const m of MODELS){
    const d = r.models[m.name];
    if (!d) continue;
    const tr = document.createElement('tr');
    tr.appendChild(cell(m.name, 'name'));
    tr.appendChild(cell(d.T1.de00.max.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T1.de00.mean.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T1.de00.p95.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T1.de76.max.toFixed(2) + ' / ' + d.T1.de76.mean.toFixed(2), 'de00'));
    tr.appendChild(cell(d.T2.de00.max.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T2.de00.mean.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T2.de00.p95.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T2.de76.max.toFixed(2) + ' / ' + d.T2.de76.mean.toFixed(2), 'de00'));
    tr.appendChild(cell(d.T3.de00.max.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T3.de00.mean.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T3.de00.p95.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T3.de76.max.toFixed(2) + ' / ' + d.T3.de76.mean.toFixed(2), 'de00'));
    tr.appendChild(cell(d.T5.de00.max.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T5.de00.mean.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T5.de00.p95.toFixed(3), 'mono'));
    tr.appendChild(cell(d.T5.de76.max.toFixed(2) + ' / ' + d.T5.de76.mean.toFixed(2), 'de00'));
    tr.appendChild(cell(d.pass ? 'PASS' : 'FAIL', d.pass ? 'pass-y' : 'pass-n'));
    tbody.appendChild(tr);
  }
}

function renderCategories(r){
  const cats = ['互补对', 'RYB错配', '白黑混合', '相似色', '调色板', '随机', '深色+白', '深色+白·随机'];
  const tbl = $('catTbl');
  const thead = tbl.querySelector('thead'), tbody = tbl.querySelector('tbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  thead.appendChild(headRow(['分类', ...MODELS.filter(m => r.models[m.name]).map(m => m.name)]));
  const pool = {
    调色板: buildT1(), 随机: buildT3(r.seed, r.randomPairs)
  };
  for (const cat of cats){
    const tr = document.createElement('tr');
    tr.appendChild(cell(cat, 'name'));
    for (const m of MODELS){
      if (!r.models[m.name]) continue;
      const samples = cat === '调色板' || cat === '随机'
        ? pool[cat]
        : cat === '深色+白' || cat === '深色+白·随机'
          ? buildT5().filter(s => s.cat === cat)
          : buildT2().filter(s => s.cat === cat);
      const es = evaluateSet(m, samples, (b,t,a) => mixboxRef(b,t,a));
      const s = statsOf(es);
      tr.appendChild(cell(s ? s.de00.mean.toFixed(3) : '—', 'mono'));
    }
    tbody.appendChild(tr);
  }
}

function renderT4(r){
  const tbl = $('t4Tbl');
  const thead = tbl.querySelector('thead'), tbody = tbl.querySelector('tbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  thead.appendChild(headRow(['模型', '最大通道误差', '样本数', '容差 0.01', '状态']));
  for (const m of MODELS){
    const d = r.models[m.name];
    if (!d) continue;
    const tr = document.createElement('tr');
    tr.appendChild(cell(m.name, 'name'));
    tr.appendChild(cell(d.T4.maxChannelError.toFixed(5), 'mono'));
    tr.appendChild(cell(d.T4.n));
    tr.appendChild(cell(d.T4.pass ? 'PASS' : 'FAIL', d.T4.pass ? 'pass-y' : 'pass-n'));
    tr.appendChild(cell(d.T4.pass ? '通过' : '超出', 'de00'));
    tbody.appendChild(tr);
  }
}

function renderWorst(r){
  const box = $('worstBox');
  box.innerHTML = '';
  for (const { model, worst } of r.worst){
    const h = document.createElement('div');
    h.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:14px 0 4px';
    h.textContent = model;
    box.appendChild(h);
    for (const w of worst){
      const item = document.createElement('div');
      item.className = 'worst-item';
      const sw1 = document.createElement('span'); sw1.className = 'sw'; sw1.style.background = hex(w.base);
      const sw2 = document.createElement('span'); sw2.className = 'sw'; sw2.style.background = hex(w.tint);
      const swm = document.createElement('span'); swm.className = 'sw'; swm.style.background = hex(w.m);
      const swr = document.createElement('span'); swr.className = 'sw'; swr.style.background = hex(w.r);
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.innerHTML = 'α=' + w.a.toFixed(2) + ' · 混合 <b>' + hex(w.m) + '</b> · 参考 <b>' + hex(w.r) + '</b>';
      const de = document.createElement('span');
      de.className = 'de';
      de.textContent = 'ΔE00 ' + w.de00.toFixed(2) + ' · ΔE76 ' + w.de76.toFixed(2);
      item.appendChild(sw1); item.appendChild(sw2); item.appendChild(swm); item.appendChild(swr);
      item.appendChild(meta); item.appendChild(de);
      box.appendChild(item);
    }
  }
}

/* 导出 */
$('copyBtn').onclick = () => {
  if (!lastReport){ $('exportState').textContent = '请先运行'; return; }
  const text = JSON.stringify(lastReport, null, 2);
  const done = () => $('exportState').textContent = '已复制';
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(done);
  else done();
};
$('dlBtn').onclick = () => {
  if (!lastReport){ $('exportState').textContent = '请先运行'; return; }
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'texturge-mix-eval-' + lastReport.date + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  $('exportState').textContent = '已下载';
};
}

