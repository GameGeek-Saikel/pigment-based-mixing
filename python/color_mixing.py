# -*- coding: utf-8 -*-
"""color_mixing.py — PBM 颜料基混色算法（Python 实现，仅混色公式）

只含论文 §3 两阶段混色公式（K–M 核心 + 修复层）；不含任何验证/测试
代码（一致性测试 CLI 在 tools/cli/，评测在 tools/）。

与 javascript/color-mixing.js 的 mixPbm 数值等价（IEEE 754 double，
运算顺序一致；libm 差异 ΔE00 < 1e-6 量级）。参数（PBM_A/PBM_M/
PBM_BETA/PBM_EPS/PBM_PW_* 等）与 JS 单一事实源逐位一致。

优化（对齐 JS 优化参考实现）：
  - M₃/M₃⁻¹ 手写展开（PBM_MI 模块级预计算一次）
  - φ 端点压缩快速路径内联（phi_low）
  - 幂律目标展开（无 pre 对象、无逐通道闭包；q 表达式直接展开）
  - K/S 叠加 kc 外提为带参模块函数（去闭包开销）
  - γ 谐波零贡献提前退出（cSat/hA/gSup 门）
  - γ 谐波改用无三角比值特征（消去 4 次三角函数与 1 次 log）；resE 改二次包络（C1）
  - 热路径常量局部化（PBM_A 通道系数）

用法（库）：
    import color_mixing as cm
    out = cm.mix_pbm([0.988, 0.827, 0.0], [0.0, 0.129, 0.522], 0.5)

许可证：MIT License（仓库 LICENSE）。
"""

import math

# ---- 参数（单一事实源：javascript/color-mixing.js，勿单独修改） ----
PBM_A = [math.sqrt(2.0), 1.0, 1.0 / (2.0 * math.sqrt(2.0))]
PBM_M = [0.74523981, 0.30403013, -0.04926994, 0.0, 0.74093256, 0.25906744, 0.0, 0.0, 1.0]
PBM_BETA = [-0.69372345, -0.48397409, -0.24977842]
PBM_EPS = 0.00157634
PBM_PW_RES = [0.0, -0.24164942, -0.24164942]
PBM_PW_CPL = 0.42818849
PBM_PW_KC = 4.13539205
PBM_PW_RD = [-0.28030789, -0.31011215, 0.33194666, -1.19791733, -0.45218018, 1.71390058]
PBM_PW_RTH = 0.21929798
PBM_PW_BD_R = 0.40713961
PBM_PW_BD_G = [-0.08390816, 0.76274462]
PBM_PW_GD_R = [-0.2367074, 0.72220875]
PBM_PW_GD_B = [-0.30067864, 1.03098891]
PBM_EW = 0.08
PBM_PHI_P = 1.96522814
PBM_PHI_W = PBM_EW


def _mat3_inv(m):
    a, b, c, d, e, f, g, h, i = m
    A = e * i - f * h
    B = -(d * i - f * g)
    C = d * h - e * g
    det = a * A + b * B + c * C
    return [
        A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
        B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
        C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
    ]


PBM_MI = _mat3_inv(PBM_M)


def _clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def _c01(x):
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def _ck(x):
    t = x * 11.01639450
    return 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)


def _c8(x):
    t = x * 8.0
    return 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)


def _ssT(x, lo, hi):
    t = _c01((x - lo) / (hi - lo))
    return t * t * (3.0 - 2.0 * t)


def _kc(x1, x2, ia, aa):
    """K/S 浓度叠加（core 内联，闭包外提为带参函数避免逐调用闭包开销）"""
    v1 = 0.0 if x1 < 0.0 else (1.0 if x1 > 1.0 else x1)
    v2 = 0.0 if x2 < 0.0 else (1.0 if x2 > 1.0 else x2)
    K1 = 0.5 * (1.0 - v1) * (1.0 - v1)
    K2 = 0.5 * (1.0 - v2) * (1.0 - v2)
    S1 = v1 if v1 > PBM_EPS else PBM_EPS
    S2 = v2 if v2 > PBM_EPS else PBM_EPS
    kk = (K1 * ia + K2 * aa) / (S1 * ia + S2 * aa)
    if kk < 1e-6:
        return 1e-6
    if kk > 1e4:
        return 1e4
    return kk


