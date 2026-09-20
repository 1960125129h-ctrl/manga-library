// 启动收尾: 数据到齐、骨架画完之后要做的那些事
//
// afterBoot 是 core 里最后一个函数 —— 搬到这儿之后, core.js 就只剩
// "状态声明 + 事件接线 + 启动流程" 了(它现在是个纯粹的汇编文件)。
//
// 依赖 10 个只读引用(书名 / 分类维度标签 / 几个 DOM 容器), 全部只赋值一次。
// 三个调用点(正常启动 / 启动报错 / 无桌面版)都走 requestAnimationFrame ->
// setTimeout(afterBoot, 0): 先让出一帧把书页骨架画出来, 否则主线程一路占着, 首帧要等卡片全建完。

import { S, LIBRARY, elGrid } from '../app/state.js';
import { openComic } from '../reader/open.js';
import { loadShelfView } from '../shared/storage.js';
import { applyFRowState } from '../shelf/filter-row.js';
import { renderShelf } from '../shelf/render.js';

export function afterBoot() {
  if (STANDALONE) {
    elShelf.classList.add("hide");
    elReader.classList.remove("hide");
    elBack.classList.add("hide");
    if (elSortWrap) elSortWrap.classList.add("hide");
    if (elSearchWrap) elSearchWrap.classList.add("hide");
    openComic(COMICS[0]);
  } else {
    document.title = LIBTITLE;
    var v = loadShelfView();
    if (v) {
      if (typeof v.q === "string") S.q = v.q;
      // 多选状态: 新版存数组; 老版存字符串, 迁过来
      if (Array.isArray(v.authors)) S.authors = v.authors.filter(function (x) { return typeof x === "string"; });
      else if (typeof v.author === "string" && v.author) S.authors = [v.author];
      if (Array.isArray(v.plats)) S.plats = v.plats.filter(function (x) { return typeof x === "string"; });
      else if (typeof v.plat === "string" && v.plat) S.plats = [v.plat];
      if (Array.isArray(v.ratings)) S.ratings = v.ratings.filter(function (x) { return typeof x === "string"; });
      else if (typeof v.rating === "string" && v.rating) S.ratings = [v.rating];
      if (Array.isArray(v.works)) S.works = v.works.filter(function (x) { return typeof x === "string"; });
      S.authOpen = !!v.authOpen; S.platOpen = !!v.platOpen; S.workOpen = !!v.workOpen;
      applyFRowState();   // 恢复折叠状态后立刻套用样式(setupFRowToggles 在 load 之前跑过一次)
    // 分组: 新版存数组; 老版把分组模式塞进 sort(author/plat/work/char/rating) -> 迁到 groups
    var GROUP_SORTS = { author: "author", plat: "plat", work: "work", rating: "rating", char: "char" };
    if (Array.isArray(v.groups)) S.groups = v.groups.filter(function (g) { return GROUP_DIM_LABEL[g]; });
    else if (v.sort && GROUP_SORTS[v.sort]) { S.groups = [GROUP_SORTS[v.sort]]; S.sort = "recent"; }
    if (v.sort && !GROUP_SORTS[v.sort]) S.sort = v.sort;
      if (v.filter) {
        var known = ["all", "fav", "history", "bookmark"].concat((LIBRARY && LIBRARY.categories) || []);
    if (v && Array.isArray(v.filters)) S.filters = v.filters.filter(function (k) { return known.indexOf(k) >= 0; });
        S.filter = known.indexOf(v.filter) >= 0 ? v.filter : "all";   // 分类被删了就退回「全部」
      }
    }
    if (elSearch) elSearch.value = S.q || "";
    renderShelf();
    if (v && v.scroll) {   // 回到上次滚到的位置(内容还没完全布局 -> 多试几次, 等图片/布局稳定)
      var targetScroll = v.scroll;
      var tries = 0;
      var restore = function () {
        if (!elGrid) return;
        elGrid.scrollTop = targetScroll;
        if (tries++ < 8 && Math.abs(elGrid.scrollTop - targetScroll) > 4) setTimeout(restore, 200);
      };
      setTimeout(restore, 0);
      setTimeout(restore, 100);
      setTimeout(restore, 400);
      setTimeout(restore, 1000);
    }
  }
}

// ---- 由 core 注入 ----
let COMICS, GROUP_DIM_LABEL, LIBTITLE, STANDALONE, elBack, elReader, elSearch, elSearchWrap, elShelf, elSortWrap;

export function initBoot(ctx) {
  COMICS = ctx.COMICS; GROUP_DIM_LABEL = ctx.GROUP_DIM_LABEL; LIBTITLE = ctx.LIBTITLE; STANDALONE = ctx.STANDALONE; elBack = ctx.elBack; elReader = ctx.elReader; elSearch = ctx.elSearch; elSearchWrap = ctx.elSearchWrap; elShelf = ctx.elShelf; elSortWrap = ctx.elSortWrap
}
