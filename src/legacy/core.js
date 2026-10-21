import { enc, normName, capFirst, titleNorm } from '../shared/text.js';
import { fmtBytes, fmtTime } from '../shared/format.js';
import { nOf, chLabel, pageList, imgFile } from '../shared/chapter.js';
import { hostOf } from '../shared/url.js';
import { hsv2rgb } from '../shared/color.js';
import { hint, showModal, closeModal, modalFoot, askText, askConfirm, setModalHooks } from '../shared/ui.js';
import { S, elGrid, LIBRARY, setLIBRARY, LIBROOT, setLIBROOT } from '../app/state.js';
import { saveShelfView, setupFRowToggles, applyFRowState, animateFRow } from '../shelf/filter-row.js';
import { initShelfRender, renderShelf, card, invalidateCard, invalidateAllCards, renderSelBar, selTags, renderCatTabs } from '../shelf/render.js';
import { SEL, SEARCH_HAY, BOOKTIMES, justDraggedUntil, CARD_CACHE, cardSeq, incCardSeq, dragCat,
         setSel, setSearchHay, setBookTimes, setJustDraggedUntil, setCardCache, setCardSeq, setDragCat } from '../shelf/state.js';
import { SET, applySettings, openSettings, initSettings } from '../settings/panel.js';
import { JM_BUSY, JM_LOGEL, JmQRender, dlState, setJmBusy, initDownload, openDownload, onDlEvent } from '../download/panel.js';
import { VIEW_KEY, loadAlbums, saveAlbums, loadShelfView, manualOrder, saveManualOrder, getBgHist, setBgHist, bmAll, bmSave } from '../shared/storage.js';
import { comic, io, elCanvas, NAVFWD, preloaded, lastThumbSync, thumbRaf, rightDown, zoomRetryN, zoomRetryT, wheelAcc, wheelLock,
         setComic, setIo, setElCanvas, setLastThumbSync, setThumbRaf, setRightDown, setZoomRetryN, setZoomRetryT, setWheelAcc, setWheelLock } from '../reader/state.js';
import { initReaderPanel, renderChapters, chStep, bmFind, bmToggle, bmSync, showImgCtx, openImageManager } from '../reader/panel.js';
import { initReaderView, saveReaderDefaults, applyReaderTheme, makeImg, syncSideHandles, scrollThumbToCenter, saveRev, panCanvas, spreads, spreadIndex, preload, preloadAround, syncThumbsActive } from '../reader/view.js';
import { initLibraryStore, setCACHE, libEntry, manifestOf, entryOf, noteOf, revOf, meta, setMeta, prog, setProg, libSave,
         totalPages, innerAuthor, authorKey, platformOf, isBigPlat, unitP, unitQ, dupKey, cn2num, sortKey,
         bookCmp, bookSortKey, coverPage, countIn, groupLabelFor, authorOf, buildSearchHay } from '../library/store.js';
import { initShelfSelect, selHas, selClear, selToggle, selRange, selNewAlbum, selRemoveFromAlbum, selDelete, selCategory, addToAlbum, removeFromAlbum, inAlbum, albumCount, visibleDirs, deleteMany } from '../shelf/select.js';
import { initShelfUtil, clampTags, gridCellW, keepScroll, scrollers, finishReorder, updateFilterBadge, copyText, thumbOf, extractCardColor } from '../shelf/util.js';
import { initShelfActions, editNote, autoTags, toggleFav, setRating, renameBookDir, mergeBook, confirmDelete, findDupGroups, loadBookTimes, dupDialog, manageCat } from '../shelf/book-actions.js';
import { initShelfHistory, openHistory, renderHistory, renderBookmarks, closeHistory } from '../shelf/history.js';
import { initShelfAuthors, autoAuthor, authorGroups, authorCtx, mergeAuthorInto, mergeAuthorDialog, saveAliasMap, tagOne, autoTagsAll } from '../shelf/authors.js';
import { initShelfSites, openSitesDialog, openSiteSearch, multiUpdate, checkUpdate, quickDownload } from '../shelf/sites.js';
import { initShelfInfoEditor, openInfo, openEditor } from '../shelf/info-editor.js';
import { initShelfDrag, applyGroupDrop, makeGroupDrop, autoScroll, dragScrollTick, setHover, makeDraggable } from '../shelf/drag.js';
import { initReaderRender, render, renderPaged, renderScroll, applyThumbs, updateInfo, syncButtons } from '../reader/render.js';
import { initReaderOpen, vtWrap, openComic, closeComic, flyOpenComic, flyCloseComic, openByDir, reopenLast, save, perfSample, delImage, delChapter } from '../reader/open.js';
import { initReaderZoom, applyZoom, centerCanvas, zoomStep, zoomAt, onWheel, refit } from '../reader/zoom.js';
import { initReaderNav, nextPage, prevPage, nextChapter, prevChapter, cur, pages, clamp, openThemeDialog, bgParallax } from '../reader/nav.js';
import { initReaderTouch } from '../reader/touch.js';
import { initReaderFullscreen } from '../reader/fullscreen.js';
import { initCtxMenu, fillCtx, hideCtx, showCtx } from '../shared/ctx-menu.js';
// JM_LOG 只需读(传给 initDownload); setJQ 是给下面这段队列订阅回调用的 —— JQ 由
// app/actions.js 持有, core 这边整体重新赋值时必须走 setter(按值注入只会拿到快照)。
import { initAppActions, showChapterPicker, runInBackground, jmAppend, PVCLOSE, doRebuild, syncJmBtn,
         JM_LOG, setJQ } from '../app/actions.js';
import { initBoot, afterBoot } from '../app/boot.js';
// 工作台(美术参考)。对这个文件的改动只有这一行 import + 下面一行 init 调用 ——
// 工作台自己造自己的 DOM、自己接自己的按钮、自己取自己的数据。
import { initWorkbench } from '../ref/index.js';

