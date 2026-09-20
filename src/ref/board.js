// 画板 —— 主窗口内的参考板
//
// 和 PureRef 的关系: 这是它的核心那部分(无限画布 + 随便摆 + 并排看), 但图来自你自己的库。
// 和娱乐模式的关系: 它只读 store 里的 boards, 不碰书库。
//
// 交互模型:
//   · 拖图      = 移动那张图(位置存在 boards[id].items 里)
//   · 空白拖    = 平移画布(只改视口, 不落盘)
//   · 滚轮      = 缩放画布
//   · 双击图    = 适应窗口
//   · 选中 + Del= 从板里移除(不移出工作台)
//
// 视口(tx/ty/k)放在 state.js 的 W 里, **只在内存** —— 它是"我正在怎么看", 不是数据。

import * as store from './store.js';
import { W, touch } from './state.js';

let host = null;
let elCanvas = null;
let CTX = {};
let drag = null;      // { kind:'img'|'pan', id, sx, sy, ox, oy }

export function initBoard(el, ctx) { host = el; CTX = ctx || {}; }

function board() {
  const wb = store.getWorkbench();
  const id = currentBoardId(wb);
  return wb.boards[id];
}

export function currentBoardId(wb) {
  const W2 = wb || store.getWorkbench();
  const ids = Object.keys(W2.boards);
  if (W.boardId && W2.boards[W.boardId]) return W.boardId;
  if (ids.length) { W.boardId = ids[0]; return ids[0]; }
  const b = store.createBoard('参考板');
  W.boardId = b.id;
  return b.id;
}

export function renderBoard() {
  if (!host) return;
  const b = board();
  if (!b) { host.replaceChildren(); return; }

  host.replaceChildren();
  elCanvas = document.createElement('div');
  elCanvas.className = 'wb-canvas';
  applyView();
  host.appendChild(elCanvas);

  if (!b.items.length) {
    const empty = document.createElement('div');
    empty.className = 'wb-empty';
    empty.textContent = '画板是空的。回「图墙」右键任意一张图 → 「＋ 加入参考板」。';
    elCanvas.appendChild(empty);
    return;
  }

  for (const it of b.items) elCanvas.appendChild(node(it, b));
  bindCanvas();
}

function applyView() {
  if (!elCanvas) return;
  elCanvas.style.transform = 'translate(' + W.btx + 'px,' + W.bty + 'px) scale(' + W.bk + ')';
  elCanvas.classList.toggle('flip', !!W.bFlip);
  elCanvas.classList.toggle('gray', !!W.bGray);
}

function node(it, b) {
  const img = store.getWorkbench().images[it.id];
  const d = document.createElement('div');
  d.className = 'wb-bitem' + (W.sel.indexOf(it.id) >= 0 ? ' sel' : '');
  d.dataset.id = it.id;
  d.style.left = it.x + 'px';
  d.style.top = it.y + 'px';
  d.style.zIndex = String(it.z || 1);

  if (img) {
    const src = store.imageSrc(img);
    if (src) {
      const im = document.createElement('img');
      im.src = src; im.draggable = false; im.decoding = 'async';
      im.style.width = (it.s || 1) * 100 + '%';
      d.appendChild(im);
    }
  } else {
    d.classList.add('dead');
  }

  const bar = document.createElement('div');
  bar.className = 'wb-bbar';
  bar.textContent = img ? store.imageLabel(img) : '已移除';
  d.appendChild(bar);

  d.onpointerdown = (ev) => startImgDrag(ev, it, b);
  d.onwheel = (ev) => { ev.preventDefault(); zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12); };
  d.ondblclick = () => { fitOne(it); };
  d.oncontextmenu = (ev) => { ev.preventDefault(); if (CTX.onImageMenu) CTX.onImageMenu(img, ev); };
  return d;
}

// ---- 拖图 ----
function startImgDrag(ev, it, b) {
  if (ev.button !== 0) return;
  ev.stopPropagation();
  const all = W.sel.indexOf(it.id) >= 0 && W.sel.length > 1 ? W.sel.slice() : [it.id];
  if (W.sel.indexOf(it.id) < 0) { W.sel = [it.id]; }
  drag = { kind: 'img', ids: all, sx: ev.clientX, sy: ev.clientY, origin: {} };
  for (const id of all) { const o = b.items.find((x) => x.id === id); if (o) drag.origin[id] = { x: o.x, y: o.y }; }
  it.z = ++W.bTop > 0 ? W.bTop : 1;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  touch();
}

