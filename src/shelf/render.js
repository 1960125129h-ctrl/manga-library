// 书架渲染

//

// 抽出来的第三个域。手法同前两个: core 提供的东西用 initShelfRender(ctx) 注入,

// 用**同名模块级 let** 接住 -> 搬来的代码逐字不变。

//

// 状态分两处: 会被重新赋值的在 shelf/state.js(setter 改); 只赋值一次的仍在 core 按值注入。



// ---- 其它模块 ----

import { enc, normName } from '../shared/text.js';
import { fmtBytes } from '../shared/format.js';
import { nOf, chLabel, pageList } from '../shared/chapter.js';
import { loadAlbums, saveAlbums, manualOrder } from '../shared/storage.js';
import { hint, showModal, closeModal, askConfirm, askText } from '../shared/ui.js';
import { confirmDelete } from '../shelf/book-actions.js';
import { S, elGrid, LIBRARY } from '../app/state.js';
import { saveShelfView, applyFRowState } from '../shelf/filter-row.js';
import { SET } from '../settings/panel.js';
import { SEL, SEARCH_HAY, BOOKTIMES, justDraggedUntil, CARD_CACHE, dragCat, incCardSeq, setSel, setSearchHay, setCardCache, setCardSeq, setDragCat } from '../shelf/state.js';



// ---- 由 core 注入 ----

let COMICS, GROUP_DIM_LABEL, GROUP_DIM_ORDER, SORT_ITEMS, VTID, elAlbumBar, elCatTabs, elSearch, elStat, e2, f, raws, s;

let authorCtx, authorGroups, authorKey, authorOf, bookCmp, buildSearchHay, clampTags, countIn, coverPage, cur, deleteMany, entryOf, extractCardColor, fillCtx, flyOpenComic, groupLabelFor, inAlbum, libEntry, libSave, makeDraggable, makeGroupDrop, manageCat, manifestOf, meta, platformOf, prog, renderBookmarks, selHas, selRange, selToggle, showCtx, thumbOf, toggleFav, totalPages, unitP, unitQ, updateFilterBadge, visibleDirs, vtWrap;



export function initShelfRender(c) {

  const o = c || {};
  e2 = o.e2;
  f = o.f;
  raws = o.raws;
  s = o.s;

  COMICS = o.COMICS;
  GROUP_DIM_LABEL = o.GROUP_DIM_LABEL;
  GROUP_DIM_ORDER = o.GROUP_DIM_ORDER;
  SORT_ITEMS = o.SORT_ITEMS;
  VTID = o.VTID;
  elAlbumBar = o.elAlbumBar;
  elCatTabs = o.elCatTabs;
  elSearch = o.elSearch;
  elStat = o.elStat;

  authorCtx = o.authorCtx;
  authorGroups = o.authorGroups;
  authorKey = o.authorKey;
  authorOf = o.authorOf;
  bookCmp = o.bookCmp;
  buildSearchHay = o.buildSearchHay;
  clampTags = o.clampTags;
  countIn = o.countIn;
  coverPage = o.coverPage;
  cur = o.cur;
  deleteMany = o.deleteMany;
  entryOf = o.entryOf;
  extractCardColor = o.extractCardColor;
  fillCtx = o.fillCtx;
  flyOpenComic = o.flyOpenComic;
  groupLabelFor = o.groupLabelFor;
  inAlbum = o.inAlbum;
  libEntry = o.libEntry;
  libSave = o.libSave;
  makeDraggable = o.makeDraggable;
  makeGroupDrop = o.makeGroupDrop;
  manageCat = o.manageCat;
  manifestOf = o.manifestOf;
  meta = o.meta;
  platformOf = o.platformOf;
  prog = o.prog;
  renderBookmarks = o.renderBookmarks;
  selHas = o.selHas;
  selRange = o.selRange;
  selToggle = o.selToggle;
  showCtx = o.showCtx;
  thumbOf = o.thumbOf;
  toggleFav = o.toggleFav;
  totalPages = o.totalPages;
  unitP = o.unitP;
  unitQ = o.unitQ;
  updateFilterBadge = o.updateFilterBadge;
  visibleDirs = o.visibleDirs;
  vtWrap = o.vtWrap;

}



export function renderShelf() {
  vtWrap(function () { renderShelfNow(); });
}

