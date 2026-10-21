// 阅读器侧栏: 章节列表 / 书签 / 右键菜单 / 图片管理器
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 Block 4a)。这一块是阅读器里最
// 自包含的部分: 只读 comic/S.ci/S.pi, 不改阅读器的渲染热路径, 所以先搬它。
//
// 搬迁方式: 函数体一字未改, 只是去掉了 IIFE 的一层缩进;
// 原来靠闭包拿到的东西改由 initReaderPanel(ctx) 注入 ——
//   函数类(render/syncButtons/pages/libEntry/isBigPlat/fillCtx): 函数声明会提升,
//     所以按值注入是安全的, 不存在"注入点太早拿到 undefined"的问题。
//   状态类(COMICS/DISK/elBook/elChapters): 都只在声明时赋值一次, 按值注入也是安全的。
// comic / LIBROOT 这类"会被重新赋值或异步填进来"的, 一律走 import 实时绑定, 不注入。

import { enc } from '../shared/text.js';
import { nOf, chLabel, pageList, imgFile } from '../shared/chapter.js';
import { hint, showModal, closeModal } from '../shared/ui.js';
import { S, LIBRARY, LIBROOT } from '../app/state.js';
import { bmAll, bmSave } from '../shared/storage.js';
import { comic } from './state.js';
// 图片管理器删完图要刷新书架(它本质是"书库管理"入口, 只是挂在阅读器里)
import { renderShelf, invalidateCard } from '../shelf/render.js';

/* ---------- 书签（localStorage） ---------- */
export function bmFind(dir, ci, pi) { var a = bmAll(); for (var i = 0; i < a.length; i++) { if (a[i].dir === dir && a[i].ci === ci && a[i].pi === pi) return i; } return -1; }
export function bmToggle() {
  if (!comic) return;
  var c = comic, a = bmAll(), i = bmFind(c.dir, S.ci, S.pi);
  if (i >= 0) { a.splice(i, 1); bmSave(a); hint('已取消书签'); }
  else {
    var ch = c.chapters[S.ci] || {};
    a.unshift({ dir: c.dir, name: (c.name || c.dir), ci: S.ci, pi: S.pi, t: Date.now(), ch: ch.name || ('第' + (S.ci + 1) + '话'), total: pages().length });
    bmSave(a); hint('已加书签：' + (ch.name || '') + ' 第' + (S.pi + 1) + '页');
  }
  syncButtons(); bmSync();
}
export function bmSync() { var b = document.getElementById('bbm'); if (!b) return; var on = comic ? bmFind(comic.dir, S.ci, S.pi) >= 0 : false; b.textContent = on ? '已书签' : '书签'; b.classList.toggle('on', on); }

