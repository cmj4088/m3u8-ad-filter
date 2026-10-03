# demo/ 代码说明

## 文件: demo/run.js
- **路径**: C:\Users\32277\m3u8-ad-filter\demo\run.js
- **作用**: 回归测试主脚本（Node 零依赖，`node demo/run.js` 在项目根目录执行）。任何规则改动必须全绿才允许合入。样本缺失（开源仓库不含 samples/）时跳过样本用例只跑对抗用例，不崩溃。
- **断言集**:
  1. 输出首行必须是 #EXTM3U（v1.1.1 事故回归）
  2. ENDLIST 保留 ⇔ 原文有 ENDLIST（v1.1.0 事故回归）
  3. 广告子串零残留（cases.json 的 adSubstrings）
  4. 清洗与否 + 删除数/保留数与 cases.json 期望一致
  5. 无连续双 DIS；删过广告则输出含 DIS（接缝保留）
  6. 保留分片 EXTINF 配对且时长未改（只删不改；master 无 EXTINF 跳过）
  7. 幂等 f(f(x))===f(x)
  8. 对照样本零扰动（byte-identical，宁漏勿误锚）
  9. 安全器对抗用例：构造坏 rebuild（EXTM3U 非首行/丢 ENDLIST/序列错位/双 DIS/配对破坏/全删）断言回退原文 + sanitizerFallback 计数；放弃白名单（直播/BYTERANGE/master/非 m3u8）不清洗

## 文件: demo/cases.json
- **路径**: C:\Users\32277\m3u8-ad-filter\demo\cases.json
- **作用**: 50 个真实样本的期望值表（file 相对 demo/、label、expectCleaned、removedSegments、keptSegments、rule、adSubstrings）。
- **分组**: Tier1 命中组（暴风 A 9/18 片、量子 C 7/14/21 片）/ 规则 D 组（ffzy 5 片赌博块）/ 跨品类组（电影/综艺/日漫/美漫/港台/剧场版）/ 零扰动对照组（免费云 snm3u8 ×9 + 纯噪声 ffzy + 全部 master/index，28 个，byte-identical 锚）

## 目录: demo/samples/
- `jsyun-ep1.m3u8` / `gqyun-ep1.m3u8`: yhdmtv 首批样本（加速云/高清云 ep1）
- `raw-smp/`: 凡人修仙传四线路 ep1+ep3 样本（加速云/高清云/火箭云/免费云），含 index/master 与一个电影双插样本
- `raw-work/`: 25 线路/6 品类采样（命名 `品类-作品_线路_kind.m3u8`），由 demo/samples/raw-work-report.json（rootUrl/mediaUrl 映射）经 CDN 内容指纹比对重命名
- **注意**: `movie-敢死队4最终章_免费云_media.m3u8` 的 CDN 路径内容已轮换（与报告 0% 重合），命名存疑，仅作零扰动对照使用
- **最后修改**: 2026-10-04
- **修改原因**: v1.2.0 全量 corpus 落盘 + cases.json 扩充 + 对抗用例
