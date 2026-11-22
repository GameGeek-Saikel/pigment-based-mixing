#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-fig2.py — 用 matplotlib mathtext（TeX 排版）生成 fig2-architecture.svg

设计（当前终态两阶段架构）：
- 阶段 1：K–M 混色核心 C（φ_core 动态进度 + M₃ + κ̄ + β + 有理 R∞）
- 阶段 2：修复层 D（λ 软角色分配 → 深白门 g → 幂律目标 T → γ 谐波修正）
- 输出：o = clamp(C + d, 0, 1)
- 所有公式统一字号（FONT_EQU = 8pt），文字标签 FONT_LABEL = 8.5pt，图标题 9.5pt
- 卡片尺寸由内容动态计算（先测量文本 bbox，再生成卡片），固定公式大小、动态卡片
- 箭头为手绘（线段 + 三角），尖端精确落在卡片边缘，动态连接卡片
- svg.fonttype='path'：文字转路径，任何渲染器显示一致
- 白底 + 布局自检（越界/重叠/几何）

用法: python make-fig2.py [--out <dir>]
"""
import argparse
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.path import Path
from matplotlib.patches import PathPatch

matplotlib.rcParams['svg.fonttype'] = 'path'
matplotlib.rcParams['font.family'] = 'sans-serif'
matplotlib.rcParams['mathtext.fontset'] = 'dejavusans'

W, H = 8.4, 5.0
DPI = 100

DEFAULT_OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'docs', 'assets'))

# ---- 配色 ----
C_INPUT_BG, C_INPUT_ED = '#fdf3e0', '#c9a24e'
C_CORE_BG, C_CORE_ED = '#e8f0fd', '#5a82c8'
C_REP_BG, C_REP_ED = '#f5f0fa', '#8a63b8'
C_OUT_BG, C_OUT_ED = '#fdf6ec', '#c9a24e'
C_EDGE = '#555555'
C_TITLE = '#111111'
C_TEXT = '#333333'
C_SUB = '#444444'

FONT_EQU = 8.0      # 所有公式统一字号（pt）
FONT_LABEL = 8.5    # 文字标签（inputs / 框标题文字）
FONT_TITLE = 9.5    # 图标题

PAD_X = 0.22        # 卡片水平内边距（in）
PAD_Y = 0.13        # 卡片垂直内边距
LINE_GAP = 0.04     # 行间距（in）
BIG_GAP = 0.13      # 分式行前后额外间距


def rounded_rect_path(x, y, w, h, r):
    """精确圆角矩形路径（数据坐标直译）。17 顶点 + CLOSEPOLY。"""
    verts = [
        (x + r, y),                      # 1  MOVETO
        (x + w - r, y),                  # 2  LINETO
        (x + w, y), (x + w, y), (x + w, y + r),          # 3-5  右下圆角
        (x + w, y + h - r),              # 6  LINETO
        (x + w, y + h), (x + w, y + h), (x + w - r, y + h),  # 7-9  右上圆角
        (x + r, y + h),                  # 10 LINETO
        (x, y + h), (x, y + h), (x, y + h - r),          # 11-13 左上圆角
        (x, y + r),                      # 14 LINETO
        (x, y), (x, y), (x + r, y),      # 15-17 左下圆角
        (x + r, y),                      # 18 CLOSEPOLY
    ]
    codes = [Path.MOVETO, Path.LINETO,
             Path.CURVE4, Path.CURVE4, Path.CURVE4,
             Path.LINETO,
             Path.CURVE4, Path.CURVE4, Path.CURVE4,
             Path.LINETO,
             Path.CURVE4, Path.CURVE4, Path.CURVE4,
             Path.LINETO,
             Path.CURVE4, Path.CURVE4, Path.CURVE4,
             Path.CLOSEPOLY]
    return Path(verts, codes)


def box(ax, x0, y0, w, h, fc, ec, lw=1.5):
    ax.add_patch(PathPatch(rounded_rect_path(x0, y0, w, h, 0.05),
                           fc=fc, ec=ec, lw=lw, zorder=1))


def arrow(ax, a, b, head_len=0.07, head_w=0.032):
    """手绘直线箭头：尖端精确落在 b（数据坐标）。"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = (dx * dx + dy * dy) ** 0.5
    if L < 1e-9:
        return
    ux, uy = dx / L, dy / L
    px, py = -uy, ux
    bx0, by0 = b[0] - ux * head_len, b[1] - uy * head_len
    ax.plot([a[0], bx0], [a[1], by0], color=C_EDGE, lw=1.5, zorder=2)
    pts = [(bx0 + px * head_w, by0 + py * head_w), b, (bx0 - px * head_w, by0 - py * head_w)]
    ax.add_patch(PathPatch(Path(pts + [pts[0]],
                                [Path.MOVETO, Path.LINETO, Path.LINETO, Path.CLOSEPOLY]),
                           fc=C_EDGE, ec='none', lw=0, zorder=2))


