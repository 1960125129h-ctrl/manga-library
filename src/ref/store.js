// 工作台的数据层(美术参考图)
//
// 和"娱乐模式"的关系: **一套库, 两种消费方式**。
//   娱乐模式看的是「第3话第5页」, 工作台看的是「一张图」—— 同一张图, 两种身份。
//   所以这里不复制文件, 只记引用: { book, ci, pi }。
//
// 虚拟引用的关键设计: **id 从 (书, 话, 页) 稳定推导出来**。
//   同一页无论被收藏几次都是同一个 id —— 去重是免费的, 不需要查表。
//
// 固化(可选): 用户明确要"拿出来"的图才复制成独立文件, 记在 img.file 上。
//   43,815 张全复制是 11.8 GB, 没必要。

import { enc } from '../shared/text.js';
import { pageList, imgFile, chLabel, nOf } from '../shared/chapter.js';
import { LIBRARY, LIBROOT } from '../app/state.js';

let DISK = null;
let COMICS = [];

// 工作台整体数据。结构写死在这里, 主进程落盘前会照这个校验。
let WB = { version: 1, images: {}, boards: {}, inbox: [] };
let saveTimer = 0;
let dirty = false;
let lastSaveErr = null;

export function initRefStore(ctx) {
  DISK = ctx.DISK;
  COMICS = ctx.COMICS;
}

// 稳定 id: FNV-1a 32 位 -> base36。不用 uuid, 因为我们要的是"同一页同一 id"。
export function imageId(book, ci, pi) {
  const s = book + '|' + ci + '|' + pi;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}

// ---- 落盘 ----
export function getWorkbench() { return WB; }

export function loadWorkbench(wb) {
  if (!wb || typeof wb !== 'object' || Array.isArray(wb)) return;
  WB = {
    version: 1,
    images: (wb.images && typeof wb.images === 'object' && !Array.isArray(wb.images)) ? wb.images : {},
    boards: (wb.boards && typeof wb.boards === 'object' && !Array.isArray(wb.boards)) ? wb.boards : {},
    inbox: Array.isArray(wb.inbox) ? wb.inbox : [],
  };
  for (const k of Object.keys(WB.images)) {
    const im = WB.images[k];
    if (!im || typeof im !== 'object') { delete WB.images[k]; continue; }
    im.id = k;
    if (!Array.isArray(im.tags)) im.tags = [];
    if (typeof im.note !== 'string') im.note = '';
    im.fav = !!im.fav;
  }
  WB.inbox = WB.inbox.filter((id) => !!WB.images[id]);
  dirty = false;
}

export function saveWorkbench() {
  if (!DISK || !DISK.saveWorkbench) return Promise.resolve({ ok: false, msg: '需要桌面版' });
  if (saveTimer) clearTimeout(saveTimer);
  return new Promise((resolve) => {
    saveTimer = setTimeout(async () => {
      saveTimer = 0;
      try { const r = await DISK.saveWorkbench(WB); lastSaveErr = r && r.ok ? null : ((r && r.msg) || '未知错误'); dirty = !(r && r.ok); resolve(r); }
      catch (e) { lastSaveErr = String((e && e.message) || e); dirty = true; resolve({ ok: false, msg: lastSaveErr }); }
    }, 400);
  });
}
export function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
  if (!DISK || !DISK.saveWorkbench) return Promise.resolve({ ok: false, msg: '需要桌面版' });
  return DISK.saveWorkbench(WB).then((r) => { dirty = !(r && r.ok); lastSaveErr = r && r.ok ? null : ((r && r.msg) || '未知错误'); return r; })
    .catch((e) => { lastSaveErr = String((e && e.message) || e); dirty = true; return { ok: false, msg: lastSaveErr }; });
}
export const isDirty = () => dirty;
export const lastError = () => lastSaveErr;

// ---- 找书 / 取图地址 ----
export function findBook(bookDir) {
  for (let i = 0; i < COMICS.length; i++) if (COMICS[i].dir === bookDir) return COMICS[i];
  return null;
}

// 虚拟引用 -> 可用的图片地址。固化过的优先用固化文件。
export function imageSrc(img) {
  if (!img) return null;
  if (img.file) return enc(img.file);
  const c = findBook(img.ref.book);
  if (!c || !c.chapters[img.ref.ci]) return null;
  const p = pageList(c, c.chapters[img.ref.ci]);
  return p[img.ref.pi] ? enc(p[img.ref.pi]) : null;
}

// 这张图还在不在(原书被删了就成悬空引用)
export function imageAlive(img) {
  if (!img) return false;
  if (img.file) return true;
  const c = findBook(img.ref.book);
  if (!c) return false;
  const ch = c.chapters[img.ref.ci];
  if (!ch) return false;
  const p = pageList(c, ch);
  return !!p[img.ref.pi];
}

