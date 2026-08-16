/*
 * VideoFrame - gif.js
 * 纯 JS 的 GIF89a 编码器（无依赖）。
 * 包含：median-cut 调色板量化 + 3D 查找表 + LZW 压缩 + 透明度支持。
 * 浏览器端使用 VF.Gif.encode；纯函数以 _ 前缀暴露供 Node 单元测试。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});
  var utils = VF.utils;

  /* ============================================================
   * Median-cut 颜色量化
   * samples: Uint8Array，长度 3*n（RGB 三元组）
   * 返回：[[r,g,b], ...]，长度 <= maxColors
   * ============================================================ */
  function medianCut(samples, maxColors) {
    var count = (samples.length / 3) | 0;
    if (count === 0) return [[0, 0, 0]];

    function allIndices() {
      var a = new Int32Array(count);
      for (var i = 0; i < count; i++) a[i] = i;
      return a;
    }

    function computeBounds(box) {
      var idx = box.indices;
      var rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (var i = 0; i < idx.length; i++) {
        var o = idx[i] * 3;
        var r = samples[o], g = samples[o + 1], b = samples[o + 2];
        if (r < rMin) rMin = r; if (r > rMax) rMax = r;
        if (g < gMin) gMin = g; if (g > gMax) gMax = g;
        if (b < bMin) bMin = b; if (b > bMax) bMax = b;
      }
      box.rMin = rMin; box.rMax = rMax;
      box.gMin = gMin; box.gMax = gMax;
      box.bMin = bMin; box.bMax = bMax;
      return box;
    }

    var boxes = [computeBounds({ indices: allIndices() })];

    while (boxes.length < maxColors) {
      var best = -1, bestRange = -1, bestChannel = -1;
      for (var bi = 0; bi < boxes.length; bi++) {
        var b = boxes[bi];
        var rr = b.rMax - b.rMin, gr = b.gMax - b.gMin, br = b.bMax - b.bMin;
        var range = rr, ch = 0;
        if (gr > range) { range = gr; ch = 1; }
        if (br > range) { range = br; ch = 2; }
        if (range > bestRange) { bestRange = range; best = bi; bestChannel = ch; }
      }
      if (best < 0 || bestRange <= 0) break;
      var box = boxes[best];
      if (box.indices.length < 2) break;

      var arr = Array.from(box.indices);
      var chOff = bestChannel;
      arr.sort(function (a, b2) { return samples[a * 3 + chOff] - samples[b2 * 3 + chOff]; });
      var mid = arr.length >> 1;
      var left = { indices: new Int32Array(arr.slice(0, mid)) };
      var right = { indices: new Int32Array(arr.slice(mid)) };
      computeBounds(left);
      computeBounds(right);
      boxes.splice(best, 1, left, right);
    }

    var palette = [];
    for (var pi = 0; pi < boxes.length; pi++) {
      var boxP = boxes[pi];
      var n = boxP.indices.length;
      var r = 0, g = 0, bl = 0;
      for (var j = 0; j < n; j++) {
        var o = boxP.indices[j] * 3;
        r += samples[o]; g += samples[o + 1]; bl += samples[o + 2];
      }
      palette.push([Math.round(r / n), Math.round(g / n), Math.round(bl / n)]);
    }
    return palette;
  }

  /* ============================================================
   * 3D 颜色查找表：将 24 位 RGB 快速映射到调色板索引
   * palette: Uint8Array (256*3)；start/count 限定参与匹配的颜色区间
   * ============================================================ */
  function buildLut(palette, start, count) {
    var lut = new Uint8Array(32 * 32 * 32);
    for (var r5 = 0; r5 < 32; r5++) {
      var r = (r5 << 3) | 4;
      for (var g5 = 0; g5 < 32; g5++) {
        var g = (g5 << 3) | 4;
        for (var b5 = 0; b5 < 32; b5++) {
          var b = (b5 << 3) | 4;
          var best = start, bestD = Infinity;
          for (var i = 0; i < count; i++) {
            var o = (start + i) * 3;
            var dr = palette[o] - r, dg = palette[o + 1] - g, db = palette[o + 2] - b;
            var dist = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
            if (dist < bestD) { bestD = dist; best = start + i; }
          }
          lut[(r5 * 32 + g5) * 32 + b5] = best;
        }
      }
    }
    return lut;
  }

  /* ============================================================
   * LZW 压缩（GIF 变体）
   * indices: Uint8Array（像素索引 0..255）
   * 返回：Uint8Array（LZW 压缩后的原始字节流，尚未分块）
   * ============================================================ */
  function lzwEncode(indices, minCodeSize) {
    if (!indices.length) indices = new Uint8Array([0]);
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var maxCode = (1 << codeSize) - 1;
    var nextCode = eoiCode + 1;
    var dict = new Map();
    var out = [];
    var bitBuf = 0, bitCount = 0;

    function emit(code) {
      bitBuf |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        out.push(bitBuf & 0xFF);
        bitBuf >>>= 8;
        bitCount -= 8;
      }
      if (nextCode > maxCode && codeSize < 12) {
        codeSize++;
        maxCode = (1 << codeSize) - 1;
      }
    }

    emit(clearCode);
    var current = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var byte = indices[i];
      var key = (current << 8) | byte;
      var found = dict.get(key);
      if (found !== undefined) {
        current = found;
      } else {
        emit(current);
        if (nextCode <= 4095) {
          dict.set(key, nextCode);
          nextCode++;
        } else {
          // 字典已满：先按当前位宽输出 clear，再重置
          emit(clearCode);
          dict.clear();
          nextCode = eoiCode + 1;
          codeSize = minCodeSize + 1;
          maxCode = (1 << codeSize) - 1;
        }
        current = byte;
      }
    }
    emit(current);
    emit(eoiCode);
    if (bitCount > 0) out.push(bitBuf & 0xFF);
    return new Uint8Array(out);
  }

  /* 将 LZW 字节流切分为 GIF 子块，并加上 min-code-size 字节与结束块 */
  function lzwData(indices, minCodeSize) {
    var bytes = lzwEncode(indices, minCodeSize);
    var parts = [new Uint8Array([minCodeSize])];
    for (var i = 0; i < bytes.length; i += 255) {
      var n = Math.min(255, bytes.length - i);
      var block = new Uint8Array(n + 1);
      block[0] = n;
      block.set(bytes.subarray(i, i + n), 1);
      parts.push(block);
    }
    parts.push(new Uint8Array([0]));
    return utils.concatBytes(parts);
  }

  /* ---------- GIF 结构片段 ---------- */
  function lsd(width, height) {
    var b = new Uint8Array(7);
    var v = new DataView(b.buffer);
    v.setUint16(0, width, true);
    v.setUint16(2, height, true);
    v.setUint8(4, 0xF7); // GCT 标志 + 8bit 色深 + 256 项表
    v.setUint8(5, 0);    // 背景色索引
    v.setUint8(6, 0);    // 像素宽高比
    return b;
  }

  function netscapeExt(loop) {
    var b = new Uint8Array(19);
    b[0] = 0x21; b[1] = 0xFF; b[2] = 0x0B;
    b.set(new TextEncoder().encode('NETSCAPE2.0'), 3);
    b[14] = 0x03; b[15] = 0x01;
    b[16] = loop & 0xFF;
    b[17] = (loop >> 8) & 0xFF;
    b[18] = 0x00;
    return b;
  }

  function gce(delayCs, transparent, transparentIndex) {
    var b = new Uint8Array(8);
    b[0] = 0x21; b[1] = 0xF9; b[2] = 0x04;
    // packed: disposal method 2 (恢复为背景) + 透明标志
    b[3] = (2 << 2) | (transparent ? 1 : 0);
    b[4] = delayCs & 0xFF;
    b[5] = (delayCs >> 8) & 0xFF;
    b[6] = transparent ? transparentIndex : 0;
    b[7] = 0x00;
    return b;
  }

  function imageDescriptor(width, height) {
    var b = new Uint8Array(10);
    var v = new DataView(b.buffer);
    v.setUint8(0, 0x2C);
    v.setUint16(1, 0, true);
    v.setUint16(3, 0, true);
    v.setUint16(5, width, true);
    v.setUint16(7, height, true);
    v.setUint8(9, 0);
    return b;
  }

  function parseColor(str) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(str).trim());
    if (m) {
      var v = parseInt(m[1], 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    return [255, 255, 255];
  }

  /* ============================================================
   * 主入口
   * 支持两种调用方式：
   *   1) opts.frames: [ImageData]（一次性传入）
   *   2) opts.count + opts.dims + opts.getFrame(i)（流式，逐帧加载，节省内存）
   * opts 其它字段：delay(ms), loop(0/1), background('transparent'|'#RRGGBB'),
   *               onProgress(done, total)
   * 返回：Blob (image/gif)
   * ============================================================ */
  VF.Gif = {
    encode: async function (opts) {
      var count, getFrame;
      if (opts.frames && opts.frames.length) {
        count = opts.frames.length;
        getFrame = function (i) { return Promise.resolve(opts.frames[i]); };
      } else {
        count = opts.count || 0;
        getFrame = opts.getFrame;
      }
      if (!count) throw new Error('没有可导出的帧');

      var delayCs = Math.max(2, Math.round((opts.delay != null ? opts.delay : 100) / 10));
      var loop = opts.loop === 1 ? 1 : 0;
      var background = (opts.background && opts.background !== 'transparent') ? opts.background : null;

      // 计算逻辑画布尺寸（取所有帧的最大宽高）
      var maxW = 0, maxH = 0;
      for (var mi = 0; mi < count; mi++) {
        var md = opts.dims ? opts.dims[mi] : null;
        if (!md) { var mf = await getFrame(mi); md = mf; }
        if (md.width > maxW) maxW = md.width;
        if (md.height > maxH) maxH = md.height;
      }
      var width = maxW, height = maxH;

      // 归一化画布（惰性创建，仅当帧尺寸不一致时使用）
      var tmp = null, main = null, mctx = null;
      function normalizeFrame(f) {
        if (f.width === width && f.height === height) return f;
        if (!tmp) {
          tmp = document.createElement('canvas');
          main = document.createElement('canvas');
          main.width = width;
          main.height = height;
          mctx = main.getContext('2d');
        }
        tmp.width = f.width;
        tmp.height = f.height;
        tmp.getContext('2d').putImageData(f, 0, 0);
        mctx.clearRect(0, 0, width, height);
        mctx.drawImage(tmp, Math.floor((width - f.width) / 2), Math.floor((height - f.height) / 2));
        return mctx.getImageData(0, 0, width, height);
      }

      // 采样并检测透明像素（流式）
      var MAX_SAMPLES = 400000;
      var perFrame = Math.max(1, Math.floor(MAX_SAMPLES / Math.max(1, count)));
      var hasAlpha = false;
      var sampleChunks = [];
      for (var s = 0; s < count; s++) {
        var sf = normalizeFrame(await getFrame(s));
        var sd = sf.data;
        var spx = sd.length / 4;
        var sstride = Math.max(1, Math.ceil(spx / perFrame));
        for (var sp = 0; sp < sd.length; sp += 4 * sstride) {
          if (sd[sp + 3] < 128) { hasAlpha = true; continue; }
          sampleChunks.push(sd[sp], sd[sp + 1], sd[sp + 2]);
        }
        if ((s & 7) === 7) await utils.yield();
      }
      var samples = Uint8Array.from(sampleChunks);

      var useTransparency = hasAlpha && !background;
      var colorCount = useTransparency ? 255 : 256;
      var colorStart = useTransparency ? 1 : 0;
      var transparentIndex = useTransparency ? 0 : -1;

      // 调色板
      var quantColors = medianCut(samples, colorCount);
      var palette = new Uint8Array(256 * 3);
      for (var c0 = 0; c0 < quantColors.length && c0 < colorCount; c0++) {
        var o = (colorStart + c0) * 3;
        palette[o] = quantColors[c0][0];
        palette[o + 1] = quantColors[c0][1];
        palette[o + 2] = quantColors[c0][2];
      }

      // 查找表 + 背景色索引
      var lut = buildLut(palette, colorStart, colorCount);
      var bgIndex = 0;
      if (background) {
        var rgb = parseColor(background);
        bgIndex = lut[((rgb[0] >> 3) * 32 + (rgb[1] >> 3)) * 32 + (rgb[2] >> 3)];
      }

      // 组装
      var chunks = [];
      chunks.push(new TextEncoder().encode('GIF89a'));
      chunks.push(lsd(width, height));
      chunks.push(palette);
      chunks.push(netscapeExt(loop));

      var minCodeSize = 8;
      for (var fi = 0; fi < count; fi++) {
        var fd = normalizeFrame(await getFrame(fi)).data;
        var indices = new Uint8Array(width * height);
        var frameHasAlpha = false;
        for (var y = 0; y < height; y++) {
          var row = y * width;
          for (var x = 0; x < width; x++) {
            var pi = (row + x) * 4;
            var a = fd[pi + 3];
            var idx;
            if (a < 128) {
              frameHasAlpha = true;
              idx = background ? bgIndex : transparentIndex;
            } else {
              idx = lut[((fd[pi] >> 3) * 32 + (fd[pi + 1] >> 3)) * 32 + (fd[pi + 2] >> 3)];
            }
            indices[row + x] = idx;
          }
        }
        chunks.push(gce(delayCs, useTransparency && frameHasAlpha, transparentIndex));
        chunks.push(imageDescriptor(width, height));
        chunks.push(lzwData(indices, minCodeSize));
        if (opts.onProgress) opts.onProgress(fi + 1, count);
        if ((fi & 3) === 3) await utils.yield();
      }
      chunks.push(new Uint8Array([0x3B]));
      return new Blob([utils.concatBytes(chunks)], { type: 'image/gif' });
    },

    /* 以下仅供测试 */
    _medianCut: medianCut,
    _buildLut: buildLut,
    _lzwEncode: lzwEncode,
    _lzwData: lzwData
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