export function renderShelfNow() {
  setCardSeq(0);
  try { document.body.classList.remove("shelf-autohide"); } catch (e) {}
  renderAuthorSel();
  if (S.filter === "bookmark") { renderBookmarks(); return; }
  var q = S.q.trim().toLowerCase();
  var m = meta();
  var list = [];
  for (var i = 0; i < COMICS.length; i++) {
    var c = COMICS[i];
    if (!inFilter(c.dir)) continue;
    if (q) {
      if (!SEARCH_HAY) buildSearchHay();
      var hay = SEARCH_HAY[c.dir] || "";
      if (hay.indexOf(q) < 0) continue;
    }
    list.push(c);
  }
  if (S.sort === "recent" || S.sort === "fav") {
    list.sort(function (a, b) {
      if (S.sort === "fav") {
        var va = (entryOf(a.dir) && entryOf(a.dir).favorite) ? 1 : 0;
        var vb = (entryOf(b.dir) && entryOf(b.dir).favorite) ? 1 : 0;
        if (va !== vb) return vb - va;
      }
      var ta = m["t::" + a.dir] || 0, tb = m["t::" + b.dir] || 0;
      if (ta !== tb) return tb - ta;
      return bookCmp(a, b);
    });
  } else if (S.sort === "time" || S.sort === "timeasc") {
    var asc = S.sort === "timeasc";
    list.sort(function (a, b) {
      var ea = entryOf(a.dir), eb = entryOf(b.dir);
      var ta = BOOKTIMES[a.dir] || a.addedAt || (ea && ea.addedAt) || (ea && ea.lastRead) || m["t::" + a.dir] || 0;
      var tb = BOOKTIMES[b.dir] || b.addedAt || (eb && eb.addedAt) || (eb && eb.lastRead) || m["t::" + b.dir] || 0;
      if (ta !== tb) return asc ? ta - tb : tb - ta;
      return bookCmp(a, b);
    });
  } else {
    list.sort(function (a, b) { return bookCmp(a, b); });
  }

  var dims = (S.groups && S.groups.length) ? S.groups.slice().filter(function (d) { return GROUP_DIM_LABEL[d]; }) : [];
  dims.sort(function (a, b) { return GROUP_DIM_ORDER.indexOf(a) - GROUP_DIM_ORDER.indexOf(b); });
  var GROUP_MODE = dims.length ? dims[0] : "";
  elGrid.classList.toggle("grouped", !!dims.length);
  elGrid.classList.toggle("h", !!SET.cardH);
  // 可视区外先用占位, 滚到再建真实卡片(降低手机端初始 DOM / 图片压力)
  var INITIAL_MOUNT = 14;
  var lazyMap = new Map();
  if (window.__shelfLazyObs) try { window.__shelfLazyObs.disconnect(); } catch (e) {}
  window.__shelfLazyObs = ("IntersectionObserver" in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var ph = en.target;
      var c = lazyMap.get(ph);
      if (!c) return;
      window.__shelfLazyObs.unobserve(ph);
      var cel = card(c, m);
      cel.style.display = "";
      if (ph.dataset.group === "1") makeDraggable(cel, c.__groupList, c.__groupName, c.__groupMode);
      ph.replaceWith(cel);
      lazyMap.delete(ph);
    });
    requestAnimationFrame(function () {
      var pend = elGrid.querySelectorAll(".pending-clamp");
      for (var pi = 0; pi < pend.length; pi++) { pend[pi].classList.remove("pending-clamp"); clampTags(pend[pi]); }
    });
  }, { root: elGrid, rootMargin: "700px 0px" }) : null;
  function phFor(c, groupList, groupName, groupMode) {
    var ph = document.createElement("div");
    ph.className = "card-placeholder" + (SET.cardH ? " h" : "");
    ph.dataset.dir = c.dir;
    if (groupList) {
      ph.dataset.group = "1";
      c.__groupList = groupList;
      c.__groupName = groupName;
      c.__groupMode = groupMode;
    }
    lazyMap.set(ph, c);
    if (window.__shelfLazyObs) window.__shelfLazyObs.observe(ph);
    return ph;
  }
  var mountedCount = 0;
  if (!list.length) {
    elGrid.innerHTML = "";
    var d = document.createElement("div");
    d.id = "empty";
    d.textContent = COMICS.length ? "没有符合条件的漫画" : "书库里还没有漫画。把漫画文件夹放进书库根目录, 双击 更新书库.cmd";
    elGrid.appendChild(d);
  } else if (!dims.length) {
    elGrid.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var k = 0; k < list.length; k++) {
      if (mountedCount < INITIAL_MOUNT) { frag.appendChild(card(list[k], m)); mountedCount++; }
      else frag.appendChild(phFor(list[k]));
    }
    elGrid.appendChild(frag);
  } else if (dims.length) {
    elGrid.innerHTML = "";
    // 分组: 每组 = 标题行 + 该组卡片网格; 多维时 key = "维度1 / 维度2 / ..."
    var gmap = {};
    for (var gi = 0; gi < list.length; gi++) {
      var cdir = list[gi].dir;
      var an = dims.map(function (d) { return groupLabelFor(cdir, d); }).join(" / ");
      (gmap[an] = gmap[an] || []).push(list[gi]);
    }
    var gkeys = Object.keys(gmap).sort(function (x, y) {
      var xLast = x.split(" / ").pop(), yLast = y.split(" / ").pop();
      if (xLast === "未标注") return 1;
      if (yLast === "未标注") return -1;
      var dx = gmap[x].length, dy = gmap[y].length;
      if (dx !== dy) return dy - dx;              // 书多的组在前
      return x.localeCompare(y, "zh", { numeric: true, sensitivity: "base" });
    });
    for (var gk = 0; gk < gkeys.length; gk++) {
      var gname = gkeys[gk];
      var git = gmap[gname].slice();
      var ord0 = manualOrder();
      git.sort(function (a, b) {
        var ra = ord0[a.dir], rb = ord0[b.dir];
        if (ra === undefined && rb === undefined) return 0;
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        return ra - rb;
      });
      gmap[gname] = git;
      var sec = document.createElement("div"); sec.className = "agroup" + (git.length === 1 ? " single" : "");
      var hd = document.createElement("div"); hd.className = "ahead";
      hd.title = dims.length === 1 ? (GROUP_DIM_LABEL[GROUP_MODE] || "") : ("分组: " + dims.map(function (d) { return GROUP_DIM_LABEL[d]; }).join(" → "));
      (function (gName) {   // 注意: gname 是 var, 循环里所有闭包共用一份, 必须当场取值
        if (!(dims.length === 1 && GROUP_MODE === "author")) return;   // 只有纯"按作者"分组才做合并作者那套
        hd.oncontextmenu = function (ev) {
          if (gName === "未标注") return;
          ev.preventDefault();
          var g2 = authorGroups().filter(function (x) { return x.key === gName; })[0] || { raws: [] };
          authorCtx(ev.clientX, ev.clientY, gName, g2.raws);
        };
      })(gname);
      var nm = document.createElement("span"); nm.textContent = gname;   // 不加图标(按用户要求去掉 emoji)
      var ct = document.createElement("span"); ct.className = "cnt"; ct.textContent = gmap[gname].length + " 本";
      hd.appendChild(nm); hd.appendChild(ct); sec.appendChild(hd);
      var wrap = document.createElement("div"); wrap.className = "agrid" + (SET.cardH ? " h" : "");
      // 大平台(X/抖音/微博/pixiv): 组里的"书"其实是一个个人的图包 -> 聚合成作者卡片(仅纯按平台分组时)
      if (dims.length === 1 && GROUP_MODE === "plat" && (gname === "X" || gname === "抖音" || gname === "微博" || gname === "pixiv")) {
        var amap = {}, akeys = [];
        for (var ai = 0; ai < gmap[gname].length; ai++) {
          var bc = gmap[gname][ai], be = entryOf(bc.dir);
          var ak2 = authorKey(be && be.author) || "未标注";
          if (!amap[ak2]) { amap[ak2] = []; akeys.push(ak2); }
          amap[ak2].push(bc);
        }
        akeys.sort(function (x, y) { return amap[y].length - amap[x].length || x.localeCompare(y, "zh"); });
        for (var aj = 0; aj < akeys.length; aj++) {
          var books2 = amap[akeys[aj]], chs = 0, pgs = 0;
          for (var bk = 0; bk < books2.length; bk++) { chs += books2[bk].chapters.length; pgs += totalPages(books2[bk]); }
          var ac = document.createElement("div"); ac.className = "card acard";
          var atp = document.createElement("div"); atp.className = "thumb";
          var acov = coverPage(books2[0]) || books2[0].cover || (books2[0].chapters[0] ? thumbOf(books2[0], books2[0].chapters[0], 0) : null);
          if (acov) { var aim = document.createElement("img"); aim.loading = "lazy"; aim.decoding = "async"; aim.src = enc(acov); atp.appendChild(aim); }
          else { var ann = document.createElement("div"); ann.className = "none"; ann.textContent = "无封面"; atp.appendChild(ann); }
          ac.appendChild(atp);
          var amt = document.createElement("div"); amt.className = "cmeta";
          var at2 = document.createElement("div"); at2.className = "ctitle"; at2.textContent = akeys[aj]; amt.appendChild(at2);
          var asub = document.createElement("div"); asub.className = "csub"; asub.textContent = books2.length + " 个图包 · " + chs + " 篇 · " + pgs + " 张"; amt.appendChild(asub);
          var asrc = document.createElement("div"); asrc.className = "csrc"; asrc.textContent = "来源 " + gname; amt.appendChild(asrc);
          ac.appendChild(amt);
          (function (who, books2) {
            ac.onclick = function () {
              S.authors = [who];   // chips 会在 renderShelf 里自动高亮对应项
              renderShelf(); saveShelfView(); hint("只看 " + who + " 的图包（筛选面板里可加选/清空）");
            };
            ac.oncontextmenu = function (ev) { ev.preventDefault(); if (books2[0]) showCtx(ev.clientX, ev.clientY, books2[0].dir); };
          })(akeys[aj], books2);
          wrap.appendChild(ac);
        }
        sec.appendChild(wrap); elGrid.appendChild(sec);
        gmap[gname] = git;
        continue;
      }
      for (var gj = 0; gj < gmap[gname].length; gj++) {
        var bc = gmap[gname][gj];
        if (mountedCount < INITIAL_MOUNT) {
          var cel = card(bc, m);
          makeDraggable(cel, gmap[gname], gname, GROUP_MODE);
          wrap.appendChild(cel);
          mountedCount++;
        } else {
          wrap.appendChild(phFor(bc, gmap[gname], gname, GROUP_MODE));
        }
      }
      sec.appendChild(wrap); elGrid.appendChild(sec);
      makeGroupDrop(sec, gname, GROUP_MODE);   // 支持把卡片从别的组拖进来(改分组)
    }
  } else {
    for (var k = 0; k < list.length; k++) elGrid.appendChild(card(list[k], m));
  }
  elStat.textContent = "共 " + COMICS.length + " 本 · 显示 " + list.length + " 本";
  renderCatTabs();
  renderAlbumBar();
  renderPlatSel();
  renderRatingSel();
  renderWorkSel();
  renderGroupSel();
  renderSortSel();
  updateFilterBadge();
  renderSelBar();
  // 卡片都挂到 #grid 后再测 tag 排数(构建时 detached, offsetTop=0 测不了)
  requestAnimationFrame(function () {
    var pend = elGrid.querySelectorAll(".pending-clamp");
    for (var pi = 0; pi < pend.length; pi++) {
      pend[pi].classList.remove("pending-clamp");
      clampTags(pend[pi]);
    }
  });
}

