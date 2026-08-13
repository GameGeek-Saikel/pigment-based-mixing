/**
 * ColorMixing — PBM 颜料基混色算法（Java 实现，仅混色公式）
 *
 * 只含论文 §3 两阶段混色公式（K–M 核心 + 修复层）；不含任何验证/测试
 * 代码（一致性测试 CLI 在 tools/cli/，评测在 tools/）。
 *
 * 与 javascript/color-mixing.js 的 mixPbm 数值等价（IEEE 754 double，
 * 运算顺序一致；libm 差异 ΔE00 < 1e-6 量级）。参数（PBM_A/PBM_M/
 * PBM_BETA/PBM_EPS/PBM_PW_* 等）与 JS 单一事实源逐位一致。
 *
 * 优化（对齐 JS 优化参考实现）：
 *   - M₃/M₃⁻¹ 手写展开（PBM_MI 静态初始化一次）
 *   - φ 端点压缩快速路径内联（phiLow）
 *   - 幂律目标展开（无 pre 对象、无逐通道内部类；q 表达式直接展开）
 *   - K/S 叠加 kc 外提为带参静态方法（去闭包开销）
 *   - γ 谐波零贡献提前退出（cSat/hA/gSup 门）
 *   - 倍角公式降三角次数（8→4）；通道极值/色相 hueOf 手写展开
 *
 * 用法（库）：
 *     double[] out = ColorMixing.mixPbm(
 *         new double[]{0.988, 0.827, 0.0}, new double[]{0.0, 0.129, 0.522}, 0.5);
 *
 * 许可证：MIT License（仓库 LICENSE）。
 */
public class ColorMixing {

    // ---- 参数（单一事实源：javascript/color-mixing.js，勿单独修改） ----
    static final double[] PBM_A = { Math.sqrt(2.0), 1.0, 1.0 / (2.0 * Math.sqrt(2.0)) };
    static final double[] PBM_M = { 0.74523981, 0.30403013, -0.04926994, 0.0, 0.74093256, 0.25906744, 0.0, 0.0, 1.0 };
    static final double[] PBM_BETA = { -0.69372345, -0.48397409, -0.24977842 };
    static final double PBM_EPS = 0.00157634;
    static final double[] PBM_PW_RES = { 0.0, -0.25693718, -0.25693718 };
    static final double PBM_PW_CPL = 0.43251363;
    static final double PBM_PW_KC = 4.86795929;
    static final double[] PBM_PW_RD = { -0.28030789, -0.31011215, 0.33194666, -1.19791733, -0.45218018, 1.71390058 };
    static final double PBM_PW_RTH = 0.21929798;
    static final double PBM_PW_BD_R = 0.40713961;
    static final double[] PBM_PW_BD_G = { -0.08390816, 0.76274462 };
    static final double[] PBM_PW_GD_R = { -0.2367074, 0.72220875 };
    static final double[] PBM_PW_GD_B = { -0.30067864, 1.03098891 };
    static final double PBM_EW = 0.08;
    static final double PBM_PHI_P = 2.31336;
    static final double PBM_PHI_W = PBM_EW;

    static final double[] PBM_MI = mat3Inv(PBM_M);

    static double[] mat3Inv(double[] m) {
        double a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
        double A = e * i - f * h;
        double B = -(d * i - f * g);
        double C = d * h - e * g;
        double det = a * A + b * B + c * C;
        return new double[]{
            A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
            B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
            C / det, -(a * h - b * g) / det, (a * e - b * d) / det
        };
    }

    static double clamp(double v, double lo, double hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    static double c01(double x) {
        return x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x);
    }

    static double ck(double x) {
        double t = x * 12.584001;
        return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
    }

    static double c8(double x) {
        double t = x * 8.0;
        return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
    }

    static double ssT(double x, double lo, double hi) {
        double t = c01((x - lo) / (hi - lo));
        return t * t * (3.0 - 2.0 * t);
    }

    static double phiLow(double x) {
        if (x >= PBM_PHI_W) return x;
        double u = clamp(x / PBM_PHI_W, 0.0, 1.0);
        double ss0 = u * u * (3.0 - 2.0 * u);
        return (1.0 - ss0) * Math.pow(x, PBM_PHI_P) + ss0 * x;
    }

