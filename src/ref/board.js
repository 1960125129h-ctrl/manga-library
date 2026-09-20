// 画板 —— 主窗口内的参考板
//
// 交互模型:
//   · 拖图            = 移动那张图
//   · 空白拖 / 中键拖 = 平移画板
//   · 普通滚轮        = 以光标为锚点缩放整个画板
//   · 按住右键滚轮    = 以光标为锚点缩放鼠标下的图片
//   · 右键拖动图片    = 移动该图片；原地松开才显示菜单
//   · 双击图           = 适应窗口
//   · 选中 + Delete    = 从板里移除
//
// 视口状态只在内存；图片位置和单图缩放随画板数据保存。

import * as store from './store.js';
import * as palette from './palette.js';
import { W, touch } from './state.js';

const MIN_CANVAS_K = 0.05;
const MAX_CANVAS_K = 8;
const MIN_ITEM_S = 0.1;
const MAX_ITEM_S = 8;

let host = null;
let elCanvas = null;
let elZoom = null;
let CTX = {};
let drag = null;

export function initBoard(el, ctx) {
  host = el;
  CTX = ctx || {};
  elZoom = document.createElement('div');
  elZoom.className = 'wb-zoomread';

  host.onwheel = (ev) => {
    const onItem = ev.target.closest && ev.target.closest('.wb-bitem');
    if (onItem && (ev.buttons & 2)) return;
    ev.preventDefault();
    zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  };
  host.onpointerdown = (ev) => {
    if (ev.target.closest && ev.target.closest('.wb-bitem')) return;
    startBlankPan(ev);
  };
  host.oncontextmenu = (ev) => {
    if (ev.target.closest && ev.target.closest('.wb-bitem')) return;
    ev.preventDefault();
    if (CTX.onBoardMenu) CTX.onBoardMenu(ev);
  };
  window.addEventListener('keydown', onKeyDown);
}

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
  host.classList.toggle('pick', !!W.bPick);
  const b = board();
  if (!b) { host.replaceChildren(); return; }

  host.replaceChildren();
  elCanvas = document.createElement('div');
  elCanvas.className = 'wb-canvas';
  host.appendChild(elCanvas);
  applyView();

  if (!b.items.length) {
    const empty = document.createElement('div');
    empty.className = 'wb-empty';
    empty.textContent = '画板是空的。回到图墙，点击图片即可加入参考板。';
    elCanvas.appendChild(empty);
  } else {
    for (const it of b.items) elCanvas.appendChild(node(it, b));
  }
  host.appendChild(elZoom);
  updateZoomRead();
}

function applyView() {
  if (!elCanvas) return;
  elCanvas.style.transform = 'translate(' + W.btx + 'px,' + W.bty + 'px) scale(' + W.bk + ')';
  elCanvas.classList.toggle('flip', !!W.bFlip);
  elCanvas.classList.toggle('gray', !!W.bGray);
  updateZoomRead();
}

function updateZoomRead() {
  if (!elZoom) return;
  elZoom.textContent = '画板 ' + Math.round(W.bk * 100) + '%';
}

function node(it, b) {
  const wb = store.getWorkbench();
  const img = wb.images[it.id];
  const d = document.createElement('div');
  d.className = 'wb-bitem' + (W.sel.indexOf(it.id) >= 0 ? ' sel' : '');
  d.dataset.id = it.id;
  positionNode(d, it);
  d.style.zIndex = String(it.z || 1);

  if (img) {
    const src = store.imageSrc(img);
    if (src) {
      const im = document.createElement('img');
      im.src = src; im.draggable = false; im.decoding = 'async';
      im.style.width = '100%';
      d.appendChild(im);
    }
  } else {
    d.classList.add('dead');
  }

  const bar = document.createElement('div');
  bar.className = 'wb-bbar';
  bar.textContent = img ? store.imageLabel(img) : '已移除';
  d.appendChild(bar);

  const rh = document.createElement('div');
  rh.className = 'wb-resize';
  rh.title = '拖动缩放这张图';
  d.appendChild(rh);

  d.onpointerdown = (ev) => {
    if (W.bPick && ev.button === 0) {
      ev.stopPropagation();
      const im = d.querySelector('img');
      palette.pickAt(img, im, ev);
      return;
    }
    startImgDrag(ev, it, b, img);
  };
  d.onwheel = (ev) => {
    if (!(ev.buttons & 2)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (drag) drag.wheelUsed = true;
    scaleItemAtCursor(ev, it, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  };
  d.ondblclick = (ev) => { ev.stopPropagation(); fitOne(it); };
  d.oncontextmenu = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.button === 2) return;
    if (W.sel.indexOf(it.id) < 0) W.sel = [it.id];
    if (CTX.onImageMenu) CTX.onImageMenu(img, ev);
  };
  rh.onpointerdown = (ev) => startItemResize(ev, it, b);
  return d;
}

