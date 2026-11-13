// 阅读器的翻页与阅读环境: 上下页/上下话 / 阅读主题对话框 / 背景视差
// 还带着 3 个阅读器小工具: cur(当前话) / pages(当前话的页列表) / clamp(页码夹取)
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 阅读器域第 6 批)。
// bgParRaf(视差 rAF 句柄)只在 bgParallax 里用, 一起搬走。

import { S } from '../app/state.js';
import { isBigPlat } from '../library/store.js';
import { chStep, renderChapters } from '../reader/panel.js';
import { render, stripJump, animateScrollX, maybePromoteNext } from '../reader/render.js';
import { comic } from '../reader/state.js';
import { applyReaderTheme, spreads, spreadIndex, saveReaderDefaults, applyImgFilter } from '../reader/view.js';
import { pageList, chLabel, nOf } from '../shared/chapter.js';
import { enc } from '../shared/text.js';
import { showModal, closeModal, hint } from '../shared/ui.js';

let bgParRaf = 0;   // 背景视差的 rAF 句柄(只在 bgParallax 里用)

export function cur() { return comic ? comic.chapters[S.ci] : null; }
export function clamp() { var n = pages().length; if (!n) { S.pi = 0; return; } if (S.pi < 0) S.pi = 0; if (S.pi > n - 1) S.pi = n - 1; }
export function bgParallax(y) {
  if (!BG_PARALLAX) return;   // 视差强度(0=关: 用户反馈滚起来看晕了)
  if (!document.body.classList.contains('bgimg')) return;
  if (bgParRaf) return;
  bgParRaf = requestAnimationFrame(function () {
    bgParRaf = 0;
    var py = parseFloat(localStorage.getItem('bgPosY') || '50');
    document.body.style.backgroundPositionY = 'calc(' + py + '% + ' + Math.round(y * 0.18) + 'px)';
  });
}
export function pages() { return pageList(comic, comic.chapters[S.ci]); }
export function openThemeDialog() {
  showModal(function (box) {
    var h = document.createElement("h3"); h.textContent = "阅读配色与亮度"; box.appendChild(h);
    var sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = "预设是整套换肤（画面 + 侧栏 + 工具栏 + 按钮，每种都带纹理）；亮度调的是画面背景（图片本身亮度不变），工具栏和侧栏始终清晰。";
    box.appendChild(sub);
    var sw = document.createElement("div"); sw.id = "rtswatch"; box.appendChild(sw);
    THEMES.forEach(function (t) {
      var b2 = document.createElement("button");
      b2.textContent = t[1];
      b2.style.background = t[2]; b2.style.color = t[3];
      b2.className = (S.theme === t[0]) ? "on" : "";
      b2.onclick = function () {
        S.theme = t[0]; applyReaderTheme(); saveReaderDefaults();   // 配色也要落盘，否则下次进来又是默认
        Array.prototype.forEach.call(sw.children, function (x) { x.className = (x === b2) ? "on" : ""; });
      };
      sw.appendChild(b2);
    });
    var lb = document.createElement("label"); lb.textContent = "画面背景亮度（图片本身不变）"; box.appendChild(lb);
    var rg = document.createElement("input"); rg.type = "range"; rg.min = "10"; rg.max = "100"; rg.step = "5";
    rg.value = String(Math.round(((typeof S.bright === "number") ? S.bright : 1) * 100));
    var val = document.createElement("div"); val.className = "stat"; val.textContent = rg.value + "%";
    var brightTimer = 0;
    rg.oninput = function () {
      S.bright = Number(rg.value) / 100; val.textContent = rg.value + "%"; applyReaderTheme();
      if (brightTimer) clearTimeout(brightTimer);
      brightTimer = setTimeout(function () { brightTimer = 0; saveReaderDefaults(); }, 400);   // 拖动时防抖，别每像素写一次盘
    };
    box.appendChild(rg); box.appendChild(val);

    // ---- 2.0 施工项 A：画质锐化（SVG 实时，不改原图） ----
    var lbEnh = document.createElement("label"); lbEnh.textContent = "画质锐化（实时滤镜，不动原图）"; box.appendChild(lbEnh);
    var subEnh = document.createElement("div"); subEnh.className = "sub";
    subEnh.textContent = "锐化会放大边缘对比：轻=高清电子版、中=压缩网图、强=扫描糊图。过强会在白底气泡的文字周围出灰边，网点纸会龟裂。";
    box.appendChild(subEnh);
    var swEnh = document.createElement("div"); swEnh.id = "enhswatch"; box.appendChild(swEnh);
    [["off", "关"], ["soft", "轻"], ["medium", "中"], ["strong", "强"]].forEach(function (t) {
      var be = document.createElement("button");
      be.textContent = t[1];
      be.className = (S.enhance === t[0] || (!S.enhance && t[0] === "off")) ? "on" : "";
      be.onclick = function () {
        S.enhance = t[0];
        applyImgFilter(); saveReaderDefaults();
        Array.prototype.forEach.call(swEnh.children, function (x) { x.className = (x === be) ? "on" : ""; });
      };
      swEnh.appendChild(be);
    });

    var lbCt = document.createElement("label"); lbCt.textContent = "对比度"; box.appendChild(lbCt);
    var rgCt = document.createElement("input"); rgCt.type = "range"; rgCt.min = "80"; rgCt.max = "140"; rgCt.step = "1";
    rgCt.value = String(Math.round(((typeof S.contrast === "number") ? S.contrast : 1) * 100));
    var valCt = document.createElement("div"); valCt.className = "stat"; valCt.textContent = rgCt.value + "%";
    var ctTimer = 0;
    rgCt.oninput = function () {
      S.contrast = Number(rgCt.value) / 100; valCt.textContent = rgCt.value + "%";
      applyImgFilter();
      if (ctTimer) clearTimeout(ctTimer);
      ctTimer = setTimeout(function () { ctTimer = 0; saveReaderDefaults(); }, 400);
    };
    box.appendChild(rgCt); box.appendChild(valCt);

    var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
    var done = document.createElement("button"); done.className = "btn"; done.textContent = "完成";
    done.onclick = closeModal; foot.appendChild(done);
  });
}
export function nextPage() {
  var n = pages().length;
  if (S.mode === "scroll") {
    var imgs = elStage.querySelectorAll(".scrollimg");
    if (S.prevRev) { if (S.pi - 1 >= 0) imgs[S.pi - 1].scrollIntoView({ behavior: "smooth", block: "start" }); else nextChapter(); return; }
    if (S.pi + 1 < imgs.length) imgs[S.pi + 1].scrollIntoView({ behavior: "smooth", block: "start" }); else nextChapter();
    return;
  }
  // 横向条带：按键走"一页"，到头直接进下一话（和滚轮一致）
  if (S.mode === "hscroll" || S.mode === "hspread") {
    if (stripJump(1)) { preloadNextChapter(); setTimeout(checkChBreak, 90); return; }
    if (elStage.querySelector(".chbreak")) {                  // 末尾有中割：逐页对齐预接页，走到头就转正/进下一话
      var nx3 = nextExtraCenterX();
      if (nx3 != null) { animateScrollX(nx3); setTimeout(checkChBreak, 90); return; }
      if (maybePromoteNext()) { resetChPreload(); try { renderChapters(); } catch (e) {} return; }
      resetChPreload(); nextChapter(); return;
    }
    resetChPreload(); nextChapter();
    return;
  }
  if (S.mode === "double" && !S.prevRev) { var sp = spreads(), k = spreadIndex(S.pi); if (k + 1 < sp.length) { S.pi = sp[k + 1][0]; render(); } else nextChapter(); return; }
  if (S.prevRev) { if (S.pi - 1 >= 0) { S.pi--; render(); } else nextChapter(); return; }   // 倒序: 往后翻 = 页码减小(到第一页再往后=下一话)
  if (S.pi + 1 < n) { S.pi++; render(); } else nextChapter();
}
export function prevPage() {
  var n = pages().length;
  if (S.mode === "scroll") {
    var imgs = elStage.querySelectorAll(".scrollimg");
    if (S.prevRev) { if (S.pi + 1 < imgs.length) imgs[S.pi + 1].scrollIntoView({ behavior: "smooth", block: "start" }); else prevChapter(true); return; }
    if (S.pi - 1 >= 0) imgs[S.pi - 1].scrollIntoView({ behavior: "smooth", block: "start" }); else prevChapter(true);
    return;
  }
  if (S.mode === "hscroll" || S.mode === "hspread") {
    if (!stripJump(-1)) { resetChPreload(); prevChapter(true); }
    return;
  }
  if (S.mode === "double" && !S.prevRev) { var sp = spreads(), k = spreadIndex(S.pi); if (k - 1 >= 0) { S.pi = sp[k - 1][0]; render(); } else prevChapter(true); return; }
  if (S.prevRev) { if (S.pi + 1 < n) { S.pi++; render(); } else prevChapter(true); return; }   // 倒序: 往回看 = 页码增大(到最后一页再往回=上一话)
  if (S.pi - 1 >= 0) { S.pi--; render(); } else prevChapter(true);
}
export function nextChapter() {
  if (!comic) return;
  var nx = chStep(1);
  if (nx >= 0) { S.ci = nx; S.pi = 0; render(); renderChapters(); hint(chLabel(cur())); }
  else hint(S.rev ? ("已经是最早的那一" + (comic && isBigPlat(comic.dir) ? "篇了" : "话了")) : ((comic && isBigPlat(comic.dir)) ? "已经是最后一篇了" : "已经是最后一话了"));
}
export function prevChapter(atEnd) {
  if (!comic) return;
  var pv = chStep(-1);
  if (pv >= 0) {
    S.ci = pv;
    var n = nOf(comic.chapters[S.ci]);
    S.pi = atEnd ? Math.max(0, n - 1) : 0;
    render(); renderChapters(); hint(chLabel(cur()));
  } else hint(S.rev ? ("已经是最新的一" + (comic && isBigPlat(comic.dir) ? "篇了" : "话了")) : ((comic && isBigPlat(comic.dir)) ? "已经是第一篇了" : "已经是第一话了"));
}

