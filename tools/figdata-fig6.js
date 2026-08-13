'use strict';
/* figdata-fig6.js — 计算 fig6 的邻域连续性数据（8-bit 输入扰动 → 输出 ΔE00）*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const OUT = path.join(os.tmpdir(), 'pbm-paper-tools', 'fig6-data.json');
const N = 8;   // 扰动步数上限（每步 1/255，覆盖 8-bit 单步邻域及其延伸）

async function main() {
  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;
  const ref = sandbox.mixbox.lerpFloat;
  const pbm = suite.MODELS[0];
  const lerp = suite.MODELS[1];
  const de00 = (a, b) => suite.deltaE2000(I.rgbToLab(a), I.rgbToLab(b));

  const base = I.HEX2RGB('#0D1B44');
  const tint = [1, 1, 1];
  const A = 0.5;

  /* 邻域连续性 = 输出相对未扰动基准的变化量 ΔE00(输出(b'), 输出(b)) */
  const baseOut = { PBM: pbm.fn(base, tint, A), LERP: lerp.fn(base, tint, A) };
  const curves = { PBM_R: [], PBM_G: [], PBM_B: [], LERP_R: [] };
  for (let n = 0; n <= N; n++) {
    for (const [key, c] of [['PBM_R', 0], ['PBM_G', 1], ['PBM_B', 2]]) {
      const b = base.slice();
      b[c] = Math.min(1, b[c] + n / 255);
      curves[key].push(de00(pbm.fn(b, tint, A), baseOut.PBM));
    }
    const b = base.slice();
    b[0] = Math.min(1, b[0] + n / 255);
    curves.LERP_R.push(de00(lerp.fn(b, tint, A), baseOut.LERP));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(curves, null, 1));
  console.log('fig6 data ->', OUT);
  console.log('n 0..' + N + '  每步 1/255');
  for (const [k, v] of Object.entries(curves)) {
    console.log(' ', k.padEnd(8), v.map(x => x.toFixed(2)).join(' '));
  }
  const s1 = { PBM_R: curves.PBM_R[1], PBM_G: curves.PBM_G[1], PBM_B: curves.PBM_B[1] };
  console.log('单步(1/255)输出 ΔE00 最大:', Math.max(...Object.values(s1)).toFixed(2), '(论文声明: 8-bit 扰动 ≤ 1.53)');
}

main().catch(e => { console.error(e); process.exit(1); });
