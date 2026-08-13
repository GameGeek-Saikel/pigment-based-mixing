'use strict';
/* run-ablation.js — PBM 组件消融（论文消融表用数据）
 *
 * 对 evaluation.html 内联源码做文本替换，逐项关闭组件（补丁目标适配优化参考实现）：
 *   no-beta      互吸收修正 β → 0
 *   no-cpl       通道耦合 CPL → 0
 *   no-dirresp   族方向响应 δ → 关闭
 *   no-gamma     γ 谐波（cSat 置 0）
 *   gate0        门控恒 0（修复全关，纯 K–M 核心直出）
 *   gate1        门控恒 1（幂律目标全接管）
 *   no-m3        交叉通道矩阵 M3 → 恒等（前向展开 + PBM_M/PBM_MI 同步）
 *
 * 用法：node run-ablation.js [--out <dir>] [--only <key>]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSuite } = require('./suite-loader');
const { fetchMixbox } = require('./mixbox-fetch');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');
const SEED = 20260808;
const N = 2000;
const TAIL_ALPHAS = [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99];
const BLIND_SPOTS = ['#0D1B44', '#001B75', '#000080', '#001E80', '#080248', '#0A2A6E', '#2A0A5E', '#060538', '#000333'];

const REPLACE = {
  'no-beta': () => s => s.replace(
    'const PBM_BETA = [-0.69372345, -0.48397409, -0.24977842];',
    'const PBM_BETA = [0, 0, 0];'),
  'no-cpl': () => s => s.replace(
    'const PBM_PW_CPL = 0.43251363, PBM_PW_KC = 4.86795929;',
    'const PBM_PW_CPL = 0, PBM_PW_KC = 4.86795929;'),
  'no-dirresp': () => s => s
    .replace('q0 += gRed * (PBM_PW_RD[0] + PBM_PW_RD[1] * r) + gB * PBM_PW_BD_R + gG * (PBM_PW_GD_R[0] + PBM_PW_GD_R[1] * r);', '/* ablation: no-dirresp */')
    .replace('q1 += gRed * (PBM_PW_RD[2] + PBM_PW_RD[3] * g) + gB * (PBM_PW_BD_G[0] + PBM_PW_BD_G[1] * g);', '/* ablation: no-dirresp */')
    .replace('q2 += gRed * (PBM_PW_RD[4] + PBM_PW_RD[5] * g) + gG * (PBM_PW_GD_B[0] + PBM_PW_GD_B[1] * g);', '/* ablation: no-dirresp */'),
  'gate0': () => s => s.replace(
    'const gate = ck(w - 0.3706311) * ck(M) * ck(maxd - 0.06556298);',
    'const gate = 0;'),
  'gate1': () => s => s.replace(
    'const gate = ck(w - 0.3706311) * ck(M) * ck(maxd - 0.06556298);',
    'const gate = 1;'),
  'no-m3': () => s => s
    .replace('const vb0 = 0.74523981 * b0 + 0.30403013 * b1 - 0.04926994 * b2;', 'const vb0 = b0;')
    .replace('const vb1 = 0.74093256 * b1 + 0.25906744 * b2;', 'const vb1 = b1;')
    .replace('const vt0 = 0.74523981 * t0 + 0.30403013 * t1 - 0.04926994 * t2;', 'const vt0 = t0;')
    .replace('const vt1 = 0.74093256 * t1 + 0.25906744 * t2;', 'const vt1 = t1;')
    .replace(
      'const PBM_M = [0.74523981, 0.30403013, -0.04926994, 0, 0.74093256, 0.25906744, 0, 0, 1];',
      'const PBM_M = [1, 0, 0, 0, 1, 0, 0, 0, 1];'),
  'no-comp': () => s => s
    .replace('const PBM_CC_GAMMA = 0.28;', 'const PBM_CC_GAMMA = 0;')
    .replace('const PBM_CC2_GAMMA = 0.10;', 'const PBM_CC2_GAMMA = 0;'),
  'no-gamma': () => s => s.replace(
    'const cSat = ssT(M - mn, 0.02, 0.15) * ssT(um - wu, 0.08, 0.30);',
    'const cSat = 0;'),
};

const CONFIGS = [
  { key: 'full', label: 'PBM（完整）' },
  { key: 'no-m3', label: '− 交叉通道矩阵 M3' },
  { key: 'no-beta', label: '− 互吸收修正 β' },
  { key: 'no-cpl', label: '− 通道耦合 CPL' },
  { key: 'no-dirresp', label: '− 族方向响应 δ' },
  { key: 'no-gamma', label: '− γ 谐波（cSat 置 0）' },
  { key: 'gate0', label: '− 幂律修复（门控恒 0，纯核心）' },
  { key: 'gate1', label: '幂律全接管（门控恒 1）' },
];

function statsOf(de00) {
  const s = de00.slice().sort((x, y) => x - y);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n,
    mean: sum / n,
    max: s[n - 1],
    median: s[Math.ceil(0.5 * n) - 1],
    p95: s[Math.min(n - 1, Math.ceil(0.95 * n) - 1)],
  };
}

function buildTail(I) {
  const out = [];
  for (const [, hb] of I.T5_DEF)
    for (const a of TAIL_ALPHAS)
      out.push({ set: 'tail', base: I.HEX2RGB(hb), tint: [1, 1, 1], a });
  for (const h of BLIND_SPOTS)
    for (const a of I.ALPHAS_T5)
      out.push({ set: 'tail', base: I.HEX2RGB(h), tint: [1, 1, 1], a });
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = v => { const i = args.indexOf(v); return i >= 0 ? args[i + 1] : null; };
  const outDir = opt('--out') || OUT_DIR;
  const only = opt('--only');
  const configs = only ? CONFIGS.filter(c => c.key === only) : CONFIGS;

  const { source } = await fetchMixbox();
  const report = { generatedAt: new Date().toISOString(), seed: SEED, n: N, configs: [] };

  for (const cfg of configs) {
    const patch = cfg.key === 'full' ? null : REPLACE[cfg.key]();
    const { suite, sandbox } = loadSuite({ mixboxSource: source, patch, exportInternals: true });
    const I = suite.__internals;
    const refFn = sandbox.mixbox.lerpFloat;
    const sets = {
      T1: I.buildT1(),
      T2: I.buildT2(),
      T3: I.buildT3(SEED, N),
      T5: I.buildT5(),
      tail: buildTail(I),
    };
    const pbm = suite.MODELS[0];
    const row = { key: cfg.key, label: cfg.label, T1: null, T2: null, T3: null, T5: null, tail: null };
    for (const k of Object.keys(sets)) {
      row[k] = statsOf(suite.evaluateSet(pbm, sets[k], refFn).map(e => e.de00));
    }
    report.configs.push(row);
    console.log(cfg.key.padEnd(10),
      'T1', row.T1.mean.toFixed(3) + '/' + row.T1.max.toFixed(1),
      'T2', row.T2.mean.toFixed(3) + '/' + row.T2.max.toFixed(1),
      'T3', row.T3.mean.toFixed(3) + '/' + row.T3.max.toFixed(1),
      'T5', row.T5.mean.toFixed(3) + '/' + row.T5.max.toFixed(1),
      'tail', row.tail.mean.toFixed(3) + '/' + row.tail.max.toFixed(1));
  }

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'ablation-report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('report ->', file);
}

main().catch(e => { console.error(e); process.exit(1); });
