#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-fig4.py — 用 matplotlib 重绘 fig4-error-dist.svg（ΔE00 分布直方图 2×2）

- 数据来自 figdata-fig4.js（PBM vs Mixbox 的 ΔE00 数组）
- 每面板：直方图（bin 0.5）+ mean 红色竖线 + 面板内标注
- svg.fonttype='path'，白底

用法: python make-fig4.py [--data <json>] [--out <dir>]
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
                            'pbm-paper-tools', 'fig4-data.json')

PANELS = [('T1', 'T1  palette', 16), ('T2', 'T2  stress pairs', 16),
          ('T3', 'T3  random', 22), ('T5', 'T5  dark + white', 8)]


def build(data_path, out_dir):
    with open(data_path, 'r', encoding='utf-8') as f:
        d = json.load(f)

    fig, axes = plt.subplots(2, 2, figsize=(7.6, 6.0), dpi=100)
    fig.subplots_adjust(left=0.085, right=0.985, top=0.91, bottom=0.09, hspace=0.42, wspace=0.22)

    for ax, (key, title, xmax) in zip(axes.flat, PANELS):
        de = np.array(d[key])
        bins = np.arange(0, xmax + 0.501, 0.5)
        counts, _ = np.histogram(de, bins=bins)
        ymax = float(counts.max())
        ax.hist(de, bins=bins, color='#3b6fe0', alpha=0.75, edgecolor='none')
        mean = float(de.mean())
        # 顶部留 32% 余量，mean 标注位于条顶之上、面板之内
        ax.set_ylim(0, ymax * 1.32)
        ax.axvline(mean, color='#c00000', lw=2.2, zorder=6)
        ax.text(mean, ymax * 1.12, f'mean {mean:.2f}', ha='center', va='bottom',
                fontsize=10, fontweight='bold', color='#c00000',
                bbox=dict(boxstyle='round,pad=0.25', fc='white', ec='none', alpha=0.85),
                zorder=7)
        ax.set_title(title, fontsize=10.5, pad=6)
        ax.set_xlabel(r'$\Delta E_{00}$', fontsize=9.5)
        ax.set_ylabel('count', fontsize=9.5)
        ax.tick_params(labelsize=8.5)
        ax.grid(axis='y', ls=':', lw=0.6, color='#bbbbbb', zorder=0)
        ax.set_axisbelow(True)
        for sp in ('top', 'right'):
            ax.spines[sp].set_visible(False)

    os.makedirs(out_dir, exist_ok=True)
    svg = os.path.join(out_dir, 'fig4-error-dist.svg')
    png = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp',
                       'pbm-paper-tools', 'fig4-preview.png')
    os.makedirs(os.path.dirname(png), exist_ok=True)
    fig.savefig(svg, dpi=100)
    fig.savefig(png, dpi=150)
    plt.close(fig)
    print('fig4-error-dist.svg ->', out_dir)
    print('fig4-preview.png ->', png)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=DEFAULT_DATA)
    ap.add_argument('--out', default=DEFAULT_OUT)
    args = ap.parse_args()
    build(args.data, args.out)
