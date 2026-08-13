'use strict';
/* fix-res-restore.js — 修复 RES 恢复测试的换行注入（临时，测试完由 merge 脚本决定去留） */
const fs = require('fs');
const EVAL = 'demo/color-mixing-evaluation.html';
let s = fs.readFileSync(EVAL, 'utf8');
const broken = 'ex; }`n  p += PBM_PW_CPL';
const fixed = 'ex; }\n  p += PBM_PW_CPL';
if (s.includes(broken)) {
  s = s.replace(broken, fixed);
  fs.writeFileSync(EVAL, s);
  console.log('换行已修复');
} else {
  console.log('无需修复（或模式不符）');
}
