/**
 * M3U8 广告过滤器 —— 播放器清洗提示浮层（MAIN world，所有 frame，document_start）
 *
 * 形态：半透明小 Toast（消息弹窗风格），清洗发生时在播放器右上角浮现，
 *       3 秒淡出；点击可在下方展开最近 10 条清洗记录（时间/规则/片数），再点收起。
 *
 * 设置：popup 的"清洗提示浮层"开关（storage.local.overlayEnabled，默认显示）
 *       经 bridge 下发 {__m3u8FilterMsg:{kind:'overlayEnabled', enabled}}；关闭时不渲染任何 DOM。
 *
 * 样式隔离：全部样式挂在 Shadow DOM（closed）内，不受站点 CSS 影响、也不污染站点。
 * 记录仅存内存，页面刷新即清空。
 */
(function () {
  'use strict';
  if (window.__M3U8OverlayLoaded) return;
  window.__M3U8OverlayLoaded = true;

  var enabled = true;   // 默认显示：等 bridge 的 getEnabled 回包纠正
  var entries = [];     // 清洗记录（最新在前，最多 10 条）
  var hostEl = null;    // 浮层挂载点（含 shadow root）
  var shadow = null;
  var hideTimer = null;
  var expanded = false;

  // ---- 挂载：懒加载，第一次显示时才创建 DOM ----
  function mount() {
    if (hostEl) return;
    hostEl = document.createElement('div');
    hostEl.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;';
    shadow = hostEl.attachShadow({ mode: 'closed' });
    shadow.innerHTML =
      '<style>' +
      '.toast{' +
      '  pointer-events:auto;cursor:pointer;' +
      '  box-sizing:border-box;max-width:260px;' +
      '  padding:6px 10px;border-radius:8px;' +
      '  background:rgba(20,22,26,0.55);' +          // 半透明深底，任何播放器上都读得清
      '  color:rgba(255,255,255,0.92);' +
      '  font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif;' +
      '  text-align:left;user-select:none;' +
      '  opacity:0;transform:translateY(-4px);' +
      '  transition:opacity .25s,transform .25s;' +
      '}' +
      '.toast.show{opacity:1;transform:translateY(0);}' +
      '.list{margin:6px 0 0;padding:0;list-style:none;display:none;}' +
      '.toast.open + .list{display:block;}' +
      '.list li{' +
      '  margin-top:4px;padding:4px 10px;border-radius:6px;' +
      '  background:rgba(20,22,26,0.55);color:rgba(255,255,255,0.75);' +
      '  font:11px/1.5 Consolas,monospace;white-space:nowrap;' +
      '}' +
      '.list li b{color:rgba(255,255,255,0.92);font-weight:600;}' +
      '</style>' +
      '<div class="toast" part="toast"></div>' +
      '<ul class="list"></ul>';
    shadow.querySelector('.toast').addEventListener('click', toggleList);
    document.documentElement.appendChild(hostEl);
  }

  function unmount() {
    if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl);
    hostEl = null;
    shadow = null;
    expanded = false;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  // ---- 定位：优先贴 video 右上角内侧，找不到 video 则贴视口右上 ----
  function place() {
    if (!hostEl) return;
    var top = 10, right = 10;
    try {
      var v = document.querySelector('video');
      if (v) {
        var r = v.getBoundingClientRect();
        top = Math.max(4, r.top + 10);
        right = Math.max(4, window.innerWidth - r.right + 10);
      }
    } catch (e) { /* 布局异常时用兜底位置 */ }
    hostEl.style.top = top + 'px';
    hostEl.style.right = right + 'px';
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function render() {
    if (!shadow || entries.length === 0) return;
    var latest = entries[0];
    var toast = shadow.querySelector('.toast');
    // 主文案：最近一次清洗（规则明细为空时不带括号）
    toast.textContent = '已剔除 ' + latest.count + ' 个广告分片' +
      (latest.rules ? '（' + latest.rules + '）' : '') + ' · 点击查看';
    toast.classList.toggle('open', expanded);
    var list = shadow.querySelector('.list');
    list.innerHTML = '';
    for (var i = 0; i < entries.length; i++) {
      var li = document.createElement('li');
      li.innerHTML = '<b>' + fmtTime(entries[i].time) + '</b>  ' +
        entries[i].count + ' 片' + (entries[i].rules ? '  ' + entries[i].rules : '');
      list.appendChild(li);
    }
    place();
    // 展开态不自动隐藏；收起态 3 秒淡出
    if (!expanded) scheduleHide();
  }

  function toggleList() {
    expanded = !expanded;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    render();
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      hideTimer = null;
      if (!shadow) return;
      shadow.querySelector('.toast').classList.remove('show');
      shadow.querySelector('.list').style.display = 'none';
    }, 3000);
  }

  // ---- 对外接口：filter-main 清洗后调用 ----
  window.__M3U8Overlay = {
    notify: function (entry) {
      entries.unshift({ count: entry.count || 0, rules: entry.rules || '', time: entry.time || Date.now() });
      if (entries.length > 10) entries.length = 10;
      if (!enabled) return; // 关闭时不渲染 DOM（记录仍留内存，开关打开后可见）
      mount();
      render();
      var toast = shadow.querySelector('.toast');
      // 强制回流后加 show，保证淡入动画每次都触发
      void toast.offsetWidth;
      toast.classList.add('show');
      shadow.querySelector('.list').style.display = expanded ? 'block' : 'none';
      scheduleHide();
    },
    setEnabled: function (v) {
      enabled = !!v;
      if (!enabled) unmount();
    }
  };

  // ---- 设置下行（来自 bridge 的 ISOLATED 桥）----
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var m = ev.data && ev.data.__m3u8FilterMsg;
    if (m && m.kind === 'overlayEnabled') window.__M3U8Overlay.setEnabled(m.enabled);
  });
})();
