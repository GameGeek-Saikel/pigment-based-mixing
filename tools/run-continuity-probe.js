'use strict';
/* run-continuity-probe.js — 全局邻域连续性探测
 *
 * 随机对 × 每通道 ±1/255 扰动 + α+0.004，统计输出最大单步 ΔE00 与
 * 超过 1.53 的次数。对照：
 *   full     完整模型（cSat 双侧色度软衰减启用）
 *   no-cSat  cSat ≡ 1（关闭色度衰减，用于验证其对连续性的作用）
 *
 * 变体通过 suite-loader 的 libPatch 替换 javascript/color-mixing.js 构造。
 *
 * 用法：node run-continuity-probe.js
 */
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');
const { replaceOnce } = require('./patch-util');

const N = 4000, SEED = 20260701, THRESHOLD = 1.53;

function noCsat(s) {
  return replaceOnce(s,
    'const cSat = ssT(M - mn, 0.02, 0.15) * ssT(um - wu, 0.08, 0.30);',
    'const cSat = 1;', 'cSat');
}

async function main() {
  const { source } = await fetchMixbox();

  async function run(name, libPatch) {
    const { suite } = loadSuite({ mixboxSource: source, libPatch, exportInternals: true });
    const I = suite.__internals;
    const pbm = suite.MODELS[0].fn;
    const de = (a, b) => suite.deltaE2000(I.rgbToLab(a), I.rgbToLab(b));
    const rnd = I.mulberry32(SEED);
    const p = (c, k) => Math.max(0, Math.min(1, c + (k ? 1 : -1) / 255));
    let worst = 0, worstPos = null, over = 0;
    for (let n = 0; n < N; n++) {
      const b = [rnd(), rnd(), rnd()], t = [rnd(), rnd(), rnd()], a = 0.05 + 0.9 * rnd();
      const o = pbm(b, t, a);
      for (let c = 0; c < 3; c++) for (const k of [1, -1]) {
        const bb = b.slice(); bb[c] = p(b[c], k);
        const d = de(pbm(bb, t, a), o);
        if (d > worst) { worst = d; worstPos = { b, t, a, ch: c, k, d }; }
        if (d > THRESHOLD) over++;
      }
      for (let c = 0; c < 3; c++) for (const k of [1, -1]) {
        const tt = t.slice(); tt[c] = p(t[c], k);
        const d = de(pbm(b, tt, a), o);
        if (d > worst) { worst = d; worstPos = { b, t, a, ch: c, k, d }; }
        if (d > THRESHOLD) over++;
      }
      const da = de(pbm(b, t, Math.min(1, a + 0.004)), o);
      if (da > worst) { worst = da; worstPos = { b, t, a, ch: 'α', k: 1, d: da }; }
      if (da > THRESHOLD) over++;
    }
    console.log(name.padEnd(12), '| 最大单步 ΔE00 ' + worst.toFixed(3),
      '| 超 ' + THRESHOLD + ' 次数 ' + over,
      '| 位置', JSON.stringify(worstPos && {
        b: worstPos.b.map(v => Math.round(v * 255)), t: worstPos.t.map(v => Math.round(v * 255)),
        a: +worstPos.a.toFixed(2), ch: worstPos.ch, d: +worstPos.d.toFixed(2) }));
    return { name, worst, over, worstPos };
  }

  console.log('配置         | 最大单步 ΔE00 | 超阈次数 | 最坏位置');
  const rows = [];
  rows.push(await run('full', null));
  rows.push(await run('no-cSat', noCsat));
  const out = { generatedAt: new Date().toISOString(), n: N, seed: SEED, threshold: THRESHOLD, rows };
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'continuity-report.json'), JSON.stringify(out, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
