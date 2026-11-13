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
import { makeImg, syncThumbsActive, spreads, spreadIndex, preload, preloadAround, syncSideHandles, scrollThumbToCenter, applyImgFilter } from '../reader/view.js';
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
export function scrollToPage(i, axis) {
  axis = axis || "y";
  if (!comic) return;
  bindRestoreGuards();
  var tok = ++scrollRestoreTok;
  scrollRestorePage = i;
  var aligned = function () {                       // 目标页边与视口边差多少(px)
    var im = elStage.querySelector((axis === "x" ? ".hstripimg" : ".scrollimg") + '[data-i="' + i + '"]');
    if (!im) return null;
    var a = im.getBoundingClientRect(), b = elStage.getBoundingClientRect();
    // 横向按"居中"对齐：一页刚好占满屏时贴左会左右不均，且跳页后观感不自然
    if (axis === "x") return Math.round((a.left + a.width / 2) - (b.left + b.width / 2));
    return Math.round(a.top - b.top);
  };
  var align = function () {
    if (tok !== scrollRestoreTok || scrollRestorePage < 0) return;
    var d = aligned();
    if (d === null || Math.abs(d) < 2) return;
    if (axis === "x") elStage.scrollLeft = Math.round(elStage.scrollLeft + d);
    else elStage.scrollTop = Math.round(elStage.scrollTop + d);
  };
  // 目标页之前的页图必须真的有尺寸, 否则位置算不准 -> 强制 eager, 并逐张挂 load/error 再对齐
  var imgSel = axis === "x" ? ".hstripimg" : ".scrollimg";
  var imgs = elCanvas ? elCanvas.querySelectorAll(imgSel) : [];
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
// 条带渲染器：axis="y" 纵向（长条，原 renderScroll）/ axis="x" 横向（hscroll / hspread）
// 纵向与横向共用同一套「按页记进度 + 粘住式恢复」，差别只有滚动轴与分组方式。
function stripGroups(n) {
  if (S.mode !== "hspread") { var a = []; for (var i = 0; i < n; i++) a.push([i]); return a; }
  return spreads();          // 两页一组；封面的单页逻辑已经在 spreads() 里
}
export function renderStrip(axis) {
  var p = pages();
  var target = Math.max(0, Math.min(S.pi, Math.max(0, p.length - 1)));
  var gs = stripGroups(p.length);
  var cls = axis === "x" ? "hstripimg" : "scrollimg";
  for (var g = 0; g < gs.length; g++) {
    var grp = gs[g];
    var w = document.createElement("div");
    w.className = "pagewrap " + (axis === "x" ? "hwrap" : "scwrap") + (grp.length > 1 ? " dual" : "");
    for (var k = 0; k < grp.length; k++) {
      var i2 = grp[k];
      var im = makeImg(p[i2], "pageimg " + cls);
      im.setAttribute("data-i", String(i2));
      // 目标页之前的页图必须真加载: 它们是顺序流, 尺寸决定目标页的坐标(纵向 y / 横向 x)
      im.loading = i2 <= target ? "eager" : "lazy";
      w.appendChild(im);
    }
    elCanvas.appendChild(w);
  }
  if (io) { io.disconnect(); setIo(null); }
  // 章节中割：横排时由 nav 追加"下一话"的开头几页（含章节号竖条），让两话首尾相接
  pendingNext = null;
  if (axis === "x" && typeof window.__stripAppendNext === "function") {
    try {
      var nx = window.__stripAppendNext(elCanvas);
      if (nx && nx.chain && nx.chain.length) pendingNext = nx;   // 存整条链（可能含短章节）
    } catch (e) {}
  }
  var imgs = elStage.querySelectorAll("." + cls + ":not(.extra)");
  var th = axis === "x" ? [0.4, 0.6, 0.85] : [0.1, 0.5, 0.9];
  // 进度判定：取"中心离视口中心最近"的那一张。
  // 不能用 intersectionRatio —— 一屏放得下两页时两张都是 100%，
  // 谁先出结果谁赢，页码就会在两页之间乱跳（横向"一格翻两页"的元凶之一）。
  setIo(new IntersectionObserver(function () {
    // 恢复/程序跳页期间不接管 —— 否则会把"正在滚过去的中间页"记成当前页
    if (scrollRestorePage >= 0) return;
    if (pickTimer) clearTimeout(pickTimer);
    pickTimer = setTimeout(function () { pickTimer = 0; applyPickX(axis); }, 90);
  }, { threshold: th }));
  for (var j = 0; j < imgs.length; j++) io.observe(imgs[j]);
  if (axis === "x") {
    // 先用"平均组宽 × 页序"估个位（wrap 有 min-width 占位，未解码时 scrollWidth 也是准的），
    // 再交给 alignToPageX 精修。只靠 rect 精修的话，图没解码前 rect 全 0，会一直落回第 1 页。
    void elStage.offsetWidth;                                  // 强制布局，让占位宽生效
    var avgW = (elStage.scrollWidth || 0) / Math.max(1, p.length);
    if (avgW > 20 && target > 0) elStage.scrollLeft = Math.round(avgW * target);
    alignToPageX(target);
  } else scrollToPage(target, axis);        // 纵向：沿用原来的"粘住式恢复"
}

/* ---------- 章节中割的"就地转正" ----------
   越过中割时**不重建画布**（重建会跳回第 1 页 + 白闪一帧）。
   做法是把已经渲染好的"下一话前 6 页"直接转正：
     改状态 → 删掉本话的页和中割 → extra 去掉 extra 标记并补 data-i
     → 把 scrollLeft 减去被删掉的宽度（视觉位置纹丝不动）→ 再挂上新的中割。
   整个过程没有任何元素被重建，所以没有闪跳。 */
let pickTimer = 0;
let pickLockUntil = 0;     // 转正后短暂冻结自动取页，避免把 S.pi 抢成上一话的残余页
function applyPickX(axis) {
  if (Date.now() < pickLockUntil) return;
  var imgsNow = elStage.querySelectorAll(".hstripimg:not(.extra), .scrollimg");
  if (!imgsNow.length) return;
  // 两端特殊：第一页/最后一页无法居中（边上没有内容可露），
  // 滚到最左就是第 1 页、滚到最右就是最后一页 —— 否则 Home/End 之后页码会被"更居中的邻居"顶掉。
  if (axis === "x") {
    var maxSl = elStage.scrollWidth - elStage.clientWidth;
    if (elStage.scrollLeft <= 2) {
      if (S.pi !== 0) { S.pi = 0; updateInfo(); syncThumbsActive(); save(); }
      return;
    }
    if (maxSl > 0 && elStage.scrollLeft >= maxSl - 2) {
      var lastI = -1;
      for (var q2 = 0; q2 < imgsNow.length; q2++) {
        var v2 = parseInt(imgsNow[q2].getAttribute("data-i"), 10);
        if (isFinite(v2) && v2 > lastI) lastI = v2;
      }
      if (lastI >= 0 && S.pi !== lastI) { S.pi = lastI; updateInfo(); syncThumbsActive(); save(); }
      return;
    }
  }
  var st = elStage.getBoundingClientRect();
  var cx = st.left + st.width / 2, cy = st.top + st.height / 2;
  var pick = S.pi, bestD = 1e9;
  for (var q = 0; q < imgsNow.length; q++) {
    var r3 = imgsNow[q].getBoundingClientRect();
    if (!r3.width && !r3.height) continue;
    var d3 = Math.abs(axis === "x" ? (r3.left + r3.width / 2 - cx) : (r3.top + r3.height / 2 - cy));
    if (d3 < bestD) { bestD = d3; pick = parseInt(imgsNow[q].getAttribute("data-i"), 10); }
  }
  if (pick === S.pi || !isFinite(pick)) return;
  S.pi = pick; updateInfo(); syncThumbsActive(); save();
}

const CH_KEEP_PREV = 3;    // 转正后保留上一话最后 3 页（可往回滚对照中割）
let promoteLock = 0;
let pendingNext = null;

/* 找落点章节：第一个「有第 4 页」的；都不够就退到链条最后一个 */
function pickLanding(chain) {
  var target = null;
  for (var i = 0; i < chain.length; i++) { if (chain[i].count > 3) { target = chain[i]; break; } }
  if (!target) target = chain[chain.length - 1];
  var pageIdx = Math.min(3, Math.max(0, (target && target.count ? target.count : 1) - 1));
  return { target: target, pageIdx: pageIdx };
}

/* 转正时机：落点章节的**第 4 页**跑到视口中线上就算越过。
   比「中割过中线就切」更靠后：前几页留给用户看清这是下一话开头，也给解码留静止时间。 */
export function maybePromoteNext() {
  if (!pendingNext || !pendingNext.chain || !pendingNext.chain.length) return false;
  if (S.mode !== "hscroll" && S.mode !== "hspread") return false;
  if (Date.now() < promoteLock) return false;
  var land = pickLanding(pendingNext.chain);
  var tp = land.target && land.target.pages ? land.target.pages[land.pageIdx] : null;
  if (!tp) return false;
  var st = elStage.getBoundingClientRect(), a = tp.getBoundingClientRect();
  if (!a.width) return false;
  // 提前一点触发：第 4 页中心进入中线右侧 120px 内就算"到了"。
  // 等它真的越过中线，滚轮动画早就跑到第 5 页了 —— 那时候再转正就会把画面拽回去一页。
  if ((a.left + a.width / 2) > (st.left + st.width / 2 + 120)) return false;
  var ok = promoteNextChapter();
  promoteLock = Date.now() + (ok ? 1500 : 300);   // 成功锁久一点；失败 300ms 后允许再试
  return ok;
}

export function promoteNextChapter() {
  if (!pendingNext || !pendingNext.chain || !pendingNext.chain.length) return false;
  if (S.mode !== "hscroll" && S.mode !== "hspread") return false;

  var land = pickLanding(pendingNext.chain);
  var target = land.target, pageIdx = land.pageIdx;
  if (!target || !target.pages.length) return false;

  // 落点 = max(第 4 页, 当前视口中心所在的那一页)。
  // 慢滚时中心就在第 4 页，落点=4（满足"落在第 4 页"）；
  // 快速连滚时中心已经到第 6、7 页，就跟着它走，绝不把人往回拽。
  try {
    var stC = elStage.getBoundingClientRect(), cxC = stC.left + stC.width / 2;
    var cIdx = pageIdx, cBest = 1e9;
    for (var ci2 = 0; ci2 < target.pages.length; ci2++) {
      var ap2 = target.pages[ci2].getBoundingClientRect();
      if (!ap2.width) continue;
      var dd2 = Math.abs((ap2.left + ap2.width / 2) - cxC);
      if (dd2 < cBest) { cBest = dd2; cIdx = ci2; }
    }
    if (cIdx > pageIdx) pageIdx = cIdx;
  } catch (e) {}
  var anchor = target.pages[pageIdx] || target.pages[0];   // 用落点页当锚点：它必须待在原地

  var kids = Array.prototype.slice.call(elCanvas.children);
  var mkIdx = kids.indexOf(target.marker);
  if (mkIdx < 0) return false;

  // 本话页的下标（要保留最后 3 页）
  var curIdx = [];
  for (var q = 0; q < mkIdx; q++) {
    var el2 = kids[q];
    if (el2.classList && el2.classList.contains("pageimg") && !el2.classList.contains("extra")) curIdx.push(q);
  }
  var keepFrom = curIdx.length > CH_KEEP_PREV ? curIdx[curIdx.length - CH_KEEP_PREV] : (curIdx.length ? curIdx[0] : mkIdx);

  // 删除前先记下锚点在屏幕上的位置 —— 之后用它的位移补偿 scrollLeft（比累加宽度准）
  var leftBefore = anchor.getBoundingClientRect().left;

  var toRemove = [];
  for (var r = 0; r < mkIdx; r++) {
    if (curIdx.indexOf(r) >= 0 && r >= keepFrom) {
      // 保留的上一话页**必须摘掉 data-i**。
      // 它们的编号（比如 5/6/7）会和新话的页重复，翻页时
      // querySelector('.hstripimg[data-i="5"]') 会命中左边这些残留页，
      // 算出来一个巨大的负位移 —— 画面就一头扎回前面（用户看到的"突然往回滚"）。
      var ke = kids[r];
      try { ke.classList.add("prevch"); ke.removeAttribute("data-i"); } catch (e) {}
      continue;
    }
    toRemove.push(kids[r]);
  }
  for (var t = 0; t < toRemove.length; t++) { try { toRemove[t].remove(); } catch (e) {} }
  try { target.marker.remove(); } catch (e) {}

  // 转正：目标章节的预接页去掉 extra，重编 data-i
  S.ci = target.idx;
  for (var m = 0; m < target.pages.length; m++) {
    target.pages[m].classList.remove("extra");
    target.pages[m].setAttribute("data-i", String(m));
  }

  // 链条里更靠后的内容（后续章节的页与中割）全部清掉，等会儿重新接
  var after = Array.prototype.slice.call(elCanvas.children);
  var lastPageEl = target.pages[target.pages.length - 1];
  var from = after.indexOf(lastPageEl);
  for (var z = from + 1; z < after.length; z++) { try { after[z].remove(); } catch (e) {} }

  // 位置补偿：锚点删除前后的屏幕位移，直接加到 scrollLeft
  var leftAfter = anchor.getBoundingClientRect().left;
  var shift = Math.round(leftAfter - leftBefore);
  if (shift) elStage.scrollLeft += shift;

  // 不再强制把第 4 页拉到正中：那会变成"往后拽一页"。
  // 只要锚点补偿到位，画面就停在用户正在看的位置，页码直接写第 4 页。
  // 只有偏差大到半页以上（说明状态异常）才纠一次。
  var tp = target.pages[pageIdx] || target.pages[0];
  var sta = elStage.getBoundingClientRect();
  var aa = tp.getBoundingClientRect();
  var dd = Math.round((aa.left + aa.width / 2) - (sta.left + sta.width / 2));
  if (Math.abs(dd) > Math.max(300, Math.round(aa.width * 0.6))) elStage.scrollLeft += dd;
  S.pi = pageIdx;
  pickLockUntil = Date.now() + 1000;   // 这一秒内别让 IO 改页码

  // 补齐这一话剩下的页（预接只有 8 页，长章节后面还有几十页）
  if (typeof window.__stripFillRest === "function") {
    try { window.__stripFillRest(elCanvas, target.idx, target.pages.length); } catch (e) {}
  }

  // 观察器重挂到转正后的页上
  if (io) { try { io.disconnect(); } catch (e) {} setIo(null); }
  var nowImgs = elStage.querySelectorAll(".hstripimg:not(.extra)");
  setIo(new IntersectionObserver(function () {
    if (scrollRestorePage >= 0) return;
    if (pickTimer) clearTimeout(pickTimer);
    pickTimer = setTimeout(function () { pickTimer = 0; applyPickX("x"); }, 90);
  }, { threshold: [0.4, 0.6, 0.85] }));
  for (var n2 = 0; n2 < nowImgs.length; n2++) io.observe(nowImgs[n2]);

  // 接上新的中割链（下一话 + 必要时再接一话）
  pendingNext = null;
  if (typeof window.__stripAppendNext === "function") {
    try { var nn = window.__stripAppendNext(elCanvas); if (nn && nn.chain) pendingNext = nn; } catch (e) {}
  }

  updateInfo();
  // 右侧缩略图必须重建：applyThumbs 只在 render() 里调用，而转正不走 render，
  // 不重建的话缩略图会一直停在上一次渲染的那一话（甚至更早）。
  try { applyThumbs(); } catch (e) {}
  syncThumbsActive(); save();
  return true;
}

/* 横向切模式/打开书时的一次性归位。
   为什么不用 scrollToPage：它靠 scrollRestoreTok + 8 秒 settle 那套，横向切过来时
   新图的 rect 还没解码（宽高为 0），算出来的差值把视口推到 0，而令牌随后又被别处清掉，
   就再也不修正了 —— 表现是"切到横排总是落在第 1 页"。
   这里改成自管 2 秒的短轮询：图一解码就对齐，用户一动就撒手。 */
let alignTokX = 0;
let alignGuardBound = false;
function bindAlignGuard() {
  if (alignGuardBound) return;
  alignGuardBound = true;
  var stop = function () { alignTokX++; };
  ["wheel", "pointerdown", "touchstart", "keydown"].forEach(function (t) {
    try { window.addEventListener(t, stop, { passive: true, capture: true }); } catch (e) {}
  });
}
function alignToPageX(i) {
  bindAlignGuard();
  var tok = ++alignTokX;
  var tries = 0;
  var tick = function () {
    if (tok !== alignTokX) return;                    // 用户动手了 / 又切了模式
    var el = elStage.querySelector('.hstripimg[data-i="' + i + '"]');
    if (el) {
      var st = elStage.getBoundingClientRect(), a = el.getBoundingClientRect();
      if (a.width > 0) {
        var d = Math.round((a.left + a.width / 2) - (st.left + st.width / 2));
        if (Math.abs(d) >= 2) elStage.scrollLeft += d;
        else return;                                   // 到位
      }
    }
    if (++tries > 40) return;                          // 最多 ~2 秒
    setTimeout(tick, 50);
  };
  tick();
}
export function renderScroll() { renderStrip("y"); }
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
/* ---------- 横向条带的翻页 ----------
   横向模式**不能**用"滚 0.9 屏宽"那种像素步进：一页图比屏幕略窄时，
   一次就会跨过整页（第 1 页直接落到第 3 页），进度和眼睛对不上。
   这里改成"按页 / 按组跳"，跳完把目标页居中吸附 —— 进度与视觉必然一致。 */
/* 横向条带的平滑滚动：指数缓动逼近目标 x。
   目标可被后续调用改写（连续滚轮 = 不断追加剧程），所以不会出现"返工"的抖动。 */
export function animateScrollX(x) {
  var maxX = Math.max(0, elStage.scrollWidth - elStage.clientWidth);
  var t = Math.max(0, Math.min(maxX, Math.round(x)));
  try { elStage.scrollTo({ left: t, behavior: "smooth" }); }
  catch (e) { elStage.scrollLeft = t; }
}

/* 直接定位到某一页（横排用）：不重建画布，只滚过去。
   Home/End 走这里 —— 原来的 S.pi=0 + render() 会把整条画布重建一遍，横排下会闪，
   而且会丢掉"保留上一话最后 3 页"的状态。 */
export function stripSeek(idx) {
  if (S.mode !== "hscroll" && S.mode !== "hspread") return false;
  var p = pages();
  if (!p.length) return false;
  var next = Math.max(0, Math.min(p.length - 1, idx | 0));
  var el = elStage.querySelector('.hstripimg[data-i="' + next + '"]');
  if (!el) return false;
  var st = elStage.getBoundingClientRect(), a = el.getBoundingClientRect();
  if (next === 0) elStage.scrollLeft = 0;                                    // 首页贴左（瞬时，平滑途中会被判成第 2 页）
  else if (next === p.length - 1) elStage.scrollLeft = elStage.scrollWidth;  // 末页贴右
  else animateScrollX(elStage.scrollLeft + Math.round((a.left + a.width / 2) - (st.left + st.width / 2)));
  S.pi = next;
  pickLockUntil = Date.now() + 600;
  updateInfo(); syncThumbsActive(); save();
  return true;
}

export function stripJump(delta) {
  if (S.mode !== "hscroll" && S.mode !== "hspread") return false;
  var p = pages();
  if (!p.length) return false;
  var imgs = elStage.querySelectorAll(".hstripimg");
  if (!imgs.length) return false;

  // 基线用 S.pi（= 工具栏上那个页码）。之前试过"取视觉最居中那张"，
  // 在动画/布局未定时会算偏一格，表现是"按一下前进两页"——页码和眼睛一致才最不容易出错。
  var cur = S.pi;
  var next = Math.max(0, Math.min(p.length - 1, cur + delta));
  if (next === cur) return false;       // 已经在头 / 尾
  var st = elStage.getBoundingClientRect();
  var cx = st.left + st.width / 2;

  // **动画**滚到下一页中心，不是瞬移：瞬移 + 事后吸附会有"先滑过头再被拽回来"的拉扯感。
  // 这里把目标位置交给 rAF 缓动，运动本身就是"滚过去"，而且后续调用可以直接改写目标。
  var el = elStage.querySelector('.hstripimg[data-i="' + next + '"]');
  if (el) {
    var a = el.getBoundingClientRect();
    animateScrollX(elStage.scrollLeft + Math.round((a.left + a.width / 2) - cx));
  }
  S.pi = next;
  pickLockUntil = Date.now() + 450;   // 动画期间别让 IO 把页码抢回原页（往回翻时最明显）
  updateInfo(); syncThumbsActive(); save();
  return true;
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
  if (S.mode === "scroll") renderScroll();
  else if (S.mode === "hscroll" || S.mode === "hspread") renderStrip("x");
  else renderPaged();
  preloadAround();
  applyThumbs();
  if (S.zoom) { applyZoom(S.zscale || 1); centerCanvas(); }   // 同步执行: 后台标签页里 rAF 会被节流, 不能依赖
  bmSync();
  applyImgFilter();   // 偏好/主题变了要重算 --r-img-filter
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
  var bh = document.getElementById("m-hscroll"); if (bh) bh.classList.toggle("on", S.mode === "hscroll");
  var bp3 = document.getElementById("m-hspread"); if (bp3) bp3.classList.toggle("on", S.mode === "hspread");
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
