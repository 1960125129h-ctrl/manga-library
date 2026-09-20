// 书库数据的存取层
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 枢纽清理)。挑它当第一块的原因:
// 这一批是全文件被引用最多的"胶水"—— libEntry 被 10 处、libSave 被 12 处、
// entryOf / manifestOf / cur 各 5 处引用, 而它们自己几乎不依赖别的(只需注入 4 项)。
// 搬走这一层, 其余函数的依赖面会立刻变窄。
//
// 归属划分:
//   · CACHE / saveTimer / libTimer 由本模块持有 —— 它们会被整体重新赋值或重设定时器,
//     不能按值注入给别的模块; core 启动时用 setCACHE() 把进度灌进来。
//   · PKEY / MKEY / CN_D / CN_U 只在这里用, 一起搬走。
//   · CMAP 依赖 COMICS, 所以在 initLibraryStore 里建(dir -> 条目 的查找表)。
//   · COMICS / DISK / autoAuthor / pages 由 core 注入(都只在声明时赋值一次, 按值注入安全)。
//
// 注意: 29 个函数全部 export。有些在 core 里不是"被调用"而是被当值传出去
// (initShelfRender({ ... authorOf: authorOf ... })), 少导一个就是运行时 undefined。

import { normName, capFirst, titleNorm } from '../shared/text.js';
import { nOf, pageList } from '../shared/chapter.js';
import { LIBRARY } from '../app/state.js';
import { bmAll } from '../shared/storage.js';
import { SEARCH_HAY, setSearchHay } from '../shelf/state.js';   // buildSearchHay 要写书架搜索用的缓存

// ---- 本模块持有的状态 ----
export let CACHE = null;      // 进度缓存(library.json 的 progress; 桌面版启动时灌入)
let saveTimer = null;         // 进度落盘的防抖定时器
let libTimer = null;          // library.json 落盘的防抖定时器

// ---- 只在本模块使用的常量 ----
const PKEY = "mangalib::prog::";
const MKEY = "mangalib::meta";
const CN_D = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const CN_U = { '十': 10, '百': 100, '千': 1000 };

