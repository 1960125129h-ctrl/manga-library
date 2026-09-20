// 收件箱 —— 新收进来的图先落这里, 看过再决定去留
//
// 这是"攒了不理"的解药(Eagle/Hydrus 都有这个模式): 采集和整理分开做,
// 采的时候不用想分类, 整理的时候只面对收件箱那一小堆。

import * as store from './store.js';

let host = null;
let CTX = {};

export function initInbox(el, ctx) { host = el; CTX = ctx || {}; }

export function renderInbox() {
  if (!host) return;
  const ids = store.getWorkbench().inbox.slice();
  host.replaceChildren();

  const head = document.createElement('div');
  head.className = 'wb-pick-head';
  head.textContent = ids.length
    ? ('收件箱 ' + ids.length + ' 张 · 右键单张处理, 或在图墙上多选后批量')
    : '收件箱是空的。在图墙上右键「加入收件箱」, 或在「挑选」里加图。';
  host.appendChild(head);

  if (!ids.length) return;

  const grid = document.createElement('div');
  grid.className = 'wb-wall';
  for (const id of ids) {
    const img = store.getWorkbench().images[id];
    if (!img) continue;
    const d = document.createElement('div');
    d.className = 'wb-cell';
    const src = store.imageSrc(img);
    if (src) { const im = document.createElement('img'); im.loading = 'lazy'; im.decoding = 'async'; im.src = src; d.appendChild(im); }
    else { d.className += ' dead'; const n = document.createElement('div'); n.className = 'wb-none'; n.textContent = '原图不在了'; d.appendChild(n); }
    const lab = document.createElement('div'); lab.className = 'wb-cell-lab'; lab.textContent = store.imageLabel(img); d.appendChild(lab);
    d.oncontextmenu = (ev) => { ev.preventDefault(); if (CTX.onImageMenu) CTX.onImageMenu(img, ev); };
    d.onclick = () => { store.removeFromInbox(id); renderInbox(); if (CTX.onChanged) CTX.onChanged(); };
    grid.appendChild(d);
  }
  host.appendChild(grid);
}
