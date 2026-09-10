/*
 * VideoFrame - imgtools.js
 * 图片转换页专用的图片编辑工具：画笔 / 橡皮 / 取色 / 裁剪 / 画幅 / 尺寸。
 * 完全独立于视频帧编辑器 editor.js，互不影响。仅暴露 VF.ImgTools。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});

  function cloneImageData(id) {
    return new ImageData(new Uint8ClampedArray(id.data), id.width, id.height);
  }

  /* Bresenham 直线 */
  function plotLine(x0, y0, x1, y1, fn) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    while (true) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  var ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];

  /* 目标画幅尺寸（纯函数，便于测试）
   * mode: 'fit' 完整容纳（可能留白） | 'fill' 填满（可能裁切）
   */
  function computeAspect(w, h, rw, rh, mode) {
    if (!rw || !rh) return { width: w, height: h };
    var a = rw / rh;
    var cur = w / h;
    var outW, outH;
    if (mode === 'fill') {
      if (cur > a) { outH = h; outW = Math.round(h * a); }
      else { outW = w; outH = Math.round(w / a); }
    } else {
      if (cur > a) { outW = w; outH = Math.round(w / a); }
      else { outH = h; outW = Math.round(h * a); }
    }
    return { width: Math.max(1, outW), height: Math.max(1, outH) };
  }

  function transformCanvas(srcCanvas, w, h, ox, oy) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(srcCanvas, Math.round(ox), Math.round(oy));
    return c;
  }

  function anchorOffset(w, h, srcW, srcH, anchor) {
    var ox = 0, oy = 0;
    switch (anchor) {
      case 'tl': ox = 0; oy = 0; break;
      case 'tc': ox = Math.floor((w - srcW) / 2); oy = 0; break;
      case 'tr': ox = w - srcW; oy = 0; break;
      case 'cl': ox = 0; oy = Math.floor((h - srcH) / 2); break;
      case 'cr': ox = w - srcW; oy = Math.floor((h - srcH) / 2); break;
      case 'bl': ox = 0; oy = h - srcH; break;
      case 'bc': ox = Math.floor((w - srcW) / 2); oy = h - srcH; break;
      case 'br': ox = w - srcW; oy = h - srcH; break;
      default: ox = Math.floor((w - srcW) / 2); oy = Math.floor((h - srcH) / 2);
    }
    return { x: ox, y: oy };
  }

  /* 供转换器批量套用的画布级变换 */
  var transforms = {
    computeAspect: computeAspect,
    aspect: function (canvas, rw, rh, mode) {
      var d = computeAspect(canvas.width, canvas.height, rw, rh, mode);
      return transformCanvas(canvas, d.width, d.height, (d.width - canvas.width) / 2, (d.height - canvas.height) / 2);
    },
    resize: function (canvas, w, h, anchor) {
      var o = anchorOffset(w, h, canvas.width, canvas.height, anchor);
      return transformCanvas(canvas, w, h, o.x, o.y);
    },
    crop: function (canvas, x, y, w, h) {
      return transformCanvas(canvas, w, h, -x, -y);
    }
  };

  /* ============================================================
   * 编辑器
   * opts: { onChange, onPick, onStatus, onCropChange }
   * ============================================================ */
  VF.ImgTools = function ImgTools(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.imageData = null;
    this.original = null;
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = 30;

    this.tool = 'brush';       // brush | eraser | picker | crop
    this.color = [255, 0, 0];
    this.brushSize = 4;
    this.zoom = null;          // null => 适应
    this.cropRect = null;      // {x,y,w,h} 图像坐标

    this.onChange = opts.onChange || function () {};
    this.onPick = opts.onPick || function () {};
    this.onStatus = opts.onStatus || function () {};
    this.onCropChange = opts.onCropChange || function () {};

    this._base = document.createElement('canvas');
    this._baseCtx = this._base.getContext('2d');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
    this._cropStart = null;
    this._scale = 1;

    this._bindEvents();
  };

  VF.ImgTools.prototype = {
    load: function (imageData) {
      this.imageData = cloneImageData(imageData);
      this.original = cloneImageData(imageData);
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this.cropRect = null;
      this.zoom = null;
      this.render();
      this.onCropChange(null);
    },

    hasImage: function () { return !!this.imageData; },
    getImageData: function () { return this.imageData; },
    getCropRect: function () { return this.cropRect; },
    setTool: function (t) { this.tool = t; this.render(); },
    setColor: function (r, g, b) { this.color = [r, g, b]; },
    setBrushSize: function (n) { this.brushSize = Math.max(1, Math.min(64, n | 0)); },

    zoomFit: function () { this.zoom = null; this.render(); return this._scale; },
    zoomIn: function () {
      if (this.zoom == null) {
        var cur = this._scale || 1;
        for (var i = 0; i < ZOOM_LEVELS.length; i++) if (ZOOM_LEVELS[i] > cur) { this.zoom = ZOOM_LEVELS[i]; break; }
        if (this.zoom == null) this.zoom = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
      } else {
        for (var j = 0; j < ZOOM_LEVELS.length; j++) if (ZOOM_LEVELS[j] > this.zoom) { this.zoom = ZOOM_LEVELS[j]; break; }
      }
      this.render();
      return this._scale;
    },
    zoomOut: function () {
      if (this.zoom == null) return this._scale;
      var prev = null;
      for (var i = ZOOM_LEVELS.length - 1; i >= 0; i--) if (ZOOM_LEVELS[i] < this.zoom) { prev = ZOOM_LEVELS[i]; break; }
      this.zoom = prev;
      this.render();
      return this._scale;
    },
    getZoomLabel: function () { return this.zoom == null ? '适应' : Math.round(this.zoom * 100) + '%'; },

    undo: function () {
      if (!this.undoStack.length) return false;
      this.redoStack.push(cloneImageData(this.imageData));
      this.imageData = this.undoStack.pop();
      this.cropRect = null;
      this.render();
      this.onCropChange(null);
      this.onChange();
      return true;
    },
    redo: function () {
      if (!this.redoStack.length) return false;
      this.undoStack.push(cloneImageData(this.imageData));
      this.imageData = this.redoStack.pop();
      this.cropRect = null;
      this.render();
      this.onCropChange(null);
      this.onChange();
      return true;
    },
    reset: function () {
      if (!this.original) return;
      this.pushUndo();
      this.imageData = cloneImageData(this.original);
      this.cropRect = null;
      this.render();
      this.onCropChange(null);
      this.onChange();
    },

    pushUndo: function () {
      this.undoStack.push(cloneImageData(this.imageData));
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack.length = 0;
    },

    /* ---------- 变换 ---------- */
    _applyCanvas: function (canvas) {
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      this.cropRect = null;
      this.render();
      this.onCropChange(null);
      this.onChange();
    },
    _toCanvas: function () {
      var id = this.imageData;
      var c = document.createElement('canvas');
      c.width = id.width;
      c.height = id.height;
      c.getContext('2d').putImageData(id, 0, 0);
      return c;
    },

    /* 画幅：rw:rh 比例，mode = fit | fill */
    setAspect: function (rw, rh, mode) {
      if (!this.imageData) return false;
      if (!rw || !rh) return false;
      this.pushUndo();
      this._applyCanvas(transforms.aspect(this._toCanvas(), rw, rh, mode));
      return true;
    },

    resizeCanvas: function (w, h, anchor) {
      if (!this.imageData) return false;
      w = Math.max(1, Math.floor(w));
      h = Math.max(1, Math.floor(h));
      if (w === this.imageData.width && h === this.imageData.height) return false;
      this.pushUndo();
      this._applyCanvas(transforms.resize(this._toCanvas(), w, h, anchor));
      return true;
    },

    /* 裁剪：应用当前选区 */
    cropApply: function () {
      var r = this.cropRect;
      if (!r || r.w < 1 || r.h < 1) return false;
      this.pushUndo();
      this._applyCanvas(transforms.crop(this._toCanvas(), r.x, r.y, r.w, r.h));
      return true;
    },
    cropClear: function () {
      this.cropRect = null;
      this.render();
      this.onCropChange(null);
    },
    cropSelectAll: function () {
      if (!this.imageData) return;
      this.cropRect = { x: 0, y: 0, w: this.imageData.width, h: this.imageData.height };
      this.render();
      this.onCropChange(this.cropRect);
    },

    /* ---------- 绘制 ---------- */
    applyBrush: function (x, y) {
      var d = this.imageData.data;
      var w = this.imageData.width, h = this.imageData.height;
      var s = this.brushSize;
      var half = s >> 1;
      for (var dy = 0; dy < s; dy++) {
        var yy = y - half + dy;
        if (yy < 0 || yy >= h) continue;
        for (var dx = 0; dx < s; dx++) {
          var xx = x - half + dx;
          if (xx < 0 || xx >= w) continue;
          var p = (yy * w + xx) * 4;
          if (this.tool === 'eraser') {
            d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = 0;
          } else {
            d[p] = this.color[0]; d[p + 1] = this.color[1]; d[p + 2] = this.color[2]; d[p + 3] = 255;
          }
        }
      }
    },

    _pick: function (x, y) {
      var d = this.imageData.data;
      var p = (y * this.imageData.width + x) * 4;
      this.color = [d[p], d[p + 1], d[p + 2]];
      this.tool = 'brush';
      this.onPick(this.color, d[p + 3]);
      this.render();
    },

    render: function () {
      if (!this.imageData) {
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.ctx.clearRect(0, 0, 1, 1);
        return;
      }
      var id = this.imageData;
      this._base.width = id.width;
      this._base.height = id.height;
      this._baseCtx.putImageData(id, 0, 0);

      var wrap = this.canvas.parentElement;
      var wrapW = Math.max(50, wrap.clientWidth - 4);
      var wrapH = Math.max(50, wrap.clientHeight - 4);
      var scale;
      if (this.zoom == null) {
        scale = Math.min(wrapW / id.width, wrapH / id.height);
        if (!isFinite(scale) || scale <= 0) scale = 1;
      } else {
        scale = this.zoom;
      }
      this._scale = scale;

      var dw = Math.max(1, Math.round(id.width * scale));
      var dh = Math.max(1, Math.round(id.height * scale));
      if (this.canvas.width !== dw) this.canvas.width = dw;
      if (this.canvas.height !== dh) this.canvas.height = dh;
      this.canvas.style.width = dw + 'px';
      this.canvas.style.height = dh + 'px';

      var ctx = this.ctx;
      ctx.imageSmoothingEnabled = !(this.zoom != null && this.zoom >= 1);
      ctx.clearRect(0, 0, dw, dh);
      ctx.drawImage(this._base, 0, 0, dw, dh);

      if (this.zoom != null && this.zoom >= 8) this._drawGrid(dw, dh);
      if (this.tool === 'crop') this._drawCrop(dw, dh);
    },

    _drawGrid: function (dw, dh) {
      var ctx = this.ctx;
      var id = this.imageData;
      var scale = this._scale;
      ctx.strokeStyle = 'rgba(0,0,0,0.20)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = 0; x <= id.width; x++) {
        var px = Math.round(x * scale) + 0.5;
        ctx.moveTo(px, 0); ctx.lineTo(px, dh);
      }
      for (var y = 0; y <= id.height; y++) {
        var py = Math.round(y * scale) + 0.5;
        ctx.moveTo(0, py); ctx.lineTo(dw, py);
      }
      ctx.stroke();
    },

    _drawCrop: function (dw, dh) {
      var ctx = this.ctx;
      var r = this.cropRect;
      if (!r) return;
      var s = this._scale;
      var sx = Math.round(r.x * s), sy = Math.round(r.y * s);
      var sw = Math.round(r.w * s), sh = Math.round(r.h * s);

      ctx.save();
      // 选区外变暗
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, dw, sy);
      ctx.fillRect(0, sy + sh, dw, Math.max(0, dh - sy - sh));
      ctx.fillRect(0, sy, sx, sh);
      ctx.fillRect(sx + sw, sy, Math.max(0, dw - sx - sw), sh);

      // 边框
      ctx.strokeStyle = '#6aa5ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, Math.max(0, sw - 2), Math.max(0, sh - 2));

      // 三分线
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 1; i <= 2; i++) {
        var gx = Math.round((sx + (sw * i) / 3)) + 0.5;
        var gy = Math.round((sy + (sh * i) / 3)) + 0.5;
        ctx.moveTo(gx, sy); ctx.lineTo(gx, sy + sh);
        ctx.moveTo(sx, gy); ctx.lineTo(sx + sw, gy);
      }
      ctx.stroke();
      ctx.restore();
    },

    eventToPixel: function (e) {
      var rect = this.canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      return [
        Math.floor((mx * this.imageData.width) / rect.width),
        Math.floor((my * this.imageData.height) / rect.height)
      ];
    },

    _clampX: function (v) { return Math.max(0, Math.min(this.imageData.width - 1, v)); },
    _clampY: function (v) { return Math.max(0, Math.min(this.imageData.height - 1, v)); },

    _emitStatus: function (e) {
      var w = this.imageData ? this.imageData.width : 0;
      var h = this.imageData ? this.imageData.height : 0;
      var out = { inImage: false, x: 0, y: 0, r: 0, g: 0, b: 0, a: 0, w: w, h: h };
      if (this.imageData) {
        var px = this.eventToPixel(e);
        out.x = px[0]; out.y = px[1];
        if (px[0] >= 0 && px[1] >= 0 && px[0] < w && px[1] < h) {
          out.inImage = true;
          var p = (px[1] * w + px[0]) * 4;
          var d = this.imageData.data;
          out.r = d[p]; out.g = d[p + 1]; out.b = d[p + 2]; out.a = d[p + 3];
        }
      }
      this.onStatus(out);
    },

    _updateCrop: function (x, y) {
      var s = this._cropStart;
      var x0 = Math.max(0, Math.min(s.x, x));
      var y0 = Math.max(0, Math.min(s.y, y));
      var x1 = Math.min(this.imageData.width, Math.max(s.x, x) + 1);
      var y1 = Math.min(this.imageData.height, Math.max(s.y, y) + 1);
      this.cropRect = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
      this.onCropChange(this.cropRect);
    },

    _bindEvents: function () {
      var c = this.canvas;
      var self = this;
      c.style.touchAction = 'none';
      c.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      c.addEventListener('pointerdown', function (e) {
        if (!self.imageData) return;
        e.preventDefault();
        try { c.setPointerCapture(e.pointerId); } catch (err) {}
        var px = self.eventToPixel(e);
        var inside = px[0] >= 0 && px[1] >= 0 && px[0] < self.imageData.width && px[1] < self.imageData.height;

        if (self.tool === 'crop') {
          var cx = self._clampX(px[0]), cy = self._clampY(px[1]);
          self._cropStart = { x: cx, y: cy };
          self.cropRect = { x: cx, y: cy, w: 1, h: 1 };
          self.render();
          self.onCropChange(self.cropRect);
          self._emitStatus(e);
          return;
        }
        if (!inside) { self._emitStatus(e); return; }
        if (self.tool === 'picker') { self._pick(px[0], px[1]); self._emitStatus(e); return; }

        self._drawing = true;
        self.pushUndo();
        self._lastX = px[0]; self._lastY = px[1];
        self.applyBrush(px[0], px[1]);
        self.render();
        self._emitStatus(e);
      });

      c.addEventListener('pointermove', function (e) {
        if (!self.imageData) { self._emitStatus(e); return; }
        if (self.tool === 'crop' && self._cropStart) {
          var cp = self.eventToPixel(e);
          self._updateCrop(cp[0], cp[1]);
          self.render();
        } else if (self._drawing) {
          var px = self.eventToPixel(e);
          var cx = self._clampX(px[0]), cy = self._clampY(px[1]);
          plotLine(self._lastX, self._lastY, cx, cy, function (x, y) { self.applyBrush(x, y); });
          self._lastX = cx; self._lastY = cy;
          self.render();
        }
        self._emitStatus(e);
      });

      function endStroke() {
        if (self.tool === 'crop' && self._cropStart) {
          self._cropStart = null;
          self.render();
        }
        if (self._drawing) {
          self._drawing = false;
          self._lastX = null; self._lastY = null;
          self.onChange();
        }
      }
      c.addEventListener('pointerup', endStroke);
      c.addEventListener('pointercancel', endStroke);
      c.addEventListener('pointerleave', function () {
        if (self._drawing || self._cropStart) endStroke();
        self.onStatus({ inImage: false, w: self.imageData ? self.imageData.width : 0, h: self.imageData ? self.imageData.height : 0 });
      });
    }
  };

  VF.ImgTools.transforms = transforms;
  VF.ImgTools.computeAspect = computeAspect;

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
