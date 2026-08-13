#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-fig6.py — 用 matplotlib 重绘 fig6-continuity.svg（邻域连续性）

- 数据来自 figdata-fig6.js：8-bit 输入扰动（1/255 步）→ 输出变化 ΔE00
- svg.fonttype='path'，白底

用法: python make-fig6.py [--data <json>] [--out <dir>]
"""
import argparse
import json
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

matplotlib.rcParams['svg.fonttype'] = 'path'
matplotlib.rcParams['font.family'] = 'sans-serif'
matplotlib.rcParams['mathtext.fontset'] = 'dejavusans'

DEFAULT_OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'docs', 'assets'))
DEFAULT_DATA = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp',
                            'pbm-paper-tools', 'fig6-data.json')

N = 8


def build(data_path, out_dir):
    with open(data_path, 'r', encoding='utf-8') as f:
        d = json.load(f)

    fig, ax = plt.subplots(figsize=(7.2, 4.2), dpi=100)
    fig.subplots_adjust(left=0.12, right=0.97, top=0.94, bottom=0.14)

    x = np.arange(0, N + 1)
    ax.plot(x, d['PBM_R'], color='#e00000', lw=2, label='perturb R (PBM)')
    ax.plot(x, d['PBM_G'], color='#3fa76f', lw=2, label='perturb G (PBM)')
    ax.plot(x, d['PBM_B'], color='#3b6fe0', lw=2, label='perturb B (PBM)')
    ax.plot(x, d['LERP_R'], color='#888888', lw=1.5, ls='--', label='perturb R (RGB interpolation)')

    ax.set_xlabel('input perturbation  $\\delta$  (1/255 steps)', fontsize=11, labelpad=8)
    ax.set_ylabel(r'output change  $\Delta E_{00}$', fontsize=11, labelpad=12)
    ax.set_xticks(range(0, N + 1))
    ax.set_ylim(0, 5.5)   # PBM_G 最大 4.85（n=8），上限 5.5 留 ~13% 余量
    ax.grid(True, ls=':', lw=0.7, color='#bbbbbb', zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(labelsize=9)
    ax.legend(loc='upper left', fontsize=8.5, framealpha=0.9, edgecolor='#cccccc')
    for sp in ('top', 'right'):
        ax.spines[sp].set_visible(False)

    os.makedirs(out_dir, exist_ok=True)
    svg = os.path.join(out_dir, 'fig6-continuity.svg')
    png = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp',
                       'pbm-paper-tools', 'fig6-preview.png')
    os.makedirs(os.path.dirname(png), exist_ok=True)
    fig.savefig(svg, dpi=100)
    fig.savefig(png, dpi=150)
    plt.close(fig)
    print('fig6-continuity.svg ->', out_dir)
    print('fig6-preview.png ->', png)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=DEFAULT_DATA)
    ap.add_argument('--out', default=DEFAULT_OUT)
    args = ap.parse_args()
    build(args.data, args.out)
