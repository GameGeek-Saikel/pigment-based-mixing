'use strict';
/* run-figures.js — 生成论文插图（SVG，零依赖）
 *
 * 输出到 docs/assets/：
 *   fig1-mixing.svg        动机对比色板（RGB interpolation / raw K-M / PBM / Mixbox）
 *   fig2-architecture.svg  PBM 数据流（门控凸组合）
 *   fig3-staircase.svg     p(v) 反解数据点 + 软阶跃近似曲线
 *   fig4-error-dist.svg    各测试集 ΔE00 分布直方图
 *   fig5-worst-pairs.svg   最差对色块对比（参考 vs PBM vs RGB interpolation）
 *   fig6-continuity.svg    8-bit 输入扰动 → 输出 ΔE00 曲线
 *   fig7-mixing-white.svg  深色+白 梯度定性对比（参考 vs PBM vs RGB interpolation）
 *
 * 用法：node run-figures.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');
const spectral = require('./spectral/pipeline');

const OUT = path.join(__dirname, '..', '..', 'docs', 'assets');
const F = (w, h, inner) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif"><rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>${inner}</svg>`;
const rgb = c => `rgb(${Math.round(Math.max(0, Math.min(1, c[0])) * 255)},${Math.round(Math.max(0, Math.min(1, c[1])) * 255)},${Math.round(Math.max(0, Math.min(1, c[2])) * 255)})`;
const chip = (x, y, w, h, c, sw) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${rgb(c)}" stroke="#555" stroke-width="${sw || 0.75}"/>`;
const text = (x, y, s, o) => `<text x="${x}" y="${y}" font-size="${o && o.size || 11}" fill="${(o && o.fill) || '#222'}" text-anchor="${(o && o.anchor) || 'middle'}">${s}</text>`;
const line = (x1, y1, x2, y2, o) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${(o && o.stroke) || '#999'}" stroke-width="${(o && o.w) || 1}" stroke-dasharray="${(o && o.dash) || ''}"/>`;

function collectCtx(suite, sandbox) {
  const I = suite.__internals;
  return {
    I, suite, sandbox,
    ref: sandbox.mixbox.lerpFloat,
    PBM: suite.MODELS[0],
    RGB: suite.MODELS[1],
    KM: suite.MODELS[2],
    ART: suite.MODELS[3],
    de00: (a, b) => suite.deltaE2000(I.rgbToLab(a), I.rgbToLab(b)),
  };
}

/* ============ Fig.1 动机色板 ============ */
/* KM 行 = 光谱 K–M（§5.8 的合成光谱真值模型：合成颜料光谱 + 两常数 Duncan
 * 叠加 + D65×CMF 积分）。输入为纯颜料的渲染色（与 §5.8 一致），光谱直接
 * 混合，不经过 RGB 反解——K–M 的正确行为：黄+蓝→绿、深+白保持饱和。
 * 早期版本用显示值 κ 叠加（kmDual），其深色+白行为有结构性缺陷（§3.2）。 */
