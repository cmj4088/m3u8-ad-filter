/**
 * M3U8 解析/清洗引擎 —— 纯函数模块（无 window 依赖，Node 可直接 require）
 *
 * 三段式架构（识别规则本身在 rules.js / __M3U8Rules）：
 *   1. parsePlaylist  解析：不丢行、只建模（分片/块/KEY 状态/时长）
 *   2. rules.analyze  规则管道：按 plan 的 Tier 1/Tier 2 裁决，标记待删分片
 *   3. rebuild        重组：只删不改，吸收被删块两侧 DIS，接缝保留一个 DIS
 *   4. sanitize       安全器：历史事故（v1.1.0~v1.1.3）固化为断言，任一失败返回原文
 *
 * 对外主入口：filterPlaylist(text, stats) -> string
 * stats 会被累加：segmentsRemoved / sanitizerFallback / suspects /
 *                removedByRule {A,C,D,E,F,T2}
 *
 * 宁漏勿误三道闸：
 *   a. 放弃白名单：直播（无 ENDLIST）/ BYTERANGE / master → 原文返回
 *   b. 30% 全删放弃阀：疑似广告占比过高 → 整单放弃
 *   c. 安全器断言：重组结果不合法 → 原文返回
 */
(function (root) {
  'use strict';

  var AD_BLOCK_MAX_DURATION = 90;   // 广告块时长上限（秒）
  var ABANDON_RATIO = 0.3;          // 疑似广告占比超过此值 → 整单放弃

  function isM3U8Text(text) {
    return typeof text === 'string' && text.indexOf('#EXTM3U') !== -1;
  }

  // EXTINF 小数位数（如 "4.866667" → 6）——规则 S7 用
  function decimalsOf(extinfLine) {
    var v = extinfLine.slice(8).split(',')[0];
    var i = v.indexOf('.');
    return i === -1 ? 0 : (v.length - i - 1);
  }

  function hostOf(uri) {
    var m = /^https?:\/\/([^\/]+)/i.exec(uri);
    return m ? m[1].toLowerCase() : null;
  }

  // URI 的目录前缀（去掉文件名）——规则 S8 用
  function dirOf(uri) {
    var s = uri.split('?')[0];
    var i = s.lastIndexOf('/');
    return i === -1 ? '' : s.slice(0, i + 1);
  }

  function baseOf(uri) {
    return uri.split('?')[0].split('/').pop();
  }

  // 文件名命名指纹：数字替换成 #，取路径最后两段
  function digitPatternOf(uri) {
    var path = uri.replace(/^https?:\/\/[^\/]+/i, '');
    var parts = path.split('/');
    return parts.slice(-2).join('/').replace(/\d+/g, '#');
  }

  // ---------- 1. 解析：不丢行，只建模 ----------
  function parsePlaylist(text) {
    var lines = text.split(/\r?\n/);
    var model = {
      lines: lines,
      segs: [],            // {uri,dur,dec,dir,host,base,pattern,keyNone,keyUri,lineIdx,remove,rule}
      segIdxOfLine: new Array(lines.length).fill(-1),
      blocks: [],          // {segIdxs, duration, firstLine, lastLine, idx}
      hasEndList: false,
      hasExtInf: false,
      hasByterange: false,
      hasRealKey: false    // 出现过带 URI 的 #EXT-X-KEY（规则 E 的前提）
    };
    var pendingDur = 0, pendingDec = 0, pendingKeyNone = false, pendingKeyUri = null;
    var curBlock = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l === '') continue;
      if (l === '#EXT-X-DISCONTINUITY') { curBlock = null; continue; }
      if (l.indexOf('#EXT-X-ENDLIST') === 0) { model.hasEndList = true; continue; }
      if (l.indexOf('#EXT-X-BYTERANGE') === 0) { model.hasByterange = true; }
      if (l.indexOf('#EXTINF:') === 0) {
        model.hasExtInf = true;
        pendingDur = parseFloat(l.slice(8));
        pendingDec = decimalsOf(l);
        continue;
      }
      if (l.indexOf('#EXT-X-KEY:') === 0) {
        if (/METHOD=NONE/i.test(l)) { pendingKeyNone = true; pendingKeyUri = null; }
        else {
          pendingKeyNone = false;
          var um = /URI="([^"]+)"/.exec(l);
          pendingKeyUri = um ? um[1] : 'unknown';
          model.hasRealKey = true;
        }
        continue;
      }
      if (l.charAt(0) === '#') continue;
      // 分片行
      var seg = {
        uri: l, dur: pendingDur, dec: pendingDec,
        dir: dirOf(l), host: hostOf(l), base: baseOf(l), pattern: digitPatternOf(l),
        keyNone: pendingKeyNone, keyUri: pendingKeyUri,
        lineIdx: i, remove: false, rule: null
      };
      model.segs.push(seg);
      model.segIdxOfLine[i] = model.segs.length - 1;
      if (!curBlock) { curBlock = { segIdxs: [], duration: 0, firstLine: i, lastLine: i, idx: model.blocks.length }; model.blocks.push(curBlock); }
      curBlock.segIdxs.push(model.segs.length - 1);
      curBlock.duration += pendingDur;
      curBlock.lastLine = i;
      pendingDur = 0; pendingDec = 0;
    }
    return model;
  }

  // ---------- 3. 重组：只删不改 ----------
  // 语义与 v1.1.3 一致：被删块两侧 DIS 各吸收一个，删除接缝保留恰好一个 DIS；
  // 文件头标签直出；EXTINF/KEY/MAP 等标签跟随下一个保留分片。
  function rebuild(model) {
    var lines = model.lines, segIdxOfLine = model.segIdxOfLine, segs = model.segs;
    var out = [];
    var pendingTags = [];
    var pendingDisc = 0;
    var removedSinceEmit = false;
    var removedCount = 0;

    for (var n = 0; n < lines.length; n++) {
      var ln = lines[n];
      if (ln === '') continue;
      if (ln === '#EXT-X-DISCONTINUITY') { pendingDisc++; continue; }
      if (ln.charAt(0) === '#') {
        // #EXTM3U 必须第一行、ENDLIST 必须保留（v1.1.1 / v1.1.0 事故）
        if (/^#(EXTM3U$|EXT-X-(VERSION|TARGETDURATION|MEDIA-SEQUENCE|PLAYLIST-TYPE|START|ENDLIST|DISCONTINUITY-SEQUENCE)(:|$))/.test(ln)) {
          out.push(ln);
        } else {
          pendingTags.push(ln);
        }
        continue;
      }
      var fi = segIdxOfLine[n];
      if (fi >= 0 && segs[fi].remove) {
        // 广告分片：丢弃其标签，吸收左缘一个 DIS
        pendingTags = [];
        if (pendingDisc > 0) pendingDisc--;
        removedSinceEmit = true;
        removedCount++;
        continue;
      }
      if (removedSinceEmit) {
        // 接缝：保留恰好一个 DIS（时间戳可能不连续，hls.js 需要重建管线）
        out.push('#EXT-X-DISCONTINUITY');
      } else {
        for (var pd = 0; pd < pendingDisc; pd++) out.push('#EXT-X-DISCONTINUITY');
      }
      pendingDisc = 0;
      for (var t = 0; t < pendingTags.length; t++) out.push(pendingTags[t]);
      pendingTags = [];
      removedSinceEmit = false;
      out.push(ln);
    }
    for (var r = 0; r < pendingTags.length; r++) out.push(pendingTags[r]);
    if (removedCount === 0) return { text: text0(model), removed: 0 };
    return { text: out.join('\n') + '\n', removed: removedCount };
  }
  function text0(model) { return model.lines.join('\n'); }

  // ---------- 4. 安全器：历史事故 → 断言，任一失败返回原文 ----------
  function segUrisOf(text) {
    var arr = [];
    var ls = text.split(/\r?\n/);
    for (var i = 0; i < ls.length; i++) {
      var l = ls[i];
      if (l && l.charAt(0) !== '#' && l !== '#EXT-X-DISCONTINUITY') arr.push(l);
    }
    return arr;
  }

  function sanitizeOutput(originalText, model, rebuilt, stats) {
    var fails = [];
    // 1. 首行必须是 #EXTM3U（v1.1.1 事故）
    if (rebuilt.split(/\r?\n/)[0] !== '#EXTM3U') fails.push('EXTM3U not first line');
    // 2. ENDLIST 保留性（v1.1.0 事故）
    if (model.hasEndList !== (rebuilt.indexOf('#EXT-X-ENDLIST') !== -1)) fails.push('ENDLIST parity broken');
    // 3. "只删不改"：保留分片 URI 序列 === 原文未删除分片 URI 序列
    var expect = [], i;
    for (i = 0; i < model.segs.length; i++) if (!model.segs[i].remove) expect.push(model.segs[i].uri);
    var actual = segUrisOf(rebuilt);
    if (expect.length !== actual.length) fails.push('kept count mismatch');
    else for (i = 0; i < expect.length; i++) if (expect[i] !== actual[i]) { fails.push('kept sequence mismatch @' + i); break; }
    // 4. EXTINF 行数 === URI 行数（标签-分片配对）
    var extinfN = 0;
    var rl = rebuilt.split(/\r?\n/);
    for (i = 0; i < rl.length; i++) if (rl[i].indexOf('#EXTINF:') === 0) extinfN++;
    if (extinfN !== actual.length) fails.push('EXTINF/URI pairing broken');
    // 5. 保留分片数 > 0
    if (actual.length === 0) fails.push('all segments removed');
    // 6. 无连续双 DIS（接缝恰好一个的必要条件）
    for (i = 1; i < rl.length; i++) {
      if (rl[i] === '#EXT-X-DISCONTINUITY' && rl[i - 1] === '#EXT-X-DISCONTINUITY') { fails.push('consecutive DIS @' + i); break; }
    }
    if (fails.length) {
      if (stats) stats.sanitizerFallback = (stats.sanitizerFallback || 0) + 1;
      return originalText;
    }
    return rebuilt;
  }

  // ---------- 主入口 ----------
  function filterPlaylist(text, stats) {
    if (!isM3U8Text(text)) return text;
    var rules = root.__M3U8Rules;
    if (!rules || !rules.analyze) return text;

    var model = parsePlaylist(text);
    // master / 放弃白名单：不清洗
    if (!model.hasExtInf) return text;
    if (!model.hasEndList) return text;              // 直播流
    if (model.hasByterange) return text;             // BYTERANGE 特征失真

    rules.analyze(model, stats);                     // Tier 1 / Tier 2 标记（含 suspect 统计）

    var removed = 0;
    for (var i = 0; i < model.segs.length; i++) if (model.segs[i].remove) removed++;
    // 30% 全删放弃阀：疑似广告占比过高，宁可整单不洗
    if (removed > model.segs.length * ABANDON_RATIO) {
      if (stats) stats.abandoned = (stats.abandoned || 0) + 1;
      return text;
    }
    if (removed === 0) return text;

    var rb = rebuild(model);
    if (rb.removed === 0) return text;
    if (stats) stats.segmentsRemoved = (stats.segmentsRemoved || 0) + rb.removed;
    return sanitizeOutput(text, model, rb.text, stats);
  }

  var api = {
    filterPlaylist: filterPlaylist,
    parsePlaylist: parsePlaylist,
    rebuild: rebuild,
    sanitizeOutput: sanitizeOutput,
    isM3U8Text: isM3U8Text,
    segUrisOf: segUrisOf,
    AD_BLOCK_MAX_DURATION: AD_BLOCK_MAX_DURATION,
    ABANDON_RATIO: ABANDON_RATIO
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__M3U8Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
