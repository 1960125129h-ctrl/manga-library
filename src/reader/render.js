// 阅读器的渲染: 三种模式(单页/双页/滚动) + 适配 + 缩略图侧栏 + 页码信息
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 阅读器域第 3 批)。
// 依赖 7 个函数 + 5 个只读 DOM 引用; render() 被引用 30 处, 是阅读器的主入口。
//
// 注意 renderPaged / renderScroll / updateInfo 只在批内用, 但**也一并 export** ——
// 统一策略: 不赌"core 里到底有没有当值传出去的用法", 少导一个就是运行时 undefined。

import { S } from '../app/state.js';
import { isBigPlat } from '../library/store.js';
import { bmSync, showImgCtx } from '../reader/panel.js';
import { elCanvas, io, setIo, comic, setElCanvas } from '../reader/state.js';
import { makeImg, syncThumbsActive, spreads, spreadIndex, preload, preloadAround, syncSideHandles, scrollThumbToCenter } from '../reader/view.js';
import { chLabel } from '../shared/chapter.js';
import { enc } from '../shared/text.js';

/* ---------- 长条模式: 回到"上次读到的那一页" ----------
   以前这里只有一句 scrollIntoView, 而那一刻页图还没有尺寸(长条里 .pageimg 是 height:auto,
   没解码就是 0 高), 所有页都叠在 y=0 -> scrollIntoView 落到开头, 等于没恢复。
   而且长条的页图是逐张解码、逐张长高度的: 上面每长出一张, 目标页就被往下推一截。
   所以这里做"粘住"的恢复:
     · 每张页图 load/error 对齐一次
     · 内容总高每变一次(ResizeObserver)再对齐一次 —— 不靠猜时间
     · 再挂几档定时器兜前 2.4 秒(图还没开始解码时先撑住位置)
     · 最多粘 8 秒(页图逐张解码, 高度可能拖到几秒后才定), 到点作废令牌放手, 交回 IntersectionObserver 跟踪
   用户真的动手(滚轮/手指/键盘/点按)就立刻放手 —— 绝不跟用户抢滚动条。 */
let scrollRestorePage = -1;   // >=0: 正在恢复到这一页(这段时间 IntersectionObserver 不接受远处的结果)
let scrollRestoreTok = 0;
let restoreBound = false;
let restoreRO = null;

