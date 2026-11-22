/* =====================================================================
 * color-mixing-demo.js — mixing-bench page logic
 *
 * 依赖：../javascript/color-mixing.js（window.ColorMixing.mixPbm）
 *       spectral-inline.js（window.Spectral：合成颜料光谱的两常数 K–M 管线）
 *       mixbox.js（官方 CDN，异步；缺失时该行显示未加载）
 *
 * 页面结构见 color-mixing-demo.html。默认英文，可切换中文（?lang=zh 或页头按钮）。
 * =================================================================== */
'use strict';

const { mixPbm } = ColorMixing;

/* ---------- 文案 ---------- */
const TEXT = {
  en: {
    brand_sub: 'pigment-based mixing',
    nav_demo: 'Demo', nav_eval: 'Evaluation', nav_paper: 'Paper',
    h1: 'One pair of colors.<br><em>Two ways to mix.</em>',
    lede: 'Pigments subtract, light adds. The five strips below run one pair of colors across the whole tint share: our model, the Mixbox reference, an independent synthetic-spectra truth, RGB interpolation, and display-value K–M. Drag across the bench to sample; the right column is CIEDE2000 against the reference.',
    lbl_base: 'base', lbl_tint: 'tint', spec_name: 'our model', ctl_ratio: 'Tint share',
    sec_kicker: 'Stress pairs', sec_h2: 'Fixed pairs at three ratios',
    sec_p: 'Complementary, RYB mismatch, white/black and dark + white. Each cell shows the model’s mix and its ΔE00 against the reference; chroma error above 2.5 is marked ochre, above 5 vermilion. The spectral column comes from synthetic pigment spectra through unmix and two-constant K–M mixing; its difference from the reference is structural, not error.',
    row_pbm: 'our model', row_mx: 'Mixbox reference', row_spec: 'spectral truth',
    row_rgb: 'RGB interpolation', row_km: 'K–M display-value',
    de_ref: 'ref', de_na: '—',
    th_pair: 'pair', th_ref: 'reference', th_ours: 'our model', th_rgb: 'RGB interpolation', th_km: 'K–M (spectral)',
    cat_comp: 'complementary', cat_mis: 'RYB mismatch', cat_wb: 'white / black', cat_sim: 'similar', cat_dark: 'dark + white',
    tbl_note: 'α = {a} · spectral column computed pair by pair (unmix cached).',
    note1_h: 'The model',
    note1_p: 'A two-stage formula: a K–M/Duncan mixing core plus a repair layer. The core applies a broadband 3×3 matrix, analytic K/S defaults, κ concentration mixing, mutual absorption and a rational R∞; the repair layer adds a soft role assignment λ, a dark-plus-light gate <code>g</code>, a per-channel power-law target and a seventeen-feature harmonic correction. No trigonometric function, no lookup table.',
    note2_h: 'The comparisons',
    note2_p: '<b>RGB interpolation</b> is additive light mixing, so complementary colors go gray. <b>Display-value K–M</b> treats channel values as reflectances, so dark colors washed with white lose absorption. <b>Spectral truth</b> comes from 29 synthetic pigment spectra (two-constant K–M; band structure from pigment chemistry, numbers calibrated to the public BabelColor ColorChecker spectra) through Duncan superposition and D65 integration, after a deterministic unmix of the RGB input into four pigment concentrations. <b>Mixbox 2.0</b> mixes linearly in a seven-dimensional latent space trained on measured pigment spectra and is the reference here.',
    note3_h: 'Reading it',
    note3_p: 'ΔE00 below 1 is imperceptible, 1–2 visible on close inspection, 2–4 clearly visible, above 4 substantial. Our model measures 2.26 mean / 7.3 max on dark + white, and 3.29 / 2.67 / 2.78 on the three main suites. Full statistics and the held-out split are on the evaluation page and in the paper. The Mixbox reference library is loaded from its official CDN under CC BY-NC 4.0, for research comparison only.',
    foot_left: 'Pigment-Based Mixing · mixing bench', foot_eval: 'Evaluation suite', foot_paper: 'Technical paper',
    mixbox_missing: 'reference not loaded (needs network)',
    presets: {
      base: ['white','gray','black','red','orange','yellow','green','cyan','blue','violet'],
      tint: ['cadmium yellow','ultramarine','vermilion','emerald','magenta','orange red','cyan','white']
    }
  },
  zh: {
    brand_sub: '颜料基混色',
    nav_demo: '演示', nav_eval: '评估', nav_paper: '论文',
    h1: '同一对颜色，<br><em>两条混合路径。</em>',
    lede: '颜料相减，光相加。下面五条色带是同一对颜色沿混合比铺开的全程：从上到下依次为本模型、Mixbox 参考、独立合成光谱真值、RGB 插值与显示值 K–M。横向拖动取样，右端是本模型与参考的 CIEDE2000 色差。',
    lbl_base: '基色', lbl_tint: '染色', spec_name: '本模型', ctl_ratio: '混合比 · 染色占比',
    sec_kicker: '压力对', sec_h2: '固定色对 × 三档配比',
    sec_p: '互补、RYB 错配、白黑与深色加白四族。每格显示该模型混出色与相对参考的 ΔE00；色度差大于 2.5 标赭色，大于 5 标朱红。光谱真值列由合成颜料光谱经 unmix 与两常数 K–M 混合得到，与参考的差异是结构性的，不是误差。',
    row_pbm: '本模型', row_mx: 'Mixbox 参考', row_spec: '光谱真值',
    row_rgb: 'RGB 插值', row_km: 'K–M 显示值',
    de_ref: '参考', de_na: '—',
    th_pair: '色对', th_ref: '参考', th_ours: '本模型', th_rgb: 'RGB 插值', th_km: 'K–M（谱）',
    cat_comp: '互补', cat_mis: '错配', cat_wb: '白黑', cat_sim: '相似', cat_dark: '深色+白',
    tbl_note: 'α = {a} · 光谱真值列由 {n} 个色对逐一 unmix 得到（已缓存）。',
    note1_h: '模型',
    note1_p: '两阶段公式：K–M/Duncan 混色核心 + 修复层。核心作宽带 3×3 矩阵变换、解析 K/S 默认、κ 浓度叠加、互吸收与有理式 R∞；修复层用软角色分配 λ、深色加白门控 <code>g</code>、逐通道幂律目标与十七特征谐波修正。全式不含三角函数与查找表。',
    note2_h: '对照',
    note2_p: '<b>RGB 插值</b>是光的加色混合，互补色趋灰。<b>显示值 K–M</b> 把通道值当作反射率叠加，深色加白会被冲淡。<b>光谱真值</b>由 29 个合成颜料光谱（两常数 K–M，带结构按颜料化学、数值标定自 BabelColor ColorChecker 公开光谱）经 Duncan 叠加与 D65 积分得到，任意 RGB 先确定性 unmix 为四主颜料浓度。<b>Mixbox 2.0</b> 在实测颜料光谱训练的七维潜空间内线性混合，是本页参考。',
    note3_h: '读法',
    note3_p: 'ΔE00 < 1 不可察觉，1–2 仔细比对可见，2–4 明显，> 4 显著。本模型在深色加白上均值 2.26、最大 7.3；主三集 3.29 / 2.67 / 2.78。全部统计与留出划分见评估页与论文。Mixbox 参考库按 CC BY-NC 4.0 由官方 CDN 加载，仅供研究对照。',
    foot_left: 'Pigment-Based Mixing · 混色台', foot_eval: '评估套件', foot_paper: '技术论文',
    mixbox_missing: '参考库未加载（需网络）',
    presets: {
      base: ['白','灰','黑','红','橙','黄','绿','青','蓝','紫'],
      tint: ['镉黄','群青','朱红','翠绿','品红','橙红','青','白']
    }
  }
};