export function imageLabel(img) {
  if (!img) return '';
  const c = findBook(img.ref.book);
  const name = (c && (c.name || c.dir.replace(/^漫画[\/]/, ''))) || img.ref.book.replace(/^漫画[\/]/, '');
  const ch = c && c.chapters[img.ref.ci];
  return name + ' · ' + (ch ? (chLabel(ch) || ('第' + (img.ref.ci + 1) + '话')) : ('第' + (img.ref.ci + 1) + '话')) + ' · 第' + (img.ref.pi + 1) + '页';
}

// ---- 图的增删改 ----
// 加入工作台。已存在就原样返回(不覆盖用户已经打好的标签)。
export function addImage(bookDir, ci, pi, opts) {
  const id = imageId(bookDir, ci, pi);
  if (WB.images[id]) return WB.images[id];
  const c = findBook(bookDir);
  const ent = (LIBRARY && LIBRARY.comics && LIBRARY.comics[bookDir]) || {};
  WB.images[id] = {
    id,
    ref: { book: bookDir, ci, pi },
    file: null,
    author: (opts && opts.author) || ent.author || '',
    work: (opts && opts.work) || ent.work || '',
    char: (opts && opts.char) || ent.char || '',
    tags: [],
    fav: false,
    note: '',
    source: (opts && opts.source) || (ent.source && ent.source.url) || '',
    addedAt: Date.now(),
  };
  dirty = true;
  saveWorkbench();
  return WB.images[id];
}

export function removeImage(id) {
  if (!WB.images[id]) return false;
  delete WB.images[id];
  WB.inbox = WB.inbox.filter((x) => x !== id);
  for (const b of Object.values(WB.boards)) b.items = (b.items || []).filter((it) => it.id !== id);
  dirty = true; saveWorkbench();
  return true;
}

export function updateImage(id, patch) {
  const im = WB.images[id];
  if (!im) return null;
  Object.assign(im, patch || {});
  if (!Array.isArray(im.tags)) im.tags = [];
  dirty = true; saveWorkbench();
  return im;
}

export function toggleFav(id) {
  const im = WB.images[id];
  if (!im) return false;
  im.fav = !im.fav; dirty = true; saveWorkbench();
  return im.fav;
}

// 同一本书的"作者/作品/角色"批量刷到它已有的图上(改名/重新识别之后用)
export function refreshBookMeta(bookDir) {
  const ent = (LIBRARY && LIBRARY.comics && LIBRARY.comics[bookDir]) || {};
  let n = 0;
  for (const im of Object.values(WB.images)) {
    if (im.ref.book !== bookDir) continue;
    if (ent.author) im.author = ent.author;
    if (ent.work) im.work = ent.work;
    if (ent.char) im.char = ent.char;
    n++;
  }
  if (n) { dirty = true; saveWorkbench(); }
  return n;
}

// ---- 收件箱 ----
export function inInbox(id) { return WB.inbox.indexOf(id) >= 0; }
export function addToInbox(id) {
  if (!WB.images[id] || inInbox(id)) return false;
  WB.inbox.unshift(id); dirty = true; saveWorkbench();
  return true;
}
export function removeFromInbox(id) {
  const n = WB.inbox.length;
  WB.inbox = WB.inbox.filter((x) => x !== id);
  if (WB.inbox.length !== n) { dirty = true; saveWorkbench(); return true; }
  return false;
}

// ---- 参考板 ----
export function createBoard(name) {
  const id = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  WB.boards[id] = { id, name: name || '参考板', items: [] };
  dirty = true; saveWorkbench();
  return WB.boards[id];
}
export function listBoards() { return Object.values(WB.boards); }
export function boardAdd(boardId, imageId2, pos) {
  const b = WB.boards[boardId];
  if (!b || !WB.images[imageId2]) return false;
  if ((b.items || []).some((it) => it.id === imageId2)) return false;
  b.items = b.items || [];
  b.items.push({ id: imageId2, x: (pos && pos.x) || 0, y: (pos && pos.y) || 0, s: 1, z: b.items.length + 1 });
  dirty = true; saveWorkbench();
  return true;
}
export function boardRemove(boardId, imageId2) {
  const b = WB.boards[boardId];
  if (!b) return false;
  const n = (b.items || []).length;
  b.items = (b.items || []).filter((it) => it.id !== imageId2);
  if (b.items.length !== n) { dirty = true; saveWorkbench(); return true; }
  return false;
}

// ---- 统计(界面用) ----
export function stats() {
  const ids = Object.keys(WB.images);
  let dead = 0, fav = 0;
  for (const id of ids) { if (!imageAlive(WB.images[id])) dead++; if (WB.images[id].fav) fav++; }
  return { total: ids.length, inbox: WB.inbox.length, fav, dead, boards: Object.keys(WB.boards).length };
}
