/* =====================================================================
 * color-mixing-demo.js — 演示页 UI（色轮、并排对照、α 过渡、ΔE00 实时）
 *
 * 算法与色度工具来自 ../javascript/color-mixing.js（window.ColorMixing），
 * 光谱真值行来自 spectral-inline.js（window.PigmentData / window.Spectral）。
 * 本文件只含页面交互逻辑与参考模型调用。（提取自原内联脚本，勿手改）
 *
 * 浏览器：<script src="spectral-inline.js"></script>
 *          <script src="../javascript/color-mixing.js"></script>
 *          <script src="color-mixing-demo.js"></script>
 * =================================================================== */
'use strict';
const { mixPbm, mixPigment } = ColorMixing;   // mat3Inv 由下方页面 helpers 自带
let base = [1, 1, 1], tint = [1, 0.839, 0.102], alpha = 0.5;


/* ===== helpers ===== */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const HEX2RGB = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
const RGB2HEX = rgb => '#' + rgb.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('').toUpperCase();

/* ===== ΔE00（CIEDE2000，Sharma/Wu/Dalal 2005，当前行业标准；ΔE<1 不可感知） ===== */
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
// mixbox.js（CC BY-NC 4.0，官方 CDN 异步加载，仅研究对照；不阻塞页面渲染）
let mixboxRef = null;
let mixboxReady = false;
function loadMixbox(){
  const s = document.createElement('script');
  s.src = 'https://scrtwpns.com/mixbox.js';
  s.async = true;
  s.onload = () => {
    if (typeof mixbox !== 'undefined' && typeof mixbox.lerpFloat === 'function'){
      mixboxRef = (b, t, a) => mixbox.lerpFloat(b, t, a);
      mixboxReady = true;
      refresh();
      buildTestTable();
    }
  };
  s.onerror = () => {};
  document.head.appendChild(s);
}

/* ===== HSL（色相/饱和度反解与合成，色轮指示用） ===== */
function rgb2hsl([r,g,b]){
  const M = Math.max(r,g,b), m = Math.min(r,g,b), d = M - m;
  let h = 0;
  if (d > 1e-9){
    if (M === r) h = 60 * (((g-b)/d) % 6);
    else if (M === g) h = 60 * ((b-r)/d + 2);
    else h = 60 * ((r-g)/d + 4);
  }
  if (h < 0) h += 360;
  const l = (M + m) / 2;
  const s = d < 1e-9 ? 0 : d / (1 - Math.abs(2*l - 1));
  return [h, s, l];
}
function hsl2rgb([h,s,l]){
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2*l - 1)) * s;
  const hp = h/60, x = c*(1-Math.abs(hp%2-1)), m = l - c/2;
  const rgb = hp<1 ? [c,x,0] : hp<2 ? [x,c,0] : hp<3 ? [0,c,x] : hp<4 ? [0,x,c] : hp<5 ? [x,0,c] : [c,0,x];
  return rgb.map(v => v + m);
}

/* ===== 标准 Yurmby 色轮（Gurney/Sanford 六主色，均布 60°） ===== */
// Y-R-M-B-C-G 自顶顺时针：黄0° 红60° 品红120° 蓝180° 青240° 绿300°。
// 它是标准 RGB 色相环的镜像等距（f(x) = (60−x) mod 360）：
// 非对径对插值与标准环等价；对径对（恰 180°）因镜像方向取反，中点与标准环相反。
const y2r = h => ((60 - h) % 360 + 360) % 360;   // Yurmby 刻度 → RGB 色相
const r2y = h => ((60 - h) % 360 + 360) % 360;   // RGB 色相 → Yurmby 刻度（同为镜像，自逆）

