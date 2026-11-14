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
  try { applyEdgeFx(); } catch (e) {}
}

/* ---------- 画质增强（2.0 施工项 A） ----------
   把三档锐化(url(#enh-*)) + 亮度 + 对比拼成一条 CSS 变量 --r-img-filter，
   由 03-reader.css 的 #stage .pageimg / .scrollimg 吃进去。
   注意：**不动 --r-dim**。那层遮罩管的是"画面环境暗度"（背景一起暗），
   删掉会回归旧观感；这里的 filter 只管图片本身。
   顺序固定：先锐化，再亮度，最后对比 —— 反过来会把锐化出来的高光一起压掉。 */
/* ---------- 图片调色：一条 CSS filter 链 ----------
   参数全在 S.imgfx 里（0 表示"不动"），滑杆改值 -> 这里重拼 -> 页面立刻变。
   能用原生 CSS 的走 CSS（快）；色温/色调/高光/阴影/曲线 走 SVG（#fx-tone）；
   锐化走动态卷积核（#fx-sharpen）；颗粒是叠一层噪点纹理（CSS 变量控制透明度）。 */
export function fxDef() {
  return { bright: 100, contrast: 100, saturate: 100, warmth: 0, tint: 0,
           highlights: 0, shadows: 0, curve: 0, denoise: 0, clarity: 0,
           fade: 0, grain: 0, noise: 0, sharpen: 0 };
}
function fxNum(k, d) {
  var v = (S.imgfx && typeof S.imgfx[k] === "number") ? S.imgfx[k] : d;
  return isFinite(v) ? v : d;
}
/* 高光/阴影/曲线 -> feFunc tableValues（11 个控制点，浏览器线性插值） */
function toneTable(hi, sh, cv) {
  var out = [];
  for (var i = 0; i <= 10; i++) {
    var x = i / 10, y = x;
    if (x > 0.5) y += (hi / 100) * 0.55 * (x - 0.5) * 2 * (1.4 - x);      // 高光段
    if (x < 0.5) y += (sh / 100) * 0.55 * (0.5 - x) * 2 * (x + 0.4);      // 阴影段
    y += (cv / 100) * (x - 0.5) * Math.abs(x - 0.5) * 2.2;                // S 曲线
    out.push(Math.max(0, Math.min(1, y)).toFixed(3));
  }
  return out.join(" ");
}
/* ---------- 横排防剧透：两侧渐变毛玻璃 ----------
   两种挡位：
     自动 —— 清晰区跟随"当前页图片的显示宽度"（clamp 到视口 40%~100%），
             左/右模糊按位置自动开关（链条两端各自关闭）；
     手动 —— 完全按设置里的清晰区滑杆 + 左右开关。
   模糊强度和边缘压暗两种挡位共用。 */
