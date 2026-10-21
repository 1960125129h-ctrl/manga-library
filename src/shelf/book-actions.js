// 书架里"对这一本书做的事": 备注 / 自动标签 / 收藏 / 分级 / 重命名 / 合并 / 删除 / 查重 / 分类管理
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 4 批)。这批是右键菜单背后
// 那一串动作 —— 只有 fillCtx(填菜单) + COMICS/DISK(只读) 三项依赖。
//
// 注意里面有几个是 async 函数(renameBookDir / mergeBook), 搬运和加 export 都要认
// async 前缀 —— 这个坑在依赖分析里踩过一次, 在抽取脚本里又踩了一次。
//
// 全部 export: core 里有些是当值传给 initShelfRender 的({ toggleFav: toggleFav })。

import { hint, showModal, closeModal, modalFoot, askConfirm, askText } from '../shared/ui.js';
import { isWebMode, webDeleteBook } from '../shared/web-api.js';
import { S, LIBRARY } from '../app/state.js';
import { setBookTimes } from '../shelf/state.js';
import { saveShelfView } from '../shelf/filter-row.js';
import { renderShelf, invalidateCard } from '../shelf/render.js';
import { libEntry, manifestOf, entryOf, libSave, totalPages, unitP, unitQ, dupKey } from '../library/store.js';
import { deleteMany } from '../shelf/select.js';
import { keepScroll } from '../shelf/util.js';

