/*
 * VideoFrame - utils.js
 * 通用工具函数（无依赖，浏览器与 Node 测试环境通用）。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});
  var utils = (VF.utils = {});

  /* 数字补零 */
  utils.pad = function (n, width) {
    return String(n).padStart(width || 4, '0');
  };

  /* 触发浏览器下载 */
  utils.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  };

  utils.formatBytes = function (bytes) {
    if (bytes === null || bytes === undefined) return '-';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
  };

  utils.formatDuration = function (seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  };

  /* Blob -> HTMLImageElement */
  utils.blobToImage = function (blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  };

  /* HTMLImageElement -> ImageData */
  utils.imageToImageData = function (img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  };

  /* Blob -> ImageData */
  utils.blobToImageData = async function (blob) {
    var img = await utils.blobToImage(blob);
    return utils.imageToImageData(img);
  };

  /* ImageData -> PNG Blob */
  utils.imageDataToBlob = function (imageData) {
    var c = document.createElement('canvas');
    c.width = imageData.width;
    c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('PNG 编码失败'));
      }, 'image/png');
    });
  };

  /* ---------- CRC32 ---------- */
  var crcTable = null;
  utils.crc32 = function (bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  /* ---------- 原始 DEFLATE（用于 ZIP） ----------
   * 通过浏览器原生 CompressionStream('deflate-raw') 压缩。
   * 若环境不支持则返回 null（调用方回退到 STORE 无压缩）。
   */
  utils.deflateRaw = async function (bytes) {
    try {
      if (typeof CompressionStream === 'undefined') return null;
      var blob = new Blob([bytes]);
      var stream = blob.stream().pipeThrough(new CompressionStream('deflate-raw'));
      var buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return null;
    }
  };

  /* 拼接多个 Uint8Array */
  utils.concatBytes = function (arrays) {
    var total = 0;
    for (var i = 0; i < arrays.length; i++) total += arrays[i].length;
    var out = new Uint8Array(total);
    var o = 0;
    for (var j = 0; j < arrays.length; j++) { out.set(arrays[j], o); o += arrays[j].length; }
    return out;
  };

  /* 让出主线程，保持 UI 响应 */
  utils.yield = function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