    static double kc(double x1, double x2, double ia, double aa) {
        double v1 = x1 < 0.0 ? 0.0 : (x1 > 1.0 ? 1.0 : x1);
        double v2 = x2 < 0.0 ? 0.0 : (x2 > 1.0 ? 1.0 : x2);
        double K1 = 0.5 * (1.0 - v1) * (1.0 - v1);
        double K2 = 0.5 * (1.0 - v2) * (1.0 - v2);
        double S1 = v1 > PBM_EPS ? v1 : PBM_EPS;
        double S2 = v2 > PBM_EPS ? v2 : PBM_EPS;
        double kk = (K1 * ia + K2 * aa) / (S1 * ia + S2 * aa);
        if (kk < 1e-6) return 1e-6;
        if (kk > 1e4) return 1e4;
        return kk;
    }

    static double resE(double v) {
        double t = v * 25.0;
        if (t < 1.0) return 0.9432 - 0.6219 * t;
        if (t < 3.0) return 0.4580 - 0.1494 * t;
        return 0.0;
    }

    /** K–M 混色核心（论文 §3.3）。入参/出参均为 sRGB 浮点 [0,1]。 */
    public static double[] mixPbmCore(double[] base, double[] tint, double a) {
        if (a <= 0.0) return base.clone();
        if (a >= 1.0) return tint.clone();
        if (a < 0.08) a = phiLow(a);
        else if (a > 0.92) a = 1.0 - phiLow(1.0 - a);
        double b0 = base[0], b1 = base[1], b2 = base[2];
        double t0 = tint[0], t1 = tint[1], t2 = tint[2];
        double vb0 = 0.74523981 * b0 + 0.30403013 * b1 - 0.04926994 * b2;
        double vb1 = 0.74093256 * b1 + 0.25906744 * b2;
        double vb2 = b2;
        double vt0 = 0.74523981 * t0 + 0.30403013 * t1 - 0.04926994 * t2;
        double vt1 = 0.74093256 * t1 + 0.25906744 * t2;
        double vt2 = t2;
        final double ia = 1.0 - a;
        final double aa = a;
        double k0 = kc(vb0, vt0, ia, aa), k1 = kc(vb1, vt1, ia, aa), k2 = kc(vb2, vt2, ia, aa);
        double r0 = Math.sqrt(k0), r1 = Math.sqrt(k1), r2 = Math.sqrt(k2);
        double s0 = r0 / (1.0 + r0), s1 = r1 / (1.0 + r1), s2 = r2 / (1.0 + r2);
        double w0 = Math.sqrt(clamp(k0 * (1.0 + PBM_BETA[0] * s1 * s2), 1e-6, 1e4));
        double w1 = Math.sqrt(clamp(k1 * (1.0 + PBM_BETA[1] * s0 * s2), 1e-6, 1e4));
        double w2 = Math.sqrt(clamp(k2 * (1.0 + PBM_BETA[2] * s0 * s1), 1e-6, 1e4));
        double o0 = 1.0 / (1.0 + w0 * (PBM_A[0] + w0 * (PBM_A[1] + w0 * PBM_A[2])));
        double o1 = 1.0 / (1.0 + w1 * (PBM_A[0] + w1 * (PBM_A[1] + w1 * PBM_A[2])));
        double o2 = 1.0 / (1.0 + w2 * (PBM_A[0] + w2 * (PBM_A[1] + w2 * PBM_A[2])));
        return new double[]{
            clamp(PBM_MI[0] * o0 + PBM_MI[1] * o1 + PBM_MI[2] * o2, 0.0, 1.0),
            clamp(PBM_MI[3] * o0 + PBM_MI[4] * o1 + PBM_MI[5] * o2, 0.0, 1.0),
            clamp(PBM_MI[6] * o0 + PBM_MI[7] * o1 + PBM_MI[8] * o2, 0.0, 1.0)
        };
    }

