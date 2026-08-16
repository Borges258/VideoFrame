/*
 * VideoFrame - editor.js
 * 像素级帧编辑器：画笔（添加像素）、橡皮（删除像素）、取色、缩放、
 * 撤销/重做、重置、画布尺寸调整。基于 Canvas + ImageData，无依赖。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});

  function cloneImageData(id) {
    return new ImageData(new Uint8ClampedArray(id.data), id.width, id.height);
  }

  /* Bresenham 直线，用于连续笔画 */
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

  VF.Editor = function FrameEditor(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.imageData = null;   // 当前工作副本
    this.original = null;    // 原始（重置用）
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = 30;

    this.tool = 'brush';     // brush | eraser | picker
    this.color = [255, 0, 0];
    this.brushSize = 1;
    this.zoom = null;        // null => 适应窗口

    this.onChange = opts.onChange || function () {};
    this.onPick = opts.onPick || function () {};
    this.onStatus = opts.onStatus || function () {};

    this._baseCanvas = document.createElement('canvas');
    this._baseCtx = this._baseCanvas.getContext('2d');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
    this._scale = 1;

    this._bindEvents();
  };

  VF.Editor.prototype = {
    load: function (imageData) {
      this.imageData = cloneImageData(imageData);
      this.original = cloneImageData(imageData);
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this.render();
    },

    hasFrame: function () { return !!this.imageData; },

    getImageData: function () { return this.imageData; },

    setTool: function (tool) { this.tool = tool; },

    setColor: function (r, g, b) { this.color = [r, g, b]; },

    setBrushSize: function (n) { this.brushSize = Math.max(1, Math.min(32, n | 0)); },

    zoomFit: function () { this.zoom = null; this.render(); return this._scale; },

    zoomIn: function () {
      if (this.zoom == null) {
        var cur = this._scale || 1;
        for (var i = 0; i < ZOOM_LEVELS.length; i++) {
          if (ZOOM_LEVELS[i] > cur) { this.zoom = ZOOM_LEVELS[i]; break; }
        }
        if (this.zoom == null) this.zoom = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
      } else {
        for (var j = 0; j < ZOOM_LEVELS.length; j++) {
          if (ZOOM_LEVELS[j] > this.zoom) { this.zoom = ZOOM_LEVELS[j]; break; }
        }
      }
      this.render();
      return this._scale;
    },

    zoomOut: function () {
      if (this.zoom == null) return this._scale;
      var prev = null;
      for (var i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
        if (ZOOM_LEVELS[i] < this.zoom) { prev = ZOOM_LEVELS[i]; break; }
      }
      this.zoom = prev; // null => fit
      this.render();
      return this._scale;
    },

    getZoomLabel: function () {
      if (this.zoom == null) return '适应';
      return Math.round(this.zoom * 100) + '%';
    },

    undo: function () {
      if (!this.undoStack.length) return false;
      this.redoStack.push(cloneImageData(this.imageData));
      this.imageData = this.undoStack.pop();
      this.render();
      this.onChange();
      return true;
    },

    redo: function () {
      if (!this.redoStack.length) return false;
      this.undoStack.push(cloneImageData(this.imageData));
      this.imageData = this.redoStack.pop();
      this.render();
      this.onChange();
      return true;
    },

    reset: function () {
      if (!this.original) return;
      this.pushUndo();
      this.imageData = cloneImageData(this.original);
      this.render();
      this.onChange();
    },

    resizeCanvas: function (w, h, anchor) {
      if (!this.imageData) return;
      w = Math.max(1, Math.floor(w));
      h = Math.max(1, Math.floor(h));
      var old = this.imageData;
      if (w === old.width && h === old.height) return;

      this.pushUndo();
      var result = new ImageData(w, h);
      var ox = 0, oy = 0;
      switch (anchor) {
        case 'tl': ox = 0; oy = 0; break;
        case 'tc': ox = Math.floor((w - old.width) / 2); oy = 0; break;
        case 'tr': ox = w - old.width; oy = 0; break;
        case 'cl': ox = 0; oy = Math.floor((h - old.height) / 2); break;
        case 'cc': ox = Math.floor((w - old.width) / 2); oy = Math.floor((h - old.height) / 2); break;
        case 'cr': ox = w - old.width; oy = Math.floor((h - old.height) / 2); break;
        case 'bl': ox = 0; oy = h - old.height; break;
        case 'bc': ox = Math.floor((w - old.width) / 2); oy = h - old.height; break;
        case 'br': ox = w - old.width; oy = h - old.height; break;
        default: ox = Math.floor((w - old.width) / 2); oy = Math.floor((h - old.height) / 2);
      }

      var oldData = old.data, resData = result.data;
      var x0 = Math.max(0, ox), y0 = Math.max(0, oy);
      var x1 = Math.min(w, ox + old.width), y1 = Math.min(h, oy + old.height);
      for (var y = y0; y < y1; y++) {
        var srcY = y - oy;
        for (var x = x0; x < x1; x++) {
          var sp = (srcY * old.width + (x - ox)) * 4;
          var dp = (y * w + x) * 4;
          resData[dp] = oldData[sp];
          resData[dp + 1] = oldData[sp + 1];
          resData[dp + 2] = oldData[sp + 2];
          resData[dp + 3] = oldData[sp + 3];
        }
      }
      this.imageData = result;
      this.render();
      this.onChange();
    },

    /* ---------- 内部 ---------- */
    pushUndo: function () {
      this.undoStack.push(cloneImageData(this.imageData));
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack.length = 0;
    },

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
      var w = this.imageData.width;
      var p = (y * w + x) * 4;
      var a = d[p + 3];
      this.color = [d[p], d[p + 1], d[p + 2]];
      this.tool = 'brush';
      this.onPick(this.color, a);
    },

    render: function () {
      if (!this.imageData) {
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.ctx.clearRect(0, 0, 1, 1);
        return;
      }
      var id = this.imageData;
      this._baseCanvas.width = id.width;
      this._baseCanvas.height = id.height;
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
      ctx.drawImage(this._baseCanvas, 0, 0, dw, dh);

      if (this.zoom != null && this.zoom >= 8) this._drawGrid(dw, dh);
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

    eventToPixel: function (e) {
      var rect = this.canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var px = Math.floor(mx * this.imageData.width / rect.width);
      var py = Math.floor(my * this.imageData.height / rect.height);
      return [px, py];
    },

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
        if (px[0] < 0 || px[1] < 0 || px[0] >= self.imageData.width || px[1] >= self.imageData.height) {
          self._emitStatus(e);
          return;
        }
        if (self.tool === 'picker') {
          self._pick(px[0], px[1]);
          self._emitStatus(e);
          return;
        }
        self._drawing = true;
        self.pushUndo();
        self._lastX = px[0]; self._lastY = px[1];
        self.applyBrush(px[0], px[1]);
        self.render();
        self._emitStatus(e);
      });

      c.addEventListener('pointermove', function (e) {
        if (self._drawing && self.imageData) {
          var px = self.eventToPixel(e);
          var cx = Math.max(0, Math.min(self.imageData.width - 1, px[0]));
          var cy = Math.max(0, Math.min(self.imageData.height - 1, px[1]));
          plotLine(self._lastX, self._lastY, cx, cy, function (x, y) { self.applyBrush(x, y); });
          self._lastX = cx; self._lastY = cy;
          self.render();
        }
        self._emitStatus(e);
      });

      function endStroke() {
        if (self._drawing) {
          self._drawing = false;
          self._lastX = null; self._lastY = null;
          self.onChange();
        }
      }
      c.addEventListener('pointerup', endStroke);
      c.addEventListener('pointercancel', endStroke);
      c.addEventListener('pointerleave', function (e) {
        if (!self._drawing) self.onStatus({ inImage: false, w: self.imageData ? self.imageData.width : 0, h: self.imageData ? self.imageData.height : 0 });
      });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
