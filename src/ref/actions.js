// 图的动作: 收藏 / 移除 / 收件箱 / 在原书里打开 / 打标签
//
// 右键菜单和批量操作都走这里, 界面层只负责"什么时候调"。
// 所有动作只动工作台自己的数据(store), 不碰书库一个字节。
//
// 直接 import 已有的公开接口(fillCtx / askText), 而不是让 core 注入 —— 少一条注入就少一处
// 忘记接线就 ReferenceError 的机会。

import { fillCtx } from '../shared/ctx-menu.js';
import { askText } from '../shared/ui.js';
import * as store from './store.js';
import * as board from './board.js';
import { W, touch } from './state.js';

let CTX = {};
export function initActions(ctx) { CTX = ctx || {}; }

// 右键菜单。复用书架那套 #ctx(fillCtx), 所以两个模式的右键菜单长得一样。
export function imageMenu(img, x, y) {
  if (!img) return;
  const inBox = store.inInbox(img.id);
  fillCtx([
    { t: img.fav ? '★  取消收藏' : '☆  加入收藏', f: () => { store.toggleFav(img.id); touch(); } },
    { t: inBox ? '📥  移出收件箱' : '📥  加入收件箱', f: () => { if (inBox) store.removeFromInbox(img.id); else store.addToInbox(img.id); touch(); } },
    { t: '🏷  加标签…', f: () => askTags(img) },
    { t: '✏️  备注…', f: () => askNote(img) },
    { t: '＋  加入参考板', f: () => { board.addToCurrentBoard(img.id); } },
    { t: '📖  在原书里打开', f: () => { if (CTX.onOpenInReader) CTX.onOpenInReader(img); } },
    { t: '🗑  移出工作台', f: () => { store.removeImage(img.id); touch(); } },
  ], x || 60, y || 60);
}

function askTags(img) {
  askText('加标签（空格分隔多个）', (img.tags || []).join(' '), (v) => {
    store.updateImage(img.id, { tags: String(v || '').split(/\s+/).filter(Boolean) });
    touch();
  });
}
function askNote(img) {
  askText('备注', img.note || '', (v) => { store.updateImage(img.id, { note: String(v || '') }); touch(); });
}

// ---- 批量(对 W.sel) ----
// 批量加入参考板: 一次摆开, 不用一张张来
export function selToBoard() {
  let n = 0;
  const ids = W.sel.slice();
  for (let i = 0; i < ids.length; i++) if (board.addToCurrentBoard(ids[i], { x: 40 + (i % 3) * 360, y: 40 + Math.floor(i / 3) * 480 })) n++;
  W.sel = [];
  touch();
  return n;
}

export function selToInbox() { let n = 0; for (const id of W.sel.slice()) if (store.addToInbox(id)) n++; W.sel = []; touch(); return n; }
export function selFav() {
  let n = 0;
  for (const id of W.sel.slice()) { const im = store.getWorkbench().images[id]; if (im && !im.fav) { store.toggleFav(id); n++; } }
  W.sel = []; touch(); return n;
}
export function selRemove() { const n = W.sel.length; for (const id of W.sel.slice()) store.removeImage(id); W.sel = []; touch(); return n; }
