/* =====================================================================
 * color-mixing.js — PBM 颜料基混色算法（混合公式，浏览器 + Node 通用，UMD）
 *
 * 只含混色公式本身（论文 §3 两阶段公式）：
 *   阶段 1 K–M 混色核心（§3.3）：M₃ 宽带矩阵 → K/S 解析默认 → κ 浓度叠加
 *     → 互吸收 β → 有理 R∞ → M₃⁻¹；混色比例经 φ_core 端点压缩（φ 动态进度）。
 *   阶段 2 修复层（§3.4）：λ 软角色分配（EW=0.08）→ 深白门 g = σₖ(w−0.3706)·σₖ(M)·σₖ(maxd−0.0656)
 *     → 逐通道幂律目标 T（软阶跃阶梯 + RES 通道残差 + CPL/KC 耦合 + 族方向响应）
 *     → γ 谐波修正（19 特征模板 × 27 系数，双侧色度软衰减）。
 * 不含任何验证/测试代码（色度度量、参考模型、随机生成器等见 demo/ 页面与 tools/）。
 *
 * 浏览器：<script src="color-mixing.js"></script> → window.ColorMixing
 * Node：  const ColorMixing = require('./color-mixing');
 *
 * 许可证：MIT License（仓库 LICENSE）。
 * =================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.ColorMixing = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* clamp01 — 公式的基础运算（内部使用） */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ===== PBM：颜料基混色（两阶段公式，论文 §3） =====
 * 阶段 1 K–M 混色核心（§3.3）：M₃ 宽带矩阵 → K/S 解析默认 → κ 浓度叠加
 *   → 互吸收 β → 有理 R∞ → M₃⁻¹；混色比例经 φ_core 端点压缩（φ 动态进度，§3.3）。
 * 阶段 2 修复层（§3.4）：λ 软角色分配（EW=0.08）→ 深白门 g = σₖ(w−0.3706)·σₖ(M)·σₖ(maxd−0.0656)
 *   （斜率共享 k=12.584001；带上沿已随迭代 13 惰性移除）→ 逐通道幂律目标 T
 *   （q = 软阶跃阶梯（B/G 族，t₁=0.0463/t₂=0.2493）+ RES 通道残差 + CPL/KC 耦合 + 族方向响应）
 *   → γ 谐波修正 γ̂(V)·cSat·(1−g)·4a(1−a)·h(a)（19 特征模板 × 27 系数，双侧色度软衰减）。
 * 指标（seed=20260808）：T5 2.407/6.1、T1 3.844、T2 3.244、T3 2.996、T5E 2.353/9.5、
 *   tail 1.713、留出 T3 2.895–3.066、T5-heldout 2.607；α=0/1 恒等、交换对称 3.3e-16。
 */
/* ===== PBM 优化参考实现（论文 §3；demo↔eval 逐位一致） =====
 * 与初版数值等价（max RGB diff 2.2e-16）；优化：M₃/M₃⁻¹ 手写展开、
 * φ 快速路径内联、幂律目标展开（去 pre 对象与逐通道函数调用）、
 * γ 谐波零贡献提前退出（cSat/hA/gSup）、倍角公式降三角次数（8→4）、
 * 通道值极值/色相 hue() 手写展开。 */
const mat3Inv = m => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det
  ];
};
const PBM_A = [Math.SQRT2, 1, 1 / (2 * Math.SQRT2)];
const PBM_M = [0.74523981, 0.30403013, -0.04926994, 0, 0.74093256, 0.25906744, 0, 0, 1];
const PBM_MI = mat3Inv(PBM_M);
const PBM_BETA = [-0.69372345, -0.48397409, -0.24977842];
const PBM_EPS = 0.00157634;
const PBM_PW_RES = [0, -0.25693718, -0.25693718];
const PBM_PW_CPL = 0.43251363, PBM_PW_KC = 4.86795929;
const PBM_PW_RD = [-0.28030789, -0.31011215, 0.33194666, -1.19791733, -0.45218018, 1.71390058];
const PBM_PW_RTH = 0.21929798;
const PBM_PW_BD_R = 0.40713961;
const PBM_PW_BD_G = [-0.08390816, 0.76274462];
const PBM_PW_GD_R = [-0.2367074, 0.72220875];
const PBM_PW_GD_B = [-0.30067864, 1.03098891];
const PBM_EW = 0.08;
const PBM_PHI_P = 2.31336, PBM_PHI_W = PBM_EW;
function phiLow(x) {
  if (x >= PBM_PHI_W) return x;
  const u = clamp(x / PBM_PHI_W, 0, 1);
  const ss0 = u * u * (3 - 2 * u);
  return (1 - ss0) * Math.pow(x, PBM_PHI_P) + ss0 * x;
}