    static double[] pbmPwTarget(double[] pig, double[] u, double a) {
        if (a < PBM_PHI_W) {
            double uu = a / PBM_PHI_W;
            double ss0 = uu * uu * (3.0 - 2.0 * uu);
            a = (1.0 - ss0) * Math.pow(a, PBM_PHI_P) + ss0 * a;
        }
        double r = pig[0], g = pig[1], b = pig[2];
        double u0 = u[0], u1 = u[1], u2 = u[2];
        double gR = 0.5 * c8(r - g) + 0.5 * c8(r - b);
        double gG = 0.5 * c8(g - r) + 0.5 * c8(g - b);
        double gB = 0.5 * c8(b - r) + 0.5 * c8(b - g);
        double gRed = gR * c8(r - PBM_PW_RTH);
        double gSum = gR + gG + gB;
        double gInv = gSum > 1e-6 ? 1.0 / gSum : 0.0;

        double resE0 = resE(g), resE2 = resE(b);

        double s1R = ck(r - 0.04633146), s2R = ck(r - 0.24928142);
        double pBvR = 0.88024633 + (0.33545176 - 0.88024633) * s1R + (0.19217412 - 0.33545176) * s2R;
        double pGvR = 0.57387051 + (0.596528 - 0.57387051) * s1R + (0.19217412 - 0.596528) * s2R;
        double q0 = gSum <= 1e-6 ? (1.0 + pBvR + pGvR) / 3.0 : (gB * pBvR + gG * pGvR + gR) * gInv;
        q0 += PBM_PW_CPL * c01(Math.max(g, b) * PBM_PW_KC);
        q0 += gRed * (PBM_PW_RD[0] + PBM_PW_RD[1] * r) + gB * PBM_PW_BD_R + gG * (PBM_PW_GD_R[0] + PBM_PW_GD_R[1] * r);

        double s1G = ck(g - 0.04633146), s2G = ck(g - 0.24928142);
        double pBvG = 0.88024633 + (0.33545176 - 0.88024633) * s1G + (0.19217412 - 0.33545176) * s2G;
        double pGvG = 0.57387051 + (0.596528 - 0.57387051) * s1G + (0.19217412 - 0.596528) * s2G;
        double q1 = gSum <= 1e-6 ? (1.0 + pBvG + pGvG) / 3.0 : (gB * pBvG + gG * pGvG + gR) * gInv;
        q1 += PBM_PW_RES[1] * resE0;
        q1 += PBM_PW_CPL * c01(Math.max(r, b) * PBM_PW_KC);
        q1 += gRed * (PBM_PW_RD[2] + PBM_PW_RD[3] * g) + gB * (PBM_PW_BD_G[0] + PBM_PW_BD_G[1] * g);

        double s1B = ck(b - 0.04633146), s2B = ck(b - 0.24928142);
        double pBvB = 0.88024633 + (0.33545176 - 0.88024633) * s1B + (0.19217412 - 0.33545176) * s2B;
        double pGvB = 0.57387051 + (0.596528 - 0.57387051) * s1B + (0.19217412 - 0.596528) * s2B;
        double q2 = gSum <= 1e-6 ? (1.0 + pBvB + pGvB) / 3.0 : (gB * pBvB + gG * pGvB + gR) * gInv;
        q2 += PBM_PW_RES[2] * resE2;
        q2 += PBM_PW_CPL * c01(Math.max(r, g) * PBM_PW_KC);
        q2 += gRed * (PBM_PW_RD[4] + PBM_PW_RD[5] * g) + gG * (PBM_PW_GD_B[0] + PBM_PW_GD_B[1] * g);

        return new double[]{
            r + (u0 - r) * Math.pow(a, q0),
            g + (u1 - g) * Math.pow(a, q1),
            b + (u2 - b) * Math.pow(a, q2)
        };
    }

