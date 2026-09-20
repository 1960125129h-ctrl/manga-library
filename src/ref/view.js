// 工作台的视图装配 —— 唯一碰 DOM 外壳的模块
//
// 职责边界:
//   · 造工作台自己的 DOM(所以 index.html 只需要一个空 div)
//   · 造并接上"模式开关"(所以 core.js 不需要加任何接线, 只加一行 init 调用)
//   · 把 state 的变化翻译成重画
// 它不碰书架/阅读器的 DOM, 只切他们的 display。

import { W, setMode, setView, resetWall, onChange, toggleSel } from './state.js';
import { applyFilter } from './filter.js';
import * as store from './store.js';
import * as wall from './wall.js';
import * as picker from './picker.js';

let root = null;
let CTX = {};
let elTabWall, elTabPick, elSearch, elStat, elWall, elPick;

export function initView(el, ctx) {
  root = el; CTX = ctx || {};
  buildShell();
  buildModeSwitch();

  wall.initWall(elWall, {
    list: listImages,
    onOpen: (img) => { if (CTX.onOpenInReader) CTX.onOpenInReader(img); },
    onToggleSel: (img) => { toggleSel(img.id); },
    onContext: (img, ev) => { if (CTX.onImageContext) CTX.onImageContext(img, ev); },
  });
  picker.initPicker(elPick, {
    onAdd: (book, ci, pi) => { store.addImage(book, ci, pi); refresh(); },
    onAdded: (n) => { refresh(); if (CTX.onHint) CTX.onHint('已加入 ' + n + ' 张'); },
  }, CTX.comics || []);

  onChange(refresh);
  refresh();
}

// ---- 造 DOM ----
function buildShell() {
  const bar = document.createElement('div');
  bar.className = 'wb-bar';

  const tabs = document.createElement('div');
  tabs.className = 'wb-tabs';
  elTabWall = mkTab('图墙', () => { setView('wall'); });
  elTabPick = mkTab('挑选', () => { setView('pick'); });
  tabs.appendChild(elTabWall); tabs.appendChild(elTabPick);

  elSearch = document.createElement('input');
  elSearch.className = 'wb-search';
  elSearch.type = 'text';
  elSearch.placeholder = '搜作者 / 作品 / 角色 / 标签 / 书名';
  elSearch.oninput = () => { W.q = elSearch.value.trim(); resetWall(); refresh(); };

  elStat = document.createElement('div');
  elStat.className = 'wb-stat';

  bar.appendChild(tabs); bar.appendChild(elSearch); bar.appendChild(elStat);

  const body = document.createElement('div');
  body.className = 'wb-body';
  elWall = document.createElement('div'); elWall.className = 'wb-wall';
  elPick = document.createElement('div'); elPick.className = 'wb-pick';
  body.appendChild(elWall); body.appendChild(elPick);

  root.replaceChildren(bar, body);
}

function mkTab(text, fn) {
  const b = document.createElement('button');
  b.className = 'wb-tab'; b.textContent = text; b.onclick = fn;
  return b;
}

// 模式开关: 插到标题栏品牌名之后。不覆盖 index.html 里的任何东西。
function buildModeSwitch() {
  const tb = document.getElementById('titlebar');
  if (!tb) return;
  const wrap = document.createElement('div');
  wrap.className = 'wb-modes';
  const mk = (id, text, mode) => {
    const b = document.createElement('button');
    b.className = 'wb-mode'; b.id = id; b.textContent = text;
    b.onclick = () => switchMode(mode);
    return b;
  };
  wrap.appendChild(mk('mode-shelf', '书架', 'shelf'));
  wrap.appendChild(mk('mode-workbench', '工作台', 'workbench'));
  const brand = tb.querySelector('.tb-brand');
  if (brand && brand.nextSibling) tb.insertBefore(wrap, brand.nextSibling); else tb.appendChild(wrap);
}

// ---- 模式切换 ----
export function switchMode(m) {
  setMode(m);
  const shelf = document.getElementById('shelf');
  const reader = document.getElementById('reader');
  const wb = document.getElementById('workbench');
  if (!wb) return;
  const inWb = (m === 'workbench');
  if (inWb) {
    if (reader) reader.classList.add('hide');
    if (shelf) shelf.classList.add('hide');
    wb.classList.remove('hide');
  } else {
    wb.classList.add('hide');
    // 回书架: 阅读器开着就让它优先(和以前的行为一致)
    const readerOpen = !!(reader && !reader.classList.contains('hide'));
    if (shelf) shelf.classList.toggle('hide', readerOpen);
  }
  refresh();
}

// ---- 列表 / 重画 ----
export function listImages() {
  const all = Object.values(store.getWorkbench().images);
  for (const im of all) im.label = store.imageLabel(im);
  return applyFilter(all, W.q, {
    onlyFav: W.onlyFav,
    onlyAlive: W.onlyAlive,
    sort: W.sort,
    isAlive: (im) => store.imageAlive(im),
  });
}

export function refresh() {
  if (!root) return;
  const st = store.stats();
  elStat.textContent = '共 ' + st.total + ' 张 · 收藏 ' + st.fav + (st.dead ? (' · 失效 ' + st.dead) : '');
  elTabWall.classList.toggle('on', W.view === 'wall');
  elTabPick.classList.toggle('on', W.view === 'pick');
  elWall.classList.toggle('hide', W.view !== 'wall');
  elPick.classList.toggle('hide', W.view !== 'pick');
  if (W.view === 'pick') picker.renderPicker();
  wall.renderWall();
  const brand = document.querySelector('#titlebar .tb-brand span:last-child');
  if (brand) brand.textContent = (W.mode === 'workbench') ? '工作台' : '漫画书库';
  document.getElementById('mode-shelf').classList.toggle('on', W.mode !== 'workbench');
  document.getElementById('mode-workbench').classList.toggle('on', W.mode === 'workbench');
}