/* ===== mix methods ===== */
const mixLerp = (a,b,t) => [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
const mat3Inv = m => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det
  ];
};
const PRESETS = {
  base: [['白','#F2F2EF'],['灰','#8A8A93'],['黑','#141417'],['红','#E23B3B'],['橙','#F07A2A'],['黄','#F0C94B'],['绿','#3FA76F'],['青','#3AA8B8'],['蓝','#3B6FE0'],['紫','#8A5BE0']],
  tint: [['镉黄','#FFD61A'],['群青','#2E5EFF'],['朱红','#E8321F'],['翠绿','#00B359'],['品红','#E33BA8'],['橙红','#FF7A1A'],['青','#00D5C0'],['白','#FFFFFF']]
};
function buildDots(containerId, palette, inputId, onPick){
  const el = $(containerId);
  palette.forEach(([name, hex]) => {
    const b = document.createElement('button');
    b.className = 'dot-btn'; b.style.background = hex; b.title = name;
    b.onclick = () => { $(inputId).value = hex; setActive(el, b); onPick(); };
    el.appendChild(b);
  });
}
function setActive(el, btn){
  el.querySelectorAll('.dot-btn').forEach(x => x.classList.remove('on'));
  btn.classList.add('on');
}

/* ===== wheel ===== */
const cv = $('wheel'), ctx = cv.getContext('2d');
const W = cv.width, CX = W/2, R = 270, RING = 44;   // 680 canvas, css 340 max
const ring = document.createElement('canvas');
ring.width = ring.height = W;
(function drawRing(){
  const rc = ring.getContext('2d');
  // 伊登式 Yurmby 色轮：Yurmby 刻度 yb 处绘制颜色 y2r(yb)
  // canvas 角度：顶部 = −90°，顺时针 = 角度增加 → 位置 = (刻度 − 90)°
  for (let yb = 0; yb < 360; yb++){
    const rgb = hsl2rgb([y2r(yb + 0.5), 1, 0.5]);
    rc.strokeStyle = `rgb(${rgb.map(v => Math.round(v*255)).join(',')})`;
    rc.lineWidth = RING;
    rc.beginPath();
    rc.arc(CX, CX, R, (yb - 90) * Math.PI/180, (yb + 1 - 90) * Math.PI/180);
    rc.stroke();
  }
  // ticks: 12 minor (Yurmby 30° 步进) + 6 major (六主色 60°)；位置 = Yurmby 刻度
  const YR_NAMES = {0:'黄',60:'红',120:'品红',180:'蓝',240:'青',300:'绿'};
  for (let i = 0; i < 12; i++){
    const yurm = i * 30;
    const isMain = yurm % 60 === 0;
    const rad = (yurm - 90) * Math.PI/180;
    const r0 = R + RING/2, r1 = r0 + (isMain ? 15 : 9);
    rc.strokeStyle = isMain ? 'rgba(236,236,239,.75)' : 'rgba(236,236,239,.3)';
    rc.lineWidth = isMain ? 2 : 1;
    rc.beginPath();
    rc.moveTo(CX + Math.cos(rad)*r0, CX + Math.sin(rad)*r0);
    rc.lineTo(CX + Math.cos(rad)*r1, CX + Math.sin(rad)*r1);
    rc.stroke();
    if (isMain){
      rc.fillStyle = '#6b6b76';
      rc.font = '28px sans-serif';
      rc.textAlign = 'center'; rc.textBaseline = 'middle';
      rc.fillText(YR_NAMES[yurm], CX + Math.cos(rad)*(r1 + 26), CX + Math.sin(rad)*(r1 + 26));
    }
  }
})();
function drawWheel(mixColor, mixHue, baseHue, tintHue, hasBase, hasTint){
  ctx.clearRect(0, 0, W, W);
  ctx.drawImage(ring, 0, 0);
  const dot = (hue, rr, size) => {
    const rad = (r2y(hue) - 90) * Math.PI/180;         // RGB 色相 → Yurmby 刻度位置
    ctx.beginPath();
    ctx.arc(CX + Math.cos(rad)*rr, CX + Math.sin(rad)*rr, size, 0, 7);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,12,14,.85)';
    ctx.stroke();
  };
  if (hasBase) dot(baseHue, R - 26, 10);
  if (hasTint) dot(tintHue, R + 26, 10);
  if (mixHue != null){
    const rad = (mixHue - 90) * Math.PI/180;           // 混合色相已为 Yurmby 刻度，直接定位
    const x = CX + Math.cos(rad)*R, y = CX + Math.sin(rad)*R;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, 7);
    ctx.fillStyle = '#e0a84c';
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  // center dish（混合色实况）
  ctx.beginPath();
  ctx.arc(CX, CX, 30, 0, 7);
  ctx.fillStyle = RGB2HEX(mixColor || [1,1,1]);
  ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.stroke();
}

