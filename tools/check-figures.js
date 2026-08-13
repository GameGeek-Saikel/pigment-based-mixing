'use strict';
/* check-figures.js — SVG 布局自检
 *
 * 1. 展开 <g transform="translate(dx,dy)"> 内元素的坐标（绝对坐标化）
 * 2. 边界检查：rect/text/line/polyline/polygon/circle/path 不得越出画布
 * 3. 重叠检查：文本不得与色块/其他文本相交（文本完全位于框内视为正常排版）
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'docs', 'assets');

/* 把片段内元素的坐标平移 (dx, dy) */
function offsetFragment(inner, dx, dy) {
  let s = inner;
  s = s.replace(/(<rect\s[^>]*\bx=")([\d.-]+)(" y=")([\d.-]+)(")/g, (m, a, x, b, y, c) =>
    a + (Number(x) + dx) + b + (Number(y) + dy) + c);
  s = s.replace(/(<text\s[^>]*\bx=")([\d.-]+)(" y=")([\d.-]+)(")/g, (m, a, x, b, y, c) =>
    a + (Number(x) + dx) + b + (Number(y) + dy) + c);
  s = s.replace(/(<line\s[^>]*\bx1=")([\d.-]+)(" y1=")([\d.-]+)(" x2=")([\d.-]+)(" y2=")([\d.-]+)(")/g,
    (m, a, x1, b, y1, c, x2, d, y2, e) => a + (Number(x1) + dx) + b + (Number(y1) + dy) + c + (Number(x2) + dx) + d + (Number(y2) + dy) + e);
  s = s.replace(/(<circle\s[^>]*\bcx=")([\d.-]+)(" cy=")([\d.-]+)(")/g, (m, a, x, b, y, c) =>
    a + (Number(x) + dx) + b + (Number(y) + dy) + c);
  s = s.replace(/(<polyline\s[^>]*\bpoints=")([^"]+)(")/g, (m, a, pts, c) => {
    const p = pts.trim().split(/\s+/).map(Number);
    for (let i = 0; i < p.length; i += 2) { p[i] += dx; p[i + 1] += dy; }
    return a + p.join(' ') + c;
  });
  return s;
}

function flatten(src) {
  return src.replace(/<g transform="translate\(([\d.-]+),([\d.-]+)\)">([\s\S]*?)<\/g>/g,
    (m, dx, dy, inner) => offsetFragment(inner, Number(dx), Number(dy)));
}

function check(file) {
  const src = flatten(fs.readFileSync(file, 'utf8'));
  const w = Number(/width="([\d.]+)/.exec(src)[1]);
  const h = Number(/height="([\d.]+)/.exec(src)[1]);
  const issues = [];
  const push = msg => issues.push(msg);

  const rects = [];
  for (const m of src.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)) {
    rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
    if (+m[1] < 0 || +m[2] < 0 || +m[1] + +m[3] > w || +m[2] + +m[4] > h) push(`rect(${m[1]},${m[2]} ${m[3]}x${m[4]}) 越界`);
  }
  const texts = [];
  for (const m of src.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.-]+)"[^>]*text-anchor="([^"]+)"[^>]*>([^<]*)<\/text>/g)) {
    const x = +m[1], y = +m[2], fs = +m[3], anchor = m[4], txt = m[5];
    const wpx = txt.length * fs * 0.58;
    const bx = anchor === 'end' ? x - wpx : anchor === 'middle' ? x - wpx / 2 : x;
    const by = y - fs;
    texts.push({ x: bx, y: by, w: wpx, h: fs * 1.3, txt });
    if (x < 0 || y < 0 || x > w || y > h) push(`text "${txt}" 越界`);
  }
  for (const m of src.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 > w || y1 > h || x2 > w || y2 > h) push(`line(${x1},${y1})→(${x2},${y2}) 越界`);
  }
  for (const m of src.matchAll(/<polyline[^>]*points="([^"]+)"/g)) {
    const pts = m[1].trim().split(/\s+/).map(Number);
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < 0 || pts[i + 1] < 0 || pts[i] > w || pts[i + 1] > h) push(`polyline 点(${pts[i]},${pts[i+1]}) 越界`);
    }
  }
  for (const m of src.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/g)) {
    const cx = +m[1], cy = +m[2], r = +m[3];
    if (cx - r < 0 || cy - r < 0 || cx + r > w || cy + r > h) push(`circle(${cx},${cy} r=${r}) 越界`);
  }

  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const t of texts) for (const r of rects) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    if (overlap(t, r) && !(cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h)) {
      push(`text "${t.txt}" 与 rect(${r.x},${r.y} ${r.w}x${r.h}) 相交`);
    }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    if (overlap(texts[i], texts[j])) push(`text "${texts[i].txt}" 与 "${texts[j].txt}" 相交`);
  }
  return { w, h, issues };
}

let bad = 0;
for (const f of fs.readdirSync(DIR).filter(f => /^fig\d+.*\.svg$/.test(f))) {
  const { w, h, issues } = check(path.join(DIR, f));
  if (issues.length) {
    bad++;
    console.log(`[FAIL] ${f} (${w}x${h}):`);
    issues.forEach(i => console.log('   ' + i));
  } else {
    console.log(`[OK]   ${f} (${w}x${h})`);
  }
}
process.exit(bad ? 1 : 0);
