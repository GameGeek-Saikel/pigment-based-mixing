'use strict';
/* svg2ascii.js — SVG 布局 ASCII 渲染器（用于无图像输入时目视检查布局）
 *
 * 支持：rect / line / polyline / circle / path（M/L/Q/C 折线近似）/ text /
 *       matplotlib 文本组（<g transform="translate(x y) scale(s -s)"> + use glyph）
 * 用法：node svg2ascii.js <svg 文件> [列数]
 */
const fs = require('fs');
const path = require('path');

/* ---------- 解析 ---------- */
function offsetFragment(inner, dx, dy) {
  let s = inner;
  const sh = (re, fn) => { s = s.replace(re, fn); };
  sh(/(<rect\s[^>]*\bx=")([\d.-]+)(" y=")([\d.-]+)(")/g, (m, a, x, b, y, c) => a + (Number(x) + dx) + b + (Number(y) + dy) + c);
  sh(/(<text\s[^>]*\bx=")([\d.-]+)(" y=")([\d.-]+)(")/g, (m, a, x, b, y, c) => a + (Number(x) + dx) + b + (Number(y) + dy) + c);
  sh(/(<line\s[^>]*\bx1=")([\d.-]+)(" y1=")([\d.-]+)(" x2=")([\d.-]+)(" y2=")([\d.-]+)(")/g,
    (m, a, x1, b, y1, c, x2, d, y2, e) => a + (Number(x1) + dx) + b + (Number(y1) + dy) + c + (Number(x2) + dx) + d + (Number(y2) + dy) + e);
  sh(/(<circle\s[^>]*\bcx=")([\d.-]+)(" cy=")([\d.-]+)(")/g, (m, a, x, b, y, c) => a + (Number(x) + dx) + b + (Number(y) + dy) + c);
  sh(/(<polyline[^>]*\bpoints=")([^"]+)(")/g, (m, a, pts, c) => {
    const p = pts.trim().split(/\s+/).map(Number);
    for (let i = 0; i < p.length; i += 2) { p[i] += dx; p[i + 1] += dy; }
    return a + p.join(' ') + c;
  });
  sh(/(<path[^>]*\bd=")([^"]+)(")/g, (m, a, d, c) => {
    const segs = d.match(/[MLQCZ][^MLQCZ]*/g) || [];
    const out = [];
    let cur = [0, 0];
    for (const seg of segs) {
      const cmd = seg[0];
      const nums = seg.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (cmd === 'M') { cur = [nums[0] + dx, nums[1] + dy]; out.push('M' + cur[0] + ' ' + cur[1]); }
      else if (cmd === 'L') { cur = [nums[0] + dx, nums[1] + dy]; out.push('L' + cur[0] + ' ' + cur[1]); }
      else if (cmd === 'Q') { cur = [nums[2] + dx, nums[3] + dy]; out.push('L' + cur[0] + ' ' + cur[1]); }
      else if (cmd === 'C') { cur = [nums[4] + dx, nums[5] + dy]; out.push('L' + cur[0] + ' ' + cur[1]); }
      else if (cmd === 'Z') { out.push('Z'); }
    }
    return a + out.join(' ') + c;
  });
  return s;
}
function flatten(src) {
  return src.replace(/<g transform="translate\(([\d.-]+),([\d.-]+)\)">([\s\S]*?)<\/g>/g,
    (m, dx, dy, inner) => offsetFragment(inner, Number(dx), Number(dy)));
}

/* path d → 线段列表 */
function pathSegments(d) {
  const segs = [];
  const parts = d.match(/[MLQCZ][^MLQCZ]*/g) || [];
  let cur = null, start = null;
  for (const seg of parts) {
    const cmd = seg[0];
    const nums = seg.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === 'M') { cur = [nums[0], nums[1]]; start = cur; }
    else if (cmd === 'L') { segs.push([cur, [nums[0], nums[1]]]); cur = [nums[0], nums[1]]; }
    else if (cmd === 'Q') { segs.push([cur, [nums[2], nums[3]]]); cur = [nums[2], nums[3]]; }
    else if (cmd === 'C') { segs.push([cur, [nums[4], nums[5]]]); cur = [nums[4], nums[5]]; }
    else if (cmd === 'Z') { if (start) { segs.push([cur, start]); cur = start; } }
  }
  return segs;
}

