# modification_log 总览

| 模块 | 日志文件 | 改动次数 | 最新时间 |
|---|---|---|---|
| 引擎/规则 | [sublog/engine.md](sublog/engine.md) | 5（含 2 条历史补录） | 2026-10-04 14:30 |
| popup/开关 | [sublog/popup.md](sublog/popup.md) | 2 | 2026-10-04 16:40 |

## 版本历史

- **v1.1.0（2026-10-04）**: 播放器清洗浮层——清洗发生时播放器右上角半透明小 Toast + 点击展开最近 10 条记录（内存存储）；popup 全局开关（默认显示）；Shadow DOM 隔离；真机验证通过（Tabbit：规则 D 触发、展开列表、开关双向）

- **v1.0.0 开源版（2026-10-04）**: 以 GPL-3.0 开源到 GitHub（cmj4088/m3u8-ad-filter）。内部版本号 v1.2.0 作为开源 1.0 发布；demo/samples 与 demo/scratch 不入库（.gitignore），run.js 样本缺失时优雅跳过；新增 LICENSE、.gitignore
- **v1.2.0（2026-10-04）**: 规则引擎通用化重构（engine/rules/拦截三层，Tier1 A/C/D/E/F + Tier2 组合判 + 安全器 + 30% 阀）+ popup 开关统计面板（bridge/background/popup）+ 50 用例 corpus 回归 + 真机验证（Tabbit 注入：规则 D 删 5 片、开关双向、跨接缝连续）
- **v1.1.3（2026-10-03）**: 边界防御（归档 demo/scratch/filter-v1.1.3-backup.js）
- **v1.1.1（2026-10-03）**: 修 EXTM3U 非首行（manifestParsingError 全挂）
- **v1.1.0（2026-10-03）**: 修 ENDLIST 丢失（直播化假死）
- **v1.0.x（2026-10-03）**: 初版（加速云 adjump 规则，XHR+fetch 拦截）
