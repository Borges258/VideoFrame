'use strict';
const fs = require('fs');
const path = require('path');
require('../js/utils.js');
require('../js/gif.js');
const VF = globalThis.VF;

function makeFrame(w, h, c) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = c[0]; data[i+1] = c[1]; data[i+2] = c[2]; data[i+3] = 255; }
  return { width: w, height: h, data };
}
const W = 32, H = 24, N = 5;
const frames = [];
for (let i = 0; i < N; i++) frames.push(makeFrame(W, H, [i * 40, 100, 200 - i * 30]));

(async () => {
  // 流式路径
  const blob = await VF.Gif.encode({
    count: N,
    dims: frames.map(f => ({ width: f.width, height: f.height })),
    getFrame: async (i) => frames[i],
    delay: 90, loop: 0, background: 'transparent'
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  const ok = new TextDecoder('latin1').decode(bytes.slice(0, 6)) === 'GIF89a'
    && dv.getUint16(6, true) === W && dv.getUint16(8, true) === H;
  console.log('STREAM_ENCODE ' + (ok ? 'PASS' : 'FAIL') + ' bytes=' + bytes.length);
  fs.writeFileSync(path.join(__dirname, '_out_stream.gif'), Buffer.from(bytes));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('THREW ' + e.message); process.exit(1); });
