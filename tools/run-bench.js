'use strict';
/* run-bench.js — 运行时基准（论文 §5.6 用数据）
 *
 * 关键：被测算法与参考必须在本进程的主 realm 中加载（require / new Function）。
 * node:vm 上下文中的 Math.* 调用比主 realm 慢 50--100 倍（实测 sqrt 1.8→62 ns、
 * pow 0.7→69 ns），而在 vm 中计时时 RGB 插值（纯算术）几乎不受影响，于是
 * "PBM / RGB lerp" 比值被放大约 10 倍、"PBM / Mixbox" 比值基本正确（两者同样被放大）。
 * --vm-control 复现该假象用于审计，不进入报告。
 *
 * 计时对象：
 *   PBM                 宿主 realm require(javascript/color-mixing.js)
 *   Mixbox 2.0 (LUT)    宿主 realm new Function(官方 mixbox.js, UMD)
 *   RGB 插值             下限对照
 *   K-M spectral direct  已知颜料光谱的两常数 K--M 全管线
 *   K-M spectral RGB-in  RGB → unmix 4 基色浓度 + 光谱混合（物理 K--M 的 RGB-in 等价接口）
 * 数据集来自评估套件（vm 构造），一次性转为主 realm 数组后计时。
 *
 * 用法：node run-bench.js [--n <pairs>] [--out <dir>] [--km-n <pairs>] [--vm-control]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite, CM_LIB } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');
const pipeline = require('./spectral/pipeline');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');

/* 主 realm 加载：PBM 库与 Mixbox UMD 都不经 vm */
function loadHostLib() {
  const p = require.resolve(CM_LIB);
  delete require.cache[p];
  return require(p);
}
function loadHostUmd(srcText) {
  const m = { exports: {} };
  new Function('module', 'exports', srcText).call(globalThis, m, m.exports);
  return m.exports;
}
/* vm 数组 → 主 realm 数组（跨 realm 的属性访问有额外成本，计时前归一） */
function toHost(samples) {
  return samples.map(s => ({
    base: [s.base[0], s.base[1], s.base[2]],
    tint: [s.tint[0], s.tint[1], s.tint[2]],
    a: s.a,
  }));
}

function bench(fn, samples, reps, warm) {
  const m = samples.length;
  const w = warm || 20000;
  for (let i = 0; i < w; i++) {
    const s = samples[i % m];
    fn(s.base, s.tint, s.a);
  }
  let best = Infinity;
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < m; i++) {
      const s = samples[i];
      fn(s.base, s.tint, s.a);
    }
    const ns = Number(process.hrtime.bigint() - t0) / m;
    if (ns < best) best = ns;
  }
  return best;
}

function lerpRgb(b, t, a) {
  return [b[0] + (t[0] - b[0]) * a, b[1] + (t[1] - b[1]) * a, b[2] + (t[2] - b[2]) * a];
}

let KM_KS_A = null, KM_KS_B = null;

function kmDirect(b, t, a) {
  return pipeline.spectralMix(KM_KS_A, KM_KS_B, a).rgb;
}
function kmRgbIn(b, t, a) {
  const ca = pipeline.unmixRgb(b);
  const cb = pipeline.unmixRgb(t);
  const n = ca.conc.length;
  const conc = new Array(n);
  for (let i = 0; i < n; i++) conc[i] = (1 - a) * ca.conc[i] + a * cb.conc[i];
  return pipeline.spectralMixConcs(conc, { primaries: pipeline.UNMIX_PRIMARIES }).rgb;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = v => { const i = args.indexOf(v); return i >= 0 ? args[i + 1] : null; };
  const outDir = opt('--out') || OUT_DIR;
  const nPairs = parseInt(opt('--n') || '100000', 10);
  const reps = parseInt(opt('--reps') || '9', 10);
  const kmNPairs = parseInt(opt('--km-n') || '2000', 10);
  const vmControl = args.includes('--vm-control');

  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;

  const CM = loadHostLib();
  const MB = loadHostUmd(source);

  const samples = toHost(I.buildT3(20260808, nPairs));
  const kmSamples = samples.slice(0, kmNPairs);
  const pd = require('./spectral/pigments');
  KM_KS_A = pd.ksOf('blue_1');
  KM_KS_B = pd.ksOf('yellow_1');

  const out = {
    generatedAt: new Date().toISOString(),
    reference: 'mixbox 2.0 lerpFloat (sRGB display float path)',
    realm: 'host (main V8 context) — vm contexts inflate Math.* by 50-100x',
    nPairs, reps, kmNPairs,
    statistic: 'per-call ns, best of reps after warm-up',
    models: {},
  };

  const benches = [
    ['PBM', CM.mixPbm, samples, 20000],
    ['Mixbox 2.0 (LUT)', MB.lerpFloat, samples, 20000],
    ['RGB interpolation', lerpRgb, samples, 20000],
    ['K-M spectral (direct)', kmDirect, kmSamples, 400],
    ['K-M spectral RGB-in', kmRgbIn, kmSamples, 20],
  ];
  for (const [key, fn, smp, warm] of benches) {
    const nsPerCall = bench(fn, smp, reps, warm);
    out.models[key] = {
      nsPerCall: +nsPerCall.toFixed(1),
      callsPerSec: Math.round(1e9 / nsPerCall),
    };
  }

  const pbmNs = out.models['PBM'].nsPerCall;
  for (const v of Object.values(out.models)) {
    v.relativeToPbm = +(v.nsPerCall / pbmNs).toFixed(3);
    v.speedupVsPbm = +(pbmNs / v.nsPerCall).toFixed(2);
  }

  /* 审计：旧路径（vm 内计时）复现测量假象 */
  if (vmControl) {
    const vmNs = {
      PBM: bench(I.mixPbm, samples, reps, 20000),
      'Mixbox 2.0 (LUT)': bench(sandbox.mixbox.lerpFloat, samples, reps, 20000),
      'RGB interpolation': bench(I.mixLerp, samples, reps, 20000),
    };
    const vmPbm = vmNs.PBM;
    out.vmControl = {
      note: '同一批样本在 suite-loader 的 vm 上下文中计时；仅用于说明测量假象',
      models: Object.fromEntries(Object.entries(vmNs).map(([k, v]) => [k, +v.toFixed(1)])),
      inflation: Object.fromEntries(Object.entries(vmNs).map(([k, v]) => [k, +(v / out.models[k].nsPerCall).toFixed(2)])),
      pbmVsLerp: +(vmNs['RGB interpolation'] > 0 ? vmPbm / vmNs['RGB interpolation'] : 0).toFixed(2),
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'bench-report.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('report ->', file);
  for (const [k, v] of Object.entries(out.models))
    console.log(`${k.padEnd(22)} ${v.nsPerCall.toFixed(1).padStart(8)} ns/op  (${v.callsPerSec.toLocaleString()} ops/s)  x${v.relativeToPbm} vs PBM`);
  console.log(`ratio: PBM/Mixbox=${out.models['Mixbox 2.0 (LUT)'].relativeToPbm}x  ` +
    `PBM/lerp=${out.models['RGB interpolation'].relativeToPbm}x  ` +
    `PBM/KM-direct=${out.models['K-M spectral (direct)'].relativeToPbm}x  ` +
    `PBM/KM-RGB-in=${out.models['K-M spectral RGB-in'].relativeToPbm}x`);
  if (out.vmControl) {
    console.log('vm control (old path): ' + JSON.stringify(out.vmControl.models) +
      '  inflation=' + JSON.stringify(out.vmControl.inflation));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