/* 本模块取阅读区元素（view.js 没有 import elStage） */
let _ebStage = null;
function ebStageEl() {
  if (!_ebStage || !_ebStage.isConnected) _ebStage = document.getElementById("stage");
  return _ebStage;
}
function ebCfg() {
  const f = S.edgefx || {};
  return {
    mode: (f.mode === 'manual') ? 'manual' : 'auto',
    left: f.left || 'auto',
    right: f.right || 'auto',
    clear: (typeof f.clear === "number") ? f.clear : 50,
    blur: (typeof f.blur === "number") ? f.blur : 12,
    dim: (typeof f.dim === "number") ? f.dim : 28,
    smooth: (f.smooth === 0) ? 0 : 1
  };
}
/* 当前居中页在视口里的左右边界（相对视口左缘）；取不到返回 null */
function currentPageSpan() {
  const st = ebStageEl();
  if (!st) return null;
  const sr = st.getBoundingClientRect();
  // 用"当前页码 S.pi 对应的那张图"，而不是"视口中心最近的图"：
  // 横排第一页只有 800 多像素宽，滚到最左时视口中心其实落在第二页上，
  // 按最近页判定会认错人，左侧也就不会贴着屏幕边。
  let best = null;
  const cur = st.querySelector('.hstripimg[data-i="' + (S.pi | 0) + '"]');
  if (cur && cur.getBoundingClientRect().width) {
    best = cur.getBoundingClientRect();
  } else {
    const cx = sr.left + sr.width / 2;
    const imgs = st.querySelectorAll("img");
    let bestD = Infinity;
    for (let i = 0; i < imgs.length; i++) {
      const r = imgs[i].getBoundingClientRect();
      if (!r.width) continue;
      const d = Math.abs((r.left + r.width / 2) - cx);
      if (d < bestD) { bestD = d; best = r; }
    }
  }
  if (!best) return null;
  // 超出视口就夹到边界：跨页图会自然变成"两侧都不糊"
  const left = Math.max(0, Math.min(sr.width, Math.round(best.left - sr.left)));
  const right = Math.max(0, Math.min(sr.width, Math.round(best.right - sr.left)));
  return { left: left, right: right, width: Math.round(best.width), vw: Math.round(sr.width) };
}
/* 只重算"模糊边界"和左右开关（滚动时高频调用，不碰强度/压暗） */
export function updateEdgeFxDynamic() {
  const cfg = ebCfg();
  const root = document.documentElement;
  const st = ebStageEl();
  if (!st) return;
  const sr = st.getBoundingClientRect();
  const vw = Math.round(sr.width);
  const span = currentPageSpan();

  // 模糊边界：默认 = 当前页在屏幕上的真实左右边（这样第二页整段都会被糊住）
  // 手动挡：按清晰区百分比居中算，跟以前一样
  let leftPx, rightPx;
  if (cfg.mode === 'manual') {
    const half = Math.round(vw * cfg.clear / 100 / 2);
    leftPx = Math.round(vw / 2) - half;
    rightPx = Math.round(vw / 2) + half;
  } else if (span && span.right > 0 && span.left < vw) {
    // 当前页还看得见 → 模糊边界贴在它的真实左右边上
    leftPx = span.left;
    rightPx = span.right;
  } else {
    // 当前页已完全滚出视口（滚到中割/预接区），或还没渲染 → 回退到居中算法
    const half = Math.round(vw * cfg.clear / 100 / 2);
    leftPx = Math.round(vw / 2) - half;
    rightPx = Math.round(vw / 2) + half;
  }
  try {
    root.style.setProperty("--eb-left", leftPx + "px");
    root.style.setProperty("--eb-right", rightPx + "px");
  } catch (e) {}

  // 左右是否启用：按滚动位置判断"链条两端"。
  // 不能用 leftPx/rightPx —— 本话末页后面还有预接的下一话，那时 rightPx 已经是负数了，
  // 但屏幕右边其实还有内容要糊。
  const maxX = st.scrollWidth - st.clientWidth;
  const edgeL = st.scrollLeft <= 2;
  const edgeR = maxX > 0 && st.scrollLeft >= maxX - 12;
  const wantL = (cfg.left === 'off') ? false : (cfg.left === 'on') ? true : !edgeL;
  const wantR = (cfg.right === 'off') ? false : (cfg.right === 'on') ? true : !edgeR;
  const dead = (cfg.blur <= 0 && cfg.dim <= 0);
  const apply = (sel, on) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.setAttribute("data-off", (dead || !on) ? "1" : "0");
  };
  apply("#stagewrap > .edgeblur-l", wantL);
  apply("#stagewrap > .edgeblur-r", wantR);
}
/* 全量应用（改设置时调用）：强度、压暗、过渡、然后重算动态部分 */
export function applyEdgeFx() {
  const cfg = ebCfg();
  const root = document.documentElement;
  try {
    root.style.setProperty("--eb-blur", cfg.blur + "px");
    root.style.setProperty("--eb-dim", String(Math.round(cfg.dim) / 100));
    root.style.setProperty("--eb-smooth", cfg.smooth ? "0.2s" : "0s");
  } catch (e) {}
  updateEdgeFxDynamic();
}

