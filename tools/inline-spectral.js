'use strict';
/* inline-spectral.js — 把 tools/spectral/*.js 打包为 demo/spectral-inline.js
 *
 * demo/color-mixing-demo.html 以 <script src="spectral-inline.js"> 引用；
 * 光谱数据与物理管线保持自包含（除 Mixbox CDN 外无外部依赖）。
 * 数据源唯一：tools/spectral/。
 *
 * 用法：node inline-spectral.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'demo', 'spectral-inline.js');
const SRC = [
  ['pigments.js', '合成颜料光谱（物理启发高斯吸收带，无第三方数据）+ CIE 1931 2°/D65 标准表（tools/spectral/pigments.js）'],
  ['pipeline.js', '物理光谱混色管线（tools/spectral/pipeline.js）：两常数 K–M 前向 / unmix / 残差补光']
];

const blocks = SRC.map(([file, desc]) => {
  const code = fs.readFileSync(path.join(__dirname, 'spectral', file), 'utf8');
  return `/* ${file} — ${desc}（由 tools/inline-spectral.js 生成，勿手改） */\n${code}`;
});

const out = `/* =====================================================================
 * spectral-inline.js — 合成光谱数据 + 物理管线（浏览器打包）
 *
 * 由 tools/inline-spectral.js 生成（勿手改）；数据源唯一：
 * tools/spectral/pigments.js（→ window.PigmentData）与
 * tools/spectral/pipeline.js（→ window.Spectral）。
 * =================================================================== */
${blocks.join('\n\n')}
`;

fs.writeFileSync(OUT, out);
console.log('spectral bundle ->', OUT, `(${out.length} chars)`);