const pd = require('./spectral/pigments');
const KS_DEEP_BLUE = pd.ksOf('deep_blue');
const KS_YELLOW = pd.ksOf('yellow_1');
const KS_WHITE = pd.ksOf('white');
function fig1(ctx) {
  const deepBlue = spectral.paintRgb('deep_blue').rgb;
  const yellow = spectral.paintRgb('yellow_1').rgb;
  const white = spectral.paintRgb('white').rgb;
  const hex = c => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
  const pairs = [
    { name: 'deep blue pigment ' + hex(deepBlue) + ' + bright yellow pigment ' + hex(yellow), base: deepBlue, tint: yellow, ks: [KS_DEEP_BLUE, KS_YELLOW] },
    { name: 'deep blue pigment ' + hex(deepBlue) + ' + white', base: deepBlue, tint: white, ks: [KS_DEEP_BLUE, KS_WHITE] },
  ];
  const rows = [['RGB interpolation', ctx.RGB], ['Kubelka–Munk', null, 'km'], ['PBM (ours)', ctx.PBM], ['Mixbox (ref)', null]];
  const ALPHAS = [0, 0.25, 0.5, 0.75, 1];
  const CW = 92, CH = 36, GAP = 8, RH = 44;
  // 平衡布局：标签区加宽容纳 "Kubelka–Munk"，网格右移但两侧均留白（左 30 / 右 64）
  const LABEL_X = 270, SPLIT_X = 285, X0 = 300;
  const TOP = 76, GROUP_H = 4 * RH + 28;
  const H = TOP + 2 * GROUP_H + 34;
  const W = 856;
  let s = '';
  s += text(30, 18, 'Mixing ramp: each row is one model; each column is the tint share α (0 = base → 1 = tint)', { size: 12, fill: '#444', anchor: 'start' });
  ALPHAS.forEach((a, ai) => s += text(X0 + ai * (CW + GAP) + CW / 2, 44, 'α = ' + a, { size: 11, fill: '#666' }));
  s += line(SPLIT_X, 28, SPLIT_X, H - 36, { stroke: '#bbb', w: 1 });
  pairs.forEach((pr, pi) => {
    const y0 = TOP + pi * GROUP_H;
    s += text(X0, y0 - 10, pr.name, { size: 12, anchor: 'start', fill: '#222' });
    /* 左侧参照区：base / tint 色块（标签置于色块正下方） */
    const refY = y0 + (4 * RH - 2 * CH - 18) / 2;
    s += chip(30, refY, 60, CH, pr.base);
    s += text(60, refY + CH + 14, 'base', { size: 11, fill: '#666' });
    s += chip(30, refY + CH + 26, 60, CH, pr.tint);
    s += text(60, refY + 2 * CH + 40, 'tint', { size: 11, fill: '#666' });
    rows.forEach((row, ri) => {
      const y = y0 + ri * RH;
      s += text(LABEL_X, y + CH / 2 + 4, row[0], { size: 12, anchor: 'end', fill: row[0].includes('PBM') ? '#003087' : '#222' });
      ALPHAS.forEach((a, ai) => {
        const c = row[1] ? row[1].fn(pr.base, pr.tint, a)
          : (row[2] === 'km' ? spectral.spectralMix(pr.ks[0], pr.ks[1], a).rgb : ctx.ref(pr.base, pr.tint, a));
        s += chip(X0 + ai * (CW + GAP), y, CW, CH, c);
      });
    });
  });
  s += text(30, H - 10, 'α = 0 returns the base color, α = 1 returns the tint; the Mixbox reference row is shown for comparison.', { size: 11, fill: '#777', anchor: 'start' });
  fs.writeFileSync(path.join(OUT, 'fig1-mixing.svg'), F(W, H, s));
  console.log('fig1-mixing.svg', W + 'x' + H);
}

function fig2() {
  /* fig2 由 matplotlib mathtext（TeX 排版）生成，见 make-fig2.py；
   * 这里通过 node 调用，保持 run-figures.js 一键生成全部插图。 */
  const { execSync } = require('child_process');
  const py = path.join(__dirname, 'make-fig2.py');
  try {
    execSync('python "' + py + '"', { stdio: 'inherit' });
  } catch (e) {
    console.error('fig2 生成失败（需要 python + matplotlib）:', e.message);
    throw e;
  }
}

/* ============ Fig.3 p(v) 阶梯 ============ */
function fig3() {
  /* 数据由 figdata.js（Mixbox 反解 + PBM 端到端）计算，绘图由 make-fig3.py（matplotlib）完成 */
  const { execSync } = require('child_process');
  execSync('node "' + path.join(__dirname, 'figdata.js') + '"', { stdio: 'inherit' });
  execSync('python "' + path.join(__dirname, 'make-fig3.py') + '"', { stdio: 'inherit' });
}

/* ============ Fig.4 ΔE00 分布直方图 ============ */
function fig4() {
  /* 数据由 figdata-fig4.js（PBM vs Mixbox ΔE00 分布）计算，绘图由 make-fig4.py（matplotlib）完成 */
  const { execSync } = require('child_process');
  execSync('node "' + path.join(__dirname, 'figdata-fig4.js') + '"', { stdio: 'inherit' });
  execSync('python "' + path.join(__dirname, 'make-fig4.py') + '"', { stdio: 'inherit' });
}

/* ============ Fig.5 最差对 ============ */
function fig5(ctx) {
  const I = ctx.I, suite = ctx.suite, ref = ctx.ref;
  const rows = [];
  const pushWorst = (label, samples) => {
    const es = suite.evaluateSet(ctx.PBM, samples, ref).sort((a, b) => b.de00 - a.de00);
    for (const e of es.slice(0, 1)) rows.push({ label, e });
  };
  pushWorst('T2 complementary (worst)', I.buildT2().filter(s => s.cat === '互补对'));
  pushWorst('T3 random (worst)', I.buildT3(20260808, 2000));
  pushWorst('T5 dark+white (worst)', I.buildT5());
  const W = 720, H = 30 + rows.length * 120 + 20;
  let s = '';
  rows.forEach((row, i) => {
    const y = 30 + i * 120;
    const e = row.e;
    const pbm = ctx.PBM.fn(e.base, e.tint, e.a);
    const lerp = ctx.RGB.fn(e.base, e.tint, e.a);
    s += text(20, y + 18, row.label, { size: 12, anchor: 'start' });
    s += text(20, y + 38, 'α = ' + e.a.toFixed(2), { size: 11, fill: '#666', anchor: 'start' });
    s += chip(20, y + 48, 74, 50, e.base);
    s += chip(98, y + 48, 74, 50, e.tint);
    s += text(200, y + 58, 'Mixbox ref', { size: 11, anchor: 'start' }); s += chip(200, y + 66, 110, 34, e.r);
    s += text(330, y + 58, 'PBM', { size: 11, anchor: 'start' }); s += chip(330, y + 66, 110, 34, pbm);
    s += text(460, y + 58, 'RGB interpolation', { size: 11, anchor: 'start' }); s += chip(460, y + 66, 110, 34, lerp);
    s += text(610, y + 66, 'ΔE00 ' + e.de00.toFixed(2), { size: 12, fill: '#e00000', anchor: 'start' });
    s += line(20, y + 112, 700, y + 112, { stroke: '#ddd' });
  });
  fs.writeFileSync(path.join(OUT, 'fig5-worst-pairs.svg'), F(W, H, s));
  console.log('fig5-worst-pairs.svg');
}

