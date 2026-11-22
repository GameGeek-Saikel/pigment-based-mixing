'use strict';
/* fit-gamma.js — γ 谐波修正的线性拟合与评估（论文 §3.4 / 附录 B 的可复现工具）
 *
 * 目标：给定特征基，用最小二乘重拟合谐波系数（old 基 27 个、trigfree 基 51 个），并报告全套件指标。
 * 设计矩阵按实现的分支结构逐样本组装：
 *   d_sample = Σ_branch λ_branch · g_branch · γ̂(V_branch) · gm_branch
 *   target   = ref − C_core − Σ_branch λ_branch · g_branch · (T_branch − C_core)
 * 因此对系数是线性的（角色带内两分支合并进同一设计行）。
 *
 * 两种特征基：
 *   old       v1.0 的 19 特征模板（含 sin/cos 色相特征，R/G/B 子集 10/5/9），仅供回归对照
 *   trigfree  17 特征无三角基（前向选择结果，三通道共用）
 *
 * 用法：
 *   node fit-gamma.js [--basis old|trigfree] [--pnorm <p>] [--rounds <n>] [--out <dir>] [--emit]
 *   --pnorm  p 范数目标（p=2 即 OLS；p=4..8 逼近 min-max，压最坏对），默认 2
 *   --emit   打印可直接替换 javascript/color-mixing.js 中 γ 块的源码
 *
 * 输出：<out>/gamma-fit.json（系数、子集、指标表）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');
const H2 = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const ANCHORS = [['#FFC400', '#000F3D'], ['#FFC400', '#000724'], ['#A30000', '#00B359'], ['#A30000', '#00D5C0'],
  ['#E33BA8', '#00B359'], ['#FF7A1A', '#2E5EFF'], ['#FF7A1A', '#001B75'], ['#A30000', '#001B75'],
  ['#E8321F', '#00D5C0'], ['#FFD61A', '#2E5EFF'], ['#E8321F', '#00B359'], ['#2E5EFF', '#FF7A1A']];
const ALPHA_STEPS = 19;
const RANDOM_PAIRS = 6000;
const CORPUS_SEED = 999;

/* 无三角 17 特征（前向选择结果） */
const TRIGFREE = ['one', 'lum', 'dgug', 'dcmucm', 'wUcP', 'u2', 'M', 'dg', 'op', 'span', 'drur', 'mn', 'Mmn', 'lumU', 'ur', 'dcAbs', 'gRu'];
/* v1.0 模板的子集（附录 B） */
const OLD_SUBSETS = {
  0: ['one', 'gBp', 'un', 's2hp', 'pm', 'logu', 's1hu', 's3hp', 's1hu_pm', 'gRp', 'pc'],
  1: ['one', 'un', 'gRp', 'c2hp', 'um', 's2hu'],
  2: ['one', 'un', 'pn', 'c3hp', 'um', 'pm', 'c2hu', 'wUcP', 'dcAbs', 'gRu'],
};

function mkConstants(suite) {
  const I = suite.__internals;
  return {
    I,
    CK: x => { const t = x * 11.01639450; return t < 0 ? 0 : t > 1 ? 1 : t; },
    C8: x => { const t = x * 8; return t < 0 ? 0 : t > 1 ? 1 : t; },
    SST: (x, lo, hi) => { const t = (x - lo) / (hi - lo); const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * (3 - 2 * u); },
    C01: x => x < 0 ? 0 : x > 1 ? 1 : x,
  };
}

function hueOf(v0, v1, v2) {
  const mx = v0 > v1 ? (v0 > v2 ? v0 : v2) : (v1 > v2 ? v1 : v2);
  const mn = v0 < v1 ? (v0 < v2 ? v0 : v2) : (v1 < v2 ? v1 : v2);
  if (mx - mn < 1e-9) return 0;
  let h;
  if (mx === v0) h = 60 * ((v1 - v2) / (mx - mn));
  else if (mx === v1) h = 60 * (2 + (v2 - v0) / (mx - mn));
  else h = 60 * (4 + (v0 - v1) / (mx - mn));
  return h < 0 ? h + 360 : h;
}

