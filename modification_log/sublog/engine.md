# modification_log/sublog/engine.md —— 引擎/规则日志

> 新记录插顶部（越新行数越小）。

---

## 对应主函数的位置，包括链接和行数
- [src/m3u8-engine.js](C:/Users/32277/m3u8-ad-filter/src/m3u8-engine.js)
    - filterPlaylist: 208-234
    - rebuild: 118-164
    - sanitizeOutput: 177-205
- [src/rules.js](C:/Users/32277/m3u8-ad-filter/src/rules.js)
    - analyze: 48-216（规则 A/F/E/C/D/Tier2/suspect 依次排列）
    - hasFracDur: 47-57

## 对应在 basic_code_information_archive 的文档位置
- [src.md](C:/Users/32277/m3u8-ad-filter/basic_code_information_archive/src.md)
    - m3u8-engine.js 节全部
    - rules.js 节全部

---

## [2026-10-04 14:30] v1.2.0 S7 信号修正：文本小数位对比 → 帧率型非终止小数对比
- **需求**: 全量 corpus 跑批发现规则 D 在 ffzy 样本（hjy_mixed/hjy_ep3）删=0——S7 前提"正片 EXTINF ≤2 位小数"不成立
- **提示词**: （计划内实施，plan 已批准；调试中发现）
- **改动文件**: src/rules.js, demo/run.js, demo/cases.json
- **改动说明**:
  - 根因：ffzy 全列表 EXTINF 一律 %0.6f 格式化（"4.000000"/"3.120000"），文本小数位数无对比意义；调研阶段"正片 ≤2 位"的结论对实测样本不成立
  - 修正：新增 `hasFracDur`（d*1000 非整数 = 29.97fps 循环小数），S7 改为"块内有帧率小数时长且其余所有块均无"的数值级对比；规则 D 与 Tier 2 的 S7 同步替换
  - 实测效果：ffzy 广告块 4/5 帧率小数、全部正片块 0/89 与 0/223——完美区分；193-DIS 纯噪声综艺列表零扰动（othersOk 双保险）
  - 附带修复：重构时丢失 `var si` 声明导致 ReferenceError（demo/run.js 跑批暴露）
  - demo/run.js 断言 6 加媒体列表前置条件（master 无 EXTINF，variant 行不算分片）
  - cases.json 扩到 50 用例（22 清洗 + 28 零扰动对照）；新增断言 9 对抗用例（6 坏 rebuild + 4 白名单）

---

## [2026-10-04 13:00] v1.2.0 规则引擎通用化重构（parse/rules 管道 + Tier 裁决 + 安全器）
- **需求**: "完全通用"改造（用户批准的 plan）：从只识别加速云 adjump 的单文件 filter.js，重构为三层架构（engine/rules/拦截层），落地 25 线路/6 品类调研得出的 Tier1(A/C/D/E/F)+Tier2(S3/S6/S7/S8/S1/S4/B1) 规则管道
- **提示词**: （plan 批准："User has approved your plan. You can now start coding."）
- **改动文件**: src/m3u8-engine.js（新建）, src/rules.js（新建）, src/filter-main.js（重写）, manifest.json, demo/run.js, demo/cases.json, demo/samples/*
- **改动说明**:
  - m3u8-engine.js: parsePlaylist（不丢行只建模）/ rebuild（只删不改，接缝恰好一个 DIS）/ sanitizeOutput（v1.1.0~v1.1.3 历史事故固化为 6 条断言）/ 30% 全删放弃阀 / 放弃白名单（master、直播、BYTERANGE）
  - rules.js: Tier1（A 路径关键词 / C 编号三明治 anchor 走链 / D DIS 孤立短块+佐证 / E KEY 三明治 / F dummy 分片）+ Tier2 组合判（≥1.5 分且 ≥2 信号）+ 尾组 suspect 只记不删；B1 多数投票按业界证伪降级为纯佐证
  - filter-main.js: 只留拦截层，识别/重组全部委托 __M3U8Engine（Node 可测试复用的前提）
  - manifest.json: 版本 1.2.0、js 数组三文件注入
  - 全量验证：50 用例全绿（含 28 对照零扰动、幂等、对抗回退）

---

## [2026-10-03] v1.1.3 历史补录：dummy 分片/双包装防御
- **需求**: 修边界 case
- **改动文件**: filter.js
- **改动说明**: __adfilterDone 防重复改写；空响应防御。历史版本代码见 demo/scratch/filter-v1.1.3-backup.js

## [2026-10-03] v1.1.1 历史补录：EXTM3U 非首行事故
- **需求**: 修"所有视频 manifestParsingError"
- **根因**: 重组时把 #EXTM3U 当普通标签排到输出中间 → hls.js 解析全挂
- **改动说明**: 头标签白名单直出（EXTM3U 永远第一行）；此约束现固化为 sanitizer 断言 1

## [2026-10-03] v1.1.0 历史补录：ENDLIST 丢失事故
- **需求**: 修"视频播完卡住不走"（hls.js 当直播流永远等刷新）
- **根因**: 清洗重组时丢弃了 #EXT-X-ENDLIST
- **改动说明**: ENDLIST 白名单保留；现固化为 sanitizer 断言 2