var RECOG_VER = "v3-20260914";
(function () {
  "use strict";
  // cur / clamp 用 comic + S.ci/S.pi + pages(), 属阅读器域, 所以留在 core
  // (不塞进书库存取层)。注意: 必须在 IIFE 里面 —— pages() 是 IIFE 内的函数声明,
  // 放到 import 那一层就看不见它了(会 ReferenceError: pages is not defined)。

  var COMICS = __MANIFEST__;
  var STANDALONE = false;
  var LIBTITLE = "漫画书库";
var AUTHOR_ALIAS_FILE = {};   // _scripts\author-alias.json 的内容(UI 里合并作者会写它)
  // 模态框/提示条需要知道"是不是在下载中"(决定点遮罩是关掉还是转后台):
  // 这两件事都还在 core 里, 所以从这里注入给 ui 模块, 而不是让 ui 反向依赖下载逻辑。
  // ═══════════════════════════════════════════════════════════════════════════
  // 事件接线区
  //   下面的 ① 到 ⑦ 是关键路标，不代表代码已经严格按段落隔离；同类接线可能分布在相邻区域。
  //   修改前先搜索控件 ID；简单接线尽量一行，复杂初始化可成组编写。
  //   加控件时先找对应分组，再检查相邻区域，别直接往末尾堆。
  //   加界面按钮的完整步骤见 src/改动索引.md。
  // ═══════════════════════════════════════════════════════════════════════════
  // ─── ① 模块注入: 把 core 的能力交给已抽出的模块 ─────────────────────────────────────────
  setModalHooks({
    isBusy: function () { return !!(dlState && dlState.running); },
    toBackground: function () { runInBackground(); }
  });

  // ─── ② 恢复上次的偏好(阅读主题 / 侧栏 / 方向 / 模式) ─────────────────────────────────────
try { var __rt = JSON.parse(localStorage.getItem("readerTheme") || "{}"); if (__rt.theme) S.theme = __rt.theme; if (typeof __rt.bright === "number") S.bright = __rt.bright; } catch (e) {}
try {
  var __rs = JSON.parse(localStorage.getItem("readerDefaults") || "{}");
  if (typeof __rs.sidebar === "boolean") S.sidebar = __rs.sidebar;
  if (typeof __rs.thumbs === "boolean") S.thumbs = __rs.thumbs;
  if (__rs.dir) S.dir = __rs.dir;
  if (__rs.mode) S.mode = __rs.mode;
  // 一次性迁移: 旧默认右→左改为新默认左→右; 之后仍可手动切回右→左
  if (!localStorage.getItem("readerDirMigrated")) {
    localStorage.setItem("readerDirMigrated", "1");
    if (S.dir === "rtl") {
      S.dir = "ltr";
      try { localStorage.setItem("readerDefaults", JSON.stringify({ sidebar: S.sidebar, thumbs: S.thumbs, dir: S.dir, mode: S.mode })); } catch (e) {}
    }
  }
} catch (e) {}


  // 手机端长按 -> 右键菜单(书架卡片 / 章节 / 预览等); 阅读器画面由 touch.js 自行处理
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    var lpTarget = null, lpX = 0, lpY = 0, lpMoved = false, lpTimer = null, lpSuppressClick = false, lpSuppressCtx = false;
    function lpClear() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpTarget = null; }
    document.addEventListener('contextmenu', function (ev) {
      if (lpSuppressCtx && !ev.syntheticLongPress) { ev.preventDefault(); ev.stopPropagation(); }
    }, true);
    document.addEventListener('touchstart', function (ev) {
      if (ev.touches.length !== 1) { lpClear(); return; }
      var t = ev.touches[0];
      if (t.target.closest && t.target.closest('#stage')) return;
      lpTarget = t.target;
      lpX = t.clientX;
      lpY = t.clientY;
      lpMoved = false;
      if (lpTimer) clearTimeout(lpTimer);
      lpTimer = setTimeout(function () {
        if (lpTarget && !lpMoved) {
          lpSuppressClick = true;
          lpSuppressCtx = true;
          setTimeout(function () { lpSuppressClick = false; lpSuppressCtx = false; }, 900);
          try {
            var _card = lpTarget.closest ? lpTarget.closest('.card') : null;
            if (_card && typeof _card.oncontextmenu === 'function') {
              _card.oncontextmenu({ clientX: lpX, clientY: lpY, preventDefault: function () {}, stopPropagation: function () {} });
            }
          } catch (e) {}
        }
      }, 450);
    }, { passive: true });
    document.addEventListener('touchmove', function (ev) {
      if (!lpTarget) return;
      var t = ev.touches[0];
      if (Math.hypot(t.clientX - lpX, t.clientY - lpY) > 12) { lpMoved = true; lpClear(); }
    }, { passive: true });
    document.addEventListener('touchend', lpClear, { passive: true });
    document.addEventListener('touchcancel', lpClear, { passive: true });
    document.addEventListener('click', function (ev) {
      if (lpSuppressClick) {
        if (ev.target.closest && ev.target.closest('#ctx')) return;   // 菜单项点击放行
        ev.preventDefault();
        ev.stopPropagation();
        lpSuppressClick = false;
      }
    }, true);
  }

  /* ===== 专辑(虚拟分组, 存 localStorage) ===== */
  var elAlbumBar = document.getElementById("albumbar");


  var elShelf = document.getElementById("shelf");
  var elReader = document.getElementById("reader");
  // 背景视差: 只改 background-position-y, 不碰布局, 代价几乎为零
  var BG_PARALLAX = 0;   // ← 想重新开视差就改成 0.18
  (function(){
    var sb = document.getElementById('shelfbar');
    var lastY = 0;
    var narrow = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    var ahLastY = 0;
    elGrid.addEventListener('scroll', function(){
      var y = elGrid.scrollTop;
      if (y > 80 && y > lastY) sb.classList.add('compact');
      else if (y < lastY - 20) sb.classList.remove('compact');
      if (narrow) {
        // 任何滚动都收起筛选面板 (展开态不该跟着滚)
        try {
          var _fp = document.getElementById('filterpanel');
          var _bf = document.getElementById('btn-filter');
          if (_fp && _fp.classList.contains('open')) {
            _fp.classList.remove('open');
            if (_bf) _bf.classList.remove('on');
            var _bft = document.getElementById('btn-filter-txt');
            if (_bft) _bft.textContent = '筛选 ▾';
          }
        } catch (e) {}
        // 手机端顶栏: 到顶部必显; 下滑超过 6px 隐藏; 上滑任何距离立即显示
        if (y < 50) document.body.classList.remove('shelf-autohide');
        else if (y > ahLastY + 6) document.body.classList.add('shelf-autohide');
        else if (y < ahLastY - 2) document.body.classList.remove('shelf-autohide');
        ahLastY = y;
      }
      lastY = y;
      bgParallax(y);   // 背景慢半拍(视差)
    }, {passive:true});
    try { document.body.style.backgroundPositionY = ''; } catch (e) {}   // 视差关掉后清掉残留位移
  })();
  (function(){
    try {
      var saved = localStorage.getItem('bgImg');
      if (saved) {
        document.body.style.backgroundImage = 'url(' + saved + ')';
        var px0 = localStorage.getItem('bgPosX'), py = localStorage.getItem('bgPosY');
        if (px0 !== null || py !== null) document.body.style.backgroundPosition = (px0 === null ? 50 : px0) + '% ' + (py === null ? 50 : py) + '%';
        document.body.classList.add('bgimg');
      }
      var op = localStorage.getItem('bgOpacity');
      if (op) document.documentElement.style.setProperty('--bg-op', op + '%');
      var bl = localStorage.getItem('bgBlur');
      if (bl) document.documentElement.style.setProperty('--bg-blur', bl + 'px');
      var co = localStorage.getItem('bgCoverOpaque');
      if (co === '1') document.body.classList.add('cover-opaque');
    } catch(e){}
  })();
  var elSearch = document.getElementById("search");
  var elStat = document.getElementById("shelfstat");
  var elCatTabs = document.getElementById("cattabs");
  var elPlatSel = document.getElementById("platsel");
  var elCtx = document.getElementById("ctx");
  var elModal = document.getElementById("modal");
  var elSidebar = document.getElementById("sidebar");
  var elChapters = document.getElementById("chapters");
  var elBook = document.getElementById("bookname");
  var elStage = document.getElementById("stage");
  // 适宽/适高要"跟着窗口和图片走": 把 #stage 真实可用宽高写进 CSS 变量, 图片规则全部引用它
  // (原来用 calc(100vh - 52px) 硬算, 顶栏/侧栏一变就不准; 侧栏开关、窗口缩放都会自动重算)
  try { if (window.ResizeObserver && elStage) new ResizeObserver(function () { refit(); }).observe(elStage); } catch (e) {}
  try { window.addEventListener('resize', function () { refit(); }); } catch (e) {}

  var elChName = document.getElementById("chname");
  var elPageInfo = document.getElementById("pageinfo");
  var elPageInput = document.getElementById("pageinput");
  var elHint = document.getElementById("hint");
  var elBack = document.getElementById("bback");
  var elSortWrap = document.getElementById("sortwrap");
  var elSearchWrap = document.getElementById("searchwrap");


  var DISK = (typeof window !== "undefined" && window.mangaLib && window.mangaLib.isElectron) ? window.mangaLib : null;


  /* ================= 作者名规范化 + 合并 =================
     站点给的 author 字段混了三种: 社团名 / 作者名 / 「社团 (作者)」。规则(用户选定):
     ① 有括号时以括号里的作者为准; ② 别名表(UI 里合并作者会写进 _scripts\author-alias.json)优先于规则。 */
  var AUTHOR_ALIAS = (function () {
    var a = {};
    try { if (AUTHOR_ALIAS_FILE && typeof AUTHOR_ALIAS_FILE === "object") for (var k in AUTHOR_ALIAS_FILE) a[k] = AUTHOR_ALIAS_FILE[k]; } catch (e) {}
    try { var l = JSON.parse(localStorage.getItem("authorAlias") || "{}"); for (var k2 in l) a[k2] = l[k2]; } catch (e) {}
    return a;
  })();
  var AUTHOR_IGNORE = {};
  try { (JSON.parse(localStorage.getItem("authorAliasIgnore") || "[]") || []).forEach(function (r) { AUTHOR_IGNORE[r] = 1; }); } catch (e) {}
  var PLATFORM_WORDS = ["fantia", "pixiv", "fanbox", "twitter", "x", "booth", "fanza", "patreon", "ci-en", "dlsite", "melonbooks", "amazon", "youtube"];
  // 纯 AI 标记(不是作者名): 命中就当作"未标注", AI 信息只走 tags/ai 字段
  var AI_AUTHOR_RE = /^(ai[ _\-]?generated|ai\s*生成|ai\s*作画|ai\s*绘|ai\s*画集|ai\s*cg|ai\s*イラスト|ai\s*画|stable\s?diffusion|novelai|midjourney|生成ai)$/i;
  // 大平台(社交/投稿站): 单独列出来, 一本其实是一个人的图包
  var BIG_PLATS = [
    [/pixiv/i, "pixiv"],
    [/^x$|^twitter$|twitter|t\.co|(^|[^a-z])x\.com/i, "X"],
    [/douyin|iesdouyin/i, "抖音"],
    [/weibo/i, "微博"]
  ];
  // 漫画站细分: 按 source.site 子串匹配, 每个站独立成组(不再合并成"漫画站")
  var SITE_LABELS = [
    [/ehentai|exhentai/i, "E-Hentai"],
    [/nhentai/i, "nhentai"],
    [/18comic|jmcomic/i, "禁漫天堂"],
    [/zaimanhua/i, "再漫画"],
    [/xmanhua/i, "X漫画"],
    [/manhuagui/i, "漫画柜"],
    [/copymanga/i, "拷贝漫画"],
    [/dm5/i, "DM5"],
    [/1kkk/i, "1kkk"],
    [/komiic/i, "Komiic"]
  ];
  // 大平台(X/抖音/微博/pixiv)的"一本"本质是一个人的图包: 量词用 篇/张, 不用 话/页
  // 拖动排序会整块重渲染, 重渲染后把滚动位置按差值还原, 免得"往上跳"
  // 把某个作者(含它下面的所有原始写法)合并到目标名

  /* ===== 书名排序键(移植自 build-library.mjs sortKey/natCmp + 书名归一化) =====
     中文数字转阿拉伯补零; 去开头汉化组/作者方括号、语言标签、AI 标记后按核心书名排 */

  /* ===== 分组维度(可多选): author/work/plat/rating/char ===== */
  var GROUP_DIM_ORDER = ['author', 'work', 'plat', 'rating', 'char'];
  var GROUP_DIM_LABEL = { author: '按作者', work: '按作品', plat: '按平台', rating: '按分级', char: '按角色' };

  // 书卡 tag 区: 最多 2 排, 超出折叠成 +N, 点 +N 展开全部
  // ── View Transitions: 把"分类/搜索/设置"引起的瞬间重排变成平滑过渡 ──
  // 卡片元素来自 CARD_CACHE 复用, 所以带 view-transition-name 的卡片会"平移到新位置"而不是淡出再淡入
  var VTID = 0;   // 阅读器过渡计数(被当值注入给书架渲染域; lastVT/VT_ON/vtBusy 已随 vtWrap 搬到 reader/open.js)


  /* ---------- 浏览界面状态持久化: 分类标签 / 排序 / 搜索词 / 作者筛选 / 滚动位置 ---------- */

  document.addEventListener("dragover", function (ev) { if (dragSrc) autoScroll(ev.clientY); }, true);
  // 把一个分组变成"能接收别组卡片"的落点: 拖进来 = 把这本改成这个分组
  // 指针事件版拖拽: 原生 HTML5 拖拽期间浏览器会屏蔽滚轮, 换 pointer 后滚轮和边缘滚动都能用

  var COLOR_CACHE = {};


  /* ================= 多选批量操作 (Ctrl / Shift 点卡片) ================= */
  (function () {
    var b1 = document.getElementById("seldel"); if (b1) b1.onclick = selDelete;
    var b2 = document.getElementById("selcat"); if (b2) b2.onclick = selCategory;
    var b3 = document.getElementById("seltag"); if (b3) b3.onclick = selTags;
    var b4 = document.getElementById("selclear"); if (b4) b4.onclick = selClear;
    var b5 = document.getElementById("selalbum"); if (b5) b5.onclick = selNewAlbum;
    var b6 = document.getElementById("selremovealbum"); if (b6) b6.onclick = selRemoveFromAlbum;
  })();

  /* ================= 漫画网站总览 ================= */

  (function () {
    var bs = document.getElementById("btn-sites");
    if (bs) bs.onclick = function () { openSitesDialog(); };
  })();

  /* ================= 备注 ================= */

  /* ================= 按书名自动打标签 ================= */

  /* ================= 重复书目检测 ================= */

  /* ================= 分类 / 收藏 / 标签 ================= */


  /* 把已经下载好的书合并成一个文件夹(所有图片进 全部\, 连续编号) */


  /* ---------- 禁漫一键下载(在 App 内跑自动化脚本) ---------- */
  /* ---------- 跨站检查更新: 本地这本 vs 各正经站, 谁多就用谁补 ---------- */

  /* ---------- 检查更新 ---------- */


  /* ---------- 设置面板: 所有视觉参数自己调 ---------- */
  // ===== 阅读配色: 整套换肤(画面+侧栏+工具栏+按钮), 亮度只压画面那一层 =====
  var THEMES = [["dark", "暗黑", "#0a0a0a", "#d8dade"], ["light", "灰白", "#e8eaed", "#1f2328"], ["eye", "护眼", "#e8e6d8", "#2d3320"], ["paper", "纸质", "#f3ead8", "#3b3227"]];
  applyReaderTheme();

  var DL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  (function () {
    var bs = document.getElementById('btn-settings');
    if (bs) bs.onclick = function () { openSettings(); };
    var bh = document.getElementById('btn-history');
    if (bh) bh.onclick = function () { openHistory(); };
    var hb = document.getElementById('hback');
    if (hb) hb.onclick = function () { closeHistory(); };
    var bj = document.getElementById('btn-download');
    if (bj) bj.onclick = function () { openDownload("general"); };
    syncJmBtn();
    if (DISK && DISK.jmQueue && DISK.jmQueue.on) {
      try { DISK.jmQueue.on(function (q) { setJQ(q); syncJmBtn(); if (JmQRender) JmQRender(q); }); } catch (e) {}   // 只订阅这一次
      DISK.jmQueue.list().then(function (q) {
        setJQ(q); syncJmBtn();
        var n = 0;
        if (q && q.items) for (var i = 0; i < q.items.length; i++) if (q.items[i].status === "wait" || q.items[i].status === "run") n++;
        if (n) hint("下载队列还有 " + n + " 本未完成，点「下载漫画」查看");
      });
    }
    // 下载事件只订阅一次, 弹窗开不开都能收到
    try {
      if (DISK && DISK.onJm) DISK.onJm(function (ev) {
        if (!ev) return;
        if (ev.type === "log") jmAppend(ev.line);
        else if (ev.type === "done") { jmAppend("\n[结束] 退出码 " + ev.code + "\n"); setJmBusy(false); syncJmBtn(); }
      });
    } catch (e) {}
    // 这几个必须在注入之前就赋好值: 原来是按值注入的, 声明在注入点之后会注成 undefined
  var PVQ = { pending: [], running: 0, obs: [] };
  var PV_TILE_W = 132;   // 页缩略图固定列宽(px): 不拉伸; 配合放大后的下载弹窗, 宽屏一屏 6 列左右   // 页缩略图固定列宽(px): 不拉伸; 96 能让窄弹窗里刚好排 3 列
  // 页缩略图统一由主进程裁好再显示, 前端不再自己做 background 裁切


  // 一个作品的页缩略图网格(容器里点 ▼ 展开后用): 返回 { el, count(), picked() }

  // 下载前预览(功能5): 一级 = 每页缩略图网格(只有这一层, 页上不再挂箭头)
  // 交互: 复选框 或 点卡片(点选/Ctrl 加减/Shift 范围选); 默认全不勾; 没勾的页不下载


  // 单本书章节勾选窗: chapterList = [{i,title,done}], 默认全选, 可单选多选


  // 下载漫画: 一个弹窗两个标签页(通用链接 / 禁漫天堂)
  /* ---------- 跨站搜索(只搜正经漫画站) ---------- */


  (function () {
    var bd = document.getElementById("btn-download");
    if (bd) { if (DISK) bd.onclick = function () { openDownload("general"); }; else bd.classList.add("hide"); }
    var br = document.getElementById("btn-rebuild");
    if (br) { if (DISK) br.onclick = function () { doRebuild(); }; else br.classList.add("hide"); }
    var bss = document.getElementById("btn-sitesearch");
    if (bss) {
      if (DISK) {
        bss.disabled = false;
        bss.onclick = function () {
          var k = elSearch ? elSearch.value.trim() : "";
          openSiteSearch(k);
        };
      } else bss.classList.add("hide");
    }
  })();
  var SORT_ITEMS = [
    { value: "recent", label: "最近阅读" },
    { value: "name", label: "名称" },
    { value: "fav", label: "收藏优先" },
    { value: "time", label: "入库时间↓" },
    { value: "timeasc", label: "入库时间↑" }
  ];
    // 把 core 里的这些东西交给书架渲染域
    initShelfUtil({ COLOR_CACHE: COLOR_CACHE });
    initShelfActions({ fillCtx: fillCtx, COMICS: COMICS, DISK: DISK });
    initShelfHistory({ openByDir: openByDir, COMICS: COMICS, elReader: elReader, elShelf: elShelf, elStat: elStat });
    initShelfAuthors({ cur: cur, fillCtx: fillCtx, AI_AUTHOR_RE: AI_AUTHOR_RE, AUTHOR_IGNORE: AUTHOR_IGNORE, COMICS: COMICS, DISK: DISK, PLATFORM_WORDS: PLATFORM_WORDS });
    initShelfSites({ jmAppend: jmAppend, syncJmBtn: syncJmBtn, DISK: DISK });
    initShelfInfoEditor({ save: save, DISK: DISK });
    initShelfDrag({ cur: cur });
    initCtxMenu({ DISK: DISK, elCtx: elCtx });
    initAppActions({ DISK: DISK, PVQ: PVQ, DL_SVG: DL_SVG });
    initBoot({ COMICS: COMICS, GROUP_DIM_LABEL: GROUP_DIM_LABEL, LIBTITLE: LIBTITLE, STANDALONE: STANDALONE, elBack: elBack, elReader: elReader, elSearch: elSearch, elSearchWrap: elSearchWrap, elShelf: elShelf, elSortWrap: elSortWrap });
    initWorkbench({ DISK: DISK, COMICS: COMICS, hint: hint });
initShelfSelect({ DISK: DISK, COMICS: COMICS });
    initLibraryStore({ COMICS: COMICS, DISK: DISK, autoAuthor: autoAuthor, pages: pages, AUTHOR_ALIAS: AUTHOR_ALIAS, BIG_PLATS: BIG_PLATS, SITE_LABELS: SITE_LABELS });
    initShelfRender(Object.assign({},
      {COMICS: COMICS, GROUP_DIM_LABEL: GROUP_DIM_LABEL, GROUP_DIM_ORDER: GROUP_DIM_ORDER, SORT_ITEMS: SORT_ITEMS, VTID: VTID, elAlbumBar: elAlbumBar, elCatTabs: elCatTabs, elSearch: elSearch, elStat: elStat},
      {authorCtx: authorCtx, authorGroups: authorGroups, authorKey: authorKey, authorOf: authorOf, bookCmp: bookCmp, buildSearchHay: buildSearchHay, clampTags: clampTags, countIn: countIn, coverPage: coverPage, cur: cur, deleteMany: deleteMany, entryOf: entryOf, extractCardColor: extractCardColor, fillCtx: fillCtx, flyOpenComic: flyOpenComic, groupLabelFor: groupLabelFor, inAlbum: inAlbum, libEntry: libEntry, libSave: libSave, makeDraggable: makeDraggable, makeGroupDrop: makeGroupDrop, manageCat: manageCat, manifestOf: manifestOf, meta: meta, platformOf: platformOf, prog: prog, renderBookmarks: renderBookmarks, selHas: selHas, selRange: selRange, selToggle: selToggle, showCtx: showCtx, thumbOf: thumbOf, toggleFav: toggleFav, totalPages: totalPages, unitP: unitP, unitQ: unitQ, updateFilterBadge: updateFilterBadge, visibleDirs: visibleDirs, vtWrap: vtWrap}
    ));
    // 把 core 里的这些东西交给下载域(它按同名接住; 会被重新赋值的几个由它自己持有)
    initDownload({
      DISK: DISK, DL_SVG: DL_SVG, JM_LOG: JM_LOG, PVQ: PVQ, PV_TILE_W: PV_TILE_W,
      PVCLOSE: PVCLOSE, card: card, jmAppend: jmAppend, libEntry: libEntry, libSave: libSave,
      pages: pages, prog: prog, runInBackground: runInBackground,
      showChapterPicker: showChapterPicker, syncJmBtn: syncJmBtn, doRebuild: doRebuild
    });
    // 把 core 里的这几个函数交给设置域(它按同名接住)
    initSettings({
      DISK: DISK, renderShelf: renderShelf, renderCatTabs: renderCatTabs,
      invalidateAllCards: invalidateAllCards, authorGroups: authorGroups,
      saveAliasMap: saveAliasMap, mergeAuthorInto: mergeAuthorInto,
      mergeAuthorDialog: mergeAuthorDialog, autoTagsAll: autoTagsAll, dupDialog: dupDialog
    });
    initReaderOpen({ COMICS: COMICS, DISK: DISK, LIBTITLE: LIBTITLE, elReader: elReader, elShelf: elShelf });
    initReaderView({ pages: pages });
    initReaderZoom({ nextPage: nextPage, prevPage: prevPage, elStage: elStage });
    initReaderNav({ BG_PARALLAX: BG_PARALLAX, THEMES: THEMES, elStage: elStage });
    initReaderTouch({ elStage: elStage, nextPage: nextPage, prevPage: prevPage, closeReader: closeComic });
    initReaderFullscreen();
    initReaderRender({ applyZoom: applyZoom, centerCanvas: centerCanvas, clamp: clamp, cur: cur, pages: pages, refit: refit, save: save, elChName: elChName, elPageInfo: elPageInfo, elPageInput: elPageInput, elSidebar: elSidebar, elStage: elStage });
    initReaderPanel({
    render: render, syncButtons: syncButtons, pages: pages,
    libEntry: libEntry, isBigPlat: isBigPlat, fillCtx: fillCtx,
    delChapter: delChapter, delImage: delImage,
    COMICS: COMICS, DISK: DISK, elBook: elBook, elChapters: elChapters
  });
  applySettings();
    // 自动适配: 窗口宽度变化时重算 cardW(节流 150ms)
    var _afTimer = 0;
    try {
      window.addEventListener('resize', function () {
        if (_afTimer) clearTimeout(_afTimer);
        _afTimer = setTimeout(function () {
          _afTimer = 0;
          applySettings();   // CSS 变量变了 grid 自动重排, 不用重渲染卡片
        }, 150);
      });
    } catch (e) {}
  })();

  // 这本书是不是倒序观看(和阅读进度存在一起)
  // 倒序观看时封面取"最新一话的第一张"; 正序/没设过返回 null, 走原来的封面
  /* ---------- 阅读历史页 ---------- */


  /* ===== 专辑栏 ===== */

  /* ================= 下载 / 更新书库 ================= */


  // 把当前进度存成纯数据快照(window._dlProgress), 弹窗关掉后再打开时用它还原


  // 下载中把窗口收起来: 不中断下载, 顶栏按钮变成"下载中", 点它能看到进度


  // 容器预览(功能5 三级): 作品列表 → 点作品下的 ▼ 展开这本的页缩略图 → 逐页勾选
  // 两级都默认不勾; 保留 全选/全不选/反选; 先渲染前 60 本, 滚到底自动续
  // 批量选择面板: EH tag 画廊列表 / pixiv 用户作品列表, 勾选要下的


  /* ---------- 缩略图懒加载器(下载弹窗内共用) ---------- */
  // 只有真正滚到眼前才请求, 同时最多 4 个; 防盗链图统一走主进程代理(window.mangaLib.dlThumb)
  // EH 的缩略图是 5 张横拼的 sprite: 同一张图靠 background-position 显示不同格

  // 书架主题切换: 暗黑 / 灰白 / 护眼
  (function () {
    var bt = document.getElementById("btn-theme");
    if (!bt) return;
    var colors = { dark:"#0a0a0a", light:"#e8eaed", eye:"#e2e8d8", paper:"#f3ead8" };
    var themes = ["dark", "light", "eye", "paper"];
    function cur() {
      try { return localStorage.getItem("shelfTheme") || "dark"; } catch (e) { return "dark"; }
    }
    function apply(t) {
      document.body.setAttribute("data-shelf-theme", t === "dark" ? "" : t);
      var current = t;
      bt.innerHTML = themes.map(function(k){
        return '<span data-t="'+k+'" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:'+colors[k]+';border:2px solid '+(k===current?'var(--accent)':'var(--border2)')+';margin:0 2px;transition:all .3s;vertical-align:middle;cursor:pointer"></span>';
      }).join('');
      bt.querySelectorAll('span').forEach(function(s){
        s.onclick = function(e){ e.stopPropagation(); apply(s.dataset.t); };
      });
      try { localStorage.setItem("shelfTheme", t); } catch (e) {}
    }
    apply(cur());
  })();

  // 书架滚动: 显示/隐藏回到顶部按钮 (像网页一样上下滚)
  (function () {
    var g = document.getElementById("grid");
    var tt = document.getElementById("totop");
    if (g && tt) {
      g.addEventListener("scroll", function () {
        if (g.scrollTop > 400) tt.classList.add("on"); else tt.classList.remove("on");
        saveShelfView();   // 滚动位置也记住(节流 350ms)
      });
      tt.onclick = function () { g.scrollTo({ top: 0, behavior: "smooth" }); saveShelfView(); };
    }
    // 滚轮在书架上直接滚列表, 不被弹窗吞掉
    if (g) g.addEventListener("wheel", function (ev) { ev.stopPropagation(); }, { passive: true });
  })();

  // 鼠标侧键: 后退(3)=返回书架, 前进(4)=回到刚才那本书; 顺便屏蔽浏览器历史后退
  (function () {
    document.addEventListener("mousedown", function (ev) { if (ev.button === 3 || ev.button === 4) ev.preventDefault(); }, true);
    document.addEventListener("auxclick", function (ev) { if (ev.button === 3 || ev.button === 4) ev.preventDefault(); }, true);
    document.addEventListener("mouseup", function (ev) {
      if (ev.button !== 3 && ev.button !== 4) return;
      ev.preventDefault();
      if (elModal && elModal.classList.contains("on")) { closeModal(); return; }
      var inReader = elReader && !elReader.classList.contains("hide");
      var inHistory = (function(){ var h = document.getElementById('history'); return h && !h.classList.contains('hide'); })();
      if (ev.button === 3) {
        if (inReader) { flyCloseComic(); return; }
        if (inHistory) { closeHistory(); return; }
        return;
      }
      if (!inReader) reopenLast();
    }, true);
  })();

  document.addEventListener("click", hideCtx);
  if (elCtx) elCtx.onclick = function (ev) { ev.stopPropagation(); };


  // 预取后面两页, 翻页时不等网络

  // 右侧页面预览
  // 侧栏伸缩把手: 展开时箭头朝"收进去"的方向, 收起时朝"拉出来"的方向

  // 只挪侧栏的"当前页"高亮, 不重建列表(长条滚动时会被频繁调用, 重建太贵)
  // 把某个缩略图滚到"条的正中"(140ms 缓动)。
  // 用显式 scrollTop, 不用 scrollIntoView —— 后者会连带滚动祖先容器, 有可能把阅读区也滚一下(黑一下的来源之一)


  // 封面"飞"进阅读器: 手工克隆一张图来飞(和飞回同一套)。
  // 之前用 View Transition 做, 你屏幕上会出现"落地后几个高斯模糊块"——那是浏览器把大图按卡片尺寸
  // 光栅化过、落地后部分图块没按新尺寸重画留下的残留。改成自己控制就没有这个问题。
  // ── F9 性能采样: 你用着感觉卡的时候按一下, 采 3 秒写进日志(App 的 stdout 会被启动器存到 _scripts\jm\.app-out.log) ──

  // 飞回去: 自己克隆一张图来飞(FLIP)。试过用 View Transition 做反向, 浏览器不给它建变形组,
  // 表现就是"啪"一下换完、看不见过程——所以这条腿改成手工克隆, 完全可控。

  // ─── ③ 阅读器: 按钮接线 ────────────────────────────────────────────────────────
  elBack.onclick = flyCloseComic;
  document.getElementById("bprevch").onclick = function () { if (comic) prevChapter(false); };
  document.getElementById("bnextch").onclick = function () { if (comic) nextChapter(); };
  document.getElementById("m-single").onclick = function () { S.mode = "single"; render(); saveReaderDefaults(); };
  document.getElementById("m-double").onclick = function () { S.mode = "double"; render(); saveReaderDefaults(); };
  document.getElementById("m-scroll").onclick = function () { S.mode = "scroll"; render(); saveReaderDefaults(); };
  document.getElementById("f-width").onclick = function () { S.fit = "width"; render(); };
  document.getElementById("f-height").onclick = function () { S.fit = "height"; render(); };
  document.getElementById("f-original").onclick = function () { S.fit = "original"; render(); };
  document.getElementById("bcover").onclick = function () { S.cover = !S.cover; render(); };
  document.getElementById("sidetoggle").onclick = function () { S.sidebar = !S.sidebar; syncButtons(); save(); saveReaderDefaults(); };
  document.getElementById("bdir").onclick = function () { S.dir = S.dir === "rtl" ? "ltr" : "rtl"; syncButtons(); save(); saveReaderDefaults(); };
  var bRev = document.getElementById("brev");
  if (bRev) bRev.onclick = function () { S.rev = !S.rev; syncButtons(); renderChapters(); saveRev(); save(); hint(S.rev ? "倒序观看：从最新的一话开始（封面也换成最新一话的图）" : "恢复正序观看"); };
  var bPrevRev = document.getElementById("prevrev");
  if (bPrevRev) bPrevRev.onclick = function () {
    S.prevRev = !S.prevRev;
    S.pi = S.prevRev ? Math.max(0, pages().length - 1) : 0;   // 切换后直接落在"该看的开头"
    syncButtons(); applyThumbs(); render(); saveRev(); save();
    if (comic) { var pr = prog(comic.dir) || {}; pr.prevRevUser = true; setProg(comic.dir, pr); }
    hint(S.prevRev ? "预览倒序：列表和翻页都从最后一页往前" : "预览恢复正序：从第一页往后");
  };
  // 按钮缩放一律以"画面中心"为锚点(滚轮才是以光标为锚点); 每次 ±25%
  var bz = document.getElementById("bzoom");
  if (bz) bz.onclick = function () { zoomStep(0.25); };
  var bzo = document.getElementById("bzoomout");
  if (bzo) bzo.onclick = function () { zoomStep(-0.25); };
  var bzr = document.getElementById("bzoomreset");
  if (bzr) bzr.onclick = function () { applyZoom(1); hint("已重置为 100%"); };
  var bt3 = document.getElementById("btheme");
  if (bt3) bt3.onclick = openThemeDialog;
  var bb = document.getElementById("bbm");
  if (bb) bb.onclick = function () { bmToggle(); };
  var bt = document.getElementById("thumbtoggle");
  if (bt) bt.onclick = function () { S.thumbs = !S.thumbs; if (comic) render(); else { applyThumbs(); syncButtons(); } saveReaderDefaults(); };
  // ─── ④ 阅读器: 滚轮缩放 / 触屏 / 全屏 ──────────────────────────────────────────────
  // 放大/缩小: 按住右键滚轮(以光标位置为锚点, 100% 起逐步缩放); 平移: 按住右键拖动
  document.addEventListener("mousedown", function (ev) { if (ev.button === 2) setRightDown(true); }, true);
  document.addEventListener("mouseup", function () { setRightDown(false); }, true);
  // SAI2 式画布缩放: 光标(或视口中心)对着的内容点, 缩放前后纹丝不动
  // 换页/换模式后的落位: 横向居中; 纵向装得下就居中, 装不下从页顶开始
  document.addEventListener("wheel", function (ev) {
    var wbView = document.getElementById("workbench");
    if (wbView && !wbView.classList.contains("hide")) return;
    if (ev.ctrlKey && SEL && SEL.length) {
      ev.preventDefault();
      var g = document.getElementById("grid");
      if (g) g.scrollTop += ev.deltaY;
      return;
    }
    if (!rightDown && !(ev.buttons & 2)) return;
    ev.preventDefault(); ev.stopPropagation();
    var z0 = S.zscale || 1;
    var z = Math.max(0.2, Math.min(8, z0 + (ev.deltaY < 0 ? 0.1 : -0.1)));
    if (Math.abs(z - z0) < 0.001) return;
    var rect = elStage.getBoundingClientRect();
    zoomAt(z, ev.clientX - rect.left, ev.clientY - rect.top);   // 以光标为锚点
    hint("缩放 " + Math.round(z * 100) + "%");
  }, { capture: true, passive: false });
  if (elStage) {
    elStage.addEventListener("mousedown", function (ev) {
      var leftDrag = ev.button === 0 && !!S.zoom;    // 放大后左键直接抓画面拖
      if (ev.button !== 2 && !leftDrag) return;
      ev.preventDefault();
      var sx = ev.clientX, sy = ev.clientY, sl = elStage.scrollLeft, stp = elStage.scrollTop;
      var t0x = S.tx || 0, t0y = S.ty || 0;
      var mask = ev.button === 2 ? 2 : 1;
      var started = ev.button === 2, panning = true;   // 左键超过 4px 才算拖动, 免得误触
      if (started) elStage.classList.add("panning");
      var up = function () {
        panning = false; elStage.classList.remove("panning");
        document.removeEventListener("mousemove", move, true); document.removeEventListener("mouseup", up, true);
        window.removeEventListener("mouseup", up, true); window.removeEventListener("blur", up, true);
      };
      var lastX = sx, lastY = sy;
      var move = function (e2) {
        if (!panning) return;
        if (!(e2.buttons & mask)) { up(); return; }   // 按键已松开(mouseup 丢了也一样) -> 立刻收手
        var dx = e2.clientX - lastX, dy = e2.clientY - lastY;
        lastX = e2.clientX; lastY = e2.clientY;
        if (!started) {
          if (Math.abs(e2.clientX - sx) < 4 && Math.abs(e2.clientY - sy) < 4) return;
          started = true; elStage.classList.add("panning");
        }
        // 增量累加(不再用按下那一刻的基准): 中途滚轮缩放改过的位置不会被冲掉 -> 不会弹回
        if (S.zoom) { S.tx = (S.tx || 0) + dx; S.ty = (S.ty || 0) + dy; panCanvas(); }
        else { elStage.scrollLeft -= dx; elStage.scrollTop -= dy; }
      };
      document.addEventListener("mousemove", move, true);
      document.addEventListener("mouseup", up, true);
      window.addEventListener("mouseup", up, true);
      window.addEventListener("blur", up, true);
    });
    elStage.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
  }

  var _fsTimer = 0;
  document.addEventListener("fullscreenchange", function() {
    if (document.fullscreenElement) {
      S._prevSidebar = S.sidebar;
      S._prevThumbs = S.thumbs;
      S.sidebar = false; S.thumbs = false;
      syncButtons();
    } else {
      if (typeof S._prevSidebar === "boolean") S.sidebar = S._prevSidebar;
      if (typeof S._prevThumbs === "boolean") S.thumbs = S._prevThumbs;
      syncButtons();
    }
  });
  var _barEl = document.getElementById("bar");
  document.addEventListener("mousemove", function (ev) {
    var auto = document.body.classList.contains("bar-autohide");
    if ((!document.fullscreenElement || !auto) && !auto) return;
    if (ev.clientY < 90) _barEl.classList.add("show");
    else _barEl.classList.remove("show");
  });
  document.addEventListener("wheel", function () {
    var auto = document.body.classList.contains("bar-autohide");
    if (!document.fullscreenElement && !auto) return;
    _barEl.classList.remove("show");
  }, { passive: true });

  var searchTimer = 0;
  // ─── ⑤ 书架: 搜索 / 筛选 / 主题 / 滚动 / 侧键 ───────────────────────────────────────
  elSearch.oninput = function () {
    S.q = elSearch.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { searchTimer = 0; renderShelf(); saveShelfView(); }, 80);
  };
  /* ---------- 折叠式筛选面板 + chips（作者/分级/平台 多选，并集过滤） ---------- */
  var elFilterPanel = document.getElementById("filterpanel");
  var elBtnFilter = document.getElementById("btn-filter");
  // 通用 chips 渲染: items=[{value,label}], selected 是会被原地修改的数组; onPick 在切换后回调
  // 作者/平台筛选行的折叠: 默认收起, 点 flabel 展开; 选中时高亮
  // 平台 chips: 全部平台 / AI 生成 / 各站点(带本数)
  // 作者 chips
  // 分级 chips(固定两项)
  // 作品 chips: 全部作品(按书数排序)
  // 分组 chips(多选): [不分组]=清空; 其余按 GROUP_DIM_LABEL
  // 排序 chips(单选)
  if (elBtnFilter) elBtnFilter.onclick = function () {
    var open = elFilterPanel.classList.toggle("open");
    elBtnFilter.classList.toggle("on", open);
    var txt = document.getElementById("btn-filter-txt");
    if (txt) txt.textContent = open ? "筛选 ▴" : "筛选 ▾";
  };
  setupFRowToggles();

  elStage.addEventListener("wheel", onWheel, { passive: false });
  document.getElementById("bwheel").onclick = function () { S.wheel = !S.wheel; syncButtons(); save(); };

  elPageInput.onkeydown = function (e) {
    if (e.key === "Enter") {
      var v = parseInt(elPageInput.value, 10);
      if (!isNaN(v)) { S.pi = Math.max(1, Math.min(v, pages().length)) - 1; render(); }
      elPageInput.blur();
    }
    e.stopPropagation();
  };

  elStage.onclick = function (e) {
    if (S.mode === "scroll") return;
    var w = elStage.clientWidth;
    var x = e.clientX - elStage.getBoundingClientRect().left;
    var goNext = S.dir === "rtl" ? (x < w / 2) : (x >= w / 2);
    if (goNext) nextPage(); else prevPage();
  };

  // ─── ⑥ 全局: 键盘快捷键 ────────────────────────────────────────────────────────
  document.addEventListener("keydown", function (e) {
    if (e.target && e.target.tagName === "INPUT") return;
    if (elModal && elModal.classList.contains("on")) { if (e.key === "Escape") closeModal(); return; }
    if (!comic) {
      if (e.key === "/") { e.preventDefault(); elSearch.focus(); return; }
      if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSel(visibleDirs()); renderShelf(); hint("已全选当前视图 " + SEL.length + " 本"); return; }
      if (e.key === "Escape") { selClear(); return; }
      return;
    }
    var k = e.key, scrollMode = S.mode === "scroll";
    if (k === "F9") { ev.preventDefault(); perfSample(); return; }   // 现场性能采样
    if (k === "Escape") { flyCloseComic(); return; }
    if (k === "ArrowRight") { e.preventDefault(); if (S.dir === "rtl") prevPage(); else nextPage(); return; }
    if (k === "ArrowLeft") { e.preventDefault(); if (S.dir === "rtl") nextPage(); else prevPage(); return; }
    if (k === "ArrowDown" || k === "ArrowUp") { if (!scrollMode) e.preventDefault(); return; }
    if (k === " " || k === "PageDown") { e.preventDefault(); nextPage(); return; }
    if (k === "PageUp") { e.preventDefault(); prevPage(); return; }
    if (k === "Home") { e.preventDefault(); S.pi = 0; render(); return; }
    if (k === "End") { e.preventDefault(); S.pi = pages().length - 1; render(); return; }
    if (k === "[") { e.preventDefault(); prevChapter(false); return; }
    if (k === "]") { e.preventDefault(); nextChapter(); return; }
    if (k === "1") { S.mode = "single"; render(); saveReaderDefaults(); return; }
    if (k === "2") { S.mode = "double"; render(); saveReaderDefaults(); return; }
    if (k === "3") { S.mode = "scroll"; render(); saveReaderDefaults(); return; }
    if (k === "f" || k === "F") { document.getElementById("bfull").click(); return; }
    if (k === "s" || k === "S") { S.sidebar = !S.sidebar; syncButtons(); save(); saveReaderDefaults(); return; }
    if (k === "p" || k === "P") { S.thumbs = !S.thumbs; render(); saveReaderDefaults(); return; }
  });


  try { window.addEventListener("beforeunload", function () { saveShelfView(true); }); } catch (e) {}

  // ─── ⑦ 启动 ───────────────────────────────────────────────────────────────
  window.mlBooted = false;
  if (DISK) {
    DISK.getAll().then(function (d) {
      setLIBROOT(d.libRoot || "");
      if (DISK.onDownload) DISK.onDownload(onDlEvent);
      if (DISK.onLibraryRebuilt) DISK.onLibraryRebuilt(function () {
        // 离线重建完成: 保存滚动位置后刷新(滚动恢复逻辑会自动对准)
        saveShelfView(true);
        location.reload();
      });
      setCACHE(d.progress || {});
      setLIBRARY((d.library && d.library.comics) ? d.library : { version: 1, categories: ["在看", "想读", "已读完"], comics: {} });
      if (!LIBRARY.categories) LIBRARY.categories = ["在看", "想读", "已读完"];
      window.mlBooted = true;
      requestAnimationFrame(function () { setTimeout(afterBoot, 0); });   // 先让出一帧, 让书页骨架先画出来(否则主线程一路占着, 首帧要等卡片全建完)
    }).catch(function (err) {
      window.mlBootError = String(err && err.message || err);
      setCACHE({}); setLIBRARY({ version: 1, categories: [], comics: {} });
      window.mlBooted = true;
      requestAnimationFrame(function () { setTimeout(afterBoot, 0); });   // 先让出一帧, 让书页骨架先画出来(否则主线程一路占着, 首帧要等卡片全建完)
    });
  } else {
    window.mlBooted = true;
    requestAnimationFrame(function () { setTimeout(afterBoot, 0); });   // 先让出一帧, 让书页骨架先画出来(否则主线程一路占着, 首帧要等卡片全建完)
  }
})();
