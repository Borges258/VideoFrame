/*
 * ICO 编码测试：用自建的最小 PNG 生成器构造真实 PNG，
 * 再打包为 ICO，校验结构，并输出 test/_out.ico 供外部（GDI+）验证。
 * 运行：node test/ico_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('../js/utils.js');
require('../js/ico.js');
const VF = globalThis.VF;

/* ---- 最小 PNG 生成器（RGBA, 8bit, 无隔行） ---- */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(VF.utils.crc32(new Uint8Array(body)) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const raw = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const c = pixelFn(x, y);
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2]; raw[o++] = c[3];
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

let failures = 0;
function check(cond, msg) { if (!cond) { console.log('  FAIL: ' + msg); failures++; } }

const png16 = makePng(16, 16, () => [255, 0, 0, 255]);
const png32 = makePng(32, 32, () => [0, 200, 0, 255]);
const png256 = makePng(256, 256, () => [0, 0, 255, 128]);

const images = [
  { png: new Uint8Array(png16), width: 16, height: 16 },
  { png: new Uint8Array(png32), width: 32, height: 32 },
  { png: new Uint8Array(png256), width: 256, height: 256 }
];

const bytes = VF.Ico._encodeToBytes(images);
fs.writeFileSync(path.join(__dirname, '_out.ico'), Buffer.from(bytes));

const dv = new DataView(bytes.buffer);
check(dv.getUint16(0, true) === 0, 'ICONDIR reserved = 0');
check(dv.getUint16(2, true) === 1, 'ICONDIR type = 1 (icon)');
check(dv.getUint16(4, true) === 3, 'ICONDIR count = 3');

const expectDirSize = 6 + 3 * 16;
check(bytes.length === expectDirSize + png16.length + png32.length + png256.length, '文件总长度正确');

// 逐条目校验
let expectedOffset = expectDirSize;
for (let i = 0; i < 3; i++) {
  const p = 6 + i * 16;
  const img = images[i];
  const w = bytes[p];
  const h = bytes[p + 1];
  const planes = dv.getUint16(p + 4, true);
  const bpp = dv.getUint16(p + 6, true);
  const size = dv.getUint32(p + 8, true);
  const off = dv.getUint32(p + 12, true);
  const expW = img.width >= 256 ? 0 : img.width;
  check(w === expW && h === expW, `条目 ${i} 宽高字节 = ${expW}（256 记 0），实际 ${w}/${h}`);
  check(planes === 1, `条目 ${i} planes = 1`);
  check(bpp === 32, `条目 ${i} bpp = 32`);
  check(size === img.png.length, `条目 ${i} 数据长度 = ${img.png.length}`);
  check(off === expectedOffset, `条目 ${i} 偏移 = ${expectedOffset}`);
  // PNG 签名
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  let ok = true;
  for (let k = 0; k < 8; k++) if (bytes[off + k] !== sig[k]) { ok = false; break; }
  check(ok, `条目 ${i} 数据为合法 PNG 签名`);
  expectedOffset += img.png.length;
}

// 越界尺寸应抛错
{
  let threw = false;
  try { VF.Ico._encodeToBytes([{ png: new Uint8Array([1, 2, 3]), width: 512, height: 512 }]); } catch (e) { threw = true; }
  check(threw, '超过 256 的尺寸应抛错');
}

console.log(`ICO encode test: ${failures === 0 ? 'PASS' : 'FAIL'} (failures=${failures}, bytes=${bytes.length})`);
process.exit(failures ? 1 : 0);
