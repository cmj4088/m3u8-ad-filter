/**
 * popup 逻辑：拉取当前 tab 的状态（host/开关/统计），渲染 + 反向下发指令。
 * 所有与扩展的通信走 chrome.runtime.sendMessage → background.js 的 popup:* 通道。
 */
'use strict';

const $ = (id) => document.getElementById(id);

async function refresh() {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'popup:getState' });
  } catch (e) {
    $('host').textContent = '无法连接后台';
    return;
  }
  if (!res || !res.ok) {
    $('host').textContent = '无法读取状态';
    return;
  }
  $('host').textContent = res.host || '(未知站点)';
  $('enabled').checked = !!res.enabled;
  $('checked').textContent = res.stats.playlistsChecked;
  $('cleaned').textContent = res.stats.playlistsCleaned;
  $('removed').textContent = res.stats.segmentsRemoved;
  $('suspects').textContent = res.stats.suspects;
  $('lastUrl').textContent = res.stats.lastUrl || '—';
  // 统计全零时提示可能还没播视频
  const empty = res.stats.playlistsChecked === 0;
  $('hint').classList.toggle('hidden', !empty);
}

// 开关：切到与 background 同步（storage 持久化 + 下行所有 frame）
$('enabled').addEventListener('change', async (ev) => {
  await chrome.runtime.sendMessage({ type: 'popup:setEnabled', enabled: ev.target.checked });
  refresh();
});

// 清零统计（background 与页面 MAIN 计数同时归零）
$('resetStats').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'popup:resetStats' });
  refresh();
});

// 恢复默认：删除本站点覆盖，回到全局默认（启用），并同步开关位置
$('resetOverride').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'popup:resetOverride' });
  refresh();
});

// manifest 版本号展示（单一事实来源在 manifest，避免硬编码漂移）
const mv = chrome.runtime.getManifest();
$('version').textContent = 'v' + mv.version;

refresh();
