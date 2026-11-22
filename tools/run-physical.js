'use strict';
/* run-physical.js — 合成光谱真值对照评测（论文 §5.8 用数据）
 *
 * 光谱真值：合成颜料两常数 K/S（第一性原理吸收带模型，数值参数标定自公开测量数据
 *   离线标定，10 nm / 400–700 nm，见 spectral/pigments.js）经标准
 *   K–M 前向管线（Duncan K/S 分别叠加 → R∞ → D65 × CIE 1931 2° 积分
 *   → sRGB，无 Saunderson）逐样本计算的混合色。
 * 输入色：同一光谱管线渲染的纯颜料 sRGB（"管口色"）。
 * 被评模型：PBM / Mixbox 2.0 / RGB 插值 / 显示值 K–M(kmDual)，
 *   全部与同一光谱真值对比（交叉验证）。
 *
 * 数据政策：全部颜料光谱由两常数 K–M 模型**确定性合成**（第一性原理
 * 带结构，无任何第三方测量数据随仓库分发；见 spectral/pigments.js）。
 *
 * 套件：P1 颜料全对 × α∈{0.25,0.5,0.75}；P2 互补/压力颜料对；
 *   P3 随机颜料对 × 随机 α（seed 20260813，本实验专用，与论文其余
 *   seed 不相交）；P5 深色+钛白；P5-buff 深色+Titan Buff（合成近白）；
 *   P5E 双尾端。
 *
 * 用法：node run-physical.js [--out <dir>] [--nBoot <n>]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');
const PD = require('./spectral/pigments');
const S = require('./spectral/pipeline');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');

//* P1/P3 颜料调色板（24 色相 + 灰阶，覆盖色相环） */
const PALETTE = ['white', 'black', 'buff', 'gray_light', 'gray_mid', 'gray_dark', 'gray_blue',
  'yellow_1', 'yellow_2', 'orange_1', 'orange_2', 'red_1', 'red_2', 'magenta_1', 'magenta_2',
  'purple_1', 'blue_1', 'blue_2', 'blue_3', 'cyan_1', 'green_1', 'green_2', 'earth_1', 'earth_2'];

/* P5 深色组（补丁深色派生：A3/C3/B3/E3/D2 加深） */
const DEEP = ['deep_blue', 'deep_red', 'deep_green', 'deep_magenta', 'deep_purple',
  'blue_1', 'blue_2', 'blue_3', 'red_1', 'red_2', 'green_1', 'green_2', 'purple_1', 'magenta_1', 'magenta_2'];

/* P2 互补/压力颜料对（补丁对应色相环） */
const STRESS_PAIRS = [
  ['yellow_1', 'blue_2'], ['magenta_1', 'green_1'], ['orange_1', 'blue_2'],
  ['red_1', 'green_1'], ['purple_1', 'yellow_1'], ['orange_2', 'blue_1'],
  ['red_2', 'green_2'], ['yellow_2', 'blue_3'], ['cyan_1', 'red_1']
];

const P1_ALPHAS = [0.25, 0.5, 0.75];
const P5_ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const P5E_ALPHAS = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.92, 0.95, 0.98, 0.99];
const P3_SEED = 20260813;
const P3_N = 2000;

