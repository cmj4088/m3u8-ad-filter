# demo/ 回归测试

## 运行

```bash
# 在项目根目录执行
node demo/run.js
```

Node 零依赖，不需要安装任何包。

> **样本不入库**：`samples/` 内的播放列表采样含具体站点的 CDN 地址，不随仓库公开
> （已加入 `.gitignore`）。没有采样时 run.js 会跳过样本用例，仅跑安全器对抗用例（这些不依赖样本，全部仍应通过）。
>
> 自行采样：打开任意影视站的播放页，F12 Network 里筛 `m3u8`，把媒体列表
> （含 `#EXTINF` 的那个）另存进 `samples/`，并在 `cases.json` 里登记期望值
> （`expectCleaned` / `removedSegments` / `keptSegments` / `rule`）。
> cases.json 里保留了 50 条用例的完整期望值结构，可作为登记格式参考。

## 内容

- **50 个真实样本用例**（`cases.json` + `samples/`）：
  - Tier1 命中组：加速云（规则 A，9/18 片）、高清云（规则 C，7/14/21 片，含 159-DIS 密集噪声列表）
  - 规则 D 组：火箭云（非凡系）5 片哈希命名赌博广告块（已抽帧确认）
  - 跨品类组：电影 / 综艺 / 日漫 / 美漫 / 港台 / 剧场版（广告形态由资源站决定，与品类无关）
  - 零扰动对照组（28 个）：免费云 snm3u8、纯噪声 ffzy、全部 master/index —— **输出必须 byte-identical**（宁漏勿误回归锚）
- **每样本 9 条断言**：首行 EXTM3U / ENDLIST 保留 / 广告子串零残留 / 数量符合期望 / 接缝恰好一个 DIS / EXTINF 只删不改 / 幂等 / 对照零扰动 / 安全器对抗

## 合入门槛

任何规则或引擎改动必须 `node demo/run.js` 全绿才允许合入；
新采样的真实播放列表直接追加进 `samples/` 并在 `cases.json` 登记期望值。

## 样本来源与命名（本地开发参考）

- `samples/jsyun-ep1.m3u8` 等：yhdmtv.cc 首批验证样本
- `samples/raw-smp/`：凡人修仙传四线路 ep1/ep3（命名 `凡人修仙传_线路_集数.m3u8`）
- `samples/raw-work/`：6 品类采样（命名 `品类-作品_线路_kind.m3u8`），
  由 `raw-work-report.json` 的 rootUrl/mediaUrl 经 CDN 内容指纹比对重命名
- `movie-敢死队4最终章_免费云_media.m3u8` 的 CDN 路径内容已轮换（与报告 0% 重合），
  命名存疑，仅作零扰动对照
- `scratch/`：历史调试脚本归档（已废弃，仅留档；`dxfbk-player-page.html-m3u8.txt` 是播放器页 HTML 而非 m3u8）