// ---- 由 core 注入 ----
let BG_PARALLAX, THEMES, elStage;

/* ---------- 横向模式的滚轮：连续滚动 ----------
   横排要的是"像长条一样一路划过去"，不是一页一格的分页器：
   deltaY 直接换成 scrollLeft 位移，不累积、不加冷却、不吸附。
   倍率 2.0 是因为鼠标一格只有 120px，而一页宽 500~800px，1:1 会慢得像卡住。
   触控板本来就有 deltaX，直通不拦。
   passive 必须显式 false，否则 preventDefault 无效（Chromium 对 wheel 默认 passive）。 */
const H_WHEEL_GAIN = 2.0;
let hWheelBound = false;

/* ---------- 章节中割 ----------
   横排把"下一话的开头"直接接在本话后面，中间插一条显示章节号的竖条。
   滚过这条竖条 = 换话（此时用户已经在看下一话的图了，切过去不会跳内容）。
   这样一话读完是"顺下去"，不是"卡在末尾再点一下"。 */
let chBreakLock = 0;
const CH_STEP = 8;          // 每话预接 8 页（第 4 页前后都要有内容）
const CH_LAND_PAGE = 3;     // 转正落点：第 4 页（0 基）
const CH_KEEP_PREV = 3;     // 转正后保留上一话最后 3 页

