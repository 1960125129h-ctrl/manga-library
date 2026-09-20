// 「从书库挑选」 —— 把漫画的页加成工作台的图
//
// 这是工作台唯一的"进口"。它只读书库(COMICS/chapters/pageList), 不写书库任何东西。
// 三层: 书 -> 话 -> 页。前两层是列表, 第三层给"整话加入"的快捷方式。

import { pageList, chLabel, nOf } from '../shared/chapter.js';

let host = null;
let hooks = {};
let openBook = null;      // 当前展开的书
let openCh = -1;          // 当前展开的话

export function initPicker(el, h, comics) { host = el; hooks = h || {}; COMICS = comics || []; }
let COMICS = [];

export function renderPicker() {
  if (!host) return;
  host.replaceChildren();

  if (!openBook) { renderBooks(); return; }
  renderChapters(openBook);
}

function renderBooks() {
  const head = document.createElement('div');
  head.className = 'wb-pick-head';
  head.textContent = '书库共 ' + COMICS.length + ' 本 · 点一本展开';
  host.appendChild(head);

  const frag = document.createDocumentFragment();
  for (const c of COMICS) {
    const row = document.createElement('div');
    row.className = 'wb-pick-row';
    const nm = document.createElement('span');
    nm.className = 'wb-pick-name';
    nm.textContent = c.name || c.dir.replace(/^漫画[\\/]/, '');
    row.appendChild(nm);
    const cnt = document.createElement('span');
    cnt.className = 'wb-pick-sub';
    let pages = 0;
    for (const ch of (c.chapters || [])) pages += nOf(ch);
    cnt.textContent = (c.chapters || []).length + ' 话 / ' + pages + ' 页';
    row.appendChild(cnt);
    row.onclick = () => { openBook = c; openCh = -1; renderPicker(); };
    frag.appendChild(row);
  }
  host.appendChild(frag);
}

function renderChapters(c) {
  const back = document.createElement('div');
  back.className = 'wb-pick-head wb-pick-back';
  back.textContent = '‹ 返回书库 · ' + (c.name || c.dir.replace(/^漫画[\\/]/, ''));
  back.onclick = () => { openBook = null; openCh = -1; renderPicker(); };
  host.appendChild(back);

  const allBtn = document.createElement('div');
  allBtn.className = 'wb-pick-add';
  allBtn.textContent = '＋ 整本加入工作台';
  allBtn.onclick = () => { let n = 0; for (let ci = 0; ci < c.chapters.length; ci++) n += addChapter(c, ci); hooks.onAdded && hooks.onAdded(n); };
  host.appendChild(allBtn);

  const frag = document.createDocumentFragment();
  for (let ci = 0; ci < c.chapters.length; ci++) {
    const ch = c.chapters[ci];
    const row = document.createElement('div');
    row.className = 'wb-pick-row';
    const nm = document.createElement('span');
    nm.className = 'wb-pick-name';
    nm.textContent = chLabel(ch) || ('第' + (ci + 1) + '话');
    row.appendChild(nm);
    const cnt = document.createElement('span');
    cnt.className = 'wb-pick-sub';
    cnt.textContent = nOf(ch) + ' 页';
    row.appendChild(cnt);
    const add = document.createElement('button');
    add.className = 'wb-pick-btn';
    add.textContent = '一话加入';
    add.onclick = (ev) => { ev.stopPropagation(); const n = addChapter(c, ci); hooks.onAdded && hooks.onAdded(n); };
    row.appendChild(add);
    row.onclick = (ev) => { if (ev.target === add) return; openCh = (openCh === ci ? -1 : ci); renderPicker(); };
    frag.appendChild(row);

    if (openCh === ci) {
      const grid = document.createElement('div');
      grid.className = 'wb-pick-grid';
      const pl = pageList(c, ch);
      for (let pi = 0; pi < pl.length; pi++) {
        const cell = document.createElement('div');
        cell.className = 'wb-pick-cell';
        const im = document.createElement('img');
        im.loading = 'lazy'; im.decoding = 'async'; im.src = encPath(pl[pi]);
        cell.appendChild(im);
        const b = document.createElement('button');
        b.className = 'wb-pick-btn';
        b.textContent = '＋ 第' + (pi + 1) + '页';
        b.onclick = (ev) => { ev.stopPropagation(); hooks.onAdd && hooks.onAdd(c.dir, ci, pi); };
        cell.appendChild(b);
        grid.appendChild(cell);
      }
      frag.appendChild(grid);
    }
  }
  host.appendChild(frag);
}

function addChapter(c, ci) {
  const pl = pageList(c, c.chapters[ci]);
  let n = 0;
  for (let pi = 0; pi < pl.length; pi++) { if (hooks.onAdd) hooks.onAdd(c.dir, ci, pi); n++; }
  return n;
}

// 路径要 URL 编码才能塞进 img.src(中文/空格)
function encPath(p) {
  return String(p).split('/').map((s) => encodeURIComponent(s)).join('/');
}
