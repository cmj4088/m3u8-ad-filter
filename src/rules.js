/**
 * 广告识别规则 —— 纯函数模块（无 window 依赖，Node 可直接 require）
 *
 * 裁决总纲（宁漏勿误，见 plan §1）：
 *   Tier 1（sure，命中即删整块/区段）：
 *     A  路径强关键词（adjump 等，限定路径段+边界）
 *     C  编号三明治（前块尾 N → 本块首≠N+1 → 后块首=N+1，时长<90s）
 *     D  DIS 孤立短块 + 佐证（hash 命名形态，双条件同时满足）
 *     E  KEY 三明治（METHOD=NONE 区间夹在两个真 KEY 之间）
 *     F  dummy 分片（EXTINF<0.1s 且 URI 与相邻分片重复）
 *   Tier 2（组合判）：块总分 ≥ 1.5 且信号 ≥ 2 条才删；佐证信号：
 *     S3 时长均匀 / S6 重复 URI / S7 帧率小数时长对比 / S8 目录前缀众数偏离 /
 *     S1 host 偏离 / S4 绝对相对性偏离 / B1 命名形状少数派（纯佐证，业界证伪单独使用）
 *   suspect（只记不删）：尾组贴片（末 DIS 后的短组，预告/片尾同构不删）
 *
 * 明确不实现（业界实测证伪，防回潮）：
 *   纯时长打分、文件名长度多数投票独立删、duration<1s 单片删、密集 DIS 短块直接删。
 *
 * 导出（UMD）：root.__M3U8Rules = { analyze }
 */
