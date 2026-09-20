// 阅读器的翻页与阅读环境: 上下页/上下话 / 阅读主题对话框 / 背景视差
// 还带着 3 个阅读器小工具: cur(当前话) / pages(当前话的页列表) / clamp(页码夹取)
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 阅读器域第 6 批)。
// bgParRaf(视差 rAF 句柄)只在 bgParallax 里用, 一起搬走。

import { S } from '../app/state.js';
import { isBigPlat } from '../library/store.js';
import { chStep, renderChapters } from '../reader/panel.js';
import { render } from '../reader/render.js';
import { comic } from '../reader/state.js';
import { applyReaderTheme, spreads, spreadIndex } from '../reader/view.js';
import { pageList, chLabel, nOf } from '../shared/chapter.js';
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
        S.theme = t[0]; applyReaderTheme();
        Array.prototype.forEach.call(sw.children, function (x) { x.className = (x === b2) ? "on" : ""; });
      };
      sw.appendChild(b2);
    });
    var lb = document.createElement("label"); lb.textContent = "画面背景亮度（图片本身不变）"; box.appendChild(lb);
    var rg = document.createElement("input"); rg.type = "range"; rg.min = "10"; rg.max = "100"; rg.step = "5";
    rg.value = String(Math.round(((typeof S.bright === "number") ? S.bright : 1) * 100));
    var val = document.createElement("div"); val.className = "stat"; val.textContent = rg.value + "%";
    rg.oninput = function () { S.bright = Number(rg.value) / 100; val.textContent = rg.value + "%"; applyReaderTheme(); };
    box.appendChild(rg); box.appendChild(val);
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

export function initReaderNav(ctx) {
  BG_PARALLAX = ctx.BG_PARALLAX; THEMES = ctx.THEMES; elStage = ctx.elStage
}
