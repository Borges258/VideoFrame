/*
 * RAW 转换往返测试：验证 RGBA/BGRA/RGB/BGR/GRAY 通道布局的导入/导出对称性。
 * 运行：node test/convert_test.js
 */
'use strict';

// Node 无 ImageData，提供最小 polyfill
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(width, height) {
      if (width && width.data) { this.width = width.width; this.height = width.height; this.data = new Uint8ClampedArray(width.data); }
      else { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); }
    }
  };
}

require('../js/utils.js');
require('../js/convert.js');
const VF = globalThis.VF;

let failures = 0;
function check(cond, msg) { if (!cond) { console.log('  FAIL: ' + msg); failures++; } }

function makeImageData(w, h, r, g, b, a) {
  const id = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = a;
  }
  return id;
}

const W = 8, H = 6;

// 每种布局的往返（含 alpha 的布局应完全还原）
for (const layout of ['rgba', 'bgra', 'rgb', 'bgr']) {
  const id = makeImageData(W, H, 11, 22, 33, 240);
  const raw = VF.Convert._imageDataToRaw(id, layout);
  const ch = VF.Convert._RAW_LAYOUTS[layout];
  check(raw.length === W * H * ch, `${layout}: raw 长度 ${raw.length} == ${W * H * ch}`);
  const back = VF.Convert._rawToImageData(raw, W, H, layout);
  // 检查通道
  let ok = true;
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    if (back.data[p] !== 11 || back.data[p + 1] !== 22 || back.data[p + 2] !== 33) { ok = false; break; }
    if (ch === 4 && back.data[p + 3] !== 240) { ok = false; break; }
    if (ch === 3 && back.data[p + 3] !== 255) { ok = false; break; }
  }
  check(ok, `${layout}: RGB 通道往返一致`);
}

// 灰度：验证亮度换算
{
  const id = makeImageData(W, H, 255, 255, 255, 255);
  const raw = VF.Convert._imageDataToRaw(id, 'gray');
  check(raw.length === W * H, `gray: 长度 ${raw.length} == ${W * H}`);
  check(raw[0] === 255, 'gray: 白色 -> 255');
  const back = VF.Convert._rawToImageData(raw, W, H, 'gray');
  check(back.data[0] === 255 && back.data[1] === 255 && back.data[2] === 255 && back.data[3] === 255, 'gray: 往返白色');
}

// 数据不足应抛错
{
  const raw = new Uint8Array(10);
  let threw = false;
  try { VF.Convert._rawToImageData(raw, 100, 100, 'rgba'); } catch (e) { threw = true; }
  check(threw, '数据不足时抛错');
}

console.log(`RAW convert test: ${failures === 0 ? 'PASS' : 'FAIL'} (failures=${failures})`);
process.exit(failures ? 1 : 0);