export async function renameBookDir(dir) {
  if (!DISK || !DISK.renameBook) { hint("重命名需要桌面版"); return; }
  var oldName = dir.split('/').pop();
  askText("重命名", oldName, async function (v) {
    v = String(v || '').trim();
    if (!v || v === oldName) return;
    if (/[\\\/:*?"<>|]/.test(v)) { hint("名字不能包含 \\ / : * ? \" < > |"); return; }
    var r = await DISK.renameBook(dir, v);
    if (r && r.ok) { hint("已重命名为：" + v); }
    else { hint("重命名失败：" + (r && r.msg ? r.msg : "未知错误")); }
  });
}
export function editNote(dir) {
  if (!LIBRARY) { hint("备注需要桌面版：请用「启动书库.cmd」打开"); return; }
  var e = libEntry(dir);
  showModal(function (box) {
    var h = document.createElement("h3"); h.textContent = "备注"; box.appendChild(h);
    var s = document.createElement("div"); s.className = "sub";
    s.textContent = dir + "  —— 会显示在卡片上, 也能被搜索框搜到。";
    box.appendChild(s);
    var ta = document.createElement("textarea"); ta.rows = 4; ta.value = e.note || "";
    ta.placeholder = "例如: 第 3 话缺 2 页 / 等第 2 部 / 朋友推荐";
    ta.style.cssText = "width:100%;background:#101115;border:1px solid #33363e;color:#e6e8ec;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:13px;resize:vertical";
    box.appendChild(ta);
    ta.onkeydown = function (ev) { ev.stopPropagation(); };
    modalFoot(box, function () {
      closeModal();
      e.note = ta.value.trim();
      libSave(); invalidateCard(dir); renderShelf();
      hint(e.note ? "已保存备注" : "已清空备注");
    }, "保存");
    setTimeout(function () { ta.focus(); }, 40);
  });
}
export function autoTags(dir) {
  var s = String(dir || "").replace(/^漫画\//, "");
  var out = [];
  var add = function (t) { if (t && out.indexOf(t) < 0) out.push(t); };
  var m = s.match(/[\[【]([^\]】]{1,24}?(?:汉化组|漢化組|汉化|漢化|翻譯|翻译))[\]】]/);
  if (m) { var g = m[1].replace(/汉化组?|漢化組?|翻譯|翻译/g, "").trim(); add(g ? "汉化:" + g : "汉化"); }
  else if (/[汉漢]化|翻譯|翻译/.test(s)) add("汉化");
  var c = s.match(/[（(](C\d{2,3})[）)]/i);
  if (c) add(c[1].toUpperCase());
  if (/無修正|无修正/.test(s)) add("无修正");
  if (/中国翻[訳译]/.test(s)) add("中国翻译");
  if (/DL版/i.test(s)) add("DL版");
  if (/全彩|フルカラー|カラー/.test(s)) add("全彩");
  if (/短[編集篇]|短篇/.test(s)) add("短篇");
  if (/合同|アンソロジー/.test(s)) add("合同本");
  if (/自购|自購/.test(s)) add("自购");
  return out;
}
export function findDupGroups() {
  var g = {}, i, k;
  for (i = 0; i < COMICS.length; i++) {
    k = dupKey(COMICS[i].dir);
    if (!k || k.length < 3) continue;
    (g[k] = g[k] || []).push(COMICS[i]);
  }
  var out = [];
  for (k in g) if (g[k].length > 1) out.push({ key: k, items: g[k], why: "书名(去掉配方括号后)完全一样" });
  var keys = Object.keys(g);
  for (i = 0; i < keys.length; i++) for (var j = i + 1; j < keys.length; j++) {
    var a = keys[i], b = keys[j];
    if (a.length < 6 || b.length < 6) continue;
    var short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
    if (long.indexOf(short) === 0 && long.length - short.length >= 4) {
      // 只报"疑似同一本不同版本": 页数差在 30% 以内
      var pa = totalPages(g[a][0]), pb = totalPages(g[b][0]);
      if (pa && pb && Math.abs(pa - pb) / Math.max(pa, pb) <= 0.3) out.push({ key: a, items: g[a].concat(g[b]), why: "书名互为前缀(疑似同本不同版本), 页数接近" });
    }
  }
  return out;
}
export function dupDialog() {
  var groups = findDupGroups();
  showModal(function (box) {
    var h = document.createElement("h3"); h.textContent = "疑似重复的书"; box.appendChild(h);
    var s = document.createElement("div"); s.className = "sub";
    s.textContent = groups.length ? "共 " + groups.length + " 组。勾选要删掉的，其余保留；删的是整个文件夹，删完会自动重建书库。" : "没发现同名/近似同名的书。";
    box.appendChild(s);
    var wrap = document.createElement("div"); wrap.id = "dupbox"; box.appendChild(wrap);
    var picked = {};
    groups.forEach(function (grp) {
      var gh = document.createElement("div"); gh.className = "duphead";
      gh.textContent = "相似：" + (grp.items[0].name || grp.items[0].dir) + "   ·   " + grp.why;
      wrap.appendChild(gh);
      grp.items.forEach(function (c) {
        var row = document.createElement("label"); row.className = "duprow";
        var cb = document.createElement("input"); cb.type = "checkbox";
        cb.onchange = function () { if (cb.checked) picked[c.dir] = 1; else delete picked[c.dir]; };
        var t1 = document.createElement("span"); t1.className = "dupname"; t1.textContent = c.dir;
        var t2 = document.createElement("span"); t2.className = "dupmisc";
        var e = entryOf(c.dir);
        t2.textContent = c.chapters.length + " " + unitQ(c.dir) + " · " + totalPages(c) + " " + unitP(c.dir) + ((e && e.source && e.source.site) ? " · " + e.source.site : "");
        row.appendChild(cb); row.appendChild(t1); row.appendChild(t2);
        wrap.appendChild(row);
      });
    });
    var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
    var close = document.createElement("button"); close.className = "btn ghost"; close.textContent = "关闭";
    var del = document.createElement("button"); del.className = "btn"; del.textContent = "删除勾选的";
    del.style.background = "#c0392b";
    del.onclick = function () {
      var list = Object.keys(picked);
      if (!list.length) { hint("先勾选要删的"); return; }
      closeModal();
      deleteMany(list, function () { });
    };
    close.onclick = closeModal;
    foot.appendChild(close); foot.appendChild(del);
  });
}
export function toggleFav(dir) {
  if (!LIBRARY) { hint("收藏需要桌面版"); return; }
  var e = libEntry(dir);
  e.favorite = !e.favorite;
  libSave();
  invalidateCard(dir);
  renderShelf();
  hint(e.favorite ? "已加入收藏" : "已取消收藏");
}
export async function mergeBook(dir) {
  if (!DISK || !DISK.mergeBook) { hint("合并需要桌面版：请用「启动书库.cmd」打开"); return; }
  hint("正在合并 " + dir + " 的图片…（图多的话要等一会儿）");
  var r = null;
  try { r = await DISK.mergeBook(dir); } catch (e) { r = { ok: false, msg: String(e && e.message ? e.message : e) }; }
  if (!r || !r.ok) { hint("合并失败: " + ((r && r.msg) || "未知错误")); return; }
  hint((r.msg || "已合并") + "　正在重建这本书…");
  if (DISK.rescan) { try { await DISK.rescan({ quiet: true, dirs: [dir] }); } catch (e2) {} }
  hint("已合并: " + dir + "（图片都在 全部\\ 里，连续编号）");
}
export function setRating(dir, manual) {   // manual: true=18+ / false=全年龄 / null=恢复自动
  var e = libEntry(dir);
  var mf = manifestOf(dir);
  if (manual === null) { try { delete e.restricted; } catch (er) {} if (mf) mf.rating = mf.ratingAuto || ""; hint("分级已恢复自动判定"); }
  else { e.restricted = !!manual; if (mf) mf.rating = manual ? "18+" : ""; hint(manual ? "已标为 18+" : "已标为全年龄"); }
  libSave(); invalidateCard(dir); keepScroll(renderShelf);
}
export function confirmDelete(dir) {
  // 选择删除执行器: 桌面版走 IPC, Web 模式(手机浏览器)走 HTTP /api/delete
  var doDelete;
  if (DISK && DISK.deleteComic) {
    doDelete = async function () {
      var r = await DISK.deleteComic(dir);
      if (!r || !r.ok) throw new Error((r && r.msg) || "未知错误");
    };
  } else if (isWebMode()) {
    doDelete = async function () { await webDeleteBook(dir); };
  } else {
    hint("删除需要桌面版：请用「启动书库.cmd」打开书库");
    return;
  }

  showModal(function (box) {
    var h = document.createElement("h3"); h.textContent = "删除这本书？"; box.appendChild(h);
    var s = document.createElement("div"); s.className = "sub"; s.textContent = dir; box.appendChild(s);
    var w = document.createElement("div"); w.className = "stat"; w.style.color = "#f06a6a";
    w.textContent = "会同时删除：书库里的条目、阅读进度、以及磁盘上的整个漫画文件夹（含全部话与图片）。删除后无法恢复。";
    box.appendChild(w);
    var st = document.createElement("div"); st.className = "stat"; st.style.display = "none"; box.appendChild(st);
    var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
    var cancel = document.createElement("button"); cancel.className = "btn ghost"; cancel.textContent = "取消";
    var del = document.createElement("button"); del.className = "btn"; del.textContent = "删除";
    del.style.background = "#c0392b";
    foot.appendChild(cancel); foot.appendChild(del);
    cancel.onclick = closeModal;
    del.onclick = async function () {
      del.disabled = true; del.textContent = "删除中…";
      st.style.display = "block"; st.textContent = "正在删除…";
      try {
        await doDelete();
        if (LIBRARY && LIBRARY.comics) delete LIBRARY.comics[dir];
        // 从内存 COMICS 数组移除(Web 模式下没有 DISK.rescan, 手动更新界面)
        if (COMICS && COMICS.length) {
          for (var i = COMICS.length - 1; i >= 0; i--) {
            if (COMICS[i].dir === dir) { COMICS.splice(i, 1); break; }
          }
        }
        hint("已删除：" + dir);
        closeModal();
        if (DISK && DISK.rescan) await DISK.rescan({ offline: true, dirs: [dir] });   // 目录已删, 增量扫描会把这本书从 manifest 摘掉
        else { invalidateCard(dir); renderShelf(); }
      } catch (err) {
        del.disabled = false; del.textContent = "删除";
        st.textContent = "删除失败：" + (err && err.message ? err.message : String(err));
      }
    };
  });
}
export function loadBookTimes() {
  if (!DISK || !DISK.bookTimes) return;
  try { DISK.bookTimes().then(function (r) { if (r && r.times) { setBookTimes(r.times); renderShelf(); } }).catch(function () {}); } catch (e) {}
}
export function manageCat(cat, x, y) {
  var move = function (d) {
    var i = LIBRARY.categories.indexOf(cat);
    var j = i + d;
    if (i < 0 || j < 0 || j >= LIBRARY.categories.length) { hint("已经到头了"); return; }
    var arr = LIBRARY.categories.slice();
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    LIBRARY.categories = arr;
    libSave(); renderShelf(); saveShelfView(true); hint("已" + (d < 0 ? "左移" : "右移") + "：「" + cat + "」");
  };
  fillCtx([
    { t: "左移一位", f: function () { move(-1); } },
    { t: "右移一位", f: function () { move(1); } },
    { t: "重命名分类…", f: function () {
        askText("重命名分类", cat, function (v) {
          var i = LIBRARY.categories.indexOf(cat);
          if (i < 0) return;
          if (v !== cat && LIBRARY.categories.indexOf(v) >= 0) { hint("分类已存在"); return; }
          LIBRARY.categories[i] = v;
          var c = LIBRARY.comics || {};
          for (var k in c) {
            if (!c[k] || !c[k].categories) continue;
            var j = c[k].categories.indexOf(cat);
            if (j >= 0) c[k].categories[j] = v;
          }
          if (S.filter === cat) S.filter = v;
          if (S.filters && S.filters.length) { var q2 = S.filters.indexOf(cat); if (q2 >= 0) S.filters[q2] = v; }
          libSave(); renderShelf(); hint("已重命名");
        });
      } },
    { t: "删除分类", f: function () {
        askConfirm("删除分类「" + cat + "」", "只会删除这个分类本身，漫画文件和收藏都不会动。", "删除", function () {
          var i = LIBRARY.categories.indexOf(cat);
          if (i >= 0) LIBRARY.categories.splice(i, 1);
          var c = LIBRARY.comics || {};
          for (var k in c) {
            if (!c[k] || !c[k].categories) continue;
            var j = c[k].categories.indexOf(cat);
            if (j >= 0) c[k].categories.splice(j, 1);
          }
          if (S.filter === cat) S.filter = "all";
          libSave(); renderShelf(); hint("已删除分类");
        });
      } }
  ], x, y);
}

// ---- 由 core 注入 ----
let fillCtx, COMICS, DISK;

export function initShelfActions(ctx) {
  fillCtx = ctx.fillCtx; COMICS = ctx.COMICS; DISK = ctx.DISK
}
