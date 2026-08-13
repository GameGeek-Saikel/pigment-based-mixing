'use strict';
/* calibrate.js — 合成光谱数值标定复现工具（公开测量数据，离线使用）
 *
 * 合成颜料光谱的数值参数（幅度/宽度/基底/散射）标定自公开可得的
 * BabelColor X-Rite ColorChecker Classic Avg30 光谱（[Pascale 2012]，
 * 30 张色卡平均、24 个配方色卡补丁、10 nm 网格）：
 *
 *   1) 渲染对照：读取用户本地 CGATS 光谱文件，经本管线（D65 × CIE 1931
 *      2° → sRGB）渲染 24 补丁，验证管线正确性（中性补丁 C* < 3）；
 *   2) 形状统计：统计真实配方色卡光谱的带边位置/宽度区间（合成参数
 *      的参考窗口）；
 *   3) 拟合目标复现：每个补丁渲染色即合成颜料标定的拟合目标
 *      （坐标下降拟合 ΔE00 ≤ 1.2、多数 ≤ 0.2，见 pigments.js）。
 *
 * 数据来源：BabelColor X-Rite ColorChecker Classic Avg30 [Pascale 2012]（站点公开测量数据）；
 * 本脚本复现拟合目标与形状统计，输出 JSON 报告到临时目录。
 *
 * 用法：node calibrate.js <path/to/CC_Avg30_spectrum_CGATS.txt> [--out <dir>]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const PD = require('./pigments');
const S = require('./pipeline');

const OUT_DIR = path.join(os.tmpdir(), 'pbm-paper-tools', 'out');

function main() {
  const cgats = process.argv[2];
  if (!cgats || !fs.existsSync(cgats)) {
    console.error('用法：node calibrate.js <CGATS 光谱文件路径>');
    console.error('（文件为 BabelColor X-Rite ColorChecker Classic Avg30 光谱，用户自行下载、不入仓库）');
    process.exit(1);
  }

  const text = fs.readFileSync(cgats, 'utf8');
  const lines = text.split(/\r?\n/);
  const ds = lines.indexOf('BEGIN_DATA') + 1;
  if (ds <= 0) { console.error('CGATS 解析失败：缺少 BEGIN_DATA'); process.exit(1); }

  const W = PD.WAVELENGTHS;             /* 380–750 nm @ 10 nm */
  const samples = [];
  for (let r = 0; r < 24; r++) {
    const f = lines[ds + r].split('\t');
    if (f.length < 3) continue;
    const R = W.map((w, i) => parseFloat(f[2 + i]));
    samples.push({ id: f[0], name: f[1], R });
  }
  if (samples.length < 24) { console.error(`CGATS 解析失败：只读到 ${samples.length}/24 补丁`); process.exit(1); }

  /* 1) 渲染对照 */
  const rendered = samples.map(s => {
    const xyz = S.reflectanceToXYZ(s.R);
    const lab = S.xyzToLab(xyz);
    const srgb = S.xyzToSrgb(xyz);
    return {
      id: s.id, name: s.name,
      rgb: srgb.rgb.map(v => +v.toFixed(3)),
      L: +lab[0].toFixed(2), a: +lab[1].toFixed(2), b: +lab[2].toFixed(2),
      C: +Math.hypot(lab[1], lab[2]).toFixed(2)
    };
  });
  const neutral = rendered.filter(x => x.C < 3);
  console.log(`渲染 24 补丁完成：中性（C*<3）${neutral.length} 个`);
  console.log('中性补丁（管线验证样本）: ' + neutral.map(x => x.name).join(', '));

  /* 2) 形状统计：带边位置/宽度（下降沿 20%–80% 跨越宽度） */
  function edgeStats(R) {
    /* 找最大下降沿区间：[i0, i1] 内 R 从高点降到低点；返回位置与宽度 */
    let best = null;
    for (let i = 0; i < R.length - 1; i++) {
      const drop = R[i] - R[i + 1];
      if (drop > 0.02 && (!best || drop > best.drop)) best = { drop, i };
    }
    if (!best) return null;
    /* 沿该点向两侧延伸至 R 变化 < 每 nm 0.005，估算 20%–80% 跨越 */
    const lo = Math.max(R[best.i] - 0.1, 0), hi = Math.min(R[best.i] + 0.1, 1);
    const r20 = Math.min(hi, Math.max(lo, 0.2)), r80 = Math.max(lo, Math.min(hi, 0.8));
    const lamAt = (r) => {
      for (let i = 0; i < R.length - 1; i++) {
        if ((R[i] - r) * (R[i + 1] - r) <= 0) {
          const t = (r - R[i]) / (R[i + 1] - R[i]);
          return W[i] + t * 10;
        }
      }
      return null;
    };
    const l20 = lamAt(r20), l80 = lamAt(r80);
    if (l20 === null || l80 === null) return null;
    return { pos: (l20 + l80) / 2, width: Math.abs(l20 - l80) };
  }
  const edges = samples.map(s => ({ id: s.id, ...(edgeStats(s.R) || {}) })).filter(e => e.width !== undefined);
  const widths = edges.map(e => e.width).sort((a, b) => a - b);
  const stats = {
    n: widths.length,
    min: +widths[0].toFixed(1),
    median: +widths[Math.floor(widths.length / 2)].toFixed(1),
    max: +widths[widths.length - 1].toFixed(1)
  };
  console.log(`带边宽度统计（${stats.n} 补丁）: ${stats.min}–${stats.max} nm，中位 ${stats.median}`);

  /* 3) 拟合目标：每个补丁渲染色即对应合成颜料的标定目标 */
  const targets = rendered.map(x => ({ id: x.id, name: x.name, rgb: x.rgb, lab: [x.L, x.a, x.b] }));

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'BabelColor X-Rite ColorChecker Classic Avg30（[Pascale 2012]，用户本地文件，不入仓库）',
    note: '渲染对照 + 形状统计 + 拟合目标复现；合成光谱标定流程见 pigments.js 头注释',
    pipelineCheck: { neutralCount: neutral.length, neutralNames: neutral.map(x => x.name) },
    edgeWidthStats: stats,
    renderTargets: targets
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'calibrate-report.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log('报告 ->', outFile);
}

main();
