// 书架的零碎工具: 卡片标签折叠 / 网格几何 / 滚动辅助 / 拖拽收尾 / 筛选角标 / 封面取色
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 3 批)。
// 这 9 个函数共同点: **除了一份只读缓存(Color_CACHE)什么都不依赖** —— 是最没有
// 争议的一批。它们散落在 core 各处, 但语义上都属于"书架渲染要用的小工具"。
//
// 全部 export: core 里有些是当值传给 initShelfRender 的({ thumbOf: thumbOf }),
// 不是被调用, 少导一个就是运行时 undefined。

import { pageList } from '../shared/chapter.js';
import { hint } from '../shared/ui.js';
import { S, elGrid } from '../app/state.js';
import { manualOrder, saveManualOrder } from '../shared/storage.js';

export function keepScroll(fn) {
  var se = document.scrollingElement || document.body;
  var y0 = se ? se.scrollTop : 0, g0 = elGrid ? elGrid.scrollTop : 0;
  try { fn(); } catch (e) {}
  var restore = function () {
    try { if (se) se.scrollTop = y0; } catch (e) {}
    try { if (elGrid) elGrid.scrollTop = g0; } catch (e) {}
  };
  restore();
  requestAnimationFrame(restore);
  setTimeout(restore, 60);
  setTimeout(restore, 200);
}
export function clampTags(tw) {
  if (!tw || tw.dataset.clamped) return;
  var kids = Array.prototype.slice.call(tw.children);
  if (!kids.length) return;
  var top0 = kids[0].offsetTop;
  var rowH = kids[0].offsetHeight + 4;
  for (var i = 1; i < kids.length; i++) {
    if (kids[i].offsetTop > top0) { rowH = kids[i].offsetTop - top0; break; }
  }
  var limit = top0 + rowH * 2;
  var hidden = [];
  for (var j = 0; j < kids.length; j++) {
    if (kids[j].offsetTop > limit) hidden.push(kids[j]);
  }
  tw.dataset.clamped = "1";
  if (!hidden.length) return;
  hidden.forEach(function (k) { k.style.display = "none"; });
  var more = document.createElement("span");
  more.className = "ctag moretag";
  more.textContent = "+" + hidden.length;
  more.title = "展开全部 " + hidden.length + " 个标签";
  more._hidden = hidden;
  more._open = false;
  more.onclick = function (ev) {
    ev.stopPropagation();
    this._open = !this._open;
    if (this._open) { this._hidden.forEach(function (k) { k.style.display = ""; }); this.textContent = "−收"; }
    else { this._hidden.forEach(function (k) { k.style.display = "none"; }); this.textContent = "+" + this._hidden.length; }
  };
  tw.appendChild(more);
}
export function scrollers() {   // 书架可能滚在 body 上, 也可能滚在 #grid/#shelf 里: 全都试一遍
  var out = [];
  var se = document.scrollingElement; if (se) out.push(se);
  if (elGrid) out.push(elGrid);
  var sh = document.getElementById("shelf"); if (sh) out.push(sh);
  return out;
}
export function finishReorder(el, target, items, gname) {
  // 直接从 DOM 位置算 from/to, 不依赖 items 数组(多次拖动后 items 可能过期)
  var parent = el.parentNode;
  if (!parent || target.parentNode !== parent) return;
  var children = Array.prototype.filter.call(parent.children, function (c) { return c.classList.contains("card") && !c.classList.contains("acard"); });
  var from = children.indexOf(el);
  var to = children.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  // 移动 DOM 元素
  if (to > from) parent.insertBefore(el, target.nextSibling);
  else parent.insertBefore(el, target);
  // 同步 items 数组(供下次计算用), 并存到 localStorage
  var moved = items.splice(from, 1)[0];
  items.splice(to, 0, moved);
  var ord = manualOrder();
  for (var i = 0; i < items.length; i++) ord[items[i].dir] = i + 1;
  saveManualOrder(ord);
  hint("已保存顺序：" + gname);
}
export function extractCardColor(img, cardEl) {
  if (!cardEl) return;
  var src = img.src;
  if (COLOR_CACHE[src]) {
    cardEl.style.setProperty('--c1', COLOR_CACHE[src][0]);
    cardEl.style.setProperty('--c2', COLOR_CACHE[src][1]);
    return;
  }
  try {
    var canvas = document.createElement('canvas');
    var w = canvas.width = 40, h = canvas.height = 60;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;
    // ── 聚簇投票取主色: 24 个色相桶, 权重 = 色度 × 明度适中度 ──
    // 原来取「最饱和的那一个像素」, 封面里一个孤立亮点就能夺权(实测 18% 的卡片抽到的色相跟封面主色差 >60°)
    var NB = 24;
    var bw = new Float64Array(NB), brr = new Float64Array(NB), bgg = new Float64Array(NB), bbb = new Float64Array(NB);
    var anyW = 0, tR = 0, tG = 0, tB = 0, tW = 0;
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn;
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      var wgt = ch * (1 - Math.abs(lum - 128) / 220);
      if (wgt < 1) wgt = 1;
      tR += r * wgt; tG += g * wgt; tB += b * wgt; tW += wgt;
      if (ch < 25 || lum < 25) continue;
      var hh;
      if (mx === r) hh = ((g - b) / ch) % 6; else if (mx === g) hh = (b - r) / ch + 2; else hh = (r - g) / ch + 4;
      hh *= 60; if (hh < 0) hh += 360;
      var kk0 = Math.floor(hh / 15) % NB;
      bw[kk0] += wgt; brr[kk0] += r * wgt; bgg[kk0] += g * wgt; bbb[kk0] += b * wgt;
      anyW += wgt;
    }
    var dR, dG, dB;
    if (anyW > 0) {
      var best = 0;
      for (var k2 = 1; k2 < NB; k2++) if (bw[k2] > bw[best]) best = k2;
      var near = [best, (best + 1) % NB, (best + NB - 1) % NB];   // 冠军桶 + 左右邻桶(色相连续, 只取一个会丢边)
      var sR = 0, sG = 0, sB = 0, sW = 0;
      for (var u = 0; u < 3; u++) { var ku = near[u]; sR += brr[ku]; sG += bgg[ku]; sB += bbb[ku]; sW += bw[ku]; }
      if (sW > 0) { dR = sR / sW; dG = sG / sW; dB = sB / sW; }
    }
    if (dR === undefined) {   // 封面真的没颜色(黑白漫/强灰) → 用全图加权平均, 偏中性, 而不是抽到噪点
      dR = tW ? tR / tW : 139; dG = tW ? tG / tW : 92; dB = tW ? tB / tW : 246;
    }
    var base = 'rgb(' + Math.round(dR) + ',' + Math.round(dG) + ',' + Math.round(dB) + ')';
    // OKLCH 感知增色(交给浏览器算): 色度 ×1.4, 亮度夹到舒适区, 不透明度 .45 → .62
    var c1 = 'oklch(from ' + base + ' clamp(0.55, l, 0.72) calc(c * 1.4) h / .62)';
    // 角上那圈光晕: 更亮更艳一档
    var c2 = 'oklch(from ' + base + ' clamp(0.68, l, 0.84) calc(c * 1.55) h / .58)';
    COLOR_CACHE[src] = [c1, c2];
    cardEl.style.setProperty('--c1', c1);
    cardEl.style.setProperty('--c2', c2);
  } catch(e) {}
}
export function copyText(s) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).then(function () { hint("已复制"); }, function () { hint("复制失败"); });
  } else hint("复制失败");
}
export function gridCellW(root) {
  try {
    var c = root && root.querySelector("div");
    var w = c ? Math.round(c.getBoundingClientRect().width) : 0;
    if (w > 80 && w < 400) return w;
  } catch (e) {}
  return 200;
}
export function thumbOf(c, ch, pi) {
  try { var pl = pageList(c, ch); return pl[Math.min(pi, pl.length - 1)] || null; } catch (e) { return null; }
}
export function updateFilterBadge() {
  var n = (S.authors ? S.authors.length : 0) + (S.ratings ? S.ratings.length : 0) + (S.plats ? S.plats.length : 0) + (S.works ? S.works.length : 0);
  var badge = document.getElementById("btn-filter-badge");
  if (badge) {
    badge.textContent = n ? (" " + n) : "";
    badge.className = "fbadge" + (n ? "" : " clean");
  }
}

// ---- 由 core 注入 ----
let COLOR_CACHE;

export function initShelfUtil(ctx) {
  COLOR_CACHE = ctx.COLOR_CACHE
}
