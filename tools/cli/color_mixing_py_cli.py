# -*- coding: utf-8 -*-
"""color_mixing_py_cli.py — PBM 一致性测试 CLI（薄包装，无算法实现）

算法实现见 python/color_mixing.py；本文件仅供 tools/check-cross-language.js
调用（stdin 行输入 r1,g1,b1,r2,g2,b2,a，stdout 输出 r,g,b 9 位小数）。

许可证：MIT License（仓库 LICENSE）。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'python'))
from color_mixing import mix_pbm  # noqa: E402


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(',')
        if len(parts) != 7:
            continue
        vals = [float(p) for p in parts]
        out = mix_pbm(vals[0:3], vals[3:6], vals[6])
        print('%.9f,%.9f,%.9f' % (out[0], out[1], out[2]))


if __name__ == '__main__':
    main()
