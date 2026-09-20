// 书架的阅读历史与书签面板
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 5 批)。
// 依赖: openByDir(打开某一本) + COMICS/elReader/elShelf/elStat(都只赋值一次)。
//
// 全部 export: core 里有当值传出去的用法。

import { S, elGrid } from '../app/state.js';
import { meta, prog, entryOf, coverPage } from '../library/store.js';
import { bmFind } from '../reader/panel.js';
import { nOf } from '../shared/chapter.js';
import { fmtTime } from '../shared/format.js';
import { bmAll, bmSave } from '../shared/storage.js';
import { enc } from '../shared/text.js';
import { hint } from '../shared/ui.js';
import { renderShelf, renderCatTabs } from '../shelf/render.js';
import { thumbOf } from '../shelf/util.js';

export function renderBookmarks() {
  var m = meta(), q = S.q.trim().toLowerCase();
  var a = bmAll().filter(function (x) { return !q || String(x.name).toLowerCase().indexOf(q) >= 0; });
  elGrid.innerHTML = '';
  if (!a.length) { var d = document.createElement('div'); d.id = 'empty'; d.textContent = '还没有书签。阅读时点右上「☆ 书签」即可添加。'; elGrid.appendChild(d); }
  a.forEach(function (x) {
    var c = null;
    for (var i = 0; i < COMICS.length; i++) if (COMICS[i].dir === x.dir) c = COMICS[i];
    var el = document.createElement('div'); el.className = 'card';
    var tp = document.createElement('div'); tp.className = 'thumb';
    var src = c ? thumbOf(c, c.chapters[x.ci], x.pi) : null;
    if (src) { var im = document.createElement('img'); im.loading = 'lazy'; im.decoding = 'async'; im.src = enc(src); tp.appendChild(im); }
    else { var nn = document.createElement('div'); nn.className = 'none'; nn.textContent = '原书已不在库中'; tp.appendChild(nn); }
    el.appendChild(tp);
    var mt = document.createElement('div'); mt.className = 'cmeta';
    var t = document.createElement('div'); t.className = 'ctitle'; t.textContent = '🔖 ' + x.name; mt.appendChild(t);
    var sub = document.createElement('div'); sub.className = 'csub'; sub.textContent = (x.ch || '') + ' · 第' + (x.pi + 1) + '/' + (x.total || '?') + '页'; mt.appendChild(sub);
    var tm = document.createElement('div'); tm.className = 'cread'; tm.textContent = fmtTime(x.t); mt.appendChild(tm);
    el.appendChild(mt);
    el.onclick = function () { openByDir(x.dir, x.ci, x.pi); };
    el.oncontextmenu = function (ev) { ev.preventDefault(); var a2 = bmAll(); var i2 = bmFind(x.dir, x.ci, x.pi); if (i2 >= 0) { a2.splice(i2, 1); bmSave(a2); renderShelf(); hint('已删除该书签'); } };
    elGrid.appendChild(el);
  });
  elStat.textContent = '共 ' + bmAll().length + ' 个书签 · 显示 ' + a.length + ' 个';
  renderCatTabs();
}
export function renderHistory() {
  var box = document.getElementById('hlist');
  if (!box) return;
  var rows = [];
  for (var i = 0; i < COMICS.length; i++) {
    var c = COMICS[i], p = prog(c.dir);
    if (!p) continue;
    var e = entryOf(c.dir);
    rows.push({ c: c, p: p, t: (e && e.lastRead) || (meta()['t::' + c.dir]) || 0 });
  }
  rows.sort(function (a, b) { return b.t - a.t; });
  box.innerHTML = '';
  if (!rows.length) { var d = document.createElement('div'); d.className = 'empty'; d.textContent = '还没有阅读记录。'; box.appendChild(d); }
  rows.forEach(function (r) {
    var ch = r.c.chapters[r.p.ci || 0] || {};
    var row = document.createElement('div'); row.className = 'hrow';
    var cov = coverPage(r.c) || r.c.cover || thumbOf(r.c, r.c.chapters[0], 0);
    if (cov) { var im = document.createElement('img'); im.loading = 'lazy'; im.src = enc(cov); row.appendChild(im); }
    var meta2 = document.createElement('div'); meta2.className = 'hmeta';
    var t1 = document.createElement('div'); t1.className = 'htitle'; t1.textContent = r.c.name || r.c.dir; meta2.appendChild(t1);
    var t2 = document.createElement('div'); t2.className = 'hsub';
    t2.textContent = (ch.name || ('第' + ((r.p.ci || 0) + 1) + '话')) + ' · 第' + ((r.p.pi || 0) + 1) + '/' + nOf(ch) + ' 页' + (r.t ? ' · ' + fmtTime(r.t) : '');
    meta2.appendChild(t2); row.appendChild(meta2);
    var go = document.createElement('button'); go.className = 'btn hgo'; go.textContent = '继续阅读';
    go.onclick = function (ev) { ev.stopPropagation(); openByDir(r.c.dir, r.p.ci, r.p.pi); };
    row.appendChild(go);
    row.onclick = function () { openByDir(r.c.dir, r.p.ci, r.p.pi); };
    box.appendChild(row);
  });
  var st = document.getElementById('hstat');
  if (st) st.textContent = rows.length ? '共 ' + rows.length + ' 本读过' : '';
}
export function openHistory() {
  var h = document.getElementById('history');
  if (!h) return;
  elShelf.classList.add('hide'); elReader.classList.add('hide');
  h.classList.remove('hide');
  h.getAnimations().forEach(function(a){a.cancel()});
  h.animate([{opacity:0},{opacity:1}],{duration:300,easing:'ease-out',fill:'forwards'}).onfinish = function(){ h.style.opacity = ""; };
  renderHistory();
}
export function closeHistory() {
  var h = document.getElementById('history');
  if (!h) { elReader.classList.add('hide'); elShelf.classList.remove('hide'); renderShelf(); return; }
  elShelf.classList.remove('hide');
  elReader.classList.add('hide');
  h.getAnimations().forEach(function(a){a.cancel()});
  h.animate([{opacity:1},{opacity:0}],{duration:300,easing:'ease-in',fill:'forwards'}).onfinish = function(){
    h.classList.add('hide');
    h.style.opacity = "";
    renderShelf();
  };
}

// ---- 由 core 注入 ----
let openByDir, COMICS, elReader, elShelf, elStat;

export function initShelfHistory(ctx) {
  openByDir = ctx.openByDir; COMICS = ctx.COMICS; elReader = ctx.elReader; elShelf = ctx.elShelf; elStat = ctx.elStat
}
