# src/ 代码说明（与源码目录镜像）

## 文件: src/m3u8-engine.js
- **路径**: C:\Users\32277\m3u8-ad-filter\src\m3u8-engine.js
- **作用**: M3U8 解析/清洗引擎（纯函数，无 window 依赖，Node 可直接 require）。四段式：parse（不丢行只建模）→ rules.analyze（规则标记）→ rebuild（只删不改重组）→ sanitizeOutput（历史事故固化为断言，任一失败返回原文）。
- **关键函数/类**:
  - `parsePlaylist(text)`: 解析播放列表为 model（lines/segs/blocks 按 DIS 分块/hasEndList/hasByterange/hasRealKey），分片携带 uri/dur/dec/dir/host/pattern/keyNone/keyUri
  - `filterPlaylist(text, stats)`: 主入口。放弃白名单（master/直播无 ENDLIST/BYTERANGE）→ 规则 → 30% 全删放弃阀 → rebuild → sanitize
  - `rebuild(model)`: 重组。被删块两侧 DIS 各吸收一个，删除接缝保留恰好一个 DIS；头标签白名单直出；EXTINF/KEY/MAP 标签跟随下一个保留分片
  - `sanitizeOutput(original, model, rebuilt, stats)`: 6 条断言（首行 EXTM3U / ENDLIST 保留性 / 保留序列===未删序列 / EXTINF-URI 配对 / 保留>0 / 无连续双 DIS），失败计 `stats.sanitizerFallback` 返回原文
  - `isM3U8Text(text)`: 文本是否 m3u8（含 #EXTM3U）
  - `segUrisOf(text)`: 提取分片 URI 序列（安全器与测试共用）
- **常量**: `AD_BLOCK_MAX_DURATION=90`（广告块时长上限）、`ABANDON_RATIO=0.3`（30% 放弃阀）
- **导出（UMD）**: `window.__M3U8Engine` / `module.exports` = { filterPlaylist, parsePlaylist, rebuild, sanitizeOutput, isM3U8Text, segUrisOf, AD_BLOCK_MAX_DURATION, ABANDON_RATIO }
- **依赖关系**:
  - 引入: 无（自包含）
  - 被引用: src/filter-main.js（MAIN world 调 filterPlaylist）、src/rules.js（约定 model 结构）、demo/run.js 与 demo 对抗用例（Node require）
- **红线（历史事故固化）**: v1.1.0 丢 ENDLIST → 直播化假死；v1.1.1 EXTM3U 非首行 → manifestParsingError 全挂；接缝 DIS 数量错误 → 播放器卡死。三者均有 sanitizer 断言把守。
- **最后修改**: 2026-10-04
- **修改原因**: v1.2.0 规则引擎通用化重构（见 modification_log/sublog/engine.md）

## 文件: src/rules.js
- **路径**: C:\Users\32277\m3u8-ad-filter\src\rules.js
- **作用**: 广告识别规则管道（纯函数）。裁决总纲"宁漏勿误"：Tier 1 高置信即删（A/C/D/E/F），Tier 2 组合判（总分 ≥1.5 且信号 ≥2），其余只记 suspect。
- **关键函数/类**:
  - `analyze(model, stats)`: 依次执行规则 A（路径关键词）/ F（dummy 分片）/ E（KEY 三明治）/ C（编号三明治 anchor 走链）/ D（DIS 孤立短块+佐证）/ Tier 2 组合判 / 尾组 suspect 统计；直接改写 model.segs[].remove 并返回删除日志
  - `hasFracDur(segs, idxs)`: 帧率型非终止小数时长检测（d*1000 非整数，如 4.866667=29.97fps 转码产物）——S7 佐证的数值级实现（ffzy 全列表 EXTINF 一律 %0.6f 格式化，文本小数位无对比意义）
  - `tailIndexOf(uri)`: 文件名末尾编号（规则 C）
  - `mark/markBlock`: 标记待删分片（幂等，记录命中规则）
- **规则明细**:
  - A 路径强关键词：`AD_PATH_RE`（adjump、/ads/、/adv/、advertise、popunder 等，限定路径段+边界）
  - C 编号三明治：前块尾 N → 本块首≠N+1 → 后块首=N+1 且本块 <90s；anchor 断链后本列表不再触发（连锁误杀保护）
  - D DIS 孤立短块：中间块、≤10 片 <90s、同列表其余块均 ≥30s，且 S7（帧率小数对比）/S6（重复 URI）/S3（时长均匀）至少一条佐证
  - E KEY 三明治：METHOD=NONE 区段夹在两个真 KEY 区段间（AWS MediaTailor/Google DAI 标准 SSAI 形态）
  - F dummy 分片：EXTINF<0.1s 且 URI 与相邻重复
  - Tier 2：S3 0.75 / S6 1.0 / S7 0.75 / S8 目录前缀偏离 1.0 / S1 host 偏离 1.0 / S4 绝对相对性偏离 0.5 / B1 命名形状少数派 0.5（纯佐证）
  - suspect（只记不删）：末 DIS 后 ≤20s 且 < 组时长众数 1/3 的尾组（片尾贴片/预告同构）
