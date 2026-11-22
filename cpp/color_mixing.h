// color_mixing.h — PBM 颜料基混色算法（C++ 实现，仅混色公式，header-only）
//
// 只含论文 §3 两阶段混色公式（K–M 核心 + 修复层）；不含任何验证/测试
// 代码（一致性测试 CLI 在 tools/cli/，评测在 tools/）。
//
// 与 javascript/color-mixing.js 的 mixPbm 数值等价（IEEE 754 double，
// 运算顺序一致；libm 差异 ΔE00 < 1e-6 量级）。参数（PBM_A/PBM_M/
// PBM_BETA/PBM_EPS/PBM_PW_* 等）与 JS 单一事实源逐位一致。
//
// 优化（对齐 JS 优化参考实现）：
//   - M₃/M₃⁻¹ 手写展开（PBM_MI inline 常量，仅初始化一次）
//   - φ 端点压缩快速路径内联（phi_low）
//   - 幂律目标展开（无 pre 对象、无逐通道 lambda；q 表达式直接展开）
//   - K/S 叠加 kc 外提为带参 inline 函数（去闭包开销）
//   - γ 谐波零贡献提前退出（cSat/hA/gSup 门）
//   - γ 谐波改用无三角比值特征（消去 4 次三角函数与 1 次 log）；resE 改二次包络（C1）
//   - 全部函数 inline + 值语义 std::array（无动态分配）
//
// 用法：
//   #include "color_mixing.h"
//   std::array<double,3> out = color_mixing::mix_pbm(
//       {0.988, 0.827, 0.0}, {0.0, 0.129, 0.522}, 0.5);
//
// 许可证：MIT License（仓库 LICENSE）。
#pragma once

#include <array>
#include <cmath>