export function card(c, m) {
  if (CARD_CACHE[c.dir]) {
    var cached = CARD_CACHE[c.dir];
    cached.classList.toggle("sel", selHas(c.dir));
    return cached;
  }
  var el = document.createElement("div");
  el.className = "card" + (SET.cardH ? " h" : "") + (selHas(c.dir) ? " sel" : "");
  el.setAttribute("data-dir", c.dir);
  if (VTID < 120) el.style.viewTransitionName = "c" + (VTID++);   // 让这张卡片在重排时"平移"而不是闪一下
  var tp = document.createElement("div");
  tp.className = "thumb";
  var revCov = coverPage(c);
  var first = revCov || pageList(c, c.chapters[0])[0];
  if (revCov || c.cover || first) {
    var im = document.createElement("img");
    im.loading = "lazy"; im.decoding = "async";
    if (incCardSeq() < 8) im.fetchPriority = "high";   // 首屏前 8 张优先
    im.src = enc(revCov || c.cover || first);
    im.onload = function() {
      if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) extractCardColor(im, el);
    };
    tp.appendChild(im);
  } else {
    var nn = document.createElement("div"); nn.className = "none"; nn.textContent = "无封面"; tp.appendChild(nn);
  }
  var ent = entryOf(c.dir);
  if (LIBRARY) {
    var st = document.createElement("button");
    st.className = "star" + (ent && ent.favorite ? " on" : "");
    st.textContent = (ent && ent.favorite) ? "★" : "☆";
    st.title = "收藏 / 取消收藏";
    st.onclick = function (ev) { ev.stopPropagation(); toggleFav(c.dir); };
    tp.appendChild(st);
  }
  // 手机端删除按钮(桌面端通过 CSS 隐藏)
  var delb = document.createElement("button");
  delb.className = "delbtn";
  delb.textContent = "✕";
  delb.title = "删除本书";
  delb.onclick = function (ev) { ev.stopPropagation(); confirmDelete(c.dir); };
  delb.oncontextmenu = function (ev) { ev.preventDefault(); ev.stopPropagation(); };
  tp.appendChild(delb);
  if (c.rating === "18+") {   // 限制级角标
    var r18b = document.createElement("div"); r18b.className = "r18badge"; r18b.textContent = "18+";
    r18b.title = "限制级（H 站下载且没有找到非H标记）";
    tp.appendChild(r18b);
  }
  if (c.ai) {   // AI 生成角标
    var aib = document.createElement("div"); aib.className = "aibadge"; aib.textContent = "AI";
    aib.title = "这本书的书名/简介里识别到 AI 生成（AI 翻译、AI 修图上色不算）";
    tp.appendChild(aib);
  }
  el.appendChild(tp);

  var mt = document.createElement("div");
  mt.className = "cmeta";
  var t = document.createElement("div"); t.className = "ctitle"; t.textContent = (c.name || c.dir); t.title = (c.name || c.dir); mt.appendChild(t);
  var ak = authorKey(ent && ent.author);
  if (ak) {
    var au = document.createElement("div"); au.className = "cauthor"; au.textContent = ak;
    var rawA = normName(ent && ent.author);
    if (rawA && rawA !== ak) au.title = "原始写法: " + rawA;   // 合并过的话悬停能看到原文
    // 点作者 = 只看这个作者的书(和筛选面板里的作者 chips 同一套状态)
    au.style.cursor = "pointer";
    au.title = (au.title ? au.title + " · " : "") + "点一下：只看「" + ak + "」的书";
    au.onclick = function (ev) {
      ev.stopPropagation();
      S.authors = [ak];
      renderShelf(); saveShelfView(true);
    };
    mt.appendChild(au);
  } else if (c.ai) {
    // AI 角标已在角标区显示, 作者位置不再重复"AI 生成"
  }
  if (c.work || c.char) {   // 作品 · 角色
    var wl = document.createElement("div"); wl.className = "cwt";
    wl.textContent = [c.work, c.char].filter(Boolean).join(" · ");
    mt.appendChild(wl);
  }
  var sub = document.createElement("div"); sub.className = "csub";
  sub.textContent = c.chapters.length + " " + unitQ(c.dir) + " · " + totalPages(c) + " " + unitP(c.dir) + (c.size ? " · " + fmtBytes(c.size) : ""); mt.appendChild(sub);
  if (ent && ent.source && ent.source.site) {
    var sr = document.createElement("div"); sr.className = "csrc"; sr.textContent = "来源 " + ent.source.site; mt.appendChild(sr);
  }

  var p = prog(c.dir);
  var done = 0, lbl = "尚未开始";
  if (p && p.ci < c.chapters.length) {
    for (var i = 0; i < p.ci; i++) done += nOf(c.chapters[i]);
    done += Math.min(p.pi || 0, nOf(c.chapters[p.ci]) - 1);
    lbl = chLabel(c.chapters[p.ci]) + "  " + ((p.pi || 0) + 1) + "/" + nOf(c.chapters[p.ci]);
  }
  var bar = document.createElement("div"); bar.className = "bar";
  var fill = document.createElement("i");
  var pct = totalPages(c) ? Math.round(done / totalPages(c) * 100) : 0;
  fill.style.width = (p ? Math.max(1, pct) : 0) + "%";
  bar.appendChild(fill); mt.appendChild(bar);
  if (ent && ((ent.tags && ent.tags.length) || (ent.categories && ent.categories.length))) {
    var tw = document.createElement("div"); tw.className = "ctags";
    var ci, _cats = ent.categories || [], _tags = ent.tags || [];
    var seenTag = {};   // 去重: 分类里已经出现过的词, 标签里不再重复挂一次
    for (ci = 0; ci < _cats.length; ci++) {
      if (seenTag[_cats[ci]]) continue;
      seenTag[_cats[ci]] = 1;
      var s1 = document.createElement("span"); s1.className = "ctag cat"; s1.textContent = _cats[ci];
      s1.title = "点一下：按分类「" + _cats[ci] + "」筛选";
      s1.onclick = function (ev) { ev.stopPropagation(); S.filter = this.textContent; S.q = ""; if (elSearch) elSearch.value = ""; if (window.__qclearSync) window.__qclearSync(); renderShelf(); saveShelfView(true); };
      tw.appendChild(s1);
    }
    for (ci = 0; ci < _tags.length; ci++) {
      if (seenTag[_tags[ci]]) continue;
      seenTag[_tags[ci]] = 1;
      var s2 = document.createElement("span"); s2.className = "ctag tag"; s2.textContent = "#" + _tags[ci];
      s2.title = "点一下：搜索标签「" + _tags[ci] + "」";
      s2.onclick = function (ev) { ev.stopPropagation(); S.q = this.textContent.slice(1); if (elSearch) elSearch.value = S.q; if (window.__qclearSync) window.__qclearSync(); renderShelf(); saveShelfView(true); };
      tw.appendChild(s2);
    }
    mt.appendChild(tw);
    tw.classList.add("pending-clamp");   // 卡片挂载后由 renderShelf 统一测量折叠(此时 detached, offsetTop=0 测不了)
  }
  var _note = normName(ent && ent.note);
  if (_note) {
    var nd = document.createElement("div"); nd.className = "cnote"; nd.textContent = _note; nd.title = "备注：" + _note;
    mt.appendChild(nd);
  }
  el.appendChild(mt);   // 卡片右侧文字区(书名/作者/进度/标签/备注) —— 少了这一行整块都不显示
  el.onclick = function (ev) {
    if (Date.now() < justDraggedUntil) return;   // 刚拖完, 忽略这次 click
    if (ev && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); selToggle(c.dir); return; }        // Ctrl 点: 加/减选
    if (ev && ev.shiftKey) { ev.preventDefault(); selRange(c.dir); return; }                        // Shift 点: 范围选
    if (SEL.length) { setSel([]); renderShelf(); hint("已取消选择"); return; }   // 先清选择, 再点才进书
    if (ev && ev.target && ev.target.closest && !ev.target.closest('.thumb')) return;   // 只有点封面才开书
    flyOpenComic(c, el.querySelector(".thumb img"));   // 封面飞进阅读器
  };
  el.oncontextmenu = function (ev) { ev.preventDefault(); showCtx(ev.clientX, ev.clientY, c.dir); };
  CARD_CACHE[c.dir] = el;
  return el;
}

