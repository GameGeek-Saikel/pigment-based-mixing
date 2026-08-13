'use strict';
/* run-continuity-probe.js — 全局连续性探测（候选门控对比）
 * 随机对 × 每通道 ±1/255 扰动 + α±0.004，输出最大单步 ΔE00。
 */
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const GATE_RE = /const gComp = clamp\([\s\S]*?maxdU - PBM_CC_MD_U\) \* PBM_CC_KH, 0, 1\);?/;
const patchC3 = W => s => s.replace(GATE_RE, `const mMin = Math.min(wU * cP - PBM_CC_OPP,
    u[0] - u[1] + PBM_CC_YEL, u[1] - u[2], u[1] - PBM_CC_G_LO,
    pig[2] - pig[0], pig[2] - pig[1], PBM_CC_RMAX - pig[0],
    M - PBM_CC_M_LO, PBM_CC_M_HI - M, maxd - PBM_CC_MD_PIG, maxdU - PBM_CC_MD_U);
  const tc = clamp((mMin + ${W}) / (2 * ${W}), 0, 1);
  const gComp = tc * tc * (3 - 2 * tc);`);

async function main() {
  const { source } = await fetchMixbox();
  const N = 4000, SEED = 20260701;

  async function run(name, patch) {
    const { suite, sandbox } = loadSuite({ mixboxSource: source, patch, exportInternals: true });
    const I = suite.__internals;
    const pbm = suite.MODELS[0].fn;
    const de = (a, b) => suite.deltaE2000(I.rgbToLab(a), I.rgbToLab(b));
    const rnd = I.mulberry32(SEED);
    const p = (c, k) => Math.max(0, Math.min(1, c + (k ? 1 : -1) / 255));
    let worst = 0, worstPos = null, over153 = 0;
    for (let n = 0; n < N; n++) {
      const b = [rnd(), rnd(), rnd()], t = [rnd(), rnd(), rnd()], a = 0.05 + 0.9 * rnd();
      const o = pbm(b, t, a);
      for (let c = 0; c < 3; c++) for (const k of [1, -1]) {
        const bb = b.slice(); bb[c] = p(b[c], k);
        const d = de(pbm(bb, t, a), o);
        if (d > worst) { worst = d; worstPos = { b, t, a, ch: c, k, d }; }
        if (d > 1.53) over153++;
      }
      for (let c = 0; c < 3; c++) for (const k of [1, -1]) {
        const tt = t.slice(); tt[c] = p(t[c], k);
        const d = de(pbm(b, tt, a), o);
        if (d > worst) { worst = d; worstPos = { b, t, a, ch: c, k, d }; }
        if (d > 1.53) over153++;
      }
      const da = de(pbm(b, t, Math.min(1, a + 0.004)), o);
      if (da > worst) { worst = da; worstPos = { b, t, a, ch: 'α', k: 1, d: da }; }
      if (da > 1.53) over153++;
    }
    console.log(name.padEnd(14), '| 全局最大单步ΔE', worst.toFixed(3),
      '| 超1.53次数', over153, '| 位置', JSON.stringify(worstPos && {
        b: worstPos.b.map(v => Math.round(v * 255)), t: worstPos.t.map(v => Math.round(v * 255)),
        a: +worstPos.a.toFixed(2), ch: worstPos.ch, d: +worstPos.d.toFixed(2) }));
  }

  console.log('配置           | 全局最大单步ΔE | 超1.53次数 | 最坏位置');
  await run('C0 现行', null);
  await run('C3 w=0.05', patchC3(0.05));
  await run('C3b w=0.08', patchC3(0.08));
}

main().catch(e => { console.error(e); process.exit(1); });
