// 书架的拖拽: 拖到边缘自动滚屏 / 拖到分组上高亮 / 卡片拖动与排序收尾
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 9 批)。
// 五个状态(dragSrc / dragScrollStep / dragScrollOn / dragScrollRAF / hoverEl)的**所有**
// 读写点都在本批函数里, 所以整簇归本模块, 不需要给 core setter。
//
// core 顶层还有一句 document.addEventListener("dragover", ...) 在调 autoScroll ——
// 那是事件接线, 留到"接线收进 initShelf()"那一步再动。

import { manifestOf, authorKey, entryOf, libEntry, libSave } from '../library/store.js';
import { hint } from '../shared/ui.js';
import { setJustDraggedUntil } from '../shelf/state.js';
import { scrollers, finishReorder } from '../shelf/util.js';

// ---- 本模块持有的状态(读写点都在本模块内) ----
let dragSrc = null;                                    // 正在拖的卡片
let dragScrollStep = 0, dragScrollOn = false, dragScrollRAF = 0;   // 拖到边缘时的自动滚屏
let hoverEl = null;                                    // 当前高亮的落点分组

export function dragScrollTick() {
  if (!dragSrc || !dragScrollStep) { dragScrollOn = false; dragScrollRAF = 0; return; }
  var list = scrollers();
  for (var i = 0; i < list.length; i++) {
    var el2 = list[i];
    try { if (el2.scrollHeight > el2.clientHeight + 2) el2.scrollTop += dragScrollStep; } catch (e) {}
  }
  dragScrollRAF = requestAnimationFrame(dragScrollTick);
}
export function autoScroll(y) {   // 拖到窗口上下边缘自动滚屏(原生拖拽期间滚轮被浏览器屏蔽, 只能靠这个)
  var h = window.innerHeight || 800, edge = 170, st = 0;
  if (y < edge) st = -Math.max(6, Math.round((edge - y) / 8));
  else if (y > h - edge) st = Math.max(6, Math.round((y - (h - edge)) / 8));
  dragScrollStep = st;
  if (st && !dragScrollOn) { dragScrollOn = true; dragScrollRAF = requestAnimationFrame(dragScrollTick); }
}
export function makeGroupDrop(sec, gname, mode) {
  sec.setAttribute("data-gname", gname);
  sec.ondragover = function (ev) { if (!dragSrc) return; ev.preventDefault(); sec.classList.add("droptarget"); autoScroll(ev.clientY); };
  sec.ondragleave = function () { sec.classList.remove("droptarget"); };
  sec.ondrop = function (ev) { ev.preventDefault(); sec.classList.remove("droptarget"); if (dragSrc) applyGroupDrop(dragSrc.getAttribute("data-dir"), gname, mode); };
}
export function applyGroupDrop(dir0, gname, mode, cardEl) {
  var dir = dir0;
  if (!dir) return;
  var mfc = manifestOf(dir) || {};
  var cur = mode === "work" ? (mfc.work || "未识别作品") : (mode === "char" ? (mfc.char || "未识别角色") : (mode === "author" ? (authorKey((entryOf(dir) || {}).author) || "未标注") : ""));
  if (cur === gname) return;
  var e2 = libEntry(dir);
  var nv = (gname === "未识别作品" || gname === "未识别角色" || gname === "未标注") ? "" : gname;
  if (mode === "work") { e2.work = nv; mfc.work = nv; }
  else if (mode === "char") { e2.char = nv; mfc.char = nv; }
  else if (mode === "author") { e2.author = nv; }
  else return;
  libSave();
  // 直接操作 DOM: 把卡片移到目标组的 agrid, 更新两边的计数, 不重建整个书架
  if (cardEl) {
    var srcSec = cardEl.closest(".agroup");
    var dstSec = document.querySelector('.agroup[data-gname="' + CSS.escape(gname) + '"]');
    if (srcSec && dstSec && srcSec !== dstSec) {
      var dstGrid = dstSec.querySelector(".agrid");
      if (dstGrid) dstGrid.appendChild(cardEl);
      // 更新两边计数
      function updateCount(sec) {
        var n = sec.querySelectorAll(".agrid .card").length;
        var cnt = sec.querySelector(".ahead .cnt");
        if (cnt) cnt.textContent = n + " 本";
        sec.classList.toggle("single", n === 1);
      }
      updateCount(srcSec);
      updateCount(dstSec);
      // 源组空了就隐藏; 目标组如果之前被隐藏了就显示
      if (srcSec.querySelectorAll(".agrid .card").length === 0) srcSec.style.display = "none";
      dstSec.style.display = "";
    }
  }
  hint("已把 " + (mfc.name || dir).slice(0, 12) + " 归到「" + gname + "」");
}
export function setHover(t) {
  if (hoverEl === t) return;
  if (hoverEl && hoverEl.classList) hoverEl.classList.remove("droptarget");
  hoverEl = t;
  if (hoverEl && hoverEl.classList) hoverEl.classList.add("droptarget");
}
export function makeDraggable(el, items, gname, mode) {
  el.style.touchAction = "none";
  el.onpointerdown = function (ev) {
    if (ev.button !== 0) return;
    if (!el.getAttribute("data-dir")) return;
    var sx = ev.clientX, sy = ev.clientY, started = false, ghost = null;
    var onMove = function (e2) {
      if (!started) {
        if (Math.abs(e2.clientX - sx) + Math.abs(e2.clientY - sy) < 8) return;
        started = true; dragSrc = el; el.classList.add("dragging"); el.style.opacity = ".35";
        try {
          ghost = el.cloneNode(true);
          ghost.className = "card dragghost";
          ghost.style.cssText = "position:fixed;pointer-events:none;z-index:9999;opacity:.85;width:" + el.offsetWidth + "px;transform:rotate(2deg)";
          document.body.appendChild(ghost);
        } catch (er) {}
      }
      if (ghost) { ghost.style.left = (e2.clientX - 40) + "px"; ghost.style.top = (e2.clientY - 40) + "px"; }
      autoScroll(e2.clientY);
      var under = document.elementFromPoint(e2.clientX, e2.clientY);
      var sec2 = (under && under.closest) ? under.closest(".agroup") : null;
      var tg = (under && under.closest) ? under.closest(".card") : null;
      var myG = el.closest(".agroup");
      if (sec2 && myG && sec2 !== myG) setHover(sec2);
      else if (tg && tg !== el && tg.closest(".agroup") === myG) setHover(tg);
      else setHover(null);
      if (e2.cancelable) e2.preventDefault();
    };
    var onUp = function (e2) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!started) return;
      var under = document.elementFromPoint(e2.clientX, e2.clientY);
      var sec3 = (under && under.closest) ? under.closest(".agroup") : null;
      var tg3 = (under && under.closest) ? under.closest(".card") : null;
      var myG = el.closest(".agroup");
      el.classList.remove("dragging"); el.style.opacity = "";
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      setHover(null);
      if (sec3 && myG && sec3 !== myG) applyGroupDrop(el.getAttribute("data-dir"), sec3.getAttribute("data-gname"), mode, el);
      else if (tg3 && tg3 !== el) finishReorder(el, tg3, items, gname);
      dragSrc = null; dragScrollStep = 0;
      if (dragScrollRAF) { cancelAnimationFrame(dragScrollRAF); dragScrollRAF = 0; }
      // 吃掉拖拽结束后浏览器自动触发的那次 click(否则会打开落在上面的书)
      setJustDraggedUntil(Date.now() + 300);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
}

// ---- 由 core 注入 ----
let cur;

export function initShelfDrag(ctx) {
  cur = ctx.cur
}