export function invalidateCard(dir) { if (dir && CARD_CACHE[dir]) { CARD_CACHE[dir].remove(); delete CARD_CACHE[dir]; } setSearchHay(null); }

export function invalidateAllCards() { for (var k in CARD_CACHE) { if (CARD_CACHE[k].parentNode) CARD_CACHE[k].remove(); } setCardCache({}); setSearchHay(null); }

export function inFilter(dir) {
  var mf = manifestOf(dir);
  // 专辑过滤: 选了专辑就只看专辑里的书
  if (S.album && !inAlbum(dir)) return false;
  // 分级多选(并集): 空 = 全部
  if (S.ratings && S.ratings.length) {
    var r = mf && mf.rating;
    var okR = (S.ratings.indexOf("18+") >= 0 && r === "18+") || (S.ratings.indexOf("sfw") >= 0 && r !== "18+");
    if (!okR) return false;
  }
  // 作品多选(并集): 空 = 全部; "" 代表"未识别作品"
  if (S.works && S.works.length) {
    var wv = (mf && mf.work) || "";
    var hitW = false;
    for (var wi = 0; wi < S.works.length; wi++) {
      var wwant = S.works[wi] === "" ? "" : S.works[wi];
      if (wv === wwant) { hitW = true; break; }
    }
    if (!hitW) return false;
  }
  // 平台多选(并集): 空 = 全部; "AI 生成" 是虚拟平台
  if (S.plats && S.plats.length) {
    var pf = platformOf(dir), hitP = false;
    for (var pi = 0; pi < S.plats.length; pi++) {
      var pl = S.plats[pi];
      if (pl === "AI 生成") { if (mf && mf.ai) { hitP = true; break; } continue; }
      if (pf === pl) { hitP = true; break; }
    }
    if (!hitP) return false;
  }
  // 作者多选(并集): 空 = 全部; "" 代表"未标注"
  if (S.authors && S.authors.length) {
    var ao = authorOf(dir), hitA = false;
    for (var ai = 0; ai < S.authors.length; ai++) {
      var want = S.authors[ai] === "" ? "未标注" : S.authors[ai];
      if (ao === want) { hitA = true; break; }
    }
    if (!hitA) return false;
  }
  if (!LIBRARY) return true;
  var e = entryOf(dir);
  // 分类多选: 勾了几个分类就显示"落在其中任意一个"的书(并集)
  if (S.filters && S.filters.length) {
    var cs = (e && e.categories) || [];
    for (var fi = 0; fi < S.filters.length; fi++) if (cs.indexOf(S.filters[fi]) >= 0) return true;
    return false;
  }
  if (S.filter === "all") return true;
  if (S.filter === "ai") return !!(mf && mf.ai);
  if (S.filter === "fav") return !!(e && e.favorite);
  if (S.filter === "history") { var ph = prog(dir); return !!(ph && (ph.ci || ph.pi)); }
  return !!(e && e.categories && e.categories.indexOf(S.filter) >= 0);
}