/* ===== 测试对照表（T2 压力对 × 3α × 全模型） =====
 * 只在页面初始化与 mixbox 加载完成时构建（不随 refresh 重建）；
 * KM 物理列（unmix 迭代，每格 ~11ms）经分片异步填充并缓存，避免阻塞交互。 */
const TEST_ALPHAS = [0.25, 0.5, 0.75];
/* KM(光谱真值)：unmix 结果按颜色缓存（拖动滑块只变 α 时 base/tint 不变，
 * unmix 迭代不再重算，只做快速光谱混合 + 残差补光 → 更新即时） */
const unmixCache = new Map();
const unmixCached = rgb => {
  const key = rgb[0].toFixed(4) + ',' + rgb[1].toFixed(4) + ',' + rgb[2].toFixed(4);
  let u = unmixCache.get(key);
  if (!u) { u = Spectral.unmixRgb(rgb, { sweeps: 3, seed: 0xC0FFEE }); unmixCache.set(key, u); }
  return u;
};
const specMixFn = (b, t, a) => {
  if (typeof Spectral === 'undefined') return null;
  const ca = unmixCached(b), cb = unmixCached(t);
  const conc = ca.conc.map((v, i) => (1 - a) * v + a * cb.conc[i]);
  const out = Spectral.spectralMixConcs(conc, {});
  const w1 = Math.exp(-ca.de00 / 5), w2 = Math.exp(-cb.de00 / 5);
  const w1e = w1 + (1 - w1) * Math.pow(1 - a, 4), w2e = w2 + (1 - w2) * Math.pow(a, 4);
  const res = out.rgb.map((v, c) => {
    const r1 = b[c] - ca.rgb[c], r2 = t[c] - cb.rgb[c];
    return Math.max(0, Math.min(1, v + (1 - a) * r1 * w1e + a * r2 * w2e));
  });
  return res;
};
const specCache = new Map();
const specMixCached = (b, t, a) => {
  const key = a + '|' + b[0] + ',' + b[1] + ',' + b[2] + '|' + t[0] + ',' + t[1] + ',' + t[2];
  if (specCache.has(key)) return specCache.get(key);
  const v = specMixFn(b, t, a);
  specCache.set(key, v);
  return v;
};
const TEST_MODELS = [['我们的方法', mixPigment], ['RGB', mixLerp], ['KM光谱基准', specMixFn]];
const TEST_PAIRS = [
  ['互补', '#E8321F', '#00D5C0'], ['互补', '#FFD61A', '#2E5EFF'], ['互补', '#E33BA8', '#00B359'],
  ['RYB错配', '#E8321F', '#00B359'], ['RYB错配', '#2E5EFF', '#FF7A1A'], ['RYB错配', '#E8321F', '#2E5EFF'],
  ['RYB错配', '#FFD61A', '#00B359'], ['RYB错配', '#FFD61A', '#00D5C0'], ['RYB错配', '#E33BA8', '#00D5C0'],
  ['白黑混合', '#E8321F', '#FFFFFF'], ['白黑混合', '#2E5EFF', '#FFFFFF'], ['白黑混合', '#FFD61A', '#FFFFFF'],
  ['白黑混合', '#E8321F', '#000000'], ['白黑混合', '#2E5EFF', '#000000'], ['白黑混合', '#00B359', '#000000'],
  ['相似色', '#E8321F', '#FF7A1A'], ['相似色', '#FFD61A', '#FF7A1A'], ['相似色', '#2E5EFF', '#8A5BE0'], ['相似色', '#00B359', '#00D5C0'],
  ['深色+白', '#0D1B44', '#FFFFFF'], ['深色+白', '#000080', '#FFFFFF'], ['深色+白', '#001B75', '#FFFFFF'],
  ['深色+白', '#001E80', '#FFFFFF'], ['深色+白', '#080248', '#FFFFFF'], ['深色+白', '#5F1708', '#FFFFFF'],
  ['深色+白', '#5E0F1A', '#FFFFFF'], ['深色+白', '#4A3A05', '#FFFFFF'], ['深色+白', '#280501', '#FFFFFF'],
  ['深色+白', '#250903', '#FFFFFF'], ['深色+白', '#8E1F0A', '#FFFFFF'], ['深色+白', '#005A32', '#FFFFFF'],
  ['深色+白', '#2A0A5E', '#FFFFFF'], ['深色+白', '#6E0B4A', '#FFFFFF'], ['深色+白', '#7A3B00', '#FFFFFF'],
  ['深色+白', '#00585E', '#FFFFFF']
];
const gradClass = d => d < 1 ? 'de-lt2' : d < 2.5 ? 'de-2to5' : 'de-gt5';
function buildTestTable(){
  const tbl = $('testTbl');
  const thead = tbl.querySelector('thead'), tbody = tbl.querySelector('tbody');
  thead.innerHTML = ''; tbody.innerHTML = '';
  const h1 = document.createElement('tr');
  const h1lbl = document.createElement('th');
  h1lbl.className = 'lbl'; h1lbl.rowSpan = 2; h1lbl.textContent = '色对';
  h1.appendChild(h1lbl);
  for (const a of TEST_ALPHAS){
    const th = document.createElement('th');
    th.colSpan = 5; th.textContent = 'α=' + a.toFixed(2);
    h1.appendChild(th);
  }
  thead.appendChild(h1);
  const h2 = document.createElement('tr');
  for (let i = 0; i < TEST_ALPHAS.length; i++){
    const thRef = document.createElement('th');
    thRef.textContent = 'Mixbox 参考';
    thRef.style.color = 'var(--accent)';
    h2.appendChild(thRef);
    for (const [name] of TEST_MODELS){
      const th = document.createElement('th');
      th.textContent = name;
      if (name === '我们的方法') th.style.color = 'var(--accent)';
      h2.appendChild(th);
    }
  }
  thead.appendChild(h2);
  // 摘要行：每分类均值
  const cats = [];
  for (const [cat, hb, ht] of TEST_PAIRS){
    let c = cats.find(x => x.name === cat);
    if (!c){ c = { name: cat, pairs: [] }; cats.push(c); }
    c.pairs.push([hb, ht]);
  }
  const catSumTds = [];   // 记录 KM 物理摘要格（分片完成后填充）
  for (const c of cats){
    const tr = document.createElement('tr');
    tr.className = 'sum';
    const lbl = document.createElement('td');
    lbl.className = 'lbl'; lbl.textContent = c.name + ' 均值';
    tr.appendChild(lbl);
    for (const a of TEST_ALPHAS){
      const tdRef = document.createElement('td');
      tdRef.textContent = '—';
      tdRef.className = 'ref';
      tr.appendChild(tdRef);
      let mi = 0;
      for (const [name, fn] of TEST_MODELS){
        const td = document.createElement('td');
        if (name === '我们的方法') td.className = 'ours';
        if (name === 'KM光谱基准'){ catSumTds.push({ td, pairs: c.pairs, a }); td.textContent = '…'; }
        else if (mixboxRef){
          let sum = 0;
          for (const [hb, ht] of c.pairs){
            const b = HEX2RGB(hb), t = HEX2RGB(ht);
            sum += de00(fn(b, t, a), mixboxRef(b, t, a));
          }
          const mean = sum / c.pairs.length;
          td.textContent = mean.toFixed(1);
          td.classList.add(gradClass(mean));
        } else td.textContent = '—';
        tr.appendChild(td);
        mi++;
      }
    }
    tbody.appendChild(tr);
  }
  // 逐对
  const tasks = [];   // { td, b, t, a, pair, cat } KM 物理格任务
  for (const [cat, hb, ht] of TEST_PAIRS){
    const tr = document.createElement('tr');
    const lbl = document.createElement('td');
    lbl.className = 'lbl';
    lbl.innerHTML = '<span class="sw-pair"><span class="swt" style="background:' + hb + '"></span><span class="swt" style="background:' + ht + '"></span></span><span style="font-family:var(--mono);font-size:11px">' + hb + ' + ' + ht + '</span> <span style="color:var(--faint);font-size:10px">' + cat + '</span>';
    tr.appendChild(lbl);
    const b = HEX2RGB(hb), t = HEX2RGB(ht);
    for (const a of TEST_ALPHAS){
      const tdRef = document.createElement('td');
      tdRef.className = 'ref';
      tdRef.title = 'Mixbox 参考';
      if (mixboxRef){
        const ref = mixboxRef(b, t, a);
        tdRef.innerHTML = '<span class="cell"><span class="swt" style="background:' + RGB2HEX(ref) + '"></span></span>';
      } else tdRef.textContent = '—';
      tr.appendChild(tdRef);
      let mi = 0;
      for (const [name, fn] of TEST_MODELS){
        const td = document.createElement('td');
        if (name === '我们的方法') td.className = 'ours';
        if (name === 'KM光谱基准'){
          td.innerHTML = '<span class="cell"><span class="swt" style="background:var(--bg-3)"></span>…</span>';
          tasks.push({ td, b, t, a });
        }
        else if (mixboxRef){
          const m = fn(b, t, a);
          const ref = mixboxRef(b, t, a);
          const d = de00(m, ref);
          td.innerHTML = '<span class="cell"><span class="swt" style="background:' + RGB2HEX(m) + '"></span>' + d.toFixed(1) + '</span>';
          td.classList.add(gradClass(d));
        } else td.textContent = '—';
        tr.appendChild(td);
        mi++;
      }
    }
    tbody.appendChild(tr);
  }
  // KM 物理列：分片异步填充（每片 ~10ms，避免阻塞；结果缓存）
  const fillCell = task => {
    const rgb = specMixCached(task.b, task.t, task.a);
    if (rgb && mixboxRef){
      const ref = mixboxRef(task.b, task.t, task.a);
      const d = de00(rgb, ref);
      task.td.innerHTML = '<span class="cell"><span class="swt" style="background:' + RGB2HEX(rgb) + '"></span>' + d.toFixed(1) + '</span>';
      task.td.classList.add(gradClass(d));
    } else if (rgb){
      task.td.innerHTML = '<span class="cell"><span class="swt" style="background:' + RGB2HEX(rgb) + '"></span></span>';
    } else {
      task.td.textContent = '—';
    }
  };
  const fillSummary = () => {
    for (const s of catSumTds){
      if (!mixboxRef){ s.td.textContent = '—'; continue; }
      let sum = 0, n = 0;
      for (const [hb, ht] of s.pairs){
        const rgb = specCache.get(s.a + '|' + HEX2RGB(hb).join(',') + '|' + HEX2RGB(ht).join(','));
        if (rgb){ sum += de00(rgb, mixboxRef(HEX2RGB(hb), HEX2RGB(ht), s.a)); n++; }
      }
      s.td.textContent = n ? (sum / n).toFixed(1) : '—';
    }
  };
  let idx = 0;
  const slice = () => {
    const t0 = performance.now();
    while (idx < tasks.length && performance.now() - t0 < 10) fillCell(tasks[idx++]);
    if (idx < tasks.length){ setTimeout(slice, 0); return; }
    fillSummary();
  };
  setTimeout(slice, 0);
}

