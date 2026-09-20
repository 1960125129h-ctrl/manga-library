// 画板颜色面板：吸色、主色调提取、颜色复制
//
// 像素读取走主进程 sharp；这里只负责触发 IPC、展示状态和复制色值。

import { call } from '../lib/ipc.js';
import { hint } from '../shared/ui.js';
import * as store from './store.js';
import { W, touch } from './state.js';

let host = null;
let reqSeq = 0;
let busy = false;
let status = '';
let current = null;
let palette = [];
let recent = [];

export function initPalette(el, ctx) {
  host = el;
  Object.assign({}, ctx);
  render();
}

export function isPicking() {
  return !!W.bPick;
}

export function setPicking(v) {
  const next = !!v;
  if (W.bPick === next) return;
  W.bPick = next;
  touch();
}

export function togglePicking() {
  setPicking(!W.bPick);
}

export async function pickAt(img, im, ev) {
  if (!img || !im) return;
  const rect = im.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    status = '图片还没有加载完成';
    render();
    return;
  }

  let x = (ev.clientX - rect.left) / rect.width;
  let y = (ev.clientY - rect.top) / rect.height;
  x = clamp01(x);
  y = clamp01(y);
  if (W.bFlip) x = 1 - x;

  await loadColors(store.imageSrc(img), { x, y });
}

export async function extractSelected() {
  const id = W.sel && W.sel[0];
  if (!id) {
    status = '先点击选中一张图，再提取调色板';
    render();
    return;
  }
  const img = store.getWorkbench().images[id];
  if (!img) {
    status = '选中的图已失效';
    render();
    return;
  }
  await loadColors(store.imageSrc(img), null);
}

async function loadColors(src, point) {
  if (!src) {
    busy = false;
    current = null;
    palette = [];
    status = '图片地址不可用';
    render();
    return;
  }

  const seq = ++reqSeq;
  busy = true;
  status = point ? '正在吸色…' : '正在提取调色板…';
  render();

  try {
    const r = await call('imageColors', src, point || {});
    if (seq !== reqSeq) return;
    if (!r || r.ok === false) throw new Error((r && r.msg) || '取色失败');
    busy = false;
    current = r.color || null;
    palette = Array.isArray(r.palette) ? r.palette : [];
    if (r.color) addRecent(r.color);
    status = '';
  } catch (err) {
    if (seq !== reqSeq) return;
    busy = false;
    current = null;
    palette = [];
    status = String((err && err.message) || err);
  }
  render();
}

function addRecent(c) {
  recent = recent.filter((x) => x.hex !== c.hex);
  recent.unshift({ r: c.r, g: c.g, b: c.b, hex: c.hex });
  if (recent.length > 12) recent.length = 12;
}

function render() {
  if (!host) return;
  host.replaceChildren();

  const currentSection = section('当前颜色');
  const currentRow = document.createElement('div');
  currentRow.className = 'wb-current-color';
  if (current) {
    currentRow.appendChild(swatchButton(current, 'large'));
    currentRow.appendChild(colorCode(current.hex));
  } else {
    const empty = document.createElement('div');
    empty.className = 'wb-palette-empty';
    empty.textContent = busy ? '处理中…' : '尚未取色';
    currentRow.appendChild(empty);
  }
  currentSection.appendChild(currentRow);
  host.appendChild(currentSection);

  if (recent.length) {
    const recentSection = section('最近颜色');
    const row = document.createElement('div');
    row.className = 'wb-recent-colors';
    for (const c of recent) row.appendChild(swatchButton(c, 'small'));
    recentSection.appendChild(row);
    host.appendChild(recentSection);
  }

  const paletteSection = section('调色板');
  if (palette.length) {
    const grid = document.createElement('div');
    grid.className = 'wb-palette-grid';
    for (const c of palette) {
      const cell = document.createElement('div');
      cell.className = 'wb-palette-cell';
      cell.appendChild(swatchButton(c, 'palette'));
      cell.appendChild(colorCode(c.hex));
      grid.appendChild(cell);
    }
    paletteSection.appendChild(grid);
  } else {
    const empty = document.createElement('div');
    empty.className = 'wb-palette-empty';
    empty.textContent = busy ? '处理中…' : '选中图片后提取';
    paletteSection.appendChild(empty);
  }
  host.appendChild(paletteSection);

  if (status) {
    const s = document.createElement('div');
    s.className = 'wb-palette-status';
    s.textContent = status;
    host.appendChild(s);
  }
}

function section(title) {
  const el = document.createElement('section');
  el.className = 'wb-palette-section';
  const h = document.createElement('h4');
  h.textContent = title;
  el.appendChild(h);
  return el;
}

function swatchButton(c, size) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wb-swatch ' + size;
  b.style.background = c.hex;
  b.title = '复制 ' + c.hex;
  b.setAttribute('aria-label', '复制 ' + c.hex);
  b.onclick = () => copyColor(c);
  return b;
}

function colorCode(text) {
  const span = document.createElement('span');
  span.className = 'wb-color-code';
  span.textContent = text;
  return span;
}

async function copyColor(c) {
  try {
    await navigator.clipboard.writeText(c.hex);
    hint('已复制 ' + c.hex);
    return;
  } catch (e) {}

  const ta = document.createElement('textarea');
  ta.value = c.hex;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    hint('已复制 ' + c.hex);
  } catch (err) {
    status = '复制失败';
    render();
  }
  ta.remove();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && W.view === 'board' && W.bPick) setPicking(false);
});