function onMove(ev) {
  if (!drag) return;
  const dx = (ev.clientX - drag.sx) / W.bk;
  const dy = (ev.clientY - drag.sy) / W.bk;
  if (drag.kind === 'img') {
    const b = board();
    for (const id of drag.ids) {
      const o = b.items.find((x) => x.id === id);
      const o0 = drag.origin[id];
      if (o && o0) { o.x = Math.round(o0.x + dx); o.y = Math.round(o0.y + dy); }
    }
    for (const id of drag.ids) {
      const el = elCanvas.querySelector('.wb-bitem[data-id="' + id + '"]');
      const o = board().items.find((x) => x.id === id);
      if (el && o) { el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; }
    }
  } else if (drag.kind === 'pan') {
    W.btx = drag.ox + (ev.clientX - drag.sx);
    W.bty = drag.oy + (ev.clientY - drag.sy);
    applyView();
  }
}

function onUp() {
  if (drag && drag.kind === 'img') store.saveWorkbench();
  drag = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
}

// ---- 平移 / 缩放画布 ----
function bindCanvas() {
  elCanvas.onpointerdown = (ev) => {
    if (ev.target !== elCanvas && !ev.target.classList.contains('wb-empty')) return;
    if (ev.button !== 0 && ev.button !== 1) return;
    W.sel = [];
    drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: W.btx, oy: W.bty };
    elCanvas.classList.add('panning');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    touch();
  };
}

function zoomAt(cx, cy, f) {
  const hostRect = host.getBoundingClientRect();
  const px = cx - hostRect.left, py = cy - hostRect.top;
  const k2 = Math.max(0.15, Math.min(4, W.bk * f));
  W.btx = px - (px - W.btx) * (k2 / W.bk);
  W.bty = py - (py - W.bty) * (k2 / W.bk);
  W.bk = k2;
  applyView();
}

// ---- 工具栏动作 ----
export function resetView() { W.btx = 0; W.bty = 0; W.bk = 1; applyView(); }
export function zoomBy(f) { W.bk = Math.max(0.15, Math.min(4, W.bk * f)); applyView(); }
export function toggleFlip() { W.bFlip = !W.bFlip; applyView(); touch(); }
export function toggleGray() { W.bGray = !W.bGray; applyView(); touch(); }

// 把板上的图排成整齐的两列(并排对比: 同一比例对齐)
export function arrangeCompare() {
  const b = board();
  if (!b || !b.items.length) return;
  const colW = 420, gap = 20, h = 600;
  b.items.forEach((it, i) => {
    it.x = (i % 2) * (colW + gap);
    it.y = Math.floor(i / 2) * (h + gap);
    it.s = 1;
    it.z = i + 1;
  });
  W.bk = 1; W.btx = 20; W.bty = 20;
  store.saveWorkbench();
  renderBoard();
}

// 双击单张 -> 让它占满视口
function fitOne(it) {
  const r = host.getBoundingClientRect();
  W.btx = r.width / 2 - it.x;
  W.bty = 20;
  W.bk = 1;
  applyView();
  touch();
}

// 供 actions(右键菜单)和批量调用: 把图加到当前板
export function addToCurrentBoard(imageId, pos) {
  const b = board();
  if (!b) return false;
  const ok = store.boardAdd(b.id, imageId, pos || nextSlot(b));
  if (ok) { W.view = 'board'; touch(); }
  return ok;
}

// 新图落在右下角下一个空位, 免得全叠在原点
function nextSlot(b) {
  const n = b.items.length;
  return { x: 40 + (n % 3) * 360, y: 40 + Math.floor(n / 3) * 480 };
}

export function removeSelFromBoard() {
  const b = board();
  if (!b) return 0;
  let n = 0;
  for (const id of W.sel.slice()) { if (store.boardRemove(b.id, id)) n++; }
  W.sel = [];
  renderBoard();
  return n;
}
