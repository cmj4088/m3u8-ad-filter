/**
 * M3U8 广告过滤器 —— 后台 service worker（MV3）
 *
 * 职责（hub，无业务逻辑）：
 *   1. 开关解析：bridge/popup 询问某 tab 是否启用 → 读 storage.local
 *      siteOverrides[host] ?? defaultEnabled（host 取 sender.tab.url 的顶层域名，
 *      iframe 里的 bridge 不知道顶层站点，故必须在 background 解析）
 *   2. 开关下行：popup 切开关 → 写 storage → 转发给该 tab 所有 frame 的 bridge
 *   3. 统计上行：各 frame 的 MAIN 世界 postMessage → bridge → 这里按
 *      (tabId, frameId) 暂存（MAIN 发来的是该 frame 的累计值，直接覆盖）
 *   4. 统计查询：popup 拉取时按 tabId 汇总各 frame
 *
 * MV3 worker 会被休眠，内存统计可接受丢失（popup 显示"重新打开视频以刷新统计"）。
 */
'use strict';

// 每个tab每个frame的最新统计 { tabId: { frameId: stats } }
const tabStats = new Map();

// 从完整 URL 提取顶层站点 host（取 sender.tab.url，非 frame url）
function topHostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

async function resolveEnabled(host) {
  const { siteOverrides = {}, defaultEnabled = true } = await chrome.storage.local.get(['siteOverrides', 'defaultEnabled']);
  if (host && Object.prototype.hasOwnProperty.call(siteOverrides, host)) return siteOverrides[host];
  return defaultEnabled !== false;
}

// 浮层显示开关（全局，不分站点；默认显示）
async function resolveOverlayEnabled() {
  const { overlayEnabled = true } = await chrome.storage.local.get('overlayEnabled');
  return overlayEnabled !== false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      // bridge 初始化询问：本 tab 是否启用
      case 'getEnabled': {
        const host = sender.tab ? topHostOf(sender.tab.url) : null;
        sendResponse({ enabled: await resolveEnabled(host), overlayEnabled: await resolveOverlayEnabled(), host });
        break;
      }
      // MAIN 世界的统计上报（经 bridge 转发）：按 (tabId, frameId) 覆盖暂存
      case 'stats': {
        if (!sender.tab) break;
        const byFrame = tabStats.get(sender.tab.id) || {};
        byFrame[sender.frameId || 0] = msg.stats;
        tabStats.set(sender.tab.id, byFrame);
        break;
      }
      default:
        break;
    }
  })();
  return true; // 异步 sendResponse
});

// ---- popup 专用通道（popup 不是 content script，直接发 runtime 消息）----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type || !msg.type.startsWith('popup:')) return false;
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    switch (msg.type) {
      case 'popup:getState': {
        const host = tab && tab.url ? topHostOf(tab.url) : null;
        const enabled = host ? await resolveEnabled(host) : false;
        // 汇总该 tab 所有 frame 的统计
        const byFrame = (tab && tabStats.get(tab.id)) || {};
        const sum = { playlistsChecked: 0, playlistsCleaned: 0, segmentsRemoved: 0, suspects: 0, lastUrl: '' };
        for (const fid of Object.keys(byFrame)) {
          const s = byFrame[fid];
          sum.playlistsChecked += s.playlistsChecked || 0;
          sum.playlistsCleaned += s.playlistsCleaned || 0;
          sum.segmentsRemoved += s.segmentsRemoved || 0;
          sum.suspects += s.suspects || 0;
          if (s.lastUrl) sum.lastUrl = s.lastUrl;
        }
        sendResponse({ ok: true, host, enabled, overlayEnabled: await resolveOverlayEnabled(), stats: sum });
        break;
      }
      // 浮层开关（全局）：写 storage 后下行到该 tab 所有 frame
      case 'popup:setOverlay': {
        await chrome.storage.local.set({ overlayEnabled: !!msg.enabled });
        if (tab) {
          chrome.tabs.sendMessage(tab.id, { type: 'setOverlay', enabled: !!msg.enabled }, () => void chrome.runtime.lastError);
        }
        sendResponse({ ok: true, overlayEnabled: !!msg.enabled });
        break;
      }
      case 'popup:setEnabled': {
        const host = tab && tab.url ? topHostOf(tab.url) : null;
        if (!host) { sendResponse({ ok: false }); break; }
        const { siteOverrides = {} } = await chrome.storage.local.get('siteOverrides');
        // 与默认一致的值也显式记录（用户意图优先于后续默认值变更）
        siteOverrides[host] = !!msg.enabled;
        await chrome.storage.local.set({ siteOverrides });
        // 下行到该 tab 所有 frame
        chrome.tabs.sendMessage(tab.id, { type: 'setEnabled', enabled: !!msg.enabled }, () => void chrome.runtime.lastError);
        sendResponse({ ok: true, enabled: !!msg.enabled });
        break;
      }
      case 'popup:resetOverride': {
        const host = tab && tab.url ? topHostOf(tab.url) : null;
        if (host) {
          const { siteOverrides = {} } = await chrome.storage.local.get('siteOverrides');
          delete siteOverrides[host];
          await chrome.storage.local.set({ siteOverrides });
        }
        const enabled = host ? await resolveEnabled(host) : true;
        if (tab) chrome.tabs.sendMessage(tab.id, { type: 'setEnabled', enabled }, () => void chrome.runtime.lastError);
        sendResponse({ ok: true, enabled });
        break;
      }
      case 'popup:resetStats': {
        if (tab) {
          tabStats.delete(tab.id);
          chrome.tabs.sendMessage(tab.id, { type: 'resetStats' }, () => void chrome.runtime.lastError);
        }
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});

// tab 关闭时清理统计
chrome.tabs.onRemoved.addListener((tabId) => tabStats.delete(tabId));
// 导航到新页面时清理（MAIN 世界计数随页面刷新自然归零，这里同步丢弃旧 frame 数据）
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') tabStats.delete(tabId);
});
