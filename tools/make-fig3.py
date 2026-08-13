#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-fig3.py — 用 matplotlib 重绘 fig3-staircase.svg（专业图表）

- 数据来自 figdata.js（Mixbox 反解 + PBM 端到端），JSON 读入
- 完整坐标轴 + 网格 + mathtext 轴标签 + 图例
- svg.fonttype='path'，白底

用法: python make-fig3.py [--data <json>] [--out <dir>]
"""
import argparse
import json
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

matplotlib.rcParams['svg.fonttype'] = 'path'
matplotlib.rcParams['font.family'] = 'sans-serif'
matplotlib.rcParams['mathtext.fontset'] = 'dejavusans'

DEFAULT_OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'docs', 'assets'))
DEFAULT_DATA = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp',
                            'pbm-paper-tools', 'fig3-data.json')

W, H = 7.2, 4.2
DPI = 100


def build(data_path, out_dir):
    with open(data_path, 'r', encoding='utf-8') as f:
        d = json.load(f)

    fig, ax = plt.subplots(figsize=(W, H), dpi=DPI)
    fig.subplots_adjust(left=0.09, right=0.98, top=0.97, bottom=0.12)

    ax.plot([p[0] for p in d['curveB']], [p[1] for p in d['curveB']],
            color='#3b6fe0', lw=2.2, label=r'$B$-family soft-step $p_f(v)$', zorder=3)
    ax.plot([p[0] for p in d['curveG']], [p[1] for p in d['curveG']],
            color='#3fa76f', lw=2.2, label=r'$G$-family soft-step $p_f(v)$', zorder=3)
    ax.plot([p[0] for p in d['curveP']], [p[1] for p in d['curveP']],
            color='#e00000', lw=1.4, ls='-', label=r'PBM end-to-end inversion (G channel)', zorder=3)

    ax.scatter([p[0] for p in d['synth']], [p[1] for p in d['synth']],
               color='#222222', s=34, zorder=5, label='Mixbox inversion (synthetic colors)')
    ax.scatter([p[0] for p in d['pts']['B']], [p[1] for p in d['pts']['B']],
               color='#3b6fe0', s=30, marker='s', zorder=5, label='T5 anchors, B channel')
    ax.scatter([p[0] for p in d['pts']['G']], [p[1] for p in d['pts']['G']],
               color='#3fa76f', s=30, marker='^', zorder=5, label='T5 anchors, G channel')
    ax.scatter([p[0] for p in d['pts']['R']], [p[1] for p in d['pts']['R']],
               color='#c96a2e', s=30, marker='D', zorder=5, label='T5 anchors, R channel')

    ax.set_xlim(0, 0.65)
    ax.set_ylim(0, 2.4)
    ax.set_xlabel('channel value  $v$', fontsize=11)
    ax.set_ylabel('inverted exponent  $p$', fontsize=11)
    ax.grid(True, ls=':', lw=0.7, color='#bbbbbb', zorder=0)
    ax.tick_params(labelsize=9)
    ax.legend(loc='upper right', fontsize=8, framealpha=0.9, edgecolor='#cccccc')
    for sp in ('top', 'right'):
        ax.spines[sp].set_visible(False)

    os.makedirs(out_dir, exist_ok=True)
    svg = os.path.join(out_dir, 'fig3-staircase.svg')
    png = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp',
                       'pbm-paper-tools', 'fig3-preview.png')
    os.makedirs(os.path.dirname(png), exist_ok=True)
    fig.savefig(svg, dpi=DPI)
    fig.savefig(png, dpi=150)
    plt.close(fig)
    print('fig3-staircase.svg ->', out_dir)
    print('fig3-preview.png ->', png)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=DEFAULT_DATA)
    ap.add_argument('--out', default=DEFAULT_OUT)
    args = ap.parse_args()
    build(args.data, args.out)