def measure(ax, fig, items):
    """先放置所有文本，draw 后测量 bbox（数据坐标）。items: {key: [(s, fs, color)]}"""
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    inv = ax.transData.inverted()
    measured = {}
    for key, list_ in items.items():
        rows = []
        for (s, fs, color) in list_:
            t = ax.text(0, 0, s, fontsize=fs, color=color, ha='center', va='center', zorder=3)
            bb = t.get_window_extent(renderer=renderer)
            (x0, y0) = inv.transform((bb.x0, bb.y0))
            (x1, y1) = inv.transform((bb.x1, bb.y1))
            rows.append({'obj': t, 's': s, 'w': x1 - x0, 'h': y1 - y0, 'fs': fs})
        measured[key] = rows
    return measured


def place_lines(rows, cx, top_y, big_rows=()):
    """文本块顶 = top_y + PAD_Y；返回文本块底（框底 = 返回 + PAD_Y）。"""
    y = top_y - PAD_Y - rows[0]['h'] / 2
    for i, r in enumerate(rows):
        r['obj'].set_position((cx, y))
        if i + 1 < len(rows):
            gap = BIG_GAP if (i in big_rows or i + 1 in big_rows) else LINE_GAP
            y -= r['h'] / 2 + gap + rows[i + 1]['h'] / 2
    return y - rows[-1]['h'] / 2


def content_h(rows, big_rows=()):
    h = rows[0]['h']
    for i in range(len(rows) - 1):
        gap = BIG_GAP if (i in big_rows or i + 1 in big_rows) else LINE_GAP
        h += gap + rows[i + 1]['h']
    return h


def add_box(ax, cx, box_top, box_bot, w, fc, ec):
    box(ax, cx - w / 2, box_bot, w, box_top - box_bot, fc, ec)