function mixPbmCore(base, tint, a) {
  if (a <= 0) return base.slice();
  if (a >= 1) return tint.slice();
  if (a < 0.08) a = phiLow(a);
  else if (a > 0.92) a = 1 - phiLow(1 - a);
  const b0 = base[0], b1 = base[1], b2 = base[2];
  const t0 = tint[0], t1 = tint[1], t2 = tint[2];
  const vb0 = 0.74523981 * b0 + 0.30403013 * b1 - 0.04926994 * b2;
  const vb1 = 0.74093256 * b1 + 0.25906744 * b2;
  const vb2 = b2;
  const vt0 = 0.74523981 * t0 + 0.30403013 * t1 - 0.04926994 * t2;
  const vt1 = 0.74093256 * t1 + 0.25906744 * t2;
  const vt2 = t2;
  const ia = 1 - a;
  const kc = (x1, x2) => {
    const v1 = x1 < 0 ? 0 : x1 > 1 ? 1 : x1, v2 = x2 < 0 ? 0 : x2 > 1 ? 1 : x2;
    const K1 = 0.5 * (1 - v1) * (1 - v1), K2 = 0.5 * (1 - v2) * (1 - v2);
    const S1 = v1 > PBM_EPS ? v1 : PBM_EPS, S2 = v2 > PBM_EPS ? v2 : PBM_EPS;
    const kk = (K1 * ia + K2 * a) / (S1 * ia + S2 * a);
    return kk < 1e-6 ? 1e-6 : kk > 1e4 ? 1e4 : kk;
  };
  const k0 = kc(vb0, vt0), k1 = kc(vb1, vt1), k2 = kc(vb2, vt2);
  const r0 = Math.sqrt(k0), r1 = Math.sqrt(k1), r2 = Math.sqrt(k2);
  const s0 = r0 / (1 + r0), s1 = r1 / (1 + r1), s2 = r2 / (1 + r2);
  const w0 = Math.sqrt(clamp(k0 * (1 + PBM_BETA[0] * s1 * s2), 1e-6, 1e4));
  const w1 = Math.sqrt(clamp(k1 * (1 + PBM_BETA[1] * s0 * s2), 1e-6, 1e4));
  const w2 = Math.sqrt(clamp(k2 * (1 + PBM_BETA[2] * s0 * s1), 1e-6, 1e4));
  const o0 = 1 / (1 + w0 * (PBM_A[0] + w0 * (PBM_A[1] + w0 * PBM_A[2])));
  const o1 = 1 / (1 + w1 * (PBM_A[0] + w1 * (PBM_A[1] + w1 * PBM_A[2])));
  const o2 = 1 / (1 + w2 * (PBM_A[0] + w2 * (PBM_A[1] + w2 * PBM_A[2])));
  return [
    clamp(PBM_MI[0] * o0 + PBM_MI[1] * o1 + PBM_MI[2] * o2, 0, 1),
    clamp(PBM_MI[3] * o0 + PBM_MI[4] * o1 + PBM_MI[5] * o2, 0, 1),
    clamp(PBM_MI[6] * o0 + PBM_MI[7] * o1 + PBM_MI[8] * o2, 0, 1)
  ];
}

