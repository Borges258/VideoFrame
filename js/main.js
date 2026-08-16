/*
 * VideoFrame - main.js
 * 应用编排：3 步流程（上传提取 → 编辑 → 导出）。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});

  var state = {
    videoInfo: null,
    frames: [],            // { name, width, height, timestamp, blob, objectUrl }
    selectedIndex: -1,
    editor: null,
    busy: false
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 工具 ---------- */
  function hexToRgb(hex) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
    if (!m) return [255, 0, 0];
    var v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (n) {
      return ('0' + Math.round(n).toString(16)).slice(-2);
    }).join('');
  }

  var toastTimer;
  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  function setBusy(busy) {
    state.busy = busy;
    document.body.classList.toggle('busy', busy);
    document.querySelectorAll('button').forEach(function (b) {
      b.disabled = busy;
    });
    if (!busy && state.editor) updateEditorControls();
  }

  function setProgress(containerId, done, total, label) {
    var c = $(containerId);
    if (!c) return;
    var fill = c.querySelector('.fill');
    var text = c.querySelector('.text');
    var pct = total ? Math.round((done / total) * 100) : 0;
    fill.style.width = pct + '%';
    text.textContent = (label || '处理中') + ' … ' + done + ' / ' + total + ' (' + pct + '%)';
  }
  function showProgress(containerId, show) {
    var c = $(containerId);
    if (c) c.classList.toggle('hidden', !show);
  }

  function showStep(n) {
    for (var i = 1; i <= 3; i++) $('step' + i).classList.toggle('hidden', i !== n);
    document.querySelectorAll('.steps .step').forEach(function (s) {
      s.classList.toggle('active', parseInt(s.dataset.step, 10) === n);
      s.classList.toggle('enabled', stepEnabled(parseInt(s.dataset.step, 10)));
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function stepEnabled(n) {
    if (n === 1) return true;
    return state.frames.length > 0;
  }

  /* ---------- 步骤 1：上传与提取 ---------- */
  function onFilePicked(file) {
    if (!file) return;
    var lower = file.name.toLowerCase();
    if (!/\.(mp4|m4v|mov|webm|mkv)$/.test(lower) && file.type.indexOf('video/') !== 0) {
      toast('请选择 MP4 等视频文件', true);
      return;
    }
    setBusy(true);
    VF.Extractor.loadVideo(file).then(function (info) {
      state.videoInfo = info;
      releaseFrames();
      $('dropHint').classList.add('hidden');
      $('videoInfo').classList.remove('hidden');
      $('extractSettings').classList.remove('hidden');
      $('videoName').textContent = info.fileName;
      $('videoMeta').textContent =
        info.width + ' × ' + info.height + ' ｜ ' +
        VF.utils.formatDuration(info.duration) + ' ｜ ' +
        VF.utils.formatBytes(info.fileSize);
      updateFrameEstimate();
      showStep(1);
      toast('视频加载成功');
    }).catch(function (e) {
      toast(e.message, true);
    }).finally(function () {
      setBusy(false);
    });
  }

  function updateFrameEstimate() {
    var info = state.videoInfo;
    if (!info) return;
    var fps = parseInt($('fpsInput').value, 10) || 10;
    var maxFrames = parseInt($('maxFramesInput').value, 10) || 200;
    var est = Math.floor(info.duration * fps);
    var capped = Math.min(est, maxFrames);
    $('frameCountEstimate').textContent =
      '预计提取 ' + capped + ' 帧' + (est > maxFrames ? '（已按上限均匀采样）' : '');
  }

  function releaseFrames() {
    state.frames.forEach(function (f) {
      if (f.objectUrl) URL.revokeObjectURL(f.objectUrl);
    });
    state.frames = [];
    state.selectedIndex = -1;
    if (state.editor) state.editor.load(new ImageData(1, 1));
    renderFilmstrip();
  }

  function extractFrames() {
    if (!state.videoInfo) return;
    var fps = Math.max(1, parseInt($('fpsInput').value, 10) || 10);
    var maxFrames = Math.max(1, parseInt($('maxFramesInput').value, 10) || 200);
    var maxSide = parseInt($('scaleSelect').value, 10) || 0;

    setBusy(true);
    showProgress('extractProgress', true);
    setProgress('extractProgress', 0, 1, '准备');

    VF.Extractor.extract(state.videoInfo, {
      fps: fps,
      maxFrames: maxFrames,
      maxSide: maxSide,
      onProgress: function (done, total) {
        setProgress('extractProgress', done, total, '提取帧');
      }
    }).then(function (frames) {
      state.frames = frames.map(function (f) {
        f.objectUrl = URL.createObjectURL(f.blob);
        return f;
      });
      state.selectedIndex = -1;
      renderFilmstrip();
      updateFrameSummary();
      showStep(2);
      if (state.frames.length) selectFrame(0);
      toast('提取完成：' + state.frames.length + ' 帧');
    }).catch(function (e) {
      toast('提取失败：' + e.message, true);
    }).finally(function () {
      setBusy(false);
      showProgress('extractProgress', false);
    });
  }

  /* ---------- 步骤 2：编辑 ---------- */
  function selectFrame(i) {
    if (i < 0 || i >= state.frames.length) return;
    if (state.selectedIndex === i && state.editor.hasFrame()) return;
    state.selectedIndex = i;
    var frame = state.frames[i];
    VF.utils.blobToImageData(frame.blob).then(function (id) {
      if (state.selectedIndex !== i) return; // 已切换
      state.editor.load(id);
      syncResizeInputs();
      updateFrameInfo();
      renderFilmstrip();
      updateEditorControls();
    }).catch(function (e) {
      toast('加载帧失败：' + e.message, true);
    });
  }

  function commitFrame(index) {
    var frame = state.frames[index];
    if (!frame || !state.editor.hasFrame()) return;
    var id = state.editor.getImageData();
    VF.utils.imageDataToBlob(id).then(function (blob) {
      if (frame.objectUrl) URL.revokeObjectURL(frame.objectUrl);
      frame.blob = blob;
      frame.width = id.width;
      frame.height = id.height;
      frame.objectUrl = URL.createObjectURL(blob);
      var img = document.querySelector('#filmstrip .thumb[data-index="' + index + '"] img');
      if (img) img.src = frame.objectUrl;
      updateFrameInfo();
      updateFrameSummary();
    });
  }

  function renderFilmstrip() {
    var el = $('filmstrip');
    el.innerHTML = '';
    state.frames.forEach(function (f, i) {
      var div = document.createElement('div');
      div.className = 'thumb' + (i === state.selectedIndex ? ' selected' : '');
      div.dataset.index = i;
      var img = document.createElement('img');
      img.src = f.objectUrl;
      img.alt = f.name;
      img.draggable = false;
      var badge = document.createElement('span');
      badge.className = 'thumb-badge';
      badge.textContent = i + 1;
      div.appendChild(img);
      div.appendChild(badge);
      div.addEventListener('click', function () { selectFrame(i); });
      el.appendChild(div);
    });
    var empty = $('filmstripEmpty');
    if (empty) empty.classList.toggle('hidden', state.frames.length > 0);
  }

  function updateFrameSummary() {
    $('framesCount').textContent = state.frames.length + ' 帧';
    $('zipFrameCount').textContent = state.frames.length + ' 张 PNG';
    $('gifFrameCount').textContent = state.frames.length + ' 帧';
  }

  function updateFrameInfo() {
    var frame = state.frames[state.selectedIndex];
    if (!frame) return;
    $('frameInfo').textContent =
      '帧 ' + (state.selectedIndex + 1) + ' / ' + state.frames.length +
      ' ｜ ' + frame.width + '×' + frame.height +
      ' ｜ t=' + frame.timestamp.toFixed(2) + 's';
  }

  function syncResizeInputs() {
    var id = state.editor.getImageData();
    if (!id) return;
    $('resizeW').value = id.width;
    $('resizeH').value = id.height;
  }

  function updateEditorControls() {
    $('undoBtn').disabled = state.editor.undoStack.length === 0;
    $('redoBtn').disabled = state.editor.redoStack.length === 0;
    $('zoomLabel').textContent = state.editor.getZoomLabel();
  }

  function duplicateFrame() {
    var i = state.selectedIndex;
    if (i < 0) return;
    var src = state.frames[i];
    var copy = {
      name: 'frame_' + VF.utils.pad(state.frames.length + 1, 4) + '.png',
      width: src.width,
      height: src.height,
      timestamp: src.timestamp,
      blob: src.blob.slice(0, src.blob.size, src.blob.type),
      objectUrl: null
    };
    copy.objectUrl = URL.createObjectURL(copy.blob);
    state.frames.splice(i + 1, 0, copy);
    // 重命名保持顺序
    state.frames.forEach(function (f, idx) { f.name = 'frame_' + VF.utils.pad(idx + 1, 4) + '.png'; });
    renderFilmstrip();
    updateFrameSummary();
    selectFrame(i + 1);
    toast('已复制当前帧');
  }

  function deleteFrame() {
    var i = state.selectedIndex;
    if (i < 0 || state.frames.length <= 1) {
      toast('至少保留一帧', true);
      return;
    }
    var f = state.frames[i];
    if (f.objectUrl) URL.revokeObjectURL(f.objectUrl);
    state.frames.splice(i, 1);
    state.frames.forEach(function (fr, idx) { fr.name = 'frame_' + VF.utils.pad(idx + 1, 4) + '.png'; });
    var next = Math.min(i, state.frames.length - 1);
    state.selectedIndex = -1;
    renderFilmstrip();
    updateFrameSummary();
    selectFrame(next);
    toast('已删除该帧');
  }

  function applyResize() {
    var w = parseInt($('resizeW').value, 10);
    var h = parseInt($('resizeH').value, 10);
    if (!w || !h || w < 1 || h < 1) { toast('请输入有效尺寸', true); return; }
    if (w * h > 2000 * 2000) { toast('画布尺寸过大（最大 400 万像素）', true); return; }
    state.editor.resizeCanvas(w, h, $('anchorSelect').value);
    syncResizeInputs();
    updateFrameInfo();
    toast('画布已调整为 ' + w + '×' + h);
  }

  /* ---------- 步骤 3：导出 ---------- */
  function blobToUint8(blob) {
    return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  async function exportZip() {
    if (!state.frames.length) return;
    setBusy(true);
    showProgress('exportProgress', true);
    try {
      var files = [];
      for (var i = 0; i < state.frames.length; i++) {
        files.push({ name: state.frames[i].name, data: await blobToUint8(state.frames[i].blob) });
      }
      var zipBlob = await VF.Zip.createZip(files, function (done, total) {
        setProgress('exportProgress', done, total, '压缩');
      });
      VF.utils.downloadBlob(zipBlob, 'video_frames.zip');
      toast('ZIP 导出完成：' + files.length + ' 张 PNG');
    } catch (e) {
      toast('导出失败：' + e.message, true);
    } finally {
      setBusy(false);
      showProgress('exportProgress', false);
    }
  }

  async function exportGif() {
    if (!state.frames.length) return;
    var delay = Math.max(10, parseInt($('gifDelay').value, 10) || 100);
    var loop = parseInt($('gifLoop').value, 10) || 0;
    var background = $('gifBg').value;
    setBusy(true);
    showProgress('exportProgress', true);
    setProgress('exportProgress', 0, state.frames.length, 'GIF 编码');
    try {
      var dims = state.frames.map(function (f) { return { width: f.width, height: f.height }; });
      var blob = await VF.Gif.encode({
        count: state.frames.length,
        dims: dims,
        getFrame: function (i) { return VF.utils.blobToImageData(state.frames[i].blob); },
        delay: delay,
        loop: loop,
        background: background,
        onProgress: function (done, total) {
          setProgress('exportProgress', done, total, 'GIF 编码');
        }
      });
      VF.utils.downloadBlob(blob, 'animation.gif');
      toast('GIF 导出完成');
    } catch (e) {
      toast('导出失败：' + e.message, true);
    } finally {
      setBusy(false);
      showProgress('exportProgress', false);
    }
  }

  function resetAll() {
    if (state.videoInfo) VF.Extractor.releaseVideo(state.videoInfo);
    state.videoInfo = null;
    releaseFrames();
    $('dropHint').classList.remove('hidden');
    $('videoInfo').classList.add('hidden');
    $('extractSettings').classList.add('hidden');
    $('fileInput').value = '';
    if (state.editor) state.editor.load(new ImageData(1, 1));
    showStep(1);
    toast('已重置');
  }

  /* ---------- 初始化 ---------- */
  function init() {
    state.editor = new VF.Editor($('editorCanvas'), {
      onChange: function () { commitFrame(state.selectedIndex); updateEditorControls(); },
      onPick: function (rgb) { $('colorInput').value = rgbToHex(rgb[0], rgb[1], rgb[2]); },
      onStatus: function (s) {
        var bar = $('statusBar');
        if (!s.inImage) {
          bar.textContent = '尺寸 ' + s.w + '×' + s.h + ' ｜ 将鼠标移到画布上查看像素';
          return;
        }
        bar.textContent =
          'X:' + s.x + ' Y:' + s.y +
          ' ｜ RGBA:(' + s.r + ',' + s.g + ',' + s.b + ',' + s.a + ')' +
          ' ｜ 尺寸 ' + s.w + '×' + s.h;
      }
    });
    state.editor.load(new ImageData(1, 1));

    /* 步骤 1 */
    var dropZone = $('dropZone');
    $('browseBtn').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) onFilePicked(e.target.files[0]);
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.remove('dragging'); });
    });
    dropZone.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) onFilePicked(e.dataTransfer.files[0]);
    });
    $('fpsInput').addEventListener('input', updateFrameEstimate);
    $('maxFramesInput').addEventListener('input', updateFrameEstimate);
    $('extractBtn').addEventListener('click', extractFrames);

    /* 步骤 2 */
    $('toolBrush').addEventListener('click', function () { setTool('brush', this); });
    $('toolEraser').addEventListener('click', function () { setTool('eraser', this); });
    $('toolPicker').addEventListener('click', function () { setTool('picker', this); });
    $('colorInput').addEventListener('input', function (e) {
      var rgb = hexToRgb(e.target.value);
      state.editor.setColor(rgb[0], rgb[1], rgb[2]);
    });
    $('brushSize').addEventListener('change', function (e) {
      state.editor.setBrushSize(parseInt(e.target.value, 10));
    });
    $('zoomOut').addEventListener('click', function () { state.editor.zoomOut(); updateEditorControls(); });
    $('zoomFit').addEventListener('click', function () { state.editor.zoomFit(); updateEditorControls(); });
    $('zoomIn').addEventListener('click', function () { state.editor.zoomIn(); updateEditorControls(); });
    $('undoBtn').addEventListener('click', function () { state.editor.undo(); updateEditorControls(); });
    $('redoBtn').addEventListener('click', function () { state.editor.redo(); updateEditorControls(); });
    $('resetBtn').addEventListener('click', function () { state.editor.reset(); updateEditorControls(); });
    $('applyResizeBtn').addEventListener('click', applyResize);
    $('duplicateBtn').addEventListener('click', duplicateFrame);
    $('deleteBtn').addEventListener('click', deleteFrame);

    /* 步骤 3 */
    $('exportZipBtn').addEventListener('click', exportZip);
    $('exportGifBtn').addEventListener('click', exportGif);
    $('gifDelay').value = Math.max(20, Math.round(1000 / (parseInt($('fpsInput').value, 10) || 10)));
    $('fpsInput').addEventListener('input', function () {
      var f = parseInt($('fpsInput').value, 10);
      if (f) $('gifDelay').value = Math.max(20, Math.round(1000 / f));
    });

    /* 步骤导航 */
    document.querySelectorAll('.steps .step').forEach(function (s) {
      s.addEventListener('click', function () {
        var n = parseInt(s.dataset.step, 10);
        if (stepEnabled(n)) showStep(n);
        else toast('请先完成上一步', true);
      });
    });
    $('resetAllBtn').addEventListener('click', resetAll);

    /* 窗口尺寸变化时，适应模式重新排布画布 */
    window.addEventListener('resize', function () {
      if (state.editor && state.editor.hasFrame() && state.editor.zoom == null) state.editor.render();
    });

    /* 键盘快捷键 */
    document.addEventListener('keydown', function (e) {
      if (state.busy) return;
      var tag = (e.target.tagName || '').toUpperCase();
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        if (!typing) { e.preventDefault(); state.editor.undo(); updateEditorControls(); }
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        if (!typing) { e.preventDefault(); state.editor.redo(); updateEditorControls(); }
        return;
      }
      if (typing) return;
      if (e.key === 'ArrowLeft') { if (state.frames.length) selectFrame(Math.max(0, state.selectedIndex - 1)); }
      else if (e.key === 'ArrowRight') { if (state.frames.length) selectFrame(Math.min(state.frames.length - 1, state.selectedIndex + 1)); }
      else if (e.key === 'b') setTool('brush');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === 'i') setTool('picker');
    });

    showStep(1);
  }

  function setTool(tool, btn) {
    state.editor.setTool(tool);
    ['toolBrush', 'toolEraser', 'toolPicker'].forEach(function (id) {
      $(id).classList.toggle('active', id === (tool === 'brush' ? 'toolBrush' : tool === 'eraser' ? 'toolEraser' : 'toolPicker'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  VF.App = { state: state, showStep: showStep, toast: toast };
})(typeof window !== 'undefined' ? window : globalThis);
