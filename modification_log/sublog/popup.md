# modification_log/sublog/popup.md —— popup/开关功能日志

> 新记录插顶部（越新行数越小）。

---

## 对应主函数的位置，包括链接和行数
- [src/bridge.js](C:/Users/32277/m3u8-ad-filter/src/bridge.js)（全文，54 行）
- [src/background.js](C:/Users/32277/m3u8-ad-filter/src/background.js)（全文）
- [src/filter-main.js](C:/Users/32277/m3u8-ad-filter/src/filter-main.js)
    - install/uninstall: 103-197
    - setEnabled: 199-206
    - pushStats: 39-51
    - snapshotStats/notifyOverlay（v1.1.0 浮层通知）: 44-63
- [src/overlay.js](C:/Users/32277/m3u8-ad-filter/src/overlay.js)（全文，v1.1.0 新增）
- [popup/popup.html](C:/Users/32277/m3u8-ad-filter/popup/popup.html)（全文）
- [popup/popup.js](C:/Users/32277/m3u8-ad-filter/popup/popup.js)（全文）

## 对应在 basic_code_information_archive 的文档位置
- [src.md](C:/Users/32277/m3u8-ad-filter/basic_code_information_archive/src.md)
    - filter-main.js / overlay.js / bridge.js / background.js 节

---

## [2026-10-04 16:40] v1.1.0 播放器清洗浮层
- **需求**: 用户提出"插件设置里给一个浮层显示开关，默认显示，支持关掉；弹窗小小的像消息弹窗，半透明"（grill-me 对齐：全局作用域、点击展开最近 10 条记录、记录内存存储刷新即清）
- **提示词**: "可以，但是记得给一个选项在插件设置里面，就是这个浮层是否显示，默认显示，然后支持关掉" + "这个弹窗不要太大，小小的像一个消息弹窗一样，半透明"
- **改动文件**: src/overlay.js（新建）, src/filter-main.js, src/bridge.js, src/background.js, popup/popup.html|css|js, manifest.json（1.0.0→1.1.0，MAIN js 数组加 overlay.js）
- **改动说明**:
  - 新增 src/overlay.js（MAIN world）：清洗发生时播放器右上角浮现半透明深底小 Toast（rgba(20,22,26,0.55)、max-width 260px、12px 字号），3 秒淡出；点击展开/收起最近 10 条记录（HH:MM:SS / N片 / 规则×数量）；closed Shadow DOM 样式隔离；懒挂载（首次通知才建 DOM）；定位优先贴本 frame video 右上角内侧
  - filter-main：snapshotStats()/notifyOverlay()——清洗前快照 stats.removedByRule，清洗后差分出本次规则明细，XHR/fetch 两个清洗点均调用；overlay 未加载时静默不影响主链路
  - 开关管道（复用 v1.2.0 下行架构）：popup "清洗提示浮层"开关（站点开关下方，全局不分站点）→ popup:setOverlay → background 写 storage.local.overlayEnabled（默认 true）→ tabs.sendMessage(setOverlay) → bridge → postMessage(kind:'overlayEnabled') → overlay.setEnabled；getEnabled 回包也带 overlayEnabled 供初始化纠正
  - 关闭语义：unmount 卸载 DOM + 后续 notify 只记内存不渲染；重开等下一次清洗事件出现
  - 真机验证（Tabbit 注入 yhdmtv 凡人修仙传 03 火箭云线路）：真实清洗事件（规则 D 删 5 片）自动挂载 Toast；文案"已剔除 5 个广告分片（D×5） · 点击查看"；点击展开 10 条记录列表；开关关→DOM 卸载、关期间 notify 不挂载；`node demo/run.js` 50 用例 + 对抗用例全绿
  - 验证工具链坑（非产品 bug）：Tabbit addInitScript 用 atob 解码是 Latin-1，中文需 TextDecoder('utf-8') 二次解码，否则浮层文案乱码

## [2026-10-04 15:00] v1.2.0 popup 开关 + 统计面板
- **需求**: 用户锁定的第三个地基决策："popup 开关+统计面板"——按站点启用/禁用 + 实时统计，供分发后用户自助排障
- **提示词**: （plan 批准内的步骤 4）
- **改动文件**: src/bridge.js（新建）, src/background.js（新建）, src/filter-main.js（重写）, popup/popup.html|css|js（新建）, manifest.json
- **改动说明**:
  - 架构（plan §3）：下行 popup → storage.local(siteOverrides) → tabs.sendMessage → bridge(ISOLATED) → postMessage(__m3u8FilterMsg) → filter-main(MAIN)；上行 stats 反向
  - host 解析在 background（sender.tab.url，需 host_permissions <all_urls>）——iframe 里的 bridge 不知道顶层站点
  - document_start 竞态：MAIN 默认启用先装拦截，getEnabled 回包到达后纠正（窗口 <50ms，失误后果只是多清洗一次）
  - 干净卸载：install 保存自身包装引用，uninstall 只在"当前还是我的包装"时恢复原生（防误撤页面/其他扩展包装）
  - popup UI：站点域名+滑块开关、四项统计（checked/cleaned/removed/suspects）、最近处理 URL、清零统计、恢复默认；深浅色自适应
  - manifest：双 content_scripts entry（MAIN/ISOLATED 各一，同 entry 只能声明一个 world）、background.service_worker、action.default_popup、permissions:["storage"]、host_permissions:["<all_urls>"]
  - 真机验证（Tabbit 注入等效）：火箭云线路规则 D 删 5 片；开关禁用→fetch 返回原文 292 片、启用→287 片、统计一致；跨 357s 删除接缝播放连续无卡顿