def phi_low(x):
    if x >= PBM_PHI_W:
        return x
    u = _clamp(x / PBM_PHI_W, 0.0, 1.0)
    ss0 = u * u * (3.0 - 2.0 * u)
    return (1.0 - ss0) * math.pow(x, PBM_PHI_P) + ss0 * x


def mix_pbm_core(base, tint, a):
    if a <= 0.0:
        return base[:]
    if a >= 1.0:
        return tint[:]
    if a < 0.08:
        a = phi_low(a)
    elif a > 0.92:
        a = 1.0 - phi_low(1.0 - a)
    b0, b1, b2 = base
    t0, t1, t2 = tint
    vb0 = 0.74523981 * b0 + 0.30403013 * b1 - 0.04926994 * b2
    vb1 = 0.74093256 * b1 + 0.25906744 * b2
    vb2 = b2
    vt0 = 0.74523981 * t0 + 0.30403013 * t1 - 0.04926994 * t2
    vt1 = 0.74093256 * t1 + 0.25906744 * t2
    vt2 = t2
    ia = 1.0 - a

    k0 = _kc(vb0, vt0, ia, a)
    k1 = _kc(vb1, vt1, ia, a)
    k2 = _kc(vb2, vt2, ia, a)
    r0 = math.sqrt(k0)
    r1 = math.sqrt(k1)
    r2 = math.sqrt(k2)
    s0 = r0 / (1.0 + r0)
    s1 = r1 / (1.0 + r1)
    s2 = r2 / (1.0 + r2)
    w0 = math.sqrt(_clamp(k0 * (1.0 + PBM_BETA[0] * s1 * s2), 1e-6, 1e4))
    w1 = math.sqrt(_clamp(k1 * (1.0 + PBM_BETA[1] * s0 * s2), 1e-6, 1e4))
    w2 = math.sqrt(_clamp(k2 * (1.0 + PBM_BETA[2] * s0 * s1), 1e-6, 1e4))
    a0, a1, a2 = PBM_A[0], PBM_A[1], PBM_A[2]  # 热路径常量局部化
    o0 = 1.0 / (1.0 + w0 * (a0 + w0 * (a1 + w0 * a2)))
    o1 = 1.0 / (1.0 + w1 * (a0 + w1 * (a1 + w1 * a2)))
    o2 = 1.0 / (1.0 + w2 * (a0 + w2 * (a1 + w2 * a2)))
    return [
        _clamp(PBM_MI[0] * o0 + PBM_MI[1] * o1 + PBM_MI[2] * o2, 0.0, 1.0),
        _clamp(PBM_MI[3] * o0 + PBM_MI[4] * o1 + PBM_MI[5] * o2, 0.0, 1.0),
        _clamp(PBM_MI[6] * o0 + PBM_MI[7] * o1 + PBM_MI[8] * o2, 0.0, 1.0),
    ]


