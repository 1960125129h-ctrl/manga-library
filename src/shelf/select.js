// 书架的多选 / 专辑 / 批量删除
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 2 批)。
// 这一批的共同点: 全是"被界面直接调用"的动作函数, 自己几乎不依赖别的
// (14 个函数只需要注入 DISK 一项)。
//
// 归属:
//   SELANCHOR(Shift 范围选择的锚点)只在本模块的 selToggle / selRange 里赋值,
//     所以由本模块持有 —— 不用给 core setter。
//   DISK 由 core 注入(只在声明时赋值一次, 按值注入安全)。
//
// 全部 export: core 那边有些地方不是"调用"而是把它当值传给 initShelfRender
// (比如 { selToggle: selToggle }), 少导一个就是运行时 undefined。

import { hint, showModal, closeModal, modalFoot, askConfirm, askText } from '../shared/ui.js';
import { S, LIBRARY } from '../app/state.js';
import { loadAlbums, saveAlbums } from '../shared/storage.js';
import { SEL, setSel } from '../shelf/state.js';
import { renderShelf, invalidateCard, renderSelBar } from '../shelf/render.js';
import { libEntry, libSave } from '../library/store.js';

export let SELANCHOR = null;   // 多选锚点: Shift 范围选择从它开始算(只在本模块里赋值)