let LANG = (() => {
  const q = new URLSearchParams(location.search).get('lang');
  if (q) return q === 'zh' ? 'zh' : 'en';
  try { if (localStorage.getItem('pbm-lang') === 'zh') return 'zh'; } catch (e) {}
  return 'en';
})();
const t = k => (TEXT[LANG][k] !== undefined ? TEXT[LANG][k] : TEXT.en[k]);

/* ---------- 基础工具 ---------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, tt) => a + (b - a) * tt;
const mixLerp = (b, t2, a) => [lerp(b[0],t2[0],a), lerp(b[1],t2[1],a), lerp(b[2],t2[2],a)];
const kmDual = (b, t2, a) => {
  const K = v => { const d = 1 - v; return d * d / 2; };
  const S = v => Math.max(v, 0.005);
  const R = k => 1 + k - Math.sqrt(k * k + 2 * k);
  const ch = c => R((K(b[c]) + (K(t2[c]) - K(b[c])) * a) / (S(b[c]) + (S(t2[c]) - S(b[c])) * a));
  return [ch(0), ch(1), ch(2)];
};
const HEX2RGB = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
const RGB2HEX = rgb => '#' + rgb.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const css = rgb => 'rgb(' + rgb.map(v => Math.round(clamp(v,0,1)*255)).join(',') + ')';

/* ---------- CIEDE2000 ---------- */
const SRGB2LIN = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const LABF = tt => tt > 0.008856 ? Math.cbrt(tt) : 7.787 * tt + 16 / 116;
function rgbToLab(rgb){
  const r = SRGB2LIN(rgb[0]), g = SRGB2LIN(rgb[1]), b = SRGB2LIN(rgb[2]);
  let x = 0.4124564*r + 0.3575761*g + 0.1804375*b;
  let y = 0.2126729*r + 0.7151522*g + 0.0721750*b;
  let z = 0.0193339*r + 0.1191920*g + 0.9503041*b;
  x /= 0.95047; z /= 1.08883;
  const fx = LABF(x), fy = LABF(y), fz = LABF(z);
  return [116*fy - 16, 500*(fx - fy), 200*(fy - fz)];
}
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
const de00 = (a, b) => deltaE2000(rgbToLab(a), rgbToLab(b));