export function renderSelBar() {
  var bar = document.getElementById("selbar");
  if (!bar) return;
  bar.classList.toggle("hide", !SEL.length);
  var n = document.getElementById("seln");
  if (n) n.textContent = "已选 " + SEL.length + " 本";
  // 专辑视图: 显示"移出专辑"; 普通视图: 显示"新建专辑"
  var newBtn = document.getElementById("selalbum");
  var rmBtn = document.getElementById("selremovealbum");
  if (newBtn) newBtn.classList.toggle("hide", !!S.album);
  if (rmBtn) rmBtn.classList.toggle("hide", !S.album);
}

export function selTags() {
  if (!SEL.length) return;
  if (!LIBRARY) { hint("标签需要桌面版"); return; }
  showModal(function (box) {
    var h = document.createElement("h3"); h.textContent = "给 " + SEL.length + " 本加标签"; box.appendChild(h);
    var sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = "多个标签用空格/逗号分开；默认追加（原来有别的标签会保留），已存在的不会重复。";
    box.appendChild(sub);
    var all = {};
    for (var d in LIBRARY.comics) { var t = LIBRARY.comics[d].tags || []; for (var i = 0; i < t.length; i++) all[t[i]] = 1; }
    var names = Object.keys(all);
    if (names.length) {
      var l0 = document.createElement("label"); l0.textContent = "已有标签（点一下加进输入框）"; box.appendChild(l0);
      var chips = document.createElement("div");
      chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px";
      names.forEach(function (nm) {
        var c2 = document.createElement("button"); c2.className = "tab"; c2.textContent = "#" + nm;
        c2.onclick = function () { inp.value = (inp.value.trim() ? inp.value.trim() + " " : "") + nm; inp.focus(); };
        chips.appendChild(c2);
      });
      box.appendChild(chips);
    }
    var l1 = document.createElement("label"); l1.textContent = "要加的标签"; box.appendChild(l1);
    var inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "例如：无修正 全彩 汉化";
    box.appendChild(inp);
    inp.onkeydown = function (e) { e.stopPropagation(); };
    var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
    var cancel = document.createElement("button"); cancel.className = "btn ghost"; cancel.textContent = "取消";
    var over = document.createElement("button"); over.className = "btn ghost"; over.textContent = "覆盖（清掉旧标签）";
    var ok = document.createElement("button"); ok.className = "btn"; ok.textContent = "追加";
    foot.appendChild(cancel); foot.appendChild(over); foot.appendChild(ok);
    cancel.onclick = closeModal;
    function apply(replace) {
      var arr = inp.value.split(/[\s,，;；]+/).filter(Boolean);
      closeModal();
      for (var i2 = 0; i2 < SEL.length; i2++) {
        var e3 = libEntry(SEL[i2]);
        if (replace) e3.tags = arr.slice();
        else {
          var cur = e3.tags || [];
          for (var j = 0; j < arr.length; j++) if (cur.indexOf(arr[j]) < 0) cur.push(arr[j]);
          e3.tags = cur;
        }
      }
      libSave();
      var n = SEL.length; setSel([]);
      renderShelf();
      hint((replace ? "已覆盖 " : "已加标签: ") + n + " 本");
    }
    ok.onclick = function () { apply(false); };
    over.onclick = function () { apply(true); };
    setTimeout(function () { inp.focus(); }, 40);
  });
}

