// 阅读器的视图辅助: 页面切分 / 图片懒建 / 预取 / 侧栏把手 / 缩略图居中 / 画布平移
// 以及阅读主题与阅读默认值
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 阅读器域第 2 批)。这批是阅读器里
// **不碰事件接线**的那一半 —— 只依赖 pages() 一项。
//
// 全部 export: core 里有些是当值传给别的模块的, 不是被调用。

import { enc } from '../shared/text.js';
import { S } from '../app/state.js';
import { comic, elCanvas, preloaded, lastThumbSync, thumbRaf, setLastThumbSync, setThumbRaf } from '../reader/state.js';
import { prog, setProg } from '../library/store.js';
import { savePrefs } from './prefs.js';

// 显示偏好改成全局一份(reader-prefs.json): 换书/换设备都沿用最近这次的选择。
// 以前这里只往 localStorage 写 4 项, 而且打开书时会被"那本书自己的记录"覆盖 -> 等于没用。
export function saveReaderDefaults(){ savePrefs(); }
export function applyReaderTheme() {
  var rd = document.getElementById("reader");
  if (rd) rd.setAttribute("data-theme", S.theme || "dark");
  // 阅读器配色和书架主题是同一套（都作用于 body[data-shelf-theme]），
  // 所以这里必须同步回 localStorage，否则：阅读器里换了配色 -> 书架当场变，
  // 但重启后书架又按 localStorage["shelfTheme"] 的老值渲染，看起来就是"没记住"
  var th = S.theme || "dark";
  document.body.setAttribute("data-shelf-theme", th === "dark" ? "" : th);
  try { localStorage.setItem("shelfTheme", th); } catch (err) {}
  var b = (typeof S.bright === "number") ? S.bright : 1;
  var dim = Math.max(0, Math.min(0.85, (1 - b) * 0.9));
  document.documentElement.style.setProperty("--r-dim", String(Math.round(dim * 1000) / 1000));
  try { localStorage.setItem("readerTheme", JSON.stringify({ theme: S.theme || "dark", bright: b })); } catch (e) {}
  applyImgFilter();
}

/* ---------- 画质增强（2.0 施工项 A） ----------
   把三档锐化(url(#enh-*)) + 亮度 + 对比拼成一条 CSS 变量 --r-img-filter，
   由 03-reader.css 的 #stage .pageimg / .scrollimg 吃进去。
   注意：**不动 --r-dim**。那层遮罩管的是"画面环境暗度"（背景一起暗），
   删掉会回归旧观感；这里的 filter 只管图片本身。
   顺序固定：先锐化，再亮度，最后对比 —— 反过来会把锐化出来的高光一起压掉。 */
export function applyImgFilter() {
  var parts = [];
  var en = S.enhance || "off";
  if (en === "soft" || en === "medium" || en === "strong") parts.push("url(#enh-" + en + ")");
  var b = (typeof S.bright === "number") ? S.bright : 1;
  if (b < 1) parts.push("brightness(" + Math.max(0.2, Math.round(b * 100) / 100) + ")");
  var c = (typeof S.contrast === "number") ? S.contrast : 1;
  if (c !== 1) parts.push("contrast(" + c + ")");
  try { document.documentElement.style.setProperty("--r-img-filter", parts.length ? parts.join(" ") : "none"); } catch (e) {}
}

/* 大图守门：单张超过 12MP 时 SVG 卷积在部分 Chromium 构建上会回落 CPU 算，
   直接摘掉滤镜比掉帧好。返回 true = 可以挂滤镜。 */