function makeChapterBreak(idx) {
  var mk = document.createElement("div");
  mk.className = "chbreak";
  var arrow = document.createElement("span"); arrow.className = "cbt"; arrow.textContent = "▸";
  var name = document.createElement("span"); name.className = "cbn";
  try { name.textContent = chLabel(comic.chapters[idx]) || ("第 " + (idx + 1) + " 话"); } catch (e) { name.textContent = "下一话"; }
  mk.appendChild(arrow); mk.appendChild(name);
  return mk;
}

function appendNextChapterStrip(container) {
  if (!comic) return null;
  var chain = [];
  var cur = S.ci;
  var step = S.rev ? -1 : 1;
  var total = (comic.chapters || []).length;

  // 最多往后接 3 个章节：不足 4 页的短章节（番外/特典）也接上，继续找够 4 页的当落点
  for (var guard = 0; guard < 3; guard++) {
    var nx = cur + step;
    if (nx < 0 || nx >= total) break;
    var list = pageList(comic, comic.chapters[nx]) || [];
    if (!list.length) break;

    var mk = makeChapterBreak(nx);
    container.appendChild(mk);

    var n = Math.min(CH_STEP, list.length);
    var pages = [];
    for (var i = 0; i < n; i++) {
      var im = document.createElement("img");
      im.className = "pageimg hstripimg extra";
      im.setAttribute("data-x", String(i));
      im.setAttribute("data-ch", String(nx));
      im.loading = i < 4 ? "eager" : "lazy";
      im.decoding = "async";
      im.src = enc(list[i]);
      container.appendChild(im);
      pages.push(im);
    }
    chain.push({ idx: nx, count: list.length, marker: mk, pages: pages });

    if (list.length > CH_LAND_PAGE) break;   // 这一话有第 4 页 → 它就是落点，不再往后接
    cur = nx;                                // 否则继续接下一话
  }
  return chain.length ? { chain: chain } : null;
}
try { window.__stripAppendNext = appendNextChapterStrip; } catch (e) {}

