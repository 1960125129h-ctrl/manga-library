// 通用右键菜单(#ctx): 填充条目 / 收起 / 书架卡片的整份菜单
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构)。放 shared/ 是因为书架和阅读器
// 都在用它: 书架卡片右键、章节右键、预览栏右键走的是同一个 #ctx 元素。
//
// showCtx 是"一本书能做什么"的总菜单 —— 十六项动作全部指向别的模块, 所以它
// 只需要 fillCtx + 一堆 import。

import { LIBRARY, LIBROOT } from '../app/state.js';
import { libEntry, manifestOf } from '../library/store.js';
import { openImageManager } from '../reader/panel.js';
import { manualOrder, saveManualOrder } from '../shared/storage.js';
import { hint } from '../shared/ui.js';
import { tagOne } from '../shelf/authors.js';
import { toggleFav, editNote, renameBookDir, setRating, mergeBook, confirmDelete } from '../shelf/book-actions.js';
import { openEditor, openInfo } from '../shelf/info-editor.js';
import { renderShelf } from '../shelf/render.js';
import { checkUpdate, multiUpdate } from '../shelf/sites.js';
import { copyText } from '../shelf/util.js';

export function fillCtx(items, x, y) {
  if (!elCtx) return;
  elCtx.innerHTML = "";
  items.forEach(function (it) {
    var b = document.createElement("button");
    b.textContent = it.t;
    b.onclick = function (ev) { ev.stopPropagation(); hideCtx(); it.f(); };
    elCtx.appendChild(b);
  });
  elCtx.classList.add("on");
  var w = elCtx.offsetWidth, h = elCtx.offsetHeight;
  elCtx.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + "px";
  elCtx.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + "px";
}
export function hideCtx() { if (elCtx) elCtx.classList.remove("on"); }
export function showCtx(x, y, dir) {
  if (!LIBRARY) return;
  var e = libEntry(dir);
  fillCtx([
    { t: e.favorite ? "★  取消收藏" : "☆  加入收藏", f: function () { toggleFav(dir); } },
    { t: "备注…", f: function () { editNote(dir); } },
    { t: "重命名…", f: function () { renameBookDir(dir); } },
    { t: "编辑分类与标签…", f: function () { openEditor(dir); } },
    { t: "按书名自动打标签", f: function () { tagOne(dir); } },
    { t: "简介与来源…", f: function () { openInfo(dir); } },
    { t: "在文件夹中打开", f: function () {
        if (DISK && DISK.reveal && LIBROOT) DISK.reveal(LIBROOT + "\\" + dir);
        else hint("仅桌面版支持");
      } },
    { t: "复制书名", f: function () { copyText(dir); } },
    { t: "🔍 检查是否有更新（原站）", f: function () { checkUpdate(dir); } },
    { t: "跨站检查更新…", f: function () { multiUpdate(dir); } },
    { t: ((manifestOf(dir) || {}).rating === "18+") ? "分级：改为非 18+" : "分级：标为 18+", f: function () { setRating(dir, (manifestOf(dir) || {}).rating !== "18+"); } },
    { t: "分级：恢复自动判定", f: function () { setRating(dir, null); } },
    { t: "📦 合并成一个文件夹（图片全进 全部\\）", f: function () { mergeBook(dir); } },
    { t: "管理图包…", f: function () { openImageManager(dir); } },
    { t: "清除手动排序", f: function () { var o = manualOrder(); delete o[dir]; saveManualOrder(o); renderShelf(); hint("已清除这一本的手动排序"); } },
    { t: "删除本书（含文件）…", f: function () { confirmDelete(dir); } }
  ], x, y);
}

// ---- 由 core 注入 ----
let DISK, elCtx;

export function initCtxMenu(ctx) {
  DISK = ctx.DISK; elCtx = ctx.elCtx
}