function bindRestoreGuards() {
  if (restoreBound) return;
  restoreBound = true;
  var stop = function () { if (scrollRestorePage >= 0) cancelScrollRestore(); };
  ["wheel", "pointerdown", "touchstart", "keydown"].forEach(function (t) {
    try { window.addEventListener(t, stop, { passive: true, capture: true }); } catch (e) {}
  });
}
export function cancelScrollRestore() { scrollRestoreTok++; scrollRestorePage = -1; }
export function scrollToPage(i) {
  if (!comic) return;
  bindRestoreGuards();
  var tok = ++scrollRestoreTok;
  scrollRestorePage = i;
  var aligned = function () {                       // 目标页顶和视口顶差多少(px)
    var im = elStage.querySelector('.scrollimg[data-i="' + i + '"]');
    if (!im) return null;
    return Math.round(im.getBoundingClientRect().top - elStage.getBoundingClientRect().top);
  };
  var align = function () {
    if (tok !== scrollRestoreTok || scrollRestorePage < 0) return;
    var d = aligned();
    if (d === null || Math.abs(d) < 2) return;
    elStage.scrollTop = Math.round(elStage.scrollTop + d);
  };
  // 目标页之前的页图必须真的有尺寸, 否则位置算不准 -> 强制 eager, 并逐张挂 load/error 再对齐
  var imgs = elCanvas ? elCanvas.querySelectorAll(".scrollimg") : [];
  for (var k = 0; k <= i && k < imgs.length; k++) {
    var im2 = imgs[k];
    if (im2 && im2.tagName === "IMG" && !(im2.complete && im2.naturalHeight)) {
      try { im2.loading = "eager"; } catch (e) {}
      im2.addEventListener("load", align, { once: true });
      im2.addEventListener("error", align, { once: true });
    }
  }
  try {
    if (!restoreRO && window.ResizeObserver) restoreRO = new ResizeObserver(function () { align(); });
    if (restoreRO && elCanvas) { restoreRO.disconnect(); restoreRO.observe(elCanvas); }
  } catch (e) {}
  align();
  [40, 120, 300, 700, 1400, 2400].forEach(function (d) { setTimeout(align, d); });
  // 收尾: 一直对齐到 8 秒(页图逐张解码, 高度可能拖到几秒后才定); 到点必须"作废令牌"再放手,
  // 只把 scrollRestorePage 置 -1 是不行的 —— 定时器里的 align 还会继续把用户滚到的地方拽回来。
  var ticks = 0;
  var settle = function () {
    if (tok !== scrollRestoreTok) return;
    ticks++;
    align();
    if (ticks > 20) { cancelScrollRestore(); return; }
    setTimeout(settle, 400);
  };
  setTimeout(settle, 500);
}
export function renderScroll() {
  var p = pages();
  var target = Math.max(0, Math.min(S.pi, Math.max(0, p.length - 1)));
  for (var i = 0; i < p.length; i++) {
    var im = makeImg(p[i], "pageimg scrollimg");
    im.setAttribute("data-i", String(i));
    // 目标页之前的页图必须真加载: 长条是顺序流, 它们的高度决定目标页的 y 坐标
    im.loading = i <= target ? "eager" : "lazy";
    var w = document.createElement("div");
    w.className = "pagewrap scwrap";
    w.appendChild(im);
    elCanvas.appendChild(w);
  }
  if (io) { io.disconnect(); setIo(null); }
  var imgs = elStage.querySelectorAll(".scrollimg");
  setIo(new IntersectionObserver(function (es) {
    var best = null;
    for (var k = 0; k < es.length; k++) { if (es[k].isIntersecting && (!best || es[k].intersectionRatio > best.intersectionRatio)) best = es[k]; }
    if (!best) return;
    var idx = parseInt(best.target.getAttribute("data-i"), 10);
    // 恢复位置的过程中(前面的页图还在解码)视口里先露出来的永远是第 1 页 —— 那不是用户翻到的页。
    // 以前这里照单全收: 一开书就把"读到第几页"冲成 0, 于是重启后进度看着还在、翻进去却是第 1 页。
    if (scrollRestorePage >= 0 && idx !== scrollRestorePage) return;
    S.pi = idx; updateInfo(); syncThumbsActive(); save();
  }, { threshold: [0.1, 0.5, 0.9] }));
  for (var j = 0; j < imgs.length; j++) io.observe(imgs[j]);
  scrollToPage(target);   // 观察器就位之后再对齐, 对齐后的高亮由它负责
}
export function renderPaged() {
  var p = pages(), idxs;
  if (S.mode === "double") { var sp = spreads(), k = spreadIndex(S.pi); idxs = sp[k]; S.pi = idxs[0]; }
  else { idxs = [S.pi]; }
  var wrap = document.createElement("div");
  wrap.className = "pagewrap";
  for (var i = 0; i < idxs.length; i++) wrap.appendChild(makeImg(p[idxs[i]], "pageimg"));
  elCanvas.appendChild(wrap);
  preload();
}
// 「整页」只在单页模式有意义(双页要各占一半、长条是连续流), 其他模式自动按适高渲染.
// 这里只影响"怎么画", 不改 S.fit, 这样切回单页还能记住用户选的整页.
// 长条模式的整本缩放：写成 CSS 变量，长条下图片宽度 = 视口宽 × 这个比例
export function applyScrollScale() {
  const v = (typeof S.scale === "number" && S.scale >= 0.1 && S.scale <= 1.6) ? S.scale : 1;
  try { document.documentElement.style.setProperty("--scroll-scale", String(v)); } catch (e) {}
  const t = document.getElementById("bscaletxt");
  if (t) t.textContent = Math.round(v * 100) + "%";
}

