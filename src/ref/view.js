// 工作台的视图装配：创建 DOM 外壳、模式开关并把状态变化翻译成界面刷新。

import { W, setMode, setView, resetWall, onChange, toggleSel } from './state.js';
import { applyFilter } from './filter.js';
import * as store from './store.js';
import * as wall from './wall.js';
import * as picker from './picker.js';
import * as inbox from './inbox.js';
import * as actions from './actions.js';
import * as board from './board.js';
import * as palette from './palette.js';

let root = null;
let CTX = {};
let elTabWall, elTabBoard, elTabInbox, elTabPick, elSearch, elStat;
let elWall, elPick, elInbox, elBoardWrap, elBoard, elBoardMain, elPalette, elTools, elToolPick, elToolPalette;

export function initView(el, ctx) {
  root = el;
  CTX = ctx || {};
  buildShell();
  buildModeSwitch();
  actions.initActions({ onOpenInReader: CTX.onOpenInReader });

  wall.initWall(elWall, {
    list: listImages,
    onOpen: (img) => { if (CTX.onOpenInReader) CTX.onOpenInReader(img); },
    onToggleSel: (img) => { toggleSel(img.id); },
    onContext: (img, ev) => actions.imageMenu(img, ev.clientX, ev.clientY),
    onQuickAdd: quickAddToBoard,
    isOnBoard: (id) => board.currentBoardHas(id),
  });
  picker.initPicker(elPick, {
    onAdd: (book, ci, pi) => {
      const im = store.addImage(book, ci, pi);
      store.addToInbox(im.id);
      refresh();
    },
    onAdded: (n) => {
      refresh();
      if (CTX.onHint) CTX.onHint('已加入 ' + n + ' 张(在收件箱)');
    },
  }, CTX.comics || []);
  inbox.initInbox(elInbox, {
    onImageMenu: (img, ev) => actions.imageMenu(img, ev.clientX, ev.clientY),
    onChanged: refresh,
  });
  board.initBoard(elBoard, {
    onImageMenu: (img, ev) => actions.imageMenu(img, ev.clientX, ev.clientY, { inBoard: true }),
    onBoardMenu: (ev) => actions.boardMenu(ev.clientX, ev.clientY),
  });
  palette.initPalette(elPalette, { onHint: CTX.onHint });

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
  tabs.appendChild(elTabWall);
  tabs.appendChild(elTabBoard);
  tabs.appendChild(elTabInbox);
  tabs.appendChild(elTabPick);

  elSearch = document.createElement('input');
  elSearch.className = 'wb-search';
  elSearch.type = 'text';
  elSearch.placeholder = '搜作者 / 作品 / 角色 / 标签 / 书名';
  elSearch.oninput = () => {
    W.q = elSearch.value.trim();
    resetWall();
    refresh();
  };

  elStat = document.createElement('div');
  elStat.className = 'wb-stat';

  bar.appendChild(tabs);
  bar.appendChild(elSearch);
  bar.appendChild(elStat);

  const body = document.createElement('div');
  body.className = 'wb-body';
  elWall = document.createElement('div');
  elWall.className = 'wb-wall';
  elPick = document.createElement('div');
  elPick.className = 'wb-pick';
  elInbox = document.createElement('div');
  elInbox.className = 'wb-pick wb-inbox';

  elBoardWrap = document.createElement('div');
  elBoardWrap.className = 'wb-board';
  elTools = document.createElement('div');
  elTools.className = 'wb-tools';
  elBoardMain = document.createElement('div');
  elBoardMain.className = 'wb-board-main';
  elBoard = document.createElement('div');
  elBoard.className = 'wb-boardhost';
  elPalette = document.createElement('aside');
  elPalette.className = 'wb-palette';
  elBoardMain.appendChild(elBoard);
  elBoardMain.appendChild(elPalette);
  elBoardWrap.appendChild(elTools);
  elBoardWrap.appendChild(elBoardMain);
  buildTools();

  body.appendChild(elWall);
  body.appendChild(elBoardWrap);
  body.appendChild(elInbox);
  body.appendChild(elPick);

  root.replaceChildren(bar, body);
}

