'use strict';
/* run-final-verify.js — 合并后 eval 终验（全套件 + held-out + 语料族 + 目标对）
 * 对照：现状基线（git 中合并前的模型已不可直接加载——使用文档基线数字）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const ALPHAS = [];
for (let a = 0.05; a <= 0.95001; a += 0.05) ALPHAS.push(+a.toFixed(2));
const TAIL_ALPHAS = [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99];

function statsOf(de00) {
  const s = de00.slice().sort((x, y) => x - y);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const p95 = s[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  const median = s[Math.floor(n / 2)];
  return { n, mean, max: s[n - 1], p95, median };
}

async function main() {
  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;
  const refFn = sandbox.mixbox.lerpFloat;
  const model = suite.MODELS[0];
  const de00 = (a, b) => suite.deltaE2000(I.rgbToLab(a), I.rgbToLab(b));
  const { buildT1, buildT2, buildT3, buildT5 } = I;

  const t3Ho = buildT3(20260808, 2000).slice(800);
  const t3S1 = buildT3(20260809, 2000);
  const t3S2 = buildT3(20260811, 2000);
  const t5Ho = I.buildT5Random(20260812, I.T5_RANDOM_N)
    .map(s => ({ ...s, set: 'T5-heldout', cat: '深色+白·随机(held-out)' }));
  const tail = [];
  for (const [cat, hb] of I.T5_DEF) for (const a of TAIL_ALPHAS) tail.push({ base: I.HEX2RGB(hb), tint: [1, 1, 1], a });

  const sets = [
    ['T1 调色板', buildT1()],
    ['T2 压力对', buildT2()],
    ['T3 随机 2000', buildT3(20260808, 2000)],
    ['T5 深色+白', buildT5()],
    ['tail 尾端', tail],
    ['T3-heldout 切片', t3Ho],
    ['T3-seed-09', t3S1],
    ['T3-seed-11', t3S2],
    ['T5-heldout', t5Ho],
  ];
  const report = { generatedAt: new Date().toISOString(), sets: [] };
  console.log('== 合并后 eval（优化参数终值）==');
  for (const [label, samples] of sets) {
    const e = suite.evaluateSet(model, samples, refFn).map(x => x.de00);
    const st = statsOf(e);
    report.sets.push({ label, ...st });
    console.log(label.padEnd(20), 'mean=' + st.mean.toFixed(3), 'max=' + st.max.toFixed(1), 'p95=' + st.p95.toFixed(3), 'med=' + st.median.toFixed(3));
  }

  const cust = [
    ['黄×深蓝 #FFC400+#000F3D', '#FFC400', '#000F3D'], ['黄×近边界 #FFC400+#000724', '#FFC400', '#000724'],
    ['红×绿 #A30000+#00B359', '#A30000', '#00B359'], ['红×青 #A30000+#00D5C0', '#A30000', '#00D5C0'],
    ['品红×绿 #E33BA8+#00B359', '#E33BA8', '#00B359'], ['橙×蓝 #FF7A1A+#2E5EFF', '#FF7A1A', '#2E5EFF'],
    ['橙×深蓝 #FF7A1A+#001B75', '#FF7A1A', '#001B75'], ['红×深蓝 #A30000+#001B75', '#A30000', '#001B75'],
  ];
  console.log('');
  console.log('--- 目标对/未覆盖对 mean ΔE00（α∈0.05..0.95）---');
  report.targets = [];
  for (const [nm, h1, h2] of cust) {
    const b = I.HEX2RGB(h1), t = I.HEX2RGB(h2);
    const m = ALPHAS.reduce((s0, a) => s0 + de00(model.fn(b, t, a), refFn(b, t, a)), 0) / ALPHAS.length;
    report.targets.push({ name: nm, mean: +m.toFixed(3) });
    console.log(nm.padEnd(34), m.toFixed(2));
  }

  fs.mkdirSync(path.join(os.tmpdir(), 'pbm-paper-tools', 'out'), { recursive: true });
  fs.writeFileSync(path.join(os.tmpdir(), 'pbm-paper-tools', 'out', 'final-verify.json'), JSON.stringify(report, null, 2));
  console.log('');
  console.log('report ->', path.join(os.tmpdir(), 'pbm-paper-tools', 'out', 'final-verify.json'));
}

main().catch(e => { console.error(e); process.exit(1); });
