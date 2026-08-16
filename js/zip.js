/*
 * VideoFrame - zip.js
 * 纯 JS 的 ZIP 打包器（无依赖）。
 * 压缩方式：优先 raw DEFLATE（CompressionStream），不支持时回退 STORE。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});
  var utils = VF.utils;

  function dosDateTime(d) {
    var date = d || new Date();
    return {
      time: ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF,
      date: (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF
    };
  }

  /* files: [{ name: string, data: Uint8Array }]
   * 返回 Blob (application/zip)
   */
  VF.Zip = {
    createZip: async function (files, onProgress) {
      var encoder = new TextEncoder();
      var dt = dosDateTime();
      var localChunks = [];
      var centralChunks = [];
      var offset = 0;

      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var nameBytes = encoder.encode(file.name);
        var crc = utils.crc32(file.data);

        var method = 0; // 0 = store, 8 = deflate
        var compData = file.data;
        var deflated = await utils.deflateRaw(file.data);
        if (deflated && deflated.length < file.data.length) {
          method = 8;
          compData = deflated;
        }

        // ---- Local file header ----
        var local = new Uint8Array(30 + nameBytes.length);
        var lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034B50, true);   // signature
        lv.setUint16(4, 20, true);           // version needed (2.0)
        lv.setUint16(6, 0x0800, true);       // general purpose flag: UTF-8
        lv.setUint16(8, method, true);       // compression method
        lv.setUint16(10, dt.time, true);
        lv.setUint16(12, dt.date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, compData.length, true);
        lv.setUint32(22, file.data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);           // extra length
        local.set(nameBytes, 30);

        localChunks.push(local, compData);
        var localOffset = offset;
        offset += local.length + compData.length;

        // ---- Central directory header ----
        var cd = new Uint8Array(46 + nameBytes.length);
        var cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014B50, true);   // signature
        cv.setUint16(4, 0x0314, true);       // version made by (DOS/Windows 2.0)
        cv.setUint16(6, 20, true);           // version needed
        cv.setUint16(8, 0x0800, true);       // UTF-8
        cv.setUint16(10, method, true);
        cv.setUint16(12, dt.time, true);
        cv.setUint16(14, dt.date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, compData.length, true);
        cv.setUint32(24, file.data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);           // extra length
        cv.setUint16(32, 0, true);           // comment length
        cv.setUint16(34, 0, true);           // disk number start
        cv.setUint16(36, 0, true);           // internal attributes
        cv.setUint32(38, 0, true);           // external attributes
        cv.setUint32(42, localOffset, true); // relative offset of local header
        cd.set(nameBytes, 46);
        centralChunks.push(cd);

        if (onProgress) onProgress(i + 1, files.length);
        if ((i & 7) === 7) await utils.yield();
      }

      var centralSize = 0;
      for (var j = 0; j < centralChunks.length; j++) centralSize += centralChunks[j].length;

      // ---- End of central directory ----
      var eocd = new Uint8Array(22);
      var ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054B50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true);
      ev.setUint32(12, centralSize, true);
      ev.setUint32(16, offset, true);
      ev.setUint16(20, 0, true);

      var all = utils.concatBytes(localChunks.concat(centralChunks, [eocd]));
      return new Blob([all], { type: 'application/zip' });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
