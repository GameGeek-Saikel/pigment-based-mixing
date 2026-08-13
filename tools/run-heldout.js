'use strict';
/* run-heldout.js — held-out 评测（论文 §5 用数据）
 *
 * in-sample 集（用于参数拟合，如实标注）：T1 / T2 / T5 / tail
 * held-out 集：T3 不相交切片 [800:2000)（seed 20260808，与拟合 800 对零重叠）、
 *             T3 独立 seed 20260809 / 20260811 全量
 *             （20260811 取代原 20260810：后者与 T5 随机深色共用 mulberry32 流，
 *              不构成独立 PRNG 流，见论文附录 A.4/A.5 修订说明）
 *             T5-heldout 深色+白 独立 seed 20260812（全新，未用于拟合）
 *
 * 统计：ΔE00 mean/max/median/p95/SD + bootstrap 95% CI（mean 与 p95）。
 *
 * 用法：node run-heldout.js [--out <dir>] [--nBoot <n>]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');
const FITTING_SEED = 20260808;
const TAIL_ALPHAS = [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99];
/* 深蓝盲区色：论文 §4.5/§3.5 提及 #060538、#000333；其余为 T5 深蓝族（论文未枚举完整清单，如实标注近似） */
const BLIND_SPOTS = ['#0D1B44', '#001B75', '#000080', '#001E80', '#080248', '#0A2A6E', '#2A0A5E', '#060538', '#000333'];
/* held-out 深色+白 独立 seed：与拟合语料（20260808/20260809/20260810）及 T3 held-out（20260809/20260811）均不相交 */
const T5_HOLDOUT_SEED = 20260812;

/* T5-heldout：与 T5 相同的量化定义（max∈[0.30,0.60]、min≤0.08、maxd≥0.25）与全 α 扫描，
 * 但随机深色来自全新 seed 20260812——拟合语料之外的深色+白 泛化验证。 */
function buildT5HeldOut(I) {
  return I.buildT5Random(T5_HOLDOUT_SEED, I.T5_RANDOM_N)
    .map(s => ({ ...s, set: 'T5-heldout', cat: '深色+白·随机(held-out)' }));
}

function buildTail(I) {
  const out = [];
  for (const [cat, hb] of I.T5_DEF)
    for (const a of TAIL_ALPHAS)
      out.push({ set: 'tail', cat, base: I.HEX2RGB(hb), tint: [1, 1, 1], a });
  for (const h of BLIND_SPOTS)
    for (const a of I.ALPHAS_T5)
      out.push({ set: 'tail', cat: 'blind', base: I.HEX2RGB(h), tint: [1, 1, 1], a });
  return out;
}

function statsOf(de00, nBoot) {
  const s = de00.slice().sort((x, y) => x - y);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const p = q => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  const p95 = p(0.95);
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1));
  let ciMean = null, ciP95 = null;
  if (nBoot > 0 && n > 1) {
    const bm = new Float64Array(nBoot), bp = new Float64Array(nBoot);
    for (let b = 0; b < nBoot; b++) {
      const boot = new Float64Array(n);
      for (let i = 0; i < n; i++) boot[i] = s[(Math.random() * n) | 0];
      boot.sort();
      let sm = 0;
      for (let i = 0; i < n; i++) sm += boot[i];
      bm[b] = sm / n;
      bp[b] = boot[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
    }
    bm.sort(); bp.sort();
    const lo = b => b[Math.floor(0.025 * nBoot)], hi = b => b[Math.floor(0.975 * nBoot)];
    ciMean = [lo(bm), hi(bm)];
    ciP95 = [lo(bp), hi(bp)];
  }
  return { n, mean, max: s[n - 1], median: p(0.5), p95, sd, ciMean, ciP95 };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = v => { const i = args.indexOf(v); return i >= 0 ? args[i + 1] : null; };
  const outDir = opt('--out') || OUT_DIR;
  const nBoot = parseInt(opt('--nBoot') || '1000', 10);

  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;
  const refFn = sandbox.mixbox.lerpFloat;

  /* suite 的 evaluateSet 需要 ref 函数；从 buildReport 拿不到，直接由外部提供 */
  const { buildT1, buildT2, buildT3, buildT5 } = I;
  const models = suite.MODELS;

  const t1 = buildT1(), t2 = buildT2(), t5 = buildT5(), tail = buildTail(I);
  const t5Ho = buildT5HeldOut(I);
  const t3Fit = buildT3(FITTING_SEED, 800);
  const t3Ho = buildT3(FITTING_SEED, 2000).slice(800);
  const t3S1 = buildT3(20260809, 2000);
  const t3S2 = buildT3(20260811, 2000);

  const sets = [
    { key: 'T1', label: 'T1 调色板 (in-sample)', samples: t1 },
    { key: 'T2', label: 'T2 压力对 (in-sample)', samples: t2 },
    { key: 'T5', label: 'T5 深色+白 (in-sample)', samples: t5 },
    { key: 'tail', label: 'tail 尾端集 (in-sample, 近似枚举)', samples: tail },
    { key: 'T3-heldout-slice', label: 'T3 不相交切片 [800:2000) (held-out)', samples: t3Ho },
    { key: 'T3-seed-09', label: 'T3 独立 seed 20260809 (held-out)', samples: t3S1 },
    { key: 'T3-seed-11', label: 'T3 独立 seed 20260811 (held-out)', samples: t3S2 },
    { key: 'T5-heldout', label: 'T5-heldout 深色+白 独立 seed 20260812 (held-out)', samples: t5Ho },
    { key: 'T3-fit-800', label: 'T3 拟合 800 对 (in-sample)', samples: t3Fit },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    reference: 'mixbox 2.0 lerpFloat (sRGB display)',
    ciede2000Validation: suite.validateDeltaE2000(),
    overlapNote: 'T3 seed 20260808 n=2000 的前 800 对与拟合集逐对相同（已确认），held-out 切片自第 800 对起。',
    tailNote: 'tail 盲区色为近似枚举（论文未列完整清单；依据 §4.5/#3.5 提及的 #060538、#000333 与 T5 深蓝族）。',
    seedFixNote: 'held-out 第二独立抽取使用 seed 20260811（取代原 20260810）：20260810 已用于 T5 随机深色（拟合语料），与 T3 held-out 共用 mulberry32 流，不满足"独立 PRNG 流"声明。',
    t5HeldoutNote: 'T5-heldout 与 T5 同量化定义与 α 档位，随机深色来自全新 seed 20260812（未用于拟合），共 24 色 × 9 α。',
    sets: [],
  };

  for (const set of sets) {
    const row = { key: set.key, label: set.label, n: set.samples.length, models: {} };
    for (const model of models) {
      const e = suite.evaluateSet(model, set.samples, refFn);
      row.models[model.name] = statsOf(e.map(x => x.de00), nBoot);
    }
    report.sets.push(row);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'heldout-report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('report ->', file);
  console.log('');
  for (const set of report.sets) {
    console.log('== ' + set.label + '  (n=' + set.n + ')');
    for (const model of models) {
      const st = set.models[model.name];
      const ci = st.ciMean ? `  [${st.ciMean[0].toFixed(3)}, ${st.ciMean[1].toFixed(3)}]` : '';
      console.log(
        `   ${model.name.padEnd(18)} mean=${st.mean.toFixed(3)}${ci}  max=${st.max.toFixed(1)}  ` +
        `med=${st.median.toFixed(3)}  p95=${st.p95.toFixed(3)}  sd=${st.sd.toFixed(3)}`
      );
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
