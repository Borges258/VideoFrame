/*
 * ZIP 打包测试：生成 ZIP 并解析结构验证，同时写 test/_out.zip 供外部解压验证。
 * 运行：node test/zip_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('../js/utils.js');
require('../js/zip.js');
const VF = globalThis.VF;

(async () => {
  const files = [
    { name: 'frame_0001.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) },
    { name: 'frame_0002.png', data: new Uint8Array(5000).fill(42) },
    { name: '帧_0003.png', data: new TextEncoder().encode('你好，世界！VideoFrame 测试数据。'.repeat(100)) },
  ];
  const blob = await VF.Zip.createZip(files);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  fs.writeFileSync(path.join(__dirname, '_out.zip'), Buffer.from(bytes));

  let ok = true;
  function check(cond, msg) { if (!cond) { console.log('  FAIL: ' + msg); ok = false; } }
  const dv = new DataView(bytes.buffer);

  // 依次解析 local headers
  let pos = 0;
  const parsed = [];
  for (let i = 0; i < files.length; i++) {
    check(dv.getUint32(pos, true) === 0x04034B50, `local header ${i} signature`);
    const method = dv.getUint16(pos + 8, true);
    const crc = dv.getUint32(pos + 14, true);
    const compSize = dv.getUint32(pos + 18, true);
    const rawSize = dv.getUint32(pos + 22, true);
    const nameLen = dv.getUint16(pos + 26, true);
    const extraLen = dv.getUint16(pos + 28, true);
    const name = new TextDecoder().decode(bytes.slice(pos + 30, pos + 30 + nameLen));
    check(name === files[i].name, `local header ${i} name "${name}" == "${files[i].name}"`);
    const dataStart = pos + 30 + nameLen + extraLen;
    const data = bytes.slice(dataStart, dataStart + compSize);
    check(data.length === compSize, `local header ${i} comp size`);
    check(compSize === rawSize || method === 8, `local header ${i} method ${method} consistent`);
    // CRC 校验
    const expectCrc = VF.utils.crc32(files[i].data);
    check(crc === expectCrc, `local header ${i} crc ${crc.toString(16)} == ${expectCrc.toString(16)}`);
    parsed.push({ method, compSize, rawSize, data, crc, name });
    pos = dataStart + compSize;
  }

  // 解压 DEFLATE 校验内容
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    let inflated = p.data;
    if (p.method === 8) {
      const d = new DecompressionStream('deflate-raw');
      const out = new Uint8Array(await new Response(new Blob([p.data]).stream().pipeThrough(d)).arrayBuffer());
      inflated = out;
    }
    check(inflated.length === p.rawSize, `file ${i} inflated size ${inflated.length} == ${p.rawSize}`);
    let same = inflated.length === files[i].data.length;
    for (let j = 0; same && j < inflated.length; j++) if (inflated[j] !== files[i].data[j]) same = false;
    check(same, `file ${i} content round-trips`);
  }

  // Central directory + EOCD
  const eocdPos = bytes.length - 22;
  check(dv.getUint32(eocdPos, true) === 0x06054B50, 'EOCD signature');
  const totalEntries = dv.getUint16(eocdPos + 10, true);
  check(totalEntries === files.length, `EOCD entry count ${totalEntries} == ${files.length}`);
  const cdOffset = dv.getUint32(eocdPos + 16, true);
  check(dv.getUint32(cdOffset, true) === 0x02014B50, 'central directory signature');

  console.log(`ZIP create+parse test: ${ok ? 'PASS' : 'FAIL'} (bytes=${bytes.length})`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('ZIP THREW: ' + e.message); process.exit(1); });
