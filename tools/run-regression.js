'use strict';
/* run-regression.js — 指标回归断言（改动算法后必须通过）
 *
 * 用当前 javascript/color-mixing.js 重算全部套件指标，与 tools/regression-baseline.json
 * 比较；任一指标超出容差即以退出码 1 失败。基线只允许用 --update 重新生成，
 * 且差异必须人工审阅后随代码一起提交（基线是"承诺"，不是"现状快照"）。
 *
 * 检查项：
 *   deltaE2000    Sharma/Wu/Dalal 34 组复刻（最大偏差 < 1e-3）
 *   指标表        T1 / T2 / T3(fit) / T3-heldout / T5 / T5E / T5-heldout / tail 的 mean / max
 *   identity      α∈{0,1} 精确返回输入（通道误差 0）
 *   symmetry      F(b,t,α) ≡ F(t,b,1−α)（max RGB 差 < 1e-12）
 *   continuity    邻域连续性（1/255 扰动 + α+0.004，n=500，max 单步 ΔE00）
 *
 * 用法：node run-regression.js [--update] [--verbose]
 *   需要 mixbox.js（经 mixbox-fetch 缓存或网络）。退出码：0 通过 / 1 失败。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const BASELINE_FILE = path.join(__dirname, 'regression-baseline.json');
const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');
const FIT_SEED = 20260808;
const HOLD_SEED = 20260812;
const CONT_N = 500, CONT_SEED = 20260701, CONT_ALPHA_STEP = 0.004;
const TAIL_ALPHAS = [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99];
const BLIND_SPOTS = ['#0D1B44', '#001B75', '#000080', '#001E80', '#080248', '#0A2A6E', '#2A0A5E', '#060538', '#000333'];

/* 容差：mean 反映拟合质量，max 反映尾端；两者都允许 libm 级抖动 */
const TOL = {
  mean: 0.002,
  max: 0.05,
  ciede: 1e-3,
  identity: 1e-12,
  symmetry: 1e-12,
  continuity: 0.05,
};

function buildTail(I) {
  const out = [];
  for (const [, hb] of I.T5_DEF)
    for (const a of TAIL_ALPHAS) out.push({ base: I.HEX2RGB(hb), tint: [1, 1, 1], a });
  for (const h of BLIND_SPOTS)
    for (const a of I.ALPHAS_T5) out.push({ base: I.HEX2RGB(h), tint: [1, 1, 1], a });
  return out;
}

function statsOf(fn, samples, ref, de) {
  let sum = 0, max = 0;
  for (const s of samples) {
    const d = de(fn(s.base, s.tint, s.a), ref(s.base, s.tint, s.a));
    sum += d;
    if (d > max) max = d;
  }
  return { n: samples.length, mean: +(sum / samples.length).toFixed(6), max: +max.toFixed(6) };
}

