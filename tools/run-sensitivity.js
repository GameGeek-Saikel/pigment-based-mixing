'use strict';
/* run-sensitivity.js — 门参数阈值敏感性（±10% / ±20% 扰动，T5 + T3 均值 ΔE00）
 *
 * 对照当前终态模型（5 可调参数）；覆盖论文 §4.5 表 8 的测量：
 *   w0（深白门白下限）、maxd0（彩度范围下限）、k（共享 σ 门斜率）。
 * （早期版本的上带门 tl/tlK 已随迭代 13 惰性移除，不再测试。）
 *
 * 用法：node run-sensitivity.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const OUT_FILE = path.join(os.tmpdir(), 'pbm-paper-tools', 'out', 'sensitivity-report.json');
const MULTS = [0.8, 0.9, 1.1, 1.2];
const PARAMS = [
  ['w0',    'w - 0.3706311',   0.3706311],
  ['maxd0', 'maxd - 0.06556298', 0.06556298],
  ['k',     '12.584001',        12.584001],
];

async function evalSet(patch) {
  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, patch, exportInternals: true });
  const I = suite.__internals;
  const refFn = sandbox.mixbox.lerpFloat;
  const model = suite.MODELS[0];
  const stats = samples => {
    const e = suite.evaluateSet(model, samples, refFn).map(x => x.de00).sort((a, b) => a - b);
    return { n: e.length, mean: +(e.reduce((a, b) => a + b, 0) / e.length).toFixed(4), max: +e[e.length - 1].toFixed(1) };
  };
  return { t5: stats(I.buildT5()), t3: stats(I.buildT3(20260808, 2000)) };
}

async function main() {
  const full = await evalSet(null);
  console.log('full       T5 ' + full.t5.mean + '/' + full.t5.max + '  T3 ' + full.t3.mean + '/' + full.t3.max);
  const report = { generatedAt: new Date().toISOString(), full, rows: [] };
  for (const [name, token, base] of PARAMS) {
    for (const m of MULTS) {
      const val = base * m;
      const patch = s => {
        s = s.replace(/\r\n/g, '\n');
        if (name === 'k') return s.split('12.584001').join(val.toFixed(9));
        return s.split(token).join(name === 'w0' ? ('w - ' + val) : ('maxd - ' + val));
      };
      const r = await evalSet(patch);
      const dt5 = r.t5.mean - full.t5.mean, dt3 = r.t3.mean - full.t3.mean;
      report.rows.push({ param: name, mult: m, value: +val.toFixed(9), t5: r.t5, t3: r.t3, dT5: +dt5.toFixed(3), dT3: +dt3.toFixed(3) });
      console.log(name.padEnd(7) + ' x' + m.toFixed(1).padEnd(5) + ' T5 ' + r.t5.mean + '/' + r.t5.max +
        ' (Δ' + (dt5 >= 0 ? '+' : '') + dt5.toFixed(3) + ')  T3 ' + r.t3.mean + '/' + r.t3.max +
        ' (Δ' + (dt3 >= 0 ? '+' : '') + dt3.toFixed(3) + ')');
    }
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log('report ->', OUT_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
