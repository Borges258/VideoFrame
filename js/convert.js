/*
 * VideoFrame - convert.js
 * 图片格式互转：JPG / PNG / WebP / ICO / RAW（原始像素），并支持转换前编辑。
 * 与视频帧处理器完全解耦：独立页面 convert.html 使用，
 * 仅复用 utils.js / zip.js / ico.js / imgtools.js 的既有接口。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});
  var utils = VF.utils;
  var $ = function (id) { return document.getElementById(id); };

  var items = [];            // { file, kind:'image'|'raw', objectUrl, editedCanvas }
  var editingIndex = -1;
  var imgTools = null;

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
        objectUrl: kind === 'image' ? URL.createObjectURL(f) : null,
        editedCanvas: null
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

  function closeEditorIfEditing(index) {
    if (editingIndex === index) {
      editingIndex = -1;
      $('editorPanel').classList.add('hidden');
    } else if (editingIndex > index) {
      editingIndex--;
    }
  }

  function removeItem(idx) {
    var it = items[idx];
    if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
    items.splice(idx, 1);
    closeEditorIfEditing(idx);
    syncRawPanel();
    renderGrid();
  }

  function clearAll() {
    items.forEach(function (it) { if (it.objectUrl) URL.revokeObjectURL(it.objectUrl); });
    items = [];
    editingIndex = -1;
    $('editorPanel').classList.add('hidden');
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
      card.className = 'convert-item' + (it.editedCanvas ? ' edited' : '');
      card.dataset.index = idx;

      var thumb = document.createElement('div');
      thumb.className = 'convert-thumb' + (it.kind === 'raw' ? ' raw' : '');
      if (it.kind === 'image' || it.editedCanvas) {
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
      meta.textContent = utils.formatBytes(it.file.size) + (it.editedCanvas ? ' · 已编辑' : '');
      info.appendChild(name);
      info.appendChild(meta);

      var edit = document.createElement('button');
      edit.className = 'convert-item-edit';
      edit.textContent = '✎';
      edit.title = '编辑图片';
      edit.addEventListener('click', function () { openEditor(idx); });

      var del = document.createElement('button');
      del.className = 'convert-item-del';
      del.textContent = '✕';
      del.title = '移除';
      del.addEventListener('click', function () { removeItem(idx); });

      card.appendChild(thumb);
      card.appendChild(info);
      card.appendChild(edit);
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

  function imageDataToCanvas(id) {
    var c = document.createElement('canvas');
    c.width = id.width;
    c.height = id.height;
    c.getContext('2d').putImageData(id, 0, 0);
    return c;
  }

  /* ---------- 解码：取得某条目的工作 canvas（优先使用已编辑结果） ---------- */
  async function fileToCanvas(item, rawW, rawH, layout) {
    if (item.editedCanvas) return item.editedCanvas;
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
    return imageDataToCanvas(id);
  }

  /* ---------- 编码：canvas -> 目标格式 Blob ---------- */
  function toBlobP(canvas, type, quality) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) {
        if (b) res(b); else rej(new Error('编码失败：' + type));
      }, type, quality);
    });
  }

  /* 缩放到正方形画布（完整容纳，居中，透明填充）并导出 PNG */
  function scaleToSquarePng(canvas, size) {
    var c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    var ctx = c.getContext('2d');
    var srcAspect = canvas.width / canvas.height;
    var dw, dh;
    if (srcAspect > 1) { dw = size; dh = Math.max(1, Math.round(size / srcAspect)); }
    else { dh = size; dw = Math.max(1, Math.round(size * srcAspect)); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
    return toBlobP(c, 'image/png');
  }

  function getIcoSizes() {
    var boxes = document.querySelectorAll('.ico-size:checked');
    var out = [];
    boxes.forEach(function (b) { out.push(parseInt(b.value, 10)); });
    if (!out.length) out = [256];
    out.sort(function (a, b) { return b - a; }); // 大尺寸在前
    return out;
  }

  async function canvasToBlob(canvas, fmt, quality, jpegBg, rawLayout, icoSizes) {
    if (fmt === 'png') return await toBlobP(canvas, 'image/png');
    if (fmt === 'webp') return await toBlobP(canvas, 'image/webp', quality);
    if (fmt === 'jpeg') {
      var flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      var ctx = flat.getContext('2d');
      ctx.fillStyle = jpegBg === 'black' ? '#000000' : '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      return await toBlobP(flat, 'image/jpeg', quality);
    }
    if (fmt === 'raw') {
      var ctx2 = canvas.getContext('2d', { willReadFrequently: true });
      var id = ctx2.getImageData(0, 0, canvas.width, canvas.height);
      return new Blob([imageDataToRaw(id, rawLayout)], { type: 'application/octet-stream' });
    }
    if (fmt === 'ico') {
      var entries = [];
      for (var i = 0; i < icoSizes.length; i++) {
        var s = icoSizes[i];
        var png = await scaleToSquarePng(canvas, s);
        entries.push({ png: new Uint8Array(await png.arrayBuffer()), width: s, height: s });
      }
      return VF.Ico.encode(entries);
    }
    throw new Error('未知输出格式');
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
    if (!b) syncEditorUI();
  }
  function showProgress(s) { $('convertProgress').classList.toggle('hidden', !s); }
  function setProgress(done, total, label) {
    var c = $('convertProgress');
    var pct = total ? Math.round((done / total) * 100) : 0;
    c.querySelector('.fill').style.width = pct + '%';
    c.querySelector('.text').textContent = (label || '处理中') + ' … ' + done + ' / ' + total + ' (' + pct + '%)';
  }

  function readRawSettings() {
    return {
      w: parseInt($('rawWidth').value, 10),
      h: parseInt($('rawHeight').value, 10),
      layout: $('rawLayout').value
    };
  }

  /* ============================================================
   * 图片编辑
   * ============================================================ */
  function openEditor(idx) {
    var it = items[idx];
    if (!it) return;
    var raw = readRawSettings();
    if (it.kind === 'raw' && !it.editedCanvas && (!raw.w || !raw.h)) {
      toast('请先填写 RAW 的宽度与高度，再编辑', true);
      return;
    }
    editingIndex = idx;
    $('editorPanel').classList.remove('hidden');
    $('editorTitle').textContent = '编辑：' + it.file.name;
    setEditorTool('brush');
    syncEditorUI();

    fileToCanvas(it, raw.w, raw.h, raw.layout).then(function (canvas) {
      if (editingIndex !== idx) return;
      loadCanvasIntoEditor(canvas);
      $('editorPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) {
      toast('无法打开图片：' + e.message, true);
    });
  }

  function loadCanvasIntoEditor(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    imgTools.load(id);
    syncEditorUI();
  }

  function saveEditor() {
    if (editingIndex < 0 || !imgTools.hasImage()) return;
    var idx = editingIndex;
    var canvas = imageDataToCanvas(imgTools.getImageData());
    setItemCanvas(idx, canvas).then(function () {
      renderGrid();
      editingIndex = -1;
      $('editorPanel').classList.add('hidden');
      toast('已保存修改：' + items[idx].file.name);
    });
  }

  function cancelEditor() {
    if (editingIndex < 0) return;
    editingIndex = -1;
    $('editorPanel').classList.add('hidden');
    toast('已取消编辑（未保存的改动已丢弃）');
  }

  function setItemCanvas(idx, canvas) {
    var it = items[idx];
    it.editedCanvas = canvas;
    return new Promise(function (res) {
      canvas.toBlob(function (b) {
        if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
        it.objectUrl = b ? URL.createObjectURL(b) : null;
        res();
      }, 'image/png');
    });
  }

  function syncEditorUI() {
    if (!imgTools) return;
    var id = imgTools.getImageData();
    if (id) {
      $('itDims').textContent = '尺寸 ' + id.width + ' × ' + id.height;
      if (document.activeElement !== $('itWidth')) $('itWidth').value = id.width;
      if (document.activeElement !== $('itHeight')) $('itHeight').value = id.height;
    }
    $('itUndo').disabled = imgTools.undoStack.length === 0;
    $('itRedo').disabled = imgTools.redoStack.length === 0;
    $('itZoomLabel').textContent = imgTools.getZoomLabel();
  }

  var TOOL_BTNS = { brush: 'itToolBrush', eraser: 'itToolEraser', picker: 'itToolPicker', crop: 'itToolCrop' };
  function setEditorTool(tool) {
    if (!imgTools) return;
    imgTools.setTool(tool);
    Object.keys(TOOL_BTNS).forEach(function (k) {
      $(TOOL_BTNS[k]).classList.toggle('active', k === tool);
    });
    $('itCanvasWrap').style.cursor = tool === 'crop' ? 'crosshair' : 'default';
  }

  function parseAspect(v) {
    var p = String(v).split(':');
    return [parseFloat(p[0]) || 1, parseFloat(p[1]) || 1];
  }

  function applyAspectCurrent() {
    if (!imgTools || !imgTools.hasImage()) return;
    var a = parseAspect($('itAspect').value);
    var mode = $('itAspectMode').value;
    if (imgTools.setAspect(a[0], a[1], mode)) {
      syncEditorUI();
      toast('已应用画幅 ' + a[0] + ':' + a[1]);
    }
  }

  async function applyAspectToAll() {
    if (!items.length) { toast('请先添加图片', true); return; }
    var a = parseAspect($('itAspect').value);
    var mode = $('itAspectMode').value;
    var raw = readRawSettings();
    var hasRaw = items.some(function (x) { return x.kind === 'raw' && !x.editedCanvas; });
    if (hasRaw && (!raw.w || !raw.h)) { toast('存在 RAW 文件，请先填写其宽度与高度', true); return; }

    setBusy(true);
    showProgress(true);
    try {
      for (var i = 0; i < items.length; i++) {
        setProgress(i + 1, items.length, '应用画幅');
        var canvas = await fileToCanvas(items[i], raw.w, raw.h, raw.layout);
        await setItemCanvas(i, VF.ImgTools.transforms.aspect(canvas, a[0], a[1], mode));
      }
      renderGrid();
      if (editingIndex >= 0 && items[editingIndex].editedCanvas) {
        loadCanvasIntoEditor(items[editingIndex].editedCanvas);
      }
      toast('已将 ' + a[0] + ':' + a[1] + ' 应用到全部 ' + items.length + ' 张图片');
    } catch (e) {
      toast('应用失败：' + e.message, true);
    } finally {
      setBusy(false);
      showProgress(false);
    }
  }

  /* ============================================================
   * 转换主流程
   * ============================================================ */
  async function convert() {
    if (!items.length) { toast('请先添加图片', true); return; }
    var fmt = $('convertFormat').value;
    var quality = parseInt($('convertQuality').value, 10) / 100;
    var jpegBg = $('jpegBg').value;
    var raw = readRawSettings();
    var icoSizes = getIcoSizes();

    var hasRaw = items.some(function (x) { return x.kind === 'raw' && !x.editedCanvas; });
    if (hasRaw && (!raw.w || !raw.h)) { toast('请先填写 RAW 的宽度与高度', true); return; }

    setBusy(true);
    showProgress(true);
    setProgress(0, items.length, '准备');
    try {
      var outputs = [];
      for (var i = 0; i < items.length; i++) {
        setProgress(i + 1, items.length, '转换');
        var canvas = await fileToCanvas(items[i], raw.w, raw.h, raw.layout);
        var blob = await canvasToBlob(canvas, fmt, quality, jpegBg, raw.layout, icoSizes);
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
    $('icoSetting').classList.toggle('hidden', fmt !== 'ico');
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (VF.ImgTools) {
      imgTools = new VF.ImgTools($('itCanvas'), {
        onChange: function () { syncEditorUI(); },
        onPick: function (rgb) { $('itColor').value = rgbToHex(rgb[0], rgb[1], rgb[2]); },
        onStatus: function (s) {
          $('itStatus').textContent = s.inImage
            ? ('X:' + s.x + ' Y:' + s.y + ' ｜ RGBA:(' + s.r + ',' + s.g + ',' + s.b + ',' + s.a + ')')
            : ('将鼠标移到画布上查看像素' + (s.w ? ' ｜ 尺寸 ' + s.w + '×' + s.h : ''));
        },
        onCropChange: function (r) {
          var el = $('itCropInfo');
          if (r) {
            el.textContent = '选区：' + r.w + ' × ' + r.h + '（起点 ' + r.x + ', ' + r.y + '）';
            $('itCropApply').disabled = !(r.w >= 1 && r.h >= 1);
          } else {
            el.textContent = '选择「裁剪」工具后，在画布上拖拽框选区域。';
            $('itCropApply').disabled = true;
          }
        }
      });
    }

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

    /* 编辑器工具栏 */
    $('itToolBrush').addEventListener('click', function () { setEditorTool('brush'); });
    $('itToolEraser').addEventListener('click', function () { setEditorTool('eraser'); });
    $('itToolPicker').addEventListener('click', function () { setEditorTool('picker'); });
    $('itToolCrop').addEventListener('click', function () { setEditorTool('crop'); });
    $('itColor').addEventListener('input', function () {
      var rgb = hexToRgb(this.value);
      imgTools.setColor(rgb[0], rgb[1], rgb[2]);
    });
    $('itBrushSize').addEventListener('change', function () {
      imgTools.setBrushSize(parseInt(this.value, 10));
    });
    $('itUndo').addEventListener('click', function () { imgTools.undo(); syncEditorUI(); });
    $('itRedo').addEventListener('click', function () { imgTools.redo(); syncEditorUI(); });
    $('itReset').addEventListener('click', function () { imgTools.reset(); syncEditorUI(); });
    $('itZoomIn').addEventListener('click', function () { imgTools.zoomIn(); syncEditorUI(); });
    $('itZoomOut').addEventListener('click', function () { imgTools.zoomOut(); syncEditorUI(); });
    $('itZoomFit').addEventListener('click', function () { imgTools.zoomFit(); syncEditorUI(); });

    $('itCropApply').addEventListener('click', function () {
      if (imgTools.cropApply()) { syncEditorUI(); toast('已裁剪'); }
    });
    $('itCropSelectAll').addEventListener('click', function () { imgTools.cropSelectAll(); });
    $('itCropClear').addEventListener('click', function () { imgTools.cropClear(); });

    $('itAspectApply').addEventListener('click', applyAspectCurrent);
    $('itAspectAll').addEventListener('click', applyAspectToAll);
    $('itResizeApply').addEventListener('click', function () {
      var w = parseInt($('itWidth').value, 10);
      var h = parseInt($('itHeight').value, 10);
      if (!w || !h) { toast('请输入有效尺寸', true); return; }
      if (w * h > 4000 * 4000) { toast('尺寸过大（最大 1600 万像素）', true); return; }
      if (imgTools.resizeCanvas(w, h, $('itAnchor').value)) { syncEditorUI(); toast('尺寸已更新'); }
    });

    $('editorSaveBtn').addEventListener('click', saveEditor);
    $('editorCancelBtn').addEventListener('click', cancelEditor);

    /* 快捷键（仅编辑器打开时生效） */
    document.addEventListener('keydown', function (e) {
      if ($('editorPanel').classList.contains('hidden')) return;
      var tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault(); imgTools.undo(); syncEditorUI(); return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault(); imgTools.redo(); syncEditorUI(); return;
      }
      if (e.key === 'b') setEditorTool('brush');
      else if (e.key === 'e') setEditorTool('eraser');
      else if (e.key === 'i') setEditorTool('picker');
      else if (e.key === 'c') setEditorTool('crop');
    });

    updateFormatUI();
    renderGrid();
    $('itCropApply').disabled = true;
    syncEditorUI();
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (n) { return ('0' + Math.round(n).toString(16)).slice(-2); }).join('');
  }
  function hexToRgb(hex) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
    if (!m) return [255, 0, 0];
    var v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
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