function makeState(K) {
  return function branchState(p, u, a, core) {
    const r = p[0], g = p[1], b = p[2], u0 = u[0], u1 = u[1], u2 = u[2];
    const M = Math.max(r, g, b), mn = Math.min(r, g, b);
    const wu = Math.min(u0, u1, u2), um = Math.max(u0, u1, u2), w = Math.max(mn, wu);
    const gate = K.CK(w - 0.37375181) * K.CK(M) * K.CK((M - mn) - 0.06479933);
    const hA = K.C01(14 * (0.845 - a));
    const cSat = K.SST(M - mn, 0.02, 0.15) * K.SST(um - wu, 0.08, 0.30);
    const gm = 4 * a * (1 - a) * cSat * (1 - gate) * hA;
    return {
      r, g, b, u0, u1, u2, M, mn, wu, um, gate, gm,
      T: core.pbmPwTarget(p, u, a),
      gBp: 0.5 * K.C8(b - r) + 0.5 * K.C8(b - g),
      gRp: 0.5 * K.C8(r - g) + 0.5 * K.C8(r - b),
      gRu: 0.5 * K.C8(u0 - u1) + 0.5 * K.C8(u0 - u2),
    };
  };
}

function featsOld(S, K) {
  const hp = hueOf(S.r, S.g, S.b), hu = hueOf(S.u0, S.u1, S.u2), D = Math.PI / 180;
  const shp = Math.sin(D * hp), chp = Math.cos(D * hp), shu = Math.sin(D * hu), chu = Math.cos(D * hu);
  return {
    one: 1, un: S.wu, um: S.um, pm: S.M, pn: S.mn, wUcP: (S.u0 - S.u2) * (S.b - S.r),
    gBp: S.gBp, gRp: S.gRp, gRu: S.gRu,
    s1hu: shu, s2hp: 2 * shp * chp, c2hp: 2 * chp * chp - 1,
    s3hp: shp * (3 - 4 * shp * shp), c3hp: chp * (4 * chp * chp - 3),
    s2hu: 2 * shu * chu, c2hu: 2 * chu * chu - 1,
    logu: Math.log(S.u0 + 0.01), s1hu_pm: shu * K.C01((S.M - 0.30) * 12.584),
    pc: S.r, dcAbs: Math.abs(S.u0 - S.r),
  };
}

function featsTrigFree(S) {
  const pc = Math.max(S.M - S.mn, 1e-6), uc = Math.max(S.um - S.wu, 1e-6);
  const dr = (S.r - S.b) / pc, dg = (S.g - S.b) / pc, dcm = (S.r - S.g) / pc;
  const ur = (S.u0 - S.u2) / uc, ug = (S.u1 - S.u2) / uc, ucm = (S.u0 - S.u1) / uc;
  return {
    one: 1, wu: S.wu, um: S.um, M: S.M, mn: S.mn, Mmn: S.M * S.mn, r: S.r, g: S.g, b: S.b,
    u0: S.u0, u1: S.u1, u2: S.u2, dr, dg, dcm, ur, ug, ucm,
    drur: dr * ur, dgug: dg * ug, dcmucm: dcm * ucm,
    gBp: S.gBp, gRp: S.gRp, gRu: S.gRu,
    wUcP: (S.u0 - S.u2) * (S.b - S.r), dcAbs: Math.abs(S.u0 - S.r),
    lum: 0.2126 * S.r + 0.7152 * S.g + 0.0722 * S.b,
    lumU: 0.2126 * S.u0 + 0.7152 * S.u1 + 0.0722 * S.u2,
    span: (S.M - S.mn) * (S.um - S.wu), op: 1 - ((S.M - S.mn) + (S.um - S.wu)) / 2,
  };
}

