'use strict';
/* run-sensitivity.js — 门参数阈值敏感性（±10% / ±20% 扰动，T5 + T3 均值 ΔE00）
 *
 * 对 javascript/color-mixing.js 做源码替换（suite-loader 的 libPatch），
 * 其余参数保持不变，测量：
 *   w0（深白门白色下限 0.37375181）、maxd0（彩度范围下限 0.06479933）、
 *   k（共享 σ 斜率 11.01639450）。
 * 目标必须唯一命中，未命中时 patch-util 抛错。
 *
 * 用法：node run-sensitivity.js [--out <dir>]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');
const { replaceOnce, replaceAll } = require('./patch-util');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');
const { CM_LIB } = require('./suite-loader');

/* 当前门参数从库源码提取（重拟合后自动跟随） */
const LIB_TEXT = fs.readFileSync(CM_LIB, 'utf8');
function libNum(re, label) {
  const m = LIB_TEXT.match(re);
  if (!m) throw new Error('未能从库中提取（' + label + '）');
  return { text: m[0], value: parseFloat(m[1]) };
}
const W0 = libNum(/w - ([-\d.eE+]+)\)/, 'w0');
const MAXD0 = libNum(/maxd - ([-\d.eE+]+)\)/, 'maxd0');
const KVAL = libNum(/x \* ([-\d.eE+]+);/, 'k');
const MULTS = [0.8, 0.9, 1.1, 1.2];
const PARAMS = [
  ['w0', W0.value],
  ['maxd0', MAXD0.value],
  ['k', KVAL.value],
];

async function evalSet(source, libPatch) {
  const { suite, sandbox } = loadSuite({ mixboxSource: source, libPatch, exportInternals: true });
  const I = suite.__internals;
  const refFn = sandbox.mixbox.lerpFloat;
  const model = suite.MODELS[0];
  const stats = samples => {
    const e = suite.evaluateSet(model, samples, refFn).map(x => x.de00).sort((a, b) => a - b);
    return { n: e.length, mean: +(e.reduce((a, b) => a + b, 0) / e.length).toFixed(4), max: +e[e.length - 1].toFixed(1) };
  };
  return { t5: stats(I.buildT5()), t3: stats(I.buildT3(20260808, 2000)) };
}

function patchFor(name, val) {
  if (name === 'w0') return s => replaceOnce(s, W0.text, 'w - ' + val.toFixed(9) + ')', 'w0');
  if (name === 'maxd0') return s => replaceOnce(s, MAXD0.text, 'maxd - ' + val.toFixed(9) + ')', 'maxd0');
  return s => replaceAll(s, KVAL.text, 'x * ' + val.toFixed(9) + ';', 'k');
}

async function main() {
  const args = process.argv.slice(2);
  const opt = v => { const i = args.indexOf(v); return i >= 0 ? args[i + 1] : null; };
  const outDir = opt('--out') || OUT_DIR;

  const { source } = await fetchMixbox();
  const full = await evalSet(source, null);
  console.log('full       T5 ' + full.t5.mean + '/' + full.t5.max + '  T3 ' + full.t3.mean + '/' + full.t3.max);
  const report = { generatedAt: new Date().toISOString(), full, rows: [] };
  for (const [name, base] of PARAMS) {
    for (const m of MULTS) {
      const val = base * m;
      const r = await evalSet(source, patchFor(name, val));
      const dt5 = r.t5.mean - full.t5.mean, dt3 = r.t3.mean - full.t3.mean;
      report.rows.push({ param: name, mult: m, value: +val.toFixed(9), t5: r.t5, t3: r.t3, dT5: +dt5.toFixed(3), dT3: +dt3.toFixed(3) });
      console.log(name.padEnd(7) + ' x' + m.toFixed(1).padEnd(5) + ' T5 ' + r.t5.mean + '/' + r.t5.max +
        ' (Δ' + (dt5 >= 0 ? '+' : '') + dt5.toFixed(3) + ')  T3 ' + r.t3.mean + '/' + r.t3.max +
        ' (Δ' + (dt3 >= 0 ? '+' : '') + dt3.toFixed(3) + ')');
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'sensitivity-report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('report ->', file);
}

main().catch(e => { console.error(e); process.exit(1); });