- **明确不实现（业界证伪）**: 纯时长打分、文件名长度多数投票独立删、duration<1s 单片删、密集 DIS 短块直接删
- **导出（UMD）**: `window.__M3U8Rules` / `module.exports` = { analyze, AD_PATH_RE }
- **依赖关系**:
  - 引入: 无（消费 m3u8-engine.js 的 model 结构）
  - 被引用: src/filter-main.js（经 __M3U8Engine.filterPlaylist 间接调用）、demo/run.js
- **最后修改**: 2026-10-04
- **修改原因**: v1.2.0：S7 由"文本小数位对比"改为"帧率型非终止小数对比"（实测 ffzy 样本全列表 %0.6f 格式化，原实现永不命中）

## 文件: src/filter-main.js
- **路径**: C:\Users\32277\m3u8-ad-filter\src\filter-main.js
- **作用**: MAIN world 内容脚本。网络层拦截（XHR + fetch）m3u8 响应交给引擎清洗；管理 enabled 开关（安装/卸载拦截包装）；统计上报给 bridge。
- **关键函数/类**:
  - `install()/uninstall()`: 干净装卸。保存自身包装引用（myOpen/mySend/myFetch），卸载时只在"当前还是我的包装"时恢复原生（防误撤页面/其他扩展的包装）
  - `rewriteXhr(xhr)`: readyState=4 时改写 responseText/response（defineShim）；`xhr.__adfilterDone` 防重复
  - `pushStats()`: 统计快照变化时 postMessage 给 bridge（低频事件，无节流必要）
  - `setEnabled(v)`: 开关；禁用恢复原生引用
  - message 监听: `{__m3u8FilterMsg:{kind:'setEnabled'|'resetStats'}}`
- **统计对象**: `window.__m3u8AdFilter` = { playlistsChecked, playlistsCleaned, segmentsRemoved, suspects, lastUrl }
- **设计取舍**: 默认启用先装拦截（document_start 竞态窗口 <50ms，失误后果只是"多清洗一次"）；`maybePlaylist` 用 /m3u8/i 宽匹配 + isM3U8Text 内容校验兜底；responseType 为 arraybuffer/json 的 m3u8 请求静默跳过（不是 bug，播放器加载 m3u8 不会用这些类型）
- **依赖关系**:
  - 引入: window.__M3U8Engine（m3u8-engine.js + rules.js 必须先注入，顺序由 manifest 保证）
  - 被引用: manifest.json content_scripts（MAIN world）
- **最后修改**: 2026-10-04
- **修改原因**: v1.2.0 加开关/统计上报/resetStats；拦截逻辑抽成 install/uninstall 支持干净卸载

## 文件: src/bridge.js
- **路径**: C:\Users\32277\m3u8-ad-filter\src\bridge.js
- **作用**: ISOLATED world 桥。ISOLATED 独占 chrome.* API，MAIN 无法访问；两侧经 window.postMessage（专有字段 `__m3u8FilterMsg` 防冲突）中转。
- **关键逻辑**:
  - 初始化：sendMessage({type:'getEnabled'}) → background 按 sender.tab.url 解析 host 查开关 → postMessage 下发 MAIN
  - 下行：chrome.runtime.onMessage（setEnabled/resetStats）→ postMessage → MAIN
  - 上行：MAIN 的 stats postMessage → chrome.runtime.sendMessage({type:'stats'}) → background
- **依赖关系**:
  - 引入: chrome.runtime（扩展上下文）
  - 被引用: manifest.json content_scripts（ISOLATED world）
- **最后修改**: 2026-10-04
- **修改原因**: v1.2.0 新增（popup 开关功能的桥）

## 文件: src/background.js
- **路径**: C:\Users\32277\m3u8-ad-filter\src\background.js
- **作用**: MV3 service worker，hub 角色（无业务逻辑）：开关解析、统计聚合、popup 通道。
- **关键逻辑**:
  - `resolveEnabled(host)`: `siteOverrides[host] ?? defaultEnabled`（storage.local）
  - getEnabled：host 取 `sender.tab.url` 顶层域名（iframe 里的 bridge 不知道顶层站点，必须 background 解析——这是 host_permissions <all_urls> 的用途）
  - stats：按 (tabId, frameId) 暂存 MAIN 上报的累计值（覆盖式）；tab 关闭/导航时清理
  - popup:* 通道：getState（host+开关+各 frame 求和）/ setEnabled（写 storage + 下行全 frame）/ resetOverride（删站点覆盖）/ resetStats（清聚合 + 下行清零）
- **已知限制**: MV3 worker 休眠丢内存统计（可接受，popup 有提示）；storage 的 siteOverrides 记录用户显式意图（与默认相同的值也写入）
- **依赖关系**:
  - 引入: chrome.storage / chrome.runtime / chrome.tabs
  - 被引用: manifest.json background.service_worker
- **最后修改**: 2026-10-04
- **修改原因**: v1.2.0 新增