    static double[] pbmRepairDelta(double[] pig, double[] u, double aEff, double[] C) {
        double r = pig[0], g = pig[1], b = pig[2];
        double u0 = u[0], u1 = u[1], u2 = u[2];
        double M = r > g ? (r > b ? r : b) : (g > b ? g : b);
        double mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        double maxd = M - mn;
        double wu = u0 < u1 ? (u0 < u2 ? u0 : u2) : (u1 < u2 ? u1 : u2);
        double w = mn > wu ? mn : wu;
        double gate = ck(w - 0.3706311) * ck(M) * ck(maxd - 0.06556298);
        double d0 = 0.0, d1 = 0.0, d2 = 0.0;
        if (gate > 1e-6) {
            double[] t = pbmPwTarget(pig, u, aEff);
            d0 = gate * (t[0] - C[0]);
            d1 = gate * (t[1] - C[1]);
            d2 = gate * (t[2] - C[2]);
        }
        double gSup = 1.0 - gate;
        double hA = c01(14.0 * (0.845 - aEff));
        double um = u0 > u1 ? (u0 > u2 ? u0 : u2) : (u1 > u2 ? u1 : u2);
        double cSat = ssT(M - mn, 0.02, 0.15) * ssT(um - wu, 0.08, 0.30);
        if (gSup > 1e-9 && hA > 1e-9 && cSat > 1e-9) {
            double gm = 4.0 * aEff * (1.0 - aEff) * cSat * gSup * hA;
            double hp = hueOf(r, g, b), hu = hueOf(u0, u1, u2);
            double A = Math.PI / 180.0;
            double shp = Math.sin(A * hp), chp = Math.cos(A * hp);
            double shu = Math.sin(A * hu), chu = Math.cos(A * hu);
            double s2hp = 2.0 * shp * chp, c2hp = 2.0 * chp * chp - 1.0;
            double s3hp = shp * (3.0 - 4.0 * shp * shp), c3hp = chp * (4.0 * chp * chp - 3.0);
            double s2hu = 2.0 * shu * chu, c2hu = 2.0 * chu * chu - 1.0;
            double logu = Math.log(u0 + 0.01);
            double s1hu_pm = shu * c01((M - 0.30) * 12.584);
            double gRp = 0.5 * c8(r - g) + 0.5 * c8(r - b);
            double gBp = 0.5 * c8(b - r) + 0.5 * c8(b - g);
            double gRu = 0.5 * c8(u0 - u1) + 0.5 * c8(u0 - u2);
            double wUcP = (u0 - u2) * (b - r);
            double dcAbs = u0 > r ? u0 - r : r - u0;
            d0 += (-0.07339164 + -0.085953 * gBp + 0.1295769 * wu + -0.04714988 * s2hp + 0.12208017 * M + -0.00677685 * logu + -0.03406281 * shu + 0.01174257 * s3hp + 0.02505266 * s1hu_pm + 0.0360914 * gRp + -0.04872395 * r) * gm;
            d1 += (-0.04704706 + 0.10921572 * wu + -0.06204143 * gRp + -0.02021518 * c2hp + 0.05506322 * um + 0.00698984 * s2hu) * gm;
            d2 += (-0.04887766 + 0.09651812 * wu + -0.07000325 * mn + 0.02119207 * c3hp + 0.08138486 * um + -0.06336064 * M + 0.01773538 * c2hu + -0.09771287 * wUcP + 0.0736705 * dcAbs + -0.03704948 * gRu) * gm;
        }
        return new double[]{ d0, d1, d2 };
    }

    static double hueOf(double v0, double v1, double v2) {
        double mx = v0 > v1 ? (v0 > v2 ? v0 : v2) : (v1 > v2 ? v1 : v2);
        double mnn = v0 < v1 ? (v0 < v2 ? v0 : v2) : (v1 < v2 ? v1 : v2);
        if (mx - mnn < 1e-9) return 0.0;
        double h;
        if (mx == v0) h = 60.0 * ((v1 - v2) / (mx - mnn));
        else if (mx == v1) h = 60.0 * (2.0 + (v2 - v0) / (mx - mnn));
        else h = 60.0 * (4.0 + (v0 - v1) / (mx - mnn));
        return h < 0.0 ? h + 360.0 : h;
    }

    static double[] pbmRepairLayer(double[] base, double[] tint, double a, double[] C) {
        double mB = Math.max(base[0], Math.max(base[1], base[2]));
        double mT = Math.max(tint[0], Math.max(tint[1], tint[2]));
        double te = clamp((mT - mB + PBM_EW) / (2.0 * PBM_EW), 0.0, 1.0);
        if (te <= 0.0) return pbmRepairDelta(tint, base, 1.0 - a, C);
        if (te >= 1.0) return pbmRepairDelta(base, tint, a, C);
        double lam = te * te * (3.0 - 2.0 * te);
        double[] dA = pbmRepairDelta(base, tint, a, C);
        double[] dB = pbmRepairDelta(tint, base, 1.0 - a, C);
        return new double[]{
            lam * dA[0] + (1.0 - lam) * dB[0],
            lam * dA[1] + (1.0 - lam) * dB[1],
            lam * dA[2] + (1.0 - lam) * dB[2]
        };
    }

    /** PBM 主入口：mixPbm(base, tint, a) → [r,g,b]（sRGB [0,1]）。 */
    public static double[] mixPbm(double[] base, double[] tint, double a) {
        if (a <= 0.0) return base.clone();
        if (a >= 1.0) return tint.clone();
        double[] C = mixPbmCore(base, tint, a);
        double[] d = pbmRepairLayer(base, tint, a, C);
        return new double[]{
            clamp(C[0] + d[0], 0.0, 1.0),
            clamp(C[1] + d[1], 0.0, 1.0),
            clamp(C[2] + d[2], 0.0, 1.0)
        };
    }
}