function positionNode(d, it) {
  d.style.left = (it.x || 0) + 'px';
  d.style.top = (it.y || 0) + 'px';
  d.style.width = ((it.w || 260) * (it.s || 1)) + 'px';
}

// ---- 拖图 ----
function startImgDrag(ev, it, b, img) {
  if (ev.button !== 0 && ev.button !== 2) return;
  ev.preventDefault();
  ev.stopPropagation();
  const all = W.sel.indexOf(it.id) >= 0 && W.sel.length > 1 ? W.sel.slice() : [it.id];
  if (W.sel.indexOf(it.id) < 0) W.sel = [it.id];
  drag = {
    kind: 'img', button: ev.button, ids: all, sx: ev.clientX, sy: ev.clientY, origin: {},
    clicked: { id: it.id, img }, startX: ev.clientX, startY: ev.clientY, moved: false, wheelUsed: false,
  };
  for (const id of all) {
    const o = b.items.find((x) => x.id === id);
    if (o) drag.origin[id] = { x: o.x, y: o.y };
  }
  it.z = ++W.bTop > 0 ? W.bTop : 1;
  host.classList.add('dragging-img');
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  touch();
}

function startBlankPan(ev) {
  if (ev.button !== 0 && ev.button !== 1) return;
  W.sel = [];
  drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: W.btx, oy: W.bty };
  host.classList.add('panning');
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  touch();
}

function onMove(ev) {
  if (!drag) return;
  if (drag.kind === 'img') {
    if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) > 4) drag.moved = true;
    const dx = (ev.clientX - drag.sx) / W.bk;
    const dy = (ev.clientY - drag.sy) / W.bk;
    const b = board();
    for (const id of drag.ids) {
      const o = b.items.find((x) => x.id === id);
      const o0 = drag.origin[id];
      if (o && o0) { o.x = Math.round(o0.x + dx); o.y = Math.round(o0.y + dy); }
    }
    for (const id of drag.ids) {
      const el = elCanvas.querySelector('.wb-bitem[data-id="' + id + '"]');
      const o = b.items.find((x) => x.id === id);
      if (el && o) { el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; }
    }
  } else if (drag.kind === 'pan') {
    W.btx = drag.ox + (ev.clientX - drag.sx);
    W.bty = drag.oy + (ev.clientY - drag.sy);
    applyView();
  } else if (drag.kind === 'resize') {
    onResize(ev);
  }
}

function onUp(ev) {
  const ended = drag;
  if (ended && (ended.kind === 'img' || ended.kind === 'resize')) store.saveWorkbench();
  if (host) {
    host.classList.remove('panning');
    host.classList.remove('dragging-img');
  }
  drag = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  if (ended && ended.kind === 'img' && ended.button === 2 && !ended.moved && !ended.wheelUsed && ended.clicked && CTX.onImageMenu) {
    const up = ev || { clientX: ended.startX, clientY: ended.startY };
    if (W.sel.indexOf(ended.clicked.id) < 0) W.sel = [ended.clicked.id];
    CTX.onImageMenu(ended.clicked.img, {
      clientX: up.clientX,
      clientY: up.clientY,
      preventDefault() {},
      stopPropagation() {},
    });
  }
}

// ---- 单图缩放 ----
export function scaleSelected(f) {
  return scaleItems(W.sel, f);
}

