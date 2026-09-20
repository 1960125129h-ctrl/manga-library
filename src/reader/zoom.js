// 阅读器的缩放与滚轮: 右键滚轮缩放 / 右键拖动平移 / 居中 / 适宽高重算 / 滚轮翻页
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 阅读器域第 5 批)。
// refitRaf(适宽高的 rAF 句柄)只在 refit 里用, 一起搬走。

import { S } from '../app/state.js';
import { elCanvas, zoomRetryN, setZoomRetryN, zoomRetryT, setZoomRetryT, rightDown, wheelLock, setWheelAcc, wheelAcc, setWheelLock } from '../reader/state.js';
import { panCanvas } from '../reader/view.js';
import { hint } from '../shared/ui.js';

let refitRaf = 0;   // 适宽/适高重算的 rAF 句柄(只在 refit 里用)

export function refit() {
  if (refitRaf) return;
  refitRaf = requestAnimationFrame(function () {
    refitRaf = 0;
    try {
      if (!elStage) return;
      var w = elStage.clientWidth, h = elStage.clientHeight;
      if (!w || !h) return;
      elStage.style.setProperty('--sw', w + 'px');
      elStage.style.setProperty('--sh', h + 'px');
    } catch (e) {}
  });
}
export function zoomStep(d) {
  var z = Math.round(((S.zscale || 1) + d) * 100) / 100;
  z = Math.max(0.2, Math.min(8, z));
  zoomAt(z, elStage.clientWidth / 2, elStage.clientHeight / 2);
  hint("缩放 " + Math.round(z * 100) + "%");
}
export function applyZoom(z) {
  S.zscale = z; S.zoom = Math.abs(z - 1) > 0.001;
  elStage.style.setProperty("--zscale", String(z));
  var cls = "stage mode-" + S.mode + " fit-" + S.fit + " dir-" + S.dir;
  elStage.className = cls + (S.zoom ? " zoom" : "");
  var i, ims = elStage.querySelectorAll("img.pageimg");
  if (!S.zoom) {
    for (i = 0; i < ims.length; i++) {
      var im = ims[i];
      im.style.width = ""; im.style.height = ""; im.style.maxWidth = ""; im.style.maxHeight = "";
      im.removeAttribute("data-basew");
    }
    var ws0 = elStage.querySelectorAll(".pagewrap");
    for (i = 0; i < ws0.length; i++) { ws0[i].style.width = ""; ws0[i].style.height = ""; }
    if (elCanvas) elCanvas.style.transform = "";
    S.tx = 0; S.ty = 0;
    return;
  }
  // 100% 基准宽 = 该模式下这一页原本显示出来的宽度: 先摘掉 zoom 类量一次, 量完立刻戴回
  var need = elStage.querySelectorAll("img.pageimg:not([data-basew])");
  if (need.length) {
    elStage.className = cls;
    for (i = 0; i < need.length; i++) {
      var w0 = Math.round(need[i].getBoundingClientRect().width);
      if (w0 < 3 && need[i].naturalWidth) w0 = need[i].naturalWidth;
      if (w0 >= 3) need[i].setAttribute("data-basew", String(w0));
    }
    elStage.className = cls + " zoom";
  }
  var pending = false;
  var wraps = elStage.querySelectorAll(".pagewrap");
  for (var wi = 0; wi < wraps.length; wi++) {
    var wrap = wraps[wi];
    var wims = wrap.querySelectorAll("img.pageimg"), total = 0, cnt = 0, ready = true;
    var gap = S.mode === "scroll" ? 0 : 2;
    for (i = 0; i < wims.length; i++) {
      var wim = wims[i];
      var base = parseFloat(wim.getAttribute("data-basew") || "0");
      if (!base) {
        ready = false; pending = true;
        wim.addEventListener("load", function () { if (S.zoom) applyZoom(S.zscale || 1); }, { once: true });
        continue;
      }
      var wpx = Math.round(base * z);
      wim.style.maxWidth = "none"; wim.style.maxHeight = "none";
      wim.style.width = wpx + "px"; wim.style.height = "auto";
      total += wpx; cnt++;
    }
    if (ready && cnt) { wrap.style.width = (total + gap * (cnt - 1)) + "px"; wrap.style.height = ""; }
  }
  panCanvas();
  if (pending && zoomRetryN < 40) {   // 图还没解码 -> 稍后重试, 别让这次缩放白做
    setZoomRetryN(zoomRetryN + 1);
    clearTimeout(zoomRetryT);
    setZoomRetryT(setTimeout(function () { setZoomRetryT(0); if (S.zoom) applyZoom(S.zscale || 1); }, 150));
  }
}
export function zoomAt(z, ax, ay) {
  var k = z / (S.zscale || 1);
  if (!S.zoom && elCanvas) {   // 刚进缩放: 用"内容原点"(第一页左上角)的屏幕位置当画布原点 -> 进缩放这一下也不跳
    var sr = elStage.getBoundingClientRect();
    var im0 = elCanvas.querySelector("img.pageimg");   // 内容原点 = 第一张图的左上角
    var r0 = (im0 && im0.getBoundingClientRect().width > 2) ? im0.getBoundingClientRect()
           : (elCanvas.querySelector(".pagewrap") || elCanvas).getBoundingClientRect();
    S.tx = r0.left - sr.left; S.ty = r0.top - sr.top;
  }
  S.tx = ax - (ax - (S.tx || 0)) * k;
  S.ty = ay - (ay - (S.ty || 0)) * k;
  applyZoom(z);
}
export function centerCanvas() {
  if (!S.zoom || !elCanvas) return;
  var sr = elStage.getBoundingClientRect();
  var cw = elCanvas.offsetWidth, ch = elCanvas.offsetHeight;
  S.tx = Math.round((sr.width - cw) / 2);
  S.ty = 0;
  if (S.mode === "scroll") {
    var t = elCanvas.querySelector("img.pageimg[data-i='" + S.pi + "']");
    if (t && t.parentElement) S.ty = -t.parentElement.offsetTop;
  } else if (ch <= sr.height) S.ty = Math.round((sr.height - ch) / 2);
  panCanvas();
}
export function onWheel(e) {
  if (S.zoom) {   // 缩放状态: 普通滚轮同样是缩放(以光标为锚点), 绝不翻页
    e.preventDefault();
    var zz0 = S.zscale || 1;
    var zz = Math.max(0.2, Math.min(8, zz0 + (e.deltaY < 0 ? 0.1 : -0.1)));
    if (Math.abs(zz - zz0) > 0.001) {
      var rr = elStage.getBoundingClientRect();
      zoomAt(zz, e.clientX - rr.left, e.clientY - rr.top);
      hint("缩放 " + Math.round(zz * 100) + "%");
    }
    return;
  }
  if (!S.wheel || S.mode === "scroll" || e.ctrlKey) return;
  if (rightDown || (e.buttons & 2)) return;   // 右键按下时滚轮是缩放, 不翻页
  // 若当前页比视口高(适宽/原始模式), 先把这一页滚完再翻页
  if (elStage.scrollHeight > elStage.clientHeight + 4) {
    var atTop = elStage.scrollTop <= 1;
    var atBot = elStage.scrollTop + elStage.clientHeight >= elStage.scrollHeight - 2;
    if (e.deltaY > 0 && !atBot) return;
    if (e.deltaY < 0 && !atTop) return;
  }
  e.preventDefault();
  var now = Date.now();
  if (now < wheelLock) return;
  setWheelAcc(wheelAcc + (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));   // 行滚动的浏览器换算成像素
  if (Math.abs(wheelAcc) < 18) return;                          // 原来 40: 轻轻一滚就能翻页
  var goNext = wheelAcc > 0;
  setWheelAcc(0);
  setWheelLock(now + 90);                                         // 原来 180ms: 连滚更跟手
  if (goNext) nextPage(); else prevPage();
}

// ---- 由 core 注入 ----
let nextPage, prevPage, elStage;

export function initReaderZoom(ctx) {
  nextPage = ctx.nextPage; prevPage = ctx.prevPage; elStage = ctx.elStage
}