/* mulberry32（与套件同族 PRNG） */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function statsOf(de00, nBoot) {
  const s = de00.slice().sort((x, y) => x - y);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const p = q => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  const p95 = p(0.95);
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1));
  let ciMean = null;
  if (nBoot > 0 && n > 1) {
    const rnd = mulberry32(20260813);   /* 固定 bootstrap 流，保证 CI 可复现 */
    const bm = new Float64Array(nBoot);
    for (let b = 0; b < nBoot; b++) {
      const boot = new Float64Array(n);
      let sm = 0;
      for (let i = 0; i < n; i++) { const v = s[(rnd() * n) | 0]; boot[i] = v; sm += v; }
      bm[b] = sm / n;
    }
    bm.sort();
    ciMean = [bm[Math.floor(0.025 * nBoot)], bm[Math.floor(0.975 * nBoot)]];
  }
  return { n, mean, max: s[n - 1], median: p(0.5), p95, sd, ciMean };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = v => { const i = args.indexOf(v); return i >= 0 ? args[i + 1] : null; };
  const outDir = opt('--out') || OUT_DIR;
  const nBoot = parseInt(opt('--nBoot') || '1000', 10);

  let mixboxRef = null, suite, sandbox;
  try {
    const { source } = await fetchMixbox();
    const ctx = loadSuite({ mixboxSource: source, exportInternals: false });
    suite = ctx.suite; sandbox = ctx.sandbox;
    mixboxRef = sandbox.mixbox ? sandbox.mixbox.lerpFloat : null;
  } catch (e) {
    console.warn('mixbox 未加载（无网络？），三角验证缺 Mixbox 列:', e.message);
    const ctx = loadSuite({ exportInternals: false });
    suite = ctx.suite; sandbox = ctx.sandbox;
  }
  const models = [
    { key: 'PBM', name: 'PBM (ours)', fn: suite.MODELS[0].fn },
    { key: 'RGB', name: 'RGB interpolation', fn: suite.MODELS[1].fn },
    { key: 'KM', name: 'Kubelka–Munk (display-value)', fn: suite.MODELS[2].fn },
      { key: 'Mixbox', name: 'Mixbox 2.0 (ref)', fn: mixboxRef }
  ].filter(m => m.fn);

  /* 颜料色（物理管线渲染的纯颜料 sRGB）+ K/S */
  const paint = {};
  for (const id of PD.PIGMENTS.map(p => p.id)) {
    const ks = PD.ksOf(id);
    if (!ks) continue;
    const mix = S.spectralMix(ks, ks, 0);
    paint[id] = { id, ks, rgb: mix.rgb, clipped: mix.clipped, name: PD.pigment(id).name };
  }
  const palette = PALETTE.filter(id => paint[id]);
  const deep = DEEP.filter(id => paint[id]);

  /* 光谱真值：两颜料光谱混合 → sRGB */
  function truth(aId, bId, a) {
    const m = S.spectralMix(paint[aId].ks, paint[bId].ks, a);
    return { rgb: m.rgb, clipped: m.clipped };
  }

  /* ---- 套件构造 ---- */
  const sets = [];
  {
    const samples = [];
    for (let i = 0; i < palette.length; i++)
      for (let j = i + 1; j < palette.length; j++)
        for (const a of P1_ALPHAS) samples.push({ aId: palette[i], bId: palette[j], a });
    sets.push({ key: 'P1', label: 'P1 颜料全对 (n=' + samples.length + ')', samples });
  }
  {
    const samples = [];
    for (const [x, y] of STRESS_PAIRS)
      for (const a of P1_ALPHAS) samples.push({ aId: x, bId: y, a });
    sets.push({ key: 'P2', label: 'P2 互补/压力对 (n=' + samples.length + ')', samples });
  }
  {
    const samples = [];
    const rnd = mulberry32(P3_SEED);
    for (let k = 0; k < P3_N; k++) {
      const i = (rnd() * palette.length) | 0;
      const j = (rnd() * palette.length) | 0;
      samples.push({ aId: palette[i], bId: palette[j], a: rnd() });
    }
    sets.push({ key: 'P3', label: 'P3 随机颜料对 (n=' + samples.length + ')', samples });
  }
  for (const [key, label, white] of [
    ['P5', 'P5 深色+白 (n=', 'white'],
    ['P5-buff', 'P5-buff 深色+Buff (n=', 'buff']
  ]) {
    const samples = [];
    for (const d of deep) for (const a of P5_ALPHAS) samples.push({ aId: d, bId: white, a });
    sets.push({ key, label: label + samples.length + ')', samples });
  }
  {
    const samples = [];
    for (const d of deep) for (const a of P5E_ALPHAS) samples.push({ aId: d, bId: 'white', a });
    sets.push({ key: 'P5E', label: 'P5E 双尾端 (n=' + samples.length + ')', samples });
  }

  /* ---- 评测 ---- */
  const report = {
    generatedAt: new Date().toISOString(),
    dataset: 'Synthetic pigment spectra (first-principles two-constant K/S: absorption bands + logistic edges)',
    datasetNote: '全部颜料光谱由两常数 K–M 模型合成：带位置按第一性原理颜料化学给定，数值参数标定自公开可得的 BabelColor ColorChecker Avg30 光谱（[Pascale 2012]，calibrate.js 可复现）。CLIPPED = 线性 RGB 超出 sRGB 色域（饱和颜料真实物理现象），clamp 后作为模型输入。',
    ciede2000Validation: suite.validateDeltaE2000(),
    pipelineSelfCheck: 'synthetic self-check: R∈(0,1) 全部通过；unmix 纯颜料重建 ΔE00=0；端点恒等 0（见 verify-synthetic.js）',
    validation: S.validatePipeline().map(r => ({
      id: r.id, name: r.name, rgb: r.rgb.map(v => +v.toFixed(3)),
      clipped: r.clipped, Rmin: +r.Rmin.toFixed(4), Rmax: +r.Rmax.toFixed(4)
    })),
    sets: [],
    figureData: null
  };

  for (const set of sets) {
    const row = { key: set.key, label: set.label, n: set.samples.length, outOfGamut: 0, models: {}, hue: null, worst: [] };
    const all = set.samples.map(s => {
      const t = truth(s.aId, s.bId, s.a);
      if (t.clipped) row.outOfGamut++;
      return {
        ...s,
        aName: paint[s.aId].name, bName: paint[s.bId].name,
        aRgb: paint[s.aId].rgb, bRgb: paint[s.bId].rgb,
        truth: t.rgb
      };
    });
    for (const m of models) {
      const de = [];
      for (const s of all) {
        try { de.push(S.deltaE2000(m.fn(s.aRgb, s.bRgb, s.a), s.truth)); }
        catch (e) { de.push(NaN); }
      }
      row.models[m.key] = { name: m.name, stats: statsOf(de.filter(Number.isFinite), nBoot) };
    }

    /* 色相一致性与色度比（定性验证：ΔE 受测量偏移主导时，色相轨迹一致性
     * 直接检验"黄×蓝→绿""深+白保持色相"等物理行为是否被模型复现） */
    const hueErr = { PBM: [], Mixbox: [] };
    const chromaRatio = { PBM: [], Mixbox: [] };
    for (const s of all) {
      const tLab = S.srgbToLab(s.truth);
      const tChroma = Math.hypot(tLab[1], tLab[2]);
      for (const mk of ['PBM', 'Mixbox']) {
        const m = row.models[mk];
        if (!m) continue;
        const out = models.find(x => x.key === mk).fn(s.aRgb, s.bRgb, s.a);
        const oLab = S.srgbToLab(out);
        const oChroma = Math.hypot(oLab[1], oLab[2]);
        if (tChroma > 10) {
          const th = Math.atan2(tLab[2], tLab[1]) * 180 / Math.PI;
          const oh = Math.atan2(oLab[2], oLab[1]) * 180 / Math.PI;
          let dh = oh - th;
          if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
          hueErr[mk].push(Math.abs(dh));
        }
        if (tChroma > 5) chromaRatio[mk].push(oChroma / Math.max(1e-6, tChroma));
      }
    }
    const stat = a => {
      if (!a.length) return null;
      a.sort((x, y) => x - y);
      const mean = a.reduce((x, y) => x + y, 0) / a.length;
      return { n: a.length, mean: +mean.toFixed(2), med: +a[(a.length / 2) | 0].toFixed(2), p95: +a[Math.min(a.length - 1, Math.ceil(0.95 * a.length) - 1)].toFixed(2) };
    };
    row.hue = {
      hueErr: { PBM: stat(hueErr.PBM), Mixbox: stat(hueErr.Mixbox) },
      chromaRatio: { PBM: stat(chromaRatio.PBM), Mixbox: stat(chromaRatio.Mixbox) }
    };
    report.sets.push(row);
  }

  /* 最差对（PBM vs 光谱真值，前 5） */
  const pbmFn = suite.MODELS[0].fn;
  for (let si = 0; si < sets.length; si++) {
    const set = sets[si];
    const rows = set.samples.map(s => {
      const t = truth(s.aId, s.bId, s.a);
      const pbm = pbmFn(paint[s.aId].rgb, paint[s.bId].rgb, s.a);
      return {
        ...s,
        aName: paint[s.aId].name, bName: paint[s.bId].name,
        truth: t.rgb, pbm,
        de00: S.deltaE2000(pbm, t.rgb)
      };
    });
    rows.sort((x, y) => y.de00 - x.de00);
    report.sets[si].worst = rows.slice(0, 5).map(r => ({
      aId: r.aId, bId: r.bId, a: +r.a.toFixed(3), de00: +r.de00.toFixed(2),
      aName: r.aName, bName: r.bName,
      truth: r.truth.map(v => +v.toFixed(3)), pbm: r.pbm.map(v => +v.toFixed(3))
    }));
  }

  /* 图数据：3 个代表性色对 × α 网格（光谱真值 / PBM / Mixbox / RGB） */
  const FIG_PAIRS = [['blue_1', 'white'], ['yellow_1', 'blue_2'], ['magenta_1', 'green_1']];
  const FIG_ALPHAS = [];
  for (let k = 0; k <= 20; k++) FIG_ALPHAS.push(k / 20);
  report.figureData = FIG_PAIRS.map(([x, y]) => ({
    aId: x, bId: y, aName: paint[x].name, bName: paint[y].name,
    aRgb: paint[x].rgb, bRgb: paint[y].rgb,
    rows: FIG_ALPHAS.map(a => {
      const t = truth(x, y, a);
      const r = { a: +a.toFixed(2), truth: t.rgb.map(v => +v.toFixed(3)) };
      for (const m of models) {
        try { r[m.key] = m.fn(paint[x].rgb, paint[y].rgb, a).map(v => +v.toFixed(3)); }
        catch (e) { r[m.key] = null; }
      }
      return r;
    })
  }));

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'physical-report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('report ->', file);
  console.log('');
  console.log('== 管线自洽（合成颜料，R∈(0,1) 且非负；CLIPPED = 超 sRGB 色域，如实标注） ==');
  for (const r of report.validation)
    console.log(`   ${r.id.padEnd(14)} ${String(r.name).padEnd(20)} rgb=[${r.rgb.map(v => v.toFixed(2)).join(', ')}]  ${r.clipped ? 'CLIPPED' : ''}`);
  console.log('');
  for (const set of report.sets) {
    console.log('== ' + set.label + '  (out-of-gamut: ' + set.outOfGamut + ')');
    for (const m of models) {
      const st = set.models[m.key].stats;
      const ci = st.ciMean ? `  [${st.ciMean[0].toFixed(3)}, ${st.ciMean[1].toFixed(3)}]` : '';
      console.log(
        `   ${m.name.padEnd(34)} mean=${st.mean.toFixed(3)}${ci}  max=${st.max.toFixed(1)}  ` +
        `med=${st.median.toFixed(3)}  p95=${st.p95.toFixed(3)}  sd=${st.sd.toFixed(3)}`
      );
    }
    if (set.hue && set.hue.hueErr.PBM) {
      const he = set.hue.hueErr, cr = set.hue.chromaRatio;
      console.log('   [色相 |Δhue|°  PBM mean/med/p95=' +
        `${he.PBM.mean}/${he.PBM.med}/${he.PBM.p95}` +
        (he.Mixbox ? `  Mixbox=${he.Mixbox.mean}/${he.Mixbox.med}/${he.Mixbox.p95}` : '') +
        (cr.PBM ? ` | 色度比 PBM=${cr.PBM.mean} Mixbox=${cr.Mixbox ? cr.Mixbox.mean : '-'}]` : ''));
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
