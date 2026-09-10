/*
 * GitHub Pages 静态托管自检：
 *  1) index.html / .nojekyll 存在（Pages 首页与跳过 Jekyll 的关键文件）
 *  2) HTML 中所有本地 src/href 引用的文件都真实存在（大小写一致）
 *  3) 不出现以 "/" 开头的绝对路径（项目子路径部署会 404）
 * 运行：node test/pages_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(cond, msg) { if (!cond) { console.log('  FAIL: ' + msg); failures++; } }

/* 大小写敏感地判断文件是否存在 */
function existsExact(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let cur = ROOT;
  for (let i = 0; i < parts.length; i++) {
    const entries = fs.readdirSync(cur);
    const hit = entries.find(e => e === parts[i]);
    if (!hit) return false;
    cur = path.join(cur, hit);
    if (i < parts.length - 1) {
      if (!fs.statSync(cur).isDirectory()) return false;
    }
  }
  return fs.existsSync(cur) && fs.statSync(cur).isFile();
}

// 1) 关键文件
check(existsExact('index.html'), 'index.html 存在（Pages 首页）');
check(existsExact('convert.html'), 'convert.html 存在');
check(existsExact('.nojekyll'), '.nojekyll 存在（跳过 Jekyll）');
check(existsExact('assets/style.css'), 'assets/style.css 存在');

// 2) + 3) 解析所有 HTML
const htmlFiles = fs.readdirSync(ROOT).filter(f => f.toLowerCase().endsWith('.html'));
check(htmlFiles.length > 0, '存在 HTML 文件');

const pages = htmlFiles.map(f => path.join(ROOT, f));
const refRe = /(?:src|href)\s*=\s*"([^"]+)"/gi;

for (const page of pages) {
  const name = path.basename(page);
  const html = fs.readFileSync(page, 'utf8');
  let m;
  let refCount = 0;
  while ((m = refRe.exec(html)) !== null) {
    const ref = m[1].trim();
    if (!ref) continue;
    // 跳过外部链接 / 锚点 / 内联数据
    if (/^(https?:)?\/\//i.test(ref)) continue;
    if (ref.startsWith('#') || ref.startsWith('mailto:') || ref.startsWith('data:')) continue;

    refCount++;
    check(!ref.startsWith('/'), `${name}: "${ref}" 不应是以 / 开头的绝对路径`);
    if (ref.startsWith('/')) continue;

    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue; // 纯锚点
    check(existsExact(clean), `${name}: 引用 "${clean}" 的文件存在`);
  }
  check(refCount > 0, `${name}: 至少包含一个本地引用`);
}

// 4) 导航互链检查
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const conv = fs.readFileSync(path.join(ROOT, 'convert.html'), 'utf8');
  check(/href="index\.html"/.test(idx), 'index.html 导航指向 index.html');
  check(/href="convert\.html"/.test(idx), 'index.html 导航指向 convert.html');
  check(/href="index\.html"/.test(conv), 'convert.html 导航指向 index.html');
  check(/href="convert\.html"/.test(conv), 'convert.html 导航指向 convert.html');
  check(!/VideoFrame\.html/.test(idx) && !/VideoFrame\.html/.test(conv), '没有残留的 VideoFrame.html 引用');
}

console.log(`Pages static hosting test: ${failures === 0 ? 'PASS' : 'FAIL'} (failures=${failures})`);
process.exit(failures ? 1 : 0);