function buildTools() {
  const mk = (text, fn, title) => {
    const b = document.createElement('button');
    b.className = 'wb-tool';
    b.textContent = text;
    b.title = title || '';
    b.onclick = fn;
    return b;
  };
  const canvasZoom = (f) => board.zoomCanvasBy(f);
  const itemZoom = (f) => {
    const n = board.scaleSelected(f);
    if (!n && CTX.onHint) CTX.onHint('先点击选中画板里的图片');
  };

  elTools.appendChild(mk('重置视图', () => board.resetView(), '视口回到 100% 原点'));
  elTools.appendChild(mk('适应全部', () => board.fitAll(), '缩放并平移到显示全部图片'));
  elTools.appendChild(mk('画板缩小', () => canvasZoom(1 / 1.15), '以画板视口中心为准缩小整个画板'));
  elTools.appendChild(mk('画板放大', () => canvasZoom(1.15), '以画板视口中心为准放大整个画板'));
  elTools.appendChild(mk('图缩小', () => itemZoom(1 / 1.15), '缩小选中图片，不改动原文件'));
  elTools.appendChild(mk('图放大', () => itemZoom(1.15), '放大选中图片，不改动原文件'));
  elTools.appendChild(mk('图复位', () => {
    const n = board.resetSelectedItemsScale();
    if (!n && CTX.onHint) CTX.onHint('先点击选中画板里的图片');
  }, '选中图片回到 100%，不改动原文件'));
  elTools.appendChild(mk('镜像', () => board.toggleFlip(), '整板水平镜像'));
  elTools.appendChild(mk('去色', () => board.toggleGray(), '整板去色'));
  elToolPick = mk('吸色', () => palette.togglePicking(), '点击图片拾取颜色，Esc 退出');
  elToolPalette = mk('调色板', () => palette.extractSelected(), '提取选中图片的主色调');
  elTools.appendChild(elToolPick);
  elTools.appendChild(elToolPalette);
  elTools.appendChild(mk('并排对比', () => board.arrangeCompare(), '排成两列、同一比例对齐'));
  elTools.appendChild(mk('移出选中', () => {
    const n = board.removeSelFromBoard();
    if (CTX.onHint && n) CTX.onHint('已从画板移出 ' + n + ' 张');
  }, '从当前画板移出选中图片'));
}

function mkTab(text, fn) {
  const b = document.createElement('button');
  b.className = 'wb-tab';
  b.textContent = text;
  b.onclick = fn;
  return b;
}

// 模式开关：插到标题栏品牌名之后。
function buildModeSwitch() {
  const tb = document.getElementById('titlebar');
  if (!tb) return;
  const wrap = document.createElement('div');
  wrap.className = 'wb-modes';
  const mk = (id, text, mode) => {
    const b = document.createElement('button');
    b.className = 'wb-mode';
    b.id = id;
    b.textContent = text;
    b.onclick = () => switchMode(mode);
    return b;
  };
  wrap.appendChild(mk('mode-shelf', '书架', 'shelf'));
  wrap.appendChild(mk('mode-workbench', '工作台', 'workbench'));
  const brand = tb.querySelector('.tb-brand');
  if (brand && brand.nextSibling) tb.insertBefore(wrap, brand.nextSibling);
  else tb.appendChild(wrap);
}

// ---- 模式切换 ----
export function switchMode(m) {
  setMode(m);
  const shelf = document.getElementById('shelf');
  const reader = document.getElementById('reader');
  const wb = document.getElementById('workbench');
  if (!wb) return;
  const inWb = m === 'workbench';
  if (inWb) {
    if (reader) reader.classList.add('hide');
    if (shelf) shelf.classList.add('hide');
    wb.classList.remove('hide');
  } else {
    wb.classList.add('hide');
    const readerOpen = !!(reader && !reader.classList.contains('hide'));
    if (shelf) shelf.classList.toggle('hide', readerOpen);
  }
  refresh();
}

function quickAddToBoard(img) {
  const ok = board.addToCurrentBoard(img.id, null, { switchView: false });
  if (!CTX.onHint) return;
  if (ok) CTX.onHint('已加入参考板');
  else CTX.onHint(board.currentBoardHas(img.id) ? '已在参考板' : '无法加入参考板');
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
  if (elToolPick) elToolPick.classList.toggle('on', W.view === 'board' && palette.isPicking());
  elInbox.classList.toggle('hide', W.view !== 'inbox');
  elPick.classList.toggle('hide', W.view !== 'pick');
  if (W.view === 'pick') picker.renderPicker();
  if (W.view === 'inbox') inbox.renderInbox();
  if (W.view === 'board') board.renderBoard();
  wall.renderWall();
  const brand = document.querySelector('#titlebar .tb-brand span:last-child');
  if (brand) brand.textContent = W.mode === 'workbench' ? '工作台' : '漫画书库';
  const modeShelf = document.getElementById('mode-shelf');
  const modeWorkbench = document.getElementById('mode-workbench');
  if (modeShelf) modeShelf.classList.toggle('on', W.mode !== 'workbench');
  if (modeWorkbench) modeWorkbench.classList.toggle('on', W.mode === 'workbench');
}