/* 转正后补齐这一话剩下的页：预接只有 8 页，31 页的话后面 23 页得补上，不然滚到第 9 页就断了 */
function fillRestPages(container, chIdx, fromIdx) {
  if (!comic) return 0;
  var list = pageList(comic, comic.chapters[chIdx]) || [];
  var n = 0;
  for (var i = fromIdx; i < list.length; i++) {
    var im = document.createElement("img");
    im.className = "pageimg hstripimg";
    im.setAttribute("data-i", String(i));
    im.loading = "lazy";
    im.decoding = "async";
    im.src = enc(list[i]);
    container.appendChild(im);
    n++;
  }
  return n;
}
try { window.__stripFillRest = fillRestPages; } catch (e) {}

/* 中割区（预接页）也要逐页对齐：找"中心在当前视口中心右侧最近的 extra 页"，
   返回让那一页居中的 scrollLeft；没有就返回 null。
   不这么做的话，中割条那 150px 会让预接页停在半页上，看起来就是"没居中"。 */
function nextExtraCenterX() {
  var st = elStage.getBoundingClientRect();
  var cx = st.left + st.width / 2;
  var ims = elStage.querySelectorAll(".hstripimg.extra");
  var best = null, bestD = 1e9;
  for (var i = 0; i < ims.length; i++) {
    var a = ims[i].getBoundingClientRect();
    if (!a.width) continue;
    var c = a.left + a.width / 2;
    // 至少要"再往前半页"才算下一页 —— 否则当前居中那页会被当成最近目标，
    // 结果就是滚一格原地不动、再滚一格才跳（用户感觉"滚了没反应"）
    if (c <= cx + a.width * 0.5) continue;
    var d = c - cx;
    if (d < bestD) { bestD = d; best = a; }
  }
  if (!best) return null;
  return elStage.scrollLeft + Math.round((best.left + best.width / 2) - cx);
}

/* 中割什么时候算"过去"：交给 render.js 的 maybePromoteNext 判定 ——
   条件是「落点章节的第 4 页跑到视口中线上」，防重复与冷却也在那边。 */
function checkChBreak() {
  if (S.mode !== "hscroll" && S.mode !== "hspread") return;
  if (maybePromoteNext()) { resetChPreload(); try { renderChapters(); } catch (e) {} }
}

