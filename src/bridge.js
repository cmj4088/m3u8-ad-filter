/**
 * M3U8 广告过滤器 —— ISOLATED world 桥（所有 frame，document_start）
 *
 * ISOLATED 世界独占 chrome.* API，MAIN 世界（filter-main.js）无法访问；
 * 两侧通过 window.postMessage({ __m3u8FilterMsg: ... }) 通信，
 * 专有字段名防止与页面其他脚本的消息冲突。
 *
 * 下行（开关）：background → chrome.runtime.onMessage → postMessage → MAIN
 * 上行（统计）：MAIN postMessage → 这里 → chrome.runtime.sendMessage → background
 */
(function () {
  'use strict';
  if (window.__m3u8FilterBridgeLoaded) return;
  window.__m3u8FilterBridgeLoaded = true;

  var MSG_KEY = '__m3u8FilterMsg';

  // 初始化：询问本 tab 是否启用，结果下发 MAIN（MAIN 默认启用先装拦截，
  // 若站点被禁用，这条消息到达后会立刻卸载——竞态窗口 <50ms，失误后果只是多清洗一次）
  try {
    chrome.runtime.sendMessage({ type: 'getEnabled' }, function (res) {
      if (chrome.runtime.lastError || !res) return;
      window.postMessage({ __m3u8FilterMsg: { kind: 'setEnabled', enabled: !!res.enabled } }, '*');
    });
  } catch (e) { /* 扩展上下文失效（如重载后旧页面）时静默 */ }

  // 下行监听：background 的开关指令转发给 MAIN
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'setEnabled') {
      window.postMessage({ __m3u8FilterMsg: { kind: 'setEnabled', enabled: !!msg.enabled } }, '*');
    } else if (msg && msg.type === 'resetStats') {
      window.postMessage({ __m3u8FilterMsg: { kind: 'resetStats' } }, '*');
    }
    // 不需要异步响应
  });

  // 上行监听：MAIN 的统计上报转交 background
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var m = ev.data && ev.data[MSG_KEY];
    if (!m || m.kind !== 'stats' || !m.stats) return;
    try {
      chrome.runtime.sendMessage({ type: 'stats', stats: m.stats }, function () {
        void chrome.runtime.lastError; // 忽略（如 worker 暂不可达）
      });
    } catch (e) { /* 扩展上下文失效 */ }
  });
})();