/* 线性最小二乘（Cholesky + ridge） */
function solveLS(rows, names, channel, ridge, weightOf) {
  const p = names.length;
  const A = Array.from({ length: p }, () => new Float64Array(p));
  const B = new Float64Array(p);
  for (const r of rows) {
    const w = Math.sqrt(weightOf ? weightOf(r) : 1);
    const y = r.y[channel] * w;
    for (let i = 0; i < p; i++) {
      const di = r.design[names[i]] * w;
      B[i] += di * y;
      for (let j = 0; j <= i; j++) A[i][j] += di * r.design[names[j]] * w;
    }
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) A[j][i] = A[i][j];
  for (let i = 0; i < p; i++) A[i][i] += ridge;
  const L = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-12)); else L[i][j] = s / L[j][j];
  }
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) { let s = B[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
  const x = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < p; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return Array.from(x);
}

function evaluate(model, sets, de) {
  const out = {};
  for (const k of Object.keys(sets)) {
    let sum = 0, mx = 0;
    for (const e of sets[k]) { const d = de(e); sum += d; if (d > mx) mx = d; }
    out[k] = { mean: +(sum / sets[k].length).toFixed(3), max: +mx.toFixed(2), n: sets[k].length };
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (v, d) => { const i = args.indexOf(v); return i >= 0 ? args[i + 1] : d; };
  const basis = opt('--basis', 'trigfree');
  const pnorm = parseFloat(opt('--pnorm', '2'));
  const space = opt('--space', 'rgb');
  const rounds = parseInt(opt('--rounds', '0'), 10);
  const outDir = opt('--out', OUT_DIR);
  const emit = args.includes('--emit');
  const seeds = parseInt(opt('--seeds', '0'), 10);
  if (!(pnorm >= 2)) throw new Error('--pnorm 需 ≥ 2');
  if (basis !== 'old' && basis !== 'trigfree') throw new Error('未知 --basis: ' + basis);

  const { source } = await fetchMixbox();
  const { suite, sandbox } = loadSuite({ mixboxSource: source, exportInternals: true });
  const I = suite.__internals;
  const ref = sandbox.mixbox.lerpFloat;
  const LAB = I.rgbToLab, dE = I.deltaE2000, CM = sandbox.ColorMixing;
  const K = mkConstants(suite);
  const branchState = makeState(K);
  const featFn = basis === 'old' ? (S => featsOld(S, K)) : featsTrigFree;
  const subsets = basis === 'old' ? OLD_SUBSETS : { 0: TRIGFREE, 1: TRIGFREE, 2: TRIGFREE };

  /* ---- 拟合语料（与 run-heldout 的 in-sample 划分一致） ---- */
  const corpus = [].concat(I.buildT1(), I.buildT2(), I.buildT3(20260808, 800), I.buildT5E(), I.buildT5());
  const rnd = I.mulberry32(CORPUS_SEED);
  for (let i = 0; i < RANDOM_PAIRS; i++) corpus.push({ base: [rnd(), rnd(), rnd()], tint: [rnd(), rnd(), rnd()], a: rnd() });
  const anchorSet = [];
  for (const pr of ANCHORS) for (let k = 1; k <= ALPHA_STEPS; k++) anchorSet.push({ base: H2(pr[0]), tint: H2(pr[1]), a: k / (ALPHA_STEPS + 1) });
  for (const s of anchorSet) corpus.push({ ...s, anchor: true });

  const rows = [];
  for (const s of corpus) {
    const C = CM.mixPbmCore(s.base, s.tint, s.a);
    const sb = branchState(s.base, s.tint, s.a, CM);
    const st = branchState(s.tint, s.base, 1 - s.a, CM);
    const mB = Math.max(s.base[0], s.base[1], s.base[2]), mT = Math.max(s.tint[0], s.tint[1], s.tint[2]);
    const te = Math.min(1, Math.max(0, (mT - mB + 0.08) / 0.16));
    const lam = te * te * (3 - 2 * te);
    let wA, wB;
    if (te <= 0) { wA = 0; wB = 1; } else if (te >= 1) { wA = 1; wB = 0; } else { wA = lam; wB = 1 - lam; }
    const scale = (w, S) => { const o = featFn(S); for (const k in o) o[k] *= w * S.gm; return o; };
    const fA = scale(wA, sb), fB = scale(wB, st);
    const design = {};
    for (const k in fA) design[k] = fA[k] + fB[k];
    const corr = [0, 1, 2].map(c => wA * sb.gate * (sb.T[c] - C[c]) + wB * st.gate * (st.T[c] - C[c]));
    const r = ref(s.base, s.tint, s.a);
    if (wA * sb.gm + wB * st.gm < 0.02) continue;
    rows.push({ design, y: [0, 1, 2].map(c => r[c] - C[c] - corr[c]), anchor: !!s.anchor, C, ref: r });
  }

  const baseW = r => (r.anchor ? 10 : 1);
  let coefs = [0, 1, 2].map(c => solveLS(rows, subsets[c], c, 1e-6, baseW));
  /* p 范数 IRLS：min Σ|r|^p，等价于按 |r|^(p−2) 加权的最小二乘；p=2 退化为 OLS。
   * --space de00 用 CIEDE2000 残差（直接压"最坏对"），--space rgb 用 RGB 残差。 */
  const residualOf = (r) => {
    if (space === 'de00') {
      const out = [0, 1, 2].map(c => {
        let p = 0;
        for (let i = 0; i < subsets[c].length; i++) p += coefs[c][i] * r.design[subsets[c][i]];
        return Math.max(0, Math.min(1, r.C[c] + p));
      });
      return dE(LAB(out), LAB(r.ref));
    }
    let mx = 0;
    for (let c = 0; c < 3; c++) {
      let p = 0;
      for (let i = 0; i < subsets[c].length; i++) p += coefs[c][i] * r.design[subsets[c][i]];
      mx = Math.max(mx, Math.abs(r.y[c] - p));
    }
    return mx;
  };
  for (let it = 0; pnorm > 2 && it < Math.max(1, rounds); it++) {
    const res = rows.map(residualOf);
    const mean = res.reduce((a, b) => a + b, 0) / res.length || 1;
    const w = res.map(v => Math.pow(Math.max(v, 1e-9) / mean, pnorm - 2));
    const wMean = w.reduce((a, b) => a + b, 0) / w.length || 1;
    const rows2 = rows.map((r, i) => Object.assign({}, r, { __w: w[i] / wMean }));
    coefs = [0, 1, 2].map(c => solveLS(rows2, subsets[c], c, 1e-6, r => r.__w * baseW(r)));
  }

  /* ---- 评估：套件指标（对参考） ---- */
  function applyGamma(base, tint, a) {
    // 用拟合系数重算 γ 块：C + d，d = gate(T−C) + γ̂·gm（含角色混合）
    const C = CM.mixPbmCore(base, tint, a);
    const term = (S, w) => {
      if (w === 0) return [0, 0, 0];
      const f = featFn(S);
      return [0, 1, 2].map(c => {
        let p = 0;
        for (let i = 0; i < subsets[c].length; i++) p += coefs[c][i] * f[subsets[c][i]];
        return w * (S.gate * (S.T[c] - C[c]) + p * S.gm);
      });
    };
    const sb = branchState(base, tint, a, CM);
    const st = branchState(tint, base, 1 - a, CM);
    const mB = Math.max(...base), mT = Math.max(...tint);
    const te = Math.min(1, Math.max(0, (mT - mB + 0.08) / 0.16));
    const lam = te * te * (3 - 2 * te);
    let wA, wB;
    if (te <= 0) { wA = 0; wB = 1; } else if (te >= 1) { wA = 1; wB = 0; } else { wA = lam; wB = 1 - lam; }
    const dA = term(sb, wA), dB = term(st, wB);
    return [0, 1, 2].map(c => Math.max(0, Math.min(1, C[c] + dA[c] + dB[c])));
  }
  const t3 = I.buildT3(20260808, 2000);
  const sets = {
    T1: I.buildT1(), T2: I.buildT2(), T3fit: t3.slice(0, 800), 'T3-hold': t3.slice(800),
    'T3-s09': I.buildT3(20260809, 2000), 'T3-s11': I.buildT3(20260811, 2000),
    T5: I.buildT5(), T5E: I.buildT5E(), 'T5-heldout': I.buildT5Random(20260812, I.T5_RANDOM_N),
    anchors: anchorSet,
  };
  const metricSets = {};
  for (const k of Object.keys(sets)) metricSets[k] = sets[k].map(s => dE(LAB(applyGamma(s.base, s.tint, s.a)), LAB(ref(s.base, s.tint, s.a))));
  const current = {};
  for (const k of Object.keys(sets)) current[k] = sets[k].map(s => dE(LAB(I.mixPbm(s.base, s.tint, s.a)), LAB(ref(s.base, s.tint, s.a))));
  const fitted = evaluate(null, metricSets, d => d);
  const baseline = evaluate(null, current, d => d);

  console.log('basis=' + basis + '  pnorm=' + pnorm + '  rounds=' + rounds + '  space=' + space + '  rows=' + rows.length);
  console.log('set'.padEnd(12) + 'fitted mean/max'.padEnd(22) + 'current mean/max');
  for (const k of Object.keys(fitted))
    console.log(k.padEnd(12) + (fitted[k].mean + '/' + fitted[k].max).padEnd(22) + (baseline[k].mean + '/' + baseline[k].max));

  if (emit) {
    console.log('\n/* ---- 拟合系数（替换 pbmRepairDelta 中的 γ 块） ---- */');
    for (let c = 0; c < 3; c++)
      console.log('ch' + c + ': ' + subsets[c].map((nm, i) => nm + '=' + coefs[c][i]).join(', '));
  }

  /* ---- 多 seed 复核：最坏对是抽样噪声还是系统性差异 ---- */
  if (seeds > 0) {
    const perSeed = [];
    for (let i = 0; i < seeds; i++) {
      const draw = I.buildT3(20260901 + i, 2000);
      let fSum = 0, fMax = 0, cSum = 0, cMax = 0;
      for (const s of draw) {
        const r = ref(s.base, s.tint, s.a);
        const df = dE(LAB(applyGamma(s.base, s.tint, s.a)), LAB(r));
        const dc = dE(LAB(I.mixPbm(s.base, s.tint, s.a)), LAB(r));
        fSum += df; cSum += dc;
        if (df > fMax) fMax = df;
        if (dc > cMax) cMax = dc;
      }
      perSeed.push({ seed: 20260901 + i, fitMean: +(fSum / 2000).toFixed(3), fitMax: +fMax.toFixed(2), curMean: +(cSum / 2000).toFixed(3), curMax: +cMax.toFixed(2) });
    }
    const avg = k => perSeed.reduce((a, o) => a + o[k], 0) / perSeed.length;
    console.log('\n多 seed 复核（每 seed 2000 对）:');
    for (const o of perSeed) console.log('  seed ' + o.seed + '  fit ' + o.fitMean + '/' + o.fitMax + '   cur ' + o.curMean + '/' + o.curMax);
    console.log('  mean of means: fit ' + avg('fitMean').toFixed(3) + '  cur ' + avg('curMean').toFixed(3));
    console.log('  mean of maxes: fit ' + avg('fitMax').toFixed(2) + '  cur ' + avg('curMax').toFixed(2));
    console.log('  worst max:     fit ' + Math.max.apply(null, perSeed.map(o => o.fitMax)).toFixed(2) + '  cur ' + Math.max.apply(null, perSeed.map(o => o.curMax)).toFixed(2));
  }

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'gamma-fit.json');
  fs.writeFileSync(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    basis, pnorm, rounds, space, rows: rows.length,
    subsets: subsets, coefs: coefs,
    fitted, current,
  }, null, 2));
  console.log('\nreport ->', file);
}

main().catch(e => { console.error(e); process.exit(1); });