export function resetSelectedItemsScale() {
  return scaleItems(W.sel, () => 1);
}

export function scaleItems(ids, factorOrFn) {
  const b = board();
  if (!b || !elCanvas || !Array.isArray(ids) || !ids.length) return 0;
  const uniq = Array.from(new Set(ids));
  let n = 0;
  for (const id of uniq) {
    const it = b.items.find((x) => x.id === id);
    const d = elCanvas.querySelector('.wb-bitem[data-id="' + id + '"]');
    if (!it || !d) continue;
    const oldW = d.offsetWidth || ((it.w || 260) * (it.s || 1));
    const oldH = d.offsetHeight || oldW;
    const oldS = it.s || 1;
    const target = typeof factorOrFn === 'function' ? factorOrFn(oldS) : oldS * factorOrFn;
    const newS = clamp(target, MIN_ITEM_S, MAX_ITEM_S);
    if (Math.abs(newS - oldS) < 0.0001) continue;
    it.s = Math.round(newS * 10000) / 10000;
    const newW = (it.w || 260) * it.s;
    const newH = oldH * (newW / oldW);
    it.x = Math.round((it.x || 0) + (oldW - newW) / 2);
    it.y = Math.round((it.y || 0) + (oldH - newH) / 2);
    positionNode(d, it);
    n++;
  }
  if (n) store.saveWorkbench();
  return n;
}

export function scaleItemAtCursor(ev, it, f) {
  const b = board();
  const d = elCanvas && elCanvas.querySelector('.wb-bitem[data-id="' + it.id + '"]');
  if (!b || !d) return 0;
  if (W.sel.indexOf(it.id) < 0) W.sel = [it.id];
  const hr = host.getBoundingClientRect();
  const cx = (ev.clientX - hr.left - W.btx) / W.bk;
  const cy = (ev.clientY - hr.top - W.bty) / W.bk;
  const oldW = d.offsetWidth;
  const oldH = d.offsetHeight;
  if (oldW <= 0 || oldH <= 0) return 0;
  const oldS = it.s || 1;
  const newS = clamp(oldS * f, MIN_ITEM_S, MAX_ITEM_S);
  if (Math.abs(newS - oldS) < 0.0001) return 0;
  const rx = clamp((cx - (it.x || 0)) / oldW, 0, 1);
  const ry = clamp((cy - (it.y || 0)) / oldH, 0, 1);
  it.s = Math.round(newS * 10000) / 10000;
  const newW = (it.w || 260) * it.s;
  const newH = oldH * (newW / oldW);
  it.x = Math.round(cx - rx * newW);
  it.y = Math.round(cy - ry * newH);
  positionNode(d, it);
  store.saveWorkbench();
  return 1;
}

function startItemResize(ev, it, b) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (W.sel.indexOf(it.id) < 0) W.sel = [it.id];
  const ids = W.sel.slice();
  const recs = [];
  for (const id of ids) {
    const o = b.items.find((x) => x.id === id);
    const d = elCanvas.querySelector('.wb-bitem[data-id="' + id + '"]');
    if (!o || !d) continue;
    d.classList.add('sel');
    const r = d.getBoundingClientRect();
    recs.push({
      it: o, d,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      startW: d.offsetWidth,
      startH: d.offsetHeight,
      startS: o.s || 1,
      startX: o.x,
      startY: o.y,
      startDist: Math.max(1, Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2))),
    });
  }
  drag = { kind: 'resize', recs };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function onResize(ev) {
  for (const rec of drag.recs) {
    const dist = Math.max(1, Math.hypot(ev.clientX - rec.cx, ev.clientY - rec.cy));
    const newS = clamp(rec.startS * (dist / rec.startDist), MIN_ITEM_S, MAX_ITEM_S);
    const newW = (rec.it.w || 260) * newS;
    const newH = rec.startH * (newW / rec.startW);
    rec.it.s = Math.round(newS * 10000) / 10000;
    rec.it.x = Math.round(rec.startX + (rec.startW - newW) / 2);
    rec.it.y = Math.round(rec.startY + (rec.startH - newH) / 2);
    positionNode(rec.d, rec.it);
  }
}