export function totalPages(c) { var t = 0; for (var i = 0; i < c.chapters.length; i++) t += nOf(c.chapters[i]); return t; }
export function prog(dir) {
  if (CACHE) return CACHE[dir] || null;
  try { return JSON.parse(localStorage.getItem(PKEY + dir) || "null"); } catch (e) { return null; }
}
export function setProg(dir, o) {
  if (CACHE) {
    CACHE[dir] = o;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { DISK.setProgress(dir, o); }, 350);
    return;
  }
  try { localStorage.setItem(PKEY + dir, JSON.stringify(o)); } catch (e) {}
}
export function libSave() {
  if (libTimer) clearTimeout(libTimer);
  if (!DISK || !DISK.saveLibrary) return;   // 浏览器里只读, 不落盘(桌面版才会写 library.json)
  libTimer = setTimeout(function () { DISK.saveLibrary(LIBRARY); }, 500);
}
export function meta() {
  if (LIBRARY) {
    var m = {}, c = LIBRARY.comics || {};
    for (var k in c) { if (c[k] && c[k].lastRead) m["t::" + k] = c[k].lastRead; }
    return m;
  }
  try { return JSON.parse(localStorage.getItem(MKEY) || "{}"); } catch (e) { return {}; }
}
export function setMeta(o) {
  if (LIBRARY) {
    LIBRARY.comics = LIBRARY.comics || {};
    for (var k in o) {
      if (k.indexOf("t::") !== 0) continue;
      var d = k.slice(3);
      LIBRARY.comics[d] = LIBRARY.comics[d] || {};
      LIBRARY.comics[d].lastRead = o[k];
    }
    libSave();
    return;
  }
  try { localStorage.setItem(MKEY, JSON.stringify(o)); } catch (e) {}
}
export function libEntry(dir) {
  if (!LIBRARY) return null;
  LIBRARY.comics = LIBRARY.comics || {};
  if (!LIBRARY.comics[dir]) LIBRARY.comics[dir] = { favorite: false, categories: [], tags: [], note: "" };
  var e = LIBRARY.comics[dir];
  if (!e.categories) e.categories = [];
  if (!e.tags) e.tags = [];
  return e;
}
export function entryOf(dir) {
  if (LIBRARY && LIBRARY.comics && LIBRARY.comics[dir]) return LIBRARY.comics[dir];
  return CMAP[dir] || null;   // 浏览器(file://)没有 library.json -> 用 manifest 里带的元数据
}
export function innerAuthor(raw) {
  var m = normName(raw).match(/^(.{1,60}?)[（(]([^（()）]{1,40})[)）]?\s*$/);
  return m ? normName(m[2]) : "";
}
export function authorKey(raw) {
  var n = normName(raw);
  if (!n) return "";
  if (AUTHOR_ALIAS[n] !== undefined) return normName(AUTHOR_ALIAS[n]);
  var a = autoAuthor(n);
  if (!a) return "";
  // 纯英文/数字作者名统一为首字母大写, 合并大小写不一致的同人
  if (/^[A-Za-z0-9 _\-.@]+$/.test(a)) {
    var low = a.toLowerCase();
    // 全小写 -> 首字母大写; 多词按空格/短横线分词, 每个词首字母大写
    return low.replace(/(^|[ _\-.@])([a-z])/g, function(m, s, c) { return s + c.toUpperCase(); });
  }
  return a;
}
export function authorOf(dir) { var e = entryOf(dir); return authorKey(e && e.author) || "未标注"; }
export function platformOf(dir) {
  var e = entryOf(dir);
  var s = String((e && e.source && (e.source.site || e.source.url)) || "");
  if (!s) return "未标注";
  for (var i = 0; i < BIG_PLATS.length; i++) if (BIG_PLATS[i][0].test(s)) return BIG_PLATS[i][1];
  for (var j = 0; j < SITE_LABELS.length; j++) if (SITE_LABELS[j][0].test(s)) return SITE_LABELS[j][1];
  // 未识别的 site: 去掉协议/端口/路径, 用 host 或 id 本身(首字母大写)
  var host = s.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0].replace(/^www\./i, "");
  return host ? capFirst(host) : "未标注";
}
export function isBigPlat(dir) { var p = platformOf(dir); return p === "X" || p === "微博" || p === "pixiv"; }   // 抖音已按发布时间正序排, 默认从第一页看起, 不进倒序名单
export function unitQ(dir) { return isBigPlat(dir) ? "篇" : "话"; }
export function unitP(dir) { return isBigPlat(dir) ? "张" : "页"; }
export function manifestOf(dir) {   // 从 manifest 里取这本书(带 ai/work/char 字段)
  for (var i = 0; i < COMICS.length; i++) if (COMICS[i].dir === dir) return COMICS[i];
  return null;
}
export function countIn(f) { if (f === "bookmark") return bmAll().length;
  var n = 0;
  for (var i = 0; i < COMICS.length; i++) {
    if (f === "all") { n++; continue; }
    var e = entryOf(COMICS[i].dir);
    if (f === "fav") { if (e && e.favorite) n++; }
    else if (f === "history") { var ph2 = prog(COMICS[i].dir); if (ph2 && (ph2.ci || ph2.pi)) n++; }
    else if (f === "ai") { if (COMICS[i].ai) n++; }
    else if (f === "bookmark") { n += 0; }   // 书签数在下面单独处理
    else if (e && e.categories && e.categories.indexOf(f) >= 0) n++;
  }
  return n;
}
export function cn2num(run) { var total = 0, num = 0; for (var i = 0; i < run.length; i++) { var ch = run[i]; if (ch in CN_D) num = CN_D[ch]; else if (ch in CN_U) { total += (num || 1) * CN_U[ch]; num = 0; } } return total + num; }
export function sortKey(s) {
  return String(s).replace(/[零〇一二三四五六七八九十百千两]+/g, function (m) { return String(cn2num(m)).padStart(6, '0'); }).toLowerCase();
}
export function bookSortKey(c) { return sortKey(titleNorm(c && c.dir)); }
export function bookCmp(a, b) { var ka = bookSortKey(a), kb = bookSortKey(b); return ka.localeCompare(kb, 'zh', { numeric: true, sensitivity: 'base' }); }
export function groupLabelFor(dir, dim) {
  var ent = entryOf(dir), mf = manifestOf(dir);
  if (dim === 'author') { var ak = authorKey(ent && ent.author); return ak || '未标注'; }
  if (dim === 'rating') return (mf && mf.rating === '18+') ? '18+' : '非 18+';
  if (dim === 'work') return (mf && mf.work) || '未识别作品';
  if (dim === 'char') return (mf && mf.char) || '未识别角色';
  if (dim === 'plat') return platformOf(dir);
  return '';
}
export function buildSearchHay() {
  setSearchHay({});
  for (var i = 0; i < COMICS.length; i++) {
    var c = COMICS[i], e0 = entryOf(c.dir);
    SEARCH_HAY[c.dir] = (c.dir + " " + ((e0 && e0.tags) ? e0.tags.join(" ") : "") + " " + normName(e0 && e0.author) + " " + authorOf(c.dir) + " " + normName(e0 && e0.note)).toLowerCase();
  }
}
export function noteOf(dir) { var e = entryOf(dir); return normName(e && e.note); }
export function dupKey(dir) {
  return normName(String(dir || "").replace(/^漫画\//, ""))
    .replace(/[\[【][^\]】]*[\]】]/g, " ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/[\s_\-–—.,，。、:：;；!！?？'"“”‘’·|｜/\\]+/g, "")
    .toLowerCase();
}
export function revOf(dir) { try { var p = prog(dir); return !!(p && p.rev); } catch (e) { return false; } }
export function coverPage(c) {
  if (!c || !c.chapters || !c.chapters.length) return null;
  var ov = entryOf(c.dir) && entryOf(c.dir).coverOverride;
  if (ov && c.chapters[ov.ci]) {
    var pl0 = pageList(c, c.chapters[ov.ci]);
    if (pl0 && pl0.length && pl0[Math.min(ov.pi, pl0.length - 1)]) return pl0[Math.min(ov.pi, pl0.length - 1)];
  }
  if (!revOf(c.dir)) return null;
  for (var i = c.chapters.length - 1; i >= 0; i--) {
    var pl = pageList(c, c.chapters[i]);
    if (pl && pl.length) return pl[0];
  }
  return null;
}

// ---- 由 core 注入 ----
// COMICS / DISK 只在声明时赋值一次 -> 按值注入安全;
// autoAuthor / pages 是函数声明(会提升) -> 注入时一定已经是函数。
let COMICS, DISK, autoAuthor, pages;
let CMAP = null;       // dir -> 条目; 在 init 里建

export function initLibraryStore(ctx) {
  COMICS = ctx.COMICS; DISK = ctx.DISK;
  autoAuthor = ctx.autoAuthor; pages = ctx.pages;
  // 原来这段在 core 顶层直接跑(那时 COMICS 已就绪); 移到 init 语义不变
  CMAP = {}; for (var i = 0; i < COMICS.length; i++) CMAP[COMICS[i].dir] = COMICS[i];
}

export function setCACHE(v) { CACHE = v; }
export function getCACHE() { return CACHE; }
