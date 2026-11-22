'use strict';
/* svg-to-pdf.js — 把 docs/assets/*.svg 转为 LaTeX 插图 PDF（矢量）
 *
 * 使用本机 Microsoft Edge / Google Chrome 的 headless print-to-pdf 渲染：
 * 每个 SVG 包进一个按原尺寸设置 @page 的 HTML，浏览器输出矢量 PDF。
 * 输出目录：docs/paper/figures/（由 docs/paper/*.tex 引用）。
 *
 * 依赖：Windows 上的 Edge 或 Chrome（脚本自动探测常见安装路径）。
 * 用法：node svg-to-pdf.js [--out <dir>]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC_DIR = path.join(__dirname, '..', 'docs', 'assets');
const OUT_DIR = path.join(__dirname, '..', 'docs', 'paper', 'figures');
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findBrowser() {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Edge/Chrome；请安装其一，或用任意 SVG→PDF 工具手工转换。');
}

/* 读取 SVG 根尺寸，返回 PDF 点（1/72 in）。px 按 96 dpi 换算。 */
function svgSizePt(src) {
  const root = /<svg\b[^>]*>/.exec(src);
  if (!root) throw new Error('缺少 <svg> 根元素');
  const attr = (name) => {
    const m = new RegExp(name + '="([0-9.]+)(pt|px)?"').exec(root[0]);
    return m ? { value: parseFloat(m[1]), unit: m[2] || 'px' } : null;
  };
  const w = attr('width'), h = attr('height');
  if (!w || !h) throw new Error('SVG 根元素缺少 width/height');
  const toPt = (x) => x.unit === 'pt' ? x.value : x.value * 0.75;
  return [toPt(w), toPt(h)];
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : OUT_DIR;
  const browser = findBrowser();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbm-svg2pdf-'));
  const profile = path.join(tmp, 'profile');
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(SRC_DIR).filter(f => /^fig\d+.*\.svg$/.test(f)).sort();
  let ok = 0;
  for (const f of files) {
    const srcPath = path.join(SRC_DIR, f);
    const src = fs.readFileSync(srcPath, 'utf8');
    const [wPt, hPt] = svgSizePt(src);
    const htmlPath = path.join(tmp, f.replace(/\.svg$/, '.html'));
    const pdfPath = path.join(outDir, f.replace(/\.svg$/, '.pdf'));
    const url = 'file:///' + srcPath.replace(/\\/g, '/');
    fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8">
<style>
@page { size: ${wPt}pt ${hPt}pt; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
img { display: block; width: ${wPt}pt; height: ${hPt}pt;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
<img src="${url}">
`);
    const r = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + profile, '--no-pdf-header-footer',
      '--print-to-pdf=' + pdfPath, 'file:///' + htmlPath.replace(/\\/g, '/'),
    ], { encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0 || !fs.existsSync(pdfPath)) {
      throw new Error('转换失败: ' + f + '\n' + (r.stderr || r.stdout || ''));
    }
    const pdf = fs.readFileSync(pdfPath).toString('latin1');
    const media = (/\/MediaBox\s*\[([^\]]*)\]/.exec(pdf) || [])[1];
    const raster = /\/Subtype\s*\/Image/.test(pdf);
    console.log(f.padEnd(24), '->', path.basename(pdfPath), ' ' + wPt + 'x' + hPt + 'pt',
      media ? 'MediaBox[' + media.trim() + ']' : '', raster ? '(RASTER!)' : '(vector)');
    ok++;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('converted', ok, 'figures ->', outDir);
}

try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
