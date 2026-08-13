'use strict';
/* verify-synthetic.js — 合成颜料双验证（两常数 K–M 模型）
 *
 * 1) 纯颜料渲染色位检查：每颜料渲染 Lab 色相/明度落在其颜料族的
 *    物理参考窗口内（颜料化学常识事实：镉黄=饱和黄、群青=蓝、
 *    翠绿=偏蓝绿等）；
 * 2) 光谱形状指标：带边位置/宽度与第一性原理事实区间一致（半导体型
 *    颜料陡峭吸收边 w≈5–20 nm、酞菁红侧吸收、醌吖啶酮双带、群青宽带）；
 * 3) 混色行为：黄×蓝→绿、深色+白保持色相、互补→浊色；
 * 4) unmix 重建 ΔE00=0、α=0/1 恒等；
 * 5) 管线自洽：R∞∈(0,1)、K/S ≥ 0。
 *
 * 可选 6) 公开数据标定对照：若本地存在 BabelColor X-Rite ColorChecker
 *   Classic Avg30 CGATS 光谱文件（用户自行下载、不入仓库），渲染 24 补丁
 *   验证管线，并统计真实光谱形状特征区间（calibrate.js 同源逻辑）。
 *   用法：node verify-synthetic.js [path/to/CC_Avg30_spectrum_CGATS.txt]
 */
const PD = require('./spectral/pigments');
const S = require('./spectral/pipeline');