/* 预加载下一话的前几页：横排能一路滚进下一话，先把头几页解码好，切过去就是顺的。
   每话只预取一次（preloadedCh 记着），切话/换章时清掉。 */
let preloadedCh = -1;
export function resetChPreload() { preloadedCh = -1; }
function preloadNextChapter() {
  if (!comic) return;
  var nx = chStep(1);
  if (nx < 0) return;
  if (nx === preloadedCh) return;
  preloadedCh = nx;
  var list = pageList(comic, comic.chapters[nx]) || [];
  var n = Math.min(3, list.length);
  for (var i = 0; i < n; i++) {
    try { var im = new Image(); im.decoding = "async"; im.src = enc(list[i]); } catch (e) {}
  }
}

/* ---------- 横向滚轮：一格翻一页，而且是"滚过去"（动画），不是瞬移 ----------
   为什么不用 1:1 连续 + 事后吸附：那套用户实测"拉扯感又回来了"——
   吸附是第二段运动，方向和滚轮相反时最难受。这里一格直接滚到下一页中心，一次运动到位。 */
let hWheelAcc = 0;
let hWheelAt = 0;

function bindHScrollWheel() {
  if (hWheelBound || !elStage) return;
  hWheelBound = true;
  elStage.addEventListener("wheel", function (e) {
    if (S.zoom) return;                                    // 放大态交还原生
    if (S.mode !== "hscroll" && S.mode !== "hspread") return;
    if (!S.wheel) return;                                  // 关掉"滚轮翻页"就直通
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;    // 触控板横滑直通
    e.preventDefault();
    var dy = (e.deltaMode === 1) ? e.deltaY * 16 : e.deltaY;   // 行滚动单位换算成像素
    hWheelAcc += dy;
    if (Math.abs(hWheelAcc) < 55) return;                     // 触控板小步也累积到能翻一页
    var dStep = hWheelAcc > 0 ? 1 : -1;
    hWheelAcc = 0;
    var nowW = Date.now();
    if (nowW - hWheelAt < 50) return;                         // 冷却 50ms：连滚更跟手
    hWheelAt = nowW;
    if (stripJump(dStep)) {
      preloadNextChapter();                                   // 顺手把下一话头几页解码好
      setTimeout(checkChBreak, 90);                           // 滚完这一格立刻判一次：到第 4 页就当场转正
      return;
    }
    // 到头了。如果末尾有中割（= 已经预渲染了下一话开头），就继续让画面往前滑，
    // 转正交给 checkChBreak —— 这样是"顺下去"，不是重建画布后跳过去。
    if (dStep > 0 && elStage.querySelector(".chbreak")) {
      var nx2 = nextExtraCenterX();
      if (nx2 != null) { animateScrollX(nx2); setTimeout(checkChBreak, 90); return; }
      // 预接页已经走到最后一个：先试着转正，转不了就直接进下一话（绝不卡在最右端）
      if (maybePromoteNext()) { resetChPreload(); try { renderChapters(); } catch (e) {} return; }
      resetChPreload(); nextChapter(); return;
    }
    resetChPreload();
    if (dStep > 0) nextChapter(); else prevChapter(true);
  }, { passive: false });

  // 滚动停下后看一眼中割有没有被滚过去（用 scroll 而不是 IO：中割不是 img）
  let chCheckTimer = 0;
  elStage.addEventListener("scroll", function () {
    if (S.mode !== "hscroll" && S.mode !== "hspread") return;
    if (chCheckTimer) clearTimeout(chCheckTimer);
    chCheckTimer = setTimeout(function () { chCheckTimer = 0; checkChBreak(); }, 50);
  }, { passive: true });
}

export function initReaderNav(ctx) {
  BG_PARALLAX = ctx.BG_PARALLAX; THEMES = ctx.THEMES; elStage = ctx.elStage;
  bindHScrollWheel();
}