export function renderCatTabs() {
  if (!elCatTabs) return;
  elCatTabs.innerHTML = "";
  if (!LIBRARY) return;
  var tabs = [{ k: "all", n: "全部" }, { k: "bookmark", n: "书签" }, { k: "history", n: "历史阅读" }, { k: "fav", n: "收藏" }, { k: "ai", n: "AI 生成" }];
  for (var i = 0; i < LIBRARY.categories.length; i++) tabs.push({ k: LIBRARY.categories[i], n: LIBRARY.categories[i] });
  var ICONS = {
    all: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    bookmark: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    history: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    fav: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    ai: '<span style="display:inline-block;background:var(--surface3);color:var(--fg2);font-size:9px;font-weight:700;border-radius:3px;padding:0 4px;line-height:14px;vertical-align:-1px;margin-right:3px">AI</span>'
  };
  tabs.forEach(function (t) {
    var b = document.createElement("button");
    var multiOn = !!(S.filters && S.filters.indexOf(t.k) >= 0);
    b.className = "tab" + ((multiOn || (!(S.filters && S.filters.length) && S.filter === t.k)) ? " on" : "") + (multiOn ? " multi" : "");
    var html = (SET.catIcons && ICONS[t.k] ? ICONS[t.k] : '') + (SET.catLabels ? t.n : '');
    b.innerHTML = html || t.n;
    var c = document.createElement("span"); c.className = "cnt"; c.textContent = countIn(t.k);
    b.appendChild(c);
    b.onclick = function (ev) {
      var isCat = t.k !== "all" && t.k !== "fav" && t.k !== "history" && t.k !== "bookmark";
      if (isCat && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) {   // Ctrl/Shift+点 = 多选分类
        S.filters = (S.filters || []).slice();
        var at = S.filters.indexOf(t.k);
        if (at >= 0) S.filters.splice(at, 1); else S.filters.push(t.k);
        S.filter = "all";
        hint(S.filters.length ? ("已选 " + S.filters.length + " 个分类: " + S.filters.join(" + ")) : "已取消多选");
      } else {
        S.filters = [];
        S.filter = t.k;
      }
      renderShelf(); saveShelfView(true);
    };
    if (t.k !== "all" && t.k !== "fav" && t.k !== "history" && t.k !== "bookmark") {
      b.title = "点：只看这个分类　Ctrl/Shift+点：多选分类　拖动：调顺序　右键：改名/删除/左右移";
      b.draggable = true;
      b.ondragstart = function (ev) { setDragCat(t.k); try { ev.dataTransfer.setData("text/plain", t.k); ev.dataTransfer.effectAllowed = "move"; } catch (e2) {} };
      b.ondragover = function (ev) { if (dragCat && dragCat !== t.k) { ev.preventDefault(); b.classList.add("dragover"); } };
      b.ondragleave = function () { b.classList.remove("dragover"); };
      b.ondrop = function (ev) {
        ev.preventDefault(); b.classList.remove("dragover");
        if (!dragCat || dragCat === t.k) { setDragCat(null); return; }
        var arr = LIBRARY.categories.slice();
        var from = arr.indexOf(dragCat), to = arr.indexOf(t.k);
        setDragCat(null);
        if (from < 0 || to < 0) return;
        var moved = arr.splice(from, 1)[0];
        arr.splice(to, 0, moved);   // 拖到目标位置(往后拖落在目标之后, 往前拖落在目标之前)
        LIBRARY.categories = arr;
        libSave(); renderShelf(); saveShelfView(true); hint("分类顺序已调整");
      };
      b.ondragend = function () { setDragCat(null); };
    }
    if (t.k !== "all" && t.k !== "fav" && t.k !== "history" && t.k !== "bookmark") {
      b.title = "右键：重命名 / 删除此分类";
      b.oncontextmenu = function (ev) { ev.preventDefault(); ev.stopPropagation(); manageCat(t.k, ev.clientX, ev.clientY); };
    }
    elCatTabs.appendChild(b);
  });
  var add = document.createElement("button");
  add.className = "tab add"; add.textContent = "+"; add.title = "新建分类"; add.style.fontSize = "16px"; add.style.fontWeight = "700"; add.style.lineHeight = "1";
  add.onclick = function () {
    askText("新建分类", "", function (v) {
      if (LIBRARY.categories.indexOf(v) >= 0) { hint("分类已存在"); return; }
      LIBRARY.categories.push(v);
      libSave(); S.filter = v; renderShelf(); saveShelfView(true); hint("已新建分类「" + v + "」");
    });
  };
  elCatTabs.appendChild(add);
}

