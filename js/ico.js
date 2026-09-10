/*
 * VideoFrame - ico.js
 * 纯 JS 的 ICO 图标编码器（无依赖）。
 * 采用 PNG 内嵌方案（Vista+ 及所有现代浏览器/系统均支持），保留透明通道。
 * 与其它模块解耦，仅暴露 VF.Ico。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});

  var MAX_SIZE = 256; // ICO 单边上限

  /* images: [{ png: Uint8Array, width: number, height: number }]
   * 返回 Uint8Array（完整 .ico 文件字节）
   */
  function encodeToBytes(images) {
    if (!images || !images.length) throw new Error('没有可用的图标图像');
    var count = images.length;
    var dirSize = 6 + count * 16;

    // 计算总长度
    var total = dirSize;
    for (var i = 0; i < count; i++) {
      var img = images[i];
      if (!img.png || !img.png.length) throw new Error('第 ' + (i + 1) + ' 个图标缺少图像数据');
      if (img.width < 1 || img.height < 1 || img.width > MAX_SIZE || img.height > MAX_SIZE) {
        throw new Error('图标尺寸需在 1~256 之间，收到 ' + img.width + '×' + img.height);
      }
      total += img.png.length;
    }

    var out = new Uint8Array(total);
    var dv = new DataView(out.buffer);

    // ---- ICONDIR (6 bytes) ----
    dv.setUint16(0, 0, true);          // reserved
    dv.setUint16(2, 1, true);          // type: 1 = icon
    dv.setUint16(4, count, true);      // image count

    var entryPos = 6;
    var dataPos = dirSize;
    for (var j = 0; j < count; j++) {
      var it = images[j];
      out[entryPos] = it.width >= 256 ? 0 : it.width;    // 0 表示 256
      out[entryPos + 1] = it.height >= 256 ? 0 : it.height;
      out[entryPos + 2] = 0;                              // 调色板数量（0 = 无）
      out[entryPos + 3] = 0;                              // reserved
      dv.setUint16(entryPos + 4, 1, true);                // color planes
      dv.setUint16(entryPos + 6, 32, true);               // bits per pixel
      dv.setUint32(entryPos + 8, it.png.length, true);    // 图像数据字节数
      dv.setUint32(entryPos + 12, dataPos, true);         // 数据偏移
      entryPos += 16;

      out.set(it.png, dataPos);
      dataPos += it.png.length;
    }
    return out;
  }

  VF.Ico = {
    MAX_SIZE: MAX_SIZE,
    /* 返回 Blob (image/x-icon) */
    encode: function (images) {
      return new Blob([encodeToBytes(images)], { type: 'image/x-icon' });
    },
    /* 供测试使用 */
    _encodeToBytes: encodeToBytes
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
