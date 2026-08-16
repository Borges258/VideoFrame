/*
 * VideoFrame - extractor.js
 * 将 MP4 视频解码为 PNG 帧（浏览器 <video> + <canvas>，无服务端依赖）。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});

  /* 等待 seek 完成（带兜底，防止个别浏览器不触发 seeked 导致卡死） */
  function seekTo(video, time) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer;
      function finish() {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', finish);
        clearTimeout(timer);
        resolve();
      }
      timer = setTimeout(finish, 3000);
      video.addEventListener('seeked', finish);
      if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
        finish();
        return;
      }
      try { video.currentTime = time; } catch (e) { finish(); }
    });
  }

  VF.Extractor = {
    /* 读取视频元信息，返回可复用的 info 对象 */
    loadVideo: function (file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        var done = false;

        function cleanup() {
          if (url) { URL.revokeObjectURL(url); url = null; }
        }
        video.onloadedmetadata = function () {
          if (done) return;
          if (!video.videoWidth || !video.videoHeight) {
            done = true;
            cleanup();
            reject(new Error('无法解码此视频（编码格式可能不受浏览器支持）'));
            return;
          }
          done = true;
          resolve({
            video: video,
            url: url,
            fileName: file.name,
            fileSize: file.size,
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration || 0
          });
        };
        video.onerror = function () {
          if (done) return;
          done = true;
          cleanup();
          reject(new Error('视频加载失败，请确认是有效的 MP4 文件'));
        };
        video.src = url;
      });
    },

    releaseVideo: function (info) {
      if (!info) return;
      try { info.video.src = ''; info.video.load(); } catch (e) {}
      if (info.url) { URL.revokeObjectURL(info.url); info.url = null; }
    },

    /* 预热首帧，确保可绘制 */
    warmUp: async function (info) {
      var video = info.video;
      if (video.readyState >= 2) return;
      await new Promise(function (resolve) {
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('seeked', resolve, { once: true });
        if (video.currentTime === 0 && video.duration > 0) {
          video.currentTime = Math.min(0.001, video.duration);
        }
      });
    },

    /* 提取帧
     * opts: { fps, maxFrames, maxSide, onProgress(done, total) }
     * 返回 [{ name, width, height, timestamp, blob }]
     */
    extract: async function (info, opts) {
      var video = info.video;
      var duration = info.duration;
      var fps = Math.max(1, opts.fps || 10);
      var maxFrames = Math.max(1, opts.maxFrames || 200);
      var maxSide = opts.maxSide || 720;

      // 计算输出尺寸（最长边不超过 maxSide；maxSide=0 表示不缩放）
      var longest = Math.max(info.width, info.height);
      var scale = (maxSide > 0 && longest > maxSide) ? maxSide / longest : 1;
      var outW = Math.max(1, Math.round(info.width * scale));
      var outH = Math.max(1, Math.round(info.height * scale));

      // 生成时间戳
      var step = 1 / fps;
      var timestamps = [];
      for (var t = 0; t < duration - 1e-4; t += step) timestamps.push(t);
      if (!timestamps.length) timestamps.push(0);

      // 超过上限则均匀采样
      if (timestamps.length > maxFrames) {
        var sampled = [];
        for (var i = 0; i < maxFrames; i++) {
          var idx = Math.round((i * (timestamps.length - 1)) / (maxFrames - 1));
          sampled.push(timestamps[idx]);
        }
        timestamps = sampled;
      }

      await VF.Extractor.warmUp(info);

      var canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });

      var frames = [];
      for (var i = 0; i < timestamps.length; i++) {
        await seekTo(video, timestamps[i]);
        ctx.drawImage(video, 0, 0, outW, outH);
        var blob = await new Promise(function (res, rej) {
          canvas.toBlob(function (b) { b ? res(b) : rej(new Error('PNG 编码失败')); }, 'image/png');
        });
        frames.push({
          name: 'frame_' + VF.utils.pad(i + 1, 4) + '.png',
          width: outW,
          height: outH,
          timestamp: timestamps[i],
          blob: blob
        });
        if (opts.onProgress) opts.onProgress(i + 1, timestamps.length);
        if ((i & 7) === 7) await VF.utils.yield();
      }
      return frames;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
