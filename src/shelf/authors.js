// 作者名的规范化 / 合并, 以及按作者自动打标签
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 6 批)。
// 依赖: cur/fillCtx(函数) + AI_AUTHOR_RE/AUTHOR_IGNORE/PLATFORM_WORDS/COMICS/DISK(只读)。
//
// 这一块是"作者"这个概念的唯一定义处: 站点给的 author 字段混了社团名/作者名/
// 「社团 (作者)」三种形态, autoAuthor() 负责归一, authorKey() 负责取分组键。

import { LIBRARY } from '../app/state.js';
import { innerAuthor, entryOf, authorKey, libEntry, libSave, applyAuthorAliases } from '../library/store.js';
import { normName } from '../shared/text.js';
import { hint, showModal, closeModal, modalFoot, askText } from '../shared/ui.js';
import { autoTags } from '../shelf/book-actions.js';
import { renderShelf, invalidateCard, invalidateAllCards } from '../shelf/render.js';

export function autoAuthor(raw) {
  var n = normName(raw);
  if (!n) return "";
  if (PLATFORM_WORDS.indexOf(n.toLowerCase()) >= 0) return "";   // 平台名不是作者
  if (AI_AUTHOR_RE.test(n)) return "";                          // 纯 AI 标记不是作者
  if (AUTHOR_IGNORE[n]) return n;
  var inr = innerAuthor(n);
  // 大平台存的是「显示名 (@handle)」「昵称 (uid:123)」: 括号里是账号不是作者名 -> 用括号外的显示名
  if (inr && (/^[@＠]/.test(inr) || /^uid\s*[:：]/i.test(inr))) {
    var outer = n.replace(/[（(][^（()）]{1,40}[)）]\s*$/, "").trim();
    return outer || n;
  }
  if (inr && inr.length >= 2 && inr !== n) return inr;           // ① 括号里的作者为准
  return n;
}
export function authorGroups() {
  var g = {};
  for (var i = 0; i < COMICS.length; i++) {
    var dir = COMICS[i].dir, e = entryOf(dir);
    var raw = normName(e && e.author);
    var key = authorKey(raw) || "未标注";
    (g[key] = g[key] || { key: key, raws: {}, n: 0 });
    g[key].n++;
    if (raw && raw !== key) g[key].raws[raw] = 1;
  }
  return Object.keys(g).map(function (k) { return { key: k, n: g[k].n, raws: Object.keys(g[k].raws) }; })
    .sort(function (a, b) { return b.n - a.n || a.key.localeCompare(b.key, "zh"); });
}
export function saveAliasMap(map, cb) {
  try {
    var cur = JSON.parse(localStorage.getItem("authorAlias") || "{}");
    for (var k in map) cur[k] = map[k];
    localStorage.setItem("authorAlias", JSON.stringify(cur));
    applyAuthorAliases(map);
  } catch (e) {}
  if (DISK && DISK.saveAuthorAlias) {
    DISK.saveAuthorAlias(map).then(function (r) {
      if (r && r.ok) { hint("已保存作者别名，正在重建书库…"); if (DISK.rescan) DISK.rescan({ offline: true }).then(function () { hint("重建完成"); }); }
      else hint((r && r.msg) || "保存失败");
      if (cb) cb(r);
    });
  } else {
    hint("已在本机生效（要写进 author-alias.json 需要桌面版）");
    if (cb) cb({ ok: true });
  }
}
export function mergeAuthorInto(fromKey, toKey, cb) {
  var map = {};
  for (var i = 0; i < COMICS.length; i++) {
    var e = entryOf(COMICS[i].dir);
    var raw = normName(e && e.author);
    if (!raw) continue;
    if ((authorKey(raw) || "未标注") === fromKey) map[raw] = toKey;
  }
  if (!Object.keys(map).length) { hint("这一组没有可合并的原始写法"); return; }
  saveAliasMap(map, cb);
}
export function mergeAuthorDialog(fromKey, raws) {
  showModal(function (box) {
    var h = document.createElement("h3"); h.textContent = "把「" + fromKey + "」合并到…"; box.appendChild(h);
    var s = document.createElement("div"); s.className = "sub";
    s.textContent = "会把 " + (raws && raws.length ? "原始写法 " + raws.join(" / ") + " " : "") + "统一改成目标作者名；写进 _scripts\author-alias.json，重建后依然有效。";
    box.appendChild(s);
    var list = document.createElement("div");
    list.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px;max-height:200px;overflow:auto";
    authorGroups().filter(function (g) { return g.key !== fromKey && g.key !== "未标注"; }).forEach(function (g) {
      var b = document.createElement("button"); b.className = "tab"; b.textContent = g.key + " (" + g.n + ")";
      b.onclick = function () { closeModal(); mergeAuthorInto(fromKey, g.key, function () { renderShelf(); }); };
      list.appendChild(b);
    });
    box.appendChild(list);
    var l2 = document.createElement("label"); l2.textContent = "或者填一个新名字"; box.appendChild(l2);
    var ni = document.createElement("input"); ni.type = "text"; ni.placeholder = "例如：ヘルシーマン"; box.appendChild(ni);
    ni.onkeydown = function (e) { e.stopPropagation(); };
    modalFoot(box, function () {
      var v = normName(ni.value);
      closeModal();
      if (!v) { hint("名字不能为空"); return; }
      mergeAuthorInto(fromKey, v, function () { renderShelf(); });
    }, "合并");
  });
}
export function authorCtx(x, y, key, raws) {
  fillCtx([
    { t: "合并到其他作者…", f: function () { mergeAuthorDialog(key, raws); } },
    { t: "改名为…", f: function () {
        askText("把「" + key + "」改成新名字", key, function (v) {
          var nv = normName(v); if (!nv || nv === key) return;
          mergeAuthorInto(key, nv, function () { renderShelf(); });
        });
      } },
    { t: "标为「未标注」", f: function () { mergeAuthorInto(key, "", function () { renderShelf(); }); } },
    { t: "撤销这一组的自动合并（保留原样）", f: function () {
        var map = {};
        (raws && raws.length ? raws : [key]).forEach(function (r) { map[r] = r; AUTHOR_IGNORE[r] = 1; });
        try { var ig = JSON.parse(localStorage.getItem("authorAliasIgnore") || "[]"); for (var k in map) if (ig.indexOf(k) < 0) ig.push(k); localStorage.setItem("authorAliasIgnore", JSON.stringify(ig)); } catch (e) {}
        saveAliasMap(map, function () { renderShelf(); });
      } }
  ], x, y);
}
export function tagOne(dir) {
  if (!LIBRARY) { hint("打标签需要桌面版"); return; }
  var t = autoTags(dir);
  if (!t.length) { hint("这个书名里没有可识别的标签"); return; }
  var e = libEntry(dir), cur = e.tags || [], added = [];
  t.forEach(function (x) { if (cur.indexOf(x) < 0) { cur.push(x); added.push(x); } });
  e.tags = cur;
  libSave(); invalidateCard(dir); renderShelf();
  hint(added.length ? "已加标签: " + added.join(" ") : "标签已经有了: " + t.join(" "));
}
export function autoTagsAll() {
  if (!LIBRARY) { hint("打标签需要桌面版"); return; }
  var books = 0, cnt = 0;
  for (var i = 0; i < COMICS.length; i++) {
    var t = autoTags(COMICS[i].dir);
    if (!t.length) continue;
    var e = libEntry(COMICS[i].dir), cur = e.tags || [], added = false;
    t.forEach(function (x) { if (cur.indexOf(x) < 0) { cur.push(x); added = true; } });
    e.tags = cur;
    books++; if (added) cnt++;
  }
  libSave(); invalidateAllCards(); renderShelf();
  hint("扫过 " + books + " 本, 新打上标签 " + cnt + " 本");
}

// ---- 由 core 注入 ----
let cur, fillCtx, AI_AUTHOR_RE, AUTHOR_IGNORE, COMICS, DISK, PLATFORM_WORDS;

export function initShelfAuthors(ctx) {
  cur = ctx.cur; fillCtx = ctx.fillCtx; AI_AUTHOR_RE = ctx.AI_AUTHOR_RE; AUTHOR_IGNORE = ctx.AUTHOR_IGNORE; COMICS = ctx.COMICS; DISK = ctx.DISK; PLATFORM_WORDS = ctx.PLATFORM_WORDS
}
