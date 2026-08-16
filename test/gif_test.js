/*
 * 完整 GIF 编码测试：生成 GIF，解析结构并解码 LZW，验证正确性。
 * 运行：node test/gif_test.js
 * 额外产出 test/_out.gif 供外部解码器（GDI+）做独立验证。
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('../js/utils.js');
require('../js/gif.js');
const VF = globalThis.VF;

/* ---- 独立 LZW 解码器（与 lzw_test 相同规范实现） ---- */
function lzwDecode(bytes, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = clearCode + 2;
  const prefix = [], suffix = [];
  function init() {
    prefix.length = 0; suffix.length = 0;
    for (let i = 0; i < clearCode; i++) { prefix.push(-1); suffix.push(i); }
    nextCode = clearCode + 2; codeSize = minCodeSize + 1;
  }
  let pos = 0;
  function readCode() {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = pos >> 3, bitIdx = pos & 7;
      code |= ((bytes[byteIdx] >> bitIdx) & 1) << i;
      pos++;
    }
    return code;
  }
  function firstChar(code) { while (prefix[code] !== -1) code = prefix[code]; return suffix[code]; }
  const stack = new Int32Array(4096);
  const out = [];
  function outputString(code) {
    let n = 0, c = code;
    while (prefix[c] !== -1) { stack[n++] = suffix[c]; c = prefix[c]; }
    stack[n++] = suffix[c];
    for (let i = n - 1; i >= 0; i--) out.push(stack[i]);
  }
  init();
  readCode();
  let oldCode = readCode();
  outputString(oldCode);
  while (true) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) { init(); oldCode = readCode(); outputString(oldCode); continue; }
    const inCode = code;
    if (code < nextCode) {
      outputString(code);
      prefix[nextCode] = oldCode; suffix[nextCode] = firstChar(code); nextCode++;
    } else {
      const fc = firstChar(oldCode);
      prefix[nextCode] = oldCode; suffix[nextCode] = fc; outputString(nextCode); nextCode++;
    }
    if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
    oldCode = inCode;
  }
  return out;
}

/* ---- 构造合成帧（ImageData 形状的普通对象，尺寸一致避免使用 canvas） ---- */
function makeFrame(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      fill(data, p, x, y);
    }
  }
  return { width: w, height: h, data };
}

const W = 40, H = 30;
const frames = [];
// 帧 1：红色渐变 + 左上角透明
frames.push(makeFrame(W, H, (d, p, x, y) => {
  d[p] = 255 - (x * 6); d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = 255;
  if (x < 5 && y < 5) d[p + 3] = 0; // 透明
}));
// 帧 2：绿色渐变
frames.push(makeFrame(W, H, (d, p, x, y) => {
  d[p] = 0; d[p + 1] = 255 - (y * 8); d[p + 2] = 0; d[p + 3] = 255;
}));
// 帧 3：蓝色 + 右下角透明
frames.push(makeFrame(W, H, (d, p, x, y) => {
  d[p] = 0; d[p + 1] = 0; d[p + 2] = 255 - (x * 4); d[p + 3] = 255;
  if (x >= W - 6 && y >= H - 6) d[p + 3] = 0;
}));

(async () => {
  const gif = VF.Gif;
  const blob = await gif.encode({ frames, delay: 120, loop: 0, background: 'transparent' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  fs.writeFileSync(path.join(__dirname, '_out.gif'), Buffer.from(bytes));

  /* ---- 解析 GIF 结构 ---- */
  const txt = new TextDecoder('latin1');
  let ok = true;
  function check(cond, msg) { if (!cond) { console.log('  FAIL: ' + msg); ok = false; } }

  check(txt.decode(bytes.slice(0, 6)) === 'GIF89a', 'header GIF89a');

  const dv = new DataView(bytes.buffer);
  const width = dv.getUint16(6, true);
  const height = dv.getUint16(8, true);
  check(width === W && height === H, `LSD size ${width}x${height} == ${W}x${H}`);

  const packed = bytes[10];
  check((packed & 0x80) !== 0, 'GCT flag set');
  const gctSize = 1 << ((packed & 0x07) + 1);
  check(gctSize === 256, 'GCT has 256 entries');

  let pos = 13 + gctSize * 3; // 跳过 header(6) + LSD(7) + GCT(768)

  // NETSCAPE 扩展
  check(bytes[pos] === 0x21 && bytes[pos + 1] === 0xFF, 'NETSCAPE ext present');
  const loop = bytes[pos + 16] | (bytes[pos + 17] << 8);
  check(loop === 0, `loop=0 (无限), got ${loop}`);
  pos += 19;

  // 逐帧
  const decoded = [];
  for (let f = 0; f < frames.length; f++) {
    check(bytes[pos] === 0x21 && bytes[pos + 1] === 0xF9, `frame ${f}: GCE`);
    const gcePacked = bytes[pos + 3];
    const delayCs = bytes[pos + 4] | (bytes[pos + 5] << 8);
    check(delayCs === 12, `frame ${f}: delay=12cs (120ms), got ${delayCs}`);
    const hasTransparency = (gcePacked & 1) !== 0;
    const transparentIndex = bytes[pos + 6];
    pos += 8;

    check(bytes[pos] === 0x2C, `frame ${f}: image descriptor`);
    const fw = dv.getUint16(pos + 5, true);
    const fh = dv.getUint16(pos + 7, true);
    check(fw === W && fh === H, `frame ${f}: image size ${fw}x${fh}`);
    pos += 10;

    const minCodeSize = bytes[pos]; pos += 1;
    check(minCodeSize === 8, `frame ${f}: minCodeSize=8`);
    // 收集子块
    const raw = [];
    while (true) {
      const n = bytes[pos]; pos += 1;
      if (n === 0) break;
      for (let i = 0; i < n; i++) raw.push(bytes[pos + i]);
      pos += n;
    }
    const idx = lzwDecode(new Uint8Array(raw), minCodeSize);
    check(idx.length === W * H, `frame ${f}: decoded ${idx.length} px == ${W * H}`);
    if (hasTransparency) {
      let hasT = false;
      for (const v of idx) if (v === transparentIndex) { hasT = true; break; }
      check(hasT, `frame ${f}: contains transparent index ${transparentIndex}`);
    } else {
      let hasT = false;
      for (const v of idx) if (v === transparentIndex) { hasT = true; break; }
      check(!hasT, `frame ${f}: should NOT contain transparent index (opaque frame)`);
    }
    decoded.push(idx);
  }

  check(bytes[pos] === 0x3B, 'trailer 0x3B');

  // 验证透明像素确实落在透明索引上（帧0左上角、帧2右下角）
  // 有透明像素时透明索引恒为 0
  const tIdx = 0;
  check(decoded[0][0] === tIdx, 'frame0 top-left transparent pixel -> transparent index');
  check(decoded[0][W * H - 1] !== tIdx, 'frame0 bottom-right opaque');
  check(decoded[2][W * H - 1] === tIdx, 'frame2 bottom-right transparent');
  check(decoded[2][0] !== tIdx, 'frame2 top-left opaque');

  console.log(`GIF encode+parse test: ${ok ? 'PASS' : 'FAIL'} (bytes=${bytes.length})`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('ENCODE THREW: ' + e.message); process.exit(1); });