def build(out_dir):
    fig, ax = plt.subplots(figsize=(W, H), dpi=DPI)
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.set_facecolor('#ffffff')
    ax.axis('off')

    # ---- 文本组定义（公式统一 FONT_EQU） ----
    items = {
        'title':  [(r'PBM: two-stage mixing  $o = \mathrm{clamp}(C + d,\ 0,\ 1)$', FONT_TITLE, C_TITLE)],
        'input':  [(r'inputs', FONT_LABEL, C_TEXT),
                   (r'$c_b,\; c_t,\; \alpha$', FONT_EQU, C_TEXT)],
        'core':   [(r'stage 1: K–M mixing core  $C$', FONT_LABEL, '#1a3f7a'),
                   (r'$a = \varphi_{\mathrm{core}}(\alpha)$', FONT_EQU, C_TEXT),
                   (r"$v^\prime = M_3 \cdot v$", FONT_EQU, C_TEXT),
                   (r'$\bar{\kappa}_c = \frac{(1-a)K_b + a K_t}{(1-a)S_b + a S_t}$', FONT_EQU, C_TEXT),
                   (r'$\kappa^* = \bar{\kappa}\,(1 + \beta\, s_j s_k)$', FONT_EQU, C_SUB),
                   (r'$R_\infty$: rational approx. in $s=\sqrt{\kappa^*}$', FONT_EQU, C_SUB)],
        'repair': [(r'stage 2: repair layer  $D$', FONT_LABEL, '#4b2e82'),
                   (r'$\lambda$: soft role assignment $\rightarrow (p, u)$', FONT_EQU, C_TEXT),
                   (r'$g = \sigma_k(w-0.3738)\ \sigma_k(M)\ \sigma_k(\mathrm{maxd}-0.0648)$', FONT_EQU, C_TEXT),
                   (r'power-law target:  $T_c = p_c + (u_c-p_c)\,\varphi_{\mathrm{low}}(a)^{q_c}$', FONT_EQU, C_TEXT),
                   (r'harmonic:  $\hat{\gamma}_c(V)\,\mathrm{cSat}\,(1-g)\,4a(1-a)\,h(a)$', FONT_EQU, C_SUB)],
        'output': [(r'$o = \mathrm{clamp}(C + d,\ 0,\ 1)$', FONT_EQU, C_TEXT)],
    }
    m = measure(ax, fig, items)

    # ---- 动态布局（两遍：先测总高，再整体垂直居中，使顶部/底部留白相等） ----
    GAP_TITLE = 0.145   # 标题底 → 输入框顶
    GAP_IN = 0.35       # 输入框底 → 核心/修复框顶
    GAP_STAGE = 0.22    # 核心/修复框底 → 输出顶
    GAP_BOX = 0.30      # 核心 ↔ 修复 水平间距（画布中心两侧）

    in_rows, core_rows, rep_rows = m['input'], m['core'], m['repair']
    out_rows = m['output']
    in_w = max(r['w'] for r in in_rows) + 2 * PAD_X
    core_w = max(r['w'] for r in core_rows) + 2 * PAD_X
    rep_w = max(r['w'] for r in rep_rows) + 2 * PAD_X
    out_w = out_rows[0]['w'] + 2 * PAD_X
    in_h = content_h(in_rows) + 2 * PAD_Y
    core_h = content_h(core_rows, (2,)) + 2 * PAD_Y
    rep_h = content_h(rep_rows) + 2 * PAD_Y
    out_h = out_rows[0]['h'] + 2 * PAD_Y
    cx_in = cx_out = W / 2
    # 两阶段框水平居中于 1/4 与 3/4 位置（按框宽微调）
    cx_core = W / 4 - (core_w - rep_w) / 4
    cx_rep = 3 * W / 4 + (core_w - rep_w) / 4

    def layout(shift, draw):
        """从顶部向下排布；shift = 顶部留白。draw=True 时画框/箭头并返回框几何。"""
        title = m['title'][0]
        title_top = H - shift
        title['obj'].set_position((W / 2, title_top - title['h'] / 2))
        in_top = title_top - title['h'] - GAP_TITLE
        in_bot = place_lines(in_rows, cx_in, in_top) - PAD_Y
        core_top = in_bot - GAP_IN
        core_bot = place_lines(core_rows, cx_core, core_top, big_rows=(2,)) - PAD_Y
        rep_top = in_bot - GAP_IN
        rep_bot = place_lines(rep_rows, cx_rep, rep_top) - PAD_Y
        stage_bot = min(core_bot, rep_bot)
        out_top = stage_bot - GAP_STAGE
        out_cy = out_top - out_h / 2
        out_bot = out_top - out_h
        out_rows[0]['obj'].set_position((cx_out, out_cy))
        info = {'title_top': title_top, 'out_bot': out_bot, 'boxes': None}
        if draw:
            add_box(ax, cx_in, in_top, in_bot, in_w, C_INPUT_BG, C_INPUT_ED)
            add_box(ax, cx_core, core_top, core_bot, core_w, C_CORE_BG, C_CORE_ED)
            add_box(ax, cx_rep, rep_top, rep_bot, rep_w, C_REP_BG, C_REP_ED)
            add_box(ax, cx_out, out_top, out_bot, out_w, C_OUT_BG, C_OUT_ED)
            arrow(ax, (cx_in, in_bot), (cx_core, core_top))
            arrow(ax, (cx_in, in_bot), (cx_rep, rep_top))
            arrow(ax, (cx_core, core_bot), (cx_out, out_top))
            arrow(ax, (cx_rep, rep_bot), (cx_out, out_top))
            info['boxes'] = [
                (cx_in - in_w / 2, in_bot, cx_in + in_w / 2, in_top),
                (cx_core - core_w / 2, core_bot, cx_core + core_w / 2, core_top),
                (cx_rep - rep_w / 2, rep_bot, cx_rep + rep_w / 2, rep_top),
                (cx_out - out_w / 2, out_bot, cx_out + out_w / 2, out_top),
            ]
        return info

    info0 = layout(0.0, draw=False)
    shift = (H - (info0['title_top'] - info0['out_bot'])) / 2
    info = layout(shift, draw=True)
    frame_boxes = info['boxes']
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    inv = ax.transData.inverted()
    boxes = []
    n_warn = 0
    for t in ax.texts:
        bb = t.get_window_extent(renderer=renderer)
        (x0, y0) = inv.transform((bb.x0, bb.y0))
        (x1, y1) = inv.transform((bb.x1, bb.y1))
        txt = t.get_text()[:52]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        boxes.append((txt, x0, y0, x1, y1))
        if x0 < 0 or y0 < 0 or x1 > W or y1 > H:
            print(f'[WARN] 越出画布: "{txt}"'); n_warn += 1
        owner = [f for f in frame_boxes if f[0] < cx < f[2] and f[1] < cy < f[3]]
        if owner:
            f = owner[0]
            if x0 < f[0] - 0.01 or y0 < f[1] - 0.01 or x1 > f[2] + 0.01 or y1 > f[3] + 0.01:
                print(f'[WARN] 越出所属框: "{txt}"'); n_warn += 1
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            if a[1] < b[3] and b[1] < a[3] and a[2] < b[4] and b[2] < a[4]:
                print(f'[WARN] 文本重叠: "{a[0]}" 与 "{b[0]}"'); n_warn += 1
    print('文本元素数:', len(ax.texts), '| 自检警告:', n_warn)

    os.makedirs(out_dir, exist_ok=True)
    svg = os.path.join(out_dir, 'fig2-architecture.svg')
    png = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp',
                       'pbm-paper-tools', 'fig2-preview.png')
    os.makedirs(os.path.dirname(png), exist_ok=True)
    fig.savefig(svg, dpi=DPI)
    fig.savefig(png, dpi=150)
    plt.close(fig)
    print('fig2-architecture.svg ->', out_dir)
    print('fig2-preview.png ->', png)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=DEFAULT_OUT)
    args = ap.parse_args()
    build(args.out)
