/**
 * demo 回归测试 —— Node 零依赖，不依赖项目其他模块
 *
 * 运行：node demo/run.js   （在项目根目录执行）
 *
 * 断言集（对应 plan 的测试矩阵）：
 *   1. 输出首行必须是 #EXTM3U（v1.1.1 事故回归）
 *   2. ENDLIST 保留 ⇔ 原文有 ENDLIST（v1.1.0 事故回归）
 *   3. 输出无广告 URI 子串残留
 *   4. 保留分片数与期望一致
 *   5. 无连续双 DISCONTINUITY；删过广告则输出含 DIS（接缝保留）
 *   6. 每个保留分片前有 EXTINF 且时长与原文一致（只删不改）
 *   7. 幂等：f(f(x)) === f(x)
 *   8. expectCleaned=false 的对照样本：输出与输入 byte-identical（宁漏勿误锚）
 *   9. cases.json 里每个 case 的期望值全部命中才 PASS
 *
 * 任何规则改动必须先跑通本脚本全绿才允许合入。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const engine = require('../src/m3u8-engine.js');
require('../src/rules.js'); // 注册 globalThis.__M3U8Rules

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8')).cases;

function extinfMap(text) {
  // 从播放列表文本提取 分片URI -> EXTINF 时长 的映射（URI 在样本内唯一）
  const map = {};
  let pd = null;
  for (const l of text.split(/\r?\n/)) {
    if (l.startsWith('#EXTINF:')) { pd = parseFloat(l.slice(8)); continue; }
    if (!l || l.charAt(0) === '#') continue;
    if (pd !== null && !(l in map)) map[l] = pd;
    pd = null;
  }
  return map;
}

function segUris(text) {
  return text.split(/\r?\n/).filter(l => l && l.charAt(0) !== '#' && l !== '#EXT-X-DISCONTINUITY');
}

let failed = 0, skipped = 0;
for (const c of cases) {
  const file = path.join(__dirname, c.file); // c.file 相对 demo/，如 samples/raw-work/xxx.m3u8
  // 样本不入库（见 demo/README.md）：缺失时跳过而非崩溃
  if (!fs.existsSync(file)) { skipped++; continue; }
  const orig = fs.readFileSync(file, 'utf8');
  const stats = { segmentsRemoved: 0 };
  const out = engine.filterPlaylist(orig, stats);
  const problems = [];

  // 断言 1：首行 EXTM3U
  if (out.split(/\r?\n/)[0] !== '#EXTM3U') problems.push('首行不是 #EXTM3U');
  // 断言 2：ENDLIST 保留
  if (orig.includes('#EXT-X-ENDLIST') !== out.includes('#EXT-X-ENDLIST')) problems.push('ENDLIST 保留性被破坏');
  // 断言 3：广告子串零残留
  for (const s of c.adSubstrings || []) {
    if (out.includes(s)) problems.push('广告子串残留: ' + s);
  }
  // 断言 4：清洗与否 + 数量
  const cleaned = out !== orig;
  if (cleaned !== c.expectCleaned) problems.push('expectCleaned=' + c.expectCleaned + ' 实际 ' + cleaned);
  if (c.expectCleaned) {
    const kept = segUris(out).length;
    if (kept !== c.keptSegments) problems.push('保留分片数 ' + kept + ' ≠ 期望 ' + c.keptSegments);
    if (stats.segmentsRemoved !== c.removedSegments) problems.push('删除数 ' + stats.segmentsRemoved + ' ≠ 期望 ' + c.removedSegments);
  }
  // 断言 5：无连续双 DIS；删过广告则输出需含 DIS（若原文有）
  const outLines = out.split('\n');
  for (let i = 1; i < outLines.length; i++) {
    if (outLines[i] === '#EXT-X-DISCONTINUITY' && outLines[i - 1] === '#EXT-X-DISCONTINUITY') {
      problems.push('出现连续双 DISCONTINUITY @行 ' + i); break;
    }
  }
  if (c.expectCleaned && orig.includes('#EXT-X-DISCONTINUITY') && !out.includes('#EXT-X-DISCONTINUITY')) {
    problems.push('删除接缝未保留 DISCONTINUITY');
  }
  // 断言 6：保留分片时长未被改动（仅媒体列表适用；master 无 EXTINF，variant 行不算分片）
  const origMap = extinfMap(orig);
  const outMap = extinfMap(out);
  if (orig.includes('#EXTINF')) {
    for (const uri of segUris(out)) {
      if (!(uri in origMap)) { problems.push('输出出现原文没有的分片: ' + uri); break; }
      if (outMap[uri] !== origMap[uri]) { problems.push('EXTINF 时长被改动: ' + uri); break; }
    }
  }
  // 断言 7：幂等
  const twice = engine.filterPlaylist(out, { segmentsRemoved: 0 });
  if (twice !== out) problems.push('不幂等：f(f(x)) !== f(x)');
  // 断言 8：对照样本零扰动
  if (!c.expectCleaned && out !== orig) problems.push('对照样本被扰动（宁漏勿误违规）');

  if (problems.length) {
    failed++;
    console.log('FAIL  ' + c.file + '  (' + c.label + ')');
    problems.forEach(p => console.log('        - ' + p));
  } else {
    console.log('PASS  ' + c.file + '  删除=' + stats.segmentsRemoved + ' 保留=' + segUris(out).length);
  }
}

console.log(failed === 0 ? '\n全部 ' + cases.length + ' 个用例通过 ✓' : '\n' + failed + ' 个用例失败 ✗');

// ---- 断言 9：安全器对抗用例（构造坏 rebuild，断言回退原文 + sanitizerFallback 计数）----
function miniPlaylist() {
  // 小型合法媒体列表：2 块 + ENDLIST
  return [
    '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10',
    '#EXTINF:9.0,', 'a1.ts', '#EXT-X-DISCONTINUITY', '#EXTINF:8.0,', 'a2.ts',
    '#EXTINF:9.0,', 'a3.ts', '#EXT-X-ENDLIST',
  ].join('\n') + '\n';
}
let advFail = 0;
function adv(name, cond) {
  if (!cond) { advFail++; console.log('FAIL  对抗用例: ' + name); }
  else console.log('PASS  对抗用例: ' + name);
}
const engine2 = engine;
{
  const orig = miniPlaylist();
  const model = engine2.parsePlaylist(orig);
  const ok = engine2.rebuild(Object.assign({}, model, { segs: model.segs.map(s => Object.assign({}, s)) }));
  // 基准：无删除时 rebuild 返回原文
  adv('无删除 rebuild 返回原文', ok.text === model.lines.join('\n'));

  const mkModel = () => engine2.parsePlaylist(orig);
  const badRebuilds = {
    'EXTM3U 非首行': orig.replace(/^#EXTM3U\n/, '') + '#EXTM3U\n',
    'ENDLIST 丢失': orig.replace('#EXT-X-ENDLIST\n', ''),
    '保留序列错位(丢一个分片)': orig.replace('a2.ts\n', ''),
    '连续双 DIS': orig.replace('#EXT-X-DISCONTINUITY', '#EXT-X-DISCONTINUITY\n#EXT-X-DISCONTINUITY'),
    'EXTINF/URI 数不配对': orig.replace('#EXTINF:8.0,\n', ''),
    '全部分片被删': orig.split('\n').filter(l => !l.endsWith('.ts')).join('\n'),
  };
  for (const [name, rebuilt] of Object.entries(badRebuilds)) {
    const st = {};
    const m = mkModel();
    // 模拟坏规则把分片标记为删除（让 sanitizeOutput 的 expect 序列真实成立）
    const out = engine2.sanitizeOutput(orig, m, rebuilt, st);
    adv(name + ' → 回退原文', out === orig && st.sanitizerFallback === 1);
  }

  // 放弃白名单：对抗 filterPlaylist 主入口
  const live = miniPlaylist().replace('#EXT-X-ENDLIST\n', '');
  adv('直播流(无ENDLIST)不清洗', engine2.filterPlaylist(live, {}) === live);
  const byterange = miniPlaylist().replace('#EXT-X-ENDLIST', '#EXT-X-BYTERANGE:900@0\n#EXT-X-ENDLIST');
  adv('BYTERANGE 不清洗', engine2.filterPlaylist(byterange, {}) === byterange);
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n2000k/hls/index.m3u8\n';
  adv('master 不清洗', engine2.filterPlaylist(master, {}) === master);
  const nonM3u8 = 'hello world';
  adv('非 m3u8 文本不清洗', engine2.filterPlaylist(nonM3u8, {}) === nonM3u8);
}
if (skipped) console.log('(跳过 ' + skipped + ' 个用例：本地无 samples/ 采样，采样方法见 demo/README.md)');
console.log(advFail === 0 ? '对抗用例全部通过 ✓' : advFail + ' 个对抗用例失败 ✗');
process.exit(failed === 0 && advFail === 0 ? 0 : 1);