export function applyImgFilter() {
  var parts = [];
  var br = fxNum("bright", 100), ct = fxNum("contrast", 100), sa = fxNum("saturate", 100);
  var wa = fxNum("warmth", 0), ti = fxNum("tint", 0);
  var hi = fxNum("highlights", 0), sh = fxNum("shadows", 0), cv = fxNum("curve", 0);
  var dn = fxNum("denoise", 0), cl = fxNum("clarity", 0), fd = fxNum("fade", 0);
  var gr = fxNum("grain", 0), nz = fxNum("noise", 0), sk = fxNum("sharpen", 0);

  if (br !== 100) parts.push("brightness(" + (br / 100).toFixed(3) + ")");
  if (ct !== 100) parts.push("contrast(" + (ct / 100).toFixed(3) + ")");
  if (sa !== 100) parts.push("saturate(" + (sa / 100).toFixed(3) + ")");
  if (dn > 0) parts.push("blur(" + (dn / 100 * 0.9).toFixed(2) + "px)");          // 降噪=轻微糊
  if (fd > 0) { parts.push("sepia(" + (fd / 100 * 0.35).toFixed(2) + ")"); parts.push("contrast(" + (1 - fd / 100 * 0.12).toFixed(3) + ")"); }

  // 色温 / 色调（feColorMatrix：暖=红升蓝降，色调=绿升品红降）
  var wm = wa / 100, tm = ti / 100;
  if (wm !== 0 || tm !== 0) {
    try {
      var cm = document.getElementById("fx-cm");
      if (cm) {
        var r = (1 + wm * 0.10).toFixed(3), g = (1 + tm * 0.08).toFixed(3), b = (1 - wm * 0.10).toFixed(3);
        cm.setAttribute("values",
          r + " 0 0 0 0  0 " + g + " 0 0 0  0 0 " + b + " 0 0  0 0 0 1 0");
      }
      parts.push("url(#fx-tone)");
    } catch (e) {}
  }
  // 高光 / 阴影 / 曲线（feFunc tableValues）
  if (hi !== 0 || sh !== 0 || cv !== 0) {
    try {
      var tb = toneTable(hi, sh, cv);
      ["fx-cr", "fx-cg", "fx-cb"].forEach(function (id) {
        var f = document.getElementById(id);
        if (f) f.setAttribute("tableValues", tb);
      });
      if (parts.indexOf("url(#fx-tone)") < 0) parts.push("url(#fx-tone)");
    } catch (e) {}
  }
  // 锐化（连续）：卷积核 [0,-a,0; -a,1+4a,-a; 0,-a,0]，a 从 0 到 0.6
  var a = Math.min(0.6, sk / 100 * 0.6);
  if (a > 0.001) {
    try {
      var km = document.getElementById("fx-sharp-k");
      if (km) km.setAttribute("kernelMatrix", "0 " + (-a).toFixed(3) + " 0 " + (-a).toFixed(3) + " " + (1 + 4 * a).toFixed(3) + " " + (-a).toFixed(3) + " 0 " + (-a).toFixed(3) + " 0");
      parts.push("url(#fx-sharpen)");
    } catch (e) {}
  }
  // 清晰度：中等半径的局部对比（借 unsharp 的 strong 档，按量调强度）
  if (cl > 0.5) {
    try {
      var ub = document.getElementById("enh-strong-b");
      var uc = document.getElementById("enh-strong-c");
      var amt = cl / 100 * 0.9;
      if (ub) ub.setAttribute("stdDeviation", (0.8 + cl / 100 * 1.6).toFixed(2));
      if (uc) { uc.setAttribute("k2", (1 + amt).toFixed(3)); uc.setAttribute("k3", (-amt).toFixed(3)); }
      parts.push("url(#enh-strong)");
    } catch (e) {}
  }

  try {
    document.documentElement.style.setProperty("--r-img-filter", parts.length ? parts.join(" ") : "none");
    document.documentElement.style.setProperty("--fx-grain", String(gr / 100));   // 颗粒透明度
    document.documentElement.style.setProperty("--fx-noise", String(nz / 100));   // 杂色透明度
  } catch (e) {}
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