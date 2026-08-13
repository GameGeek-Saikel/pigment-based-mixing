'use strict';
/* run-deploy-csat.js — 终态落地：删除锚点补丁，γ 谐波 cSat 连续公式化
 * 同步修改 color-mixing-evaluation.html / color-mixing-demo.html
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  path.join(__dirname, '..', 'color-mixing-evaluation.html'),
  path.join(__dirname, '..', 'color-mixing-demo.html'),
];

let total = 0;
for (const file of FILES) {
  let s = fs.readFileSync(file, 'utf8');
  let n = 0, warn = 0;
  const rep = (oldS, newS, label) => {
    if (!s.includes(oldS)) { warn++; return; }
    s = s.split(oldS).join(newS);
    n++;
  };

  /* A. 锚点常量块 → 注释（区间替换，兼容 eval/demo 注释差异；已移除则跳过） */
  const aStart = s.indexOf('/* 校准门控共享表');
  const aEnd = s.indexOf('const PBM_CC2_GAMMA = 0.10;');
  if (aStart >= 0 && aEnd >= 0) {
    s = s.slice(0, aStart) +
      '/* 锚点补丁（族1/族2 条件门）已移除——γ 谐波 cSat 连续公式覆盖互补与锚点区（docs/color-mixing-algorithm.md §3.4） */\n' +
      s.slice(aEnd + 'const PBM_CC2_GAMMA = 0.10;'.length);
    n++;
  }

  /* B. 锚点计算块（保留 ss 供 cSat） */
  rep(
    '  const wU = u[0] - u[2], cP = pig[2] - pig[0];\n' +
    '  const maxdU = Math.max(u[0], u[1], u[2]) - Math.min(u[0], u[1], u[2]);\n',
    '', '删 wU/cP/maxdU');
  rep(
    '  const inc = (x, t, w) => ss(x, t - w, t);\n' +
    '  const dec = (x, t, w) => 1 - ss(x, t, t + w);\n',
    '', '删 inc/dec');
  rep(
    '  // 族1：pig 深蓝（R≈0、B 主导、中暗）× u 亮黄\n' +
    '  const gComp = inc(wU * cP, CC_T.OPP, BW.D)\n' +
    '    * inc(u[0] - u[1], -CC_T.YEL, BW.D) * inc(u[1] - u[2], 0, BW.D) * inc(u[1], CC_T.G_LO, BW.D)\n' +
    '    * inc(pig[2] - pig[0], 0, BW.D) * inc(pig[2] - pig[1], 0, BW.D) * dec(pig[0], CC_T.RMAX, BW.A)\n' +
    '    * inc(M, CC_T.M_LO, BW.B) * dec(M, CC_T.M_HI, BW.C)\n' +
    '    * inc(maxd, CC_T.MD_PIG, BW.D) * inc(maxdU, CC_T.MD_U, BW.D);\n' +
    '  if (gComp > 1e-6) {\n' +
    '    // 单通道校正：R 吸收保持（G/B 实测零误差不修正）；形状 4·aEff(1−aEff) + 亮端抑制（aEff→1 时不修正）\n' +
    '    d[0] -= gComp * PBM_CC_GAMMA * 4 * aEff * (1 - aEff) * clamp(PBM_CC_KA * (PBM_CC_A1 - aEff), 0, 1);\n' +
    '  }\n' +
    '  // 族2：pig 红主导（R 显著大于 G/B、G≈0、中暗）× u 绿/青主导（G 最大、G≥0.5）\n' +
    '  const gRg = inc(pig[0] - pig[1], CC_T.RT2, BW.E) * inc(pig[0] - pig[2], CC_T.RT2, BW.E)\n' +
    '    * dec(pig[1], CC_T.GLO2, BW.D)\n' +
    '    * inc(u[1] - u[0], CC_T.GT2, BW.E) * inc(u[1] - u[2], 0, BW.C) * inc(u[1], CC_T.GTH2, BW.A)\n' +
    '    * inc(M, CC_T.MLO2, BW.E) * dec(M, CC_T.MHI2, BW.C) * (1 - gate);\n',
    '  /* γ 谐波应用门：cSat 双端色度软衰减（近灰区 γ→0，平滑消除 hue 谐波在低色度区的梯度爆炸） */\n',
    '删族1/族2 计算块');
  rep(
    '  if (gRg > 1e-6) {\n' +
    '    // 单通道校正：G 吸收保持，振幅随亮端绿强度缩放\n' +
    '    d[1] -= gRg * PBM_CC2_GAMMA * (u[1] - pig[1]) / 0.70 * 4 * aEff * (1 - aEff) * clamp(PBM_CC_KA * (PBM_CC_A1 - aEff), 0, 1);\n' +
    '  }\n',
    '', '删族2 if 块');

  /* C. 门控区 */
  rep(
    '  const gSup = clamp(1 - gate - gComp - gRg, 0, 1);\n' +
    '  const isWhite = (() => { const t = clamp((Math.min(u[0], u[1], u[2]) - 0.5) / (0.92 - 0.5), 0, 1); return t * t * (3 - 2 * t); })();\n' +
    '  const hA = clamp(PBM_CC_KA * (PBM_CC_A1 - aEff), 0, 1);',
    '  const gSup = clamp(1 - gate, 0, 1);\n' +
    '  const hA = clamp(14 * (0.845 - aEff), 0, 1);\n' +
    '  const cSat = ss(pm - pn, 0.02, 0.15) * ss(um - un, 0.08, 0.30);',
    '门控区（gSup/hA/cSat）');

  /* D. γ 三块（删 gAmp/gChroma，应用行 cSat） */
  for (let c = 0; c < 3; c++) {
    rep(
      '    const gAmp = (() => { const t = clamp((Math.abs(gam) - 0.0436968) / (0.0566048 - 0.0436968), 0, 1); return t * t * (3 - 2 * t); })();\n' +
      '    const gChroma = clamp((pm - pn - 0.22935955) * 12.584, 0, 1);\n' +
      '    d[' + c + '] += gam * (1 - isWhite) * gSup * gAmp * gChroma * 4 * aEff * (1 - aEff) * hA; }',
      '    d[' + c + '] += gam * cSat * gSup * 4 * aEff * (1 - aEff) * hA; }',
      'γ 块 ch' + c);
  }

  /* E. 融合校准注释更新 */
  rep(
    '  /* 融合校准（统一特征模板 + 谐波 γ + 白轨道）\n' +
    '   * o"_c += Σ_k g_k·γ_k·φ_k·h(a_eff)：\n' +
    '   *   γ 谐波（互补残留）：(1−isWhite)·gSup·gAmp·gChroma · γ_c·4a(1−a)·h(a)\n' +
    '   *   白轨道（深白）：isWhite·gDark · γ_W·a^p(1−a)·h(a)·Ŵ（Ŵ=[1,1,1]/√3，p 闭式）\n' +
    '   * 统一特征模板 V（19 特征一次计算，五组系数复用，拟合见 docs/parameter-fusion.md） */',
    '  /* 融合校准（统一特征模板 + γ 谐波单一连续公式）：\n' +
    '   * o"_c += γ̂_c(p,u)·cSat·gSup·4a(1−a)·h(a)\n' +
    '   *   cSat = ss(pm−pn, 0.02, 0.15)·ss(um−un, 0.08, 0.30)（双端色度软衰减：近灰区 γ→0，\n' +
    '   *     平滑消除 hue 谐波在低色度区的梯度爆炸；连续 C¹，无任何条件补丁）\n' +
    '   * 统一特征模板 V（21 特征一次计算，三组系数复用，拟合见 docs/color-mixing-algorithm.md §4.7） */',
    '融合注释');

  fs.writeFileSync(file, s);
  total += n;
  console.log(path.basename(file) + ': ' + n + ' 处修改');
}
console.log('落地完成，共', total, '处');
