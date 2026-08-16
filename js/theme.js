/*
 * VideoFrame - theme.js
 * 主题管理器：默认深色主题 + 新增「液态玻璃」主题。
 * 与主应用逻辑完全解耦：仅操作 <html> 上的 theme-glass 类与 localStorage。
 */
(function (global) {
  'use strict';
  var VF = (global.VF = global.VF || {});
  var KEY = 'vf-theme';
  var THEMES = ['dark', 'glass'];

  function current() {
    var t = null;
    try { t = localStorage.getItem(KEY); } catch (e) {}
    return THEMES.indexOf(t) >= 0 ? t : 'dark';
  }

  function apply(theme) {
    if (THEMES.indexOf(theme) < 0) theme = 'dark';
    document.documentElement.classList.toggle('theme-glass', theme === 'glass');
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    var sel = document.getElementById('themeSelect');
    if (sel && sel.value !== theme) sel.value = theme;
    return theme;
  }

  function init() {
    apply(current());
    var sel = document.getElementById('themeSelect');
    if (sel) {
      sel.value = current();
      sel.addEventListener('change', function () { apply(sel.value); });
    }
  }

  VF.Theme = { current: current, apply: apply, init: init, THEMES: THEMES };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
})(typeof window !== 'undefined' ? window : globalThis);