/* ---------- 预览栏右键菜单: 删除这一张图 ---------- */
export function showImgCtx(x, y, idx) {
  if (!comic) return;
  var ch = comic.chapters[S.ci];
  var f = imgFile(ch, idx);
  fillCtx([
    { t: "设为本书封面", f: function () {
        var e = libEntry(comic.dir);
        if (!e) { hint("需要桌面版才能保存封面"); return; }
        e.coverOverride = { ci: S.ci, pi: idx };
        invalidateCard(comic.dir); renderShelf();
        // saveLibrary 是 ipcRenderer.invoke, 返回 Promise: 拒绝进不了 try/catch, 必须挂 then/catch,
        // 否则会先弹「已设为本书封面」而盘上什么都没写
        var psave = (DISK && DISK.saveLibrary) ? DISK.saveLibrary(LIBRARY) : null;
        if (psave && typeof psave.then === 'function') {
          psave.then(function () { hint("已设为本书封面"); },
                     function (err) { hint("封面保存失败: " + ((err && err.message) || err)); });
        } else {
          hint("已设为本书封面");
        }
      } },
    { t: "在文件夹中打开", f: function () {
        if (!DISK || !DISK.reveal || !LIBROOT || !f) { hint("仅桌面版支持"); return; }
        var dir = f.indexOf("/") >= 0 ? f.slice(0, f.lastIndexOf("/")) : "";
        DISK.reveal(LIBROOT + "\\" + comic.dir + (dir ? "\\" + dir.replace(/\//g, "\\") : ""));
      } },
    { t: "删除这张图（含文件）", f: function () { delImage(idx); } }
  ], x, y);
}

/* ---------- 管理图包: 批量删除单张图片 ---------- */
export function openImageManager(dir) {
  var c = null;
  for (var i = 0; i < COMICS.length; i++) { if (COMICS[i].dir === dir) { c = COMICS[i]; break; } }
  if (!c) { hint("库里找不到这本书"); return; }
  if (!DISK || !DISK.deleteImage) { hint("需要桌面版（重启 App 后可用）"); return; }

  var allImgs = [];
  for (var ci = 0; ci < c.chapters.length; ci++) {
    var ch = c.chapters[ci];
    var pl = pageList(c, ch);
    var cl = chLabel(ch) || ("第" + (ci+1) + "话");
    for (var pi = 0; pi < pl.length; pi++) {
      allImgs.push({ ci: ci, pi: pi, url: enc(pl[pi]), label: cl + " · " + (pi + 1) });
    }
  }
  if (!allImgs.length) { hint("这本书没有图片"); return; }

  var selected = new Set();
  var lastClickIdx = -1;

  showModal(function (box) {
    box.style.cssText = "display:flex;flex-direction:column;width:92vw;height:86vh;max-width:1400px;position:relative;padding-bottom:60px;";

    var head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:6px 2px 10px;";
    var h = document.createElement("h3"); h.textContent = "管理图包 · " + (c.name || dir); h.style.cssText = "margin:0;";
    var cnt = document.createElement("span"); cnt.className = "sub"; cnt.style.cssText = "font-size:13px;";
    cnt.textContent = allImgs.length + " 张";
    head.appendChild(h); head.appendChild(cnt);
    box.appendChild(head);

    var grid = document.createElement("div");
    grid.style.cssText = "flex:1;min-height:0;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px;padding:4px 2px;align-content:flex-start;";
    box.appendChild(grid);

    var items = [];
    for (var k = 0; k < allImgs.length; k++) {
      (function (idx, info) {
        var cell = document.createElement("div");
        cell.style.cssText = "position:relative;width:125px;height:180px;flex-shrink:0;cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid transparent;transition:border-color .15s;";
        var im = document.createElement("img");
        im.dataset.src = info.url; im.decoding = "async"; im.alt = ""; im.style.background = "#1a1a1a"; im.onerror = function(){ this.style.background = "#222"; };
        im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
        var lab = document.createElement("div");
        lab.style.cssText = "position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:10px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        lab.textContent = info.label;
        cell.appendChild(im); cell.appendChild(lab);
        grid.appendChild(cell);
        items.push(cell);

        (function(imgEl){
          if (!("IntersectionObserver" in window)) { imgEl.src = imgEl.dataset.src; return; }
          var iobs = new IntersectionObserver(function(entries, obs){
            entries.forEach(function(en){
              if (en.isIntersecting) { imgEl.src = imgEl.dataset.src; obs.unobserve(imgEl); }
            });
          }, { root: null, rootMargin: "300px 0px", threshold: 0.01 });
          iobs.observe(imgEl);
        })(im);

        cell.onclick = function (ev) {
          if (ev.shiftKey && lastClickIdx >= 0) {
            var a = Math.min(lastClickIdx, idx), b = Math.max(lastClickIdx, idx);
            for (var j = a; j <= b; j++) { selected.add(j); items[j].style.borderColor = "var(--accent,#e55)"; }
          } else if (ev.ctrlKey || ev.metaKey) {
            if (selected.has(idx)) { selected.delete(idx); cell.style.borderColor = "transparent"; }
            else { selected.add(idx); cell.style.borderColor = "var(--accent,#e55)"; }
          } else {
            if (selected.has(idx)) { selected.delete(idx); cell.style.borderColor = "transparent"; }
            else { selected.add(idx); cell.style.borderColor = "var(--accent,#e55)"; }
          }
          lastClickIdx = idx;
          cnt.textContent = allImgs.length + " 张 · 已选 " + selected.size;
          okBtn.textContent = "确认删除选中 " + selected.size + " 张";
        };
      })(k, allImgs[k]);
    }

    var foot = document.createElement("div");
    foot.style.cssText = "display:flex;justify-content:flex-end;gap:10px;padding:10px 22px;border-top:1px solid var(--border2);position:absolute;bottom:0;left:0;right:0;background:var(--card-bg);";
    var cancelBtn = document.createElement("button"); cancelBtn.className = "btn ghost"; cancelBtn.textContent = "取消";
    var clearBtn = document.createElement("button"); clearBtn.className = "btn ghost"; clearBtn.textContent = "取消选择";
    var okBtn = document.createElement("button"); okBtn.className = "btn"; okBtn.textContent = "确认删除";
    foot.appendChild(cancelBtn); foot.appendChild(clearBtn); foot.appendChild(okBtn);
    box.appendChild(foot);

    cancelBtn.onclick = closeModal;
    clearBtn.onclick = function () {
      selected.clear();
      items.forEach(function(el){ el.style.borderColor = "transparent"; });
      cnt.textContent = allImgs.length + " 张";
      okBtn.textContent = "确认删除";
    };
    okBtn.onclick = async function () {
      if (!selected.size) { hint("先选择要删除的图片"); return; }
      var n = selected.size;
      // 直接删除, 不弹确认
      okBtn.disabled = true; okBtn.textContent = "正在删除…";

      var byCh = {};
      selected.forEach(function (idx) {
        var info = allImgs[idx];
        if (!byCh[info.ci]) byCh[info.ci] = [];
        byCh[info.ci].push(info.pi);
      });

      var okCount = 0, failCount = 0;
      var chs = Object.keys(byCh).map(Number).sort(function (a,b){return b-a;});
      for (var ci2 = 0; ci2 < chs.length; ci2++) {
        var chIdx = chs[ci2];
        var pis = byCh[chIdx].sort(function(a,b){return b-a;});
        var chObj = c.chapters[chIdx];
        if (!chObj) continue;
        for (var pi2 = 0; pi2 < pis.length; pi2++) {
          var rel = imgFile(chObj, pis[pi2]);
          if (!rel) { failCount++; continue; }
          try {
            var r = await DISK.deleteImage(dir, rel, { rebuild: false });   // 批量删: 每张都重建会起几十个 node 子进程
            if (r && r.ok) { okCount++; } else { failCount++; }
          } catch (e) { failCount++; }
        }
      }

      if (DISK.rescan) { try { await DISK.rescan({ quiet: true, offline: true, dirs: [dir] }); } catch (e) {} }
      closeModal();
      hint("删除完成: 成功 " + okCount + (failCount ? ", 失败 " + failCount : "") + "，刷新中…");
      setTimeout(function(){ location.reload(); }, 800);
    };
  });
}

/* ---------- 章节右键菜单: 删除这一话 ---------- */
function showChCtx(x, y, idx) {
  if (!comic) return;
  var ch = comic.chapters[idx];
  if (!ch) return;
  var label = chLabel(ch);
  fillCtx([
    { t: "打开这一话", f: function () { S.ci = idx; S.pi = 0; render(); renderChapters(); } },
    { t: "在文件夹中打开", f: function () {
        if (!ch.path) { hint("这一话没有独立文件夹"); return; }
        if (DISK && DISK.reveal && LIBROOT) DISK.reveal(LIBROOT + "\\" + comic.dir + "\\" + ch.path);
        else hint("仅桌面版支持");
      } },
    { t: "删除这一话（含文件）…", f: function () { delChapter(idx); } }
  ], x, y);
}

// 观看顺序: 正常 0..n-1; 倒序 n-1..0(某些站(X)第一话是最早的图, 想从最新的看起就开这个)
function chOrder() {
  var n = comic ? comic.chapters.length : 0, out = [], i;
  if (S.rev) { for (i = n - 1; i >= 0; i--) out.push(i); } else { for (i = 0; i < n; i++) out.push(i); }
  return out;
}
// 按观看顺序走 d 步, 返回那一话的绝对下标(越界返回 -1)
export function chStep(d) {
  var o = chOrder(), pos = o.indexOf(S.ci);
  if (pos < 0) return -1;
  var nx = pos + d;
  return (nx < 0 || nx >= o.length) ? -1 : o[nx];
}
export function renderChapters() {
  if (!comic) return;
  var big = isBigPlat(comic.dir);
  elBook.textContent = (comic.name || comic.dir);
  elChapters.innerHTML = "";
  var ord = chOrder();
  for (var q = 0; q < ord.length; q++) {
    (function (i) {
      var b = document.createElement("button");
      b.className = "ch" + (i === S.ci ? " on" : "");
      b.textContent = chLabel(comic.chapters[i]);
      var sp = document.createElement("span"); sp.className = "n"; sp.textContent = nOf(comic.chapters[i]) + (big ? " 张" : "p");
      b.appendChild(sp);
      b.onclick = function () { S.ci = i; S.pi = 0; render(); renderChapters(); };
      b.oncontextmenu = function (ev) { ev.preventDefault(); ev.stopPropagation(); showChCtx(ev.clientX, ev.clientY, i); };
      elChapters.appendChild(b);
    })(ord[q]);
  }
  var on = elChapters.querySelector(".ch.on");
  if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
}

// core 注入的依赖(函数声明提升, 所以先声明后注入都行; 统一在 initReaderPanel 里赋值)
let render, syncButtons, pages, libEntry, isBigPlat, fillCtx;
let COMICS, DISK, elBook, elChapters;
let delChapter, delImage;   // 章节/图片删除(仍在 core 里; 直接调主进程删文件, 没有二次确认框)

export function initReaderPanel(ctx) {
  render = ctx.render; syncButtons = ctx.syncButtons; pages = ctx.pages;
  libEntry = ctx.libEntry; isBigPlat = ctx.isBigPlat; fillCtx = ctx.fillCtx;
  COMICS = ctx.COMICS; DISK = ctx.DISK; elBook = ctx.elBook; elChapters = ctx.elChapters;
  delChapter = ctx.delChapter; delImage = ctx.delImage;
}
