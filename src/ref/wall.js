// 工作台的图墙 —— 网格 + 懒加载 + 无限滚动
//
// 只做"把一批图铺出来"这一件事。筛选在 filter.js, 数据在 store.js, 状态在 state.js。
//
// 性能说明(现在的取舍): 虚拟引用指向的是漫画原页(平均 283 KB), 不是缩略图。
// 靠 loading=lazy + decoding=async + content-visibility, 实际只会同步加载视口附近那几张。
// 真要铺几万张时得走主进程生成页级缩略图 —— 那是独立一步, 记在 TODO 里。

import { W, WALL_STEP, moreWall } from './state.js';
import * as store from './store.js';

let host = null;
let hooks = {};

export function initWall(el, h) { host = el; hooks = h || {}; }

// 当前该显示的图(已筛选排序)
export function visible() {
  return hooks.list ? hooks.list() : [];
}

export function renderWall() {
  if (!host) return;
  const all = visible();
  // 注意: cap 是"还能显示多少"的上限, 不能写成 W.wallLoaded = n。
  // 那样第一次渲染时如果只有 1 张, cap 就被缩回 1, 之后加多少张都只显示 1 张(踩过)。
  const cap = W.wallLoaded > 0 ? W.wallLoaded : WALL_STEP;
  const n = Math.min(all.length, cap);
  W.wallLoaded = cap;

  if (!all.length) {
    host.innerHTML = '<div class="wb-empty">还没有图。左边「挑选」里把书库的页加进来 —— 或者按上面的说明用批量。' +
      (W.q || W.onlyFav ? '<br><span class="wb-dim">(当前筛选条件下没有结果)</span>' : '') + '</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  const slice = all.slice(0, n);
  for (const img of slice) frag.appendChild(cell(img));
  host.replaceChildren(frag);

  if (all.length > n) {
    const more = document.createElement('div');
    more.className = 'wb-more';
    more.textContent = '还有 ' + (all.length - n) + ' 张 · 点这里继续加载';
    more.onclick = () => { moreWall(); renderWall(); };
    host.appendChild(more);
  }
}

function cell(img) {
  const d = document.createElement('div');
  d.className = 'wb-cell' + (W.sel.indexOf(img.id) >= 0 ? ' sel' : '');
  d.dataset.id = img.id;
  d.classList.toggle('onboard', !!hooks.isOnBoard && hooks.isOnBoard(img.id));

  const src = store.imageSrc(img);
  if (src) {
    const im = document.createElement('img');
    im.loading = 'lazy'; im.decoding = 'async'; im.src = src; im.alt = '';
    im.onerror = () => { d.classList.add('dead'); };
    d.appendChild(im);
  } else {
    d.className += ' dead';
    const nn = document.createElement('div');
    nn.className = 'wb-none';
    nn.textContent = '原图不在了';
    d.appendChild(nn);
  }

  const lab = document.createElement('div');
  lab.className = 'wb-cell-lab';
  lab.textContent = store.imageLabel(img);
  d.appendChild(lab);

  if (hooks.isOnBoard && hooks.isOnBoard(img.id)) {
    const boardTag = document.createElement('span');
    boardTag.className = 'wb-cell-board';
    boardTag.textContent = '参考板';
    d.appendChild(boardTag);
  }

  if (img.fav) {
    const f = document.createElement('span');
    f.className = 'wb-cell-fav'; f.textContent = '★';
    d.appendChild(f);
  }

  d.onclick = (ev) => {
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { hooks.onToggleSel && hooks.onToggleSel(img); return; }
    if (hooks.onQuickAdd) hooks.onQuickAdd(img, ev);
    else hooks.onOpen && hooks.onOpen(img, ev);
  };
  d.oncontextmenu = (ev) => { ev.preventDefault(); hooks.onContext && hooks.onContext(img, ev); };
  return d;
}
