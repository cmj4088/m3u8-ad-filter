/**
 * M3U8 广告分片过滤器 —— 内容脚本 MAIN world（所有 frame，document_start）
 *
 * 职责：在页面网络层拦截 HLS 播放列表（m3u8）的 XHR/fetch 响应，
 *       交给 __M3U8Engine（m3u8-engine.js + rules.js）清洗后再交给播放器。
 *       广告分片被移除后，播放器永远不会请求它们，正片音画连续。
 *
 * 开关（经 bridge.js 的 ISOLATED 桥）：
 *   - 默认启用先装拦截（document_start 竞态窗口 <50ms，失误后果只是"多清洗一次"）
 *   - 禁用时恢复原生 XMLHttpRequest/fetch（干净卸载），启用时重新包装
 *   - 统计经 postMessage → bridge → background 按 tab 聚合 → popup 显示
 *
 * 本文件不做识别/重组——那些在 m3u8-engine.js / rules.js（可被 Node 测试复用）。
 *
 * 调试：控制台查看 window.__m3u8AdFilter（各 frame 独立计数）
 */
(function () {
  'use strict';
  if (window.__m3u8AdFilterLoaded) return;
  window.__m3u8AdFilterLoaded = true;

  var engine = window.__M3U8Engine;
  if (!engine) return; // engine 未注入（注入顺序由 manifest 保证，此处仅防御）

  var stats = { playlistsChecked: 0, playlistsCleaned: 0, segmentsRemoved: 0, suspects: 0, lastUrl: '' };
  window.__m3u8AdFilter = stats;

  var enabled = true; // 默认启用：等 bridge 的 getEnabled 回包再纠正

  // ---- 统计上报（序列化快照有变化才发，播放列表加载是低频事件）----
  var lastPushed = '';
  function pushStats() {
    var snap;
    try { snap = JSON.stringify(stats); } catch (e) { return; }
    if (snap === lastPushed) return;
    lastPushed = snap;
    try {
      window.postMessage({ __m3u8FilterMsg: { kind: 'stats', stats: JSON.parse(snap) } }, '*');
    } catch (e) { /* 失败不影响过滤 */ }
  }

  function maybePlaylist(url) {
    if (!url) return false;
    return /\.m3u8(\?|$)/i.test(url) || /m3u8/i.test(url);
  }

  function rewriteXhr(xhr) {
    if (!enabled || xhr.__adfilterDone) return;
    xhr.__adfilterDone = true;
    try {
      var text = xhr.responseText; // responseType 为 ''/text 时可用；arraybuffer/json 播放器不会用来加载 m3u8，静默跳过不是 bug
      if (!engine.isM3U8Text(text)) return;
      stats.playlistsChecked++;
      stats.lastUrl = xhr.__adfilterUrl || '';
      var cleaned = engine.filterPlaylist(text, stats);
      if (cleaned !== text) {
        stats.playlistsCleaned++;
        defineShim(xhr, cleaned);
        console.log('[M3U8-AdFilter] 已剔除 ' + stats.segmentsRemoved + ' 个广告分片 <-', stats.lastUrl);
      }
      pushStats();
    } catch (e) { /* responseType 非 text 时忽略 */ }
  }

  function defineShim(xhr, text) {
    Object.defineProperty(xhr, 'responseText', { get: function () { return text; }, configurable: true });
    Object.defineProperty(xhr, 'response', {
      get: function () {
        // 播放器加载 m3u8 时 responseType 都是 ''/text；其他类型不碰
        return (xhr.responseType === '' || xhr.responseType === 'text') ? text : null;
      },
      configurable: true
    });
  }

  // ---- XHR/fetch 拦截：install/uninstall 干净装卸 ----
  var proto = XMLHttpRequest.prototype;
  var origOpen = proto.open;
  var origSend = proto.send;
  var origFetch = window.fetch;
  var installed = false;
  // 自己装上的包装引用：卸载时只在"当前还是我的包装"时恢复原生，防误撤页面/其他扩展的包装
  var myOpen, mySend, myFetch;

  function install() {
    if (installed) return;
    installed = true;
    myOpen = function (method, url) {
      try { this.__adfilterUrl = String(url); } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    proto.open = myOpen;
    mySend = function () {
      try {
        var xhr = this;
        var url = xhr.__adfilterUrl || '';
        if (maybePlaylist(url) && !xhr.__adfilterWrapped) {
          xhr.__adfilterWrapped = true;
          var origRsc = xhr.onreadystatechange;
          xhr.onreadystatechange = function (ev) {
            if (xhr.readyState === 4) rewriteXhr(xhr);
            return origRsc && origRsc.call(xhr, ev);
          };
          var origOnload = xhr.onload;
          xhr.onload = function (ev) {
            if (xhr.readyState === 4) rewriteXhr(xhr);
            return origOnload && origOnload.call(xhr, ev);
          };
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
    proto.send = mySend;
    if (origFetch) {
      myFetch = function (input, init) {
        var url = '';
        try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
        var promise = origFetch.call(this, input, init);
        if (!enabled || !maybePlaylist(url)) return promise;
        return promise.then(function (resp) {
          try {
            var ct = '';
            try { ct = resp.headers.get('content-type') || ''; } catch (e2) {}
            if (ct.indexOf('mpegurl') === -1 && !/\.m3u8/i.test(url)) return resp;
            return resp.clone().text().then(function (text) {
              if (!engine.isM3U8Text(text)) return resp;
              stats.playlistsChecked++;
              stats.lastUrl = url;
              var cleaned = engine.filterPlaylist(text, stats);
              pushStats();
              if (cleaned !== text) {
                stats.playlistsCleaned++;
                console.log('[M3U8-AdFilter] 已剔除 ' + stats.segmentsRemoved + ' 个广告分片 <-', url);
                return new Response(cleaned, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
              }
              return resp;
            });
          } catch (e) { return resp; }
        });
      };
      window.fetch = myFetch;
    }
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    if (proto.open === myOpen) proto.open = origOpen;
    if (proto.send === mySend) proto.send = origSend;
    if (myFetch && window.fetch === myFetch) window.fetch = origFetch;
  }

  function setEnabled(v) {
    v = !!v;
    if (v === enabled) return;
    enabled = v;
    if (v) install();
    else uninstall();
  }

  // ---- 开关/重置指令（来自 bridge.js 的 ISOLATED 桥）----
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var m = ev.data && ev.data.__m3u8FilterMsg;
    if (!m) return;
    if (m.kind === 'setEnabled') setEnabled(m.enabled);
    else if (m.kind === 'resetStats') {
      stats.playlistsChecked = 0;
      stats.playlistsCleaned = 0;
      stats.segmentsRemoved = 0;
      stats.suspects = 0;
      pushStats();
    }
  });

  install(); // 默认启用先装拦截（宁多洗一次，不漏洗）
})();
