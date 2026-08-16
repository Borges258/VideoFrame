/*
 * LZW 往返测试：用独立的 spec 风格解码器验证 gif.js 的 LZW 编码器。
 * 运行：node test/lzw_test.js
 */
'use strict';
require('../js/utils.js');
require('../js/gif.js');
const VF = globalThis.VF;

/* 独立 LZW 解码器（依据 GIF89a 规范） */
function lzwDecode(bytes, minCodeSize, bumpRule) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = clearCode + 2;
  const prefix = [];
  const suffix = [];

  function init() {
    prefix.length = 0;
    suffix.length = 0;
    for (let i = 0; i < clearCode; i++) { prefix.push(-1); suffix.push(i); }
    nextCode = clearCode + 2;
    codeSize = minCodeSize + 1;
  }

  let pos = 0;
  function readCode() {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = pos >> 3;
      const bitIdx = pos & 7;
      code |= ((bytes[byteIdx] >> bitIdx) & 1) << i;
      pos++;
    }
    return code;
  }

  function firstChar(code) {
    while (prefix[code] !== -1) code = prefix[code];
    return suffix[code];
  }

  const stack = new Int32Array(4096);
  const out = [];
  function outputString(code) {
    let n = 0, c = code;
    while (prefix[c] !== -1) {
      stack[n++] = suffix[c];
      c = prefix[c];
    }
    stack[n++] = suffix[c];
    for (let i = n - 1; i >= 0; i--) out.push(stack[i]);
  }

  init();
  readCode(); // clear code
  let oldCode = readCode();
  outputString(oldCode);

  while (true) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) {
      init();
      oldCode = readCode();
      outputString(oldCode);
      continue;
    }
    const inCode = code;
    if (code < nextCode) {
      outputString(code);
      prefix[nextCode] = oldCode;
      suffix[nextCode] = firstChar(code);
      nextCode++;
    } else {
      const fc = firstChar(oldCode);
      prefix[nextCode] = oldCode;
      suffix[nextCode] = fc;
      outputString(nextCode);
      nextCode++;
    }
    const shouldBump = bumpRule === '>' ? nextCode > (1 << codeSize) : nextCode >= (1 << codeSize);
    if (shouldBump && codeSize < 12) codeSize++;
    oldCode = inCode;
  }
  return out;
}

function randomIndices(len, alphabet) {
  const a = new Uint8Array(len);
  for (let i = 0; i < len; i++) a[i] = (Math.random() * alphabet) | 0;
  return a;
}

/* 有重复序列的输入更容易触发字典扩展 */
function patternedIndices(len, alphabet) {
  const a = new Uint8Array(len);
  const seed = new Uint8Array(alphabet);
  for (let i = 0; i < alphabet; i++) seed[i] = (Math.random() * 256) | 0;
  for (let i = 0; i < len; i++) a[i] = seed[(i * 7 + (i % 5)) % alphabet];
  return a;
}

let failures = 0;
function testOne(name, indices, minCodeSize, bumpRule) {
  const encoded = VF.Gif._lzwEncode(indices, minCodeSize);
  let decoded;
  try {
    decoded = lzwDecode(encoded, minCodeSize, bumpRule);
  } catch (e) {
    console.log(`  FAIL ${name} (decode throw: ${e.message})`);
    failures++;
    return false;
  }
  if (decoded.length !== indices.length) {
    console.log(`  FAIL ${name}: length ${decoded.length} != ${indices.length}`);
    failures++;
    return false;
  }
  for (let i = 0; i < indices.length; i++) {
    if (decoded[i] !== indices[i]) {
      console.log(`  FAIL ${name}: mismatch at ${i} (${decoded[i]} != ${indices[i]})`);
      failures++;
      return false;
    }
  }
  return true;
}

const MIN = 8; // 256 色调色板
console.log('--- LZW round-trip tests (minCodeSize=' + MIN + ') ---');

// 仅测试规范正确的规则：nextCode >= (1<<codeSize)
// （错误规则会导致解码器与编码器位宽失步、无法解出 EOI 而卡死）
{
  const rule = '>=';
  console.log(`[bump rule: nextCode ${rule} (1<<codeSize)]`);
  let pass = 0, total = 0;
  const cases = [
    ['len1', [7]],
    ['len2', [7, 8]],
    ['small', [1, 2, 3, 1, 2, 3, 1, 2, 3]],
    ['abcd-repeat', [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]],
  ];
  for (let len of [10, 50, 100, 253, 254, 255, 256, 257, 258, 300, 511, 512, 513, 1000, 2000, 4095, 4096, 4097, 8000, 20000]) {
    cases.push(['rand-a16-' + len, randomIndices(len, 16)]);
    cases.push(['patt-a256-' + len, patternedIndices(len, 256)]);
  }
  // 少量长随机（更大字母表）
  for (let len of [5000, 30000]) {
    cases.push(['rand-a256-' + len, randomIndices(len, 256)]);
  }

  for (const [name, data] of cases) {
    total++;
    const idx = new Uint8Array(data);
    if (testOne(name, idx, MIN, rule)) pass++;
    else if (failures > 25) { console.log('  (too many failures, stopping)'); break; }
  }
  console.log(`  rule "${rule}": ${pass}/${total} passed`);
}

console.log(`\nTotal failures: ${failures}`);
process.exit(failures ? 1 : 0);