(function (root) {
  'use strict';

  var AD_PATH_RE = /adjump|\/ads?(\/|_|\?|$)|\/adv(\/|_|\?|$)|\/advert(ise|isement)?s?(\/|_|\?|$)|adcreative|adbridge|adsegment|adplayer|popunder|\/adzone/i;
  var AD_BLOCK_MAX_DURATION = 90;   // 与 engine 常量一致
  var D_MAX_SEGS = 10;              // 规则 D：块内片数上限
  var D_OTHER_MIN_DURATION = 30;    // 规则 D：同列表其余块时长下限
  var T2_THRESHOLD = 1.5;           // Tier 2 总分阈值
  var T2_MIN_SIGNALS = 2;           // Tier 2 最少信号数

  // 文件名末尾数字（规则 C）；解析不了返回 null
  function tailIndexOf(uri) {
    var m = /(\d+)\.[^.]*$/.exec(uri.split('?')[0].split('/').pop());
    return m ? parseInt(m[1], 10) : null;
  }

  function mark(segs, i, rule, log) {
    if (segs[i].remove) return;
    segs[i].remove = true;
    segs[i].rule = rule;
    log.push({ rule: rule, seg: i });
  }
  function markBlock(blk, segs, rule, log) {
    for (var s = 0; s < blk.segIdxs.length; s++) mark(segs, blk.segIdxs[s], rule, log);
  }

  // 帧率型非终止小数时长：d*1000 非整数（如 4.866667 = 29.97fps 转码产物，
  // 正片转码时长在 3 位小数内可终止）。
  // 注意：ffzy 系 EXTINF 文本一律 %0.6f 格式化（"4.000000"），文本小数位数无对比意义，
  // 必须看数值本身（调研阶段"正片 ≤2 位小数"的结论对实测样本不成立）。
  function hasFracDur(segs, idxs) {
    for (var i = 0; i < idxs.length; i++) {
      var d = segs[idxs[i]].dur;
      if (d > 0 && Math.abs(d * 1000 - Math.round(d * 1000)) > 1e-6) return true;
    }
    return false;
  }

  // ---------- 主分析入口：直接修改 model.segs[].remove ----------
  function analyze(model, stats) {
    var segs = model.segs, blocks = model.blocks;
    var log = [];
    var counts = { A: 0, C: 0, D: 0, E: 0, F: 0, T2: 0 };

    // ---- 全局统计（佐证信号用）----
    var dirCount = {}, hostCount = {}, patternCount = {}, uriCount = {};
    var otherMaxDec = 0; // 各块内最大 EXTINF 小数位（规则 D/S7 交叉对照时逐块重算）
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      dirCount[s.dir] = (dirCount[s.dir] || 0) + 1;
      if (s.host) hostCount[s.host] = (hostCount[s.host] || 0) + 1;
      patternCount[s.pattern] = (patternCount[s.pattern] || 0) + 1;
      uriCount[s.uri] = (uriCount[s.uri] || 0) + 1;
    }
    var majorityDir = modeOf(dirCount), majorityHost = modeOf(hostCount), majorityPattern = modeOf(patternCount);
    // 相对/绝对多数
    var absN = 0;
    for (i = 0; i < segs.length; i++) if (segs[i].host) absN++;
    var majorityAbs = absN > segs.length / 2;

    // ---- 规则 A：路径强关键词（Tier 1，逐分片）----
    for (i = 0; i < segs.length; i++) {
      if (AD_PATH_RE.test(segs[i].uri.split('?')[0])) mark(segs, i, 'A', log);
    }

    // ---- 规则 F：dummy 分片（Tier 1，逐分片）----
    for (i = 0; i < segs.length; i++) {
      if (segs[i].dur > 0 && segs[i].dur < 0.1) {
        var prev = segs[i - 1], next = segs[i + 1];
        if ((prev && prev.uri === segs[i].uri) || (next && next.uri === segs[i].uri)) mark(segs, i, 'F', log);
      }
    }

    // ---- 规则 E：KEY 三明治（Tier 1，连续区段）----
    // METHOD=NONE 区段夹在两个"带 URI 的 KEY"区段之间 → 标准 SSAI 广告插入
    if (model.hasRealKey) {
      for (i = 0; i < segs.length; i++) {
        if (!segs[i].keyNone) continue;
        var j = i;
        while (j + 1 < segs.length && segs[j + 1].keyNone) j++;
        // 三明治闭合：前一个分片有真 KEY 且后一个分片有真 KEY
        if (i > 0 && !segs[i - 1].keyNone && segs[i - 1].keyUri &&
            j + 1 < segs.length && !segs[j + 1].keyNone && segs[j + 1].keyUri) {
          for (var k = i; k <= j; k++) mark(segs, k, 'E', log);
        }
        i = j;
      }
    }

    // ---- 规则 C：编号三明治（Tier 1，DIS 块间）----
    // 正片编号严格 +1；广告块首尾必然相对前后正片跳变，且后块恢复衔接。
    // 只对"文件名以数字结尾"的块生效；anchor 断链后本列表不再触发（连锁误杀保护）。
    var firstIdx = [], lastIdx = [];
    for (var b = 0; b < blocks.length; b++) {
      var bl = blocks[b];
      firstIdx.push(bl.segIdxs.length ? tailIndexOf(segs[bl.segIdxs[0]].uri) : null);
      lastIdx.push(bl.segIdxs.length ? tailIndexOf(segs[bl.segIdxs[bl.segIdxs.length - 1]].uri) : null);
    }
    var anchorLast = lastIdx.length ? lastIdx[0] : null;
    for (b = 1; b < blocks.length; b++) {
      var fi = firstIdx[b], la = lastIdx[b];
      if (fi === null || la === null) { anchorLast = null; continue; }
      if (anchorLast !== null && fi === anchorLast + 1) {
        anchorLast = la; // 编号衔接，正片延续
      } else if (anchorLast !== null && b + 1 < blocks.length &&
                 firstIdx[b + 1] !== null && firstIdx[b + 1] === anchorLast + 1 &&
                 blocks[b].duration > 0 && blocks[b].duration < AD_BLOCK_MAX_DURATION) {
        markBlock(blocks[b], segs, 'C', log);
        b++; // 后块已确认为正片，直接作为新 anchor（保守：本列表此后不再触发 C 删除）
        anchorLast = (b < blocks.length && lastIdx[b] !== null) ? lastIdx[b] : null;
      } else {
        anchorLast = la; // 无法判定，保守视为正片
      }
    }

    // ---- 规则 D：DIS 孤立短块 + 佐证（Tier 1，双条件）----
    // 针对非凡/ffzy 系（32 位 hash 命名，与正片同 host 同目录）：块被首尾 DIS 包裹、
    // ≤10 片 <90s、同列表其余块均 ≥30s，且 S7/S6/S3 至少一条佐证，才删。
    for (b = 0; b < blocks.length; b++) {
      var db = blocks[b];
      if (db.segIdxs.length === 0 || segs[db.segIdxs[0]].remove) continue;
      var n = db.segIdxs.length;
      var isIsolated = b > 0 && b < blocks.length - 1; // 首尾均有 DIS（分块即意味着）
      if (!isIsolated || n > D_MAX_SEGS || db.duration <= 0 || db.duration >= AD_BLOCK_MAX_DURATION) continue;
      var othersOk = true;
      for (var ob = 0; ob < blocks.length; ob++) {
        if (ob === b || blocks[ob].segIdxs.length === 0) continue;
        if (blocks[ob].duration < D_OTHER_MIN_DURATION) { othersOk = false; break; }
      }
      if (!othersOk) continue;
      // 佐证：S7 帧率小数对比 / S6 重复 URI / S3 时长均匀
      // S7：块内存在帧率型小数时长，且其余所有块均无（数值级对比，抗 %0.6f 格式化）
      var hasS7 = hasFracDur(segs, db.segIdxs);
      if (hasS7) {
        for (var ob2 = 0; ob2 < blocks.length; ob2++) {
          if (ob2 === b || blocks[ob2].segIdxs.length === 0) continue;
          if (hasFracDur(segs, blocks[ob2].segIdxs)) { hasS7 = false; break; }
        }
      }
      var hasS6 = false;
      var si;
      for (si = 0; si < n; si++) if (uriCount[segs[db.segIdxs[si]].uri] >= 2) { hasS6 = true; break; }
      var uniq = {};
      for (si = 0; si < n; si++) uniq[Math.round(segs[db.segIdxs[si]].dur * 1000)] = 1;
      var uniqN = 0; for (var u in uniq) uniqN++;
      var hasS3 = n >= 3 && uniqN <= Math.max(1, Math.floor(n / 3));
      if (hasS7 || hasS6 || hasS3) markBlock(db, segs, 'D', log);
    }

    // ---- Tier 2：组合判（块级，总分 ≥1.5 且信号 ≥2）----
    for (b = 0; b < blocks.length; b++) {
      var tb = blocks[b];
      if (tb.segIdxs.length === 0 || segs[tb.segIdxs[0]].remove) continue;
      var tn = tb.segIdxs.length;
      if (tb.duration <= 0 || tb.duration >= AD_BLOCK_MAX_DURATION) continue;
      var score = 0, cnt = 0, sig = [];
      var tUniq = {}, tDirAllDiff = true, tHostDiff = true, tAbsAll = true;
      var tRepeat = false;
      for (si = 0; si < tn; si++) {
        var ts = segs[tb.segIdxs[si]];
        tUniq[Math.round(ts.dur * 1000)] = 1;
        if (ts.dir === majorityDir) tDirAllDiff = false;
        if (!ts.host || ts.host === majorityHost) tHostDiff = false;
        if (!ts.host) tAbsAll = false;
        if (uriCount[ts.uri] >= 2) tRepeat = true;
      }
      var tUniqN = 0; for (var v in tUniq) tUniqN++;
      // S3 时长均匀
      if (tn >= 3 && tUniqN <= Math.max(1, Math.floor(tn / 3))) { score += 0.75; cnt++; sig.push('S3'); }
      // S6 重复 URI
      if (tRepeat) { score += 1.0; cnt++; sig.push('S6'); }
      // S7 帧率小数对比：块内有帧率型非终止小数时长，且其余所有块均无
      if (hasFracDur(segs, tb.segIdxs)) {
        var oFrac = false;
        for (var ob3 = 0; ob3 < blocks.length; ob3++) {
          if (ob3 === b || blocks[ob3].segIdxs.length === 0) continue;
          if (hasFracDur(segs, blocks[ob3].segIdxs)) { oFrac = true; break; }
        }
        if (!oFrac) { score += 0.75; cnt++; sig.push('S7'); }
      }
      // S8 目录前缀众数偏离
      if (tDirAllDiff && majorityDir) { score += 1.0; cnt++; sig.push('S8'); }
      // S1 host 偏离
      if (tHostDiff && majorityHost) { score += 1.0; cnt++; sig.push('S1'); }
      // S4 绝对/相对性偏离
      if (tAbsAll !== majorityAbs) { score += 0.5; cnt++; sig.push('S4'); }
      // B1 命名形状少数派（纯佐证）
      if (segs[tb.segIdxs[0]].pattern !== majorityPattern && tn <= patternCount[majorityPattern] * 0.3) { score += 0.5; cnt++; sig.push('B1'); }
      if (score >= T2_THRESHOLD && cnt >= T2_MIN_SIGNALS) {
        markBlock(tb, segs, 'T2:' + sig.join('+'), log);
      }
    }

    // ---- suspect：尾组贴片（只记不删）----
    // 末个 DIS 之后、ENDLIST 之前的短组可能是片尾贴片，也可能是预告/彩蛋 → 不删
    if (blocks.length > 1 && stats) {
      var tail = blocks[blocks.length - 1];
      var modeDur = modeDurOf(blocks);
      if (tail.duration > 0 && tail.duration <= 20 && modeDur > 0 && tail.duration < modeDur / 3) {
        stats.suspects = (stats.suspects || 0) + tail.segIdxs.length;
      }
    }

    if (stats) {
      for (var li = 0; li < log.length; li++) {
        var rule = log[li].rule.split(':')[0];
        counts[rule] = (counts[rule] || 0) + 1;
      }
      stats.removedByRule = counts;
    }
    return log;
  }

  function modeOf(counter) {
    var best = null, bestN = 0;
    for (var k in counter) if (counter[k] > bestN) { bestN = counter[k]; best = k; }
    return best;
  }
  // 块时长的众数（尾组 suspect 判断用）
  function modeDurOf(blocks) {
    var c = {}, best = 0, bestN = 0;
    for (var i = 0; i < blocks.length; i++) {
      var d = Math.round(blocks[i].duration);
      c[d] = (c[d] || 0) + 1;
      if (c[d] > bestN) { bestN = c[d]; best = d; }
    }
    return best;
  }

  var api = { analyze: analyze, AD_PATH_RE: AD_PATH_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__M3U8Rules = api;
})(typeof window !== 'undefined' ? window : globalThis);