/* ---------- 参考模型：Mixbox（异步） ---------- */
let mixboxFn = null;
function loadMixbox(){
  const s = document.createElement('script');
  s.src = 'https://scrtwpns.com/mixbox.js';
  s.async = true;
  s.onload = () => {
    if (typeof mixbox !== 'undefined' && typeof mixbox.lerpFloat === 'function'){
      mixboxFn = (b, t2, a) => mixbox.lerpFloat(b, t2, a);
      rebuildStrips();
      renderStress();
    }
  };
  document.head.appendChild(s);
}
const refMix = (b, t2, a) => mixboxFn ? mixboxFn(b, t2, a) : null;

/* ---------- 光谱真值：unmix + 两常数 K–M ---------- */
const unmixCache = new Map();
const unmix = rgb => {
  const key = rgb.map(v => v.toFixed(4)).join();
  let u = unmixCache.get(key);
  if (!u){ u = Spectral.unmixRgb(rgb, { sweeps: 3, seed: 0xC0FFEE }); unmixCache.set(key, u); }
  return u;
};
const specMix = (b, t2, a) => {
  if (typeof Spectral === 'undefined') return null;
  const cb = unmix(b), ct = unmix(t2);
  const conc = cb.conc.map((v, i) => (1 - a) * v + a * ct.conc[i]);
  const out = Spectral.spectralMixConcs(conc, {});
  const wb = Math.exp(-cb.de00 / 5), wt = Math.exp(-ct.de00 / 5);
  const wb2 = wb + (1 - wb) * Math.pow(1 - a, 4), wt2 = wt + (1 - wt) * Math.pow(a, 4);
  return out.rgb.map((v, c) => clamp(v + (1 - a) * (b[c] - cb.rgb[c]) * wb2 + a * (t2[c] - ct.rgb[c]) * wt2, 0, 1));
};

/* ---------- 色板与色带 ---------- */
const PRESET_HEX = {
  base: ['#F2F2EF','#8A8A93','#141417','#E23B3B','#F07A2A','#F0C94B','#3FA76F','#3AA8B8','#3B6FE0','#8A5BE0'],
  tint: ['#FFD61A','#2E5EFF','#E8321F','#00B359','#E33BA8','#FF7A1A','#00D5C0','#FFFFFF']
};

const ROWS = [
  { key:'pbm',  label:'row_pbm',  fn:(b,t2,a) => mixPbm(b,t2,a), ours:true },
  { key:'mx',   label:'row_mx',   fn:(b,t2,a) => refMix(b,t2,a) },
  { key:'spec', label:'row_spec', fn:(b,t2,a) => specMix(b,t2,a) },
  { key:'rgb',  label:'row_rgb',  fn:mixLerp },
  { key:'km',   label:'row_km',   fn:kmDual }
];

