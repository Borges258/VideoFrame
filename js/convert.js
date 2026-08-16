/*
 * VideoFrame - convert.js
 * 图片格式互转：JPG / PNG / WebP / RAW（原始像素）。
 * 与主应用完全解耦：独立页面 convert.html 使用，仅复用 utils.js / zip.js 的既有接口。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});
  var utils = VF.utils;
  var $ = function (id) { return document.getElementById(id); };

  var items = []; // { file, kind: 'image' | 'raw', objectUrl }

  var RAW_LAYOUTS = { rgba: 4, bgra: 4, rgb: 3, bgr: 3, gray: 1 };

  /* ---------- 提示 ---------- */
  var toastTimer;
  function toast(msg, isError) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  function isRawName(name) { return /\.(raw|bin)$/i.test(name); }

  /* ---------- 文件管理 ---------- */
  function handleFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i];
      var kind = isRawName(f.name) ? 'raw' : 'image';
      items.push({
        file: f,
        kind: kind,
        objectUrl: kind === 'image' ? URL.createObjectURL(f) : null
      });
    }
    syncRawPanel();
    renderGrid();
    toast('已添加 ' + arr.length + ' 个文件');
  }

  function syncRawPanel() {
    var hasRaw = items.some(function (it) { return it.kind === 'raw'; });
    $('rawSettings').classList.toggle('hidden', !hasRaw);
  }

  function removeItem(idx) {
    var it = items[idx];
    if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
    items.splice(idx, 1);
    syncRawPanel();
    renderGrid();
  }

  function clearAll() {
    items.forEach(function (it) { if (it.objectUrl) URL.revokeObjectURL(it.objectUrl); });
    items = [];
    $('rawSettings').classList.add('hidden');
    $('convertFileInput').value = '';
    renderGrid();
    toast('已清空');
  }

  function renderGrid() {
    var el = $('convertGrid');
    el.innerHTML = '';
    items.forEach(function (it, idx) {
      var card = document.createElement('div');
      card.className = 'convert-item';

      var thumb = document.createElement('div');
      thumb.className = 'convert-thumb' + (it.kind === 'raw' ? ' raw' : '');
      if (it.kind === 'image') {
        var img = document.createElement('img');
        img.src = it.objectUrl;
        img.alt = it.file.name;
        img.draggable = false;
        thumb.appendChild(img);
      } else {
        thumb.textContent = 'RAW';
      }

      var info = document.createElement('div');
      info.className = 'convert-item-info';
      var name = document.createElement('div');
      name.className = 'convert-item-name';
      name.textContent = it.file.name;
      name.title = it.file.name;
      var meta = document.createElement('div');
      meta.className = 'convert-item-meta';
      meta.textContent = utils.formatBytes(it.file.size);
      info.appendChild(name);
      info.appendChild(meta);

      var del = document.createElement('button');
      del.className = 'convert-item-del';
      del.textContent = '✕';
      del.title = '移除';
      del.addEventListener('click', function () { removeItem(idx); });

      card.appendChild(thumb);
      card.appendChild(info);
      card.appendChild(del);
      el.appendChild(card);
    });
    $('convertFileCount').textContent = items.length + ' 个';
    $('convertEmpty').classList.toggle('hidden', items.length > 0);
  }

  /* ---------- RAW <-> ImageData ---------- */
  function rawToImageData(bytes, w, h, layout) {
    var id = new ImageData(w, h);
    var d = id.data;
    var n = w * h;
    var need = n * (RAW_LAYOUTS[layout] || 4);
    if (bytes.length < need) {
      throw new Error('RAW 数据不足：需要 ' + need + ' 字节，实际 ' + bytes.length + '（请检查尺寸/布局）');
    }
    var o = 0;
    for (var i = 0; i < n; i++) {
      var p = i * 4, r = 0, g = 0, b = 0, a = 255;
      if (layout === 'gray') { r = g = b = bytes[o++]; }
      else if (layout === 'rgba') { r = bytes[o]; g = bytes[o + 1]; b = bytes[o + 2]; a = bytes[o + 3]; o += 4; }
      else if (layout === 'bgra') { b = bytes[o]; g = bytes[o + 1]; r = bytes[o + 2]; a = bytes[o + 3]; o += 4; }
      else if (layout === 'rgb')  { r = bytes[o]; g = bytes[o + 1]; b = bytes[o + 2]; o += 3; }
      else if (layout === 'bgr')  { b = bytes[o]; g = bytes[o + 1]; r = bytes[o + 2]; o += 3; }
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = a;
    }
    return id;
  }

  function imageDataToRaw(id, layout) {
    var n = id.width * id.height;
    var ch = RAW_LAYOUTS[layout] || 4;
    var out = new Uint8Array(n * ch);
    var d = id.data, o = 0;
    for (var i = 0; i < n; i++) {
      var p = i * 4, r = d[p], g = d[p + 1], b = d[p + 2], a = d[p + 3];
      if (layout === 'gray') { out[o++] = (0.299 * r + 0.587 * g + 0.114 * b) | 0; }
      else if (layout === 'rgba') { out[o++] = r; out[o++] = g; out[o++] = b; out[o++] = a; }
      else if (layout === 'bgra') { out[o++] = b; out[o++] = g; out[o++] = r; out[o++] = a; }
      else if (layout === 'rgb')  { out[o++] = r; out[o++] = g; out[o++] = b; }
      else if (layout === 'bgr')  { out[o++] = b; out[o++] = g; out[o++] = r; }
    }
    return out;
  }

  /* ---------- 解码为 canvas ---------- */
  async function fileToCanvas(item, rawW, rawH, layout) {
    if (item.kind === 'image') {
      var img = await utils.blobToImage(item.file);
      var c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c;
    }
    var buf = await item.file.arrayBuffer();
    var id = rawToImageData(new Uint8Array(buf), rawW, rawH, layout);
    var rc = document.createElement('canvas');
    rc.width = rawW;
    rc.height = rawH;
    rc.getContext('2d').putImageData(id, 0, 0);
    return rc;
  }

  /* ---------- canvas -> 目标格式 Blob ---------- */
  function canvasToBlob(canvas, fmt, quality, jpegBg, rawLayout) {
    if (fmt === 'png') {
      return new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
    }
    if (fmt === 'webp') {
      return new Promise(function (res) { canvas.toBlob(res, 'image/webp', quality); });
    }
    if (fmt === 'jpeg') {
      var flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      var ctx = flat.getContext('2d');
      ctx.fillStyle = jpegBg === 'black' ? '#000000' : '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      return new Promise(function (res) { flat.toBlob(res, 'image/jpeg', quality); });
    }
    if (fmt === 'raw') {
      var ctx2 = canvas.getContext('2d', { willReadFrequently: true });
      var id = ctx2.getImageData(0, 0, canvas.width, canvas.height);
      return Promise.resolve(new Blob([imageDataToRaw(id, rawLayout)], { type: 'application/octet-stream' }));
    }
    return Promise.reject(new Error('未知输出格式'));
  }

  function outputName(inputName, fmt) {
    var base = inputName.replace(/\.[^.]+$/, '') || 'image';
    var ext = fmt === 'jpeg' ? 'jpg' : fmt;
    return base + '.' + ext;
  }

  /* ---------- 状态与进度 ---------- */
  function setBusy(b) {
    document.body.classList.toggle('busy', b);
    document.querySelectorAll('button').forEach(function (x) { x.disabled = b; });
  }
  function showProgress(s) { $('convertProgress').classList.toggle('hidden', !s); }
  function setProgress(done, total, label) {
    var c = $('convertProgress');
    var pct = total ? Math.round((done / total) * 100) : 0;
    c.querySelector('.fill').style.width = pct + '%';
    c.querySelector('.text').textContent = (label || '处理中') + ' … ' + done + ' / ' + total + ' (' + pct + '%)';
  }

  /* ---------- 转换主流程 ---------- */
  async function convert() {
    if (!items.length) { toast('请先添加图片', true); return; }
    var fmt = $('convertFormat').value;
    var quality = parseInt($('convertQuality').value, 10) / 100;
    var jpegBg = $('jpegBg').value;
    var layout = $('rawLayout').value;
    var rawW = parseInt($('rawWidth').value, 10);
    var rawH = parseInt($('rawHeight').value, 10);

    var hasRaw = items.some(function (x) { return x.kind === 'raw'; });
    if (hasRaw && (!rawW || !rawH)) { toast('请先填写 RAW 的宽度与高度', true); return; }

    setBusy(true);
    showProgress(true);
    setProgress(0, items.length, '准备');
    try {
      var outputs = [];
      for (var i = 0; i < items.length; i++) {
        setProgress(i + 1, items.length, '转换');
        var canvas = await fileToCanvas(items[i], rawW, rawH, layout);
        var blob = await canvasToBlob(canvas, fmt, quality, jpegBg, layout);
        outputs.push({
          name: outputName(items[i].file.name, fmt),
          data: new Uint8Array(await blob.arrayBuffer())
        });
      }

      if (outputs.length === 1) {
        var single = outputs[0];
        utils.downloadBlob(new Blob([single.data]), single.name);
        toast('已导出 ' + single.name);
      } else {
        var zip = await VF.Zip.createZip(outputs, function (d, t) {
          setProgress(d, t, '打包 ZIP');
        });
        utils.downloadBlob(zip, 'converted_images.zip');
        toast('已导出 ' + outputs.length + ' 个文件（ZIP）');
      }
    } catch (e) {
      toast('转换失败：' + e.message, true);
    } finally {
      setBusy(false);
      showProgress(false);
    }
  }

  /* ---------- 格式相关 UI 联动 ---------- */
  function updateFormatUI() {
    var fmt = $('convertFormat').value;
    $('qualitySetting').classList.toggle('hidden', fmt !== 'jpeg' && fmt !== 'webp');
    $('jpegBgSetting').classList.toggle('hidden', fmt !== 'jpeg');
  }

  function init() {
    var dz = $('convertDropZone');
    $('convertBrowseBtn').addEventListener('click', function () { $('convertFileInput').click(); });
    $('convertFileInput').addEventListener('change', function (e) {
      handleFiles(e.target.files);
      e.target.value = '';
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragging'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    $('convertBtn').addEventListener('click', convert);
    $('convertClearBtn').addEventListener('click', clearAll);
    $('convertFormat').addEventListener('change', updateFormatUI);
    $('convertQuality').addEventListener('input', function () {
      $('qualityValue').textContent = this.value;
    });

    updateFormatUI();
    renderGrid();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  VF.Convert = {
    getItems: function () { return items; },
    /* 以下仅供测试 */
    _RAW_LAYOUTS: RAW_LAYOUTS,
    _rawToImageData: rawToImageData,
    _imageDataToRaw: imageDataToRaw
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