/* c01 = clamp01；ck = σₖ(k=12.584001)；c8 = σ₈ */
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const ck = x => { const t = x * 12.584001; return t < 0 ? 0 : t > 1 ? 1 : t; };
const c8 = x => { const t = x * 8; return t < 0 ? 0 : t > 1 ? 1 : t; };
const ssT = (x, lo, hi) => { const t = c01((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

function pbmPwTarget(pig, u, a) {
  if (a < PBM_PHI_W) { const uu = a / PBM_PHI_W; const ss0 = uu * uu * (3 - 2 * uu); a = (1 - ss0) * Math.pow(a, PBM_PHI_P) + ss0 * a; }
  const r = pig[0], g = pig[1], b = pig[2];
  const u0 = u[0], u1 = u[1], u2 = u[2];
  const gR = 0.5 * c8(r - g) + 0.5 * c8(r - b);
  const gG = 0.5 * c8(g - r) + 0.5 * c8(g - b);
  const gB = 0.5 * c8(b - r) + 0.5 * c8(b - g);
  const gRed = gR * c8(r - PBM_PW_RTH);
  const gSum = gR + gG + gB;
  const gInv = gSum > 1e-6 ? 1 / gSum : 0;
  const resE = v => { const t = v * 25; return t < 1 ? 0.9432 - 0.6219 * t : (t < 3 ? 0.4580 - 0.1494 * t : 0); };
  /* 通道 0（R） */
  const s1R = ck(r - 0.04633146), s2R = ck(r - 0.24928142);
  const pBvR = 0.88024633 + (0.33545176 - 0.88024633) * s1R + (0.19217412 - 0.33545176) * s2R;
  const pGvR = 0.57387051 + (0.596528 - 0.57387051) * s1R + (0.19217412 - 0.596528) * s2R;
  let q0 = gSum <= 1e-6 ? (1 + pBvR + pGvR) / 3 : (gB * pBvR + gG * pGvR + gR) * gInv;
  q0 += PBM_PW_CPL * c01(Math.max(g, b) * PBM_PW_KC);
  q0 += gRed * (PBM_PW_RD[0] + PBM_PW_RD[1] * r) + gB * PBM_PW_BD_R + gG * (PBM_PW_GD_R[0] + PBM_PW_GD_R[1] * r);
  /* 通道 1（G） */
  const s1G = ck(g - 0.04633146), s2G = ck(g - 0.24928142);
  const pBvG = 0.88024633 + (0.33545176 - 0.88024633) * s1G + (0.19217412 - 0.33545176) * s2G;
  const pGvG = 0.57387051 + (0.596528 - 0.57387051) * s1G + (0.19217412 - 0.596528) * s2G;
  let q1 = gSum <= 1e-6 ? (1 + pBvG + pGvG) / 3 : (gB * pBvG + gG * pGvG + gR) * gInv;
  q1 += PBM_PW_RES[1] * resE(g);
  q1 += PBM_PW_CPL * c01(Math.max(r, b) * PBM_PW_KC);
  q1 += gRed * (PBM_PW_RD[2] + PBM_PW_RD[3] * g) + gB * (PBM_PW_BD_G[0] + PBM_PW_BD_G[1] * g);
  /* 通道 2（B） */
  const s1B = ck(b - 0.04633146), s2B = ck(b - 0.24928142);
  const pBvB = 0.88024633 + (0.33545176 - 0.88024633) * s1B + (0.19217412 - 0.33545176) * s2B;
  const pGvB = 0.57387051 + (0.596528 - 0.57387051) * s1B + (0.19217412 - 0.596528) * s2B;
  let q2 = gSum <= 1e-6 ? (1 + pBvB + pGvB) / 3 : (gB * pBvB + gG * pGvB + gR) * gInv;
  q2 += PBM_PW_RES[2] * resE(b);
  q2 += PBM_PW_CPL * c01(Math.max(r, g) * PBM_PW_KC);
  q2 += gRed * (PBM_PW_RD[4] + PBM_PW_RD[5] * g) + gG * (PBM_PW_GD_B[0] + PBM_PW_GD_B[1] * g);
  return [r + (u0 - r) * Math.pow(a, q0), g + (u1 - g) * Math.pow(a, q1), b + (u2 - b) * Math.pow(a, q2)];
}

function pbmRepairDelta(pig, u, aEff, C) {
  const r = pig[0], g = pig[1], b = pig[2];
  const u0 = u[0], u1 = u[1], u2 = u[2];
  const M = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const maxd = M - mn;
  const wu = u0 < u1 ? (u0 < u2 ? u0 : u2) : (u1 < u2 ? u1 : u2);
  const w = (mn > wu ? mn : wu);
  const gate = ck(w - 0.3706311) * ck(M) * ck(maxd - 0.06556298);
  let d0 = 0, d1 = 0, d2 = 0;
  if (gate > 1e-6) {
    const t = pbmPwTarget(pig, u, aEff);
    d0 = gate * (t[0] - C[0]); d1 = gate * (t[1] - C[1]); d2 = gate * (t[2] - C[2]);
  }
  /* γ 谐波修正（§3.4）：γ̂(V)·cSat·(1−gate)·4a(1−a)·h(a)；零贡献提前退出 */
  const gSup = 1 - gate;
  const hA = c01(14 * (0.845 - aEff));
  const um = u0 > u1 ? (u0 > u2 ? u0 : u2) : (u1 > u2 ? u1 : u2);
  const cSat = ssT(M - mn, 0.02, 0.15) * ssT(um - wu, 0.08, 0.30);
  if (gSup > 1e-9 && hA > 1e-9 && cSat > 1e-9) {
    const gm = 4 * aEff * (1 - aEff) * cSat * gSup * hA;
    const hueOf = (v0, v1, v2) => {
      const mx = v0 > v1 ? (v0 > v2 ? v0 : v2) : (v1 > v2 ? v1 : v2);
      const mnn = v0 < v1 ? (v0 < v2 ? v0 : v2) : (v1 < v2 ? v1 : v2);
      if (mx - mnn < 1e-9) return 0;
      let h;
      if (mx === v0) h = 60 * ((v1 - v2) / (mx - mnn));
      else if (mx === v1) h = 60 * (2 + (v2 - v0) / (mx - mnn));
      else h = 60 * (4 + (v0 - v1) / (mx - mnn));
      return h < 0 ? h + 360 : h;
    };
    const hp = hueOf(r, g, b), hu = hueOf(u0, u1, u2);
    const A = Math.PI / 180;
    const shp = Math.sin(A * hp), chp = Math.cos(A * hp);
    const shu = Math.sin(A * hu), chu = Math.cos(A * hu);
    const s2hp = 2 * shp * chp, c2hp = 2 * chp * chp - 1;
    const s3hp = shp * (3 - 4 * shp * shp), c3hp = chp * (4 * chp * chp - 3);
    const s2hu = 2 * shu * chu, c2hu = 2 * chu * chu - 1;
    const logu = Math.log(u0 + 0.01);
    const s1hu_pm = shu * c01((M - 0.30) * 12.584);
    const gRp = 0.5 * c8(r - g) + 0.5 * c8(r - b);
    const gBp = 0.5 * c8(b - r) + 0.5 * c8(b - g);
    const gRu = 0.5 * c8(u0 - u1) + 0.5 * c8(u0 - u2);
    const wUcP = (u0 - u2) * (b - r);
    const dcAbs = u0 > r ? u0 - r : r - u0;
    d0 += (-0.07339164 + -0.085953 * gBp + 0.1295769 * wu + -0.04714988 * s2hp + 0.12208017 * M + -0.00677685 * logu + -0.03406281 * shu + 0.01174257 * s3hp + 0.02505266 * s1hu_pm + 0.0360914 * gRp + -0.04872395 * r) * gm;
    d1 += (-0.04704706 + 0.10921572 * wu + -0.06204143 * gRp + -0.02021518 * c2hp + 0.05506322 * um + 0.00698984 * s2hu) * gm;
    d2 += (-0.04887766 + 0.09651812 * wu + -0.07000325 * mn + 0.02119207 * c3hp + 0.08138486 * um + -0.06336064 * M + 0.01773538 * c2hu + -0.09771287 * wUcP + 0.0736705 * dcAbs + -0.03704948 * gRu) * gm;
  }
  return [d0, d1, d2];
}

function pbmRepairLayer(base, tint, a, C) {
  const mB = Math.max(base[0], base[1], base[2]);
  const mT = Math.max(tint[0], tint[1], tint[2]);
  const te = clamp((mT - mB + PBM_EW) / (2 * PBM_EW), 0, 1);
  if (te <= 0) return pbmRepairDelta(tint, base, 1 - a, C);
  if (te >= 1) return pbmRepairDelta(base, tint, a, C);
  const lambda = te * te * (3 - 2 * te);
  const dA = pbmRepairDelta(base, tint, a, C);
  const dB = pbmRepairDelta(tint, base, 1 - a, C);
  return [lambda * dA[0] + (1 - lambda) * dB[0], lambda * dA[1] + (1 - lambda) * dB[1], lambda * dA[2] + (1 - lambda) * dB[2]];
}

function mixPbm(base, tint, a) {
  if (a <= 0) return base.slice();
  if (a >= 1) return tint.slice();
  const C = mixPbmCore(base, tint, a);
  const d = pbmRepairLayer(base, tint, a, C);
  return [clamp(C[0] + d[0], 0, 1), clamp(C[1] + d[1], 0, 1), clamp(C[2] + d[2], 0, 1)];
}

  return {
    /* ---- PBM 混色公式（主入口：mixPbm(base, tint, a) → [r,g,b] sRGB [0,1]） ---- */
    mixPbm: mixPbm,
    mixPigment: mixPbm,
    mixPbmCore: mixPbmCore,
    pbmPwTarget: pbmPwTarget,
    pbmRepairDelta: pbmRepairDelta,
    pbmRepairLayer: pbmRepairLayer,
    phiLow: phiLow,
    /* ---- 模型常量（单一事实源；python/java/cpp 实现逐位一致） ---- */
    PBM_A: PBM_A, PBM_M: PBM_M, PBM_MI: PBM_MI, PBM_BETA: PBM_BETA,
    PBM_EPS: PBM_EPS, PBM_PW_RES: PBM_PW_RES, PBM_PW_CPL: PBM_PW_CPL,
    PBM_PW_KC: PBM_PW_KC, PBM_PW_RD: PBM_PW_RD, PBM_PW_RTH: PBM_PW_RTH,
    PBM_PW_BD_R: PBM_PW_BD_R, PBM_PW_BD_G: PBM_PW_BD_G,
    PBM_PW_GD_R: PBM_PW_GD_R, PBM_PW_GD_B: PBM_PW_GD_B,
    PBM_EW: PBM_EW, PBM_PHI_P: PBM_PHI_P, PBM_PHI_W: PBM_PHI_W
  };
}));
