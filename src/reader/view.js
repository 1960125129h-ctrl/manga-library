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
    speed: (typeof f.speed === "number") ? f.speed : 120,
    smooth: (f.smooth === 0) ? 0 : 1
  };
}
/* 当前视口中心那一页的显示宽度（横排）；取不到就返回 0 */
function centerPageWidth() {
  const st = ebStageEl();
  if (!st) return 0;
  const sr = st.getBoundingClientRect();
  const cx = sr.left + sr.width / 2;
  const imgs = st.querySelectorAll("img");
  let best = 0, bestD = Infinity;
  for (let i = 0; i < imgs.length; i++) {
    const r = imgs[i].getBoundingClientRect();
    if (!r.width) continue;
    const d = Math.abs((r.left + r.width / 2) - cx);
    if (d < bestD) { bestD = d; best = r.width; }
  }
  return best;
}
/* 横排是否已滚到链条最左 / 最右 */
function ebAtEdges() {
  const st = ebStageEl();
  if (!st) return { left: false, right: false };
  const maxX = st.scrollWidth - st.clientWidth;
  // 右端留 12px 容差：滚动条（约 9px）会让 scrollLeft 停在 maxX 前面一点，
  // 原来用 -2 判不到最右，右侧模糊就不会自动关。
  return { left: st.scrollLeft <= 2, right: maxX > 0 && st.scrollLeft >= maxX - 12 };
}
/* 只重算"边界"和左右开关（滚动时高频调用，不碰强度/压暗）。
   宽度：中间页用 clamp(页宽, 视口40%, 视口100%)，再居中。
   两端：不用 clamp 值 —— 第 1 页往往比 40% 还窄，用 clamp 会把第二页一大段划进清晰区，
         直接取首/末页的真实左右边，才能完整遮住相邻页。 */
export function updateEdgeFxDynamic() {
  const cfg = ebCfg();
  const root = document.documentElement;
  const st = ebStageEl();
  if (!st) return;
  const sr = st.getBoundingClientRect();
  const vw = Math.round(sr.width);
  const maxX = st.scrollWidth - st.clientWidth;
  const atLeft = st.scrollLeft <= 2;
  const atRight = maxX > 0 && st.scrollLeft >= maxX - 12;
  const imgs = st.querySelectorAll("img");
  const rectOf = function (el) {
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return {
      left: Math.max(0, Math.min(vw, Math.round(r.left - sr.left))),
      right: Math.max(0, Math.min(vw, Math.round(r.right - sr.left))),
      width: Math.round(r.width)
    };
  };

  // 首末页判定用滚动位置（不能用"第一页还剩一点在视口里"，那样翻到第 2 页时
  // 第一页的 right 只有 8px，边界会算成 [0,8]，整屏几乎全糊）。
  // 注意这里只切"用哪一页算边界"，不再联动整层的 opacity，所以即使有点切，
  // 也只是边界值的一次过渡，不会有"闪没了"。
  let leftPx, rightPx;
  if (atLeft) {
    let p = null;
    for (let i = 0; i < imgs.length; i++) { p = rectOf(imgs[i]); if (p) break; }
    if (p) { leftPx = 0; rightPx = p.right; }
    else { leftPx = 0; rightPx = Math.round(vw * cfg.clear / 100); }
  } else if (atRight) {
    let p = null;
    for (let i = imgs.length - 1; i >= 0; i--) { p = rectOf(imgs[i]); if (p) break; }
    if (p) { rightPx = vw; leftPx = p.left; }
    else { rightPx = vw; leftPx = vw - Math.round(vw * cfg.clear / 100); }
  } else {
    let clearPx = 0;
    if (cfg.mode === 'manual') {
      clearPx = Math.round(vw * cfg.clear / 100);
    } else {
      const pw = centerPageWidth();
      const lo = Math.round(vw * 0.40);
      const hi = Math.round(vw * 1.00);
      clearPx = pw > 0 ? Math.max(lo, Math.min(hi, Math.round(pw))) : Math.round(vw * (cfg.clear / 100));
    }
    leftPx = Math.round((vw - clearPx) / 2);
    rightPx = leftPx + clearPx;
  }
  leftPx = Math.max(0, Math.min(vw, leftPx));
  rightPx = Math.max(0, Math.min(vw, rightPx));

  // 过渡时长跟着「切换速度」
  const td = Math.max(0, Math.round(cfg.speed)) + "ms";
  const op = cfg.smooth ? "0.2s" : "0s";
  try {
    const elL = document.querySelector("#stagewrap > .edgeblur-l");
    const elR = document.querySelector("#stagewrap > .edgeblur-r");
    const key = td + "|" + op;
    if (root.__ebKey !== key) {
      root.__ebKey = key;
      [elL, elR].forEach(function (el) {
        if (!el) return;
        el.style.transition = "--eb-left " + td + " ease-out, --eb-right " + td + " ease-out, opacity " + op + " ease, visibility 0s";
      });
    }
    if (elL) { elL.style.setProperty("--eb-left", leftPx + "px"); elL.style.setProperty("--eb-right", rightPx + "px"); }
    if (elR) { elR.style.setProperty("--eb-left", leftPx + "px"); elR.style.setProperty("--eb-right", rightPx + "px"); }
  } catch (e) {}

  // 自动挡下不隐藏整层（贴边时 mask 已经全透明，再叠一层 opacity 会截断过渡帧）
  const wantL = (cfg.left === 'off') ? false : true;
  const wantR = (cfg.right === 'off') ? false : true;
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
    // 边界收放的过渡时长：走设置里的「切换速度」
    // 注意属性名必须和 CSS 里实际使用的变量一致（--eb-left / --eb-right）。
    // 之前这里写的是旧的 --eb-clear，等于声明了一个不存在的属性，过渡根本没生效；
    // 只有拖动滑杆触发 updateEdgeFxDynamic 时才会被改成正确的名字。
    const td = Math.max(0, Math.round(typeof cfg.speed === "number" ? cfg.speed : 120)) + "ms";
    const op2 = cfg.smooth ? "0.2s" : "0s";
    ["#stagewrap > .edgeblur-l", "#stagewrap > .edgeblur-r"].forEach(function (sel) {
      const el = document.querySelector(sel);
      if (!el) return;
      el.style.transition =
        "--eb-left " + td + " ease-out, --eb-right " + td + " ease-out, opacity " + op2 + " ease, visibility 0s";
    });
    root.__ebKey = td + "|" + op2;
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
    // 图片出来了就把外层 .pagewrap 的占位最小宽度撤掉。
    // 那个 min-width（视口高×0.70）是给"图还没加载"时撑位置的，
    // 窄图按高度缩放后往往比它窄，留着会让窄图两侧各空出一段，看起来像接缝。
    try {
      var wrap = im.parentElement;
      if (wrap && wrap.classList && wrap.classList.contains("pagewrap")) {
        wrap.style.minWidth = "0";
      }
    } catch (e) {}
    im.classList.add("pgin-on");
    // 图解码完宽度才是真的：横排下防剧透的清晰区边界靠图的左右边算，
    // 不在这里补一次，就得等 render() 里那个 320ms 的兜底定时器，期间边界是错的。
    try { updateEdgeFxDynamic(); } catch (e) {}
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