namespace color_mixing {

// ---- 参数（单一事实源：javascript/color-mixing.js，勿单独修改） ----
inline const std::array<double, 3> PBM_A{{std::sqrt(2.0), 1.0, 1.0 / (2.0 * std::sqrt(2.0))}};
inline const std::array<double, 9> PBM_M{{0.74523981, 0.30403013, -0.04926994, 0.0, 0.74093256, 0.25906744, 0.0, 0.0, 1.0}};
inline const std::array<double, 3> PBM_BETA{{-0.69372345, -0.48397409, -0.24977842}};
inline constexpr double PBM_EPS = 0.00157634;
inline const std::array<double, 3> PBM_PW_RES{{0.0, -0.24164942, -0.24164942}};
inline constexpr double PBM_PW_CPL = 0.42818849;
inline constexpr double PBM_PW_KC = 4.13539205;
inline const std::array<double, 6> PBM_PW_RD{{-0.28030789, -0.31011215, 0.33194666, -1.19791733, -0.45218018, 1.71390058}};
inline constexpr double PBM_PW_RTH = 0.21929798;
inline constexpr double PBM_PW_BD_R = 0.40713961;
inline const std::array<double, 2> PBM_PW_BD_G{{-0.08390816, 0.76274462}};
inline const std::array<double, 2> PBM_PW_GD_R{{-0.2367074, 0.72220875}};
inline const std::array<double, 2> PBM_PW_GD_B{{-0.30067864, 1.03098891}};
inline constexpr double PBM_EW = 0.08;
inline constexpr double PBM_PHI_P = 1.96522814;
inline constexpr double PBM_PHI_W = PBM_EW;

using Vec3 = std::array<double, 3>;

inline std::array<double, 9> mat3_inv(const std::array<double, 9>& m) {
  const double a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const double A = e * i - f * h;
  const double B = -(d * i - f * g);
  const double C = d * h - e * g;
  const double det = a * A + b * B + c * C;
  return {{
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det
  }};
}

inline const std::array<double, 9> PBM_MI = mat3_inv(PBM_M);

inline double clamp(double v, double lo, double hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

inline double c01(double x) {
  return x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x);
}

inline double ck(double x) {
  const double t = x * 11.01639450;
  return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
}

inline double c8(double x) {
  const double t = x * 8.0;
  return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
}

inline double ssT(double x, double lo, double hi) {
  const double t = c01((x - lo) / (hi - lo));
  return t * t * (3.0 - 2.0 * t);
}

inline double phi_low(double x) {
  if (x >= PBM_PHI_W) return x;
  const double u = clamp(x / PBM_PHI_W, 0.0, 1.0);
  const double ss0 = u * u * (3.0 - 2.0 * u);
  return (1.0 - ss0) * std::pow(x, PBM_PHI_P) + ss0 * x;
}

inline double kc(double x1, double x2, double ia, double aa) {
  const double v1 = x1 < 0.0 ? 0.0 : (x1 > 1.0 ? 1.0 : x1);
  const double v2 = x2 < 0.0 ? 0.0 : (x2 > 1.0 ? 1.0 : x2);
  const double K1 = 0.5 * (1.0 - v1) * (1.0 - v1);
  const double K2 = 0.5 * (1.0 - v2) * (1.0 - v2);
  const double S1 = v1 > PBM_EPS ? v1 : PBM_EPS;
  const double S2 = v2 > PBM_EPS ? v2 : PBM_EPS;
  double kk = (K1 * ia + K2 * aa) / (S1 * ia + S2 * aa);
  if (kk < 1e-6) return 1e-6;
  if (kk > 1e4) return 1e4;
  return kk;
}

inline double resE(double v) {
  const double u = 1.0 - v / 0.14196781;
  return u > 0.0 ? 0.83421324 * u * u : 0.0;
}

// ---- K–M 混色核心（论文 §3.3）。入参/出参均为 sRGB 浮点 [0,1]。 ----
inline Vec3 mix_pbm_core(const Vec3& base, const Vec3& tint, double a) {
  if (a <= 0.0) return base;
  if (a >= 1.0) return tint;
  if (a < 0.08) a = phi_low(a);
  else if (a > 0.92) a = 1.0 - phi_low(1.0 - a);
  const double b0 = base[0], b1 = base[1], b2 = base[2];
  const double t0 = tint[0], t1 = tint[1], t2 = tint[2];
  const double vb0 = 0.74523981 * b0 + 0.30403013 * b1 - 0.04926994 * b2;
  const double vb1 = 0.74093256 * b1 + 0.25906744 * b2;
  const double vb2 = b2;
  const double vt0 = 0.74523981 * t0 + 0.30403013 * t1 - 0.04926994 * t2;
  const double vt1 = 0.74093256 * t1 + 0.25906744 * t2;
  const double vt2 = t2;
  const double ia = 1.0 - a;
  const double k0 = kc(vb0, vt0, ia, a), k1 = kc(vb1, vt1, ia, a), k2 = kc(vb2, vt2, ia, a);
  const double r0 = std::sqrt(k0), r1 = std::sqrt(k1), r2 = std::sqrt(k2);
  const double s0 = r0 / (1.0 + r0), s1 = r1 / (1.0 + r1), s2 = r2 / (1.0 + r2);
  const double w0 = std::sqrt(clamp(k0 * (1.0 + PBM_BETA[0] * s1 * s2), 1e-6, 1e4));
  const double w1 = std::sqrt(clamp(k1 * (1.0 + PBM_BETA[1] * s0 * s2), 1e-6, 1e4));
  const double w2 = std::sqrt(clamp(k2 * (1.0 + PBM_BETA[2] * s0 * s1), 1e-6, 1e4));
  const double o0 = 1.0 / (1.0 + w0 * (PBM_A[0] + w0 * (PBM_A[1] + w0 * PBM_A[2])));
  const double o1 = 1.0 / (1.0 + w1 * (PBM_A[0] + w1 * (PBM_A[1] + w1 * PBM_A[2])));
  const double o2 = 1.0 / (1.0 + w2 * (PBM_A[0] + w2 * (PBM_A[1] + w2 * PBM_A[2])));
  return {{
    clamp(PBM_MI[0] * o0 + PBM_MI[1] * o1 + PBM_MI[2] * o2, 0.0, 1.0),
    clamp(PBM_MI[3] * o0 + PBM_MI[4] * o1 + PBM_MI[5] * o2, 0.0, 1.0),
    clamp(PBM_MI[6] * o0 + PBM_MI[7] * o1 + PBM_MI[8] * o2, 0.0, 1.0)
  }};
}

inline Vec3 pbm_pw_target(const Vec3& pig, const Vec3& u, double a) {
  if (a < PBM_PHI_W) {
    const double uu = a / PBM_PHI_W;
    const double ss0 = uu * uu * (3.0 - 2.0 * uu);
    a = (1.0 - ss0) * std::pow(a, PBM_PHI_P) + ss0 * a;
  }
  const double r = pig[0], g = pig[1], b = pig[2];
  const double u0 = u[0], u1 = u[1], u2 = u[2];
  const double gR = 0.5 * c8(r - g) + 0.5 * c8(r - b);
  const double gG = 0.5 * c8(g - r) + 0.5 * c8(g - b);
  const double gB = 0.5 * c8(b - r) + 0.5 * c8(b - g);
  const double gRed = gR * c8(r - PBM_PW_RTH);
  const double gSum = gR + gG + gB;
  const double gInv = gSum > 1e-6 ? 1.0 / gSum : 0.0;
  const double resE0 = resE(g), resE2 = resE(b);

  const double s1R = ck(r - 0.04350222), s2R = ck(r - 0.26436295);
  const double pBvR = 0.91483121 + (0.32538955 - 0.91483121) * s1R + (0.18785981 - 0.32538955) * s2R;
  const double pGvR = 0.57387051 + (0.596528 - 0.57387051) * s1R + (0.18785981 - 0.596528) * s2R;
  double q0 = gSum <= 1e-6 ? (1.0 + pBvR + pGvR) / 3.0 : (gB * pBvR + gG * pGvR + gR) * gInv;
  q0 += PBM_PW_CPL * c01(std::max(g, b) * PBM_PW_KC);
  q0 += gRed * (PBM_PW_RD[0] + PBM_PW_RD[1] * r) + gB * PBM_PW_BD_R + gG * (PBM_PW_GD_R[0] + PBM_PW_GD_R[1] * r);

  const double s1G = ck(g - 0.04350222), s2G = ck(g - 0.26436295);
  const double pBvG = 0.91483121 + (0.32538955 - 0.91483121) * s1G + (0.18785981 - 0.32538955) * s2G;
  const double pGvG = 0.57387051 + (0.596528 - 0.57387051) * s1G + (0.18785981 - 0.596528) * s2G;
  double q1 = gSum <= 1e-6 ? (1.0 + pBvG + pGvG) / 3.0 : (gB * pBvG + gG * pGvG + gR) * gInv;
  q1 += PBM_PW_RES[1] * resE0;
  q1 += PBM_PW_CPL * c01(std::max(r, b) * PBM_PW_KC);
  q1 += gRed * (PBM_PW_RD[2] + PBM_PW_RD[3] * g) + gB * (PBM_PW_BD_G[0] + PBM_PW_BD_G[1] * g);

  const double s1B = ck(b - 0.04350222), s2B = ck(b - 0.26436295);
  const double pBvB = 0.91483121 + (0.32538955 - 0.91483121) * s1B + (0.18785981 - 0.32538955) * s2B;
  const double pGvB = 0.57387051 + (0.596528 - 0.57387051) * s1B + (0.18785981 - 0.596528) * s2B;
  double q2 = gSum <= 1e-6 ? (1.0 + pBvB + pGvB) / 3.0 : (gB * pBvB + gG * pGvB + gR) * gInv;
  q2 += PBM_PW_RES[2] * resE2;
  q2 += PBM_PW_CPL * c01(std::max(r, g) * PBM_PW_KC);
  q2 += gRed * (PBM_PW_RD[4] + PBM_PW_RD[5] * g) + gG * (PBM_PW_GD_B[0] + PBM_PW_GD_B[1] * g);

  return {{
    r + (u0 - r) * std::pow(a, q0),
    g + (u1 - g) * std::pow(a, q1),
    b + (u2 - b) * std::pow(a, q2)
  }};
}
// ---- 修复层（论文 §3.4）：γ 谐波改用无三角比值特征 ----

inline Vec3 pbm_repair_delta(const Vec3& pig, const Vec3& u, double a_eff, const Vec3& C) {
  const double r = pig[0], g = pig[1], b = pig[2];
  const double u0 = u[0], u1 = u[1], u2 = u[2];
  const double M = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const double mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const double maxd = M - mn;
  const double wu = u0 < u1 ? (u0 < u2 ? u0 : u2) : (u1 < u2 ? u1 : u2);
  const double w = mn > wu ? mn : wu;
  const double gate = ck(w - 0.37375181) * ck(M) * ck(maxd - 0.06479933);
  double d0 = 0.0, d1 = 0.0, d2 = 0.0;
  if (gate > 1e-6) {
    const Vec3 t = pbm_pw_target(pig, u, a_eff);
    d0 = gate * (t[0] - C[0]);
    d1 = gate * (t[1] - C[1]);
    d2 = gate * (t[2] - C[2]);
  }
  const double gSup = 1.0 - gate;
  const double hA = c01(14.0 * (0.845 - a_eff));
  const double um = u0 > u1 ? (u0 > u2 ? u0 : u2) : (u1 > u2 ? u1 : u2);
  const double cSat = ssT(M - mn, 0.02, 0.15) * ssT(um - wu, 0.08, 0.30);
  if (gSup > 1e-9 && hA > 1e-9 && cSat > 1e-9) {
    const double gm = 4.0 * a_eff * (1.0 - a_eff) * cSat * gSup * hA;
    const double gRp = 0.5 * c8(r - g) + 0.5 * c8(r - b);
    const double gBp = 0.5 * c8(b - r) + 0.5 * c8(b - g);
    const double gRu = 0.5 * c8(u0 - u1) + 0.5 * c8(u0 - u2);
    const double PC = std::max(M - mn, 1e-6), UC = std::max(um - wu, 1e-6);
    const double DR = (r - b) / PC, DG = (g - b) / PC, DCM = (r - g) / PC;
    const double UR = (u0 - u2) / UC, UG = (u1 - u2) / UC, UCM = (u0 - u1) / UC;
    const double wUcP = (u0 - u2) * (b - r);
    const double dcAbs = u0 > r ? u0 - r : r - u0;
    const double LUM = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const double LUMU = 0.2126 * u0 + 0.7152 * u1 + 0.0722 * u2;
    const double SPAN = (M - mn) * (um - wu);
    const double OP = 1 - ((M - mn) + (um - wu)) / 2;
    d0 += (- 0.24945965002914949 * 1 - 0.0045889906868631708 * LUM + 0.0041513551994266139 * (DG * UG) - 0.037580595706759645 * (DCM * UCM) + 0.05450569803891276 * wUcP + 0.099893445837378303 * u2 + 0.25226194627256282 * M + 0.023210943937834599 * DG + 0.15029393775777919 * OP + 0.032309012528158876 * SPAN + 0.030058192159529883 * (DR * UR) + 0.34621806773454422 * mn - 0.57046215673962131 * (M * mn) - 0.0027456565141784021 * LUMU + 0.032089971951832885 * UR - 0.053136286490094019 * dcAbs - 0.029410711164283156 * gRu) * gm;
    d1 += (- 0.15650536547935953 * 1 + 0.14061150179766091 * LUM - 0.036203528266390395 * (DG * UG) + 0.037350636144765727 * (DCM * UCM) + 0.021745829109720165 * wUcP + 0.023816133495222817 * u2 - 0.064813043910525822 * M - 0.020272883681938206 * DG + 0.1385172056042358 * OP + 0.13327491711885181 * SPAN + 0.012698288999900342 * (DR * UR) + 0.037681776121840031 * mn - 0.055585822793579612 * (M * mn) + 0.037689443255939002 * LUMU + 0.015054100789579432 * UR + 0.021801163240957828 * dcAbs - 0.017675820505782546 * gRu) * gm;
    d2 += (+ 0.16757082268978754 * 1 - 0.043737477412635554 * LUM + 0.02221282183541292 * (DG * UG) - 0.02131140334204034 * (DCM * UCM) - 0.088939482811690521 * wUcP + 0.059736090003303446 * u2 - 0.093244625666860398 * M - 0.0024207237712253484 * DG - 0.118897820628014 * OP - 0.0806668864815685 * SPAN - 0.018813447483138224 * (DR * UR) - 0.40457566738392031 * mn + 0.51586854870254917 * (M * mn) - 0.018553588391455163 * LUMU + 0.033909706606359974 * UR - 0.018071468054222248 * dcAbs - 0.041487499442177063 * gRu) * gm;
  }
  return {{d0, d1, d2}};
}

inline Vec3 pbm_repair_layer(const Vec3& base, const Vec3& tint, double a, const Vec3& C) {
  const double mB = std::max(base[0], std::max(base[1], base[2]));
  const double mT = std::max(tint[0], std::max(tint[1], tint[2]));
  const double te = clamp((mT - mB + PBM_EW) / (2.0 * PBM_EW), 0.0, 1.0);
  if (te <= 0.0) return pbm_repair_delta(tint, base, 1.0 - a, C);
  if (te >= 1.0) return pbm_repair_delta(base, tint, a, C);
  const double lam = te * te * (3.0 - 2.0 * te);
  const Vec3 dA = pbm_repair_delta(base, tint, a, C);
  const Vec3 dB = pbm_repair_delta(tint, base, 1.0 - a, C);
  return {{
    lam * dA[0] + (1.0 - lam) * dB[0],
    lam * dA[1] + (1.0 - lam) * dB[1],
    lam * dA[2] + (1.0 - lam) * dB[2]
  }};
}

// ---- PBM 主入口：mix_pbm(base, tint, a) → [r,g,b]（sRGB [0,1]）。 ----
inline Vec3 mix_pbm(const Vec3& base, const Vec3& tint, double a) {
  if (a <= 0.0) return base;
  if (a >= 1.0) return tint;
  const Vec3 C = mix_pbm_core(base, tint, a);
  const Vec3 d = pbm_repair_layer(base, tint, a, C);
  return {{
    clamp(C[0] + d[0], 0.0, 1.0),
    clamp(C[1] + d[1], 0.0, 1.0),
    clamp(C[2] + d[2], 0.0, 1.0)
  }};
}

} // namespace color_mixing