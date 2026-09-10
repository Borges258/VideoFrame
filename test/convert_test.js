/*
 * 图片转换相关测试：
 *  1) RAW 通道布局的导入/导出对称性
 *  2) 画幅比例的纯计算逻辑
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
require('../js/imgtools.js');
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

/* ---------- 画幅比例计算 ---------- */
{
  const ca = VF.ImgTools.computeAspect;
  const eq = (name, got, expW, expH) =>
    check(got.width === expW && got.height === expH,
      `${name}: ${got.width}x${got.height} 应为 ${expW}x${expH}`);

  eq('100x100 1:1 fit', ca(100, 100, 1, 1, 'fit'), 100, 100);
  eq('200x100 1:1 fit', ca(200, 100, 1, 1, 'fit'), 200, 200);
  eq('200x100 1:1 fill', ca(200, 100, 1, 1, 'fill'), 100, 100);
  eq('100x200 1:1 fit', ca(100, 200, 1, 1, 'fit'), 200, 200);
  eq('100x200 1:1 fill', ca(100, 200, 1, 1, 'fill'), 100, 100);
  eq('200x100 4:3 fit', ca(200, 100, 4, 3, 'fit'), 200, 150);
  eq('200x100 4:3 fill', ca(200, 100, 4, 3, 'fill'), 133, 100);
  eq('200x100 16:9 fit', ca(200, 100, 16, 9, 'fit'), 200, 113);
  eq('200x100 16:9 fill', ca(200, 100, 16, 9, 'fill'), 178, 100);

  // fit 必须完整容纳原图；fill 必须覆盖原图
  const fit = ca(200, 100, 1, 1, 'fit');
  check(fit.width >= 200 && fit.height >= 100, 'fit 不裁切原图');
  const fill = ca(200, 100, 1, 1, 'fill');
  check(fill.width <= 200 && fill.height <= 100, 'fill 不超过原图范围');
}

console.log(`Image convert test: ${failures === 0 ? 'PASS' : 'FAIL'} (failures=${failures})`);
process.exit(failures ? 1 : 0);
