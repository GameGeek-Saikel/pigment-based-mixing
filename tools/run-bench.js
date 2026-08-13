'use strict';
/* run-bench.js — 运行时基准（论文 §5.7 用数据）
 *
 * 对同一组确定性输入（T3 seed 20260808 前 n 对），分别计时：
 *   PBM mixPbm / Mixbox 2.0 lerpFloat（LUT 查找路径）/ RGB interpolation（参考下限）
 *   K–M spectral direct（已知颜料光谱的两常数 K–M 全管线混合）
 *   K–M spectral RGB-in（RGB → unmix 4 基色浓度 + 光谱混合，物理 K–M 的
 *     RGB-in/RGB-out 等价接口成本）
 * 预热 + 多轮计时，报告 ns/op 与相对倍数。
 *
 * 用法：node run-bench.js [--n <pairs>] [--out <dir>] [--km-n <pairs>]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');
const pipeline = require('./spectral/pipeline');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');

function bench(fn, samples, reps) {
  const m = samples.length;
  for (let i = 0; i < 20000; i++) {
    const s = samples[i % m];
    fn(s.base, s.tint, s.a);
  }
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < reps; r++)
    for (let i = 0; i < m; i++) {
      const s = samples[i];
      fn(s.base, s.tint, s.a);
    }
  return Number(process.hrtime.bigint() - t0);
}

/* 物理 K–M 基准输入是 20000 对中的前 m 对（unmix 迭代成本高，用小样本） */
function benchKm(fn, samples, reps, warm) {
  const m = samples.length;
  for (let i = 0; i < (warm || 400); i++) {
    const s = samples[i % m];
    fn(s.base, s.tint, s.a);
  }
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < reps; r++)
    for (let i = 0; i < m; i++) {
      const s = samples[i];
      fn(s.base, s.tint, s.a);
    }
  return Number(process.hrtime.bigint() - t0);
}

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

let KM_KS_A = null, KM_KS_B = null;

async function main() {
  const args = process.argv.slice(2);
  const opt = v => { const i = args.indexOf(v); return i >= 0 ? args[i + 1] : null; };
  const outDir = opt('--out') || OUT_DIR;
  const nPairs = parseInt(opt('--n') || '100000', 10);
  const reps = parseInt(opt('--reps') || '5', 10);
  const kmNPairs = parseInt(opt('--km-n') || '2000', 10);

  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;
  const refFn = sandbox.mixbox.lerpFloat;
  const samples = I.buildT3(20260808, nPairs);
  const kmSamples = samples.slice(0, kmNPairs);
  const pd = require('./spectral/pigments');
  KM_KS_A = pd.ksOf('blue_1');
  KM_KS_B = pd.ksOf('yellow_1');

  const out = {
    generatedAt: new Date().toISOString(),
    reference: 'mixbox 2.0 lerpFloat (sRGB display float path)',
    nPairs, reps,
    kmNPairs,
    models: {},
  };
  const benches = [
    ['PBM', I.mixPbm, samples],
    ['Mixbox 2.0 (LUT)', refFn, samples],
    ['RGB interpolation', I.mixLerp, samples],
    ['K-M spectral (direct)', kmDirect, kmSamples],
    ['K-M spectral RGB-in', kmRgbIn, kmSamples],
  ];
  for (const [key, fn, smp] of benches) {
    const useKm = key.startsWith('K-M');
    const totalNs = useKm ? benchKm(fn, smp, reps) : bench(fn, smp, reps);
    const calls = smp.length * reps;
    const nsPerCall = totalNs / calls;
    out.models[key] = {
      nsPerCall: +nsPerCall.toFixed(1),
      callsPerSec: Math.round(1e9 / nsPerCall),
      totalMs: +(totalNs / 1e6).toFixed(1),
    };
  }
  const pbm = out.models['PBM'], mix = out.models['Mixbox 2.0 (LUT)'], lerp = out.models['RGB interpolation'];
  const kmD = out.models['K-M spectral (direct)'], kmR = out.models['K-M spectral RGB-in'];
  out.speedup = {
    pbmVsMixbox: +(mix.nsPerCall / pbm.nsPerCall).toFixed(2),
    pbmVsLerp: +(lerp.nsPerCall / pbm.nsPerCall).toFixed(2),
    pbmVsKmDirect: +(kmD.nsPerCall / pbm.nsPerCall).toFixed(2),
    pbmVsKmRgbIn: +(kmR.nsPerCall / pbm.nsPerCall).toFixed(2),
  };

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'bench-report.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('report ->', file);
  for (const [k, v] of Object.entries(out.models))
    console.log(`${k.padEnd(24)} ${v.nsPerCall.toFixed(1)} ns/op  (${v.callsPerSec.toLocaleString()} ops/s)`);
  console.log(`PBM/Mixbox=${out.speedup.pbmVsMixbox}x  PBM/lerp=${out.speedup.pbmVsLerp}x  ` +
    `PBM/KM-direct=${out.speedup.pbmVsKmDirect}x  PBM/KM-RGB-in=${out.speedup.pbmVsKmRgbIn}x`);
}

main().catch(e => { console.error(e); process.exit(1); });
