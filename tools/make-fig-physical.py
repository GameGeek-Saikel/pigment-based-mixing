#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-fig-physical.py — 光谱真值对照图（合成光谱两常数 K–M vs PBM vs Mixbox）

- 数据来自 run-physical.js 的 figureData：3 个代表性颜料对 × α∈[0,1] 网格
- 每对一行：光谱真值 / PBM / Mixbox 三个色带（21 步 α），
  端点与 α=0.5 处标注 ΔE00(PBM, truth) 与 ΔE00(Mixbox, truth)
- svg.fonttype='path'，白底

用法: python make-fig-physical.py [--data <json>] [--out <dir>]
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
                            'pbm-paper-tools', 'out', 'physical-report.json')


def hex_of(rgb):
    return '#%02X%02X%02X' % tuple(int(round(min(1, max(0, v)) * 255)) for v in rgb)


def build(data_path, out_dir):
    with open(data_path, 'r', encoding='utf-8') as f:
        d = json.load(f)
    pairs = d['figureData']

    fig, axes = plt.subplots(len(pairs), 1, figsize=(8.6, 4.6), dpi=100)
    # top=0.86 给 suptitle 留足空间（避免标题与首子图标题粘连）
    fig.subplots_adjust(left=0.16, right=0.98, top=0.86, bottom=0.10, hspace=0.62)

    for ax, pair in zip(axes, pairs):
        rows = pair['rows']
        n = len(rows)
        models = [('truth', 'spectral truth'), ('PBM', 'PBM'), ('Mixbox', 'Mixbox')]
        y = 0.0
        for key, label in models:
            sw = [rows[i][key] for i in range(n)]
            for i in range(n):
                ax.add_patch(matplotlib.patches.Rectangle(
                    (i, y), 1, 0.9, facecolor=hex_of(sw[i]), edgecolor='none'))
            y += 1.0
        # 色带下的 α 刻度
        ax.set_xlim(0, n + 0.5)
        ax.set_ylim(-0.2, 3.0)
        ax.set_yticks([0.45, 1.45, 2.45])
        ax.set_yticklabels(['spectral truth', 'PBM', 'Mixbox'], fontsize=9)
        ax.set_xticks([0, n // 2, n - 1])
        ax.set_xticklabels(['α=0', 'α=0.5', 'α=1'], fontsize=8)
        ax.tick_params(length=0)
        for sp in ax.spines.values():
            sp.set_visible(False)
        # 每模型在 α=0.5 处与真值的 ΔE00（CIEDE2000 由 JS 侧计算更准，这里用报告里
        # 的 figureData 自带 RGB 近似欧氏色距标注不可靠，故仅在标题行给套件统计）
        ax.set_title('%s + %s' % (pair['aName'], pair['bName']), fontsize=9, loc='left', pad=4)

    fig.suptitle('Synthetic-spectra truth vs PBM vs Mixbox', fontsize=11, y=0.985)
    fig.text(0.5, 0.015,
             'ΔE00 vs spectral truth: P1 6.43 / Mixbox 6.46 · P5 8.30 / 8.86 · P5E 3.32 / 3.39  '
             '(see physical-report.json)',
             ha='center', fontsize=7.5, color='#444444')

    os.makedirs(out_dir, exist_ok=True)
    svg = os.path.join(out_dir, 'fig8-physical.svg')
    png = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp',
                       'pbm-paper-tools', 'fig8-physical-preview.png')
    os.makedirs(os.path.dirname(png), exist_ok=True)
    fig.savefig(svg, dpi=100)
    fig.savefig(png, dpi=150)
    plt.close(fig)
    print('fig8-physical.svg ->', out_dir)
    print('fig8-physical-preview.png ->', png)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=DEFAULT_DATA)
    ap.add_argument('--out', default=DEFAULT_OUT)
    args = ap.parse_args()
    build(args.data, args.out)