const state = { base: HEX2RGB('#F2F2EF'), tint: HEX2RGB('#FFD61A'), alpha: 0.5, sel: { base: 0, tint: 0 } };
const SAMPLES = 181;
const nodes = new Map();

function buildRows(){
  const host = $('rows');
  host.innerHTML = '';
  for (const r of ROWS){
    const row = document.createElement('div');
    row.className = 'row' + (r.ours ? ' is-ours' : '');
    row.innerHTML = '<span class="name"></span><canvas></canvas><span class="de"></span>';
    row.querySelector('.name').textContent = t(r.label);
    host.appendChild(row);
    nodes.set(r.key, { row, canvas: row.querySelector('canvas'), de: row.querySelector('.de') });
  }
}
function relabelRows(){
  for (const r of ROWS){
    const n = nodes.get(r.key);
    if (n) n.row.querySelector('.name').textContent = t(r.label);
  }
}

function colorsAt(row){
  const out = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++){
    const a = i / (SAMPLES - 1);
    const c = row.fn(state.base, state.tint, a);
    out[i] = c || null;
  }
  return out;
}

function paintRow(key, colors){
  const n = nodes.get(key); if (!n) return;
  const cv = n.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const step = w / SAMPLES;
  for (let i = 0; i < SAMPLES; i++){
    const c = colors[i];
    if (!c) continue;
    ctx.fillStyle = css(c);
    ctx.fillRect(Math.floor(i * step), 0, Math.ceil(step) + 1, h);
  }
  if (colors.some(c => !c)){
    ctx.fillStyle = 'rgba(241,242,238,.86)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#C9CEC6'; ctx.lineWidth = 1;
    for (let x = -h; x < w; x += 9){ ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
    ctx.fillStyle = '#828B90'; ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText(t('mixbox_missing'), 10, h / 2 + 4);
  }
}

let stripCache = new Map();

function rebuildStrips(){
  stripCache = new Map();
  for (const r of ROWS){
    const cs = colorsAt(r);
    stripCache.set(r.key, cs);
    paintRow(r.key, cs);
  }
  updateSample();
}

function currentAt(key){
  const cs = stripCache.get(key);
  if (!cs) return null;
  return cs[Math.round(state.alpha * (SAMPLES - 1))];
}

function updateSample(){
  const ref = currentAt('mx');
  const ours = currentAt('pbm');
  for (const r of ROWS){
    const n = nodes.get(r.key);
    if (r.key === 'mx'){ n.de.textContent = t('de_ref'); n.de.className = 'de ref'; continue; }
    const c = currentAt(r.key);
    if (!c || !ref){ n.de.textContent = t('de_na'); n.de.className = 'de na'; continue; }
    n.de.textContent = de00(c, ref).toFixed(2);
    n.de.className = 'de';
  }

  const cv = nodes.get('pbm').canvas;
  const bench = $('bench');
  const cr = cv.getBoundingClientRect(), br = bench.getBoundingClientRect();
  $('scrub').style.left = (cr.left - br.left + state.alpha * cr.width) + 'px';
  $('scrubTag').textContent = 'α ' + state.alpha.toFixed(2);

  const sw = $('specSwatch');
  sw.style.background = ours ? css(ours) : '#ddd';
  $('specHex').textContent = ours ? RGB2HEX(ours) : '—';
  $('specAlpha').textContent = 'α ' + state.alpha.toFixed(2);
  $('alphaNum').textContent = state.alpha.toFixed(2);
  if (document.activeElement !== $('alpha')) $('alpha').value = String(state.alpha);

  const b = state.base, t2 = state.tint;
  $('hexBase').textContent = RGB2HEX(b); $('hexTint').textContent = RGB2HEX(t2);
  $('baseHex').textContent = RGB2HEX(b); $('tintHex').textContent = RGB2HEX(t2);
  $('swBase').style.background = css(b); $('swTint').style.background = css(t2);
}

/* ---------- 交互 ---------- */
function pointerToAlpha(ev){
  const cv = nodes.get('pbm').canvas;
  const r = cv.getBoundingClientRect();
  return clamp((ev.clientX - r.left) / r.width, 0, 1);
}
function bindScrub(){
  const bench = $('bench');
  let dragging = false;
  bench.addEventListener('pointerdown', ev => {
    if (ev.target.closest('input,button')) return;
    dragging = true;
    try { bench.setPointerCapture(ev.pointerId); } catch (e) {}
    state.alpha = pointerToAlpha(ev); updateSample();
  });
  bench.addEventListener('pointermove', ev => {
    if (!dragging) return;
    state.alpha = pointerToAlpha(ev); updateSample();
  });
  bench.addEventListener('pointerup', () => { dragging = false; });
  bench.addEventListener('pointercancel', () => { dragging = false; });
}

function buildPresets(){
  const mk = (hostId, kind, inputId) => {
    const host = $(hostId);
    host.innerHTML = '';
    const names = TEXT[LANG].presets[kind];
    PRESET_HEX[kind].forEach((hex, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.style.background = hex; b.title = names[i];
      if (state.sel[kind] === i) b.classList.add('on');
      b.onclick = () => {
        state.sel[kind] = i;
        host.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        $(inputId).value = hex;
        state[kind] = HEX2RGB(hex);
        rebuildStrips();
      };
      host.appendChild(b);
    });
  };
  mk('basePresets', 'base', 'baseColor');
  mk('tintPresets', 'tint', 'tintColor');
}

/* ---------- 压力对表格 ---------- */
const CAT = { comp:'cat_comp', mis:'cat_mis', wb:'cat_wb', sim:'cat_sim', dark:'cat_dark' };
const PAIRS = [
  ['comp','#E8321F','#00D5C0'], ['comp','#FFD61A','#2E5EFF'], ['comp','#E33BA8','#00B359'],
  ['mis','#E8321F','#00B359'], ['mis','#2E5EFF','#FF7A1A'], ['mis','#E8321F','#2E5EFF'],
  ['mis','#FFD61A','#00B359'], ['mis','#FFD61A','#00D5C0'], ['mis','#E33BA8','#00D5C0'],
  ['wb','#E8321F','#FFFFFF'], ['wb','#2E5EFF','#FFFFFF'], ['wb','#FFD61A','#FFFFFF'],
  ['wb','#E8321F','#000000'], ['wb','#2E5EFF','#000000'], ['wb','#00B359','#000000'],
  ['sim','#E8321F','#FF7A1A'], ['sim','#FFD61A','#FF7A1A'], ['sim','#2E5EFF','#8A5BE0'], ['sim','#00B359','#00D5C0'],
  ['dark','#0D1B44','#FFFFFF'], ['dark','#000080','#FFFFFF'], ['dark','#001B75','#FFFFFF'],
  ['dark','#001E80','#FFFFFF'], ['dark','#080248','#FFFFFF'], ['dark','#5F1708','#FFFFFF'],
  ['dark','#5E0F1A','#FFFFFF'], ['dark','#4A3A05','#FFFFFF'], ['dark','#280501','#FFFFFF'],
  ['dark','#250903','#FFFFFF'], ['dark','#8E1F0A','#FFFFFF'], ['dark','#005A32','#FFFFFF'],
  ['dark','#2A0A5E','#FFFFFF'], ['dark','#6E0B4A','#FFFFFF'], ['dark','#7A3B00','#FFFFFF'],
  ['dark','#00585E','#FFFFFF']
];
const TBL_ALPHAS = [0.25, 0.5, 0.75];
let tblAlpha = 0.5;

function cellHTML(color, ref, ours){
  if (!color || !ref) return '<span class="cell"><span class="sw" style="background:#eee"></span><span class="d">—</span></span>';
  const d = de00(color, ref);
  const cls = d < 2.5 ? '' : d < 5 ? ' warn' : ' bad';
  return '<span class="cell' + (ours ? ' ours' : '') + '">' +
         '<span class="sw" style="background:' + css(color) + '"></span>' +
         '<span class="d' + cls + '">' + d.toFixed(2) + '</span></span>';
}

let stressGen = 0;
function renderStress(){
  const gen = ++stressGen;
  const tbl = $('stressTbl');
  const head = tbl.querySelector('thead'), body = tbl.querySelector('tbody');
  head.innerHTML = ''; body.innerHTML = '';
  const tr = document.createElement('tr');
  tr.innerHTML = '<th>' + t('th_pair') + '</th><th>' + t('th_ref') + '</th><th>' + t('th_ours') +
                 '</th><th>' + t('th_rgb') + '</th><th>' + t('th_km') + '</th>';
  head.appendChild(tr);

  const a = tblAlpha;
  PAIRS.forEach(([cat, hb, ht], idx) => {
    const b = HEX2RGB(hb), t2 = HEX2RGB(ht);
    const ref = refMix(b, t2, a);
    const ours = mixPbm(b, t2, a);
    const rgb = mixLerp(b, t2, a);
    const row = document.createElement('tr');
    row.innerHTML =
      '<td><span class="pair"><span class="cat">' + t(CAT[cat]) + '</span>' +
      '<span class="sw" style="background:' + hb + '"></span>' +
      '<span class="sw" style="background:' + ht + '"></span></span></td>' +
      '<td><span class="cell"><span class="sw" style="background:' + (ref ? css(ref) : '#eee') + '"></span></span></td>' +
      '<td>' + cellHTML(ours, ref, true) + '</td>' +
      '<td>' + cellHTML(rgb, ref, false) + '</td>' +
      '<td data-km="' + idx + '"><span class="cell"><span class="sw" style="background:#eee"></span><span class="d">…</span></span></td>';
    body.appendChild(row);
  });

  let i = 0;
  const tick = () => {
    if (gen !== stressGen) return;
    const t0 = performance.now();
    while (i < PAIRS.length && performance.now() - t0 < 12){
      const [_, hb, ht] = PAIRS[i];
      const b = HEX2RGB(hb), t2 = HEX2RGB(ht);
      const ref = refMix(b, t2, a);
      const km = specMix(b, t2, a);
      const cell = body.querySelector('[data-km="' + i + '"]');
      if (cell) cell.innerHTML = cellHTML(km, ref, false);
      i++;
    }
    if (i < PAIRS.length) setTimeout(tick, 0);
    else $('stressNote').textContent = t('tbl_note').replace('{a}', a.toFixed(2)).replace('{n}', String(PAIRS.length));
  };
  setTimeout(tick, 0);
}

function buildAlphaTabs(){
  const host = $('alphaTabs');
  host.innerHTML = '';
  TBL_ALPHAS.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'α ' + a.toFixed(2);
    if (a === tblAlpha) b.classList.add('on');
    b.onclick = () => {
      tblAlpha = a;
      host.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      renderStress();
    };
    host.appendChild(b);
  });
}

