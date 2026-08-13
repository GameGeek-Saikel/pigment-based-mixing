'use strict';
/* mixbox-fetch.js — 获取 Mixbox 参考库（研究对照用）
 *
 * 从官方 CDN (scrtwpns.com/mixbox.js, CC BY-NC 4.0, © Secret Weapons 2022)
 * 下载到系统临时目录并缓存。仅用于研究对照评测，不进入仓库。
 *
 * 用法：
 *   const { fetchMixbox } = require('./mixbox-fetch');
 *   const { source, path } = await fetchMixbox();
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const MIXBOX_URL = 'https://scrtwpns.com/mixbox.js';
const CACHE_DIR = path.join(os.tmpdir(), 'pbm-paper-tools');
const CACHE_FILE = path.join(CACHE_DIR, 'mixbox.js');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'pbm-paper-tools/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
    }).on('error', reject);
  });
}

async function fetchMixbox({ force } = {}) {
  if (!force && fs.existsSync(CACHE_FILE)) {
    const source = fs.readFileSync(CACHE_FILE, 'utf8');
    if (source.length > 0) return { source, path: CACHE_FILE, cached: true };
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  await download(MIXBOX_URL, CACHE_FILE);
  const source = fs.readFileSync(CACHE_FILE, 'utf8');
  return { source, path: CACHE_FILE, cached: false };
}

module.exports = { fetchMixbox, MIXBOX_URL, CACHE_FILE, CACHE_DIR };