/* matplotlib 文本组：<g ... transform="translate(x y) scale(s -s)"> <defs>...glyph paths...</defs> <use xlink:href="#DejaVuSans-XX" transform="translate(tx ty)"/> ... */
function parseMatplotlibTexts(src) {
  const out = [];
  const re = /<g style="([^"]*)" transform="translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.-]+) -?[\d.-]+\)">([\s\S]*?)<\/g>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const style = m[1];
    const bx = Number(m[2]), by = Number(m[3]), scale = Number(m[4]);
    let chars = [];
    const useRe = /<use xlink:href="#([^"]+)" transform="translate\(([\d.-]+) ([\d.-]+)\)"/g;
    let u;
    let maxY = -1e9;
    while ((u = useRe.exec(m[5])) !== null) {
      const id = u[1];
      const h = /-([0-9a-fA-F]+)$/.exec(id);
      if (!h) continue;
      const code = parseInt(h[1], 16);
      const ch = code >= 32 && code <= 126 ? String.fromCharCode(code) : (code >= 0x4e00 ? '\uFFFD' : '?');
      chars.push({ ch, x: bx + Number(u[2]) * scale, y: by + Number(u[3]) * scale });
      if (by + Number(u[3]) * scale > maxY) maxY = by + Number(u[3]) * scale;
    }
    if (!chars.length) continue;
    out.push({ text: chars.map(c => c.ch).join(''), chars, x: bx, y: by, style });
  }
  return out;
}

/* ---------- ASCII 渲染 ---------- */
function render(svgSrc, cols) {
  const src = flatten(svgSrc);
  const w = Number(/width="([\d.]+)/.exec(src)[1]);
  const h = Number(/height="([\d.]+)/.exec(src)[1]);
  const rows = Math.max(20, Math.round(cols * (h / w) * 0.5));

  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(' '));
  const put = (x, y, ch) => {
    const c = Math.round(x / w * (cols - 1)), r = Math.round(y / h * (rows - 1));
    if (c >= 0 && c < cols && r >= 0 && r < rows) grid[r][c] = ch;
  };
  const line = (a, b, ch) => {
    const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
    const len = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    const steps = Math.max(1, Math.round(len / Math.max(w, h) * cols * 1.2));
    for (let i = 0; i <= steps; i++) put(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, ch);
  };

  /* rect */
  for (const m of src.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"[^>]*fill="([^"]*)"/g)) {
    const x = +m[1], y = +m[2], rw = +m[3], rh = +m[4], fill = m[5];
    if (fill === '#ffffff') continue;               // 背景
    line([x, y], [x + rw, y], '-');
    line([x + rw, y], [x + rw, y + rh], '|');
    line([x + rw, y + rh], [x, y + rh], '-');
    line([x, y + rh], [x, y], '|');
    /* 内部标记（浅色） */
    for (let yy = y + rh * 0.25; yy < y + rh * 0.75; yy += rh * 0.25)
      for (let xx = x + rw * 0.1; xx < x + rw * 0.9; xx += rw * 0.1) put(xx, yy, '.');
  }
  /* line */
  for (const m of src.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)) {
    line([+m[1], +m[2]], [+m[3], +m[4]], Math.abs(+m[2] - +m[4]) > Math.abs(+m[1] - +m[3]) ? '|' : '-');
  }
  /* polyline */
  for (const m of src.matchAll(/<polyline[^>]*points="([^"]+)"/g)) {
    const pts = m[1].trim().split(/\s+/).map(Number);
    for (let i = 0; i + 3 < pts.length; i += 2) line([pts[i], pts[i + 1]], [pts[i + 2], pts[i + 3]], '-');
  }
  /* path → 折线（框/箭头） */
  const pathRe = /<path[^>]*d="([^"]+)"/g;
  let pm;
  while ((pm = pathRe.exec(src)) !== null) {
    const segs = pathSegments(pm[1]);
    for (const [a, b] of segs) {
      const horiz = Math.abs(b[1] - a[1]) < Math.abs(b[0] - a[0]);
      line(a, b, horiz ? '-' : '|');
    }
  }
  /* circle */
  for (const m of src.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/g)) put(+m[1], +m[2], 'o');
  /* text（手写 SVG）：x 是锚点，需按 text-anchor 解析 */
  for (const m of src.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*text-anchor="([^"]+)"[^>]*>([^<]*)<\/text>/g)) {
    const x = +m[1], y = +m[2], anchor = m[3], t = m[4];
    const wpx = t.length * 10;
    const x0 = anchor === 'end' ? x - wpx : anchor === 'middle' ? x - wpx / 2 : x;
    for (let i = 0; i < t.length; i++) put(x0 + i * 10, y - 8, t[i]);
  }
  /* matplotlib 文本组：translate 是文本左端基线；字符 x = bx + u.x*scale */
  for (const t of parseMatplotlibTexts(src)) {
    const s = t.text.slice(0, 60);
    for (let i = 0; i < s.length; i++) put(t.chars[i].x, t.chars[i].y, s[i]);
  }

  return { w, h, rows, cols, grid };
}

const file = process.argv[2];
const cols = parseInt(process.argv[3] || '150', 10);
const src = fs.readFileSync(file, 'utf8');
const { w, h, rows, cols: C, grid } = render(src, cols);
console.log(`== ${path.basename(file)}  ${w}x${h}  网格 ${C}x${rows} ==`);
for (let r = 0; r < rows; r++) console.log(grid[r].join('').replace(/\s+$/, ''));
