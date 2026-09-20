// 阅读器的打开 / 关闭 / 跳转: openComic closeComic 飞入飞出 书签跳转 详情与删除
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 阅读器域第 4 批)。
// 这一批把两个"在 core 里被赋值"的状态簇一起带走了, 所以依赖很干净:
//   · lastVT / VT_ON / vtBusy —— 视图过渡节流(只有 vtWrap + open/closeComic 用)
//   · bmJump / bmDir / bmAt —— 书签跳转期间不写进度(只有 openByDir + save 用)
//   两者的所有读写点都在本批内, 所以整簇归本模块, 不需要给 core setter。
//
// 注意 vtWrap 这种"工具 + 私有状态"一起搬的做法: 状态和用它的函数同属一个模块时
// 才成立; 一旦有 core 里的函数读它, 就必须改成 core import 实时绑定。

import { S } from '../app/state.js';
import { setProg, meta, setMeta, prog, isBigPlat, manifestOf, totalPages } from '../library/store.js';
import { renderChapters } from '../reader/panel.js';
import { render, applyThumbs } from '../reader/render.js';
import { NAVFWD, comic, setComic, io, setIo } from '../reader/state.js';
import { SET } from '../settings/panel.js';
import { imgFile, nOf, chLabel, pageList } from '../shared/chapter.js';
import { enc } from '../shared/text.js';
import { hint } from '../shared/ui.js';
import { resetReaderFullscreen } from '../reader/fullscreen.js';
import { card } from '../shelf/render.js';

// ---- 本模块持有的状态(所有读写点都在本模块内) ----
let lastVT = 0, VT_ON = true, vtBusy = false;   // 视图过渡节流: 连打时跳过 / 上一个还没跑完就直改
let bmJump = false, bmDir = null, bmAt = null;  // 书签跳转: 跳转期间及停留期间都不写进度

function focusOpenedPage(pi) {
  requestAnimationFrame(function () {
    var stage = document.getElementById("stage");
    if (!stage) return;
    if (S.mode === "scroll") {
      var im = stage.querySelector('.scrollimg[data-i="' + pi + '"]');
      if (!im) return;
      var go = function () {
        var w = im.closest(".pagewrap") || im;
        w.scrollIntoView({ block: "start" });
      };
      if (im.complete) go();
      else {
        im.addEventListener("load", go, { once: true });
        im.addEventListener("error", go, { once: true });
      }
    } else {
      stage.scrollTo({ left: 0, top: 0 });
    }
  });
}

