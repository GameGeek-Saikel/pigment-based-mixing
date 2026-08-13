'use strict';
/* check-cross-language.js — 四语言 PBM 算法一致性测试（JS 基准）
 *
 * 用固定 seed（mulberry32 20260808）生成 2000 组随机 (base, tint, a)，
 * 分别经 javascript/color-mixing.js、python/color_mixing.py、
 * java/ColorMixing.java、cpp/color_mixing.h 计算，与 JS 基准比较
 * RGB 通道最大绝对差（比 ΔE00 更严格）。断言：max 通道差 < 1e-5
 * （预期实际为 libm 级 ~1e-7）。
 *
 * 算法文件只含混色公式；本测试经由 tools/cli/ 薄包装调用各语言：
 *   - python: tools/cli/color_mixing_py_cli.py
 *   - java:   tools/cli/ColorMixingCli.java（与 ColorMixing.java 一同编译）
 *   - cpp:    tools/cli/color_mixing_cli.cpp（include cpp/color_mixing.h）
 *
 * 用法：node check-cross-language.js [--keep-build]
 *   - 自动编译 Java（javac → 临时目录）与 C++（g++/cl → 临时目录）；
 *     C++ 优先用 g++，缺失时经 vswhere 找 VS Build Tools 的 cl。
 *
 * 退出码：0 = 全部通过；1 = 任一语言失败或编译失败。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const JS_LIB = path.join(ROOT, 'javascript', 'color-mixing.js');
const PY_CLI = path.join(ROOT, 'tools', 'cli', 'color_mixing_py_cli.py');
const JAVA_SRC = path.join(ROOT, 'java', 'ColorMixing.java');
const JAVA_CLI = path.join(ROOT, 'tools', 'cli', 'ColorMixingCli.java');
const CPP_HDR = path.join(ROOT, 'cpp', 'color_mixing.h');
const CPP_CLI = path.join(ROOT, 'tools', 'cli', 'color_mixing_cli.cpp');
const BUILD = path.join(__dirname, '.build');
const SEED = 20260808;
const N = 2000;
const TOL = 1e-5;

const keepBuild = process.argv.includes('--keep-build');

/* ---------- 测试输入（与评估页 T3 同族：mulberry32 20260808） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function genInputs(n) {
  const rnd = mulberry32(SEED);
  const lines = [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const b = [rnd(), rnd(), rnd()];
    const t = [rnd(), rnd(), rnd()];
    const a = rnd();
    rows.push({ b, t, a });
    lines.push(`${b[0]},${b[1]},${b[2]},${t[0]},${t[1]},${t[2]},${a}`);
  }
  return { rows, text: lines.join('\n') + '\n' };
}

/* ---------- 编译 ---------- */
function run(cmd, args, opts) {
  opts = opts || {};
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd} 启动失败: ${r.error.message}`);
  return r;
}

function ensureJava() {
  const cls = path.join(BUILD, 'ColorMixingCli.class');
  if (fs.existsSync(cls)) return;
  const r = run('javac', ['-d', BUILD, JAVA_SRC, JAVA_CLI]);
  if (r.status !== 0) throw new Error('javac 编译失败:\n' + r.stderr);
}

function findCl() {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!fs.existsSync(vswhere)) return null;
  const r = run(vswhere, ['-latest', '-products', '*', '-property', 'installationPath']);
  const vs = r.stdout.trim();
  if (!vs) return null;
  const vcvars = path.join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  return fs.existsSync(vcvars) ? vcvars : null;
}

function ensureCpp() {
  const exe = path.join(BUILD, 'color_mixing_cli.exe');
  if (fs.existsSync(exe)) return;
  // 优先 g++（含 MinGW/其他发行）
  let r = spawnSync('g++', ['--version'], { encoding: 'utf8' });
  if (!r.error && r.status === 0) {
    r = spawnSync('g++', ['-O2', '-std=c++17', '-I', path.join(ROOT, 'cpp'),
      '-o', exe, CPP_CLI], { encoding: 'utf8' });
    if (r.status === 0) return;
  }
  // 回退：VS Build Tools 的 cl（经 vcvars64.bat）
  const vcvars = findCl();
  if (!vcvars) throw new Error('未找到 C++ 编译器（g++ 或 Visual Studio Build Tools）');
  const bat = path.join(BUILD, 'build-cpp.bat');
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(bat,
    `@echo off\ncall "${vcvars}" >nul 2>&1\ncd /d ${ROOT}\\tools\\cli\n` +
    `cl /nologo /O2 /std:c++17 /EHsc /I ${ROOT}\\cpp /Fo${BUILD}\\ /Fe${exe} color_mixing_cli.cpp\n`);
  r = spawnSync('cmd', ['/c', bat], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('cl 编译失败:\n' + (r.stderr || r.stdout));
}

/* ---------- 执行各语言 ---------- */
function runJs(rows) {
  const C = require(JS_LIB);
  return rows.map(({ b, t, a }) => C.mixPbm(b, t, a));
}
function runPy(text) {
  const r = run(process.env.PYTHON || 'python', [PY_CLI], { input: text });
  if (r.status !== 0) throw new Error('python 失败:\n' + r.stderr);
  return parseOut(r.stdout);
}
function runJava(text) {
  ensureJava();
  const r = run('java', ['-cp', BUILD, 'ColorMixingCli'], { input: text });
  if (r.status !== 0) throw new Error('java 失败:\n' + r.stderr);
  return parseOut(r.stdout);
}
function runCpp(text) {
  ensureCpp();
  const r = run(path.join(BUILD, 'color_mixing_cli.exe'), [], { input: text });
  if (r.status !== 0) throw new Error('cpp 失败:\n' + r.stderr);
  return parseOut(r.stdout);
}
function parseOut(stdout) {
  return stdout.trim().split('\n').filter((l) => l.includes(',')).map((l) => {
    const p = l.split(',');
    return [parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2])];
  });
}

/* ---------- 比较（RGB 通道最大绝对差） ---------- */
function compare(name, rows, ref, got) {
  if (got.length !== rows.length) {
    return { name, fail: true, msg: `行数不符: ${got.length} != ${rows.length}` };
  }
  let max = 0, sum = 0, over = 0;
  for (let i = 0; i < rows.length; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) {
      const ad = Math.abs(ref[i][c] - got[i][c]);
      if (ad > d) d = ad;
    }
    if (d > max) max = d;
    sum += d;
    if (d >= TOL) over++;
  }
  return { name, fail: over > 0, max, mean: sum / rows.length, over };
}

/* ---------- main ---------- */
function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  const { rows, text } = genInputs(N);
  console.log(`基准: javascript/color-mixing.js（${N} 组，seed ${SEED}，RGB 通道最大差容差 ${TOL}）`);

  const js = runJs(rows);
  const results = [compare('javascript', rows, js, js)];
  for (const [name, fn] of [
    ['python', () => runPy(text)],
    ['java', () => runJava(text)],
    ['cpp', () => runCpp(text)],
  ]) {
    try {
      results.push(compare(name, rows, js, fn()));
    } catch (e) {
      results.push({ name, fail: true, msg: e.message });
    }
  }

  let ok = true;
  for (const r of results) {
    if (r.fail) { ok = false; console.log(`  ✗ ${r.name}: ${r.msg || `max 通道差 ${r.max.toExponential(2)} ≥ ${TOL}（${r.over} 组越界）`}`); }
    else console.log(`  ✓ ${r.name}: max 通道差 ${r.max.toExponential(2)}, mean ${r.mean.toExponential(2)}`);
  }
  if (!keepBuild) fs.rmSync(BUILD, { recursive: true, force: true });
  console.log(ok ? '\n四语言一致：通过' : '\n四语言一致：失败');
  process.exit(ok ? 0 : 1);
}

main();