def pbm_pw_target(pig, u, a):
    if a < PBM_PHI_W:
        uu = a / PBM_PHI_W
        ss0 = uu * uu * (3.0 - 2.0 * uu)
        a = (1.0 - ss0) * math.pow(a, PBM_PHI_P) + ss0 * a
    r, g, b = pig
    u0, u1, u2 = u
    gR = 0.5 * _c8(r - g) + 0.5 * _c8(r - b)
    gG = 0.5 * _c8(g - r) + 0.5 * _c8(g - b)
    gB = 0.5 * _c8(b - r) + 0.5 * _c8(b - g)
    gRed = gR * _c8(r - PBM_PW_RTH)
    gSum = gR + gG + gB
    gInv = 1.0 / gSum if gSum > 1e-6 else 0.0

    def resE(v):
        u = 1.0 - v / 0.14196781
        return 0.83421324 * u * u if u > 0.0 else 0.0

    s1R = _ck(r - 0.04350222)
    s2R = _ck(r - 0.26436295)
    pBvR = 0.91483121 + (0.32538955 - 0.91483121) * s1R + (0.18785981 - 0.32538955) * s2R
    pGvR = 0.57387051 + (0.596528 - 0.57387051) * s1R + (0.18785981 - 0.596528) * s2R
    q0 = (1.0 + pBvR + pGvR) / 3.0 if gSum <= 1e-6 else (gB * pBvR + gG * pGvR + gR) * gInv
    q0 += PBM_PW_CPL * _c01(max(g, b) * PBM_PW_KC)
    q0 += gRed * (PBM_PW_RD[0] + PBM_PW_RD[1] * r) + gB * PBM_PW_BD_R + gG * (PBM_PW_GD_R[0] + PBM_PW_GD_R[1] * r)

    s1G = _ck(g - 0.04350222)
    s2G = _ck(g - 0.26436295)
    pBvG = 0.91483121 + (0.32538955 - 0.91483121) * s1G + (0.18785981 - 0.32538955) * s2G
    pGvG = 0.57387051 + (0.596528 - 0.57387051) * s1G + (0.18785981 - 0.596528) * s2G
    q1 = (1.0 + pBvG + pGvG) / 3.0 if gSum <= 1e-6 else (gB * pBvG + gG * pGvG + gR) * gInv
    q1 += PBM_PW_RES[1] * resE(g)
    q1 += PBM_PW_CPL * _c01(max(r, b) * PBM_PW_KC)
    q1 += gRed * (PBM_PW_RD[2] + PBM_PW_RD[3] * g) + gB * (PBM_PW_BD_G[0] + PBM_PW_BD_G[1] * g)

    s1B = _ck(b - 0.04350222)
    s2B = _ck(b - 0.26436295)
    pBvB = 0.91483121 + (0.32538955 - 0.91483121) * s1B + (0.18785981 - 0.32538955) * s2B
    pGvB = 0.57387051 + (0.596528 - 0.57387051) * s1B + (0.18785981 - 0.596528) * s2B
    q2 = (1.0 + pBvB + pGvB) / 3.0 if gSum <= 1e-6 else (gB * pBvB + gG * pGvB + gR) * gInv
    q2 += PBM_PW_RES[2] * resE(b)
    q2 += PBM_PW_CPL * _c01(max(r, g) * PBM_PW_KC)
    q2 += gRed * (PBM_PW_RD[4] + PBM_PW_RD[5] * g) + gG * (PBM_PW_GD_B[0] + PBM_PW_GD_B[1] * g)

    return [r + (u0 - r) * math.pow(a, q0), g + (u1 - g) * math.pow(a, q1), b + (u2 - b) * math.pow(a, q2)]