export function renderAlbumBar() {
  if (!elAlbumBar) return;
  // 清理: 专辑里指向已删除书的条目去掉
  var albums = loadAlbums();
  var validDirs = {};
  for (var ci = 0; ci < COMICS.length; ci++) validDirs[COMICS[ci].dir] = true;
  var changed = false;
  for (var an in albums) {
    var before = albums[an].length;
    albums[an] = albums[an].filter(function (d) { return validDirs[d]; });
    if (albums[an].length !== before) changed = true;
    if (!albums[an].length) { delete albums[an]; changed = true; if (S.album === an) S.album = ""; }
  }
  if (changed) saveAlbums(albums);
  var names = Object.keys(albums);
  if (!names.length) { elAlbumBar.classList.add("hide"); elAlbumBar.innerHTML = ""; return; }
  elAlbumBar.classList.remove("hide");
  elAlbumBar.innerHTML = "";
  // 每个专辑
  names.forEach(function (name) {
    var b = document.createElement("button");
    b.className = "abtn" + (S.album === name ? " on" : "");
    b.textContent = name;
    var c = document.createElement("span"); c.className = "cnt"; c.textContent = albums[name].length;
    b.appendChild(c);
    b.onclick = function () { S.album = (S.album === name ? "" : name); setSel([]); renderShelf(); };
    b.oncontextmenu = function (ev) {
      ev.preventDefault();
      fillCtx([
        { t: "重命名", f: function () { askText("重命名专辑", name, function (newName) {
          if (!newName || newName === name) return;
          var a = loadAlbums();
          if (a[newName]) { hint("专辑名已存在"); return; }
          a[newName] = a[name]; delete a[name]; saveAlbums(a);
          if (S.album === name) S.album = newName;
          renderShelf(); hint("已重命名");
        }); } },
        { t: "解散专辑（不删磁盘文件）", f: function () {
          var a = loadAlbums(); delete a[name]; saveAlbums(a);
          if (S.album === name) S.album = "";
          renderShelf(); hint("已解散专辑");
        } },
        { t: "解散专辑并删除磁盘上的书…", f: function () {
          var books = (loadAlbums()[name] || []).slice();
          askConfirm("删除专辑里的 " + books.length + " 本书？", "会同时删除磁盘上的漫画文件夹、书库条目和阅读进度。无法恢复。", "全部删除", function () {
            deleteMany(books, function () {
              var a2 = loadAlbums(); delete a2[name]; saveAlbums(a2);
              if (S.album === name) S.album = "";
              renderShelf();
            });
          });
        } },
      ], ev.clientX, ev.clientY);
    };
    elAlbumBar.appendChild(b);
  });
}