export function enhGuard(im) {
  if (!im || !im.naturalWidth) return true;
  return (im.naturalWidth * im.naturalHeight) <= 12e6;
}
export function spreads() {
  var n = pages().length, out = [], i = 0;
  if (S.cover && n > 0) { out.push([0]); i = 1; }
  while (i < n) { out.push(i + 1 < n ? [i, i + 1] : [i]); i += 2; }
  return out;
}
export function spreadIndex(pi) { var sp = spreads(); for (var k = 0; k < sp.length; k++) { if (sp[k].indexOf(pi) >= 0) return k; } return 0; }
export function makeImg(src, cls) {
  if (/\.mp4$/i.test(src)) {   // 原视频: 用 video 内嵌播放
    var v = document.createElement("video");
    v.src = enc(src); v.className = cls; v.controls = true; v.preload = "metadata"; v.loop = true;
    v.style.maxWidth = "100%"; v.style.maxHeight = "100%";
    v.oncontextmenu = function () { return false; };
    return v;
  }
  var im = document.createElement("img");
  im.src = enc(src);
  // 渐进显现: 先淡入(页数不多的书再叠一点模糊), 动画完就把类摘掉 —— 全程不碰 transform, 免得和缩放/拖动打架
  var anim = true;
  try { anim = S.mode !== "scroll" && S.mode !== "hscroll" && S.mode !== "hspread"; } catch (e) {}   // 长条/横排不做淡入, 免得滚动时一路闪
  im.className = cls + (anim ? " pgin" : "");
  im.decoding = "async";
  var reveal = function () {
    // 大图守门：单张超过 12MP 时 SVG 卷积可能回落 CPU，摘掉滤镜比掉帧好
    try { if (!enhGuard(im) && im.style.filter !== "none") im.style.filter = "none"; } catch (e) {}
    im.classList.add("pgin-on");
    setTimeout(function () {
      try { im.classList.remove("pgin"); im.classList.remove("pgin-on"); } catch (e) {}
    }, 220);
  };
  if (im.complete && im.naturalWidth) reveal();
  else { im.addEventListener("load", reveal); im.addEventListener("error", reveal); }
  im.oncontextmenu = function () { return false; };
  return im;
}
export function preload() {
  var p = pages(), step = S.mode === "double" ? 2 : 1;
  [S.pi + step, S.pi - step].forEach(function (i) { if (p[i]) { var a = new Image(); a.src = enc(p[i]); } });
}
export function preloadAround() {
  var pl = pages();
  var span = (typeof S.preload === "number" && S.preload >= 1 && S.preload <= 8) ? S.preload : 4;   // 2.0 施工项 C：可配
  for (var k = S.pi + 1; k <= Math.min(pl.length - 1, S.pi + span); k++) {   // 后 N 页提前解码
    if (preloaded[pl[k]]) continue;
    preloaded[pl[k]] = 1;
    var im = new Image(); im.decoding = "async"; im.src = pl[k];
  }
}
export function syncSideHandles() {
  var sh = document.getElementById("sidetoggle");
  if (sh) { sh.textContent = S.sidebar ? "‹" : "›"; sh.title = (S.sidebar ? "收起目录" : "展开目录") + " (S)"; }
  var th = document.getElementById("thumbtoggle");
  if (th) { th.textContent = S.thumbs ? "›" : "‹"; th.title = (S.thumbs ? "收起预览" : "展开预览") + " (P)"; }
}
export function scrollThumbToCenter(item, instant) {
  var list = document.getElementById("thumblist");
  if (!list || !item) return;
  var lh = list.clientHeight;
  var ih = item.offsetHeight || Math.round(item.getBoundingClientRect().height);
  var want = item.offsetTop - (lh - ih) / 2;
  var max = list.scrollHeight - lh;
  if (want < 0) want = 0;
  if (want > max) want = max;
  var from = list.scrollTop;
  if (Math.abs(want - from) < 3) return;   // 已经正中附近, 不动
  if (instant) { list.scrollTop = want; return; }
  if (thumbRaf) { cancelAnimationFrame(thumbRaf); setThumbRaf(0); }
  var t0 = performance.now(), dur = 140;
  var step = function (now) {
    var k2 = (now - t0) / dur;
    if (k2 > 1) k2 = 1;
    var e = 1 - Math.pow(1 - k2, 3);   // ease-out
    list.scrollTop = from + (want - from) * e;
    if (k2 < 1) setThumbRaf(requestAnimationFrame(step)); else setThumbRaf(0);
  };
  setThumbRaf(requestAnimationFrame(step));
}
export function syncThumbsActive() {
  try {
    if (!S.thumbs) return;
    var list = document.getElementById("thumblist");
    if (!list || !list.children.length) return;
    var now = Date.now();
    if (now - lastThumbSync < 60) return;
    setLastThumbSync(now);
    var items = list.children, target = null;
    for (var i = 0; i < items.length; i++) {
      var idx = parseInt(items[i].getAttribute("data-pi"), 10);
      if (idx === S.pi) {
        target = items[i];
        if (!items[i].classList.contains("on")) items[i].classList.add("on");
      } else if (items[i].classList.contains("on")) {
        items[i].classList.remove("on");
      }
    }
    if (target) scrollThumbToCenter(target, false);
  } catch (e) {}
}
export function saveRev() {   // 只写 rev, 不受 save() 里"停在书签页不记历史"的影响
  if (!comic) return;
  var p = prog(comic.dir) || {};
  p.rev = !!S.rev;
  p.prevRev = !!S.prevRev;
  setProg(comic.dir, p);
}
export function panCanvas() {
  if (elCanvas) elCanvas.style.transform = "translate(" + Math.round(S.tx || 0) + "px," + Math.round(S.ty || 0) + "px)";
}

// ---- 由 core 注入 ----
let pages;

export function initReaderView(ctx) {
  pages = ctx.pages
}
