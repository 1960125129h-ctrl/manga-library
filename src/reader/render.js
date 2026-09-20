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

export function renderScroll() {
  var p = pages();
  for (var i = 0; i < p.length; i++) {
    var im = makeImg(p[i], "pageimg scrollimg");
    im.setAttribute("data-i", String(i));
    im.loading = i < 3 ? "eager" : "lazy";
    var w = document.createElement("div");
    w.className = "pagewrap scwrap";
    w.appendChild(im);
    elCanvas.appendChild(w);
  }
  var t = elStage.querySelector("[data-i='" + S.pi + "']");
  if (t && t.scrollIntoView) t.scrollIntoView({ block: "start" });
  if (io) { io.disconnect(); setIo(null); }
  var imgs = elStage.querySelectorAll(".scrollimg");
  setIo(new IntersectionObserver(function (es) {
    var best = null;
    for (var k = 0; k < es.length; k++) { if (es[k].isIntersecting && (!best || es[k].intersectionRatio > best.intersectionRatio)) best = es[k]; }
    if (best) { S.pi = parseInt(best.target.getAttribute("data-i"), 10); updateInfo(); syncThumbsActive(); save(); }
  }, { threshold: [0.1, 0.5, 0.9] }));
  for (var j = 0; j < imgs.length; j++) io.observe(imgs[j]);
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
export function render() {
  if (!comic) return;
  clamp();
  elStage.className = "stage mode-" + S.mode + " fit-" + S.fit + " dir-" + S.dir + (S.zoom ? " zoom" : "");
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
  document.title = (comic.name || comic.dir) + " · " + c.name + " " + (S.pi + 1) + "/" + pages().length;
}
export function syncButtons() {
  document.getElementById("m-single").classList.toggle("on", S.mode === "single");
  document.getElementById("m-double").classList.toggle("on", S.mode === "double");
  document.getElementById("m-scroll").classList.toggle("on", S.mode === "scroll");
  document.getElementById("f-width").classList.toggle("on", S.fit === "width");
  document.getElementById("f-height").classList.toggle("on", S.fit === "height");
  document.getElementById("f-original").classList.toggle("on", S.fit === "original");
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
