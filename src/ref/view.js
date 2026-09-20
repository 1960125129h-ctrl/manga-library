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
import * as inbox from './inbox.js';
import * as actions from './actions.js';
import * as board from './board.js';

let root = null;
let CTX = {};
let elTabWall, elTabBoard, elTabInbox, elTabPick, elSearch, elStat;
let elWall, elPick, elInbox, elBoardWrap, elBoard, elTools;

export function initView(el, ctx) {
  root = el; CTX = ctx || {};
  buildShell();
  buildModeSwitch();

  wall.initWall(elWall, {
    list: listImages,
    onOpen: (img) => { if (CTX.onOpenInReader) CTX.onOpenInReader(img); },
    onToggleSel: (img) => { toggleSel(img.id); },
    onContext: (img, ev) => actions.imageMenu(img, ev.clientX, ev.clientY),
  });
  picker.initPicker(elPick, {
    // 新加进来的图先进收件箱 —— 采集和整理分开做
    onAdd: (book, ci, pi) => { const im = store.addImage(book, ci, pi); store.addToInbox(im.id); refresh(); },
    onAdded: (n) => { refresh(); if (CTX.onHint) CTX.onHint('已加入 ' + n + ' 张(在收件箱)'); },
  }, CTX.comics || []);
  inbox.initInbox(elInbox, { onImageMenu: (img, ev) => actions.imageMenu(img, ev.clientX, ev.clientY), onChanged: refresh });
  board.initBoard(elBoard, { onImageMenu: (img, ev) => actions.imageMenu(img, ev.clientX, ev.clientY) });

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
  elTabBoard = mkTab('画板', () => { setView('board'); });
  elTabInbox = mkTab('收件箱', () => { setView('inbox'); });
  elTabPick = mkTab('挑选', () => { setView('pick'); });
  tabs.appendChild(elTabWall); tabs.appendChild(elTabBoard); tabs.appendChild(elTabInbox); tabs.appendChild(elTabPick);

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
  elInbox = document.createElement('div'); elInbox.className = 'wb-pick wb-inbox';

  elBoardWrap = document.createElement('div'); elBoardWrap.className = 'wb-board';
  elTools = document.createElement('div'); elTools.className = 'wb-tools';
  elBoard = document.createElement('div'); elBoard.className = 'wb-boardhost';
  elBoardWrap.appendChild(elTools); elBoardWrap.appendChild(elBoard);
  buildTools();

  body.appendChild(elWall); body.appendChild(elBoardWrap); body.appendChild(elInbox); body.appendChild(elPick);

  root.replaceChildren(bar, body);
}

// 画板工具栏。只放"看的时候要反复切"的东西; 一次性的动作走右键菜单。
function buildTools() {
  const mk = (text, fn, title) => { const b = document.createElement('button'); b.className = 'wb-tool'; b.textContent = text; b.title = title || ''; b.onclick = fn; return b; };
  elTools.appendChild(mk('重置视图', () => { board.resetView(); }, '视口回到 100% 原点'));
  elTools.appendChild(mk('－', () => { board.zoomBy(1 / 1.15); }, '缩小'));
  elTools.appendChild(mk('＋', () => { board.zoomBy(1.15); }, '放大'));
  elTools.appendChild(mk('⇋ 镜像', () => { board.toggleFlip(); }, '整板水平镜像(查对称)'));
  elTools.appendChild(mk('◐ 去色', () => { board.toggleGray(); }, '整板去色(查明度关系)'));
  elTools.appendChild(mk('▥ 并排对比', () => { board.arrangeCompare(); }, '排成两列、同一比例对齐'));
  elTools.appendChild(mk('移出选中', () => { const n = board.removeSelFromBoard(); if (CTX.onHint && n) CTX.onHint('已从画板移出 ' + n + ' 张'); }));
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
  elTabBoard.classList.toggle('on', W.view === 'board');
  elTabInbox.classList.toggle('on', W.view === 'inbox');
  elTabPick.classList.toggle('on', W.view === 'pick');
  elWall.classList.toggle('hide', W.view !== 'wall');
  elBoardWrap.classList.toggle('hide', W.view !== 'board');
  elInbox.classList.toggle('hide', W.view !== 'inbox');
  elPick.classList.toggle('hide', W.view !== 'pick');
  if (W.view === 'pick') picker.renderPicker();
  if (W.view === 'inbox') inbox.renderInbox();
  if (W.view === 'board') board.renderBoard();
  wall.renderWall();
  const brand = document.querySelector('#titlebar .tb-brand span:last-child');
  if (brand) brand.textContent = (W.mode === 'workbench') ? '工作台' : '漫画书库';
  document.getElementById('mode-shelf').classList.toggle('on', W.mode !== 'workbench');
  document.getElementById('mode-workbench').classList.toggle('on', W.mode === 'workbench');
}