def pbm_repair_delta(pig, u, a_eff, C):
    r, g, b = pig
    u0, u1, u2 = u
    M = max(r, g, b)
    mn = min(r, g, b)
    maxd = M - mn
    wu = min(u0, u1, u2)
    w = max(mn, wu)
    gate = _ck(w - 0.37375181) * _ck(M) * _ck(maxd - 0.06479933)
    d0 = 0.0
    d1 = 0.0
    d2 = 0.0
    if gate > 1e-6:
        t = pbm_pw_target(pig, u, a_eff)
        d0 = gate * (t[0] - C[0])
        d1 = gate * (t[1] - C[1])
        d2 = gate * (t[2] - C[2])
    gSup = 1.0 - gate
    hA = _c01(14.0 * (0.845 - a_eff))
    um = max(u0, u1, u2)
    cSat = _ssT(M - mn, 0.02, 0.15) * _ssT(um - wu, 0.08, 0.30)
    if gSup > 1e-9 and hA > 1e-9 and cSat > 1e-9:
        gm = 4.0 * a_eff * (1.0 - a_eff) * cSat * gSup * hA
        gRp = 0.5 * _c8(r - g) + 0.5 * _c8(r - b)
        gBp = 0.5 * _c8(b - r) + 0.5 * _c8(b - g)
        gRu = 0.5 * _c8(u0 - u1) + 0.5 * _c8(u0 - u2)
        PC = max(M - mn, 1e-6)
        UC = max(um - wu, 1e-6)
        DR = (r - b) / PC
        DG = (g - b) / PC
        DCM = (r - g) / PC
        UR = (u0 - u2) / UC
        UG = (u1 - u2) / UC
        UCM = (u0 - u1) / UC
        wUcP = (u0 - u2) * (b - r)
        dcAbs = u0 - r if u0 > r else r - u0
        LUM = 0.2126 * r + 0.7152 * g + 0.0722 * b
        LUMU = 0.2126 * u0 + 0.7152 * u1 + 0.0722 * u2
        SPAN = (M - mn) * (um - wu)
        OP = 1.0 - ((M - mn) + (um - wu)) / 2.0
        d0 += (- 0.24945965002914949 * 1 - 0.0045889906868631708 * LUM + 0.0041513551994266139 * (DG * UG) - 0.037580595706759645 * (DCM * UCM) + 0.05450569803891276 * wUcP + 0.099893445837378303 * u2 + 0.25226194627256282 * M + 0.023210943937834599 * DG + 0.15029393775777919 * OP + 0.032309012528158876 * SPAN + 0.030058192159529883 * (DR * UR) + 0.34621806773454422 * mn - 0.57046215673962131 * (M * mn) - 0.0027456565141784021 * LUMU + 0.032089971951832885 * UR - 0.053136286490094019 * dcAbs - 0.029410711164283156 * gRu) * gm
        d1 += (- 0.15650536547935953 * 1 + 0.14061150179766091 * LUM - 0.036203528266390395 * (DG * UG) + 0.037350636144765727 * (DCM * UCM) + 0.021745829109720165 * wUcP + 0.023816133495222817 * u2 - 0.064813043910525822 * M - 0.020272883681938206 * DG + 0.1385172056042358 * OP + 0.13327491711885181 * SPAN + 0.012698288999900342 * (DR * UR) + 0.037681776121840031 * mn - 0.055585822793579612 * (M * mn) + 0.037689443255939002 * LUMU + 0.015054100789579432 * UR + 0.021801163240957828 * dcAbs - 0.017675820505782546 * gRu) * gm
        d2 += (+ 0.16757082268978754 * 1 - 0.043737477412635554 * LUM + 0.02221282183541292 * (DG * UG) - 0.02131140334204034 * (DCM * UCM) - 0.088939482811690521 * wUcP + 0.059736090003303446 * u2 - 0.093244625666860398 * M - 0.0024207237712253484 * DG - 0.118897820628014 * OP - 0.0806668864815685 * SPAN - 0.018813447483138224 * (DR * UR) - 0.40457566738392031 * mn + 0.51586854870254917 * (M * mn) - 0.018553588391455163 * LUMU + 0.033909706606359974 * UR - 0.018071468054222248 * dcAbs - 0.041487499442177063 * gRu) * gm
    return [d0, d1, d2]


def pbm_repair_layer(base, tint, a, C):
    mB = max(base)
    mT = max(tint)
    te = _clamp((mT - mB + PBM_EW) / (2.0 * PBM_EW), 0.0, 1.0)
    if te <= 0.0:
        return pbm_repair_delta(tint, base, 1.0 - a, C)
    if te >= 1.0:
        return pbm_repair_delta(base, tint, a, C)
    lam = te * te * (3.0 - 2.0 * te)
    dA = pbm_repair_delta(base, tint, a, C)
    dB = pbm_repair_delta(tint, base, 1.0 - a, C)
    return [lam * dA[0] + (1.0 - lam) * dB[0],
            lam * dA[1] + (1.0 - lam) * dB[1],
            lam * dA[2] + (1.0 - lam) * dB[2]]


def mix_pbm(base, tint, a):
    if a <= 0.0:
        return base[:]
    if a >= 1.0:
        return tint[:]
    C = mix_pbm_core(base, tint, a)
    d = pbm_repair_layer(base, tint, a, C)
    return [_clamp(C[0] + d[0], 0.0, 1.0),
            _clamp(C[1] + d[1], 0.0, 1.0),
            _clamp(C[2] + d[2], 0.0, 1.0)]