// ---- 缩放画板 ----
function zoomAt(cx, cy, f) {
  if (!host) return;
  const hostRect = host.getBoundingClientRect();
  const px = cx - hostRect.left;
  const py = cy - hostRect.top;
  const k2 = clamp(W.bk * f, MIN_CANVAS_K, MAX_CANVAS_K);
  const ratio = k2 / W.bk;
  W.btx = px - (px - W.btx) * ratio;
  W.bty = py - (py - W.bty) * ratio;
  W.bk = k2;
  applyView();
}

export function zoomCanvasBy(f) {
  if (!host) return;
  const r = host.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
}

export function resetView() {
  W.btx = 0; W.bty = 0; W.bk = 1;
  applyView();
  touch();
}

export function fitAll() {
  const b = board();
  if (!b || !b.items.length || !elCanvas) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const d of elCanvas.querySelectorAll('.wb-bitem')) {
    const x = parseFloat(d.style.left) || 0;
    const y = parseFloat(d.style.top) || 0;
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + d.offsetWidth); y2 = Math.max(y2, y + d.offsetHeight);
  }
  if (![x1, y1, x2, y2].every(Number.isFinite)) return;
  const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
  const r = host.getBoundingClientRect();
  const k = clamp(Math.min((r.width - 80) / bw, (r.height - 80) / bh), MIN_CANVAS_K, MAX_CANVAS_K);
  W.bk = k;
  W.btx = (r.width - bw * k) / 2 - x1 * k;
  W.bty = (r.height - bh * k) / 2 - y1 * k;
  applyView();
}

export function toggleFlip() { W.bFlip = !W.bFlip; applyView(); touch(); }
export function toggleGray() { W.bGray = !W.bGray; applyView(); touch(); }

// 把板上的图排成整齐的两列。
export function arrangeCompare() {
  const b = board();
  if (!b || !b.items.length) return;
  const colW = 420, gap = 20, h = 600;
  b.items.forEach((it, i) => {
    it.x = (i % 2) * (colW + gap);
    it.y = Math.floor(i / 2) * (h + gap);
    it.w = colW;
    it.s = 1;
    it.z = i + 1;
  });
  W.bk = 1; W.btx = 20; W.bty = 20;
  store.saveWorkbench();
  renderBoard();
}

// 双击单张 -> 让它占满视口。
function fitOne(it) {
  if (!elCanvas) return;
  const d = elCanvas.querySelector('.wb-bitem[data-id="' + it.id + '"]');
  if (!d) return;
  const ow = d.offsetWidth, oh = d.offsetHeight;
  const r = host.getBoundingClientRect();
  const k = clamp(Math.min((r.width - 40) / ow, (r.height - 40) / oh), MIN_CANVAS_K, MAX_CANVAS_K);
  W.bk = k;
  W.btx = (r.width - ow * k) / 2 - (it.x || 0) * k;
  W.bty = (r.height - oh * k) / 2 - (it.y || 0) * k;
  applyView();
  touch();
}

function onKeyDown(ev) {
  if (W.mode !== 'workbench' || W.view !== 'board') return;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    removeSelFromBoard();
  }
}

export function currentBoardHas(imageId) {
  const b = board();
  return !!b && b.items.some((it) => it.id === imageId);
}

// 供 actions 和批量调用：把图加到当前板。
export function addToCurrentBoard(imageId, pos, opts = {}) {
  const b = board();
  if (!b) return false;
  const ok = store.boardAdd(b.id, imageId, pos || nextSlot(b));
  if (ok) {
    if (opts.switchView !== false) W.view = 'board';
    touch();
  }
  return ok;
}

function nextSlot(b) {
  const n = b.items.length;
  return { x: 40 + (n % 3) * 360, y: 40 + Math.floor(n / 3) * 480 };
}

export function removeSelFromBoard() {
  const b = board();
  if (!b) return 0;
  let n = 0;
  for (const id of W.sel.slice()) {
    if (store.boardRemove(b.id, id)) n++;
  }
  W.sel = [];
  renderBoard();
  return n;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