/* ---------- 语言 ---------- */
function applyStatic(){
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  document.title = LANG === 'zh' ? '混色台 · Pigment-Based Mixing' : 'Mixing bench · Pigment-Based Mixing';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('#lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === LANG));
  const paper = LANG === 'zh' ? '../docs/color-mixing-algorithm.zh-CN.pdf' : '../docs/color-mixing-algorithm.pdf';
  document.querySelectorAll('a[data-i18n="nav_paper"], a[data-i18n="foot_paper"]').forEach(a => { a.href = paper; });
  const brand = document.querySelector('.brand');
  if (brand) brand.href = LANG === 'zh' ? '../README.zh-CN.md' : '../README.md';
  $('specSwatch').title = LANG === 'zh' ? '点击复制十六进制' : 'Copy hex';
}
function setLang(lang){
  LANG = lang === 'zh' ? 'zh' : 'en';
  try { localStorage.setItem('pbm-lang', LANG); } catch (e) {}
  applyStatic();
  relabelRows();
  buildPresets();
  rebuildStrips();
  renderStress();
}

/* ---------- 启动 ---------- */
buildRows();
buildPresets();
buildAlphaTabs();
bindScrub();
applyStatic();

let rz = 0;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(rebuildStrips, 120); });
$('baseColor').addEventListener('input', e => { state.sel.base = -1; state.base = HEX2RGB(e.target.value); rebuildStrips(); });
$('tintColor').addEventListener('input', e => { state.sel.tint = -1; state.tint = HEX2RGB(e.target.value); rebuildStrips(); });
$('alpha').addEventListener('input', e => { state.alpha = parseFloat(e.target.value); updateSample(); });
$('specSwatch').addEventListener('click', () => {
  const txt = $('specHex').textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
});
$('lang').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-lang]');
  if (b) setLang(b.dataset.lang);
});

rebuildStrips();
renderStress();
loadMixbox();