function effFit() {
  return (S.fit === "page" && S.mode !== "single") ? "height" : S.fit;
}
export function render() {
  if (!comic) return;
  cancelScrollRestore();   // 每次重画都是一次新的定位(长条模式下由 renderScroll 重新挂恢复)
  clamp();
  elStage.className = "stage mode-" + S.mode + " fit-" + effFit() + " dir-" + S.dir + (S.zoom ? " zoom" : "");
  applyScrollScale();
  var readerEl = document.getElementById("reader");
  readerEl.dataset.mode = S.mode;
  readerEl.dataset.dir = S.dir;
  refit();   // 换了模式/适配方式就按真实可用尺寸重算一遍
  elStage.innerHTML = "";
  setElCanvas(document.createElement("div")); elCanvas.id = "canvas";
  elStage.appendChild(elCanvas);
  if (S.mode === "scroll") renderScroll(); else renderPaged();
  preloadAround();
  applyThumbs();
  if (S.zoom) { applyZoom(S.zscale || 1); centerCanvas(); }   // 同步执行: 后台标签页里 rAF 会被节流, 不能依赖
  bmSync();
  updateInfo(); syncButtons(); save();
}
export function applyThumbs() {
  var box = document.getElementById("thumbs");
  if (!box) return;
  box.classList.toggle("collapsed", !S.thumbs);
  syncSideHandles();
  if (!comic) return;   // 没有打开的书时(比如在书架态误触「预览」按钮) pages() 会拿到 null 抛错
  if (!S.thumbs) return;
  var list = document.getElementById("thumblist");
  if (!list) return;
  var pl = pages();
  var sig = S.ci + ":" + pl.length + ":" + (S.prevRev ? 1 : 0);
  if (list.getAttribute("data-sig") === sig) { syncThumbsActive(); return; }   // 内容没变就不重建(免得闪)
  list.setAttribute("data-sig", sig);
  var frag = document.createDocumentFragment();
  var ord = [], k2;
  for (k2 = 0; k2 < pl.length; k2++) ord.push(k2);
  if (S.prevRev) ord.reverse();                 // 预览倒序: 列表从最后一页排到第一页
  for (var q2 = 0; q2 < ord.length; q2++) {
    var i = ord[q2];
    var it = document.createElement("div"); it.className = "titem" + (i === S.pi ? " on" : ""); it.setAttribute("data-pi", String(i));
    var im = document.createElement("img"); im.loading = (q2 < 3 ? "eager" : "lazy"); im.decoding = "async"; im.src = enc(pl[i]);
    var tn = document.createElement("span"); tn.className = "tn"; tn.textContent = String(i + 1);   // 显示真实页码
    it.appendChild(im); it.appendChild(tn);
    (function (idx, el) {
      el.onclick = function () { S.pi = idx; render(); };
      el.oncontextmenu = function (ev) { ev.preventDefault(); ev.stopPropagation(); showImgCtx(ev.clientX, ev.clientY, idx); };
    })(i, it);
    frag.appendChild(it);
  }
  list.replaceChildren(frag);   // 一次性换上, 不出现"先清空后逐个补"的白闪
  var cur = list.querySelector(".titem.on");
  if (cur) scrollThumbToCenter(cur, true);   // 列表刚重建, 直接对准中心(不用动画)
  else if (list.children.length) scrollThumbToCenter(list.children[0], true);
}
export function updateInfo() {
  var c = cur(); if (!c) return;
  elChName.textContent = chLabel(c);
  elPageInfo.textContent = "/ " + pages().length;
  if (document.activeElement !== elPageInput) elPageInput.value = String(S.pi + 1);
  document.title = (comic.name || comic.dir) + " · " + chLabel(c) + " " + (S.pi + 1) + "/" + pages().length;
}
export function syncButtons() {
  document.getElementById("m-single").classList.toggle("on", S.mode === "single");
  document.getElementById("m-double").classList.toggle("on", S.mode === "double");
  document.getElementById("m-scroll").classList.toggle("on", S.mode === "scroll");
  document.getElementById("f-width").classList.toggle("on", S.fit === "width");
  document.getElementById("f-height").classList.toggle("on", S.fit === "height");
  document.getElementById("f-original").classList.toggle("on", S.fit === "original");
  var bp2 = document.getElementById("f-page");
  if (bp2) {
    bp2.classList.toggle("on", S.fit === "page");
    bp2.disabled = S.mode !== "single";          // 双页/长条下不可用
    bp2.title = S.mode === "single" ? "整页：宽和高都不超出显示范围，并且放大到能放下的最大尺寸" : "整页只在单页模式可用（双页/长条下自动按适高显示）";
  }
  document.getElementById("bcover").classList.toggle("on", S.cover);
  var bz2 = document.getElementById("bzoom"); if (bz2) bz2.classList.toggle("on", !!S.zoom);
  var bz2o = document.getElementById("bzoomout"); if (bz2o) bz2o.classList.toggle("on", !!S.zoom);
  var bz2r = document.getElementById("bzoomreset"); if (bz2r) bz2r.classList.toggle("on", !!S.zoom);
  document.getElementById("bdir").textContent = S.dir === "rtl" ? "日漫「右→左」" : "左→右";
  var brv = document.getElementById("brev");
  if (brv) { brv.classList.toggle("on", !!S.rev); brv.textContent = S.rev ? "倒序：新→旧" : "顺序：旧→新"; }
  var bpc = document.getElementById("bprevch"), bnc = document.getElementById("bnextch");
  if (bpc && bnc) { var big = !!(comic && isBigPlat(comic.dir)); bpc.textContent = big ? "‹ 上一篇" : "‹ 上一话"; bnc.textContent = big ? "下一篇 ›" : "下一话 ›"; }
  var prv = document.getElementById("prevrev");
  if (prv) { prv.classList.toggle("on", !!S.prevRev); prv.textContent = S.prevRev ? "倒序" : "顺序"; prv.title = S.prevRev ? "预览/翻页：从最后一页往前看（点一下恢复正序）" : "预览/翻页：从第一页往后看（点一下切成倒序）"; }
  document.getElementById("bwheel").classList.toggle("on", S.wheel);
  elSidebar.classList.toggle("collapsed", !S.sidebar);
  var tb = document.getElementById("thumbs"); if (tb) tb.classList.toggle("collapsed", !S.thumbs);
  syncSideHandles();
}

// ---- 由 core 注入 ----
let applyZoom, centerCanvas, clamp, cur, pages, refit, save, elChName, elPageInfo, elPageInput, elSidebar, elStage;

export function initReaderRender(ctx) {
  applyZoom = ctx.applyZoom; centerCanvas = ctx.centerCanvas; clamp = ctx.clamp; cur = ctx.cur; pages = ctx.pages; refit = ctx.refit; save = ctx.save; elChName = ctx.elChName; elPageInfo = ctx.elPageInfo; elPageInput = ctx.elPageInput; elSidebar = ctx.elSidebar; elStage = ctx.elStage
}
