'use strict';
/* suite-loader.js — 无头加载混色评估套件（node）
 *
 * 依次在 node:vm 上下文中执行：
 *   1. javascript/color-mixing.js（算法库 → window.ColorMixing）
 *   2. demo/color-mixing-evaluation.js（评估套件 + UI → window.__Suite）
 * 不改动原页面。patch / exportInternals 机制与原内联版相同。
 *
 * 用法：
 *   const { loadSuite } = require('./suite-loader');
 *   const ctx = loadSuite({ mixboxSource: fs.readFileSync(mixboxJs, 'utf8') });
 *   const suite = ctx.suite;                 // window.__Suite
 *   const scripts = ctx.scripts;             // 执行过的脚本源码数组
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CM_LIB = path.join(__dirname, '..', 'javascript', 'color-mixing.js');
const EVAL_SCRIPT = path.join(__dirname, '..', 'demo', 'color-mixing-evaluation.js');

/**
 * 加载套件。
 * @param {object} opts
 * @param {string} [opts.mixboxSource] mixbox.js 源码（先在上下文中执行）
 * @param {string} [opts.scriptPath] 自定义页面脚本路径（默认 demo/color-mixing-evaluation.js）
 * @param {object} [opts.patch] 可选：对页面脚本源码做文本替换（消融用）
 * @param {boolean} [opts.exportInternals] 在脚本末尾注入内部函数导出（buildT1..T3、
 *   T5_DEF/T2_DEF 等 const，供 held-out/tail 集构造使用）
 * @returns {{ suite: object, sandbox: object, scripts: string[] }}
 */
function loadSuite(opts) {
  opts = opts || {};
  const libSrc = fs.readFileSync(CM_LIB, 'utf8');
  let pageSrc = fs.readFileSync(opts.scriptPath || EVAL_SCRIPT, 'utf8');
  if (opts.patch) pageSrc = opts.patch(pageSrc);
  if (opts.exportInternals) {
    pageSrc = pageSrc + '\n' +
      'window.__Suite.__internals = { buildT1, buildT2, buildT3, buildT5, buildT5Random, buildT5E, ' +
      'T5_DEF, T2_DEF, ' +
      'ALPHAS_T5, ALPHAS, PRESETS_BASE, PRESETS_TINT, T5_SEED, T5_RANDOM_N, ' +
      'mixPbm, mixLerp, kmDual, rgbToLab, HEX2RGB, SRGB2LIN, ' +
      'deltaE2000, mulberry32, clamp };';
  }

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance: { now: () => Date.now() },
    Math, JSON, Date, RegExp, Error, Array, Object, String, Number, Boolean,
    Promise, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent,
    decodeURIComponent, Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect,
    Uint8Array, Uint16Array, Uint32Array, Float32Array, Float64Array, Int8Array,
    Int16Array, Int32Array, ArrayBuffer, DataView, BigInt, Number, globalThis: null
  };
  sandbox.window = sandbox;   // 页面代码以 window.__Suite 暴露
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.navigator = { userAgent: 'node' };
  sandbox.document = undefined;
  vm.createContext(sandbox);

  if (opts.mixboxSource) {
    vm.runInContext(opts.mixboxSource, sandbox, { filename: 'mixbox.js' });
  }
  vm.runInContext(libSrc, sandbox, { filename: 'color-mixing.js' });
  vm.runInContext(pageSrc, sandbox, { filename: 'color-mixing-evaluation.js' });

  const suite = sandbox.window.__Suite;
  if (!suite) throw new Error('__Suite 未在上下文中暴露（脚本执行失败？）');
  return { suite, sandbox, scripts: [libSrc, pageSrc] };
}

module.exports = { loadSuite, CM_LIB, EVAL_SCRIPT };