/* ===== refresh ===== */
function refresh(){
  base = HEX2RGB($('baseColor').value);
  tint = HEX2RGB($('tintColor').value);
  alpha = parseInt($('alpha').value) / 100;
  $('alphaVal').textContent = Math.round(alpha*100) + '%';
  $('alpha').style.setProperty('--p', alpha*100 + '%');
  $('baseHex').textContent = RGB2HEX(base);
  $('tintHex').textContent = RGB2HEX(tint);

  const r = mixPigment(base, tint, alpha);
  const hex = RGB2HEX(r);
  $('result').style.background = hex;
  $('resultHex').textContent = hex;

  /* KM(光谱真值)：unmix 已按颜色缓存，同步即时计算（α 变化 0.003ms；换色首次 ~13ms） */

  [['swMine', mixPigment], ['swLerp', mixLerp], ['swMx', mixboxRef]]
    .forEach(([id, fn]) => { if (fn) $(id).style.background = RGB2HEX(fn(base, tint, alpha)); });

  if (mixboxRef){
    const ref = mixboxRef(base, tint, alpha);
    $('swMx').style.background = RGB2HEX(ref);
    $('deMine').textContent = 'ΔE00 ' + de00(mixPigment(base, tint, alpha), ref).toFixed(2);
    $('deLerp').textContent = 'ΔE00 ' + de00(mixLerp(base, tint, alpha), ref).toFixed(2);
    $('deMx').textContent = '参考基准';
  } else {
    $('swMx').style.background = 'var(--bg-3)';
    $('deMine').textContent = 'ΔE00 —';
    $('deLerp').textContent = 'ΔE00 —';
    $('deMx').textContent = 'mixbox 未加载';
  }

  /* KM(光谱真值) 同步更新 */
  let specRgb = null;
  try { specRgb = specMixFn(base, tint, alpha); }
  catch (e) { specRgb = null; }
  if (specRgb){
    $('swSpec').style.background = RGB2HEX(specRgb);
    $('deSpec').textContent = '与 Mixbox 差异为结构性，非误差';
    $('deMinePhys').textContent = mixboxRef
      ? 'vs 光谱真值 ' + de00(mixPigment(base, tint, alpha), specRgb).toFixed(2) : '';
  } else {
    $('swSpec').style.background = 'var(--bg-3)';
    $('deSpec').textContent = '—';
    $('deMinePhys').textContent = '';
  }

  const stops = [];
  for (let i = 0; i <= 100; i++) stops.push(RGB2HEX(mixPigment(base, tint, i/100)) + ' ' + i + '%');
  $('ramp').style.background = 'linear-gradient(to right,' + stops.join(',') + ')';

  // 色轮指示：刻度为 Yurmby 标度（0=黄，30°/格）；混合色相取自 mixPigment 输出（S≈0 显示灰）
  const bs = rgb2hsl(base), ts = rgb2hsl(tint);
  const hasB = bs[1] > 1e-5, hasT = ts[1] > 1e-5;
  const ms = rgb2hsl(r);
  const mY = ms[1] > 0.02 ? r2y(ms[0]) : null;
  const mGray = ms[1] <= 0.02;
  $('mBase').textContent = hasB ? Math.round(r2y(bs[0])) + '°' : '—';
  $('mTint').textContent = hasT ? Math.round(r2y(ts[0])) + '°' : '—';
  $('mMix').textContent = mY == null ? '—' : (mGray ? '灰' : Math.round(mY) + '°');
  drawWheel(r, mGray ? null : mY, hasB ? bs[0] : 0, hasT ? ts[0] : 0, hasB, hasT);
}

/* ===== copy ===== */
let copied = false;
$('result').onclick = () => {
  const text = RGB2HEX(mixPigment(base, tint, alpha));
  const done = () => {
    const el = $('resultHex');
    el.textContent = 'copied';
    setTimeout(() => { el.textContent = text; }, 1100);
  };
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(text).then(done).catch(done);
  else done();
};

/* ===== bindings ===== */
buildDots('baseDots', PRESETS.base, 'baseColor', refresh);
buildDots('tintDots', PRESETS.tint, 'tintColor', refresh);
setActive($('baseDots'), $('baseDots').firstChild);
setActive($('tintDots'), $('tintDots').querySelectorAll('.dot-btn')[0]);
$('baseColor').addEventListener('input', refresh);
$('tintColor').addEventListener('input', refresh);
$('alpha').addEventListener('input', refresh);
refresh();            // 轻量刷新（PBM 自包含，立即响应）
buildTestTable();     // 测试表仅构建一次；KM 物理列分片异步填充（不阻塞）
loadMixbox();         // Mixbox 参考异步加载，到达后自动重建表格与 ΔE00


