'use strict';
/* patch-util.js — 源码文本替换工具（补丁必须命中，避免静默失效）
 *
 * 消融/敏感性/连续性工具通过在加载前替换 javascript/color-mixing.js 的
 * 源码来构造变体。若目标字符串不存在或出现多次，替换会静默失效并导致
 * 所有变体输出相同——这里的辅助函数在未命中时直接抛错。
 *
 * 用法：
 *   const { replaceOnce, replaceAll } = require('./patch-util');
 *   const patched = replaceOnce(src, from, to, 'label');
 */

/** 替换唯一出现的 from；未命中或多次命中时抛错。 */
function replaceOnce(src, from, to, label) {
  const i = src.indexOf(from);
  if (i < 0) throw new Error('补丁目标不存在（' + label + '）：' + JSON.stringify(from.slice(0, 80)));
  if (src.indexOf(from, i + from.length) >= 0) {
    throw new Error('补丁目标不唯一（' + label + '）：' + JSON.stringify(from.slice(0, 80)));
  }
  return src.slice(0, i) + to + src.slice(i + from.length);
}

/** 替换全部出现；至少命中一次，否则抛错。 */
function replaceAll(src, from, to, label) {
  if (src.indexOf(from) < 0) throw new Error('补丁目标不存在（' + label + '）：' + JSON.stringify(from.slice(0, 80)));
  return src.split(from).join(to);
}

module.exports = { replaceOnce, replaceAll };