function measure() {
  return fetchMixbox().then(({ source }) => {
    const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
    const I = suite.__internals;
    const ref = sandbox.mixbox.lerpFloat;
    const de = (a, b) => suite.deltaE2000(I.rgbToLab(a), I.rgbToLab(b));
    const pbm = I.mixPbm;

    const t3fit = I.buildT3(FIT_SEED, 2000);
    const sets = {
      T1: I.buildT1(),
      T2: I.buildT2(),
      T3: t3fit,
      'T3-heldout': t3fit.slice(800),
      T5: I.buildT5(),
      T5E: I.buildT5E(),
      'T5-heldout': I.buildT5Random(HOLD_SEED, I.T5_RANDOM_N),
      tail: buildTail(I),
    };
    const metrics = {};
    for (const [k, v] of Object.entries(sets)) metrics[k] = statsOf(pbm, v, ref, de);

    const colors = [[1, 1, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0.5], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 0.5, 0]];
    let identity = 0;
    for (const c of colors) for (const a of [0, 1]) {
      const o = pbm(c, c, a);
      for (let k = 0; k < 3; k++) identity = Math.max(identity, Math.abs(o[k] - c[k]));
    }

    const rnd = I.mulberry32(FIT_SEED);
    let symmetry = 0;
    for (let i = 0; i < 5000; i++) {
      const b = [rnd(), rnd(), rnd()], t = [rnd(), rnd(), rnd()], a = rnd();
      const o1 = pbm(b, t, a), o2 = pbm(t, b, 1 - a);
      for (let k = 0; k < 3; k++) symmetry = Math.max(symmetry, Math.abs(o1[k] - o2[k]));
    }

    const crnd = I.mulberry32(CONT_SEED);
    const cl = c => Math.max(0, Math.min(1, c));
    let continuity = 0;
    for (let n = 0; n < CONT_N; n++) {
      const b = [crnd(), crnd(), crnd()], t = [crnd(), crnd(), crnd()], a = 0.05 + 0.9 * crnd();
      const o = pbm(b, t, a);
      for (const src of [b, t]) for (let c = 0; c < 3; c++) for (const k of [1, -1]) {
        const p = src.slice(); p[c] = cl(src[c] + k / 255);
        continuity = Math.max(continuity, de(pbm(src === b ? p : b, src === t ? p : t, a), o));
      }
      continuity = Math.max(continuity, de(pbm(b, t, Math.min(1, a + CONT_ALPHA_STEP)), o));
    }

    return {
      generatedAt: new Date().toISOString(),
      node: process.version,
      ciede: suite.validateDeltaE2000().maxAbsDev,
      metrics,
      identity: +identity.toExponential(3),
      symmetry: +symmetry.toExponential(3),
      continuity: +continuity.toFixed(4),
      tolerances: TOL,
    };
  });
}

function compare(cur, base) {
  const rows = [];
  const push = (name, got, want, tol) => {
    rows.push({ name, got, want, tol, pass: Math.abs(got - want) <= tol });
  };
  push('ciede2000 maxAbsDev', cur.ciede, base.ciede, TOL.ciede);
  for (const [set, m] of Object.entries(base.metrics)) {
    push(`${set}.mean`, cur.metrics[set].mean, m.mean, TOL.mean);
    push(`${set}.max`, cur.metrics[set].max, m.max, TOL.max);
  }
  push('identity maxChannelErr', cur.identity, base.identity, TOL.identity);
  push('symmetry maxRgbDiff', cur.symmetry, base.symmetry, TOL.symmetry);
  push('continuity maxStep', cur.continuity, base.continuity, TOL.continuity);
  return rows;
}

async function main() {
  const update = process.argv.includes('--update');
  const verbose = process.argv.includes('--verbose');
  const cur = await measure();

  const outDir = OUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'regression-latest.json'), JSON.stringify(cur, null, 2));

  if (update) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(cur, null, 2) + '\n');
    console.log('baseline written ->', BASELINE_FILE);
    for (const [k, v] of Object.entries(cur.metrics))
      console.log(`  ${k.padEnd(12)} mean=${v.mean.toFixed(3)} max=${v.max.toFixed(2)} (n=${v.n})`);
    console.log(`  identity=${cur.identity} symmetry=${cur.symmetry} continuity=${cur.continuity}`);
    return 0;
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error('缺少基线文件：' + BASELINE_FILE + '（先运行 --update 生成）');
    return 1;
  }
  const base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const rows = compare(cur, base);
  let failed = 0;
  for (const r of rows) {
    if (!r.pass) failed++;
    if (!r.pass || verbose)
      console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name.padEnd(24)} got=${r.got} baseline=${r.want} tol=${r.tol}`);
  }
  fs.writeFileSync(path.join(outDir, 'regression-report.json'),
    JSON.stringify({ ...cur, baseline: base, rows, failed }, null, 2));
  if (failed) {
    console.log(`\n回归失败：${failed}/${rows.length} 项超差（详见 regression-report.json）`);
    return 1;
  }
  console.log(`回归通过：${rows.length} 项全部在容差内`);
  return 0;
}

main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
