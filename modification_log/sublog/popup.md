# modification_log/sublog/popup.md —— popup/开关功能日志

> 新记录插顶部（越新行数越小）。

---

## 对应主函数的位置，包括链接和行数
- [src/bridge.js](C:/Users/32277/m3u8-ad-filter/src/bridge.js)（全文，47 行）
- [src/background.js](C:/Users/32277/m3u8-ad-filter/src/background.js)（全文）
- [src/filter-main.js](C:/Users/32277/m3u8-ad-filter/src/filter-main.js)
    - install/uninstall: 82-176
    - setEnabled: 178-185
    - pushStats: 39-51
- [popup/popup.html](C:/Users/32277/m3u8-ad-filter/popup/popup.html)（全文）
- [popup/popup.js](C:/Users/32277/m3u8-ad-filter/popup/popup.js)（全文）

## 对应在 basic_code_information_archive 的文档位置
- [src.md](C:/Users/32277/m3u8-ad-filter/basic_code_information_archive/src.md)
    - filter-main.js / bridge.js / background.js 节

---

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