export function vtWrap(fn) {
  try {
    if (!VT_ON || !document.startViewTransition) { fn(); return; }
    var now = Date.now();
    if (now - lastVT < 140) { fn(); return; }   // 连打(比如快速输入搜索)时跳过, 免得抖
    if (vtBusy) { fn(); return; }               // 上一个过渡还在跑: 这次直接改, 免得它被"跳过"
    lastVT = now;
    var vt = document.startViewTransition(fn);
    vtBusy = true;
    // 过渡被跳过时 ready/finished 会以 AbortError reject; 不接住就成了未处理拒绝(控制台偶发报错)
    vt.ready.catch(function () {});
    var vtDone = function () { vtBusy = false; };
    vt.finished.then(vtDone, vtDone);
  } catch (e) { vtBusy = false; try { fn(); } catch (e2) {} }
}
export function openByDir(dir, ci, pi) {
  bmJump = true; bmDir = dir; bmAt = (typeof ci === 'number') ? { ci: ci, pi: pi || 0 } : null;
  for (var i = 0; i < COMICS.length; i++) {
    if (COMICS[i].dir !== dir) continue;
    openComic(COMICS[i]);
    if (typeof ci === 'number') { S.ci = Math.max(0, Math.min(ci, COMICS[i].chapters.length - 1)); S.pi = Math.max(0, pi || 0); }
    renderChapters(); render();
    focusOpenedPage(S.pi);
    bmJump = false;
    return true;
  }
  hint('库里找不到这本书（可能已删除）');
  return false;
}
export function reopenLast() {
  while (NAVFWD.length) {
    var dir = NAVFWD.pop();
    for (var i = 0; i < COMICS.length; i++) {
      if (COMICS[i].dir === dir) { openComic(COMICS[i]); hint("回到：" + (COMICS[i].name || dir)); return true; }
    }
  }
  return false;
}
export function save() {
  if (!comic) return;
  if (bmJump) return;                                                     // 跳转过程本身
  if (bmDir === comic.dir && bmAt && S.ci === bmAt.ci && S.pi === bmAt.pi) return;   // 还停在书签那一页 -> 不动历史
  if (bmDir === comic.dir) { bmDir = null; bmAt = null; }                  // 已翻走 -> 恢复正常记录
  var chNow = comic.chapters[S.ci] || {};
  setProg(comic.dir, { ci: S.ci, pi: S.pi, mode: S.mode, fit: S.fit, dir: S.dir, cover: S.cover, sidebar: S.sidebar, wheel: S.wheel, thumbs: S.thumbs, rev: !!S.rev, prevRev: !!S.prevRev, cpath: chNow.path || "" });
  var m = meta(); m["t::" + comic.dir] = Date.now(); setMeta(m);
}
export async function delImage(idx) {
  if (!comic) return;
  var ch = comic.chapters[S.ci];
  if (!ch) return;
  var f = imgFile(ch, idx);
  if (!f) { hint("找不到这张图的文件名"); return; }
  if (!DISK || !DISK.deleteImage) { hint("删除图片需要桌面版：请用「启动书库.cmd」打开"); return; }
  hint("正在删除…");
  var r = null;
  try { r = await DISK.deleteImage(comic.dir, f); } catch (e) { r = { ok: false, msg: String(e && e.message ? e.message : e) }; }
  if (!r || !r.ok) { hint("删除失败: " + ((r && r.msg) || "未知错误")); return; }
  if (ch.files) ch.files.splice(idx, 1); else ch.n = Math.max(0, (ch.n || 1) - 1);
  if (!nOf(ch)) {                                  // 这一话被删空了, 顺手去掉这一话
    comic.chapters.splice(S.ci, 1);
    S.ci = Math.max(0, Math.min(S.ci, comic.chapters.length - 1));
  }
  S.pi = Math.max(0, Math.min(S.pi, Math.max(0, nOf(comic.chapters[S.ci] || {}) - 1)));
  applyThumbs(); renderChapters(); render();
  hint("已删除这张图" + (r.renamed ? "（剩余图片已重排编号）" : ""));
  if (DISK.rescan) { try { await DISK.rescan({ quiet: true, offline: true }); } catch (e2) {} }
}
export async function delChapter(idx) {
  if (!comic) return;
  var ch = comic.chapters[idx];
  if (!ch) return;
  if (!ch.path) { hint("这一话是书目录里的散图，不能单独删（要么删整本）"); return; }
  if (!DISK || !DISK.deleteChapter) { hint("删除章节需要桌面版：请用「启动书库.cmd」打开"); return; }
  var label = chLabel(ch);
  hint("正在删除…");
  var r = null;
  try { r = await DISK.deleteChapter(comic.dir, ch.path); } catch (e) { r = { ok: false, msg: String(e && e.message ? e.message : e) }; }
  if (!r || !r.ok) { hint("删除失败: " + ((r && r.msg) || "未知错误")); return; }
  comic.chapters.splice(idx, 1);
  if (idx < S.ci) S.ci--;
  if (S.ci >= comic.chapters.length) S.ci = Math.max(0, comic.chapters.length - 1);
  S.pi = 0;
  renderChapters(); render();
  hint("已删除这一话：" + label + (comic.chapters.length ? "" : "（这本书已经没有章节了）"));
  if (DISK.rescan) { try { await DISK.rescan({ quiet: true, offline: true }); } catch (e2) {} }   // 只重建书库.html, 不跳回主页
}
export function flyOpenComic(c, coverImg) {
  if (!SET.flyAnim || !coverImg || !coverImg.getBoundingClientRect) { openComic(c); return; }
  var a = coverImg.getBoundingClientRect();
  if (!a.width || !a.height) { openComic(c); return; }
  var run = function () {
    var fly = document.createElement("img");
    fly.src = coverImg.currentSrc || coverImg.src;
    fly.setAttribute("aria-hidden", "true");
    var ease = "cubic-bezier(.3,.7,.3,1)";
    fly.style.cssText = "position:fixed;left:" + a.left + "px;top:" + a.top + "px;width:" + a.width + "px;height:" + a.height + "px;object-fit:cover;z-index:9999;pointer-events:none;opacity:1;box-shadow:0 18px 60px rgba(0,0,0,.55);transition:left 340ms " + ease + ",top 340ms " + ease + ",width 340ms " + ease + ",height 340ms " + ease + ",opacity 340ms ease-out";
    document.body.appendChild(fly);
    void fly.offsetWidth;   // 强制先算初值, 否则和终止值同帧应用 → 过渡不跑
    openComic(c);           // 阅读器正常渲染, 克隆图在上面飞
    // 落点尺寸要等阅读器把图布局出来(刚渲染那一瞬量到的是 0), 所以轮询等它有宽再设目标
    var tried = 0;
    var aim = function () {
      var dst = document.querySelector("#stage img");
      var b = dst ? dst.getBoundingClientRect() : null;
      if (b && b.width > 1 && b.height > 1) {
        fly.style.left = b.left + "px";
        fly.style.top = b.top + "px";
        fly.style.width = b.width + "px";
        fly.style.height = b.height + "px";
        fly.style.opacity = "0";
        return;
      }
      if (++tried < 40) requestAnimationFrame(aim);
      else fly.style.opacity = "0";   // 实在量不到就只淡出, 不卡住
    };
    requestAnimationFrame(aim);
    setTimeout(function () {
      try { fly.remove(); } catch (e) {}
      // 落地后强制重画一次(提层再撤), 防止留下低分辨率残留
      try {
        var im = document.querySelector("#stage img");
        if (im) { im.style.willChange = "transform"; requestAnimationFrame(function () { try { im.style.willChange = ""; } catch (e2) {} }); }
      } catch (e) {}
    }, 620);
  };
  // 预热"要落下去的那张图"(最多等 220ms), 免得飞过去落在一个还没出图的空框上
  var target = null;
  try { var pl = pageList(c, c.chapters[0]); target = (pl && pl[0]) ? enc(pl[0]) : null; } catch (e) {}
  if (!target) { run(); return; }
  var fired = false, pre = new Image();
  var fire = function () { if (fired) return; fired = true; run(); };
  pre.onload = fire; pre.onerror = fire; pre.src = target;
  setTimeout(fire, 220);
}
export function openComic(c) {
  setComic(c);
  NAVFWD.length = 0;   // 新开一本书, 清掉"前进"记录(和浏览器一致)
  var p = prog(c.dir);
  const mobileTouch = !(window.mangaLib && window.mangaLib.isElectron) && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  S.ci = 0; S.pi = 0; S.mode = "single"; S.fit = "height"; S.dir = "rtl"; S.cover = false; S.sidebar = !mobileTouch; S.thumbs = false; S.wheel = true;
  var bigPlat = isBigPlat(c.dir);      // X/微博/抖音/pixiv: 新书默认"从最新看起"
  S.rev = bigPlat; S.prevRev = bigPlat;
  if (bigPlat && c.chapters.length) S.pi = Math.max(0, nOf(c.chapters[0]) - 1);   // 倒序时从最后一页(最新那张)进
  if (p) {
    S.ci = Math.max(0, Math.min(p.ci || 0, c.chapters.length - 1));
    S.pi = p.pi || 0;
    if (p.mode) S.mode = p.mode;
    if (p.fit) S.fit = p.fit;
    if (p.dir) S.dir = p.dir;
    if (typeof p.cover === "boolean") S.cover = p.cover;
    if (typeof p.sidebar === "boolean") S.sidebar = p.sidebar;
    if (typeof p.thumbs === "boolean") S.thumbs = p.thumbs;
    if (typeof p.wheel === "boolean") S.wheel = p.wheel;
    if (typeof p.rev === "boolean") S.rev = p.rev;
    if (typeof p.prevRev === "boolean") S.prevRev = p.prevRev;
    // 进度按"话 + 页"记的索引, 话删了/重排了会指错: 先用上次那一话的目录名核对一次
    if (p.cpath) {
      for (var qi = 0; qi < c.chapters.length; qi++) {
        if ((c.chapters[qi].path || "") === p.cpath) { S.ci = qi; S.pi = Math.min(p.pi || 0, Math.max(0, nOf(c.chapters[qi]) - 1)); break; }
      }
    }
  }
  elShelf.classList.add("hide");
  elReader.classList.remove("hide");
  elReader.getAnimations().forEach(function(a){a.cancel()});
  if (vtBusy) {
    elReader.style.opacity = "";   // 飞入时交给 View Transition 过渡, 这里再淡入会叠起来、收尾闪一下
  } else {
  elReader.animate([{opacity:0},{opacity:1}],{duration:300,easing:'ease-out',fill:'forwards'}).onfinish = function(){
    elReader.style.opacity = "";
  };
  }
  renderChapters(); render();
  document.title = (c.name || c.dir);
}
export function perfSample() {
  var frames = [], long = [];
  try {
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { long.push(Math.round(e.duration)); }); }).observe({ type: "longtask", buffered: false });
  } catch (e) {}
  var last = performance.now(), stop = false;
  function tick(now) { frames.push(now - last); last = now; if (!stop) requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  hint("性能采样中… 3 秒");
  setTimeout(function () {
    stop = true;
    var a = frames.slice(3).sort(function (x, z) { return x - z; });
    if (!a.length) { hint("采样失败(没有帧)"); return; }
    var sum = 0; a.forEach(function (x) { sum += x; });
    var avg = sum / a.length;
    var msg = "[PERF] fps≈" + Math.round(1000 / avg)
      + " 平均" + (Math.round(avg * 100) / 100) + "ms"
      + " 中位" + (Math.round(a[Math.floor(a.length / 2)] * 100) / 100)
      + " p95" + (Math.round(a[Math.floor(a.length * 0.95)] * 100) / 100)
      + " 最差" + (Math.round(a[a.length - 1] * 100) / 100)
      + " 超8ms " + a.filter(function (x) { return x > 8; }).length + "/" + a.length
      + " 长任务" + JSON.stringify(long.slice(0, 5))
      + " 位置=" + (comic ? ("阅读器:" + (comic.name || comic.dir) + "/" + S.mode + "/页" + (S.pi + 1) + "/侧栏" + (S.thumbs ? "开" : "关")) : "书架")
      + " 窗口=" + innerWidth + "x" + innerHeight
      + " 磨砂=" + (document.body.classList.contains("bgimg") ? "开" : "关");
    try { console.log(msg); } catch (e) {}
    try { if (DISK && DISK.perfLog) DISK.perfLog(msg); } catch (e) {}   // 渲染进程的 console 不进主进程 stdout, 必须走 IPC 落盘
    hint(msg.slice(0, 160));
  }, 3000);
}
export function flyCloseComic() {
  var c = comic;
  var src = null;
  try { var ims = document.querySelectorAll("#stage img"); src = (ims && ims.length) ? ims[0] : null; } catch (e) {}
  var card = c ? document.querySelector('.card[data-dir="' + CSS.escape(c.dir) + '"]') : null;
  var cardImg = card ? card.querySelector(".thumb img") : null;
  if (!SET.flyAnim || !c || !src || !cardImg || !src.getBoundingClientRect) { closeComic(); return; }
  var a = src.getBoundingClientRect();   // 先量阅读器那张图(此刻书架还是 hide, 量卡片会得到 0)
  if (!a.width || !a.height) { closeComic(); return; }
  closeComic();                          // 先切回书架, 卡片才有真实位置
  var b = cardImg.getBoundingClientRect();
  if (!b || !b.width) return;            // 卡片量不到就算了(已经切回去了)
  var cardBox = card.getBoundingClientRect();
  if (cardBox && cardBox.width && (cardBox.bottom < 0 || cardBox.top > innerHeight)) return;   // 卡片不在可视区就别飞了
  var fly = document.createElement("img");
  fly.src = src.currentSrc || src.src;
  fly.setAttribute("aria-hidden", "true");
  var ease = "cubic-bezier(.3,.7,.3,1)";
  fly.style.cssText = "position:fixed;left:" + a.left + "px;top:" + a.top + "px;width:" + a.width + "px;height:" + a.height + "px;object-fit:contain;z-index:9999;pointer-events:none;opacity:1;transition:left 380ms " + ease + ",top 380ms " + ease + ",width 380ms " + ease + ",height 380ms " + ease + ",opacity 380ms ease-out";
  document.body.appendChild(fly);
  void fly.offsetWidth;   // 强制先算出初始位置/尺寸, 否则和终止值同帧应用 → 过渡不会跑(表现为瞬间跳到终点)
  // (closeComic 已经在上面调过了)
  requestAnimationFrame(function () {
    fly.style.left = b.left + "px";
    fly.style.top = b.top + "px";
    fly.style.width = b.width + "px";
    fly.style.height = b.height + "px";
    fly.style.opacity = "0";   // 淡到卡片封面上, 收尾不跳
  });
  setTimeout(function () { try { fly.remove(); } catch (e) {} }, 460);
}
export function closeComic() {
  resetReaderFullscreen();
  save();
  if (comic) NAVFWD.push(comic.dir);
  var dir = comic ? comic.dir : null;
  setComic(null);
  if (io) { io.disconnect(); setIo(null); }
  elReader.getAnimations().forEach(function(a){a.cancel()});
  elReader.style.position = "fixed";
  elReader.style.inset = "0";
  elReader.style.zIndex = "100";
  elShelf.classList.remove("hide");
  if (vtBusy) {
    // 飞回去: 由 View Transition 负责过渡, 这里立刻收尾(不再叠一层淡出)
    elReader.classList.add("hide");
    elReader.style.opacity = "";
    elReader.style.position = "";
    elReader.style.inset = "";
    elReader.style.zIndex = "";
  } else {
  elReader.animate([{opacity:1},{opacity:0}],{duration:300,easing:'ease-in',fill:'forwards'}).onfinish = function(){
    elReader.classList.add("hide");
    elReader.style.opacity = "";
    elReader.style.position = "";
    elReader.style.inset = "";
    elReader.style.zIndex = "";
  };
  }
  document.title = LIBTITLE;
  // 不重建整个书架, 只更新刚读那本书的进度显示, 保留滚动位置
  if (dir) {
    var el = document.querySelector('.card[data-dir="' + CSS.escape(dir) + '"]');
    if (el) {
      // 简单更新: 找到进度条和进度文字, 不重建 DOM
      var p = prog(dir);
      if (p) {
        var mf = manifestOf(dir) || {};
        var total = totalPages(mf);
        var done = 0;
        for (var i = 0; i < (p.ci||0); i++) done += nOf(mf.chapters && mf.chapters[i]);
        done += Math.min(p.pi||0, nOf(mf.chapters && mf.chapters[p.ci]) - 1);
        var bar = el.querySelector(".bar i");
        if (bar) bar.style.width = total ? Math.round(done/total*100) + "%" : "0%";
        var sub = el.querySelector(".csub");
        // 进度文字不动也行, 下次自然刷新会更新
      }
    }
  }
}

// ---- 由 core 注入 ----
let COMICS, DISK, LIBTITLE, elReader, elShelf;

export function initReaderOpen(ctx) {
  COMICS = ctx.COMICS; DISK = ctx.DISK; LIBTITLE = ctx.LIBTITLE; elReader = ctx.elReader; elShelf = ctx.elShelf
}
