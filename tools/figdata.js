'use strict';
/* figdata.js — 计算 fig3 的绘图数据（Mixbox 反解 + PBM 端到端），输出 JSON 供 make-fig3.py 使用 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const OUT = path.join(os.tmpdir(), 'pbm-paper-tools', 'fig3-data.json');

async function main() {
  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;
  const ref = sandbox.mixbox.lerpFloat;
  const pbm = suite.MODELS[0];
  const invert = (r, v, a) => (r - v) > 1e-9 ? Math.log((r - v) / (1 - v)) / Math.log(a) : null;
  const A = 0.5;

  /* 合成色 (0.01, v, 0.01) + 白，G 通道（G=max，中性路径）*/
  const synth = [];
  for (const v of [0.05, 0.12, 0.25, 0.35, 0.55]) {
    const r = ref([0.01, v, 0.01], [1, 1, 1], A);
    synth.push([v, invert(r[1], v, A)]);
  }

  /* T5 锚点各通道反解（0..0.6）*/
  const anchors = ['#0D1B44', '#001B75', '#000080', '#080248', '#0A2A6E', '#001E80', '#005A32', '#6E0B4A'];
  const pts = { B: [], G: [], R: [] };
  const chName = ['R', 'G', 'B'];
  for (const h of anchors) {
    const base = I.HEX2RGB(h);
    const r = ref(base, [1, 1, 1], A);
    for (let c = 0; c < 3; c++) {
      const p = invert(r[c], base[c], A);
      if (p !== null && base[c] <= 0.6) pts[chName[c]].push([base[c], p]);
    }
  }

  /* 软阶跃近似曲线（B/G 族，当前终态常数：斜率与全局 σ 门共享、G/B 上台阶共享）*/
  const stair = (c1, c2, c3, t1, t2, k) => v =>
    c1 + (c2 - c1) * Math.max(0, Math.min(1, k * (v - t1))) + (c3 - c2) * Math.max(0, Math.min(1, k * (v - t2)));
  const sB = stair(0.88024633, 0.33545176, 0.19217412, 0.04633146, 0.24928142, 12.584001);
  const sG = stair(0.57387051, 0.596528, 0.19217412, 0.04633146, 0.24928142, 12.584001);
  const curveB = [], curveG = [];
  for (let v = 0; v <= 0.601; v += 0.01) { curveB.push([v, sB(v)]); curveG.push([v, sG(v)]); }

  /* PBM 端到端反解（G 通道）*/
  const curveP = [];
  for (let v = 0.02; v <= 0.601; v += 0.01) {
    const r = pbm.fn([0.01, v, 0.01], [1, 1, 1], A);
    const p = invert(r[1], v, A);
    curveP.push([v, p === null ? 1 : p]);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ synth, pts, curveB, curveG, curveP }, null, 1));
  console.log('fig3 data ->', OUT);
  console.log('synth:', synth.map(p => p[0] + '→' + (p[1] || 0).toFixed(2)).join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
