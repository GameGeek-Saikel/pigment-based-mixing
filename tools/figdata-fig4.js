'use strict';
/* figdata-fig4.js — 计算 fig4 的 ΔE00 分布数据（PBM vs Mixbox），输出 JSON 供 make-fig4.py 使用 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const OUT = path.join(os.tmpdir(), 'pbm-paper-tools', 'fig4-data.json');

async function main() {
  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;
  const ref = sandbox.mixbox.lerpFloat;
  const pbm = suite.MODELS[0];

  const sets = {
    T1: I.buildT1(),
    T2: I.buildT2(),
    T3: I.buildT3(20260808, 2000),
    T5: I.buildT5(),
  };
  const out = {};
  for (const [k, samples] of Object.entries(sets)) {
    out[k] = suite.evaluateSet(pbm, samples, ref).map(e => e.de00);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('fig4 data ->', OUT);
  for (const k of ['T1', 'T2', 'T3', 'T5']) {
    const a = out[k];
    console.log(' ', k, 'n=' + a.length, 'mean=' + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), 'max=' + Math.max(...a).toFixed(1));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
