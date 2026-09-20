// 图的动作：收藏、移除、收件箱、标签、原书定位、画板缩放。

import { fillCtx } from '../shared/ctx-menu.js';
import { askText } from '../shared/ui.js';
import * as store from './store.js';
import * as board from './board.js';
import { W, touch } from './state.js';

let CTX = {};

export function initActions(ctx) {
  CTX = ctx || {};
}

// 图片右键菜单。只有画板内的右键菜单承载画板和单图缩放，避免串到书架或阅读器。
export function imageMenu(img, x, y, opts = {}) {
  if (!img) return;
  const inBox = store.inInbox(img.id);
  const onBoard = board.currentBoardHas(img.id);
  const items = [
    { t: img.fav ? '取消收藏' : '加入收藏', f: () => { store.toggleFav(img.id); touch(); } },
    { t: inBox ? '移出收件箱' : '加入收件箱', f: () => { if (inBox) store.removeFromInbox(img.id); else store.addToInbox(img.id); touch(); } },
    { t: '加标签…', f: () => askTags(img) },
    { t: '备注…', f: () => askNote(img) },
  ];
  if (opts.inBoard) {
    items.push(
      { t: '图缩小', f: () => { board.scaleItems([img.id], 1 / 1.15); } },
      { t: '图放大', f: () => { board.scaleItems([img.id], 1.15); } },
      { t: '图复位', f: () => { board.scaleItems([img.id], () => 1); } },
      { t: '画板缩小', f: () => { board.zoomCanvasBy(1 / 1.15); } },
      { t: '画板放大', f: () => { board.zoomCanvasBy(1.15); } },
    );
  }
  if (!onBoard) items.push({ t: '加入参考板', f: () => { board.addToCurrentBoard(img.id); } });
  items.push(
    { t: '在原书里打开', f: () => { if (CTX.onOpenInReader) CTX.onOpenInReader(img); } },
    { t: '移出工作台', f: () => { store.removeImage(img.id); touch(); } },
  );
  fillCtx(items, x || 60, y || 60);
}

export function boardMenu(x, y) {
  fillCtx([
    { t: '画板缩小', f: () => board.zoomCanvasBy(1 / 1.15) },
    { t: '画板放大', f: () => board.zoomCanvasBy(1.15) },
    { t: '重置视图', f: () => board.resetView() },
    { t: '适应全部', f: () => board.fitAll() },
  ], x || 60, y || 60);
}

function askTags(img) {
  askText('加标签（空格分隔多个）', (img.tags || []).join(' '), (v) => {
    store.updateImage(img.id, { tags: String(v || '').split(/\s+/).filter(Boolean) });
    touch();
  });
}

function askNote(img) {
  askText('备注', img.note || '', (v) => {
    store.updateImage(img.id, { note: String(v || '') });
    touch();
  });
}

// ---- 批量操作 ----
export function selToBoard() {
  let n = 0;
  const ids = W.sel.slice();
  for (let i = 0; i < ids.length; i++) {
    if (board.addToCurrentBoard(ids[i], { x: 40 + (i % 3) * 360, y: 40 + Math.floor(i / 3) * 480 })) n++;
  }
  W.sel = [];
  touch();
  return n;
}

export function selToInbox() {
  let n = 0;
  for (const id of W.sel.slice()) if (store.addToInbox(id)) n++;
  W.sel = []; touch();
  return n;
}

export function selFav() {
  let n = 0;
  for (const id of W.sel.slice()) {
    const im = store.getWorkbench().images[id];
    if (im && !im.fav) { store.toggleFav(id); n++; }
  }
  W.sel = []; touch();
  return n;
}

export function selRemove() {
  const n = W.sel.length;
  for (const id of W.sel.slice()) store.removeImage(id);
  W.sel = []; touch();
  return n;
}