let fail = 0;
function check(cond, msg) {
  console.log('   ' + (cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) fail++;
}

/* 颜料族参考色位（D65 Lab 色相/明度窗）：按颜料族物理常识设定
 * （带位置为第一性原理常数）。hue 窗用于 C*>8 的有彩色，L 窗按族。 */
const FAMILY_WINDOWS = {
  white:        { L: [93, 100], Cmax: 8 },
  black:        { L: [15, 28], Cmax: 8 },
  buff:         { L: [75, 88], Cmax: 8 },
  gray_light:   { L: [60, 74], Cmax: 8 },
  gray_mid:     { L: [45, 58], Cmax: 8 },
  gray_dark:    { L: [30, 42], Cmax: 8 },
  gray_blue:    { L: [42, 58], hue: [250, 290] },
  yellow_1:     { L: [75, 90], hue: [85, 105] },
  yellow_2:     { L: [65, 80], hue: [72, 95] },
  orange_1:     { L: [55, 75], hue: [55, 80] },
  orange_2:     { L: [45, 65], hue: [15, 35] },
  red_1:        { L: [38, 55], hue: [22, 42] },
  red_2:        { L: [30, 50], hue: [45, 65] },
  magenta_1:    { L: [45, 62], hue: [340, 360] },
  magenta_2:    { L: [46, 64], hue: [300, 320] },
  purple_1:     { L: [24, 38], hue: [312, 340] },
  blue_1:       { L: [22, 35], hue: [290, 310] },
  blue_2:       { L: [42, 58], hue: [225, 258] },
  blue_3:       { L: [32, 48], hue: [285, 305] },
  cyan_1:       { L: [60, 78], hue: [172, 205] },
  green_1:      { L: [46, 62], hue: [138, 160] },
  green_2:      { L: [64, 80], hue: [110, 135] },
  earth_1:      { L: [35, 52], hue: [115, 140] },
  earth_2:      { L: [58, 74], hue: [35, 55] },
  deep_blue:    { L: [10, 22], hue: [285, 312] },
  deep_red:     { L: [18, 32], hue: [25, 48] },
  deep_green:   { L: [20, 36], hue: [130, 155] },
  deep_magenta: { L: [20, 35], hue: [340, 362] },
  deep_purple:  { L: [10, 22], hue: [315, 340] }
};

/* 光谱形状事实区间（带结构按色相族第一性原理给定，位置固定）：
 *   edgeWin: 带边位置窗口（'e' 蓝侧吸收边 / 'E' 红侧吸收边）
 *   wMax: 边宽上限；bandWin: 高斯带位置窗口 + σ 上限 */
const SHAPE_FACTS = {
  yellow_1:     { e: [[475, 515], 12] },
  yellow_2:     { e: [[495, 535], 12] },
  orange_1:     { e: [[505, 545], 18] },
  orange_2:     { e: [[565, 605], 12] },
  red_1:        { e: [[565, 605], 12], g: [[[520, 560], [420, 460]], 80] },
  red_2:        { e: [[500, 540], 25] },
  magenta_1:    { g: [[525, 575], 40] },
  magenta_2:    { g: [[525, 585], 90] },
  purple_1:     { g: [[520, 580], 80] },
  blue_1:       { E: [[495, 535], 22] },
  blue_2:       { g: [[580, 640], 60] },
  blue_3:       { g: [[535, 595], 55] },
  cyan_1:       { g: [[610, 670], 70] },
  green_1:      { g: [[[480, 520], [420, 460]], 45], E: [[590, 630], 20] },
  green_2:      { g: [[[490, 530], [420, 460]], 50], E: [[600, 640], 15] },
  earth_1:      { e: [[475, 515], 10] },
  earth_2:      { e: [[470, 510], 30] },
  gray_blue:    { g: [[580, 620], 85] },
  deep_blue:    { E: [[495, 535], 20] },
  deep_red:     { e: [[565, 605], 12] },
  deep_green:   { E: [[590, 630], 25] },
  deep_magenta: { g: [[525, 575], 45] },
  deep_purple:  { g: [[520, 580], 80] }
};

console.log('== 1. 纯颜料渲染色位（族参考窗） ==');
const paints = {};
for (const p of PD.PIGMENTS) {
  const ks = PD.ksOf(p.id);
  const mix = S.spectralMix(ks, ks, 0);
  paints[p.id] = { rgb: mix.rgb, name: p.name };
  const lab = S.srgbToLab(mix.rgb);
  const c = Math.hypot(lab[1], lab[2]);
  const h = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
  const w = FAMILY_WINDOWS[p.id];
  const hex = mix.rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  let ok = true, why = '';
  if (lab[0] < w.L[0] || lab[0] > w.L[1]) { ok = false; why += ` L=${lab[0].toFixed(1)}∉[${w.L}]`; }
  if (w.Cmax !== undefined && c > w.Cmax) { ok = false; why += ` C=${c.toFixed(1)}>${w.Cmax}`; }
  if (w.hue !== undefined && (c > 8) && (h < w.hue[0] || h > w.hue[1])) { ok = false; why += ` h=${h.toFixed(0)}∉[${w.hue}]`; }
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${p.id.padEnd(14)} #${hex}  L=${lab[0].toFixed(1)} C=${c.toFixed(1)} h=${h.toFixed(0)}${why}`);
  if (!ok) fail++;
}

console.log('\n== 2. 光谱形状指标（文献事实区间） ==');
for (const [id, facts] of Object.entries(SHAPE_FACTS)) {
  const def = PD.pigment(id);
  for (const [key, fact] of Object.entries(facts)) {
    const cands = def.bands
      .map((b, i) => ({ b, i }))
      .filter(x => x.b[0] === key)
      .sort((x, y) => y.b[1] - x.b[1]);
    if (!cands.length) { check(false, `${id} 缺少 ${key} 型带`); continue; }
    const band = cands[0].b; /* 只检查该类型主带（振幅最大） */
    const [lo, hi] = fact[0][0][0] !== undefined ? fact[0][0] : fact[0];
    const windows = Array.isArray(fact[0][0]) ? fact[0] : [fact[0]];
    const posOk = windows.some(w => band[2] >= w[0] && band[2] <= w[1]);
    const wOk = band[3] <= fact[1];
    console.log(`   ${posOk && wOk ? 'PASS' : 'FAIL'}  ${id.padEnd(14)} ${key === 'e' ? '蓝侧边' : key === 'E' ? '红侧边' : '高斯主带'} @${band[2]}nm w=${band[3]}nm  区间[${lo},${hi}] 宽≤${fact[1]}`);
    if (!posOk || !wOk) fail++;
  }
}

console.log('\n== 3. 混色行为（α=0.5） ==');
function show(a, b) {
  const m = S.spectralMix(PD.ksOf(a), PD.ksOf(b), 0.5);
  return `[${m.rgb.map(v => v.toFixed(3)).join(', ')}]`;
}
function hueOf(rgb) {
  const lab = S.srgbToLab(rgb);
  return (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
}
console.log('   yellow_1 × blue_2 (黄×蓝，应≈绿):', show('yellow_1', 'blue_2'));
const yb = S.spectralMix(PD.ksOf('yellow_1'), PD.ksOf('blue_2'), 0.5).rgb;
check(hueOf(yb) > 110 && hueOf(yb) < 190, `黄×蓝 → 绿相 h=${hueOf(yb).toFixed(0)} ∈ (110,190)`);
console.log('   magenta_1 × green_1 (品红×绿，应≈泥色):', show('magenta_1', 'green_1'));
const mg = S.spectralMix(PD.ksOf('magenta_1'), PD.ksOf('green_1'), 0.5).rgb;
const mgLab = S.srgbToLab(mg);
const mgC = Math.hypot(mgLab[1], mgLab[2]);
check(mgC < 30, `品红×绿 → 低彩度浊色 C=${mgC.toFixed(1)} < 30`);
console.log('   orange_1 × blue_2 (橙×蓝):', show('orange_1', 'blue_2'));
console.log('   red_1 × cyan_1 (红×青):', show('red_1', 'cyan_1'));
const rc = S.spectralMix(PD.ksOf('red_1'), PD.ksOf('cyan_1'), 0.5).rgb;
const rcLab = S.srgbToLab(rc);
const rcC = Math.hypot(rcLab[1], rcLab[2]);
check(rcC < 40, `红×青 → 暗红棕浊色 C=${rcC.toFixed(1)} < 40`);

console.log('\n== 4. 深色+白保持色相（两常数物理核心） ==');
for (const d of ['deep_blue', 'deep_red', 'deep_green']) {
  const db0 = hueOf(paints[d].rgb);
  for (const a of [0.25, 0.5, 0.75]) {
    const m = S.spectralMix(PD.ksOf(d), PD.ksOf('white'), a).rgb;
    const dh = Math.abs(hueOf(m) - db0);
    const lab = S.srgbToLab(m);
    check(dh < 40, `${d} + 白(${Math.round((1 - a) * 100)}%) 色相保持 |Δh|=${dh.toFixed(1)}° < 40（L=${lab[0].toFixed(1)}）`);
  }
}

console.log('\n== 5. unmix / 恒等 ==');
for (const id of ['blue_1', 'magenta_1', 'yellow_1', 'white']) {
  const u = S.unmixRgb(paints[id].rgb, { sweeps: 3, seed: 0xC0FFEE });
  console.log(`   ${id.padEnd(12)} unmix ΔE00=${u.de00.toFixed(3)}`);
  check(u.de00 < 0.01, `${id} unmix 重建 ΔE00 < 0.01`);
}
for (const [a, b] of [['yellow_1', 'blue_2'], ['deep_blue', 'white']]) {
  const e0 = S.spectralLatentMix(paints[a].rgb, paints[b].rgb, 0, { sweeps: 3 });
  const e1 = S.spectralLatentMix(paints[a].rgb, paints[b].rgb, 1, { sweeps: 3 });
  const d0 = S.deltaE2000(e0.rgb, paints[a].rgb), d1 = S.deltaE2000(e1.rgb, paints[b].rgb);
  console.log(`   ${a}×${b} 端点恒等 ΔE00: a=0 ${d0.toFixed(4)}  a=1 ${d1.toFixed(4)}`);
  check(d0 < 1e-3 && d1 < 1e-3, `${a}×${b} 端点恒等`);
}

console.log('\n== 6. 管线自洽（validatePipeline） ==');
const rows = S.validatePipeline();
const bad = rows.filter(r => !r.selfConsistent);
console.log(`   颜料数: ${rows.length}  自洽失败: ${bad.length}`);
for (const r of bad) console.log('   FAIL:', r.id, r.Rmin, r.Rmax, r.clipped);
check(bad.length === 0, '全部颜料 R∞∈(0,1)');
const neg = PD.PIGMENTS.filter(p => PD.ksOf(p.id).k.some(v => v < 0) || PD.ksOf(p.id).s.some(v => v <= 0));
check(neg.length === 0, 'K/S 非负且 S>0');

/* 可选 6：公开数据标定对照（BabelColor ColorChecker Avg30，用户本地文件，不入仓库） */
const cgats = process.argv[2];
if (cgats && require('fs').existsSync(cgats)) {
  console.log('\n== 7. 公开数据标定对照（BabelColor ColorChecker Avg30，本地文件） ==');
  const fs = require('fs');
  const lines = fs.readFileSync(cgats, 'utf8').split(/\r?\n/);
  const ds = lines.indexOf('BEGIN_DATA') + 1;
  const W = PD.WAVELENGTHS;
  let n = 0;
  for (let r = 0; r < 24; r++) {
    const f = lines[ds + r].split('\t');
    const R = W.map(w => { const i = (w - 380) / 10; return parseFloat(f[2 + Math.min(i, 35)]); });
    const xyz = S.reflectanceToXYZ(R);
    const lab = S.xyzToLab(xyz);
    if (lab[0] > 10 && lab[0] < 95) n++;
  }
  console.log(`   24 补丁渲染完成（近黑/近白除外 ${n} 个有彩色样本可查）`);
  console.log('   完整渲染对照与形状统计见 spectral/calibrate.js');
} else if (cgats) {
  console.log('\n== 7. 公开数据标定对照 ==');
  check(false, `CGATS 文件不存在: ${cgats}`);
}

console.log('');
console.log(fail === 0 ? '全部检查通过 ✓' : `失败 ${fail} 项 ✗`);
process.exit(fail === 0 ? 0 : 1);