export function albumCount(name) { var a = loadAlbums(); return (a[name] || []).length; }
export function inAlbum(dir) { if (!S.album) return true; var a = loadAlbums(); return (a[S.album] || []).indexOf(dir) >= 0; }
export function addToAlbum(albumName, dirs) {
  var a = loadAlbums();
  if (!a[albumName]) a[albumName] = [];
  for (var i = 0; i < dirs.length; i++) if (a[albumName].indexOf(dirs[i]) < 0) a[albumName].push(dirs[i]);
  saveAlbums(a);
}
export function removeFromAlbum(albumName, dirs) {
  var a = loadAlbums();
  if (!a[albumName]) return;
  for (var i = 0; i < dirs.length; i++) { var j = a[albumName].indexOf(dirs[i]); if (j >= 0) a[albumName].splice(j, 1); }
  if (!a[albumName].length) delete a[albumName];
  saveAlbums(a);
}
export function selHas(d) { return SEL.indexOf(d) >= 0; }
export function visibleDirs() {
  return Array.prototype.map.call(document.querySelectorAll("#grid .card"), function (el) { return el.getAttribute("data-dir"); }).filter(Boolean);
}
export function selToggle(d) {
  var i = SEL.indexOf(d);
  if (i >= 0) SEL.splice(i, 1); else SEL.push(d);
  SELANCHOR = d;
  // 只更新这张卡片的样式和 selbar, 不重建整个 grid(避免滚动跳变/滚轮失灵)
  var el = document.querySelector('.card[data-dir="' + CSS.escape(d) + '"]');
  if (el) el.classList.toggle("sel", SEL.indexOf(d) >= 0);
  renderSelBar();
}
export function selRange(d) {
  var list = visibleDirs();
  var a = SELANCHOR ? list.indexOf(SELANCHOR) : -1, b = list.indexOf(d);
  if (a < 0 || b < 0) { selToggle(d); return; }
  var lo = Math.min(a, b), hi = Math.max(a, b);
  for (var i = lo; i <= hi; i++) {
    if (!selHas(list[i])) SEL.push(list[i]);
    var el = document.querySelector('.card[data-dir="' + CSS.escape(list[i]) + '"]');
    if (el) el.classList.add("sel");
  }
  SELANCHOR = d;
  renderSelBar();
}
export function selClear() { if (SEL.length) { setSel([]); renderShelf(); } }
export function selNewAlbum() {
  if (!SEL.length) return;
  var dirs = SEL.slice();
  askText("新建专辑", "专辑名", function (name) {
    name = (name || "").trim();
    if (!name) return;
    var a = loadAlbums();
    if (a[name]) {
      // 专辑已存在: 追加进去
      addToAlbum(name, dirs);
    } else {
      a[name] = dirs.slice(); saveAlbums(a);
    }
    S.album = name; setSel([]);
    renderShelf();
    hint("已创建专辑「" + name + "」，含 " + dirs.length + " 本");
  });
}
export function selRemoveFromAlbum() {
  if (!SEL.length || !S.album) return;
  var dirs = SEL.slice();
  removeFromAlbum(S.album, dirs);
  hint("已移出 " + dirs.length + " 本");
  setSel([]); renderShelf();
}
export function selDelete() {
  if (!SEL.length) return;
  var list = SEL.slice();
  deleteMany(list, function () { setSel([]); renderShelf(); });
}
export function selCategory() {
  if (!SEL.length) return;
  if (!LIBRARY) { hint("分类需要桌面版"); return; }
  showModal(function (box) {
    var h = document.createElement("h3"); h.textContent = "把 " + SEL.length + " 本移到分类"; box.appendChild(h);
    var sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = "只改书库里的分类归属，磁盘上的文件夹不动；选中的书原来的分类会被替换。";
    box.appendChild(sub);
    var cats = (LIBRARY.categories || []).slice();
    var pick = { v: "" };
    var list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin:6px 0 10px;max-height:240px;overflow:auto";
    function addOpt(v, label) {
      var lb = document.createElement("label"); lb.className = "chk";
      var r = document.createElement("input"); r.type = "radio"; r.name = "selcat";
      r.checked = (pick.v === v);
      r.onchange = function () { pick.v = v; };
      lb.appendChild(r); lb.appendChild(document.createTextNode(label));
      list.appendChild(lb);
    }
    addOpt("", "（移出所有分类）");
    cats.forEach(function (c) { addOpt(c, c); });
    box.appendChild(list);
    var l2 = document.createElement("label"); l2.textContent = "或新建分类（填了就忽略上面的选择）"; box.appendChild(l2);
    var ni = document.createElement("input"); ni.type = "text"; ni.placeholder = "例如：长篇 / 短篇 / 待看"; box.appendChild(ni);
    ni.onkeydown = function (e) { e.stopPropagation(); };
    modalFoot(box, function () {
      var v = ni.value.trim() || pick.v;
      closeModal();
      for (var i = 0; i < SEL.length; i++) { var e2 = libEntry(SEL[i]); e2.categories = v ? [v] : []; }
      if (v && (LIBRARY.categories || []).indexOf(v) < 0) LIBRARY.categories = (LIBRARY.categories || []).concat([v]);
      libSave();
      var n = SEL.length; setSel([]);
      renderShelf();
      hint("已把 " + n + " 本移到「" + (v || "无分类") + "」");
    }, "移动");
  });
}
export function deleteMany(list, done) {
  if (!list || !list.length) return;
  if (!DISK || !DISK.deleteComic) { hint("删除需要桌面版：请用「启动书库.cmd」打开"); return; }
  var n = list.length, arr = list.slice();
  askConfirm("删除这 " + n + " 本？", "会同时删除磁盘上的整个漫画文件夹（含全部话与图片）、书库条目和阅读进度。删除后无法恢复。", "全部删除", async function () {
    hint("正在删除 " + n + " 本…");
    var ok = 0, bad = [];
    for (var i = 0; i < arr.length; i++) {
      try {
        var r = await DISK.deleteComic(arr[i]);
        if (r && r.ok) { ok++; if (LIBRARY && LIBRARY.comics) delete LIBRARY.comics[arr[i]]; } else bad.push(arr[i]);
      } catch (e) { bad.push(arr[i]); }
    }
    if (DISK.rescan) { try { await DISK.rescan({ offline: true }); } catch (e2) {} }
    arr.forEach(function (d) { invalidateCard(d); });
    renderShelf();
    hint("已删除 " + ok + " 本" + (bad.length ? "，" + bad.length + " 本失败" : ""));
    if (done) done(ok, bad);
  });
}

// ---- 由 core 注入 ----
let DISK;

export function initShelfSelect(ctx) {
  DISK = ctx.DISK
}