/* ============ Fig.6 邻域连续性 ============ */
function fig6() {
  /* 数据由 figdata-fig6.js（8-bit 输入扰动 → 输出变化 ΔE00）计算，绘图由 make-fig6.py（matplotlib）完成 */
  const { execSync } = require('child_process');
  execSync('node "' + path.join(__dirname, 'figdata-fig6.js') + '"', { stdio: 'inherit' });
  execSync('python "' + path.join(__dirname, 'make-fig6.py') + '"', { stdio: 'inherit' });
}

/* ============ Fig.7 深色+白 梯度定性对比 ============ */
function fig7(ctx) {
  const colors = [
    { name: 'deep blue #0D1B44', base: ctx.I.HEX2RGB('#0D1B44') },
    { name: 'deep red #5E0F1A', base: ctx.I.HEX2RGB('#5E0F1A') },
    { name: 'deep green #005A32', base: ctx.I.HEX2RGB('#005A32') },
  ];
  const rows = [['Mixbox reference', null], ['PBM (ours)', ctx.PBM], ['RGB interpolation', ctx.RGB]];
  const ALPHAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const CW = 60, CH = 36, GAP = 6, RH = 44;
  const LABEL_X = 210, SPLIT_X = 225, X0 = 240;   // 行标签右缘 / 分隔线 / 网格左缘
  const TOP = 76, GROUP_H = 3 * RH + 28;
  const H = TOP + 3 * GROUP_H + 34;
  const W = 1000;
  let s = '';
  s += text(30, 18, 'Deep colors lightened with white: each column is the white share α (0 = deep color → 1 = white)', { size: 12, fill: '#444', anchor: 'start' });
  ALPHAS.forEach((a, ai) => s += text(X0 + ai * (CW + GAP) + CW / 2, 44, 'α = ' + a, { size: 11, fill: '#666' }));
  s += line(SPLIT_X, 28, SPLIT_X, H - 36, { stroke: '#bbb', w: 1 });
  colors.forEach((pr, pi) => {
    const y0 = TOP + pi * GROUP_H;
    s += text(X0, y0 - 10, pr.name, { size: 12, anchor: 'start', fill: '#222' });
    const refY = y0 + (3 * RH - 2 * CH - 18) / 2;
    s += chip(30, refY, 60, CH, pr.base);
    s += text(60, refY + CH + 14, 'deep', { size: 11, fill: '#666' });
    s += chip(30, refY + CH + 26, 60, CH, [1, 1, 1]);
    s += text(60, refY + 2 * CH + 40, 'white', { size: 11, fill: '#666' });
    rows.forEach((row, ri) => {
      const y = y0 + ri * RH;
      s += text(LABEL_X, y + CH / 2 + 4, row[0], { size: 12, anchor: 'end', fill: row[0].includes('PBM') ? '#003087' : '#222' });
      ALPHAS.forEach((a, ai) => {
        const c = row[1] ? row[1].fn(pr.base, [1, 1, 1], a) : ctx.ref(pr.base, [1, 1, 1], a);
        s += chip(X0 + ai * (CW + GAP), y, CW, CH, c);
      });
    });
  });
  s += text(30, H - 10, 'RGB interpolation desaturates the deep colors toward gray-white; PBM follows the saturated, hue-shifting trajectories of the reference.', { size: 11, fill: '#777', anchor: 'start' });
  fs.writeFileSync(path.join(OUT, 'fig7-mixing-white.svg'), F(W, H, s));
  console.log('fig7-mixing-white.svg', W + 'x' + H);
}

async function main() {
  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const ctx = collectCtx(suite, sandbox);
  fs.mkdirSync(OUT, { recursive: true });
  fig1(ctx);
  fig2();
  fig3(ctx);
  fig4(ctx);
  fig5(ctx);
  fig6(ctx);
  fig7(ctx);
  console.log('figures ->', OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