export function renderChips(boxId, items, selected, onPick) {
  var box = document.getElementById(boxId);
  if (!box) return;
  var selSet = {}; (selected || []).forEach(function (v) { selSet[v] = 1; });
  box.innerHTML = "";
  var cAll = document.createElement("span");
  cAll.className = "chip all" + ((!selected || !selected.length) ? " sel" : "");
  cAll.textContent = "全部";
  cAll.onclick = function () { selected.length = 0; onPick(); };
  box.appendChild(cAll);
  items.forEach(function (it) {
    var c = document.createElement("span");
    var on = !!selSet[it.value];
    c.className = "chip" + (on ? " sel" : "");
    c.textContent = it.label;
    if (on) { var x = document.createElement("span"); x.className = "x"; x.textContent = "✕"; c.appendChild(x); }
    c.onclick = function () {
      var i = selected.indexOf(it.value);
      if (i >= 0) selected.splice(i, 1); else selected.push(it.value);
      onPick();
    };
    box.appendChild(c);
  });
}

export function renderPlatSel() {
  var items = [], names = {}, order = [];
  for (var i = 0; i < COMICS.length; i++) {
    var p = platformOf(COMICS[i].dir);
    if (names[p] === undefined) { names[p] = 0; order.push(p); }
    names[p]++;
  }
  order.sort(function (x, y) {
    if (x === "未标注") return 1;
    if (y === "未标注") return -1;
    return names[y] - names[x] || x.localeCompare(y, "zh");
  });
  var aiN = 0;
  for (var q = 0; q < COMICS.length; q++) if (COMICS[q].ai) aiN++;
  if (aiN) items.push({ value: "AI 生成", label: "AI 生成 (" + aiN + ")" });
  order.forEach(function (p) { items.push({ value: p, label: p + " (" + names[p] + ")" }); });
  renderChips("chips-plat", items, S.plats = S.plats || [], function () { renderShelf(); saveShelfView(true); applyFRowState(); });
}

export function renderAuthorSel() {
  var names = {};
  for (var i = 0; i < COMICS.length; i++) { var a = authorOf(COMICS[i].dir); names[a] = (names[a] || 0) + 1; }
  var keys = Object.keys(names).sort(function (x, y) { return x.localeCompare(y, "zh"); });
  var items = keys.map(function (k) { return { value: (k === "未标注" ? "" : k), label: k + " (" + names[k] + ")" }; });
  renderChips("chips-author", items, S.authors = S.authors || [], function () { renderShelf(); saveShelfView(); applyFRowState(); });
}

export function renderRatingSel() {
  var items = [
    { value: "18+", label: "18+" },
    { value: "sfw", label: "非 18+" }
  ];
  renderChips("chips-rating", items, S.ratings = S.ratings || [], function () { renderShelf(); saveShelfView(true); });
}

export function renderWorkSel() {
  var names = {}, order = [];
  for (var i = 0; i < COMICS.length; i++) {
    var wv = (manifestOf(COMICS[i].dir) && manifestOf(COMICS[i].dir).work) || "";
    var label = wv || "未识别作品";
    if (names[label] === undefined) { names[label] = 0; order.push(label); }
    names[label]++;
  }
  order.sort(function (x, y) {
    if (x === "未识别作品") return 1;
    if (y === "未识别作品") return -1;
    return names[y] - names[x] || x.localeCompare(y, "zh");
  });
  var items = order.map(function (k) {
    return { value: (k === "未识别作品" ? "" : k), label: k + " (" + names[k] + ")" };
  });
  renderChips("chips-work", items, S.works = S.works || [], function () { renderShelf(); saveShelfView(true); applyFRowState(); });
}

export function renderGroupSel() {
  var items = GROUP_DIM_ORDER.map(function (d) { return { value: d, label: GROUP_DIM_LABEL[d] }; });
  renderChips("chips-group", items, S.groups = S.groups || [], function () { renderShelf(); saveShelfView(); });
}

export function renderSortSel() {
  var box = document.getElementById("chips-sort");
  if (!box) return;
  box.innerHTML = "";
  SORT_ITEMS.forEach(function (it) {
    var c = document.createElement("span");
    c.className = "chip" + (S.sort === it.value ? " sel" : "");
    c.textContent = it.label;
    c.onclick = function () { S.sort = it.value; renderShelf(); saveShelfView(); };
    box.appendChild(c);
  });
}
