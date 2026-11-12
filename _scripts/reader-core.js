
var RECOG_VER = "v3-20260914";
(function () {
  "use strict";
  var COMICS = __MANIFEST__;
  var STANDALONE = false;
  var LIBTITLE = "漫画书库";
var AUTHOR_ALIAS_FILE = {};   // _scripts\author-alias.json 的内容(UI 里合并作者会写它)
  var PKEY = "mangalib::prog::";
  var MKEY = "mangalib::meta";

  var S = { ci: 0, pi: 0, mode: "single", fit: "height", dir: "rtl", cover: true, sidebar: true, wheel: true, zoom: false, zscale: 1, tx: 0, ty: 0, thumbs: false, sort: "recent", groups: [], q: "", filter: "all", authors: [], plats: [], ratings: [], plat: "", author: "", rating: "", theme: "dark", bright: 1, authOpen: false, platOpen: false, album: "" };
try { var __rt = JSON.parse(localStorage.getItem("readerTheme") || "{}"); if (__rt.theme) S.theme = __rt.theme; if (typeof __rt.bright === "number") S.bright = __rt.bright; } catch (e) {}
try { var __rs = JSON.parse(localStorage.getItem("readerDefaults") || "{}"); if (typeof __rs.sidebar === "boolean") S.sidebar = __rs.sidebar; if (typeof __rs.thumbs === "boolean") S.thumbs = __rs.thumbs; if (__rs.dir) S.dir = __rs.dir; if (__rs.mode) S.mode = __rs.mode; } catch (e) {}
function saveReaderDefaults(){ try { localStorage.setItem("readerDefaults", JSON.stringify({ sidebar: S.sidebar, thumbs: S.thumbs, dir: S.dir, mode: S.mode })); } catch(e){} }

  /* ===== 专辑(虚拟分组, 存 localStorage) ===== */
  function loadAlbums() { try { return JSON.parse(localStorage.getItem("albums") || "{}"); } catch (e) { return {}; } }
  function saveAlbums(a) { try { localStorage.setItem("albums", JSON.stringify(a)); } catch (e) {} }
  function albumCount(name) { var a = loadAlbums(); return (a[name] || []).length; }
  function inAlbum(dir) { if (!S.album) return true; var a = loadAlbums(); return (a[S.album] || []).indexOf(dir) >= 0; }
  function addToAlbum(albumName, dirs) {
    var a = loadAlbums();
    if (!a[albumName]) a[albumName] = [];
    for (var i = 0; i < dirs.length; i++) if (a[albumName].indexOf(dirs[i]) < 0) a[albumName].push(dirs[i]);
    saveAlbums(a);
  }
  function removeFromAlbum(albumName, dirs) {
    var a = loadAlbums();
    if (!a[albumName]) return;
    for (var i = 0; i < dirs.length; i++) { var j = a[albumName].indexOf(dirs[i]); if (j >= 0) a[albumName].splice(j, 1); }
    if (!a[albumName].length) delete a[albumName];
    saveAlbums(a);
  }
  var elAlbumBar = document.getElementById("albumbar");

  var LIBROOT = "";
  var comic = null;

  var elShelf = document.getElementById("shelf");
  var elReader = document.getElementById("reader");
  var elGrid = document.getElementById("grid");
  // 背景视差: 只改 background-position-y, 不碰布局, 代价几乎为零
  var BG_PARALLAX = 0;   // ← 想重新开视差就改成 0.18
  var bgParRaf = 0;
  function bgParallax(y) {
    if (!BG_PARALLAX) return;   // 视差强度(0=关: 用户反馈滚起来看晕了)
    if (!document.body.classList.contains('bgimg')) return;
    if (bgParRaf) return;
    bgParRaf = requestAnimationFrame(function () {
      bgParRaf = 0;
      var py = parseFloat(localStorage.getItem('bgPosY') || '50');
      document.body.style.backgroundPositionY = 'calc(' + py + '% + ' + Math.round(y * 0.18) + 'px)';
    });
  }
  (function(){
    var sb = document.getElementById('shelfbar');
    var lastY = 0;
    elGrid.addEventListener('scroll', function(){
      var y = elGrid.scrollTop;
      if (y > 80 && y > lastY) sb.classList.add('compact');
      else if (y < lastY - 20) sb.classList.remove('compact');
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
  var CARD_CACHE = {};   // dir -> DOM element, 避免每次筛选都重建卡片
  var cardSeq = 0;
  function invalidateCard(dir) { if (dir && CARD_CACHE[dir]) { CARD_CACHE[dir].remove(); delete CARD_CACHE[dir]; } SEARCH_HAY = null; }
  function invalidateAllCards() { for (var k in CARD_CACHE) { if (CARD_CACHE[k].parentNode) CARD_CACHE[k].remove(); } CARD_CACHE = {}; SEARCH_HAY = null; }
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
  var refitRaf = 0;
  function refit() {
    if (refitRaf) return;
    refitRaf = requestAnimationFrame(function () {
      refitRaf = 0;
      try {
        if (!elStage) return;
        var w = elStage.clientWidth, h = elStage.clientHeight;
        if (!w || !h) return;
        elStage.style.setProperty('--sw', w + 'px');
        elStage.style.setProperty('--sh', h + 'px');
      } catch (e) {}
    });
  }
  try { if (window.ResizeObserver && elStage) new ResizeObserver(function () { refit(); }).observe(elStage); } catch (e) {}
  try { window.addEventListener('resize', function () { refit(); }); } catch (e) {}

var elCanvas = null;   // 缩放时的画布层: 用一个 translate 承载"随便拖", 不靠滚动条
  var elChName = document.getElementById("chname");
  var elPageInfo = document.getElementById("pageinfo");
  var elPageInput = document.getElementById("pageinput");
  var elHint = document.getElementById("hint");
  var elBack = document.getElementById("bback");
  var elSortWrap = document.getElementById("sortwrap");
  var elSearchWrap = document.getElementById("searchwrap");
  var io = null;

  function chLabel(ch) { return ch.label || ch.name || ""; }
  function pageList(c, ch) {
    if (ch.files) { var a = []; for (var i = 0; i < ch.files.length; i++) a.push(c.prefix + ch.files[i]); return a; }
    var out = [];
    var dp = ch.path !== undefined ? ch.path : (ch.name || "");
    var base = c.prefix + (dp ? dp + "/" : "");
    for (var k = 1; k <= ch.n; k++) { var s = String(k); while (s.length < ch.pad) s = "0" + s; out.push(base + s + ch.ext); }
    return out;
  }
  function pages() { return pageList(comic, comic.chapters[S.ci]); }
  function enc(p) {
    var s = encodeURI(p).split("#").join("%23").split("?").join("%3F");
    // 中文等非 ASCII 也要编码: 外部引用的书是绝对 file:// 地址, 不编码会加载不出来
    return s.replace(/[^\x00-\x7F]/g, function (c) { return encodeURIComponent(c); });
  }
  function nOf(ch) { return ch.files ? ch.files.length : ch.n; }
  function totalPages(c) { var t = 0; for (var i = 0; i < c.chapters.length; i++) t += nOf(c.chapters[i]); return t; }

  var DISK = (typeof window !== "undefined" && window.mangaLib && window.mangaLib.isElectron) ? window.mangaLib : null;
  var CACHE = null, LIBRARY = null, saveTimer = null, libTimer = null;

  function prog(dir) {
    if (CACHE) return CACHE[dir] || null;
    try { return JSON.parse(localStorage.getItem(PKEY + dir) || "null"); } catch (e) { return null; }
  }
  function setProg(dir, o) {
    if (CACHE) {
      CACHE[dir] = o;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { DISK.setProgress(dir, o); }, 350);
      return;
    }
    try { localStorage.setItem(PKEY + dir, JSON.stringify(o)); } catch (e) {}
  }
  function libSave() {
    if (libTimer) clearTimeout(libTimer);
    if (!DISK || !DISK.saveLibrary) return;   // 浏览器里只读, 不落盘(桌面版才会写 library.json)
    libTimer = setTimeout(function () { DISK.saveLibrary(LIBRARY); }, 500);
  }
  function meta() {
    if (LIBRARY) {
      var m = {}, c = LIBRARY.comics || {};
      for (var k in c) { if (c[k] && c[k].lastRead) m["t::" + k] = c[k].lastRead; }
      return m;
    }
    try { return JSON.parse(localStorage.getItem(MKEY) || "{}"); } catch (e) { return {}; }
  }
  function setMeta(o) {
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
  function libEntry(dir) {
    if (!LIBRARY) return null;
    LIBRARY.comics = LIBRARY.comics || {};
    if (!LIBRARY.comics[dir]) LIBRARY.comics[dir] = { favorite: false, categories: [], tags: [], note: "" };
    var e = LIBRARY.comics[dir];
    if (!e.categories) e.categories = [];
    if (!e.tags) e.tags = [];
    return e;
  }

  var hintTimer = null;
  function hint(msg) {
    elHint.textContent = msg; elHint.classList.add("show");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { elHint.classList.remove("show"); }, 1100);
  }

  var CMAP = (function () { var m = {}; for (var i = 0; i < COMICS.length; i++) m[COMICS[i].dir] = COMICS[i]; return m; })();
  function entryOf(dir) {
    if (LIBRARY && LIBRARY.comics && LIBRARY.comics[dir]) return LIBRARY.comics[dir];
    return CMAP[dir] || null;   // 浏览器(file://)没有 library.json -> 用 manifest 里带的元数据
  }
  function inFilter(dir) {
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
  function normName(s) {
    try { return String(s == null ? "" : s).normalize("NFKC").replace(/\s+/g, " ").trim(); }
    catch (e) { return String(s == null ? "" : s).trim(); }
  }
  function innerAuthor(raw) {
    var m = normName(raw).match(/^(.{1,60}?)[（(]([^（()）]{1,40})[)）]?\s*$/);
    return m ? normName(m[2]) : "";
  }
  function autoAuthor(raw) {
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
  function authorKey(raw) {
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
  function authorOf(dir) { var e = entryOf(dir); return authorKey(e && e.author) || "未标注"; }
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
  function capFirst(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function platformOf(dir) {
    var e = entryOf(dir);
    var s = String((e && e.source && (e.source.site || e.source.url)) || "");
    if (!s) return "未标注";
    for (var i = 0; i < BIG_PLATS.length; i++) if (BIG_PLATS[i][0].test(s)) return BIG_PLATS[i][1];
    for (var j = 0; j < SITE_LABELS.length; j++) if (SITE_LABELS[j][0].test(s)) return SITE_LABELS[j][1];
    // 未识别的 site: 去掉协议/端口/路径, 用 host 或 id 本身(首字母大写)
    var host = s.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0].replace(/^www\./i, "");
    return host ? capFirst(host) : "未标注";
  }
  // 大平台(X/抖音/微博/pixiv)的"一本"本质是一个人的图包: 量词用 篇/张, 不用 话/页
  function isBigPlat(dir) { var p = platformOf(dir); return p === "X" || p === "微博" || p === "pixiv"; }   // 抖音已按发布时间正序排, 默认从第一页看起, 不进倒序名单
  function unitQ(dir) { return isBigPlat(dir) ? "篇" : "话"; }
  function unitP(dir) { return isBigPlat(dir) ? "张" : "页"; }
  // 拖动排序会整块重渲染, 重渲染后把滚动位置按差值还原, 免得"往上跳"
  function keepScroll(fn) {
    var se = document.scrollingElement || document.body;
    var y0 = se ? se.scrollTop : 0, g0 = elGrid ? elGrid.scrollTop : 0;
    try { fn(); } catch (e) {}
    var restore = function () {
      try { if (se) se.scrollTop = y0; } catch (e) {}
      try { if (elGrid) elGrid.scrollTop = g0; } catch (e) {}
    };
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 60);
    setTimeout(restore, 200);
  }
  function manifestOf(dir) {   // 从 manifest 里取这本书(带 ai/work/char 字段)
    for (var i = 0; i < COMICS.length; i++) if (COMICS[i].dir === dir) return COMICS[i];
    return null;
  }
  function authorGroups() {
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
  function saveAliasMap(map, cb) {
    try {
      var cur = JSON.parse(localStorage.getItem("authorAlias") || "{}");
      for (var k in map) cur[k] = map[k];
      localStorage.setItem("authorAlias", JSON.stringify(cur));
      for (var k2 in map) AUTHOR_ALIAS[k2] = map[k2];
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
  // 把某个作者(含它下面的所有原始写法)合并到目标名
  function mergeAuthorInto(fromKey, toKey, cb) {
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
  function mergeAuthorDialog(fromKey, raws) {
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
  function authorCtx(x, y, key, raws) {
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
  function countIn(f) { if (f === "bookmark") return bmAll().length;
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

  /* ===== 书名排序键(移植自 build-library.mjs sortKey/natCmp + 书名归一化) =====
     中文数字转阿拉伯补零; 去开头汉化组/作者方括号、语言标签、AI 标记后按核心书名排 */
  var CN_D = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var CN_U = { '十': 10, '百': 100, '千': 1000 };
  function cn2num(run) { var total = 0, num = 0; for (var i = 0; i < run.length; i++) { var ch = run[i]; if (ch in CN_D) num = CN_D[ch]; else if (ch in CN_U) { total += (num || 1) * CN_U[ch]; num = 0; } } return total + num; }
  function sortKey(s) {
    return String(s).replace(/[零〇一二三四五六七八九十百千两]+/g, function (m) { return String(cn2num(m)).padStart(6, '0'); }).toLowerCase();
  }
  function titleNorm(dir) {
    var s = String(dir || '');
    s = s.split('/').pop() || s;
    s = s.replace(/^\s*\[[^\]]*\]\s*/g, '');                                   // 去开头汉化组/作者方括号前缀
    s = s.replace(/[(\[][^)\]]*(Chinese|English|Japanese|中文|汉化|漢化|中国翻译|中国語|日本語|英語)[^)\]]*[)\]]/gi, ' ');  // 语言标签
    s = s.replace(/AI\s*[Gg]enerated?/g, ' ');                                  // AI 标记
    return s;
  }
  function bookSortKey(c) { return sortKey(titleNorm(c && c.dir)); }
  function bookCmp(a, b) { var ka = bookSortKey(a), kb = bookSortKey(b); return ka.localeCompare(kb, 'zh', { numeric: true, sensitivity: 'base' }); }

  /* ===== 分组维度(可多选): author/work/plat/rating/char ===== */
  var GROUP_DIM_ORDER = ['author', 'work', 'plat', 'rating', 'char'];
  var GROUP_DIM_LABEL = { author: '按作者', work: '按作品', plat: '按平台', rating: '按分级', char: '按角色' };
  function groupLabelFor(dir, dim) {
    var ent = entryOf(dir), mf = manifestOf(dir);
    if (dim === 'author') { var ak = authorKey(ent && ent.author); return ak || '未标注'; }
    if (dim === 'rating') return (mf && mf.rating === '18+') ? '18+' : '非 18+';
    if (dim === 'work') return (mf && mf.work) || '未识别作品';
    if (dim === 'char') return (mf && mf.char) || '未识别角色';
    if (dim === 'plat') return platformOf(dir);
    return '';
  }

  // 书卡 tag 区: 最多 2 排, 超出折叠成 +N, 点 +N 展开全部
  function clampTags(tw) {
    if (!tw || tw.dataset.clamped) return;
    var kids = Array.prototype.slice.call(tw.children);
    if (!kids.length) return;
    var top0 = kids[0].offsetTop;
    var rowH = kids[0].offsetHeight + 4;
    for (var i = 1; i < kids.length; i++) {
      if (kids[i].offsetTop > top0) { rowH = kids[i].offsetTop - top0; break; }
    }
    var limit = top0 + rowH * 2;
    var hidden = [];
    for (var j = 0; j < kids.length; j++) {
      if (kids[j].offsetTop > limit) hidden.push(kids[j]);
    }
    tw.dataset.clamped = "1";
    if (!hidden.length) return;
    hidden.forEach(function (k) { k.style.display = "none"; });
    var more = document.createElement("span");
    more.className = "ctag moretag";
    more.textContent = "+" + hidden.length;
    more.title = "展开全部 " + hidden.length + " 个标签";
    more._hidden = hidden;
    more._open = false;
    more.onclick = function (ev) {
      ev.stopPropagation();
      this._open = !this._open;
      if (this._open) { this._hidden.forEach(function (k) { k.style.display = ""; }); this.textContent = "−收"; }
      else { this._hidden.forEach(function (k) { k.style.display = "none"; }); this.textContent = "+" + this._hidden.length; }
    };
    tw.appendChild(more);
  }
  // ── View Transitions: 把"分类/搜索/设置"引起的瞬间重排变成平滑过渡 ──
  // 卡片元素来自 CARD_CACHE 复用, 所以带 view-transition-name 的卡片会"平移到新位置"而不是淡出再淡入
  var VTID = 0, lastVT = 0, VT_ON = true, vtBusy = false;
  function vtWrap(fn) {
    try {
      if (!VT_ON || !document.startViewTransition) { fn(); return; }
      var now = Date.now();
      if (now - lastVT < 140) { fn(); return; }   // 连打(比如快速输入搜索)时跳过, 免得抖
      lastVT = now;
      document.startViewTransition(fn);
    } catch (e) { try { fn(); } catch (e2) {} }
  }

  function renderShelf() {
    vtWrap(function () { renderShelfNow(); });
  }

  function renderShelfNow() {
    cardSeq = 0;
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
        var ta = BOOKTIMES[a.dir] || (ea && ea.lastRead) || m["t::" + a.dir] || 0;
        var tb = BOOKTIMES[b.dir] || (eb && eb.lastRead) || m["t::" + b.dir] || 0;
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
    if (!list.length) {
      elGrid.innerHTML = "";
      var d = document.createElement("div");
      d.id = "empty";
      d.textContent = COMICS.length ? "没有符合条件的漫画" : "书库里还没有漫画。把漫画文件夹放进书库根目录, 双击 更新书库.cmd";
      elGrid.appendChild(d);
    } else if (!dims.length) {
      // 非分组: 复用缓存卡片, 只移动顺序 + 显隐, 不重建 DOM
      var frag = document.createDocumentFragment();
      var visibleDirs = {};
      for (var k = 0; k < list.length; k++) {
        var cel = card(list[k], m);
        cel.style.display = "";
        visibleDirs[list[k].dir] = 1;
        frag.appendChild(cel);   // appendChild 对已有节点是移动, 极快
      }
      // 隐藏不在列表里的已有卡片
      var existing = elGrid.children;
      for (var ei = existing.length - 1; ei >= 0; ei--) {
        var ex = existing[ei];
        var ed = ex.getAttribute("data-dir");
        if (ed && !visibleDirs[ed]) { ex.style.display = "none"; frag.appendChild(ex); }
      }
      // 清空分组残留(agroup/ahead/empty)
      var stale = elGrid.querySelectorAll(".agroup,#empty");
      for (var si = 0; si < stale.length; si++) stale[si].remove();
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
        for (var gj = 0; gj < gmap[gname].length; gj++) { var cel = card(gmap[gname][gj], m); makeDraggable(cel, gmap[gname], gname, GROUP_MODE); wrap.appendChild(cel); }
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

  /* ---------- 浏览界面状态持久化: 分类标签 / 排序 / 搜索词 / 作者筛选 / 滚动位置 ---------- */
  var viewTimer = 0;
  var VIEW_KEY = "shelfView";
  function saveShelfView(now) {
    if (viewTimer) { clearTimeout(viewTimer); viewTimer = 0; }
    var write = function () {
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify({
          filter: S.filter, filters: (S.filters || []).slice(), sort: S.sort, groups: (S.groups || []).slice(), q: S.q,
          authors: (S.authors || []).slice(), plats: (S.plats || []).slice(), ratings: (S.ratings || []).slice(), works: (S.works || []).slice(),
          author: (S.authors && S.authors[0]) || "", plat: (S.plats && S.plats[0]) || "", rating: (S.ratings && S.ratings[0]) || "",
          authOpen: !!S.authOpen, platOpen: !!S.platOpen, workOpen: !!S.workOpen,
          scroll: elGrid ? Math.round(elGrid.scrollTop) : 0
        }));
      } catch (e) {}
    };
    if (now) write(); else viewTimer = setTimeout(function () { viewTimer = 0; write(); }, 350);
  }
  function loadShelfView() {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "null"); } catch (e) { return null; }
  }

  var SEARCH_HAY = null;   // 搜索用的预拼接字符串缓存
  function buildSearchHay() {
    SEARCH_HAY = {};
    for (var i = 0; i < COMICS.length; i++) {
      var c = COMICS[i], e0 = entryOf(c.dir);
      SEARCH_HAY[c.dir] = (c.dir + " " + ((e0 && e0.tags) ? e0.tags.join(" ") : "") + " " + normName(e0 && e0.author) + " " + authorOf(c.dir) + " " + normName(e0 && e0.note)).toLowerCase();
    }
  }
  function manualOrder() { try { return JSON.parse(localStorage.getItem('shelfOrder') || '{}'); } catch (e) { return {}; } }
  function saveManualOrder(o) { try { localStorage.setItem('shelfOrder', JSON.stringify(o)); } catch (e) {} }
  var dragSrc = null;
  var dragScrollStep = 0, dragScrollOn = false, dragScrollRAF = 0;
  function scrollers() {   // 书架可能滚在 body 上, 也可能滚在 #grid/#shelf 里: 全都试一遍
    var out = [];
    var se = document.scrollingElement; if (se) out.push(se);
    if (elGrid) out.push(elGrid);
    var sh = document.getElementById("shelf"); if (sh) out.push(sh);
    return out;
  }
  function dragScrollTick() {
    if (!dragSrc || !dragScrollStep) { dragScrollOn = false; dragScrollRAF = 0; return; }
    var list = scrollers();
    for (var i = 0; i < list.length; i++) {
      var el2 = list[i];
      try { if (el2.scrollHeight > el2.clientHeight + 2) el2.scrollTop += dragScrollStep; } catch (e) {}
    }
    dragScrollRAF = requestAnimationFrame(dragScrollTick);
  }
  function autoScroll(y) {   // 拖到窗口上下边缘自动滚屏(原生拖拽期间滚轮被浏览器屏蔽, 只能靠这个)
    var h = window.innerHeight || 800, edge = 170, st = 0;
    if (y < edge) st = -Math.max(6, Math.round((edge - y) / 8));
    else if (y > h - edge) st = Math.max(6, Math.round((y - (h - edge)) / 8));
    dragScrollStep = st;
    if (st && !dragScrollOn) { dragScrollOn = true; dragScrollRAF = requestAnimationFrame(dragScrollTick); }
  }
  document.addEventListener("dragover", function (ev) { if (dragSrc) autoScroll(ev.clientY); }, true);
  // 把一个分组变成"能接收别组卡片"的落点: 拖进来 = 把这本改成这个分组
  function makeGroupDrop(sec, gname, mode) {
    sec.setAttribute("data-gname", gname);
    sec.ondragover = function (ev) { if (!dragSrc) return; ev.preventDefault(); sec.classList.add("droptarget"); autoScroll(ev.clientY); };
    sec.ondragleave = function () { sec.classList.remove("droptarget"); };
    sec.ondrop = function (ev) { ev.preventDefault(); sec.classList.remove("droptarget"); if (dragSrc) applyGroupDrop(dragSrc.getAttribute("data-dir"), gname, mode); };
  }
  function applyGroupDrop(dir0, gname, mode, cardEl) {
    var dir = dir0;
    if (!dir) return;
    var mfc = manifestOf(dir) || {};
    var cur = mode === "work" ? (mfc.work || "未识别作品") : (mode === "char" ? (mfc.char || "未识别角色") : (mode === "author" ? (authorKey((entryOf(dir) || {}).author) || "未标注") : ""));
    if (cur === gname) return;
    var e2 = libEntry(dir);
    var nv = (gname === "未识别作品" || gname === "未识别角色" || gname === "未标注") ? "" : gname;
    if (mode === "work") { e2.work = nv; mfc.work = nv; }
    else if (mode === "char") { e2.char = nv; mfc.char = nv; }
    else if (mode === "author") { e2.author = nv; }
    else return;
    libSave();
    // 直接操作 DOM: 把卡片移到目标组的 agrid, 更新两边的计数, 不重建整个书架
    if (cardEl) {
      var srcSec = cardEl.closest(".agroup");
      var dstSec = document.querySelector('.agroup[data-gname="' + CSS.escape(gname) + '"]');
      if (srcSec && dstSec && srcSec !== dstSec) {
        var dstGrid = dstSec.querySelector(".agrid");
        if (dstGrid) dstGrid.appendChild(cardEl);
        // 更新两边计数
        function updateCount(sec) {
          var n = sec.querySelectorAll(".agrid .card").length;
          var cnt = sec.querySelector(".ahead .cnt");
          if (cnt) cnt.textContent = n + " 本";
          sec.classList.toggle("single", n === 1);
        }
        updateCount(srcSec);
        updateCount(dstSec);
        // 源组空了就隐藏; 目标组如果之前被隐藏了就显示
        if (srcSec.querySelectorAll(".agrid .card").length === 0) srcSec.style.display = "none";
        dstSec.style.display = "";
      }
    }
    hint("已把 " + (mfc.name || dir).slice(0, 12) + " 归到「" + gname + "」");
  }
  var hoverEl = null;
  function setHover(t) {
    if (hoverEl === t) return;
    if (hoverEl && hoverEl.classList) hoverEl.classList.remove("droptarget");
    hoverEl = t;
    if (hoverEl && hoverEl.classList) hoverEl.classList.add("droptarget");
  }
  function finishReorder(el, target, items, gname) {
    // 直接从 DOM 位置算 from/to, 不依赖 items 数组(多次拖动后 items 可能过期)
    var parent = el.parentNode;
    if (!parent || target.parentNode !== parent) return;
    var children = Array.prototype.filter.call(parent.children, function (c) { return c.classList.contains("card") && !c.classList.contains("acard"); });
    var from = children.indexOf(el);
    var to = children.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    // 移动 DOM 元素
    if (to > from) parent.insertBefore(el, target.nextSibling);
    else parent.insertBefore(el, target);
    // 同步 items 数组(供下次计算用), 并存到 localStorage
    var moved = items.splice(from, 1)[0];
    items.splice(to, 0, moved);
    var ord = manualOrder();
    for (var i = 0; i < items.length; i++) ord[items[i].dir] = i + 1;
    saveManualOrder(ord);
    hint("已保存顺序：" + gname);
  }
  // 指针事件版拖拽: 原生 HTML5 拖拽期间浏览器会屏蔽滚轮, 换 pointer 后滚轮和边缘滚动都能用
  function makeDraggable(el, items, gname, mode) {
    el.style.touchAction = "none";
    el.onpointerdown = function (ev) {
      if (ev.button !== 0) return;
      if (!el.getAttribute("data-dir")) return;
      var sx = ev.clientX, sy = ev.clientY, started = false, ghost = null;
      var onMove = function (e2) {
        if (!started) {
          if (Math.abs(e2.clientX - sx) + Math.abs(e2.clientY - sy) < 8) return;
          started = true; dragSrc = el; el.classList.add("dragging"); el.style.opacity = ".35";
          try {
            ghost = el.cloneNode(true);
            ghost.className = "card dragghost";
            ghost.style.cssText = "position:fixed;pointer-events:none;z-index:9999;opacity:.85;width:" + el.offsetWidth + "px;transform:rotate(2deg)";
            document.body.appendChild(ghost);
          } catch (er) {}
        }
        if (ghost) { ghost.style.left = (e2.clientX - 40) + "px"; ghost.style.top = (e2.clientY - 40) + "px"; }
        autoScroll(e2.clientY);
        var under = document.elementFromPoint(e2.clientX, e2.clientY);
        var sec2 = (under && under.closest) ? under.closest(".agroup") : null;
        var tg = (under && under.closest) ? under.closest(".card") : null;
        var myG = el.closest(".agroup");
        if (sec2 && myG && sec2 !== myG) setHover(sec2);
        else if (tg && tg !== el && tg.closest(".agroup") === myG) setHover(tg);
        else setHover(null);
        if (e2.cancelable) e2.preventDefault();
      };
      var onUp = function (e2) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!started) return;
        var under = document.elementFromPoint(e2.clientX, e2.clientY);
        var sec3 = (under && under.closest) ? under.closest(".agroup") : null;
        var tg3 = (under && under.closest) ? under.closest(".card") : null;
        var myG = el.closest(".agroup");
        el.classList.remove("dragging"); el.style.opacity = "";
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        setHover(null);
        if (sec3 && myG && sec3 !== myG) applyGroupDrop(el.getAttribute("data-dir"), sec3.getAttribute("data-gname"), mode, el);
        else if (tg3 && tg3 !== el) finishReorder(el, tg3, items, gname);
        dragSrc = null; dragScrollStep = 0;
        if (dragScrollRAF) { cancelAnimationFrame(dragScrollRAF); dragScrollRAF = 0; }
        // 吃掉拖拽结束后浏览器自动触发的那次 click(否则会打开落在上面的书)
        justDraggedUntil = Date.now() + 300;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  var COLOR_CACHE = {};
  function hsv2rgb(h, s, v) {
    var c = h/60, x = v*s*(1-Math.abs(c%2-1));
    var r,g,b;
    if(c<1){r=v;g=x;b=0} else if(c<2){r=x;g=v;b=0} else if(c<3){r=0;g=v;b=x} else if(c<4){r=0;g=x;b=v} else if(c<5){r=x;g=0;b=v} else {r=v;g=0;b=x}
    return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
  }
  function extractCardColor(img, cardEl) {
    if (!cardEl) return;
    var src = img.src;
    if (COLOR_CACHE[src]) {
      cardEl.style.setProperty('--c1', COLOR_CACHE[src][0]);
      cardEl.style.setProperty('--c2', COLOR_CACHE[src][1]);
      return;
    }
    try {
      var canvas = document.createElement('canvas');
      var w = canvas.width = 40, h = canvas.height = 60;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      // ── 聚簇投票取主色: 24 个色相桶, 权重 = 色度 × 明度适中度 ──
      // 原来取「最饱和的那一个像素」, 封面里一个孤立亮点就能夺权(实测 18% 的卡片抽到的色相跟封面主色差 >60°)
      var NB = 24;
      var bw = new Float64Array(NB), brr = new Float64Array(NB), bgg = new Float64Array(NB), bbb = new Float64Array(NB);
      var anyW = 0, tR = 0, tG = 0, tB = 0, tW = 0;
      for (var i = 0; i < data.length; i += 4) {
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn;
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        var wgt = ch * (1 - Math.abs(lum - 128) / 220);
        if (wgt < 1) wgt = 1;
        tR += r * wgt; tG += g * wgt; tB += b * wgt; tW += wgt;
        if (ch < 25 || lum < 25) continue;
        var hh;
        if (mx === r) hh = ((g - b) / ch) % 6; else if (mx === g) hh = (b - r) / ch + 2; else hh = (r - g) / ch + 4;
        hh *= 60; if (hh < 0) hh += 360;
        var kk0 = Math.floor(hh / 15) % NB;
        bw[kk0] += wgt; brr[kk0] += r * wgt; bgg[kk0] += g * wgt; bbb[kk0] += b * wgt;
        anyW += wgt;
      }
      var dR, dG, dB;
      if (anyW > 0) {
        var best = 0;
        for (var k2 = 1; k2 < NB; k2++) if (bw[k2] > bw[best]) best = k2;
        var near = [best, (best + 1) % NB, (best + NB - 1) % NB];   // 冠军桶 + 左右邻桶(色相连续, 只取一个会丢边)
        var sR = 0, sG = 0, sB = 0, sW = 0;
        for (var u = 0; u < 3; u++) { var ku = near[u]; sR += brr[ku]; sG += bgg[ku]; sB += bbb[ku]; sW += bw[ku]; }
        if (sW > 0) { dR = sR / sW; dG = sG / sW; dB = sB / sW; }
      }
      if (dR === undefined) {   // 封面真的没颜色(黑白漫/强灰) → 用全图加权平均, 偏中性, 而不是抽到噪点
        dR = tW ? tR / tW : 139; dG = tW ? tG / tW : 92; dB = tW ? tB / tW : 246;
      }
      var base = 'rgb(' + Math.round(dR) + ',' + Math.round(dG) + ',' + Math.round(dB) + ')';
      // OKLCH 感知增色(交给浏览器算): 色度 ×1.4, 亮度夹到舒适区, 不透明度 .45 → .62
      var c1 = 'oklch(from ' + base + ' clamp(0.55, l, 0.72) calc(c * 1.4) h / .62)';
      // 角上那圈光晕: 更亮更艳一档
      var c2 = 'oklch(from ' + base + ' clamp(0.68, l, 0.84) calc(c * 1.55) h / .58)';
      COLOR_CACHE[src] = [c1, c2];
      cardEl.style.setProperty('--c1', c1);
      cardEl.style.setProperty('--c2', c2);
    } catch(e) {}
  }

  function card(c, m) {
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
      if (cardSeq++ < 8) im.fetchPriority = "high";   // 首屏前 8 张优先
      im.src = enc(revCov || c.cover || first);
      im.onload = function() { extractCardColor(im, el); };
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
        s1.onclick = function (ev) { ev.stopPropagation(); S.filter = this.textContent; S.q = ""; if (elSearch) elSearch.value = ""; renderShelf(); saveShelfView(true); };
        tw.appendChild(s1);
      }
      for (ci = 0; ci < _tags.length; ci++) {
        if (seenTag[_tags[ci]]) continue;
        seenTag[_tags[ci]] = 1;
        var s2 = document.createElement("span"); s2.className = "ctag tag"; s2.textContent = "#" + _tags[ci];
        s2.title = "点一下：搜索标签「" + _tags[ci] + "」";
        s2.onclick = function (ev) { ev.stopPropagation(); S.q = this.textContent.slice(1); if (elSearch) elSearch.value = S.q; renderShelf(); saveShelfView(true); };
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
      if (SEL.length) { SEL = []; renderShelf(); hint("已取消选择"); return; }   // 先清选择, 再点才进书
      flyOpenComic(c, el.querySelector(".thumb img"));   // 封面飞进阅读器
    };
    el.oncontextmenu = function (ev) { ev.preventDefault(); showCtx(ev.clientX, ev.clientY, c.dir); };
    CARD_CACHE[c.dir] = el;
    return el;
  }

  /* ================= 多选批量操作 (Ctrl / Shift 点卡片) ================= */
  var SEL = [], SELANCHOR = null;
  var justDraggedUntil = 0;   // 拖拽结束后 300ms 内的 click 忽略(防止松手时误打开书)
  function selHas(d) { return SEL.indexOf(d) >= 0; }
  function visibleDirs() {
    return Array.prototype.map.call(document.querySelectorAll("#grid .card"), function (el) { return el.getAttribute("data-dir"); }).filter(Boolean);
  }
  function renderSelBar() {
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
  function selToggle(d) {
    var i = SEL.indexOf(d);
    if (i >= 0) SEL.splice(i, 1); else SEL.push(d);
    SELANCHOR = d;
    // 只更新这张卡片的样式和 selbar, 不重建整个 grid(避免滚动跳变/滚轮失灵)
    var el = document.querySelector('.card[data-dir="' + CSS.escape(d) + '"]');
    if (el) el.classList.toggle("sel", SEL.indexOf(d) >= 0);
    renderSelBar();
  }
  function selRange(d) {
    var list = visibleDirs();
    var a = SELANCHOR ? list.indexOf(SELANCHOR) : -1, b = list.indexOf(d);
    if (a < 0 || b < 0) { selToggle(d); return; }
    var lo = Math.min(a, b), hi = Math.max(a, b);
    for (var i = lo; i <= hi; i++) {
      if (!selHas(list[i])) SEL.push(list[i]);
      var el = document.querySelector('.card[data-dir="' + CSS.escape(list[i]) + '"]');
      if (el) el.classList.add("sel");
    }
    SELANCHOR = d;
    renderSelBar();
  }
  function selClear() { if (SEL.length) { SEL = []; renderShelf(); } }
  function selNewAlbum() {
    if (!SEL.length) return;
    var dirs = SEL.slice();
    askText("新建专辑", "专辑名", function (name) {
      name = (name || "").trim();
      if (!name) return;
      var a = loadAlbums();
      if (a[name]) {
        // 专辑已存在: 追加进去
        addToAlbum(name, dirs);
      } else {
        a[name] = dirs.slice(); saveAlbums(a);
      }
      S.album = name; SEL = [];
      renderShelf();
      hint("已创建专辑「" + name + "」，含 " + dirs.length + " 本");
    });
  }
  function selRemoveFromAlbum() {
    if (!SEL.length || !S.album) return;
    var dirs = SEL.slice();
    removeFromAlbum(S.album, dirs);
    hint("已移出 " + dirs.length + " 本");
    SEL = []; renderShelf();
  }
  function selDelete() {
    if (!SEL.length) return;
    var list = SEL.slice();
    deleteMany(list, function () { SEL = []; renderShelf(); });
  }
  function selCategory() {
    if (!SEL.length) return;
    if (!LIBRARY) { hint("分类需要桌面版"); return; }
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "把 " + SEL.length + " 本移到分类"; box.appendChild(h);
      var sub = document.createElement("div"); sub.className = "sub";
      sub.textContent = "只改书库里的分类归属，磁盘上的文件夹不动；选中的书原来的分类会被替换。";
      box.appendChild(sub);
      var cats = (LIBRARY.categories || []).slice();
      var pick = { v: "" };
      var list = document.createElement("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin:6px 0 10px;max-height:240px;overflow:auto";
      function addOpt(v, label) {
        var lb = document.createElement("label"); lb.className = "chk";
        var r = document.createElement("input"); r.type = "radio"; r.name = "selcat";
        r.checked = (pick.v === v);
        r.onchange = function () { pick.v = v; };
        lb.appendChild(r); lb.appendChild(document.createTextNode(label));
        list.appendChild(lb);
      }
      addOpt("", "（移出所有分类）");
      cats.forEach(function (c) { addOpt(c, c); });
      box.appendChild(list);
      var l2 = document.createElement("label"); l2.textContent = "或新建分类（填了就忽略上面的选择）"; box.appendChild(l2);
      var ni = document.createElement("input"); ni.type = "text"; ni.placeholder = "例如：长篇 / 短篇 / 待看"; box.appendChild(ni);
      ni.onkeydown = function (e) { e.stopPropagation(); };
      modalFoot(box, function () {
        var v = ni.value.trim() || pick.v;
        closeModal();
        for (var i = 0; i < SEL.length; i++) { var e2 = libEntry(SEL[i]); e2.categories = v ? [v] : []; }
        if (v && (LIBRARY.categories || []).indexOf(v) < 0) LIBRARY.categories = (LIBRARY.categories || []).concat([v]);
        libSave();
        var n = SEL.length; SEL = [];
        renderShelf();
        hint("已把 " + n + " 本移到「" + (v || "无分类") + "」");
      }, "移动");
    });
  }
  function selTags() {
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
        var n = SEL.length; SEL = [];
        renderShelf();
        hint((replace ? "已覆盖 " : "已加标签: ") + n + " 本");
      }
      ok.onclick = function () { apply(false); };
      over.onclick = function () { apply(true); };
      setTimeout(function () { inp.focus(); }, 40);
    });
  }
  (function () {
    var b1 = document.getElementById("seldel"); if (b1) b1.onclick = selDelete;
    var b2 = document.getElementById("selcat"); if (b2) b2.onclick = selCategory;
    var b3 = document.getElementById("seltag"); if (b3) b3.onclick = selTags;
    var b4 = document.getElementById("selclear"); if (b4) b4.onclick = selClear;
    var b5 = document.getElementById("selalbum"); if (b5) b5.onclick = selNewAlbum;
    var b6 = document.getElementById("selremovealbum"); if (b6) b6.onclick = selRemoveFromAlbum;
  })();

  /* ================= 漫画网站总览 ================= */
  var SITES = [
    { g: "免费中文（汉化）在线站", list: [
      { n: "拷贝漫画 CopyManga", u: "https://copymanga.tv/", alt: "copymanga.org / mangacopy.com / copy20.com（镜像轮换）", note: "简体，日漫汉化最全之一，有 v3 JSON API" },
      { n: "漫画柜 manhuagui", u: "https://www.manhuagui.com/", note: "老牌汉化站" },
      { n: "再漫画 zaimanhua", u: "https://manhua.zaimanhua.com/", note: "纯 HTTP API；支持站内搜索", done: true, search: true },
      { n: "X漫画 xmanhua", u: "https://www.xmanhua.net/", note: "静态站；下载已适配（贴目录页链接即可，例如 /35231xm/）。站内搜索是前端 JS 拼的，暂未适配", done: true },
      { n: "包子漫画 baozimh", u: "https://baozimh.org/", alt: "cn.bzmgcn.com / baozimh.com", note: "韩漫+日漫汉化，量大" },
      { n: "动漫屋 / 极速漫画 dm5", u: "https://www.dm5.com/", note: "本机可直连" },
      { n: "扑飞漫画 1kkk", u: "https://www.1kkk.com/", note: "本机可直连" },
    ] },
    { g: "有 API 的站", list: [
      { n: "Komiic（中文站 komiic.cc）", u: "https://komiic.cc/", alt: "komiic.com（同一个后端）", note: "GraphQL API + 图片票据；匿名每天 300 张，登录后按账号配额；支持站内搜索", done: true, search: true },
    ] },
    { g: "大平台（图包）", list: [
      { n: "X (twitter)", u: "https://x.com/", note: "主页/媒体页 = 一个人的图包，单条推文也并进这个人的图包；图片取 ?name=orig 原图；枚举要用调试浏览器且已登录 X", done: true },
      { n: "微博 weibo", u: "https://weibo.com/", note: "一个人 = 一个图包；桌面版接口 + cookie，纯 HTTP，不用浏览器；动图原样存 GIF", done: true },
      { n: "抖音 douyin", u: "https://www.douyin.com/", note: "只收图文作品（视频不下），动图用 ffmpeg 转 GIF；枚举要走调试浏览器", done: true },
    ] },
    { g: "同人 / 其它", list: [
      { n: "nhentai", u: "https://nhentai.net/", note: "英文同人志站，v2 API + 图片直链；直连会被 CF 403，先跑 site-login 抓 cookie", done: true },
      { n: "E-Hentai", u: "https://e-hentai.org/", alt: "https://exhentai.org/（要论坛登录的 igneous cookie）", note: "画廊 = 一本书；纯 HTTP 走 cookie，不用浏览器。看图片额度：登录后打开 https://e-hentai.org/home.php 的 Image Limits 一段", done: true },
      { n: "Pixiv", u: "https://www.pixiv.net/", alt: "作品页 /artworks/<id> 或作者主页 /users/<uid>", note: "两个都能下：作品=一话(多页自动展开)，作者主页=一本书", done: true },
    ] },
    { g: "整本 / 合集 / 下载站", list: [
      { n: "漫客栈系 mangabz", u: "https://www.mangabz.com/", note: "下载/合集站" },
      { n: "Kmoe（原 mox.moe / vol.moe）", u: "https://mox.moe/", note: "台版/汉化单行本 epub→mobi，一卷一文件，不用逐页拼图" },
    ] },
    { g: "需要账号的站", list: [
      { n: "漫画补档 manhuabudang", u: "https://www.manhuabudang.com/", note: "要登录" },
      { n: "萌享 moeshare", u: "https://www.moeshare.cc/", note: "要登录" },
    ] },
  ];
  function openSitesDialog() {
    var browser = "chrome";
    try { browser = localStorage.getItem("jmBrowser") || "chrome"; } catch (e) {}
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "漫画网站总览"; box.appendChild(h);
      var s = document.createElement("div"); s.className = "sub";
      s.textContent = "点站名就用「下载用的那个浏览器」打开；带  的是已适配自动下载（可直接贴链接），带「站内搜索」的会出现在跨站搜索面板里。";
      box.appendChild(s);
      var lb = document.createElement("label"); lb.textContent = "用哪个浏览器打开"; box.appendChild(lb);
      var sel = document.createElement("select");
      [["chrome", "Google Chrome（端口 9333）"], ["edge", "Edge（端口 9334）"]].forEach(function (o) {
        var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; if (browser === o[0]) op.selected = true; sel.appendChild(op);
      });
      sel.onchange = function () { browser = sel.value; try { localStorage.setItem("jmBrowser", browser); } catch (e) {} hint("改用 " + (browser === "edge" ? "Edge" : "Chrome") + " 打开"); };
      box.appendChild(sel);
      var wrap = document.createElement("div"); wrap.id = "sitebox"; box.appendChild(wrap);
      SITES.forEach(function (grp) {
        var gh = document.createElement("div"); gh.className = "sitegrp"; gh.textContent = grp.g; wrap.appendChild(gh);
        grp.list.forEach(function (it) {
          var row = document.createElement("div"); row.className = "siterow";
          var nm = document.createElement("button"); nm.className = "sitename";
          nm.textContent = it.n + (it.done ? " " : "");
          nm.title = it.u ? ("用 " + (browser === "edge" ? "Edge" : "Chrome") + " 打开 " + it.u) : "还没填域名";
          nm.onclick = function () {
            if (!it.u) { hint("这个站还没填域名"); return; }
            if (!DISK || !DISK.siteOpen) {   // 老 preload: 只有重启 App 才有 site:open
              hint("需要重启 App 才能用这个（main.js / preload.js 改过了）；现在先手动打开 " + it.u);
              return;
            }
            var tag = (browser === "edge" ? "Edge" : "Chrome");
            hint("正在用 " + tag + " 打开 " + it.u + " …（没开的话会自动启动，约 10~20 秒）");
            DISK.siteOpen(it.u, browser).then(function (r) {
              hint((r && r.msg) || (r && r.ok ? "已打开" : "打开失败"));
            }).catch(function (e) { hint("打开失败: " + (e && e.message ? e.message : e)); });
          };
          var nt = document.createElement("span"); nt.className = "sitenote";
          nt.textContent = (it.alt ? it.alt + "　" : "") + (it.note || "");
          row.appendChild(nm); row.appendChild(nt);
          if (it.done) { var ok = document.createElement("span"); ok.className = "siteok"; ok.textContent = "已适配自动下载"; row.appendChild(ok); }
      if (it.search) { var sc = document.createElement("span"); sc.className = "siteok"; sc.textContent = "站内搜索"; row.appendChild(sc); }
          wrap.appendChild(row);
        });
      });
      var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
      var close = document.createElement("button"); close.className = "btn"; close.textContent = "关闭";
      close.onclick = closeModal; foot.appendChild(close);
    });
  }
  (function () {
    var bs = document.getElementById("btn-sites");
    if (bs) bs.onclick = function () { openSitesDialog(); };
  })();

  /* ================= 备注 ================= */
  function noteOf(dir) { var e = entryOf(dir); return normName(e && e.note); }
  async function renameBookDir(dir) {
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
  function editNote(dir) {
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

  /* ================= 按书名自动打标签 ================= */
  function autoTags(dir) {
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
  function tagOne(dir) {
    if (!LIBRARY) { hint("打标签需要桌面版"); return; }
    var t = autoTags(dir);
    if (!t.length) { hint("这个书名里没有可识别的标签"); return; }
    var e = libEntry(dir), cur = e.tags || [], added = [];
    t.forEach(function (x) { if (cur.indexOf(x) < 0) { cur.push(x); added.push(x); } });
    e.tags = cur;
    libSave(); invalidateCard(dir); renderShelf();
    hint(added.length ? "已加标签: " + added.join(" ") : "标签已经有了: " + t.join(" "));
  }
  function autoTagsAll() {
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

  /* ================= 重复书目检测 ================= */
  function dupKey(dir) {
    return normName(String(dir || "").replace(/^漫画\//, ""))
      .replace(/[\[【][^\]】]*[\]】]/g, " ")
      .replace(/[（(][^）)]*[）)]/g, " ")
      .replace(/[\s_\-–—.,，。、:：;；!！?？'"“”‘’·|｜/\\]+/g, "")
      .toLowerCase();
  }
  function findDupGroups() {
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
  function deleteMany(list, done) {
    if (!list || !list.length) return;
    if (!DISK || !DISK.deleteComic) { hint("删除需要桌面版：请用「启动书库.cmd」打开"); return; }
    var n = list.length, arr = list.slice();
    askConfirm("删除这 " + n + " 本？", "会同时删除磁盘上的整个漫画文件夹（含全部话与图片）、书库条目和阅读进度。删除后无法恢复。", "全部删除", async function () {
      hint("正在删除 " + n + " 本…");
      var ok = 0, bad = [];
      for (var i = 0; i < arr.length; i++) {
        try {
          var r = await DISK.deleteComic(arr[i]);
          if (r && r.ok) { ok++; if (LIBRARY && LIBRARY.comics) delete LIBRARY.comics[arr[i]]; } else bad.push(arr[i]);
        } catch (e) { bad.push(arr[i]); }
      }
      if (DISK.rescan) { try { await DISK.rescan({ offline: true }); } catch (e2) {} }
      arr.forEach(function (d) { invalidateCard(d); });
      renderShelf();
      hint("已删除 " + ok + " 本" + (bad.length ? "，" + bad.length + " 本失败" : ""));
      if (done) done(ok, bad);
    });
  }
  function dupDialog() {
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

  /* ================= 分类 / 收藏 / 标签 ================= */
  function showModal(build) {
    if (!elModal) return;
    elModal.innerHTML = "";
    var box = document.createElement("div");
    box.id = "mbox";
    elModal.appendChild(box);
    elModal.classList.add("on");
    // 点遮罩空白处关闭: 按下与抬起都在遮罩上才算, 防止拖选误关
    var downOnOverlay = false;
    elModal.onmousedown = function (ev) { downOnOverlay = (ev.target === elModal); };
    elModal.onmouseup = function (ev) {
      if (!(downOnOverlay && ev.target === elModal)) { downOnOverlay = false; return; }
      downOnOverlay = false;
      if (dlState && dlState.running) { runInBackground(); return; }   // 下载中: 收起来继续下, 不中断
      closeModal();
    };
    build(box);
  }
  function closeModal() {
    try { if (window.mangaLib && window.mangaLib.previewEnd) window.mangaLib.previewEnd(); } catch (e) {}   // 预览结束 → 清掉本次预览的缩略图缓存
    if (!elModal) return; elModal.classList.remove("on"); setTimeout(function(){ if(!elModal.classList.contains("on")) elModal.innerHTML = ""; }, 500); }
  function modalFoot(box, onOk, okLabel) {
    var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
    var c = document.createElement("button"); c.className = "btn ghost"; c.textContent = "取消";
    var o = document.createElement("button"); o.className = "btn"; o.textContent = okLabel || "确定";
    foot.appendChild(c); foot.appendChild(o);
    c.onclick = closeModal;
    o.onclick = onOk;
    return { cancel: c, ok: o };
  }
  function askText(title, def, cb) {
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = title; box.appendChild(h);
      var inp = document.createElement("input"); inp.type = "text"; inp.value = def || ""; box.appendChild(inp);
      var f = modalFoot(box, function () { var v = inp.value.trim(); closeModal(); if (v) cb(v); });
      inp.onkeydown = function (e) { e.stopPropagation(); if (e.key === "Enter") f.ok.click(); else if (e.key === "Escape") closeModal(); };
      setTimeout(function () { inp.focus(); inp.select(); }, 30);
    });
  }
  function askConfirm(title, msg, okLabel, cb) {
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = title; box.appendChild(h);
      var s = document.createElement("div"); s.className = "sub"; s.textContent = msg; box.appendChild(s);
      modalFoot(box, function () { closeModal(); cb(); }, okLabel);
    });
  }
  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { hint("已复制"); }, function () { hint("复制失败"); });
    } else hint("复制失败");
  }
  function fillCtx(items, x, y) {
    if (!elCtx) return;
    elCtx.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.textContent = it.t;
      b.onclick = function (ev) { ev.stopPropagation(); hideCtx(); it.f(); };
      elCtx.appendChild(b);
    });
    elCtx.classList.add("on");
    var w = elCtx.offsetWidth, h = elCtx.offsetHeight;
    elCtx.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + "px";
    elCtx.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + "px";
  }
  function hideCtx() { if (elCtx) elCtx.classList.remove("on"); }

  function toggleFav(dir) {
    if (!LIBRARY) { hint("收藏需要桌面版"); return; }
    var e = libEntry(dir);
    e.favorite = !e.favorite;
    libSave();
    invalidateCard(dir);
    renderShelf();
    hint(e.favorite ? "已加入收藏" : "已取消收藏");
  }

  /* 把已经下载好的书合并成一个文件夹(所有图片进 全部\, 连续编号) */
  async function mergeBook(dir) {
    if (!DISK || !DISK.mergeBook) { hint("合并需要桌面版：请用「启动书库.cmd」打开"); return; }
    hint("正在合并 " + dir + " 的图片…（图多的话要等一会儿）");
    var r = null;
    try { r = await DISK.mergeBook(dir); } catch (e) { r = { ok: false, msg: String(e && e.message ? e.message : e) }; }
    if (!r || !r.ok) { hint("合并失败: " + ((r && r.msg) || "未知错误")); return; }
    hint((r.msg || "已合并") + "　正在重建书库…");
    if (DISK.rescan) { try { await DISK.rescan({ quiet: true }); } catch (e2) {} }
    hint("已合并: " + dir + "（图片都在 全部\\ 里，连续编号）");
  }

  function setRating(dir, manual) {   // manual: true=18+ / false=全年龄 / null=恢复自动
    var e = libEntry(dir);
    var mf = manifestOf(dir);
    if (manual === null) { try { delete e.restricted; } catch (er) {} if (mf) mf.rating = mf.ratingAuto || ""; hint("分级已恢复自动判定"); }
    else { e.restricted = !!manual; if (mf) mf.rating = manual ? "18+" : ""; hint(manual ? "已标为 18+" : "已标为全年龄"); }
    libSave(); invalidateCard(dir); keepScroll(renderShelf);
  }
  function showCtx(x, y, dir) {
    if (!LIBRARY) return;
    var e = libEntry(dir);
    fillCtx([
      { t: e.favorite ? "取消收藏" : "加入收藏", f: function () { toggleFav(dir); } },
      { t: "备注…", f: function () { editNote(dir); } },
      { t: "重命名…", f: function () { renameBookDir(dir); } },
      { t: "编辑分类与标签…", f: function () { openEditor(dir); } },
      { t: "按书名自动打标签", f: function () { tagOne(dir); } },
      { t: "简介与来源…", f: function () { openInfo(dir); } },
      { t: "在文件夹中打开", f: function () {
          if (DISK && DISK.reveal && LIBROOT) DISK.reveal(LIBROOT + "\\" + dir);
          else hint("仅桌面版支持");
        } },
      { t: "复制书名", f: function () { copyText(dir); } },
      { t: " 检查是否有更新（原站）", f: function () { checkUpdate(dir); } },
      { t: "跨站检查更新…", f: function () { multiUpdate(dir); } },
      { t: ((manifestOf(dir) || {}).rating === "18+") ? "分级：改为非 18+" : "分级：标为 18+", f: function () { setRating(dir, (manifestOf(dir) || {}).rating !== "18+"); } },
      { t: "分级：恢复自动判定", f: function () { setRating(dir, null); } },
      { t: " 合并成一个文件夹（图片全进 全部\\）", f: function () { mergeBook(dir); } },
      { t: "管理图包…", f: function () { openImageManager(dir); } },
      { t: "清除手动排序", f: function () { var o = manualOrder(); delete o[dir]; saveManualOrder(o); renderShelf(); hint("已清除这一本的手动排序"); } },
      { t: "删除本书（含文件）…", f: function () { confirmDelete(dir); } }
    ], x, y);
  }

  /* ---------- 禁漫一键下载(在 App 内跑自动化脚本) ---------- */
  /* ---------- 跨站检查更新: 本地这本 vs 各正经站, 谁多就用谁补 ---------- */
  async function multiUpdate(dir) {
    if (!DISK || !DISK.siteSearch) { hint("需要桌面版（重启 App 后可用）"); return; }
    var mf = manifestOf(dir) || {};
    var local = (mf.chapters || []).length;
    var bookName = dir.replace(/^漫画[\/\\]/, '');
    var defKw = mf.work || bookName.replace(/^\[[^\]]*\]\s*/, '').replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "跨站检查更新"; box.appendChild(h);
      var sub = document.createElement("div"); sub.className = "sub";
      sub.textContent = "本地：「" + bookName + "」共 " + local + " 话。用关键词去几个正经站搜，谁的话数多就用谁补。";
      box.appendChild(sub);
      var l1 = document.createElement("label"); l1.textContent = "搜索关键词"; box.appendChild(l1);
      var kw = document.createElement("input"); kw.type = "text"; kw.value = defKw; box.appendChild(kw);
      var l2 = document.createElement("label"); l2.textContent = "搜哪些站"; box.appendChild(l2);
      var wrap = document.createElement("div"); wrap.style.cssText = "display:flex;gap:14px;flex-wrap:wrap;margin:2px 0 10px";
      var picked = {};
      SS_SITES.forEach(function (s2) {
        var lab = document.createElement("label"); lab.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer";
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.style.width = "auto";
        var sp = document.createElement("span"); sp.textContent = s2.n;
        picked[s2.id] = cb; lab.appendChild(cb); lab.appendChild(sp); wrap.appendChild(lab);
      });
      box.appendChild(wrap);
      var out = document.createElement("div"); out.style.cssText = "max-height:40vh;overflow:auto";
      box.appendChild(out);
      var foot = document.createElement("div"); foot.className = "mfoot";
      var close = document.createElement("button"); close.className = "btn ghost"; close.textContent = "关闭"; close.onclick = closeModal;
      var go = document.createElement("button"); go.className = "btn"; go.textContent = "检查";
      foot.appendChild(close); foot.appendChild(go); box.appendChild(foot);
      go.onclick = async function () {
        var k = kw.value.trim();
        if (!k) { hint("先填关键词"); return; }
        var sites = Object.keys(picked).filter(function (id) { return picked[id].checked; }).join(",");
        go.disabled = true; out.innerHTML = '<div class="sub">正在搜…</div>';
        var r = null;
        try { r = await DISK.siteSearch(k, sites); } catch (e) { r = { ok: false, msg: String(e && e.message || e) }; }
        if (!r || !r.ok) { go.disabled = false; out.innerHTML = '<div class="sub">搜索失败：' + ((r && r.msg) || "未知") + "</div>"; return; }
        // 每站只拿最像的那一条去问话数(排查一次 20~40 秒, 不能问太多)
        var cands = [];
        r.groups.forEach(function (g) {
          var bySite = {};
          g.items.forEach(function (it) { if (!bySite[it.site]) bySite[it.site] = it; });
          Object.keys(bySite).forEach(function (s3) { cands.push(bySite[s3]); });
        });
        out.innerHTML = '<div class="sub">搜到 ' + cands.length + ' 个候选，正在问各站话数…</div>';
        var rows = [];
        for (var i = 0; i < cands.length && i < 4; i++) {
          var it = cands[i], cnt = null, nm = it.title;
          try {
            var res = await DISK.dlResolve(it.url);
            if (res && res.ok) { cnt = res.chapters; nm = res.title || it.title; }
          } catch (e) {}
          rows.push({ it: it, cnt: cnt, nm: nm });
        }
        go.disabled = false;
        out.innerHTML = "";
        var head = document.createElement("div"); head.className = "sub";
        head.textContent = "本地：" + local + " 话　|　下面的站按话数排序，点「用这个补」就把缺的话下进这一本";
        out.appendChild(head);
        rows.sort(function (a, b) { return (b.cnt || 0) - (a.cnt || 0); });
        rows.forEach(function (x2) {
          var row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;align-items:center;padding:6px 2px;border-bottom:1px solid #26282e";
          var tx = document.createElement("div"); tx.style.cssText = "flex:1;min-width:0";
          var t1 = document.createElement("div"); t1.style.cssText = "font-size:13px;color:#e6e8ec;word-break:break-all"; t1.textContent = x2.nm;
          var t2 = document.createElement("div"); t2.className = "sub"; t2.style.margin = "2px 0 0";
          t2.textContent = x2.it.label + " · " + (x2.cnt === null ? "话数拿不到" : ("共 " + x2.cnt + " 话")) + " · 本地 " + local + " 话" + (x2.cnt !== null && x2.cnt > local ? " → 可补 " + (x2.cnt - local) + " 话" : " → 没有新的");
          tx.appendChild(t1); tx.appendChild(t2);
          var btn = document.createElement("button"); btn.className = "btn"; btn.textContent = "用这个补";
          if (!(x2.cnt > local)) btn.disabled = true;
          btn.onclick = async function () {
            btn.disabled = true; btn.textContent = "启动中…";
            var rr = await DISK.dlStart({ url: x2.it.url, name: bookName, from: local + 1 });
            if (!rr || !rr.ok) { btn.disabled = false; btn.textContent = "用这个补"; hint((rr && rr.msg) || "启动失败"); return; }
            closeModal(); hint("已从「" + x2.it.label + "」补下第 " + (local + 1) + " 话之后的内容");
          };
          row.appendChild(tx); row.appendChild(btn); out.appendChild(row);
        });
        if (!rows.length) out.innerHTML += '<div class="sub">没搜到这个作品，换个关键词试试。</div>';
      };
      kw.onkeydown = function (ev) { ev.stopPropagation(); if (ev.key === "Enter") go.click(); };
    });
  }

  /* ---------- 检查更新 ---------- */
  async function checkUpdate(dir) {
    if (!DISK || !DISK.jmCheckUpdate) { hint("需要桌面版"); return; }
    hint("正在检查更新…");
    var r = await DISK.jmCheckUpdate(dir);
    if (!r || !r.ok) { hint((r && r.msg) || "检查失败"); return; }
    if (r.unsupported) { hint("暂不支持该站点"); return; }
    if (!r.newCount) { hint("已是最新：站点 " + r.total + " 话，本地 " + r.local + " 话"); return; }
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "发现 " + r.newCount + " 个新话"; box.appendChild(h);
      var s = document.createElement("div"); s.className = "sub";
      s.textContent = dir + "\n站点共 " + r.total + " 话，本地已有 " + r.local + " 话" + (r.lastTitle ? "\n最新：" + r.lastTitle : "");
      s.style.whiteSpace = "pre-wrap"; box.appendChild(s);
      var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
      var later = document.createElement("button"); later.className = "btn ghost"; later.textContent = "以后再说";
      var now = document.createElement("button"); now.className = "btn"; now.textContent = "现在更新";
      foot.appendChild(later); foot.appendChild(now);
      later.onclick = closeModal;
      now.onclick = async function () {
        closeModal();
        openDownload("jm");   // 更新走禁漫页签
        jmAppend("[更新] " + dir + "\n");
        JM_BUSY = true; syncJmBtn();
        var r2 = await DISK.jmFetchBook(dir);
        if (!r2 || !r2.ok) { JM_BUSY = false; syncJmBtn(); jmAppend("[错误] " + ((r2 && r2.msg) || "启动失败") + "\n"); }
      };
    });
  }

  function buildJmPane(box) {
      if (!DISK || !DISK.jmStart) { hint("需要桌面版：请用「启动书库.cmd」打开"); return; }
      var s = document.createElement("div"); s.className = "sub";
      s.textContent = "支持：JM 编号（如 JM1452133）、纯数字（1452133）、专辑链接、单话链接（/photo/<id>），多个用空格或换行分开；换镜像域名也认编号。自动完成：逐话取图 → 切页拼合+像素校验 → 入库 → 重建书库，已入库的自动跳过。";
      box.appendChild(s);
      var lb = document.createElement("label"); lb.textContent = "浏览器（用它的登录态）"; box.appendChild(lb);
      var sb = document.createElement("select"); sb.id = "jm-browser";
      [["chrome", "Google Chrome（默认，用自动化自己的账号）"], ["edge", "Edge（用 Edge 的登录态）"]].forEach(function (o) {
        var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; sb.appendChild(op);
      });
      try { sb.value = localStorage.getItem("jmBrowser") || "chrome"; } catch (e) {}
      sb.onchange = function () { try { localStorage.setItem("jmBrowser", sb.value); } catch (e) {} };
      var rowB = document.createElement("div"); rowB.style.cssText = "display:flex;gap:8px;align-items:center";
      sb.style.flex = "1";
      var openB = document.createElement("button"); openB.className = "btn ghost"; openB.textContent = "打开浏览器";
      openB.title = "启动或前置调试浏览器（停在禁漫首页）";
      openB.onclick = async function () {
        openB.disabled = true; openB.textContent = "启动中…";
        var rr = await DISK.jmOpenBrowser(sb.value);
        openB.disabled = false; openB.textContent = "打开浏览器";
        jmAppend("[浏览器] " + ((rr && rr.msg) || (rr && rr.ok ? "已就绪" : "失败")) + "\n");
      };
      rowB.appendChild(sb); rowB.appendChild(openB);
      box.appendChild(rowB);

      var l1 = document.createElement("label"); l1.textContent = "专辑链接"; box.appendChild(l1);
      var ta = document.createElement("textarea"); ta.rows = 4; ta.placeholder = "JM1452133\n或 https://18comic.vip/album/1452133/?series_sort=2\n或单话 https://18comic.vip/photo/1452133"; box.appendChild(ta);
      var l3 = document.createElement("label"); l3.textContent = "下载队列（逐本排队，失败自动重试 3 次；关掉 App 也留在这儿）"; box.appendChild(l3);
      var qbox = document.createElement("div"); qbox.id = "jmqbox"; box.appendChild(qbox);
      function renderJmq(q) {
        if (!qbox || !qbox.isConnected) return;
        qbox.innerHTML = "";
        var items = (q && q.items) || [];
        var head = document.createElement("div"); head.className = "stat"; head.style.display = "block";
        var c = (q && q.counts) || {};
        head.textContent = (q && q.running ? "正在跑 · " : "未在跑 · ") + "等待 " + (c.wait || 0) + " · 完成 " + (c.done || 0) + " · 失败 " + (c.fail || 0);
        qbox.appendChild(head);
        if (!items.length) {
          var e0 = document.createElement("div"); e0.className = "stat"; e0.style.display = "block";
          e0.textContent = "队列是空的：把 JM 编号（如 JM1452133）或链接填到上面，点「加入队列」。";
          qbox.appendChild(e0);
          return;
        }
        items.forEach(function (it, i) {
          var row = document.createElement("div"); row.className = "jmqrow";
          var nm = document.createElement("span"); nm.className = "jmqn"; nm.textContent = "#" + (i + 1) + " " + (it.url || it.raw || "");
          nm.title = it.url || it.raw || "";
          var st = document.createElement("span"); st.className = "jmqs " + (it.status || "");
          st.textContent = ({ wait: "等待", run: "下载中…", done: "完成", fail: "失败" }[it.status] || it.status) + (it.note ? " · " + it.note : "");
          row.appendChild(nm); row.appendChild(st);
          if (it.status === "fail") {
            var rb = document.createElement("button"); rb.className = "tab"; rb.textContent = "重试";
            rb.onclick = function () { if (DISK.jmQueue.retry) DISK.jmQueue.retry(it.id).then(renderJmq); };
            row.appendChild(rb);
          }
          var xb = document.createElement("button"); xb.className = "tab"; xb.textContent = "✕"; xb.title = "从队列移除";
          xb.onclick = function () { if (DISK.jmQueue.remove) DISK.jmQueue.remove(it.id).then(renderJmq); };
          row.appendChild(xb);
          qbox.appendChild(row);
        });
      }
      JmQRender = renderJmq;
      if (DISK && DISK.jmQueue && DISK.jmQueue.list) { try { DISK.jmQueue.list().then(renderJmq); } catch (e) {} }

      var l2 = document.createElement("label"); l2.textContent = "运行日志"; box.appendChild(l2);
      var logBox = document.createElement("div"); logBox.id = "dllog"; box.appendChild(logBox);
      var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
      var addQ = document.createElement("button"); addQ.className = "btn"; addQ.textContent = "加入队列";
      var go = document.createElement("button"); go.className = "btn ghost"; go.textContent = "直接开始";
      var stop = document.createElement("button"); stop.className = "btn ghost"; stop.textContent = "暂停队列"; stop.style.marginRight = "auto";
      var clrQ = document.createElement("button"); clrQ.className = "btn ghost"; clrQ.textContent = "清空已完成";
      var lg = document.createElement("button"); lg.className = "btn ghost"; lg.textContent = "日志文件夹"; lg.title = "打开 _scripts\\jm\\logs（每天一个文件，下载/更新都有记录）";
      lg.onclick = function () { if (DISK && DISK.logsOpen) DISK.logsOpen(); else hint("仅桌面版支持"); };
      var close = document.createElement("button"); close.className = "btn ghost"; close.textContent = "关闭";
      foot.appendChild(addQ); foot.appendChild(go); foot.appendChild(stop); foot.appendChild(lg); foot.appendChild(clrQ); foot.appendChild(close);
      addQ.onclick = async function () {
        var txt = ta.value.trim();
        if (!txt) { hint("先填 JM 编号或链接"); return; }
        addQ.disabled = true;
        var r = await DISK.jmQueue.add(txt);
        addQ.disabled = false;
        if (!r || !r.ok) { hint((r && r.msg) || "没识别出目标(需要重启 App 才能用队列)"); return; }
        append("[队列] 新增 " + r.added + " 本，队列共 " + ((r.items || []).length) + " 本\n");
        ta.value = "";
        renderJmq(r);
        hint("已加入队列 " + r.added + " 本");
      };
      go.onclick = async function () {
        var txt = ta.value.trim();
        if (!txt) { hint("先填 JM 编号或链接"); return; }
        go.disabled = true; go.textContent = "下载中…";
        append("[开始] " + txt.split(/[\s,;，；]+/).filter(Boolean).length + " 个目标 | 浏览器: " + (sb.value === "edge" ? "Edge" : "Chrome") + "\n");
        JM_BUSY = true; syncJmBtn();
        var r = await DISK.jmStart(txt, sb.value);
        if (!r || !r.ok) { go.disabled = false; go.textContent = "直接开始"; JM_BUSY = false; syncJmBtn(); append("[错误] " + ((r && r.msg) || "启动失败") + "\n"); }
      };
      stop.onclick = async function () {
        if (DISK.jmQueue) await DISK.jmQueue.pause();
        var ok = await DISK.jmCancel();
        append(ok ? "[已请求停止]\n" : "[当前没有任务]\n");
      };
      clrQ.onclick = async function () { if (DISK.jmQueue) { var r2 = await DISK.jmQueue.clear("done"); renderJmq(r2); append("[队列] 已清掉完成的\n"); } };
      JM_LOGEL = logBox; logBox.textContent = JM_LOG; logBox.scrollTop = logBox.scrollHeight;
      function append(t) { jmAppend(t); }
      close.onclick = function () { JM_LOGEL = null; JmQRender = null; closeModal(); };
      ta.onkeydown = function (ev) { ev.stopPropagation(); };
      if (JM_BUSY) { go.disabled = true; go.textContent = "下载中…"; }
  }

  function confirmDelete(dir) {
    if (!DISK || !DISK.deleteComic) { hint("删除需要桌面版：请用「启动书库.cmd」打开书库"); return; }
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
          var r = await DISK.deleteComic(dir);
          if (r && r.ok) {
            if (LIBRARY && LIBRARY.comics) delete LIBRARY.comics[dir];
            hint("已删除：" + dir);
            if (DISK.rescan) await DISK.rescan({ offline: true }); else location.reload();
          } else {
            del.disabled = false; del.textContent = "删除";
            st.textContent = "删除失败：" + ((r && r.msg) || "未知错误");
          }
        } catch (err) {
          del.disabled = false; del.textContent = "删除";
          st.textContent = "删除失败：" + (err && err.message ? err.message : String(err));
        }
      };
    });
  }

  /* ---------- 设置面板: 所有视觉参数自己调 ---------- */
  var BOOKTIMES = {};
  var JM_LOG = "";        // 下载日志留在内存, 弹窗关了再打开还能看
  var JQ = null;          // 下载队列快照
  var JmQRender = null;   // 弹窗开着时的队列渲染函数
  var JM_LOGEL = null;
  var JM_BUSY = false;
  function jmAppend(t) { JM_LOG += t; if (JM_LOGEL && JM_LOGEL.isConnected) { JM_LOGEL.textContent = JM_LOG; JM_LOGEL.scrollTop = JM_LOGEL.scrollHeight; } }
  // ===== 阅读配色: 整套换肤(画面+侧栏+工具栏+按钮), 亮度只压画面那一层 =====
  var THEMES = [["dark", "暗黑", "#0a0a0a", "#d8dade"], ["light", "灰白", "#e8eaed", "#1f2328"], ["eye", "护眼", "#e8e6d8", "#2d3320"], ["paper", "纸质", "#f3ead8", "#3b3227"]];
  function applyReaderTheme() {
    var rd = document.getElementById("reader");
    if (rd) rd.setAttribute("data-theme", S.theme || "dark");
    document.body.setAttribute("data-shelf-theme", (S.theme || "dark") === "dark" ? "" : S.theme);
    var b = (typeof S.bright === "number") ? S.bright : 1;
    var dim = Math.max(0, Math.min(0.85, (1 - b) * 0.9));
    document.documentElement.style.setProperty("--r-dim", String(Math.round(dim * 1000) / 1000));
    try { localStorage.setItem("readerTheme", JSON.stringify({ theme: S.theme || "dark", bright: b })); } catch (e) {}
  }
  function openThemeDialog() {
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "阅读配色与亮度"; box.appendChild(h);
      var sub = document.createElement("div"); sub.className = "sub";
      sub.textContent = "预设是整套换肤（画面 + 侧栏 + 工具栏 + 按钮，每种都带纹理）；亮度调的是画面背景（图片本身亮度不变），工具栏和侧栏始终清晰。";
      box.appendChild(sub);
      var sw = document.createElement("div"); sw.id = "rtswatch"; box.appendChild(sw);
      THEMES.forEach(function (t) {
        var b2 = document.createElement("button");
        b2.textContent = t[1];
        b2.style.background = t[2]; b2.style.color = t[3];
        b2.className = (S.theme === t[0]) ? "on" : "";
        b2.onclick = function () {
          S.theme = t[0]; applyReaderTheme();
          Array.prototype.forEach.call(sw.children, function (x) { x.className = (x === b2) ? "on" : ""; });
        };
        sw.appendChild(b2);
      });
      var lb = document.createElement("label"); lb.textContent = "画面背景亮度（图片本身不变）"; box.appendChild(lb);
      var rg = document.createElement("input"); rg.type = "range"; rg.min = "10"; rg.max = "100"; rg.step = "5";
      rg.value = String(Math.round(((typeof S.bright === "number") ? S.bright : 1) * 100));
      var val = document.createElement("div"); val.className = "stat"; val.textContent = rg.value + "%";
      rg.oninput = function () { S.bright = Number(rg.value) / 100; val.textContent = rg.value + "%"; applyReaderTheme(); };
      box.appendChild(rg); box.appendChild(val);
      var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
      var done = document.createElement("button"); done.className = "btn"; done.textContent = "完成";
      done.onclick = closeModal; foot.appendChild(done);
    });
  }
  applyReaderTheme();

  var DL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  function syncJmBtn() {
    var b = document.getElementById("btn-download");
    if (!b) return;
    var n = 0;
    if (JQ && JQ.items) for (var i = 0; i < JQ.items.length; i++) if (JQ.items[i].status === "wait" || JQ.items[i].status === "run") n++;
    var busy = JM_BUSY || !!(JQ && JQ.running);
    b.innerHTML = DL_SVG + (busy ? "下载中…" : "下载漫画") + (n ? " (" + n + ")" : "");
    b.title = busy ? "下载中…（点开看队列）" : (n ? "下载队列里还有 " + n + " 本未完成" : "下载漫画：通用站点链接 / 禁漫天堂（两个页签）");
  }   // 书目录修改时间(桌面版提供), 用于"按时间排序"
  var SET_DEFAULT = {
  flyAnim: true, cols: 10, acols: 2, author: true, cardW: 176, gap: 12, pad: 12, tScale: 0.072, radius: 16, fit: 'contain', sbw: 11, tags: true, src: true, prog: true, star: true, sticky: true, totop: true, note: true, autoFit: true, netAlias: false, iconOnly: false, catIcons: true, catLabels: true, barAutohide: false, dlPreview: false };
  var SET = (function () {
    try { return Object.assign({}, SET_DEFAULT, JSON.parse(localStorage.getItem('shelfSettings') || '{}')); }
    catch (e) { return Object.assign({}, SET_DEFAULT); }
  })();
  function autoCardW() {
    var w = (typeof window !== "undefined" && window.innerWidth) || 1280;
    var pad = typeof SET.pad === "number" ? SET.pad : 12;
    var gap = typeof SET.gap === "number" ? SET.gap : 12;
    var autoCols = w < 1200 ? 5 : (w < 1600 ? 6 : (w < 2000 ? 7 : 8));
    var maxCols = typeof SET.cols === "number" ? SET.cols : 99;
    var targetCols = Math.min(autoCols, maxCols);
    var cw = Math.floor((w - 2 * pad) / targetCols) - gap;
    return Math.max(120, Math.min(260, cw));
  }
  function cardWForCols() {
    var w = (typeof window !== "undefined" && window.innerWidth) || 1280;
    var pad = typeof SET.pad === "number" ? SET.pad : 12;
    var gap = typeof SET.gap === "number" ? SET.gap : 12;
    var cols = typeof SET.cols === "number" ? SET.cols : 8;
    var cw = Math.floor((w - 2 * pad - (cols - 1) * gap) / cols);
    return Math.max(120, Math.min(260, cw));
  }
  function applySettings() {
    var r = document.documentElement.style;
    r.setProperty('--cols', String(SET.cols));
    r.setProperty('--acols', String(SET.acols));
    var cw = SET.autoFit ? autoCardW() : cardWForCols();
    r.setProperty('--card-w', cw + 'px');
    r.setProperty('--gap', SET.gap + 'px');
    r.setProperty('--pad', SET.pad + 'px');
    r.setProperty('--t-scale', String(SET.tScale));
    r.setProperty('--radius', SET.radius + 'px');
    r.setProperty('--fit', SET.fit);
    r.setProperty('--sbw', SET.sbw + 'px');
    var b = document.body;
    b.classList.toggle('no-author', !SET.author);
    b.classList.toggle('no-tags', !SET.tags);
    b.classList.toggle('no-src', !SET.src);
    b.classList.toggle('no-prog', !SET.prog);
    b.classList.toggle('no-star', !SET.star);
    b.classList.toggle('no-sticky', !SET.sticky);
    b.classList.toggle('no-totop', !SET.totop);
    b.classList.toggle('icon-only', !!SET.iconOnly);
    b.classList.toggle('bar-autohide', !!SET.barAutohide);
    if (typeof renderCatTabs === 'function') renderCatTabs();
    try { localStorage.setItem('shelfSettings', JSON.stringify(SET)); } catch (e) {}
  }
  function openSettings() {
    showModal(function (box) {
      var mbox = box.closest('#mbox'); if (mbox) mbox.classList.add('wide');
      var h = document.createElement('h3'); h.textContent = '书架设置'; box.appendChild(h);

      // Tabs
      var tabs = document.createElement('div');
      tabs.style.cssText = 'display:flex;gap:4px;margin:10px 0 14px;border-bottom:2px solid var(--border)';
      box.appendChild(tabs);
      var tabContents = [];
      function makeTab(name) {
        var btn = document.createElement('button');
        btn.style.cssText = 'padding:8px 16px;border:none;background:transparent;color:var(--fg2);cursor:pointer;font-size:13px;font-family:inherit;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s';
        btn.textContent = name;
        tabs.appendChild(btn);
        var panel = document.createElement('div');
        panel.className = 'tabpanel';
        panel.style.display = 'none';
        box.appendChild(panel);
        btn.onclick = function() {
          tabContents.forEach(function(p){ p.style.display='none'; });
          tabBtns.forEach(function(b){ b.style.cssText=b.style.cssText+';border-bottom-color:transparent;color:var(--fg2)'; });
          panel.style.display = 'block';
          btn.style.borderBottomColor = 'var(--accent)';
          btn.style.color = 'var(--fg)';
        };
        tabContents.push(panel);
        tabBtns.push(btn);
        return panel;
      }
      var tabBtns = [];
      var pAppearance = makeTab('外观');
      var pDisplay = makeTab('显示');
      var pAdvanced = makeTab('高级');
      tabBtns[0].click();

      function num(parent, k, label, min, max, step, unit) {
        var l = document.createElement('label'); l.textContent = label + (unit ? '（' + unit + '）' : ''); parent.appendChild(l);
        var i = document.createElement('input'); i.type = 'number'; i.min = min; i.max = max; i.step = step; i.value = SET[k];
        i.oninput = function () { var v = parseFloat(i.value); if (isFinite(v)) { SET[k] = v; applySettings(); } };
        i.addEventListener('wheel', function (ev) {
          ev.preventDefault();
          var v = parseFloat(i.value); if (!isFinite(v)) v = parseFloat(min) || 0;
          var st = parseFloat(step) || 1;
          v = v + (ev.deltaY < 0 ? st : -st);
          if (v < parseFloat(min)) v = parseFloat(min);
          if (v > parseFloat(max)) v = parseFloat(max);
          i.value = v; SET[k] = v; applySettings();
        }, { passive: false });
        parent.appendChild(i);
        return i;
      }
      function chk(parent, k, label) {
        var lab = document.createElement('label'); lab.className = 'chk';
        var c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!SET[k];
        c.onchange = function () { SET[k] = c.checked; applySettings(); };
        lab.appendChild(c); lab.appendChild(document.createTextNode(label)); parent.appendChild(lab);
        return c;
      }

      // === 外观 tab ===
      num(pAppearance, 'acols', '按作者分组时每行作者数', 1, 9, 1, '默认2');
      num(pAppearance, 'cols', '每行本数上限', 1, 40, 1, '窗口窄自动减列');
      var afChk = chk(pAppearance, 'autoFit', '自动适配界面宽度');
      var cardWInput = num(pAppearance, 'cardW', '缩略图宽度', 60, 400, 2, 'px');
      function syncCardWEnabled() { if (cardWInput) cardWInput.disabled = !!SET.autoFit; }
      syncCardWEnabled();
      afChk.onchange = function () { SET.autoFit = afChk.checked; syncCardWEnabled(); applySettings(); };
      cardWInput.addEventListener('input', function () {
        if (SET.autoFit) { SET.autoFit = false; afChk.checked = false; syncCardWEnabled(); }
      });
      num(pAppearance, 'gap', '卡片间距', 0, 40, 1, 'px');
      num(pAppearance, 'pad', '网格内边距', 0, 40, 1, 'px');
      num(pAppearance, 'radius', '卡片圆角', 0, 20, 1, 'px');
      num(pAppearance, 'sbw', '滚动条宽度', 6, 24, 1, 'px');
      num(pAppearance, 'tScale', '文字缩放', 0.04, 0.12, 0.002, '乘以缩略图宽度');
      var lf = document.createElement('label'); lf.textContent = '封面显示方式'; pAppearance.appendChild(lf);
      var sf = document.createElement('select');
      [['contain', '完整显示（不裁切）'], ['cover', '填满卡片（裁两边）']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; if (SET.fit === o[0]) op.selected = true; sf.appendChild(op);
      });
      sf.onchange = function () { SET.fit = sf.value; applySettings(); };
      pAppearance.appendChild(sf);
      var hChk = chk(pAppearance, 'cardH', '横向卡片布局');
      hChk.onchange = function(){ SET.cardH = hChk.checked; invalidateAllCards(); applySettings(); renderShelf(); };

      // === 显示 tab ===
      var homeSep = document.createElement('div'); homeSep.style.cssText = 'font-weight:600;font-size:14px;margin:0 0 8px';
      homeSep.textContent = '主页';
      pDisplay.appendChild(homeSep);
      var chkGrid = document.createElement('div');
      chkGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin:6px 0';
      pDisplay.appendChild(chkGrid);
      function chkGridItem(k, label) {
        var lab = document.createElement('label'); lab.className = 'chk';
        var c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!SET[k];
        c.onchange = function () { SET[k] = c.checked; applySettings(); };
        lab.appendChild(c); lab.appendChild(document.createTextNode(label)); chkGrid.appendChild(lab);
      }
      chkGridItem('star', '收藏星标');
      chkGridItem('prog', '阅读进度条');
      chkGridItem('author', '作者');
      chkGridItem('src', '来源');
      chkGridItem('tags', '标签');
      chkGridItem('note', '备注');
      chkGridItem('sticky', '顶栏吸顶');
      chkGridItem('totop', '回到顶部按钮');
      chkGridItem('iconOnly', '窄窗口按钮只显图标');
      chkGridItem('catIcons', '分类栏显示图标');
      chkGridItem('catLabels', '分类栏显示文字');
      chkGridItem('flyAnim', '封面飞入/飞回动效（点书封面时飞进阅读器）');

      // 阅读页
      var rdSep = document.createElement('div'); rdSep.style.cssText = 'border-top:1px solid var(--border);margin:14px 0 8px;padding-top:10px;font-weight:600;font-size:14px';
      rdSep.textContent = '阅读页';
      pDisplay.appendChild(rdSep);
      chk(pDisplay, 'barAutohide', '顶栏自动隐藏（鼠标移到顶部才显示）');

      // 背景图
      var bgSep = document.createElement('div'); bgSep.style.cssText = 'border-top:1px solid var(--border);margin:12px 0;padding-top:10px;font-weight:600;font-size:14px';
      bgSep.textContent = '背景图';
      pDisplay.appendChild(bgSep);
      var bgRow = document.createElement('div'); bgRow.style.cssText = 'margin:6px 0;display:flex;gap:8px;align-items:center';
      var bgBtn = document.createElement('button'); bgBtn.className = 'btn ghost'; bgBtn.textContent = '选择背景图';
      var bgClear = document.createElement('button'); bgClear.className = 'btn ghost'; bgClear.textContent = '清除背景';
      var bgInput = document.createElement('input'); bgInput.type = 'file'; bgInput.accept = 'image/*'; bgInput.style.display = 'none';
      bgRow.appendChild(bgBtn); bgRow.appendChild(bgClear); bgRow.appendChild(bgInput);
      pDisplay.appendChild(bgRow);
      bgBtn.onclick = function(){ bgInput.click(); };
      function getBgHist(){ try { return JSON.parse(localStorage.getItem('bgHist') || '[]'); } catch(e){ return []; } }
      function setBgHist(arr){ try { localStorage.setItem('bgHist', JSON.stringify(arr.slice(0,6))); } catch(e){} }
      function renderBgThumbs(){
        var old = document.getElementById('bg-thumbs'); if (old) old.remove();
        var hist = getBgHist();
        if (!hist.length) return;
        var row = document.createElement('div'); row.id = 'bg-thumbs';
        row.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0';
        var cur = localStorage.getItem('bgImg');
        hist.forEach(function(data, idx){
          var b = document.createElement('button');
          b.style.cssText = 'height:72px;border:2px solid ' + (data === cur ? 'var(--accent)' : 'var(--border)') + ';border-radius:6px;background-size:cover;background-position:center;cursor:pointer;padding:0;overflow:hidden';
          b.style.backgroundImage = 'url(' + data + ')';
          b.title = idx === 0 ? '当前背景' : '切换为该背景';
          b.onclick = function(){
            document.body.style.backgroundImage = 'url(' + data + ')';
            document.body.classList.add('bgimg');
            try { localStorage.setItem('bgImg', data); } catch(e){}
            renderBgThumbs();
          };
          row.appendChild(b);
        });
        bgRow.insertAdjacentElement('afterend', row);
      }
      bgInput.onchange = function(){
        var f = bgInput.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function(e){
          var data = e.target.result;
          var hist = getBgHist().filter(function(x){ return x !== data; });
          hist.unshift(data);
          hist = hist.slice(0,5);
          setBgHist(hist);
          document.body.style.backgroundImage = 'url(' + data + ')';
          document.body.classList.add('bgimg');
          try { localStorage.setItem('bgImg', data); } catch(e){}
          renderBgThumbs();
        };
        r.readAsDataURL(f);
        bgInput.value = '';
      };
      bgClear.onclick = function(){
        document.body.style.backgroundImage = 'none';
        document.body.classList.remove('bgimg');
        try { localStorage.removeItem('bgImg'); } catch(e){}
        renderBgThumbs();
      };
      try {
        var saved = localStorage.getItem('bgImg');
        if (saved) {
          document.body.style.backgroundImage = 'url(' + saved + ')';
          document.body.classList.add('bgimg');
        }
      } catch(e){}
      renderBgThumbs();
      var posLblX = document.createElement('label'); posLblX.textContent = '背景图位置（左右）'; pDisplay.appendChild(posLblX);
      var posX = document.createElement('input'); posX.type = 'range'; posX.min = 0; posX.max = 100; posX.value = (localStorage.getItem('bgPosX') !== null) ? localStorage.getItem('bgPosX') : 50;
      posX.style.width = '100%';
      pDisplay.appendChild(posX);
      var posLblY = document.createElement('label'); posLblY.textContent = '背景图位置（上下）'; pDisplay.appendChild(posLblY);
      var posY = document.createElement('input'); posY.type = 'range'; posY.min = 0; posY.max = 100; posY.value = (localStorage.getItem('bgPosY') !== null) ? localStorage.getItem('bgPosY') : 50;
      posY.style.width = '100%';
      pDisplay.appendChild(posY);
      function applyPos(){
        document.body.style.backgroundPosition = posX.value + '% ' + posY.value + '%';
        try { localStorage.setItem('bgPosX', posX.value); localStorage.setItem('bgPosY', posY.value); } catch(e){}
      }
      applyPos();
      posX.oninput = applyPos;
      posY.oninput = applyPos;

      // 卡片半透度
      var opLbl = document.createElement('label'); opLbl.textContent = '卡片半透度'; pDisplay.appendChild(opLbl);
      var opRange = document.createElement('input'); opRange.type = 'range'; opRange.min = 20; opRange.max = 100; opRange.value = localStorage.getItem('bgOpacity') || 50;
      opRange.style.width = '100%';
      function applyOp(v){
        document.documentElement.style.setProperty('--bg-op', v + '%');
        try { localStorage.setItem('bgOpacity', v); } catch(e){}
      }
      applyOp(opRange.value);
      opRange.oninput = function(){ applyOp(opRange.value); };
      pDisplay.appendChild(opRange);
      // 模糊度
      var blLbl = document.createElement('label'); blLbl.textContent = '毛玻璃模糊度'; pDisplay.appendChild(blLbl);
      var blRange = document.createElement('input'); blRange.type = 'range'; blRange.min = 0; blRange.max = 30; blRange.value = localStorage.getItem('bgBlur') || 12;
      blRange.style.width = '100%';
      function applyBl(v){
        document.documentElement.style.setProperty('--bg-blur', v + 'px');
        try { localStorage.setItem('bgBlur', v); } catch(e){}
      }
      applyBl(blRange.value);
      blRange.oninput = function(){ applyBl(blRange.value); };
      pDisplay.appendChild(blRange);
      // 封面不透明
      var coverOpaque = document.createElement('label'); coverOpaque.className = 'chk';
      var coverChk = document.createElement('input'); coverChk.type = 'checkbox'; coverChk.checked = localStorage.getItem('bgCoverOpaque') === '1';
      function applyCoverOpaque(v){
        document.body.classList.toggle('cover-opaque', v);
        try { localStorage.setItem('bgCoverOpaque', v ? '1' : '0'); } catch(e){}
      }
      coverChk.onchange = function(){ applyCoverOpaque(coverChk.checked); };
      coverOpaque.appendChild(coverChk); coverOpaque.appendChild(document.createTextNode('封面图不透明'));
      pDisplay.appendChild(coverOpaque);
      applyCoverOpaque(coverChk.checked);

      // === 高级 tab ===
      var netChk = chk(pAdvanced, 'netAlias', '联网刷新别名');
      netChk.title = '更新书库时补日/英别名';
      var netHint = document.createElement('div'); netHint.className = 'sub';
      netHint.textContent = '联网刷新：新书名第一次出现时补日/英别名，之后缓存。';
      pAdvanced.appendChild(netHint);

      var webSep = document.createElement('div'); webSep.style.cssText = 'border-top:1px solid var(--border);margin:12px 0;padding-top:10px;font-weight:600;font-size:14px';
      webSep.textContent = '局域网访问（手机看书库）';
      pAdvanced.appendChild(webSep);
      var webPwRow = document.createElement('div'); webPwRow.style.cssText = 'margin:6px 0;display:flex;gap:8px;align-items:center';
      var webPwLbl = document.createElement('span'); webPwLbl.textContent = '密码:';
      var webPwInput = document.createElement('input'); webPwInput.type = 'password'; webPwInput.placeholder = '设置访问密码';
      webPwInput.style.cssText = 'flex:1;padding:6px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--fg)';
      webPwRow.appendChild(webPwLbl); webPwRow.appendChild(webPwInput);
      pAdvanced.appendChild(webPwRow);
      var webBtn = document.createElement('button'); webBtn.className = 'btn ghost'; webBtn.textContent = '开启';
      pAdvanced.appendChild(webBtn);
      var webInfo = document.createElement('div'); webInfo.style.cssText = 'margin:6px 0;padding:8px;background:#1a2a1a;border-radius:6px;font-size:13px;display:none;line-height:1.6';
      pAdvanced.appendChild(webInfo);

      async function webToggle() {
        if (webBtn.textContent === '开启') {
          var pw = webPwInput.value.trim();
          if (!pw) { hint('请先设置密码'); return; }
          var r = await DISK.webStart(pw);
          if (r.ok) {
            webBtn.textContent = '关闭';
            webInfo.style.display = 'block';
            webInfo.innerHTML = '已开启<br>手机浏览器打开:<br><b style="color:#4f8;font-size:16px">http://' + r.ip + ':' + r.port + '</b><br>密码: ' + pw;
          } else { hint('启动失败: ' + r.msg); }
        } else {
          await DISK.webStop();
          webBtn.textContent = '开启';
          webInfo.style.display = 'none';
        }
      }
      webBtn.onclick = webToggle;
      DISK.webStatus().then(function (st) {
        if (st.running) {
          webBtn.textContent = '关闭';
          webPwInput.value = st.password || '';
          webInfo.style.display = 'block';
          webInfo.innerHTML = '已开启<br>手机浏览器打开:<br><b style="color:#4f8;font-size:16px">http://' + st.ip + ':' + st.port + '</b><br>密码: ' + (st.password || '');
        }
      });

      // batch tools
      var ltool = document.createElement('label'); ltool.textContent = '批量工具'; pAdvanced.appendChild(ltool);
      var trow = document.createElement('div'); trow.className = 'toolrow'; pAdvanced.appendChild(trow);
      var btag = document.createElement('button'); btag.className = 'btn ghost'; btag.textContent = '全库自动打标签';
      btag.onclick = function () { autoTagsAll(); };
      var bdup = document.createElement('button'); bdup.className = 'btn ghost'; bdup.textContent = '检查重复书目';
      bdup.onclick = function () { closeModal(); dupDialog(); };
      trow.appendChild(btag); trow.appendChild(bdup);

      // alias
      var lh = document.createElement('label'); lh.textContent = '作者名合并'; pAdvanced.appendChild(lh);
      var sh = document.createElement('div'); sh.className = 'sub';
      sh.textContent = '改的写进 author-alias.json，重建后仍有效。';
      pAdvanced.appendChild(sh);
      var aw = document.createElement('div'); aw.id = 'aliasbox'; pAdvanced.appendChild(aw);
      function renderAliasBox() {
        aw.innerHTML = '';
        var gs = authorGroups();
        var info = document.createElement('div'); info.className = 'stat'; info.style.display = 'block';
        info.textContent = '当前 ' + gs.length + ' 位作者（按合并后的名字算）';
        aw.appendChild(info);
        gs.forEach(function (g) {
          var row = document.createElement('div'); row.className = 'arow';
          var nm2 = document.createElement('span'); nm2.className = 'aname';
          nm2.textContent = g.key;
          if (g.raws.length) { nm2.title = '原始写法: ' + g.raws.join(' / '); }
          var cnt = document.createElement('span'); cnt.className = 'acnt';
          cnt.textContent = g.n + ' 本' + (g.raws.length ? ' · 合并了 ' + g.raws.length + ' 种写法' : '');
          var bm = document.createElement('button'); bm.className = 'tab'; bm.textContent = '合并到…';
          if (g.key !== '未标注') bm.onclick = function () { closeModal(); mergeAuthorDialog(g.key, g.raws); };
          else bm.disabled = true;
          var bn = document.createElement('button'); bn.className = 'tab'; bn.textContent = '改名';
          if (g.key !== '未标注') bn.onclick = function () {
            var v = prompt('「' + g.key + '」改成:', g.key);
            if (v && normName(v) && normName(v) !== g.key) mergeAuthorInto(g.key, normName(v), function () { renderShelf(); closeModal(); openSettings(); });
          };
          row.appendChild(nm2); row.appendChild(cnt); row.appendChild(bm); row.appendChild(bn);
          aw.appendChild(row);
        });
        var l3 = document.createElement('div'); l3.className = 'stat'; l3.style.cssText = 'display:block;margin-top:8px';
        l3.textContent = '手动指定：原始写法 → 正式作者名';
        aw.appendChild(l3);
        var mrow = document.createElement('div'); mrow.className = 'arow';
        var i1 = document.createElement('input'); i1.type = 'text'; i1.placeholder = 'Original（如 毎日健康生活 (ヘルシーマン)）'; i1.style.flex = '2';
        var i2 = document.createElement('input'); i2.type = 'text'; i2.placeholder = '正式名（如 ヘルシーマン）'; i2.style.flex = '2';
        var bok = document.createElement('button'); bok.className = 'tab'; bok.textContent = '保存';
        bok.onclick = function () {
          var a1 = normName(i1.value), a2 = normName(i2.value);
          if (!a1) { hint('原始写法不能为空'); return; }
          var m = {}; m[a1] = a2;
          saveAliasMap(m, function () { renderShelf(); closeModal(); openSettings(); });
        };
        mrow.appendChild(i1); mrow.appendChild(i2); mrow.appendChild(bok);
        aw.appendChild(mrow);
      }
      renderAliasBox();

      var foot = document.createElement('div'); foot.id = 'mfoot'; box.appendChild(foot);
      var reset = document.createElement('button'); reset.className = 'btn ghost'; reset.textContent = '恢复默认'; reset.style.marginRight = 'auto';
      var close = document.createElement('button'); close.className = 'btn'; close.textContent = '完成';
      foot.appendChild(reset); foot.appendChild(close);
      reset.onclick = function () { SET = Object.assign({}, SET_DEFAULT); applySettings(); closeModal(); openSettings(); };
      close.onclick = closeModal;
    });
  }
  function loadBookTimes() {
    if (!DISK || !DISK.bookTimes) return;
    try { DISK.bookTimes().then(function (r) { if (r && r.times) { BOOKTIMES = r.times; renderShelf(); } }).catch(function () {}); } catch (e) {}
  }
  (function () {
    loadBookTimes();
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
      try { DISK.jmQueue.on(function (q) { JQ = q; syncJmBtn(); if (JmQRender) JmQRender(q); }); } catch (e) {}   // 只订阅这一次
      DISK.jmQueue.list().then(function (q) {
        JQ = q; syncJmBtn();
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
        else if (ev.type === "done") { jmAppend("\n[结束] 退出码 " + ev.code + "\n"); JM_BUSY = false; syncJmBtn(); }
      });
    } catch (e) {}
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

  /* ---------- 书签（localStorage） ---------- */
  function bmAll() { try { var a = JSON.parse(localStorage.getItem('bookmarks') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function bmSave(a) { try { localStorage.setItem('bookmarks', JSON.stringify(a.slice(0, 800))); } catch (e) {} }
  function bmFind(dir, ci, pi) { var a = bmAll(); for (var i = 0; i < a.length; i++) { if (a[i].dir === dir && a[i].ci === ci && a[i].pi === pi) return i; } return -1; }
  function bmToggle() {
    if (!comic) return;
    var c = comic, a = bmAll(), i = bmFind(c.dir, S.ci, S.pi);
    if (i >= 0) { a.splice(i, 1); bmSave(a); hint('已取消书签'); }
    else {
      var ch = c.chapters[S.ci] || {};
      a.unshift({ dir: c.dir, name: (c.name || c.dir), ci: S.ci, pi: S.pi, t: Date.now(), ch: ch.name || ('第' + (S.ci + 1) + '话'), total: pages().length });
      bmSave(a); hint('已加书签：' + (ch.name || '') + ' 第' + (S.pi + 1) + '页');
    }
    syncButtons(); bmSync();
  }
  function bmSync() { var b = document.getElementById('bbm'); if (!b) return; var on = comic ? bmFind(comic.dir, S.ci, S.pi) >= 0 : false; b.textContent = on ? '已书签' : '书签'; b.classList.toggle('on', on); }
  function openByDir(dir, ci, pi) {
    bmJump = true; bmDir = dir; bmAt = (typeof ci === 'number') ? { ci: ci, pi: pi || 0 } : null;
    for (var i = 0; i < COMICS.length; i++) {
      if (COMICS[i].dir !== dir) continue;
      openComic(COMICS[i]);
      if (typeof ci === 'number') { S.ci = Math.max(0, Math.min(ci, COMICS[i].chapters.length - 1)); S.pi = Math.max(0, pi || 0); }
      renderChapters(); render();
      bmJump = false;
      return true;
    }
    hint('库里找不到这本书（可能已删除）');
    return false;
  }
  // 这本书是不是倒序观看(和阅读进度存在一起)
  function revOf(dir) { try { var p = prog(dir); return !!(p && p.rev); } catch (e) { return false; } }
  // 倒序观看时封面取"最新一话的第一张"; 正序/没设过返回 null, 走原来的封面
  function coverPage(c) {
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
  function thumbOf(c, ch, pi) {
    try { var pl = pageList(c, ch); return pl[Math.min(pi, pl.length - 1)] || null; } catch (e) { return null; }
  }
  function renderBookmarks() {
    var m = meta(), q = S.q.trim().toLowerCase();
    var a = bmAll().filter(function (x) { return !q || String(x.name).toLowerCase().indexOf(q) >= 0; });
    elGrid.innerHTML = '';
    if (!a.length) { var d = document.createElement('div'); d.id = 'empty'; d.textContent = '还没有书签。阅读时点右上「书签」即可添加。'; elGrid.appendChild(d); }
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
      var t = document.createElement('div'); t.className = 'ctitle'; t.textContent = ' ' + x.name; mt.appendChild(t);
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
  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  /* ---------- 阅读历史页 ---------- */
  function renderHistory() {
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
  function openHistory() {
    var h = document.getElementById('history');
    if (!h) return;
    elShelf.classList.add('hide'); elReader.classList.add('hide');
    h.classList.remove('hide');
    h.getAnimations().forEach(function(a){a.cancel()});
    h.animate([{opacity:0},{opacity:1}],{duration:300,easing:'ease-out',fill:'forwards'}).onfinish = function(){ h.style.opacity = ""; };
    renderHistory();
  }
  function closeHistory() {
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

  function openEditor(dir) {
    if (!LIBRARY) { hint("收藏/分类需要桌面版"); return; }
    var e = libEntry(dir);
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "编辑分类与标签"; box.appendChild(h);
      var s = document.createElement("div"); s.className = "sub"; s.textContent = dir; box.appendChild(s);

      var l1 = document.createElement("label"); l1.textContent = "分类"; box.appendChild(l1);
      if (!LIBRARY.categories.length) {
        var nn = document.createElement("div"); nn.className = "sub"; nn.textContent = "（还没有分类，先在书架顶部「+ 新建分类」）"; box.appendChild(nn);
      }
      LIBRARY.categories.forEach(function (cat) {
        var lab = document.createElement("label"); lab.className = "chk";
        var cbx = document.createElement("input"); cbx.type = "checkbox";
        cbx.checked = e.categories.indexOf(cat) >= 0;
        cbx.setAttribute("data-cat", cat);
        lab.appendChild(cbx);
        lab.appendChild(document.createTextNode(cat));
        box.appendChild(lab);
      });

      var l2 = document.createElement("label"); l2.textContent = "标签（逗号分隔）"; box.appendChild(l2);
      var ti = document.createElement("input"); ti.type = "text"; ti.value = e.tags.join(", "); box.appendChild(ti);

      var l3 = document.createElement("label"); l3.textContent = "备注"; box.appendChild(l3);
      var ni = document.createElement("input"); ni.type = "text"; ni.value = e.note || ""; box.appendChild(ni);

      var f = modalFoot(box, function () {
        var cats = [], boxes = box.querySelectorAll("input[type=checkbox]");
        for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) cats.push(boxes[i].getAttribute("data-cat"));
        e.categories = cats;
        e.tags = ti.value.split(",").join("，").split("，").map(function (x) { return x.trim(); }).filter(Boolean);
        e.note = ni.value.trim();
        libSave(); invalidateCard(dir); closeModal(); renderShelf(); hint("已保存");
      });
      [ti, ni].forEach(function (inp) {
        inp.onkeydown = function (ev) { ev.stopPropagation(); if (ev.key === "Enter") f.ok.click(); else if (ev.key === "Escape") closeModal(); };
      });
      setTimeout(function () { ti.focus(); }, 30);
    });
  }

  function hostOf(u) {
    var s = String(u || "");
    var i = s.indexOf("://");
    if (i < 0) return "";
    var rest = s.slice(i + 3);
    var j = rest.indexOf("/");
    return j < 0 ? rest : rest.slice(0, j);
  }

  function openInfo(dir) {
    if (!LIBRARY) { hint("需要桌面版"); return; }
    var e = libEntry(dir);
    var src = (e.source && e.source.url) ? e.source.url : "";
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "简介与来源"; box.appendChild(h);
      var s = document.createElement("div"); s.className = "sub"; s.textContent = dir; box.appendChild(s);

      var l0 = document.createElement("label"); l0.textContent = "下载原链接"; box.appendChild(l0);
      var row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px";
      var ui = document.createElement("input"); ui.type = "text"; ui.value = src; ui.placeholder = "https://..."; ui.style.flex = "1";
      var ob = document.createElement("button"); ob.className = "btn ghost"; ob.textContent = "打开";
      row.appendChild(ui); row.appendChild(ob); box.appendChild(row);

      var l1 = document.createElement("label"); l1.textContent = "简介"; box.appendChild(l1);
      var ta = document.createElement("textarea"); ta.rows = 6; ta.value = e.desc || "";
      ta.placeholder = "还没有简介。填好链接后可点左下角「从链接抓取简介」";
      box.appendChild(ta);

      var l2 = document.createElement("label"); l2.textContent = "作者（多个用 / 分隔；留空按未标注）"; box.appendChild(l2);
      var ai = document.createElement("input"); ai.type = "text"; ai.value = e.author || ""; box.appendChild(ai);
      var l3 = document.createElement("label"); l3.textContent = "备注"; box.appendChild(l3);
      var ni = document.createElement("input"); ni.type = "text"; ni.value = e.note || ""; box.appendChild(ni);

      var st = document.createElement("div"); st.className = "stat"; st.style.display = "none"; box.appendChild(st);

      var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
      var fb = document.createElement("button"); fb.className = "btn ghost"; fb.textContent = "从链接抓取简介"; fb.style.marginRight = "auto";
      var cancel = document.createElement("button"); cancel.className = "btn ghost"; cancel.textContent = "取消";
      var save = document.createElement("button"); save.className = "btn"; save.textContent = "保存";
      foot.appendChild(fb); foot.appendChild(cancel); foot.appendChild(save);

      ob.onclick = function () {
        var u = ui.value.trim();
        if (!u) { hint("请先填写链接"); return; }
        if (DISK && DISK.openExternal) DISK.openExternal(u); else copyText(u);
      };
      fb.onclick = async function () {
        var u = ui.value.trim();
        if (!u) { hint("请先填写链接"); return; }
        if (!DISK || !DISK.metaFetch) { hint("仅桌面版支持"); return; }
        fb.disabled = true; fb.textContent = "抓取中…";
        st.style.display = "block"; st.textContent = "正在抓取…";
        var r2 = await DISK.metaFetch(u);
        fb.disabled = false; fb.textContent = "从链接抓取简介";
        if (r2 && r2.ok) {
          if (r2.desc) ta.value = r2.desc;
          if (!ui.value.trim() && r2.url) ui.value = r2.url;
          st.textContent = r2.desc ? "已抓取简介" : "该页面没有简介";
        } else {
          st.textContent = "抓取失败：" + ((r2 && r2.msg) || "未知错误");
        }
      };
      cancel.onclick = closeModal;
      save.onclick = function () {
        var u = ui.value.trim();
        e.source = u ? { site: hostOf(u), url: u } : null;
        e.desc = ta.value.trim();
        e.author = ai.value.trim();
        e.note = ni.value.trim();
        libSave(); invalidateCard(dir); closeModal(); renderShelf(); hint("已保存");
      };
      [ui, ni].forEach(function (x) { x.onkeydown = function (ev) { ev.stopPropagation(); }; });
      ta.onkeydown = function (ev) { ev.stopPropagation(); };
      setTimeout(function () { ui.focus(); }, 40);
    });
  }

  function manageCat(cat, x, y) {
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
      { t: " 左移一位", f: function () { move(-1); } },
      { t: " 右移一位", f: function () { move(1); } },
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

  var dragCat = null;   // 正在拖的分类名(拖动排序用)
  function renderCatTabs() {
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
        b.ondragstart = function (ev) { dragCat = t.k; try { ev.dataTransfer.setData("text/plain", t.k); ev.dataTransfer.effectAllowed = "move"; } catch (e2) {} };
        b.ondragover = function (ev) { if (dragCat && dragCat !== t.k) { ev.preventDefault(); b.classList.add("dragover"); } };
        b.ondragleave = function () { b.classList.remove("dragover"); };
        b.ondrop = function (ev) {
          ev.preventDefault(); b.classList.remove("dragover");
          if (!dragCat || dragCat === t.k) { dragCat = null; return; }
          var arr = LIBRARY.categories.slice();
          var from = arr.indexOf(dragCat), to = arr.indexOf(t.k);
          dragCat = null;
          if (from < 0 || to < 0) return;
          var moved = arr.splice(from, 1)[0];
          arr.splice(to, 0, moved);   // 拖到目标位置(往后拖落在目标之后, 往前拖落在目标之前)
          LIBRARY.categories = arr;
          libSave(); renderShelf(); saveShelfView(true); hint("分类顺序已调整");
        };
        b.ondragend = function () { dragCat = null; };
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

  /* ===== 专辑栏 ===== */
  function renderAlbumBar() {
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
      b.onclick = function () { S.album = (S.album === name ? "" : name); SEL = []; renderShelf(); };
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

  /* ================= 下载 / 更新书库 ================= */
  var dlState = null;

  function fmtBytes(b) {
    if (!b) return "0 B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
    return (b / 1073741824).toFixed(2) + " GB";
  }

  function dlLog(s, t, cls) {
    if (!s || !s.log) return;
    var d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = t;
    s.log.appendChild(d);
    s.log.scrollTop = s.log.scrollHeight;
  }
  function dpSet(s, done, total) {
    if (!s || !s.bar) return;
    s.bar.style.width = (total ? Math.round(done / total * 100) : 0) + "%";
    if (s.pct) s.pct.textContent = "进度 " + done + " / " + total + " 话";
  }
  function dlSetStage(s, n, label, pct) {
    if (!s || !s.stepEls) return;
    for (var i = 0; i < s.stepEls.length; i++) {
      s.stepEls[i].className = i < n ? "ok" : (i === n ? "now" : "");
    }
    if (s.dlinfoL) s.dlinfoL.textContent = label || "";
    if (s.dlinfoR) s.dlinfoR.textContent = (pct != null ? pct + "%" : "");
  }

  // 把当前进度存成纯数据快照(window._dlProgress), 弹窗关掉后再打开时用它还原
  function dlSnap(s) {
    if (!s || !s.running) return;
    if (!window._dlProgress) window._dlProgress = {};
    var p = window._dlProgress;
    p.total = s.total; p.doneCh = s.doneCh; p.imgs = s.imgs; p.bytes = s.bytes;
    p.head = s.head ? s.head.textContent : "";
    p.barWidth = s.bar ? s.bar.style.width : "";
    p.infoL = s.dlinfoL ? s.dlinfoL.textContent : "";
    p.infoR = s.dlinfoR ? s.dlinfoR.textContent : "";
    p.pct = s.pct ? s.pct.textContent : "";
    p.logHTML = s.log ? s.log.innerHTML : "";
    p.stepIdx = -1;
    for (var si = 0; si < s.stepEls.length; si++) {
      var cn = s.stepEls[si].className;   // 活动步骤的类名是 now(dlSetStage 用的), run 是早先写法, 两个都认
      if (cn === "now" || cn === "run") p.stepIdx = si;
    }
  }

  function onDlEvent(ev) {
    var s = dlState;
    if (!s || !s.running) return;
    if (ev.src) s.src = ev.src === "jm" ? "jm" : "dl";   // 取消下载要按来源选接口
    if (ev.type === "start") {
      s.total = ev.total;
      s.head.textContent = "共 " + ev.total + " 话，开始下载…";
      dlSetStage(s, 0, "正在数页数…", 0);
      dlLog(s, "输出目录: " + ev.out);
    } else if (ev.type === "chapter-start") {
      s.head.textContent = (s.total ? "[" + (ev.index + 1) + "/" + s.total + "] " : "") + ev.label + "  准备中…";
      dlSetStage(s, 1, "正在取图片地址…", null);
    } else if (ev.type === "prog") {
      var sub = ev.got && ev.total ? ev.got / ev.total : 0;
      // 中途接上的任务可能还没收到 start(total 未知): 先按单话进度显示, 免得算出 NaN%
      var overall = s.total ? (s.doneCh + sub) / s.total : sub;
      if (s.bar) s.bar.style.width = Math.round(overall * 100) + "%";
      if (ev.stage === "resolve") {
        var p = Math.round(sub * 100);
        dlSetStage(s, 1, "取图片地址 " + ev.got + "/" + ev.total, p);
      } else {
        var p2 = Math.round(sub * 100);
        dlSetStage(s, 2, "下载图片 " + ev.got + "/" + ev.total + (ev.bytes ? " · " + fmtBytes(ev.bytes) : ""), p2);
      }
    } else if (ev.type === "chapter-progress") {
      s.head.textContent = (s.total ? "[" + (ev.index + 1) + "/" + s.total + "] " : "") + ev.label + "  " + ev.done + "/" + ev.images;
    } else if (ev.type === "chapter-done") {
      s.doneCh = ev.index + 1; s.imgs += ev.got; s.bytes += ev.bytes;
      dpSet(s, s.doneCh, s.total);
      dlSetStage(s, 3, "正在整理书库…", 95);
      dlLog(s, "[" + ev.label + "] " + ev.got + "/" + ev.expected + " 张  " + fmtBytes(ev.bytes) +
        "  " + (ev.widths.join("/") || "?") + "px" + (ev.cbz ? "  +CBZ" : "") +
        (ev.failed.length ? "  !! 缺页 " + ev.failed.length : ""), ev.failed.length ? "er" : "ok");
    } else if (ev.type === "chapter-error") {
      s.doneCh = ev.index + 1; dpSet(s, s.doneCh, s.total);
      dlLog(s, "[" + ev.label + "] 失败: " + ev.message, "er");
    } else if (ev.type === "cancelled") {
      s.head.textContent = "已取消";
      dlLog(s, "已取消", "er");
      dlDone(s, false);
    } else if (ev.type === "error") {
      s.head.textContent = "出错";
      dlLog(s, "错误: " + ev.message, "er");
      dlDone(s, false);
    } else if (ev.type === "log") {
      dlLog(s, "  " + String(ev.line || "").replace(/\n+$/, ""));
    } else if (ev.type === "done") {
      var sum = ev.summary || {};
      s.incr = !!ev.incremental;   // 后端是否已增量重建好这本书
      s.head.textContent = "下载完成";
      dlSetStage(s, 4, "下载完成 ✓", 100);
      dlLog(s, "合计: " + sum.chapters + " 话 / " + sum.images + " 张 / " + fmtBytes(sum.bytes) + (s.incr ? "（已增量重建）" : ""), "ok");
      dlDone(s, true);
    }
    dlSnap(s);   // 事件处理完再存, 快照才是最新一步(存早了会慢一拍)
  }

  // 下载中把窗口收起来: 不中断下载, 顶栏按钮变成"下载中", 点它能看到进度
  function runInBackground() {
    closeModal();
    var bd = document.getElementById("btn-download");
    if (bd) { bd.classList.add("running"); bd.textContent = "下载中…"; }
    hint("已转到后台继续下载，点顶栏「下载中…」可以看进度");
  }
  function dlDone(s, ok) {
    s.running = false;
    window._dlRunning = false;
    window._dlProgress = null;
    var bd2 = document.getElementById("btn-download");
    if (bd2) { bd2.classList.remove("running"); bd2.innerHTML = DL_SVG + "下载漫画"; }
    // 收尾: 清掉其它按钮栏, 在弹窗最底部重建**一行**按钮 —— 关闭 | 查看书库 | 下一本
    (function () {
      try {
        var box2 = s.box; if (!box2) return;
        if (s.foot) { try { s.foot.remove(); } catch (e) {} }
        var lf3 = box2.querySelector("[id^='listfoot']"); if (lf3) { try { lf3.remove(); } catch (e) {} }
        var oldBar = document.getElementById("dl-endbar"); if (oldBar) { try { oldBar.remove(); } catch (e) {} }
        var bar2 = document.createElement("div");
        bar2.id = "dl-endbar";
        bar2.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:12px";
        var bClose = document.createElement("button"); bClose.className = "btn ghost"; bClose.textContent = "关闭";
        bClose.onclick = closeModal;
        bar2.appendChild(bClose);
        if (ok) {
          var bLib = document.createElement("button"); bLib.className = "btn";
          bLib.textContent = s.incr ? "查看书库" : "全量更新书库";
          bLib.onclick = function () {
            closeModal();
            if (!s.incr) { doRebuild(); return; }
            if (DISK.rescan) { DISK.rescan({ offline: true, quiet: true }).then(function () { hint("已把新下的书加进书架"); }); }
            else { location.reload(); }
          };
          bar2.appendChild(bLib);
          var bNext = document.createElement("button"); bNext.className = "btn ghost"; bNext.textContent = "下一本";
          bNext.onclick = function () { closeModal(); openDownload("general"); };
          bar2.appendChild(bNext);
        }
        box2.appendChild(bar2);
      } catch (e) {}
    })();
    if (s.btnGo) { s.btnGo.disabled = false; s.btnGo.textContent = "再下一本"; s.btnGo.onclick = function () { closeModal(); openDownload("general"); }; }
    if (ok && s.foot && s.box && !s.box.querySelector("#dl-rebuild")) {
      var b = document.createElement("button");
      b.className = "btn"; b.id = "dl-rebuild";
      // 后端已增量重建好 -> 只增量刷新书架(不整页刷新, 保留滚动位置和当前视图); 增量失败才退回全量重建
      b.textContent = s.incr ? "查看书库" : "全量更新书库";
      b.onclick = function () {
        closeModal();
        if (!s.incr) { doRebuild(); return; }
        if (DISK.rescan) {
          DISK.rescan({ offline: true, quiet: true }).then(function () { hint("已把新下的书加进书架"); });
        } else { location.reload(); }
      };
      // 放到列表页脚那一排(和 取消/[下载选中] 同排), 不再单独挤在 #mfoot 里
      var lf = s.box ? s.box.querySelector("[id^='listfoot']") : null;
      if (lf) lf.insertBefore(b, lf.firstChild); else s.foot.insertBefore(b, s.foot.firstChild);
    }
  }

  async function doRebuild() {
    if (!DISK) { hint("需要桌面版"); return; }
    hint("正在重建书库…");
    var r = await DISK.rescan({ offline: !SET.netAlias });
    if (!r || !r.ok) hint("重建失败: " + ((r && r.msg) || "未知错误"));
  }

  // 容器预览(功能5 三级): 作品列表 → 点作品下的 ▼ 展开这本的页缩略图 → 逐页勾选
  // 两级都默认不勾; 保留 全选/全不选/反选; 先渲染前 60 本, 滚到底自动续
  // 批量选择面板: EH tag 画廊列表 / pixiv 用户作品列表, 勾选要下的
  function showPickList(S2, r, items, ui, ni, fi, ti, mc, cancelBtn, goBtn, bgBtn, bar, pct, log) {
    var box = S2.box;
    // 隐藏表单区, 换成选择网格
    box.querySelectorAll("label,input,.sub,.chk,#dlbar,#dlinfo,#dlsteps,#dllog,#mfoot").forEach(function (x) { x.style.display = "none"; });
    // 顶部提示
    var head = document.createElement("div"); head.className = "sub";
    head.textContent = "共 " + items.length + " 个，勾选要下载的（默认全选）"; box.appendChild(head);
    // 全选/全不选 工具行
    var toolbar = document.createElement("div"); toolbar.style.cssText = "display:flex;gap:8px;align-items:center;margin:6px 0;";
    var selAll = document.createElement("button"); selAll.className = "btn ghost"; selAll.textContent = "全选";
    var desAll = document.createElement("button"); desAll.className = "btn ghost"; desAll.textContent = "全不选";
    var countLbl = document.createElement("span"); countLbl.style.cssText = "color:#8f96a0;font-size:12.5px;margin-left:auto;";
    toolbar.appendChild(selAll); toolbar.appendChild(desAll); toolbar.appendChild(countLbl);
    box.appendChild(toolbar);
    // 缩略图网格
    var grid = document.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:50vh;overflow-y:auto;padding:4px 0;";
    box.appendChild(grid);
    var checks = [];
    var imgMap = {}; // id -> {img, ttl} 用于后台补缩略图
    var idOrder = []; // 保持插入顺序(新到旧)
    items.forEach(function (it, idx) {
      var cell = document.createElement("label");
      cell.style.cssText = "cursor:pointer;display:flex;flex-direction:column;gap:3px;padding:5px;border:1px solid #2c2f36;border-radius:6px;background:#1a1b1f;position:relative;";
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
      cb.style.cssText = "position:absolute;top:4px;left:4px;z-index:2;margin:0;";
      var img = document.createElement("img"); img.src = it.thumb || "";
      img.style.cssText = "width:100%;height:140px;object-fit:cover;border-radius:3px;background:#0d0e10;";
      img.onerror = function () { if(!this.getAttribute("data-late")){this.style.background="#222";this.alt="加载中…";} };
      var ttl = document.createElement("div"); ttl.style.cssText = "font-size:10.5px;color:#c9ced6;line-height:1.3;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;";
      ttl.textContent = it.title || it.url || ("#" + idx);
      ttl.title = it.title || "";
      cell.appendChild(cb); cell.appendChild(img); cell.appendChild(ttl);
      if (it.pages && it.pages > 0) {
        var pg = document.createElement("div");
        pg.style.cssText = "font-size:10px;color:#8ab4f8;text-align:right;line-height:1;";
        pg.textContent = it.pages + " 页";
        cell.appendChild(pg);
      }
      grid.appendChild(cell);
      checks.push(cb);
      cb.onchange = updateCount;
      if (it.id && !it.thumb) { imgMap[it.id] = { img: img, ttl: ttl, item: it }; idOrder.push(it.id); }
    });
    // 后台补 pixiv 缩略图和标题
    var needIds = idOrder;
    if (needIds.length && window.mangaLib && window.mangaLib.pickDetails) {
      window.mangaLib.onPickDetail(function (d) {
        if (!d) return;
        var ref = imgMap[d.id];
        if (ref) {
          if (d.thumb) { ref.img.src = d.thumb; ref.img.setAttribute("data-late", "1"); }
          if (d.title && ref.ttl.textContent.indexOf("pixiv ") === 0) { ref.ttl.textContent = d.title; ref.ttl.title = d.title; ref.item.title = d.title; }
        }
      });
      window.mangaLib.pickDetails(needIds);
    }
    function updateCount() {
      var n = 0; for (var i = 0; i < checks.length; i++) if (checks[i].checked) n++;
      countLbl.textContent = "已选 " + n + " / " + items.length;
    }
    updateCount();
    selAll.onclick = function () { checks.forEach(function (c) { c.checked = true; }); updateCount(); };
    desAll.onclick = function () { checks.forEach(function (c) { c.checked = false; }); updateCount(); };
    // 底部按钮
    var foot2 = document.createElement("div"); foot2.id = "listfoot" + (document.querySelectorAll("[id^=\"listfoot\"]").length + 1); foot2.style.cssText = "margin-top:10px;display:flex;gap:8px;justify-content:flex-end;justify-content:flex-end";
    var backBtn = document.createElement("button"); backBtn.className = "btn ghost"; backBtn.textContent = "返回";
    var startBtn = document.createElement("button"); startBtn.className = "btn"; startBtn.textContent = "开始下载选中";
    foot2.appendChild(backBtn); foot2.appendChild(startBtn);
    box.appendChild(foot2);
    backBtn.onclick = function () { if (window.mangaLib && window.mangaLib.pickStop) window.mangaLib.pickStop(); closeModal(); openDownload("general"); };
    startBtn.onclick = function () {
      var picked = [];
      for (var i = 0; i < items.length; i++) if (checks[i].checked) picked.push(items[i]);
      if (!picked.length) { hint("先勾选至少一个"); return; }
      // 构造 --pick 参数: EH 用 gid|url; pixiv 用 id,id
      var pickStr;
      if (r.galleries) {
        pickStr = picked.map(function (g) { return (g.gid || "") + "|" + (g.url || ""); }).join(";");
      } else {
        pickStr = picked.map(function (it) { return it.id; }).join(",");
      }
      // 隐藏选择面板, 进入下载进度
      grid.remove(); toolbar.remove(); head.remove(); foot2.remove();
      bar.style.display = "block"; dlinfo.style.display = "flex"; dlsteps.style.display = "flex"; pct.style.display = "block"; log.style.display = "block";
      // 恢复原来的按钮栏(取消按钮在里面), picker 之前把它藏了
      var foot0 = document.getElementById("mfoot");
      if (foot0) foot0.style.display = "flex";
      cancelBtn.textContent = "取消下载";
      cancelBtn.onclick = function () { if (S2.running) DISK.dlCancel(); };
      S2.running = true;
      bgBtn.style.display = "";
      var bd3 = document.getElementById("btn-download");
      if (bd3) { bd3.classList.add("running"); bd3.textContent = " 下载中…"; }
      goBtn.style.display = "none";
      // pixiv 用户链接: 保存名用作者名; EH tag: 自动按画廊标题建文件夹
      var saveName = ni.value.trim() || r.title || "批量下载";
      DISK.dlStart({ url: r.url, name: saveName, pick: pickStr }).then(function (res) {
        if (!res || !res.ok) {
          if (!S2.running) return;
          dlLog(S2, "启动失败: " + ((res && res.msg) || "未知错误"), "er");
          dlDone(S2, false);
          return;
        }
      });
    };
  }


  function showWorkList(S2, r, items, ui, ni, fi, ti, mc, cancelBtn, goBtn, bgBtn, bar, pct, log) {
    var box = S2.box;
    var isTag = !!r.galleries;
    var pageUrl = r.url || "";
    box.querySelectorAll("label,input,.sub,.chk,#dlbar,#dlinfo,#dlsteps,#dllog,#mfoot").forEach(function (x) { x.style.display = "none"; });

    var states = items.map(function (it) {
      return { it: it, checked: false, expanded: false, pgrid: null, loading: false, card: null,
               name: (it.title || (isTag ? "画廊" : String(it.id || "作品"))) };
    });
    // ---- pixiv 作品封面: 列表接口不带封面, 必须逐本查(有 260ms 限流) → 滚到才拉 + 本地缓存 ----
    var needCover = {}, askedCover = {}, askedN = 0, gotN = 0, warned = false, gotIds = {};
    if (window.mangaLib && DISK.pickDetails && DISK.onPickDetail) {
      DISK.onPickDetail(function (d) {
        if (!d || d.done) {   // 这批查完了
          var missing = askedN - gotN;
          // 取不到的: 在卡片上标出来(不影响其它作品)
          for (var kk in needCover) {
            if (gotIds[kk]) continue;
            var rf = needCover[kk];
            try {
              rf.img.style.background = "#3a1d1d";
              if (rf.img.parentNode && rf.img.parentNode.style) rf.img.parentNode.style.outline = "1px solid #a33";
              if (rf.title && !rf.title.getAttribute("data-missing")) { rf.title.textContent = rf.title.textContent + "（封面/标题取不到）"; rf.title.setAttribute("data-missing", "1"); }
            } catch (e) {}
          }
          if (missing > 0 && !warned) {
            warned = true;
            hint((d && d.rate) ? ('pixiv 限流了（' + d.rate + '）：' + missing + ' 本没取到封面，已缓存的会立刻出。过几分钟再打开这个作者页即可。') : ('有 ' + missing + ' 本取不到封面/标题（R-18 未登录或限流）——已在卡片上标红，不影响其它作品。要全看到先跑 node _scripts\\jm\\site-login.mjs pixiv.net 续期。'));
          }
          return;
        }
        gotN++;
        gotIds[String(d.id)] = 1;
        var ref = needCover[String(d.id)];
        if (!ref) return;
        if (d.title && ref.title) ref.title.textContent = d.title;
        if (d.thumb) PVWATCH(ref.img, { thumb: d.thumb, url: d.thumb, pageUrl: 'https://www.pixiv.net/artworks/' + d.id }, list);
      });
    }
    // 补封面: pixiv 走 pickDetails(一次批量); 其余站点(如 EH)用各自解析接口按需补, 并发 3
    var lazyBusy = 0, lazyQ = [];
    function lazyPump() {
      while (lazyBusy < 3 && lazyQ.length) {
        var lk = lazyQ.shift();
        var ref = needCover[lk];
        if (!ref || !ref.url) continue;
        lazyBusy++;
        (function (ref2) {
          Promise.resolve(DISK.dlResolve(ref2.url)).then(function (res) {
            if (!res || !res.ok) return;
            var pp = (res.pagePreview && res.pagePreview.pages) || [];
            var p0 = pp[0] || null;
            var th2 = res.cover || (p0 && p0.thumb) || '';
            if (!th2) return;
            if (res.title && ref2.title) ref2.title.textContent = res.title;
            PVWATCH(ref2.img, { thumb: th2, url: th2, pageUrl: ref2.url, kind: "cover", w: ref2.url, cl: (p0 && typeof p0.cl === "number") ? p0.cl : null, ct: (p0 && p0.ct) || 0, cw: (p0 && p0.cw) || 0, ch: (p0 && p0.ch) || 0 }, list);
          }).catch(function () {}).then(function () { lazyBusy--; lazyPump(); });
        })(ref);
      }
    }
    function askCovers() {
      var ids = [];
      for (var i = 0; i < SHOWN; i++) {
        var it0 = states[i] && states[i].it;
        if (!it0) continue;
        var k = String(it0.id || '');
        if (!k || !needCover[k] || askedCover[k]) continue;
        askedCover[k] = 1;
        var ref0 = needCover[k];
        ref0.url = it0.url;
        if (/pixiv[.]net/i.test(it0.url || '')) ids.push(k);   // pixiv: 一次批量查
        else lazyQ.push(k);                                    // 其它站点: 逐本按站点解析(并发 3)
      }
      if (ids.length && DISK.pickDetails) { askedN += ids.length; DISK.pickDetails(ids); }
      lazyPump();
    }
    var SHOWN = 0, STEP = 60;
    var nextUrl = (r && r.next) || "";   // 站点给的"下一批"链接(滚到底/点按钮时才去取)
    var loadingMore = false;

    var head = document.createElement("div"); head.className = "sub";
    head.textContent = ((r && r.site === "browsertabs") ? "浏览器标签：共 " : (isTag ? "EH tag 批量：共 " : "作者作品：共 ")) + items.length + " 本　·　勾作品 = 整本下载；点 ▼ 展开可只挑这本里的几页（默认都不勾）";
    box.appendChild(head);

    var toolbar = document.createElement("div"); toolbar.style.cssText = "display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap";
    var selAll = document.createElement("button"); selAll.className = "btn ghost"; selAll.textContent = "全选作品";
    var desAll = document.createElement("button"); desAll.className = "btn ghost"; desAll.textContent = "全不选";
    var revAll = document.createElement("button"); revAll.className = "btn ghost"; revAll.textContent = "反选";
    var colAll = document.createElement("button"); colAll.className = "btn ghost"; colAll.textContent = "收起全部";
    var countLbl = document.createElement("span"); countLbl.style.cssText = "color:#8f96a0;font-size:12.5px;margin-left:auto";
    toolbar.appendChild(selAll); toolbar.appendChild(desAll); toolbar.appendChild(revAll); toolbar.appendChild(colAll); toolbar.appendChild(countLbl);
    box.appendChild(toolbar);

    var list = document.createElement("div");
    list.style.cssText = "max-height:52vh;overflow-y:auto;border:1px solid #2c2f36;border-radius:6px;background:#141519;padding:4px";
    box.appendChild(list);

    var more = document.createElement("button"); more.className = "btn ghost";
    more.style.cssText = "display:none;margin:8px auto 0";
    box.appendChild(more);

    function updateCount() {
      var n = 0, pn = 0;
      for (var i = 0; i < states.length; i++) {
        if (states[i].checked) n++;
        if (states[i].pgrid) pn += states[i].pgrid.picked().length;
      }
      countLbl.textContent = "已选 " + n + " 本" + (pn ? " ／ 单独勾了 " + pn + " 页" : "");
    }

    // 一个作品卡片: 封面 + 标题 + 勾选框(整本) + [下载整本] [▼ 展开页缩略图]
    function renderItem(st) {
      var it = st.it;
      var card = document.createElement("div");
      st.card = card;
      card.style.cssText = "display:flex;gap:10px;align-items:flex-start;padding:6px;border-bottom:1px solid #23252b";
      var left = document.createElement("div");
      left.style.cssText = "flex:1;min-width:0";
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:flex-start";
      var cv = document.createElement("div");
      cv.style.cssText = "width:58px;height:78px;flex:0 0 auto;background:#0d0e10;border-radius:4px;overflow:hidden;display:flex;align-items:center;justify-content:center";
      var img = document.createElement("img");
      img.style.cssText = "width:100%;height:100%;object-fit:cover;background:#0d0e10";
      img.alt = st.name;
      var th = it.thumb || it.cover || "";
      cv.appendChild(img);
      if (th) PVWATCH(img, { thumb: th, url: th, pageUrl: pageUrl, kind: "cover", w: it.url, cl: (typeof it.cl === "number" ? it.cl : null), ct: it.ct || 0, cw: it.cw || 0, ch: it.ch || 0 }, list);
      // 注: 登记待补封面要等 title 元素建好之后(见下面), 否则拿到的是 undefined
      var tx = document.createElement("div");
      tx.style.cssText = "flex:1;min-width:0";
      var t1 = document.createElement("div");
      t1.style.cssText = "font-size:12.5px;color:#e6e8ec;line-height:1.35;word-break:break-word";
      t1.textContent = st.name;
      if (!(it.thumb || it.cover) && it.id) { needCover[String(it.id)] = { img: img, title: t1 }; }   // pixiv: 封面/标题要逐本查(滚到才拉)
      var t2 = document.createElement("div");
      t2.className = "sub"; t2.style.margin = "2px 0 0";
      t2.textContent = [it.author, it.extra, (it.pages ? it.pages + " 页" : "")].filter(Boolean).join(" · ");
      tx.appendChild(t1); tx.appendChild(t2);
      row.appendChild(cv); row.appendChild(tx);
      card.style.cursor = "pointer";
      card.onclick = function (ev) {
        if (ev.target.tagName === "BUTTON") return;
        st.checked = !st.checked;
        card.style.background = st.checked ? "#1d2330" : "";
        updateCount();
      };
      left.appendChild(row);

      var btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:4px";
      var dlOne = document.createElement("button"); dlOne.className = "btn ghost"; dlOne.textContent = "下载整本";
      var arrow = null; if (SET.dlPreview === true) { arrow = document.createElement("button"); arrow.className = "btn ghost";
      arrow.style.cssText = "padding:0 8px;min-width:0";
      arrow.textContent = "▼"; arrow.title = "展开这本的页缩略图，可以只挑几页下载"; }
      var hint2 = document.createElement("span"); hint2.className = "sub"; hint2.style.marginLeft = "auto";
      btnRow.appendChild(dlOne); if (arrow) btnRow.appendChild(arrow); btnRow.appendChild(hint2);
      left.appendChild(btnRow);
      var holder = document.createElement("div");
      left.appendChild(holder);
      card.appendChild(left);

      dlOne.onclick = function (ev) { ev.stopPropagation(); runContainerDownload([{ url: it.url, name: st.name, pages: "" }]); };
      if (arrow) arrow.onclick = function (ev) {
        ev.stopPropagation();
        if (st.expanded) {   // 收起: 箭头翻回 ▼, 不写"收起"两个字
          st.expanded = false; arrow.textContent = "▼";
          if (st.pgrid) { try { st.pgrid.el.remove(); } catch (e) {} }
          hint2.textContent = "已收起（勾选保留）";
          return;
        }
        st.expanded = true; arrow.textContent = "▲";
        if (st.pgrid) { holder.appendChild(st.pgrid.el); hint2.textContent = "共 " + st.pgrid.count() + " 页，挑好点底部「下载选中」"; updateCount(); return; }
        if (st.loading) return;
        st.loading = true;
        hint2.textContent = "正在取这本的页缩略图…";
        Promise.resolve(DISK.dlResolve(it.url)).then(function (res) {
          st.loading = false;
          if (!res || !res.ok || !res.pagePreview || !res.pagePreview.pages || !res.pagePreview.pages.length) {
            var why = (res && res.msg) ? res.msg : "取不到页缩略图";
            hint2.textContent = "这本取不到页缩略图（勾作品=整本下载仍可用）";
            st.expanded = false; arrow.textContent = "▼";
            // 用户定的规矩: 这本要看的内容取不到 → 全局提示 + 中断整本预览
            hint("这本取不到预览内容：" + why + "　→ 已中断预览。先跑 node _scripts\\jm\\site-login.mjs pixiv.net 续期登录态再试。");
            try { PVCLOSE(); } catch (e) {}
            if (DISK.worksStop) DISK.worksStop();
            closeModal();
            return;
          }
          hint2.textContent = "共 " + res.pagePreview.pages.length + " 页，挑好点底部「下载选中」";
          st.pgrid = buildPageGrid(holder, res, res.pagePreview.pages);
          updateCount();
        }).catch(function (e) {
          st.loading = false;
          hint2.textContent = "取页缩略图失败：" + String(e && e.message || e);
          st.expanded = false; arrow.textContent = "▼";
        });
      };
      return card;
    }

    // 流式追加: tag 列表先出前几页, 后面的边翻边补进来(见 ech/ fetch-book 的 @@MORE@@)
    function appendWorks(more) {
      var list2 = (more && more.galleries) || [];
      if (!list2.length) {
        if (more && more.total) { head.textContent = (isTag ? "EH tag 批量：共 " : "作者作品：共 ") + Math.max(items.length, more.total) + " 本　·　勾作品 = 整本下载；点 ▼ 展开可只挑这本里的几页（默认都不勾）"; }
        return;
      }
      var hadAll = (SHOWN >= items.length);
      for (var i = 0; i < list2.length; i++) {
        var it2 = list2[i];
        items.push(it2);
        states.push({ it: it2, checked: false, expanded: false, pgrid: null, loading: false, card: null, name: (it2.title || (isTag ? "画廊" : String(it2.id || "作品"))) });
      }
      head.textContent = ((r && r.site === "browsertabs") ? "浏览器标签：共 " : (isTag ? "EH tag 批量：共 " : "作者作品：共 ")) + items.length + " 本　·　勾作品 = 整本下载；点 ▼ 展开可只挑这本里的几页（默认都不勾）";
      if (hadAll) loadMore();   // 之前已经渲染到底了, 新到的直接接上
      else { more.style.display = "none"; }
      updateCount();
    }
    // 不再后台流式拉取: 改成界面上滚到底/点「加载更多」时才向后端要下一批(见 loadMore)
    function loadMore() {
      var end = Math.min(items.length, SHOWN + STEP);
      for (var i = SHOWN; i < end; i++) list.appendChild(renderItem(states[i]));
      SHOWN = end;
      if (SHOWN < items.length) {   // 本地还有没渲染的, 直接渲染
        more.style.display = "";
        more.textContent = "加载更多（还有 " + (items.length - SHOWN) + " 本）";
        askCovers();
        return;
      }
      if (!nextUrl || !DISK.worksMore) { more.style.display = "none"; askCovers(); return; }
      if (loadingMore) { more.style.display = ""; more.textContent = "正在取更多…"; return; }
      loadingMore = true;   // 本地渲染完了 → 向后端要下一批(滚到底或点按钮都会走到这)
      more.style.display = "";
      more.textContent = "正在取更多…";
      DISK.worksMore(nextUrl).then(function (res) {
        loadingMore = false;
        if (res && res.ok && res.galleries && res.galleries.length) {
          nextUrl = res.next || "";
          appendWorks({ galleries: res.galleries });
        } else {
          nextUrl = "";
          more.style.display = "none";
          if (res && res.msg) hint("取更多失败：" + res.msg);
        }
      }).catch(function (e) {
        loadingMore = false; more.style.display = "none";
        hint("取更多失败：" + String(e && e.message || e));
      });
      askCovers();
    }
    more.onclick = loadMore;
    loadMore();

    function setOne(st, v) {
      if (!st.card) return;
      var cb = st.card.querySelector("input");
      if (!cb) return;
      st.checked = v; cb.checked = v;
      st.card.style.background = v ? "#1d2330" : "";
    }
    selAll.onclick = function () { for (var i = 0; i < states.length; i++) setOne(states[i], true); updateCount(); };
    desAll.onclick = function () { for (var i = 0; i < states.length; i++) setOne(states[i], false); updateCount(); };
    revAll.onclick = function () { for (var i = 0; i < states.length; i++) setOne(states[i], !states[i].checked); updateCount(); };
    colAll.onclick = function () {
      states.forEach(function (st) { if (st.pgrid) { try { st.pgrid.el.remove(); } catch (e) {} } st.expanded = false; });
      hint("已收起展开的作品（勾选保留）");
    };

    // 组装要下的作品清单, 交给主进程逐本串行下载
    function runContainerDownload(ones) {
      if (S2.running) { hint("已经有一个下载任务在跑了"); return; }
      var jobs = [];
      for (var i = 0; i < ones.length; i++) {
        var o = ones[i] || {};
        if (!o.url) continue;
        jobs.push({ url: o.url, name: o.name || ("批量作品" + (i + 1)), pages: o.pages || "" });
      }
      if (!jobs.length) { hint("没有可下载的作品"); return; }
      if (!DISK.dlStartBatch) { hint("这个版本不支持容器批量下载，请用最新版书库 App 打开"); return; }
      PVCLOSE();
      if (DISK.worksStop) DISK.worksStop();
      if (DISK.previewKeep) { try { DISK.previewKeep(jobs.map(function (j) { return j.url; })); } catch (e) {} }   // 这几本下载了 → 缓存留着
      list.remove(); more.remove(); toolbar.remove(); head.remove();
      var foot0 = document.getElementById("mfoot");
      if (foot0) foot0.style.display = "flex";
      cancelBtn.textContent = "取消下载";
      cancelBtn.onclick = function () { if (S2.running && DISK.dlBatchCancel) DISK.dlBatchCancel(); };
      S2.running = true; window._dlRunning = true; S2.src = "dl";
      bgBtn.style.display = "";
      bar.style.display = "block"; dlinfo.style.display = "flex"; dlsteps.style.display = "flex"; pct.style.display = "block"; log.style.display = "block";
      var bd3 = document.getElementById("btn-download");
      if (bd3) { bd3.classList.add("running"); bd3.textContent = "下载中…"; }
      goBtn.style.display = "none";
      [ui, ni, fi, ti].forEach(function (x) { x.disabled = true; }); mc.disabled = true;
      var dlinfoL = box.querySelector("#dlinfo span");
      var dlinfoR = box.querySelector("#dlinfo .pct");
      if (dlinfoL) dlinfoL.textContent = "共 " + jobs.length + " 本，正在串行下载";
      var prog = document.createElement("div");
      prog.id = "dlworks";
      prog.style.cssText = "max-height:20vh;overflow-y:auto;font-size:12px;color:#c9ced6;margin:4px 0";
      box.insertBefore(prog, log);
      function line(txt, color) {
        var d = document.createElement("div");
        d.textContent = txt;
        if (color) d.style.color = color;
        prog.appendChild(d);
        prog.scrollTop = prog.scrollHeight;
        while (prog.childNodes.length > 300) prog.removeChild(prog.firstChild);
      }
      window.mangaLib.onDownload(function (ev) {
        if (!ev) return;
        if (ev.type === "batch-start") { line("开始下载 " + ev.total + " 本"); }
        else if (ev.type === "work-start") { line(" " + (ev.index + 1) + "/" + ev.total + "　" + ev.title); if (dlinfoL) dlinfoL.textContent = "第 " + (ev.index + 1) + " / " + ev.total + " 本　" + ev.title; }
        else if (ev.type === "work-done") { line((ev.ok ? " " : "✘ ") + (ev.index + 1) + "/" + ev.total + "　" + ev.title + (ev.ok ? ("　" + (ev.images || 0) + " 张") : "　失败"), ev.ok ? "#8bc98b" : "#e08a8a"); }
        else if (ev.type === "chapter-start") { if (dlinfoL) dlinfoL.textContent = "第 " + ((ev.work || 0) + 1) + " 本：" + ev.label; }
        else if (ev.type === "prog") { bar.style.width = (ev.total ? Math.round((ev.got || 0) / ev.total * 100) : 0) + "%"; if (dlinfoR) dlinfoR.textContent = (ev.got || 0) + " / " + (ev.total || "?") + " 张"; }
        else if (ev.type === "log") { dlLog(S2, "  " + ev.line); }
        else if (ev.type === "done") {
          dlLog(S2, "全部结束：成功 " + ((ev.summary && ev.summary.chapters) || 0) + " 本" + (ev.cancelled ? "（中途取消）" : ""));
          dlDone(S2, true);
        }
        else if (ev.type === "error") { dlLog(S2, "批量结束：" + (ev.message || "错误"), "er"); dlDone(S2, false); }
        else if (ev.type === "cancelled") { dlLog(S2, "已取消", "er"); dlDone(S2, false); }
      });
      DISK.dlStartBatch({ jobs: jobs, from: r.url }).then(function (res) {
        if (!res || !res.ok) { dlLog(S2, "启动失败: " + ((res && res.msg) || "未知错误"), "er"); dlDone(S2, false); }
      });
    }

    var foot2 = document.createElement("div"); foot2.id = "listfoot" + (document.querySelectorAll("[id^=\"listfoot\"]").length + 1); foot2.style.cssText = "margin-top:10px;display:flex;gap:8px;justify-content:flex-end";
    var backBtn = document.createElement("button"); backBtn.className = "btn ghost"; backBtn.textContent = "取消";
    var allBtn = document.createElement("button"); allBtn.className = "btn"; allBtn.textContent = "下载选中";
    foot2.appendChild(backBtn); foot2.appendChild(allBtn);
    box.appendChild(foot2);
    backBtn.onclick = function () { PVCLOSE(); if (DISK.worksStop) DISK.worksStop(); closeModal(); };
    allBtn.onclick = function () {
      var jobs = [];
      for (var i = 0; i < states.length; i++) {
        var st = states[i];
        var pagesStr = st.pgrid ? st.pgrid.picked().join(",") : "";
        if (st.checked || pagesStr) jobs.push({ url: st.it.url, name: st.name, pages: pagesStr });
      }
      if (!jobs.length) { hint("先勾作品（整本），或展开后勾几页"); return; }
      runContainerDownload(jobs);
    };
    updateCount();
  }


  /* ---------- 缩略图懒加载器(下载弹窗内共用) ---------- */
  // 只有真正滚到眼前才请求, 同时最多 4 个; 防盗链图统一走主进程代理(window.mangaLib.dlThumb)
  var PVQ = { pending: [], running: 0, obs: [] };
  function PVWATCH(img, pg, root) {
    if (!img || !pg) return;
    img.setAttribute("data-loaded", "1");
    var px = { img: img, pg: pg };
    var near = (typeof IntersectionObserver === "function" && root && root.isConnected);
    if (!near) { PVQ.pending.push(px); PVQPUMP(); return; }
    var o = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { o.unobserve(en.target); PVQ.pending.push(en.target._px); PVQPUMP(); } });
    }, { root: root, rootMargin: "600px" });   // 提前一屏开始拉
    img._px = px;
    PVQ.obs.push(o);
    o.observe(img);
  }
  function PVQPUMP() {
    while (PVQ.running < 8 && PVQ.pending.length) {   // 并发 8: 主进程那边已有 sprite 缓存+解码缓存, 不怕重复请求
      var t = PVQ.pending.shift();
      if (!t.img.isConnected) continue;
      PVQ.running++;
      (function (img, pg) {
        if (window.mangaLib && window.mangaLib.dlThumb) {
          window.mangaLib.dlThumb({ url: pg.thumb || pg.url, referer: pg.referer || "", pageUrl: pg.pageUrl || "", cl: (typeof pg.cl === "number" ? pg.cl : null), ct: pg.ct || 0, cw: pg.cw || 0, ch: pg.ch || 0, kind: (pg.kind || "page"), w: (pg.w || ""), timeout: 25000 })
            .then(function (res) {
              if (res && res.ok && res.data) { img.src = res.data; img.style.background = "#0d0e10"; PVSPRITE(img, pg); }
              else { img.style.background = "#26282e"; img.title = "缩略图取不到：" + ((res && res.msg) || "未知原因"); }
            })
            .catch(function () { img.style.background = "#26282e"; })
            .finally(function () { PVQ.running--; PVQPUMP(); });
        } else { img.src = pg.thumb || pg.url; PVQ.running--; PVQPUMP(); }
      })(t.img, t.pg);
    }
  }
  // EH 的缩略图是 5 张横拼的 sprite: 同一张图靠 background-position 显示不同格
  var PV_TILE_W = 132;   // 页缩略图固定列宽(px): 不拉伸; 配合放大后的下载弹窗, 宽屏一屏 6 列左右   // 页缩略图固定列宽(px): 不拉伸; 96 能让窄弹窗里刚好排 3 列
  function gridCellW(root) {
    try {
      var c = root && root.querySelector("div");
      var w = c ? Math.round(c.getBoundingClientRect().width) : 0;
      if (w > 80 && w < 400) return w;
    } catch (e) {}
    return 200;
  }
  // 页缩略图统一由主进程裁好再显示, 前端不再自己做 background 裁切
  function PVSPRITE(img, pg) { return; }

  function PVCLOSE() {
    PVQ.pending.length = 0;
    PVQ.obs.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
    PVQ.obs.length = 0;
  }

  // 一个作品的页缩略图网格(容器里点 ▼ 展开后用): 返回 { el, count(), picked() }
  function buildPageGrid(host, r, pages) {
    // 给这一屏的页图打上"属于哪个作品", 便于预览结束后按"是否已选去下载"决定缓存去留
    if (pages && pages.length && !pages[0].w) { for (var pi = 0; pi < pages.length; pi++) pages[pi].w = (r && r.url) || ""; }
    var pageUrl = (r && r.pagePreview && r.pagePreview.pageUrl) || (r && r.url) || "";
    var wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:6px;padding:6px;border:1px solid #2c2f36;border-radius:6px;background:#15161a";
    var tb = document.createElement("div"); tb.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap";
    var sa = document.createElement("button"); sa.className = "btn ghost"; sa.textContent = "全选";
    var da = document.createElement("button"); da.className = "btn ghost"; da.textContent = "全不选";
    var rv = document.createElement("button"); rv.className = "btn ghost"; rv.textContent = "反选";
    var lb = document.createElement("span"); lb.style.cssText = "color:#8f96a0;font-size:12.5px;margin-left:auto";
    tb.appendChild(sa); tb.appendChild(da); tb.appendChild(rv); tb.appendChild(lb);
    wrap.appendChild(tb);
    var g = document.createElement("div");
    g.style.cssText = "display:grid;width:100%;grid-template-columns:repeat(auto-fill," + PV_TILE_W + "px);gap:6px;max-height:42vh;overflow-y:auto;padding:2px;align-content:start;justify-content:start";
    wrap.appendChild(g);
    host.appendChild(wrap);   // 先挂进页面: 否则下面的缩略图会被懒加载判定成「不在页面上」而永远不拉
    var cbs = [], cells = [], last = -1;
    function upd() { var n = 0; for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) n++; lb.textContent = "已选 " + n + " / " + pages.length + " 页"; }
    function mark(i) {
      var c = cells[i]; if (!c) return;
      c.style.outline = cbs[i].checked ? "2px solid #4a7a4a" : "none";
      c.style.opacity = cbs[i].checked ? "1" : ".7";
      c.style.background = cbs[i].checked ? "#1d2330" : "transparent";
    }
    pages.forEach(function (pg, i) {
      // 不建卡片格子: 就是一张缩略图, 勾选框在左上、页码压在右下角
      var cell = document.createElement("div");
      cell.style.cssText = "position:relative;cursor:pointer;border-radius:5px;overflow:hidden;line-height:0";
      var im = document.createElement("img");
      im.alt = "第" + pg.n + "页";
      im.style.cssText = "width:100%;object-fit:contain;background:#0d0e10;border-radius:3px;display:block";
      im.style.height = Math.round(PV_TILE_W * (pg.ch || 300) / (pg.cw || 285)) + "px";   // 高度按真实裁切比例(实测 sprite 格 285x300)
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = false;
      cb.style.cssText = "position:absolute;top:4px;left:4px;z-index:2;margin:0;width:14px;height:14px;cursor:pointer";
      var tx = document.createElement("div");
      tx.style.cssText = "position:absolute;right:3px;bottom:3px;padding:0 4px;font-size:10px;line-height:14px;color:#e6e8ec;background:rgba(0,0,0,.62);border-radius:3px;pointer-events:none;white-space:nowrap";
      tx.textContent = pg.n;
      tx.title = "第 " + pg.n + " 页";
      cell.appendChild(im); cell.appendChild(cb); cell.appendChild(tx);
      cell.onclick = function (ev) {
        if (ev.target === cb) return;
        if (ev.ctrlKey || ev.metaKey) { cb.checked = !cb.checked; }
        else if (ev.shiftKey && last >= 0) {
          var a = Math.min(last, i), b = Math.max(last, i), v = !cb.checked;
          for (var k = a; k <= b; k++) if (cbs[k]) cbs[k].checked = v;
        } else { cb.checked = !cb.checked; }
        last = i;
        for (var k3 = 0; k3 < cbs.length; k3++) mark(k3);
        upd();
      };
      cb.onclick = function (ev) { ev.stopPropagation(); };
      cb.onchange = function () { last = i; mark(i); upd(); };
      cells.push(cell); cbs.push(cb);
      g.appendChild(cell);
      PVWATCH(im, pg, g);
    });
    sa.onclick = function () { for (var i = 0; i < cbs.length; i++) { cbs[i].checked = true; mark(i); } upd(); };
    da.onclick = function () { for (var i = 0; i < cbs.length; i++) { cbs[i].checked = false; mark(i); } upd(); };
    rv.onclick = function () { for (var i = 0; i < cbs.length; i++) { cbs[i].checked = !cbs[i].checked; mark(i); } upd(); };
    upd();
    return {
      el: wrap,
      count: function () { return pages.length; },
      picked: function () { var o = []; for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) o.push(pages[i].n); return o; },
    };
  }

  // 下载前预览(功能5): 一级 = 每页缩略图网格(只有这一层, 页上不再挂箭头)
  // 交互: 复选框 或 点卡片(点选/Ctrl 加减/Shift 范围选); 默认全不勾; 没勾的页不下载
  function showPagePreview(S2, r, later, ui, ni, fi, ti, mc, cancelBtn, goBtn, bgBtn, bar, pct, log) {
    var pv = r.pagePreview;
    var pages = pv.pages || [];
    var box = S2.box;
    box.querySelectorAll("label,input,.sub,.chk,#dlbar,#dlinfo,#dlsteps,#dllog,#mfoot").forEach(function (x) { x.style.display = "none"; });
    var head = document.createElement("div"); head.className = "sub";
    head.textContent = "《" + (r.title || ni.value || "未命名") + "》共 " + pages.length + " 页　·　勾选要下载的页（默认不勾）";
    box.appendChild(head);
    var toolbar = document.createElement("div"); toolbar.style.cssText = "display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap";
    var selAll = document.createElement("button"); selAll.className = "btn ghost"; selAll.textContent = "全选";
    var desAll = document.createElement("button"); desAll.className = "btn ghost"; desAll.textContent = "全不选";
    var revAll = document.createElement("button"); revAll.className = "btn ghost"; revAll.textContent = "反选";
    var countLbl = document.createElement("span"); countLbl.style.cssText = "color:#8f96a0;font-size:12.5px;margin-left:auto";
    toolbar.appendChild(selAll); toolbar.appendChild(desAll); toolbar.appendChild(revAll); toolbar.appendChild(countLbl);
    box.appendChild(toolbar);
    var grid = document.createElement("div");
    grid.style.cssText = "display:grid;width:100%;grid-template-columns:repeat(auto-fill," + PV_TILE_W + "px);gap:8px;justify-content:start;max-height:52vh;overflow-y:auto;padding:4px 2px;align-content:start";
    box.appendChild(grid);
    var cells = [], checks = [], lastIdx = -1;

    function updateCount() {
      var n = 0; for (var i = 0; i < checks.length; i++) if (checks[i].checked) n++;
      countLbl.textContent = "已选 " + n + " / " + pages.length + " 页";
    }
    // 页格子: 缩略图 + 页号 + 复选框; 页这一层不挂箭头(箭头只留给容器里的"作品")
    function buildCell(pg, idx) {
      // 不建格子: 一张缩略图 + 右下角页码 + 左上角勾选框
      var cell = document.createElement("div");
      cell.style.cssText = "position:relative;cursor:pointer;border-radius:5px;overflow:hidden;line-height:0";
      var trow = document.createElement("div"); trow.style.cssText = "position:relative;background:#0d0e10";
      var img = document.createElement("img");
      img.alt = "第" + pg.n + "页";
      img.style.cssText = "width:100%;object-fit:contain;background:#0d0e10;display:block";
      img.style.height = Math.round(PV_TILE_W * (pg.ch || 300) / (pg.cw || 285)) + "px";
      trow.appendChild(img);
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = false;
      cb.style.cssText = "position:absolute;top:4px;left:4px;z-index:2;margin:0;width:14px;height:14px;cursor:pointer";
      trow.appendChild(cb);
      cell.appendChild(trow);
      var lbl = document.createElement("div");
      lbl.style.cssText = "position:absolute;right:3px;bottom:3px;padding:0 4px;font-size:10px;line-height:14px;color:#e6e8ec;background:rgba(0,0,0,.62);border-radius:3px;pointer-events:none;white-space:nowrap";
      lbl.textContent = pg.n;
      lbl.title = "第 " + pg.n + " 页";
      trow.appendChild(lbl);
      bindSelect(cell, cb, idx);
      PVWATCH(img, pg, grid);
      return cell;
    }
    // 统一勾选手势: 点卡片=切换; Ctrl 点=单独切换; Shift 点=从上一次位置范围切换
    function bindSelect(cell, cb, idx) {
      cell.onclick = function (ev) {
        if (ev.target === cb) return;
        if (ev.ctrlKey || ev.metaKey) { cb.checked = !cb.checked; }
        else if (ev.shiftKey && lastIdx >= 0) {
          var a = Math.min(lastIdx, idx), b = Math.max(lastIdx, idx), v = !cb.checked;
          for (var k = a; k <= b; k++) if (checks[k]) checks[k].checked = v;
        } else { cb.checked = !cb.checked; }
        lastIdx = idx; onToggle(idx);
      };
      cb.onclick = function (ev) { ev.stopPropagation(); };
      cb.onchange = function () { lastIdx = idx; onToggle(idx); };
    }
    function onToggle(idx) {
      var cell = cells[idx];
      if (cell) { cell.style.outline = checks[idx].checked ? "2px solid #4a7a4a" : "none"; cell.style.opacity = checks[idx].checked ? "1" : ".7"; }
      updateCount();
    }

    pages.forEach(function (pg, i) { var c = buildCell(pg, i); cells.push(c); checks.push(c.querySelector("input")); grid.appendChild(c); });
    updateCount();
    selAll.onclick = function () { for (var i = 0; i < checks.length; i++) checks[i].checked = true; cells.forEach(function (c, k) { onToggle(k); }); };
    desAll.onclick = function () { for (var i = 0; i < checks.length; i++) checks[i].checked = false; cells.forEach(function (c, k) { onToggle(k); }); };
    revAll.onclick = function () { for (var i = 0; i < checks.length; i++) checks[i].checked = !checks[i].checked; cells.forEach(function (c, k) { onToggle(k); }); };
    var foot2 = document.createElement("div"); foot2.id = "listfoot" + (document.querySelectorAll("[id^=\"listfoot\"]").length + 1); foot2.style.cssText = "margin-top:10px;display:flex;gap:8px;justify-content:flex-end";
    var backBtn = document.createElement("button"); backBtn.className = "btn ghost"; backBtn.textContent = "取消";
    var startBtn = document.createElement("button"); startBtn.className = "btn"; startBtn.textContent = "开始下载选中";
    foot2.appendChild(backBtn); foot2.appendChild(startBtn);
    box.appendChild(foot2);
    backBtn.onclick = function () { closeModal(); };
    startBtn.onclick = function () {
      var picked = [];
      for (var i = 0; i < pages.length; i++) if (checks[i].checked) picked.push(pages[i].n);
      if (!picked.length) { hint("先勾选至少一页（没勾的不会下载）"); return; }
      startBtn.disabled = true; startBtn.textContent = "正在启动…";
      grid.remove(); toolbar.remove(); head.remove(); foot2.remove();
      var foot0 = document.getElementById("mfoot");
      if (foot0) foot0.style.display = "flex";
      cancelBtn.textContent = "取消下载";
      cancelBtn.onclick = function () { if (S2.running) DISK.dlCancel(); };
      S2.running = true; window._dlRunning = true;
      bgBtn.style.display = "";
      bar.style.display = "block"; dlinfo.style.display = "flex"; dlsteps.style.display = "flex"; pct.style.display = "block"; log.style.display = "block";
      var bd3 = document.getElementById("btn-download");
      if (bd3) { bd3.classList.add("running"); bd3.textContent = "下载中…"; }
      goBtn.style.display = "none";
      [ui, ni, fi, ti].forEach(function (x) { x.disabled = true; }); mc.disabled = true;
      var saveName = ni.value.trim() || r.title || "未命名";
      if (DISK.previewKeep) { try { DISK.previewKeep([r.url]); } catch (e) {} }
      DISK.dlStart({ url: r.url, name: saveName, pages: picked.join(",") }).then(function (res) {
        if (!res || !res.ok) {
          if (!S2.running) return;
          dlLog(S2, "启动失败: " + ((res && res.msg) || "未知错误"), "er");
          dlDone(S2, false);
        }
      });
    };
  }


  // 单本书章节勾选窗: chapterList = [{i,title,done}], 默认全选, 可单选多选
  function showChapterPicker(S2, r, cl, ui, ni, st, goBtn, onStart) {
    var box = S2.box;
    box.querySelectorAll("label,input,.sub,.chk,#dlbar,#dlinfo,#dlsteps,#dllog,#mfoot").forEach(function (x) { x.style.display = "none"; });
    var head = document.createElement("div"); head.className = "sub";
    head.textContent = "共 " + cl.length + " 话，勾选要下载的（默认全选；已入库的会自动跳过）"; box.appendChild(head);
    var toolbar = document.createElement("div"); toolbar.style.cssText = "display:flex;gap:8px;align-items:center;margin:6px 0;";
    var selAll = document.createElement("button"); selAll.className = "btn ghost"; selAll.textContent = "全选";
    var desAll = document.createElement("button"); desAll.className = "btn ghost"; desAll.textContent = "全不选";
    var countLbl = document.createElement("span"); countLbl.style.cssText = "color:#8f96a0;font-size:12.5px;margin-left:auto;";
    toolbar.appendChild(selAll); toolbar.appendChild(desAll); toolbar.appendChild(countLbl);
    box.appendChild(toolbar);
    var list = document.createElement("div"); list.style.cssText = "max-height:50vh;overflow-y:auto;border:1px solid #2c2f36;border-radius:6px;padding:6px;";
    box.appendChild(list);
    var checks = [];
    cl.forEach(function (c) {
      var row = document.createElement("label");
      row.style.cssText = "display:flex;gap:8px;align-items:center;padding:4px 6px;cursor:pointer;border-radius:4px;";
      row.onmouseover = function () { row.style.background = "#22242a"; };
      row.onmouseout = function () { row.style.background = ""; };
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !c.done;   // 已入库的默认不勾(避免重复)
      var t = document.createElement("span"); t.style.cssText = "font-size:13px;color:#c9ced6;flex:1;";
      t.textContent = (c.i) + ". " + (c.title || "");
      if (c.done) { t.style.color = "#6b7280"; t.textContent += "  (已入库)"; }
      row.appendChild(cb); row.appendChild(t);
      list.appendChild(row);
      checks.push(cb);
      cb.onchange = updateCount;
    });
    function updateCount() {
      var n = 0; for (var i = 0; i < checks.length; i++) if (checks[i].checked) n++;
      countLbl.textContent = "已选 " + n + " / " + cl.length;
    }
    updateCount();
    selAll.onclick = function () { checks.forEach(function (c) { c.checked = true; }); updateCount(); };
    desAll.onclick = function () { checks.forEach(function (c) { c.checked = false; }); updateCount(); };
    var foot2 = document.createElement("div"); foot2.id = "listfoot" + (document.querySelectorAll("[id^=\"listfoot\"]").length + 1); foot2.style.cssText = "margin-top:10px;display:flex;gap:8px;justify-content:flex-end;justify-content:flex-end";
    var backBtn = document.createElement("button"); backBtn.className = "btn ghost"; backBtn.textContent = "返回";
    var startBtn = document.createElement("button"); startBtn.className = "btn"; startBtn.textContent = "开始下载选中";
    foot2.appendChild(backBtn); foot2.appendChild(startBtn);
    box.appendChild(foot2);
    backBtn.onclick = function () { closeModal(); openDownload("general"); };
    startBtn.onclick = function () {
      var picked = [];
      for (var i = 0; i < cl.length; i++) if (checks[i].checked) picked.push(cl[i].i);
      if (!picked.length) { hint("先勾选至少一话"); return; }
      list.remove(); toolbar.remove(); head.remove(); foot2.remove();
      var foot0 = document.getElementById("mfoot");
      if (foot0) foot0.style.display = "flex";   // 恢复原来的按钮栏(含"取消下载")
      onStart(picked.join(","));
    };
  }

  function buildGeneralPane(box, presetUrl, onResolved) {
      var sub = document.createElement("div"); sub.className = "sub";
      sub.textContent = "粘贴漫画目录页地址，例如 https://www.xmanhua.net/35231xm/"; box.appendChild(sub);

      var l1 = document.createElement("label"); l1.textContent = "漫画地址"; box.appendChild(l1);
      var urlrow = document.createElement("div"); urlrow.style.cssText = "display:flex;gap:8px;align-items:center"; box.appendChild(urlrow);
      var ui = document.createElement("input"); ui.type = "text"; ui.id = "dl-url"; ui.placeholder = "https://www.xmanhua.net/35231xm/"; ui.style.flex = "1"; urlrow.appendChild(ui);
      var pasteBtn = document.createElement("button"); pasteBtn.className = "btn ghost"; pasteBtn.type = "button"; pasteBtn.textContent = "粘贴";
      pasteBtn.title = "读取剪贴板里的链接填进来（也可以直接在地址框右键 → 粘贴）";
      pasteBtn.onclick = async function () {
        try {
          var txt = await navigator.clipboard.readText();
          if (!txt) { hint("剪贴板是空的"); return; }
          var m = String(txt).match(/https?:\/\/[^\s，。、；）)]+/i);   // 从整段抖音口令里提取短链
          ui.value = (m ? m[0] : txt.trim()).replace(/[）)]+$/, ''); ui.focus();
          hint(m ? "已识别剪贴板里的链接" : "已从剪贴板填入");
        } catch (e) { hint("读不到剪贴板，请用 Ctrl+V 或右键粘贴"); }
      };
      urlrow.appendChild(pasteBtn);
      if (presetUrl) {   // 浏览器标签页签送进来的: 自动填好并触发解析(go 还没建好, 所以放到下一拍)
        ui.value = presetUrl;
        setTimeout(function () { try { go.click(); } catch (e) {} }, 80);
      }

      var l2 = document.createElement("label"); l2.textContent = "保存为（留空则自动识别书名）"; box.appendChild(l2);
      var ni = document.createElement("input"); ni.type = "text"; box.appendChild(ni);

      var l3 = document.createElement("label"); l3.textContent = "章节范围（留空 = 全部）"; box.appendChild(l3);
      var rg = document.createElement("div"); rg.style.cssText = "display:flex;gap:8px"; box.appendChild(rg);
      var fi = document.createElement("input"); fi.type = "text"; fi.placeholder = "从"; fi.style.flex = "1";
      var ti = document.createElement("input"); ti.type = "text"; ti.placeholder = "到"; ti.style.flex = "1";
      rg.appendChild(fi); rg.appendChild(ti);

      var pvRow = document.createElement("label"); pvRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer";
      var pvChk = document.createElement("input"); pvChk.type = "checkbox"; pvChk.style.width = "auto"; pvChk.checked = SET.dlPreview === true;
      pvChk.onchange = function () { SET.dlPreview = pvChk.checked; try { localStorage.setItem('shelfSettings', JSON.stringify(SET)); } catch (e) {} };
      pvRow.appendChild(pvChk);
      var pvTxt = document.createElement("span"); pvTxt.textContent = "下载前预览缩略图（勾选后可只下载需要的页）"; pvRow.appendChild(pvTxt);
      box.appendChild(pvRow);

      var mg = document.createElement("label");
      mg.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer";
      var mc = document.createElement("input"); mc.type = "checkbox"; mc.id = "dl-merge"; mc.style.width = "auto";
      var mt2 = document.createElement("span"); mt2.textContent = "把这本书的所有图片合并到一个文件夹（不按话分文件夹）";
      mg.appendChild(mc); mg.appendChild(mt2); box.appendChild(mg);

      var st = document.createElement("div"); st.className = "stat"; st.style.display = "none"; box.appendChild(st);
      var bar = document.createElement("div"); bar.id = "dlbar"; bar.style.display = "none";
      var bi = document.createElement("i"); bar.appendChild(bi); box.appendChild(bar);
      var dlinfo = document.createElement("div"); dlinfo.id = "dlinfo"; dlinfo.style.display = "none";
      var dlinfoL = document.createElement("span"); dlinfoL.textContent = "";
      var dlinfoR = document.createElement("span"); dlinfoR.className = "pct";
      dlinfo.appendChild(dlinfoL); dlinfo.appendChild(dlinfoR); box.appendChild(dlinfo);
      var dlsteps = document.createElement("div"); dlsteps.id = "dlsteps"; dlsteps.style.display = "none";
      var steps = ["数页数","取地址","下载图片","整理"];
      var stepEls = [];
      for (var si = 0; si < steps.length; si++) {
        var sp = document.createElement("span");
        var sb = document.createElement("b");
        sp.appendChild(sb); sp.appendChild(document.createTextNode(steps[si]));
        dlsteps.appendChild(sp); stepEls.push(sp);
      }
      box.appendChild(dlsteps);
      var pct = document.createElement("div"); pct.className = "stat"; pct.style.display = "none"; box.appendChild(pct);
      var log = document.createElement("div"); log.id = "dllog"; log.style.display = "none"; box.appendChild(log);

      var foot = document.createElement("div"); foot.id = "mfoot"; box.appendChild(foot);
      var cancel = document.createElement("button"); cancel.className = "btn ghost"; cancel.textContent = "取消";
      var go = document.createElement("button"); go.className = "btn"; go.textContent = "开始下载";
      foot.appendChild(cancel); foot.appendChild(go);

      var S2 = { box: box, bar: bi, pct: pct, log: log, head: st, foot: foot, btnCancel: cancel, btnGo: go,
                 running: false, total: 0, doneCh: 0, imgs: 0, bytes: 0,
                 dlinfoL: dlinfoL, dlinfoR: dlinfoR, stepEls: stepEls };
      // "后台运行"按钮必须先建好再加进按钮栏: 下面的恢复块要用到它, 建晚了会抛错把整个面板打断
      var bg = document.createElement("button"); bg.className = "btn ghost"; bg.textContent = "后台运行";
      bg.style.display = "none";
      bg.onclick = function () { if (S2.running) runInBackground(); else closeModal(); };
      foot.appendChild(bg);

      // 切成"下载中"的样子: 进度条 / 阶段 / 日志全部显示出来, 按钮换成 取消下载 + 后台运行
      function attachRunning(data, src) {
        S2.running = true; window._dlRunning = true;   // 不置回 running, 后面的进度事件会被整段丢掉
        S2.src = src || S2.src || "dl";                // 通用下载 / 禁漫任务的取消接口不一样, 得记住是哪一个
        if (data) {
          S2.total = data.total || 0; S2.doneCh = data.doneCh || 0; S2.imgs = data.imgs || 0; S2.bytes = data.bytes || 0;
          if (data.head) S2.head.textContent = data.head;
          if (data.barWidth) S2.bar.style.width = data.barWidth;
          if (data.infoL) S2.dlinfoL.textContent = data.infoL;
          if (data.infoR) S2.dlinfoR.textContent = data.infoR;
          if (data.pct) S2.pct.textContent = data.pct;
          if (data.stepIdx >= 0) {
            // 步骤条类名与 dlSetStage 保持一致(ok / now), 不再往里塞 ✓ 文字
            for (var sj = 0; sj < S2.stepEls.length; sj++) S2.stepEls[sj].className = sj < data.stepIdx ? "ok" : (sj === data.stepIdx ? "now" : "");
          }
          if (data.logHTML) S2.log.innerHTML = data.logHTML;
        }
        if (!S2.head.textContent) S2.head.textContent = "下载进行中…";
        bar.style.display = "block";
        dlinfo.style.display = "flex";
        dlsteps.style.display = "flex";
        pct.style.display = "block";
        log.style.display = "block";
        st.style.display = "block";
        cancel.textContent = "取消下载";
        go.style.display = "none";
        bg.style.display = "";
        [ui, ni, fi, ti].forEach(function (x) { x.disabled = true; }); mc.disabled = true;
        // 日志跟到最新一行: 重开后停在原地, 就是"不自动跟随"的原因
        var follow = function () { log.scrollTop = log.scrollHeight; };
        follow(); setTimeout(follow, 30); setTimeout(follow, 150);
        dlSnap(S2);
      }

      dlState = S2;
      // 后台运行后又点顶栏「下载中…」: 用快照把进度条 / 阶段 / 日志原样接回来
      if (window._dlRunning) attachRunning(window._dlProgress || {});
      // 渲染层没在跟踪(刷新过窗口, 或任务是从禁漫页起的): 问后端还在不在跑, 在跑就现场接上
      else if (DISK && (DISK.dlBusy || DISK.jmBusy)) {
        Promise.resolve()
          .then(function () { return DISK.dlBusy ? DISK.dlBusy() : false; })
          .then(function (dlBusy) {
            if (dlBusy) return "dl";
            if (!DISK.jmBusy) return null;
            return Promise.resolve(DISK.jmBusy()).then(function (jmBusy) { return jmBusy ? "jm" : null; });
          })
          .then(function (src) { if (src && !S2.running && S2.box.isConnected) attachRunning(null, src); })
          .catch(function () {});
      }

      cancel.onclick = function () {
        if (!S2.running) { closeModal(); return; }
        if (S2.src === "jm") { if (DISK.jmCancel) DISK.jmCancel(); }
        else DISK.dlCancel();
      };
      [ui, ni, fi, ti].forEach(function (x) { x.onkeydown = function (ev) { ev.stopPropagation(); }; });
      mc.onkeydown = function (ev) { ev.stopPropagation(); };

      go.onclick = async function () {
        var raw = ui.value.trim();
        var um = raw.match(/https?:\/\/[^\s，。、；）)]+/i);   // 容忍整段口令, 从中提取链接
        var url = (um ? um[0] : raw).replace(/[）)]+$/, '');
        if (!url) { hint("请填写漫画地址"); return; }
        go.disabled = true; go.textContent = "解析中…";
        st.style.display = "block"; st.textContent = "正在解析地址…";
        var r = await DISK.dlResolve(url);
        if (!r || !r.ok) {
          st.textContent = "解析失败：" + ((r && r.msg) || "未知错误");
          go.disabled = false; go.textContent = "开始下载";
          if (onResolved) { try { onResolved(r); } catch (e) {} }
          return;
        }
        if (onResolved) { try { onResolved(r); } catch (e) {} }
        // 下载前预览(功能5): 单本链接把每一页的缩略图摆出来, 勾选后只下勾选的页
        if (SET.dlPreview === true && r.pagePreview && r.pagePreview.pages && r.pagePreview.pages.length) {
          showPagePreview(S2, r, setTimeout, ui, ni, fi, ti, mc, cancel, go, bg, bar, pct, log);
          return;
        }
        // 批量选择: EH tag 画廊列表 或 pixiv 用户作品列表
        var items = r.galleries || r.pickList;
        if (items && items.length) {
          if (SET.dlPreview === true) { showWorkList(S2, r, items, ui, ni, fi, ti, mc, cancel, go, bg, bar, pct, log); } else { showPickList(S2, r, items, ui, ni, fi, ti, mc, cancel, go, bg, bar, pct, log); }
          return;
        }
        if (!ni.value.trim()) ni.value = r.title;
        st.textContent = "识别为「" + r.title + "」　→　保存到 " + ni.value.trim();
        go.disabled = false; go.textContent = "开始下载";
        // 真正启动下载: chaptersArg 为勾选的话序号 "1,3,5", 不传则下全部
        async function doStart(chaptersArg) {
          go.disabled = true; go.textContent = "下载中…";
          cancel.textContent = "取消下载";
          S2.running = true; window._dlRunning = true;
          bg.style.display = "";
          var bd3 = document.getElementById("btn-download");
          if (bd3) { bd3.classList.add("running"); bd3.textContent = "下载中…"; }
          bar.style.display = "block"; dlinfo.style.display = "flex"; dlsteps.style.display = "flex"; pct.style.display = "block"; log.style.display = "block";
          [ui, ni, fi, ti].forEach(function (x) { x.disabled = true; }); mc.disabled = true;
          var res = await DISK.dlStart({ url: r.url, name: ni.value.trim(), from: fi.value, to: ti.value, chapters: chaptersArg || '', merge: !!mc.checked });
          if (!res || !res.ok) {
            if (!S2.running) return;
            dlLog(S2, "启动失败: " + ((res && res.msg) || "未知错误"), "er");
            dlDone(S2, false);
            return;
          }
          if (res.dir && LIBRARY) {
            var ne = libEntry(res.dir);
            ne.source = { site: hostOf(r.url || ""), url: r.url || "" };
            if (r.desc) ne.desc = r.desc;
            libSave();
          }
        }
        // 多话书: 弹章节勾选窗, 可单选多选, 默认全选
        var cl = r.chapterList;
        if (cl && cl.length > 1) {
          go.onclick = function () { showChapterPicker(S2, r, cl, ui, ni, st, go, doStart); };
        } else {
          go.onclick = function () { doStart(''); };
        }
      };
      setTimeout(function () { ui.focus(); }, 40);
  }

  // 下载漫画: 一个弹窗两个标签页(通用链接 / 禁漫天堂)
  /* ---------- 跨站搜索(只搜正经漫画站) ---------- */
  var SS_SITES = [
    { id: "zaimanhua", n: "再漫画" },
    { id: "komiic", n: "Komiic" },
    { id: "nhentai", n: "nhentai" },
    { id: "ehentai", n: "E-Hentai" },
    { id: "pixiv", n: "Pixiv" },
  ];   // 有 search() 的适配器
  function quickDownload(url) {
    closeModal();
    openDownload("general");
    setTimeout(function () {
      var el2 = document.getElementById("dl-url");
      if (el2) { el2.value = url; hint("地址已填好，点「开始下载」即可"); }
      else hint("把地址贴进下载框: " + url);
    }, 120);
  }
  function openSiteSearch(prefill) {
    if (!DISK || !DISK.siteSearch) { hint("跨站搜索需要桌面版：请用「启动书库.cmd」打开"); return; }
    showModal(function (box) {
      var h = document.createElement("h3"); h.textContent = "跨站搜索"; box.appendChild(h);
      var sub = document.createElement("div"); sub.className = "sub";
      sub.textContent = "同一个作品会归成一组，用哪一版由你自己勾。";
      box.appendChild(sub);
      var l1 = document.createElement("label"); l1.textContent = "关键词（中文 / 日文 / 英文都行，会自动做别名扩展）"; box.appendChild(l1);
      var kw = document.createElement("input"); kw.type = "text"; kw.id = "ss-kw"; kw.value = String(prefill || ""); box.appendChild(kw);
      var l2 = document.createElement("label"); l2.textContent = "搜哪些站"; box.appendChild(l2);
      var wrap = document.createElement("div"); wrap.style.cssText = "display:flex;gap:14px;flex-wrap:wrap;margin:2px 0 10px";
      var picked = {};
      SS_SITES.forEach(function (s2) {
        var lab = document.createElement("label"); lab.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer";
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.style.width = "auto";
        var sp = document.createElement("span"); sp.textContent = s2.n;
        picked[s2.id] = cb;
        lab.appendChild(cb); lab.appendChild(sp); wrap.appendChild(lab);
      });
      box.appendChild(wrap);
      var out = document.createElement("div"); out.id = "ss-out"; out.style.cssText = "max-height:46vh;overflow:auto";
      box.appendChild(out);
      var foot = document.createElement("div"); foot.className = "mfoot";
      var close = document.createElement("button"); close.className = "btn ghost"; close.textContent = "关闭";
      close.onclick = closeModal;
      var go = document.createElement("button"); go.className = "btn"; go.textContent = "搜索";
      foot.appendChild(close); foot.appendChild(go); box.appendChild(foot);
      var run = async function () {
        var k = kw.value.trim();
        if (!k) { hint("先填关键词"); return; }
        var sites = Object.keys(picked).filter(function (id) { return picked[id].checked; }).join(",");
        if (!sites) { hint("至少选一个站"); return; }
        out.innerHTML = '<div class="sub">正在搜 ' + k + ' …</div>';
        go.disabled = true;
        var r = null;
        try { r = await DISK.siteSearch(k, sites); } catch (e) { r = { ok: false, msg: String(e && e.message ? e.message : e) }; }
        go.disabled = false;
        out.innerHTML = "";
        if (!r || !r.ok) { out.innerHTML = '<div class="sub">搜索失败：' + ((r && r.msg) || "未知错误") + "</div>"; return; }
        var info = document.createElement("div"); info.className = "sub";
        info.textContent = "搜「" + r.keyword + "」(实际用: " + (r.used || []).join(" / ") + ") → " + r.total + " 条，归成 " + r.groups.length + " 组";
        out.appendChild(info);
        if (r.errors && r.errors.length) { var er = document.createElement("div"); er.className = "sub"; er.style.color = "#e08a8a"; er.textContent = r.errors.join(" ; "); out.appendChild(er); }
        r.groups.forEach(function (g) {
          var gh = document.createElement("div"); gh.className = "ahead"; gh.textContent = g.name + "（" + g.items.length + " 个站点版本）"; out.appendChild(gh);
          g.items.forEach(function (it) {
            var row = document.createElement("div"); row.style.cssText = "display:flex;gap:10px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid #26282e";
            var cb = document.createElement("input"); cb.type = "checkbox"; cb.style.cssText = "width:auto;margin-top:4px";
            var cv = document.createElement("div");
            cv.style.cssText = "width:54px;height:72px;flex:0 0 auto;background:#0d0e10;border-radius:4px;overflow:hidden";
            if (it.cover) { var im = document.createElement("img"); im.src = encodeURI(it.cover).split("#").join("%23"); im.style.cssText = "width:100%;height:100%;object-fit:cover"; im.onerror = function () { this.style.display = "none"; }; cv.appendChild(im); }
            var tx = document.createElement("div"); tx.style.cssText = "flex:1;min-width:0";
            var t1 = document.createElement("div"); t1.style.cssText = "font-size:13px;color:#e6e8ec;word-break:break-all"; t1.textContent = it.title;
            var t2 = document.createElement("div"); t2.className = "sub"; t2.style.margin = "2px 0 0";
            t2.textContent = [it.label, it.author, it.extra, it.inLib ? "已在库中" : ""].filter(Boolean).join(" · ");
            tx.appendChild(t1); tx.appendChild(t2);
            var dl = document.createElement("button"); dl.className = "btn ghost"; dl.textContent = "下载";
            dl.onclick = function () { quickDownload(it.url); };
            row.appendChild(cb); row.appendChild(cv); row.appendChild(tx); row.appendChild(dl);
            out.appendChild(row);
          });
        });
        if (!r.groups.length) out.innerHTML += '<div class="sub">没有结果。换个关键词，或者试试日文/英文名。</div>';
      };
      go.onclick = run;
      kw.onkeydown = function (ev) { ev.stopPropagation(); if (ev.key === "Enter") run(); };
      setTimeout(function () { try { kw.focus(); } catch (e) {} }, 100);
    });
  }
  function openDownload(tab) {
    if (!DISK) { hint("下载功能需要桌面版"); return; }
    showModal(function (box) {
      var mbd = box.closest("#mbox"); if (mbd) mbd.classList.add("dlg");   // 下载弹窗放大: 页缩略图才排得下多列
    var h = document.createElement("h3"); h.textContent = "下载漫画"; box.appendChild(h);
      var bar = document.createElement("div"); bar.id = "dltabs";
      var pane = document.createElement("div"); pane.id = "dlpane";
      var t1 = document.createElement("button"); t1.className = "tab"; t1.textContent = "通用链接";
      var t2 = document.createElement("button"); t2.className = "tab"; t2.textContent = "禁漫天堂";
      var t3 = document.createElement("button"); t3.className = "tab"; t3.textContent = "浏览器标签";
      t1.title = "任意适配站点的目录页链接（再漫画 / 戰姬求生記 等）";
      t2.title = "18comic：图片直取、逐话下载、切页校验、入库";
      t3.title = "从浏览器（open-chrome.mjs 启动的那个，带 9333 端口）收下正在看的作品页";
      bar.appendChild(t1); bar.appendChild(t2); bar.appendChild(t3);
      box.appendChild(bar); box.appendChild(pane);
      function show(k, presetUrl, onResolved) {
        JM_LOGEL = null;                       // 离开禁漫页就不再往旧日志节点写
        t1.classList.toggle("on", k === "general");
        t2.classList.toggle("on", k === "jm");
        t3.classList.toggle("on", k === "browser");
        pane.innerHTML = "";
        if (k === "jm") buildJmPane(pane);
        else if (k === "browser") buildBrowserPane(pane, presetUrl, onResolved);
        else buildGeneralPane(pane, presetUrl, onResolved);
      }
      // 浏览器标签: 收下当前页(解析成功就关掉那个标签) / 列出开着的标签 / 刷新状态
      function buildBrowserPane(box, presetUrl, onResolved) {
        var sub = document.createElement("div"); sub.className = "sub";
        sub.textContent = "从浏览器收下作品页：收下即解析（标题/页数/封面），解析成功就顺手关掉那个标签。";
        box.appendChild(sub);
        var stat = document.createElement("div"); stat.className = "sub"; stat.style.marginTop = "8px";
        stat.textContent = "正在读浏览器标签…"; box.appendChild(stat);
        var row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:12px 0";
        function mk(txt, tip, fn) { var b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = txt; b.title = tip; b.onclick = fn; row.appendChild(b); return b; }
                mk("收下这一页", "读你浏览器里正在看的那一页：解析这一本 → 追加进本页签的待挑列表 → 关掉那个标签", function () {
          stat.textContent = "正在找你在看的那一个标签…";
          Promise.resolve(DISK.tabsCurrent()).then(function (c) {
            if (!c || !c.ok) { stat.textContent = "没找到：" + ((c && c.msg) || "未知错误"); return; }
            var t = c.tab;
            if (!t || !t.work) { stat.textContent = "这个标签不是作品页（" + String((t && t.title) || "").slice(0, 30) + "），没有动它"; return; }
            stat.textContent = "正在收下：" + String(t.title).slice(0, 32) + " …";
            Promise.resolve(DISK.dlResolve(t.url)).then(function (rr) {
              if (!rr || !rr.ok) { stat.textContent = "解析失败，标签保留：" + ((rr && rr.msg) || ""); return; }
              var pg = (rr.pagePreview && rr.pagePreview.pages && rr.pagePreview.pages[0]) || null;
              var im = t.url.match(/\/(?:g|artworks)\/(\d+)/);
              var item = {
                title: rr.title || String(t.title).slice(0, 60), url: t.url, id: im ? im[1] : "",
                thumb: rr.cover || (pg && pg.thumb) || "", extra: rr.status || ""
              };
              if (pg) { item.cl = (typeof pg.cl === "number") ? pg.cl : null; item.ct = pg.ct || 0; item.cw = pg.cw || 0; item.ch = pg.ch || 0; }
              return Promise.resolve(DISK.tabsPendingAdd(item)).then(function (ar) {
                return Promise.resolve(DISK.tabsClose(t.id)).then(function (cr) {
                  hint("已收下" + (cr && cr.ok ? "并关掉那个标签" : "（关标签失败）") + "，待挑列表 " + ((ar && ar.count) || "?") + " 本");
                  show("browser");
                });
              });
            }).catch(function (e) { stat.textContent = "出错：" + String(e); });
          }).catch(function (e) { stat.textContent = "出错：" + String(e); });
        });
        mk("关闭这一页", "把你现在浏览器里正在看的这一页直接关掉（不收、不下载）—— 快速跳过不想要的那本", function () {
          stat.textContent = "正在找你在看的那一个标签…";
          Promise.resolve(DISK.tabsCurrent()).then(function (c) {
            if (!c || !c.ok) { stat.textContent = "没找到：" + ((c && c.msg) || "未知错误"); return; }
            var t = c.tab;
            if (!t) { stat.textContent = "没找到正在看的标签"; return; }
            Promise.resolve(DISK.tabsClose(t.id)).then(function (cr) {
              hint(cr && cr.ok ? ("已关闭：" + String(t.title).slice(0, 34)) : "关标签失败");
              stat.textContent = "已关闭那一页（没有收下）";
              setTimeout(refresh, 500);
            });
          }).catch(function (e) { stat.textContent = "出错：" + String(e); });
        });
        mk("清空列表", "把待挑列表清空（已经下载成功的会自己移出，不用管）", function () {
          Promise.resolve(DISK.tabsPendingClear()).then(function () { hint("待挑列表已清空"); show("browser"); });
        });
mk("列出开着的标签", "把浏览器里开着的作品页一次性收进待挑列表（封面和页数一起取好，约 7 秒）", function () {
          hint("正在收集浏览器标签…（容器页会跳过，请单独粘到通用链接）");
          show("browser", "browsertabs:list");   // 就在本页签下面出列表, 按钮留在上面
        });
        mk("刷新状态", "重新读一次浏览器标签（看连上没、有多少作品页）", function () { refresh(); });
        box.appendChild(row);
        var tip = document.createElement("div"); tip.className = "sub";
        tip.textContent = "注意：pixiv 作者主页 / EH tag 这类「容器页」标签不在这里收（它们会展开成上百本），请用「通用链接」粘贴。";
        box.appendChild(tip);
        if (presetUrl) {
          var listBox = document.createElement("div");
          listBox.style.cssText = "border-top:1px solid #2a2d33;margin-top:12px;padding-top:10px";
          box.appendChild(listBox);
          buildGeneralPane(listBox, presetUrl, onResolved);
        } else if (DISK.tabsPending) {
          // 无 preset = 首次打开 / 收下后重铺 / 清空后重铺: 直接把待挑列表铺在按钮下面
          DISK.tabsPending().then(function (pr) {
            var items = (pr && pr.items) || [];
            var lb = document.createElement("div");
            lb.style.cssText = "border-top:1px solid #2a2d33;margin-top:12px;padding-top:10px";
            box.appendChild(lb);
            if (!items.length) {
              lb.className = "sub";
              lb.textContent = "待挑列表是空的：点上面「收下这一页」或「列出开着的标签」往里加。";
              return;
            }
            buildGeneralPane(lb, "browsertabs:pending", null);
          });
        }
        function refresh() {
          Promise.resolve(DISK.tabsList()).then(function (r) {
            if (!r || !r.ok) { stat.textContent = "没连上浏览器：" + ((r && r.msg) || ""); return; }
            stat.textContent = "已连上浏览器（" + r.tabs.length + " 个标签，其中作品页 " + r.作品页 + " 个）";
          }).catch(function (e) { stat.textContent = "读标签出错：" + String(e); });
        }
        refresh();
      }
      t1.onclick = function () { show("general"); };
      t2.onclick = function () { show("jm"); };
      t3.onclick = function () { show("browser"); };
      show(tab === "jm" ? "jm" : "general");
    });
  }

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
  var NAVFWD = [];
  function reopenLast() {
    while (NAVFWD.length) {
      var dir = NAVFWD.pop();
      for (var i = 0; i < COMICS.length; i++) {
        if (COMICS[i].dir === dir) { openComic(COMICS[i]); hint("回到：" + (COMICS[i].name || dir)); return true; }
      }
    }
    return false;
  }
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

  function cur() { return comic ? comic.chapters[S.ci] : null; }
  function clamp() { var n = pages().length; if (!n) { S.pi = 0; return; } if (S.pi < 0) S.pi = 0; if (S.pi > n - 1) S.pi = n - 1; }

  var bmJump = false, bmDir = null, bmAt = null;   // 书签跳转: 跳转期间及停留期间都不写进度
  function save() {
    if (!comic) return;
    if (bmJump) return;                                                     // 跳转过程本身
    if (bmDir === comic.dir && bmAt && S.ci === bmAt.ci && S.pi === bmAt.pi) return;   // 还停在书签那一页 -> 不动历史
    if (bmDir === comic.dir) { bmDir = null; bmAt = null; }                  // 已翻走 -> 恢复正常记录
    var chNow = comic.chapters[S.ci] || {};
    setProg(comic.dir, { ci: S.ci, pi: S.pi, mode: S.mode, fit: S.fit, dir: S.dir, cover: S.cover, sidebar: S.sidebar, wheel: S.wheel, thumbs: S.thumbs, rev: !!S.rev, prevRev: !!S.prevRev, cpath: chNow.path || "" });
    var m = meta(); m["t::" + comic.dir] = Date.now(); setMeta(m);
  }

  /* ---------- 预览栏右键菜单: 删除这一张图 ---------- */
  function imgFile(ch, idx) {                 // 第 idx 页在书里的相对路径
    if (!ch) return "";
    if (ch.files) return ch.files[idx] === undefined ? "" : ch.files[idx];
    var dp = ch.path !== undefined ? ch.path : (ch.name || "");
    var s = String(idx + 1); while (s.length < ch.pad) s = "0" + s;
    return (dp ? dp + "/" : "") + s + ch.ext;
  }
  function showImgCtx(x, y, idx) {
    if (!comic) return;
    var ch = comic.chapters[S.ci];
    var f = imgFile(ch, idx);
    fillCtx([
      { t: " 设为本书封面", f: function () {
          var e = libEntry(comic.dir);
          if (!e) { hint("需要桌面版才能保存封面"); return; }
          e.coverOverride = { ci: S.ci, pi: idx };
          if (DISK && DISK.saveLibrary) { try { DISK.saveLibrary(LIBRARY); } catch (err) {} }
          invalidateCard(comic.dir); renderShelf();
          hint("已设为本书封面");
        } },
      { t: " 在文件夹中打开", f: function () {
          if (!DISK || !DISK.reveal || !LIBROOT || !f) { hint("仅桌面版支持"); return; }
          var dir = f.indexOf("/") >= 0 ? f.slice(0, f.lastIndexOf("/")) : "";
          DISK.reveal(LIBROOT + "\\" + comic.dir + (dir ? "\\" + dir.replace(/\//g, "\\") : ""));
        } },
      { t: " 删除这张图（含文件）", f: function () { delImage(idx); } }
    ], x, y);
  }
  async function delImage(idx) {
    if (!comic) return;
    var ch = comic.chapters[S.ci];
    if (!ch) return;
    var f = imgFile(ch, idx);
    if (!f) { hint("找不到这张图的文件名"); return; }
    if (!DISK || !DISK.deleteImage) { hint("删除图片需要桌面版：请用「启动书库.cmd」打开"); return; }
    hint("正在删除…");
    var r = null;
    try { r = await DISK.deleteImage(comic.dir, f); } catch (e) { r = { ok: false, msg: String(e && e.message ? e.message : e) }; }
    if (!r || !r.ok) { hint("删除失败: " + ((r && r.msg) || "未知错误")); return; }
    if (ch.files) ch.files.splice(idx, 1); else ch.n = Math.max(0, (ch.n || 1) - 1);
    if (!nOf(ch)) {                                  // 这一话被删空了, 顺手去掉这一话
      comic.chapters.splice(S.ci, 1);
      S.ci = Math.max(0, Math.min(S.ci, comic.chapters.length - 1));
    }
    S.pi = Math.max(0, Math.min(S.pi, Math.max(0, nOf(comic.chapters[S.ci] || {}) - 1)));
    applyThumbs(); renderChapters(); render();
    hint("已删除这张图" + (r.renamed ? "（剩余图片已重排编号）" : ""));
    if (DISK.rescan) { try { await DISK.rescan({ quiet: true, offline: true }); } catch (e2) {} }
  }

  /* ---------- 管理图包: 批量删除单张图片 ---------- */
  function openImageManager(dir) {
    var c = null;
    for (var i = 0; i < COMICS.length; i++) { if (COMICS[i].dir === dir) { c = COMICS[i]; break; } }
    if (!c) { hint("库里找不到这本书"); return; }
    if (!DISK || !DISK.deleteImage) { hint("需要桌面版（重启 App 后可用）"); return; }

    var allImgs = [];
    for (var ci = 0; ci < c.chapters.length; ci++) {
      var ch = c.chapters[ci];
      var pl = pageList(c, ch);
      var cl = chLabel(ch) || ("第" + (ci+1) + "话");
      for (var pi = 0; pi < pl.length; pi++) {
        allImgs.push({ ci: ci, pi: pi, url: enc(pl[pi]), label: cl + " · " + (pi + 1) });
      }
    }
    if (!allImgs.length) { hint("这本书没有图片"); return; }

    var selected = new Set();
    var lastClickIdx = -1;

    showModal(function (box) {
      box.style.cssText = "display:flex;flex-direction:column;width:92vw;height:86vh;max-width:1400px;position:relative;padding-bottom:60px;";

      var head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:6px 2px 10px;";
      var h = document.createElement("h3"); h.textContent = "管理图包 · " + (c.name || dir); h.style.cssText = "margin:0;";
      var cnt = document.createElement("span"); cnt.className = "sub"; cnt.style.cssText = "font-size:13px;";
      cnt.textContent = allImgs.length + " 张";
      head.appendChild(h); head.appendChild(cnt);
      box.appendChild(head);

      var grid = document.createElement("div");
      grid.style.cssText = "flex:1;min-height:0;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px;padding:4px 2px;align-content:flex-start;";
      box.appendChild(grid);

      var items = [];
      for (var k = 0; k < allImgs.length; k++) {
        (function (idx, info) {
          var cell = document.createElement("div");
          cell.style.cssText = "position:relative;width:125px;height:180px;flex-shrink:0;cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid transparent;transition:border-color .15s;";
          var im = document.createElement("img");
          im.dataset.src = info.url; im.decoding = "async"; im.alt = ""; im.style.background = "#1a1a1a"; im.onerror = function(){ this.style.background = "#222"; };
          im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
          var lab = document.createElement("div");
          lab.style.cssText = "position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:10px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          lab.textContent = info.label;
          cell.appendChild(im); cell.appendChild(lab);
          grid.appendChild(cell);
          items.push(cell);

          (function(imgEl){
            if (!("IntersectionObserver" in window)) { imgEl.src = imgEl.dataset.src; return; }
            var io = new IntersectionObserver(function(entries, obs){
              entries.forEach(function(en){
                if (en.isIntersecting) { imgEl.src = imgEl.dataset.src; obs.unobserve(imgEl); }
              });
            }, { root: null, rootMargin: "300px 0px", threshold: 0.01 });
            io.observe(imgEl);
          })(im);

          cell.onclick = function (ev) {
            if (ev.shiftKey && lastClickIdx >= 0) {
              var a = Math.min(lastClickIdx, idx), b = Math.max(lastClickIdx, idx);
              for (var j = a; j <= b; j++) { selected.add(j); items[j].style.borderColor = "var(--accent,#e55)"; }
            } else if (ev.ctrlKey || ev.metaKey) {
              if (selected.has(idx)) { selected.delete(idx); cell.style.borderColor = "transparent"; }
              else { selected.add(idx); cell.style.borderColor = "var(--accent,#e55)"; }
            } else {
              if (selected.has(idx)) { selected.delete(idx); cell.style.borderColor = "transparent"; }
              else { selected.add(idx); cell.style.borderColor = "var(--accent,#e55)"; }
            }
            lastClickIdx = idx;
            cnt.textContent = allImgs.length + " 张 · 已选 " + selected.size;
            okBtn.textContent = "确认删除选中 " + selected.size + " 张";
          };
        })(k, allImgs[k]);
      }

      var foot = document.createElement("div");
      foot.style.cssText = "display:flex;justify-content:flex-end;gap:10px;padding:10px 22px;border-top:1px solid var(--border2);position:absolute;bottom:0;left:0;right:0;background:var(--card-bg);";
      var cancelBtn = document.createElement("button"); cancelBtn.className = "btn ghost"; cancelBtn.textContent = "取消";
      var clearBtn = document.createElement("button"); clearBtn.className = "btn ghost"; clearBtn.textContent = "取消选择";
      var okBtn = document.createElement("button"); okBtn.className = "btn"; okBtn.textContent = "确认删除";
      foot.appendChild(cancelBtn); foot.appendChild(clearBtn); foot.appendChild(okBtn);
      box.appendChild(foot);

      cancelBtn.onclick = closeModal;
      clearBtn.onclick = function () {
        selected.clear();
        items.forEach(function(el){ el.style.borderColor = "transparent"; });
        cnt.textContent = allImgs.length + " 张";
        okBtn.textContent = "确认删除";
      };
      okBtn.onclick = async function () {
        if (!selected.size) { hint("先选择要删除的图片"); return; }
        var n = selected.size;
        // 直接删除, 不弹确认
        okBtn.disabled = true; okBtn.textContent = "正在删除…";

        var byCh = {};
        selected.forEach(function (idx) {
          var info = allImgs[idx];
          if (!byCh[info.ci]) byCh[info.ci] = [];
          byCh[info.ci].push(info.pi);
        });

        var okCount = 0, failCount = 0;
        var chs = Object.keys(byCh).map(Number).sort(function (a,b){return b-a;});
        for (var ci2 = 0; ci2 < chs.length; ci2++) {
          var chIdx = chs[ci2];
          var pis = byCh[chIdx].sort(function(a,b){return b-a;});
          var chObj = c.chapters[chIdx];
          if (!chObj) continue;
          for (var pi2 = 0; pi2 < pis.length; pi2++) {
            var rel = imgFile(chObj, pis[pi2]);
            if (!rel) { failCount++; continue; }
            try {
              var r = await DISK.deleteImage(dir, rel);
              if (r && r.ok) { okCount++; } else { failCount++; }
            } catch (e) { failCount++; }
          }
        }

        if (DISK.rescan) { try { await DISK.rescan({ quiet: true, offline: true }); } catch (e) {} }
        closeModal();
        hint("删除完成: 成功 " + okCount + (failCount ? ", 失败 " + failCount : "") + "，刷新中…");
        setTimeout(function(){ location.reload(); }, 800);
      };
    });
  }


  /* ---------- 章节右键菜单: 删除这一话 ---------- */
  function showChCtx(x, y, idx) {
    if (!comic) return;
    var ch = comic.chapters[idx];
    if (!ch) return;
    var label = chLabel(ch);
    fillCtx([
      { t: " 打开这一话", f: function () { S.ci = idx; S.pi = 0; render(); renderChapters(); } },
      { t: " 在文件夹中打开", f: function () {
          if (!ch.path) { hint("这一话没有独立文件夹"); return; }
          if (DISK && DISK.reveal && LIBROOT) DISK.reveal(LIBROOT + "\\" + comic.dir + "\\" + ch.path);
          else hint("仅桌面版支持");
        } },
      { t: " 删除这一话（含文件）…", f: function () { delChapter(idx); } }
    ], x, y);
  }
  async function delChapter(idx) {
    if (!comic) return;
    var ch = comic.chapters[idx];
    if (!ch) return;
    if (!ch.path) { hint("这一话是书目录里的散图，不能单独删（要么删整本）"); return; }
    if (!DISK || !DISK.deleteChapter) { hint("删除章节需要桌面版：请用「启动书库.cmd」打开"); return; }
    var label = chLabel(ch);
    hint("正在删除…");
    var r = null;
    try { r = await DISK.deleteChapter(comic.dir, ch.path); } catch (e) { r = { ok: false, msg: String(e && e.message ? e.message : e) }; }
    if (!r || !r.ok) { hint("删除失败: " + ((r && r.msg) || "未知错误")); return; }
    comic.chapters.splice(idx, 1);
    if (idx < S.ci) S.ci--;
    if (S.ci >= comic.chapters.length) S.ci = Math.max(0, comic.chapters.length - 1);
    S.pi = 0;
    renderChapters(); render();
    hint("已删除这一话：" + label + (comic.chapters.length ? "" : "（这本书已经没有章节了）"));
    if (DISK.rescan) { try { await DISK.rescan({ quiet: true, offline: true }); } catch (e2) {} }   // 只重建书库.html, 不跳回主页
  }

  // 观看顺序: 正常 0..n-1; 倒序 n-1..0(某些站(X)第一话是最早的图, 想从最新的看起就开这个)
  function chOrder() {
    var n = comic ? comic.chapters.length : 0, out = [], i;
    if (S.rev) { for (i = n - 1; i >= 0; i--) out.push(i); } else { for (i = 0; i < n; i++) out.push(i); }
    return out;
  }
  // 按观看顺序走 d 步, 返回那一话的绝对下标(越界返回 -1)
  function chStep(d) {
    var o = chOrder(), pos = o.indexOf(S.ci);
    if (pos < 0) return -1;
    var nx = pos + d;
    return (nx < 0 || nx >= o.length) ? -1 : o[nx];
  }
  function renderChapters() {
    if (!comic) return;
    var big = isBigPlat(comic.dir);
    elBook.textContent = (comic.name || comic.dir);
    elChapters.innerHTML = "";
    var ord = chOrder();
    for (var q = 0; q < ord.length; q++) {
      (function (i) {
        var b = document.createElement("button");
        b.className = "ch" + (i === S.ci ? " on" : "");
        b.textContent = chLabel(comic.chapters[i]);
        var sp = document.createElement("span"); sp.className = "n"; sp.textContent = nOf(comic.chapters[i]) + (big ? " 张" : "p");
        b.appendChild(sp);
        b.onclick = function () { S.ci = i; S.pi = 0; render(); renderChapters(); };
        b.oncontextmenu = function (ev) { ev.preventDefault(); ev.stopPropagation(); showChCtx(ev.clientX, ev.clientY, i); };
        elChapters.appendChild(b);
      })(ord[q]);
    }
    var on = elChapters.querySelector(".ch.on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }

  function spreads() {
    var n = pages().length, out = [], i = 0;
    if (S.cover && n > 0) { out.push([0]); i = 1; }
    while (i < n) { out.push(i + 1 < n ? [i, i + 1] : [i]); i += 2; }
    return out;
  }
  function spreadIndex(pi) { var sp = spreads(); for (var k = 0; k < sp.length; k++) { if (sp[k].indexOf(pi) >= 0) return k; } return 0; }

  function makeImg(src, cls) {
    if (/\.mp4$/i.test(src)) {   // 原视频: 用 video 内嵌播放
      var v = document.createElement("video");
      v.src = enc(src); v.className = cls; v.controls = true; v.preload = "metadata"; v.loop = true;
      v.style.maxWidth = "100%"; v.style.maxHeight = "100%";
      v.oncontextmenu = function () { return false; };
      return v;
    }
    var im = document.createElement("img");
    im.src = enc(src);
    // 渐进显现: 先淡入(页数不多的书再叠一点模糊), 动画完就把类摘掉 —— 全程不碰 transform, 免得和缩放/拖动打架
    var anim = true;
    try { anim = S.mode !== "scroll"; } catch (e) {}   // 长条模式不做淡入, 免得滚动时一路闪
    im.className = cls + (anim ? " pgin" : "");
    im.decoding = "async";
    var reveal = function () {
      im.classList.add("pgin-on");
      setTimeout(function () {
        try { im.classList.remove("pgin"); im.classList.remove("pgin-on"); } catch (e) {}
      }, 220);
    };
    if (im.complete && im.naturalWidth) reveal();
    else { im.addEventListener("load", reveal); im.addEventListener("error", reveal); }
    im.oncontextmenu = function () { return false; };
    return im;
  }
  function preload() {
    var p = pages(), step = S.mode === "double" ? 2 : 1;
    [S.pi + step, S.pi - step].forEach(function (i) { if (p[i]) { var a = new Image(); a.src = enc(p[i]); } });
  }

  /* ---------- 长条模式: 回到"上次读到的那一页" ----------
     以前这里只有一句 scrollIntoView, 而那一刻页图还没有尺寸(长条里 .pageimg 是 height:auto,
     没解码就是 0 高), 所有页都叠在 y=0 -> 落到开头, 等于没恢复; 而且页图逐张解码、逐张长高,
     上面每长出一张, 目标页就被往下推一截。所以改成"粘住"的对齐:
       · 每张页图 load/error 对齐一次
       · 内容总高每变一次(ResizeObserver)再对齐一次
       · 几档定时器兜前 2.4 秒, 最多粘 8 秒后作废令牌放手(交回 IntersectionObserver 跟踪)
     用户真的动手(滚轮/手指/键盘/点按)就立刻放手 —— 绝不跟用户抢滚动条。 */
  var scrollRestorePage = -1, scrollRestoreTok = 0, restoreBound = false, restoreRO = null;
  function cancelScrollRestore() { scrollRestoreTok++; scrollRestorePage = -1; }
  function bindRestoreGuards() {
    if (restoreBound) return;
    restoreBound = true;
    var stop = function () { if (scrollRestorePage >= 0) cancelScrollRestore(); };
    ["wheel", "pointerdown", "touchstart", "keydown"].forEach(function (t) {
      try { window.addEventListener(t, stop, { passive: true, capture: true }); } catch (e) {}
    });
  }
  function scrollToPage(i) {
    if (!comic) return;
    bindRestoreGuards();
    var tok = ++scrollRestoreTok;
    scrollRestorePage = i;
    var aligned = function () {
      var im = elStage.querySelector('.scrollimg[data-i="' + i + '"]');
      if (!im) return null;
      return Math.round(im.getBoundingClientRect().top - elStage.getBoundingClientRect().top);
    };
    var align = function () {
      if (tok !== scrollRestoreTok || scrollRestorePage < 0) return;
      var d = aligned();
      if (d === null || Math.abs(d) < 2) return;
      elStage.scrollTop = Math.round(elStage.scrollTop + d);
    };
    var imgs = elCanvas ? elCanvas.querySelectorAll(".scrollimg") : [];
    for (var k = 0; k <= i && k < imgs.length; k++) {
      var im2 = imgs[k];
      if (im2 && im2.tagName === "IMG" && !(im2.complete && im2.naturalHeight)) {
        try { im2.loading = "eager"; } catch (e) {}
        im2.addEventListener("load", align, { once: true });
        im2.addEventListener("error", align, { once: true });
      }
    }
    try {
      if (!restoreRO && window.ResizeObserver) restoreRO = new ResizeObserver(function () { align(); });
      if (restoreRO && elCanvas) { restoreRO.disconnect(); restoreRO.observe(elCanvas); }
    } catch (e) {}
    align();
    [40, 120, 300, 700, 1400, 2400].forEach(function (d) { setTimeout(align, d); });
    // 一直对齐到 8 秒; 到点必须作废令牌再放手, 否则定时器里的 align 还会把用户滚到的地方拽回来
    var ticks = 0;
    var settle = function () {
      if (tok !== scrollRestoreTok) return;
      ticks++;
      align();
      if (ticks > 20) { cancelScrollRestore(); return; }
      setTimeout(settle, 400);
    };
    setTimeout(settle, 500);
  }

  function renderScroll() {
    var p = pages();
    var target = Math.max(0, Math.min(S.pi, Math.max(0, p.length - 1)));
    for (var i = 0; i < p.length; i++) {
      var im = makeImg(p[i], "pageimg scrollimg");
      im.setAttribute("data-i", String(i));
      im.loading = i <= target ? "eager" : "lazy";   // 目标页之前的页图必须有尺寸, 否则目标页的 y 算不准
      var w = document.createElement("div");
      w.className = "pagewrap scwrap";
      w.appendChild(im);
      elCanvas.appendChild(w);
    }
    if (io) { io.disconnect(); io = null; }
    var imgs = elStage.querySelectorAll(".scrollimg");
    io = new IntersectionObserver(function (es) {
      var best = null;
      for (var k = 0; k < es.length; k++) { if (es[k].isIntersecting && (!best || es[k].intersectionRatio > best.intersectionRatio)) best = es[k]; }
      if (!best) return;
      var idx = parseInt(best.target.getAttribute("data-i"), 10);
      // 恢复位置期间视口里先露出来的永远是第 1 页 —— 那不是用户翻到的页; 照它写进度就等于把进度清零
      if (scrollRestorePage >= 0 && idx !== scrollRestorePage) return;
      S.pi = idx; updateInfo(); syncThumbsActive(); save();
    }, { threshold: [0.1, 0.5, 0.9] });
    for (var j = 0; j < imgs.length; j++) io.observe(imgs[j]);
    scrollToPage(target);
  }

  function renderPaged() {
    var p = pages(), idxs;
    if (S.mode === "double") { var sp = spreads(), k = spreadIndex(S.pi); idxs = sp[k]; S.pi = idxs[0]; }
    else { idxs = [S.pi]; }
    var wrap = document.createElement("div");
    wrap.className = "pagewrap";
    for (var i = 0; i < idxs.length; i++) wrap.appendChild(makeImg(p[idxs[i]], "pageimg"));
    elCanvas.appendChild(wrap);
    preload();
  }

  function render() {
    if (!comic) return;
    clamp();
    elStage.className = "stage mode-" + S.mode + " fit-" + S.fit + " dir-" + S.dir + (S.zoom ? " zoom" : "");
    refit();   // 换了模式/适配方式就按真实可用尺寸重算一遍
    elStage.innerHTML = "";
    elCanvas = document.createElement("div"); elCanvas.id = "canvas";
    elStage.appendChild(elCanvas);
    if (S.mode === "scroll") renderScroll(); else renderPaged();
    preloadAround();
    applyThumbs();
    if (S.zoom) { applyZoom(S.zscale || 1); centerCanvas(); }   // 同步执行: 后台标签页里 rAF 会被节流, 不能依赖
    bmSync();
    updateInfo(); syncButtons(); save();
  }

  // 预取后面两页, 翻页时不等网络
  var preloaded = {};
  function preloadAround() {
    var pl = pages();
    for (var k = S.pi + 1; k <= Math.min(pl.length - 1, S.pi + 4); k++) {   // 后 4 页提前解码
      if (preloaded[pl[k]]) continue;
      preloaded[pl[k]] = 1;
      var im = new Image(); im.decoding = "async"; im.src = pl[k];
    }
  }

  // 右侧页面预览
  // 侧栏伸缩把手: 展开时箭头朝"收进去"的方向, 收起时朝"拉出来"的方向
  function syncSideHandles() {
    var sh = document.getElementById("sidetoggle");
    if (sh) { sh.textContent = S.sidebar ? "‹" : "›"; sh.title = (S.sidebar ? "收起目录" : "展开目录") + " (S)"; }
    var th = document.getElementById("thumbtoggle");
    if (th) { th.textContent = S.thumbs ? "›" : "‹"; th.title = (S.thumbs ? "收起预览" : "展开预览") + " (P)"; }
  }

  // 只挪侧栏的"当前页"高亮, 不重建列表(长条滚动时会被频繁调用, 重建太贵)
  var lastThumbSync = 0, thumbRaf = 0;
  // 把某个缩略图滚到"条的正中"(140ms 缓动)。
  // 用显式 scrollTop, 不用 scrollIntoView —— 后者会连带滚动祖先容器, 有可能把阅读区也滚一下(黑一下的来源之一)
  function scrollThumbToCenter(item, instant) {
    var list = document.getElementById("thumblist");
    if (!list || !item) return;
    var lh = list.clientHeight;
    var ih = item.offsetHeight || Math.round(item.getBoundingClientRect().height);
    var want = item.offsetTop - (lh - ih) / 2;
    var max = list.scrollHeight - lh;
    if (want < 0) want = 0;
    if (want > max) want = max;
    var from = list.scrollTop;
    if (Math.abs(want - from) < 3) return;   // 已经正中附近, 不动
    if (instant) { list.scrollTop = want; return; }
    if (thumbRaf) { cancelAnimationFrame(thumbRaf); thumbRaf = 0; }
    var t0 = performance.now(), dur = 140;
    var step = function (now) {
      var k2 = (now - t0) / dur;
      if (k2 > 1) k2 = 1;
      var e = 1 - Math.pow(1 - k2, 3);   // ease-out
      list.scrollTop = from + (want - from) * e;
      if (k2 < 1) thumbRaf = requestAnimationFrame(step); else thumbRaf = 0;
    };
    thumbRaf = requestAnimationFrame(step);
  }

  function syncThumbsActive() {
    try {
      if (!S.thumbs) return;
      var list = document.getElementById("thumblist");
      if (!list || !list.children.length) return;
      var now = Date.now();
      if (now - lastThumbSync < 60) return;
      lastThumbSync = now;
      var items = list.children, target = null;
      for (var i = 0; i < items.length; i++) {
        var idx = parseInt(items[i].getAttribute("data-pi"), 10);
        if (idx === S.pi) {
          target = items[i];
          if (!items[i].classList.contains("on")) items[i].classList.add("on");
        } else if (items[i].classList.contains("on")) {
          items[i].classList.remove("on");
        }
      }
      if (target) scrollThumbToCenter(target, false);
    } catch (e) {}
  }

  function applyThumbs() {
    var box = document.getElementById("thumbs");
    if (!box) return;
    box.classList.toggle("collapsed", !S.thumbs);
    syncSideHandles();
    if (!S.thumbs) return;
    var list = document.getElementById("thumblist");
    if (!list) return;
    var pl = pages();
    var sig = S.ci + ":" + pl.length + ":" + (S.prevRev ? 1 : 0);
    if (list.getAttribute("data-sig") === sig) { syncThumbsActive(); return; }   // 内容没变就不重建(免得闪)
    list.setAttribute("data-sig", sig);
    var frag = document.createDocumentFragment();
    var ord = [], k2;
    for (k2 = 0; k2 < pl.length; k2++) ord.push(k2);
    if (S.prevRev) ord.reverse();                 // 预览倒序: 列表从最后一页排到第一页
    for (var q2 = 0; q2 < ord.length; q2++) {
      var i = ord[q2];
      var it = document.createElement("div"); it.className = "titem" + (i === S.pi ? " on" : ""); it.setAttribute("data-pi", String(i));
      var im = document.createElement("img"); im.loading = (q2 < 3 ? "eager" : "lazy"); im.decoding = "async"; im.src = enc(pl[i]);
      var tn = document.createElement("span"); tn.className = "tn"; tn.textContent = String(i + 1);   // 显示真实页码
      it.appendChild(im); it.appendChild(tn);
      (function (idx, el) {
        el.onclick = function () { S.pi = idx; render(); };
        el.oncontextmenu = function (ev) { ev.preventDefault(); ev.stopPropagation(); showImgCtx(ev.clientX, ev.clientY, idx); };
      })(i, it);
      frag.appendChild(it);
    }
    list.replaceChildren(frag);   // 一次性换上, 不出现"先清空后逐个补"的白闪
    var cur = list.querySelector(".titem.on");
    if (cur) scrollThumbToCenter(cur, true);   // 列表刚重建, 直接对准中心(不用动画)
    else if (list.children.length) scrollThumbToCenter(list.children[0], true);
  }

  function updateInfo() {
    var c = cur(); if (!c) return;
    elChName.textContent = chLabel(c);
    elPageInfo.textContent = "/ " + pages().length;
    if (document.activeElement !== elPageInput) elPageInput.value = String(S.pi + 1);
    document.title = (comic.name || comic.dir) + " · " + chLabel(c) + " " + (S.pi + 1) + "/" + pages().length;
  }

  function syncButtons() {
    document.getElementById("m-single").classList.toggle("on", S.mode === "single");
    document.getElementById("m-double").classList.toggle("on", S.mode === "double");
    document.getElementById("m-scroll").classList.toggle("on", S.mode === "scroll");
    document.getElementById("f-width").classList.toggle("on", S.fit === "width");
    document.getElementById("f-height").classList.toggle("on", S.fit === "height");
    document.getElementById("f-original").classList.toggle("on", S.fit === "original");
    document.getElementById("bcover").classList.toggle("on", S.cover);
    var bz2 = document.getElementById("bzoom"); if (bz2) bz2.classList.toggle("on", !!S.zoom);
    var bz2o = document.getElementById("bzoomout"); if (bz2o) bz2o.classList.toggle("on", !!S.zoom);
    var bz2r = document.getElementById("bzoomreset"); if (bz2r) bz2r.classList.toggle("on", !!S.zoom);
    document.getElementById("bdir").textContent = S.dir === "rtl" ? "日漫「右→左」" : "左→右";
    var brv = document.getElementById("brev");
    if (brv) { brv.classList.toggle("on", !!S.rev); brv.textContent = S.rev ? "倒序：新→旧" : "顺序：旧→新"; }
    var bpc = document.getElementById("bprevch"), bnc = document.getElementById("bnextch");
    if (bpc && bnc) { var big = !!(comic && isBigPlat(comic.dir)); bpc.textContent = big ? "‹ 上一篇" : "‹ 上一话"; bnc.textContent = big ? "下一篇 ›" : "下一话 ›"; }
    var prv = document.getElementById("prevrev");
    if (prv) { prv.classList.toggle("on", !!S.prevRev); prv.textContent = S.prevRev ? "倒序" : "顺序"; prv.title = S.prevRev ? "预览/翻页：从最后一页往前看（点一下恢复正序）" : "预览/翻页：从第一页往后看（点一下切成倒序）"; }
    document.getElementById("bwheel").classList.toggle("on", S.wheel);
    elSidebar.classList.toggle("collapsed", !S.sidebar);
    var tb = document.getElementById("thumbs"); if (tb) tb.classList.toggle("collapsed", !S.thumbs);
    syncSideHandles();
  }

  function nextPage() {
    var n = pages().length;
    if (S.mode === "scroll") {
      var imgs = elStage.querySelectorAll(".scrollimg");
      if (S.prevRev) { if (S.pi - 1 >= 0) imgs[S.pi - 1].scrollIntoView({ behavior: "smooth", block: "start" }); else nextChapter(); return; }
      if (S.pi + 1 < imgs.length) imgs[S.pi + 1].scrollIntoView({ behavior: "smooth", block: "start" }); else nextChapter();
      return;
    }
    if (S.mode === "double" && !S.prevRev) { var sp = spreads(), k = spreadIndex(S.pi); if (k + 1 < sp.length) { S.pi = sp[k + 1][0]; render(); } else nextChapter(); return; }
    if (S.prevRev) { if (S.pi - 1 >= 0) { S.pi--; render(); } else nextChapter(); return; }   // 倒序: 往后翻 = 页码减小(到第一页再往后=下一话)
    if (S.pi + 1 < n) { S.pi++; render(); } else nextChapter();
  }
  function prevPage() {
    var n = pages().length;
    if (S.mode === "scroll") {
      var imgs = elStage.querySelectorAll(".scrollimg");
      if (S.prevRev) { if (S.pi + 1 < imgs.length) imgs[S.pi + 1].scrollIntoView({ behavior: "smooth", block: "start" }); else prevChapter(true); return; }
      if (S.pi - 1 >= 0) imgs[S.pi - 1].scrollIntoView({ behavior: "smooth", block: "start" }); else prevChapter(true);
      return;
    }
    if (S.mode === "double" && !S.prevRev) { var sp = spreads(), k = spreadIndex(S.pi); if (k - 1 >= 0) { S.pi = sp[k - 1][0]; render(); } else prevChapter(true); return; }
    if (S.prevRev) { if (S.pi + 1 < n) { S.pi++; render(); } else prevChapter(true); return; }   // 倒序: 往回看 = 页码增大(到最后一页再往回=上一话)
    if (S.pi - 1 >= 0) { S.pi--; render(); } else prevChapter(true);
  }
  function nextChapter() {
    if (!comic) return;
    var nx = chStep(1);
    if (nx >= 0) { S.ci = nx; S.pi = 0; render(); renderChapters(); hint(chLabel(cur())); }
    else hint(S.rev ? ("已经是最早的那一" + (comic && isBigPlat(comic.dir) ? "篇了" : "话了")) : ((comic && isBigPlat(comic.dir)) ? "已经是最后一篇了" : "已经是最后一话了"));
  }
  function prevChapter(atEnd) {
    if (!comic) return;
    var pv = chStep(-1);
    if (pv >= 0) {
      S.ci = pv;
      var n = nOf(comic.chapters[S.ci]);
      S.pi = atEnd ? Math.max(0, n - 1) : 0;
      render(); renderChapters(); hint(chLabel(cur()));
    } else hint(S.rev ? ("已经是最新的一" + (comic && isBigPlat(comic.dir) ? "篇了" : "话了")) : ((comic && isBigPlat(comic.dir)) ? "已经是第一篇了" : "已经是第一话了"));
  }

  // 封面"飞"进阅读器: 手工克隆一张图来飞(和飞回同一套)。
  // 之前用 View Transition 做, 你屏幕上会出现"落地后几个高斯模糊块"——那是浏览器把大图按卡片尺寸
  // 光栅化过、落地后部分图块没按新尺寸重画留下的残留。改成自己控制就没有这个问题。
  function flyOpenComic(c, coverImg) {
    if (!SET.flyAnim || !coverImg || !coverImg.getBoundingClientRect) { openComic(c); return; }
    var a = coverImg.getBoundingClientRect();
    if (!a.width || !a.height) { openComic(c); return; }
    var run = function () {
      var fly = document.createElement("img");
      fly.src = coverImg.currentSrc || coverImg.src;
      fly.setAttribute("aria-hidden", "true");
      var ease = "cubic-bezier(.3,.7,.3,1)";
      fly.style.cssText = "position:fixed;left:" + a.left + "px;top:" + a.top + "px;width:" + a.width + "px;height:" + a.height + "px;object-fit:cover;z-index:9999;pointer-events:none;opacity:1;box-shadow:0 18px 60px rgba(0,0,0,.55);transition:left 340ms " + ease + ",top 340ms " + ease + ",width 340ms " + ease + ",height 340ms " + ease + ",opacity 340ms ease-out";
      document.body.appendChild(fly);
      void fly.offsetWidth;   // 强制先算初值, 否则和终止值同帧应用 → 过渡不跑
      openComic(c);           // 阅读器正常渲染, 克隆图在上面飞
      // 落点尺寸要等阅读器把图布局出来(刚渲染那一瞬量到的是 0), 所以轮询等它有宽再设目标
      var tried = 0;
      var aim = function () {
        var dst = document.querySelector("#stage img");
        var b = dst ? dst.getBoundingClientRect() : null;
        if (b && b.width > 1 && b.height > 1) {
          fly.style.left = b.left + "px";
          fly.style.top = b.top + "px";
          fly.style.width = b.width + "px";
          fly.style.height = b.height + "px";
          fly.style.opacity = "0";
          return;
        }
        if (++tried < 40) requestAnimationFrame(aim);
        else fly.style.opacity = "0";   // 实在量不到就只淡出, 不卡住
      };
      requestAnimationFrame(aim);
      setTimeout(function () {
        try { fly.remove(); } catch (e) {}
        // 落地后强制重画一次(提层再撤), 防止留下低分辨率残留
        try {
          var im = document.querySelector("#stage img");
          if (im) { im.style.willChange = "transform"; requestAnimationFrame(function () { try { im.style.willChange = ""; } catch (e2) {} }); }
        } catch (e) {}
      }, 620);
    };
    // 预热"要落下去的那张图"(最多等 220ms), 免得飞过去落在一个还没出图的空框上
    var target = null;
    try { var pl = pageList(c, c.chapters[0]); target = (pl && pl[0]) ? enc(pl[0]) : null; } catch (e) {}
    if (!target) { run(); return; }
    var fired = false, pre = new Image();
    var fire = function () { if (fired) return; fired = true; run(); };
    pre.onload = fire; pre.onerror = fire; pre.src = target;
    setTimeout(fire, 220);
  }
  function openComic(c) {
    comic = c;
    NAVFWD.length = 0;   // 新开一本书, 清掉"前进"记录(和浏览器一致)
    var p = prog(c.dir);
    S.ci = 0; S.pi = 0; S.mode = "single"; S.fit = "height"; S.dir = "rtl"; S.cover = false; S.sidebar = true; S.wheel = true;
    var bigPlat = isBigPlat(c.dir);      // X/微博/抖音/pixiv: 新书默认"从最新看起"
    S.rev = bigPlat; S.prevRev = bigPlat;
    if (bigPlat && c.chapters.length) S.pi = Math.max(0, nOf(c.chapters[0]) - 1);   // 倒序时从最后一页(最新那张)进
    if (p) {
      S.ci = Math.max(0, Math.min(p.ci || 0, c.chapters.length - 1));
      S.pi = p.pi || 0;
      if (p.mode) S.mode = p.mode;
      if (p.fit) S.fit = p.fit;
      if (p.dir) S.dir = p.dir;
      if (typeof p.cover === "boolean") S.cover = p.cover;
      if (typeof p.sidebar === "boolean") S.sidebar = p.sidebar;
      if (typeof p.thumbs === "boolean") S.thumbs = p.thumbs;
      if (typeof p.wheel === "boolean") S.wheel = p.wheel;
      if (typeof p.rev === "boolean") S.rev = p.rev;
      if (typeof p.prevRev === "boolean") S.prevRev = p.prevRev;
      // 进度按"话 + 页"记的索引, 话删了/重排了会指错: 先用上次那一话的目录名核对一次
      if (p.cpath) {
        for (var qi = 0; qi < c.chapters.length; qi++) {
          if ((c.chapters[qi].path || "") === p.cpath) { S.ci = qi; S.pi = Math.min(p.pi || 0, Math.max(0, nOf(c.chapters[qi]) - 1)); break; }
        }
      }
    }
    elShelf.classList.add("hide");
    elReader.classList.remove("hide");
    elReader.getAnimations().forEach(function(a){a.cancel()});
    if (vtBusy) {
      elReader.style.opacity = "";   // 飞入时交给 View Transition 过渡, 这里再淡入会叠起来、收尾闪一下
    } else {
    elReader.animate([{opacity:0},{opacity:1}],{duration:300,easing:'ease-out',fill:'forwards'}).onfinish = function(){
      elReader.style.opacity = "";
    };
    }
    renderChapters(); render();
    document.title = (c.name || c.dir);
  }
  // ── F9 性能采样: 你用着感觉卡的时候按一下, 采 3 秒写进日志(App 的 stdout 会被启动器存到 _scripts\jm\.app-out.log) ──
  function perfSample() {
    var frames = [], long = [];
    try {
      new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { long.push(Math.round(e.duration)); }); }).observe({ type: "longtask", buffered: false });
    } catch (e) {}
    var last = performance.now(), stop = false;
    function tick(now) { frames.push(now - last); last = now; if (!stop) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
    hint("性能采样中… 3 秒");
    setTimeout(function () {
      stop = true;
      var a = frames.slice(3).sort(function (x, z) { return x - z; });
      if (!a.length) { hint("采样失败(没有帧)"); return; }
      var sum = 0; a.forEach(function (x) { sum += x; });
      var avg = sum / a.length;
      var msg = "[PERF] fps≈" + Math.round(1000 / avg)
        + " 平均" + (Math.round(avg * 100) / 100) + "ms"
        + " 中位" + (Math.round(a[Math.floor(a.length / 2)] * 100) / 100)
        + " p95" + (Math.round(a[Math.floor(a.length * 0.95)] * 100) / 100)
        + " 最差" + (Math.round(a[a.length - 1] * 100) / 100)
        + " 超8ms " + a.filter(function (x) { return x > 8; }).length + "/" + a.length
        + " 长任务" + JSON.stringify(long.slice(0, 5))
        + " 位置=" + (comic ? ("阅读器:" + (comic.name || comic.dir) + "/" + S.mode + "/页" + (S.pi + 1) + "/侧栏" + (S.thumbs ? "开" : "关")) : "书架")
        + " 窗口=" + innerWidth + "x" + innerHeight
        + " 磨砂=" + (document.body.classList.contains("bgimg") ? "开" : "关");
      try { console.log(msg); } catch (e) {}
      try { if (DISK && DISK.perfLog) DISK.perfLog(msg); } catch (e) {}   // 渲染进程的 console 不进主进程 stdout, 必须走 IPC 落盘
      hint(msg.slice(0, 160));
    }, 3000);
  }

  // 飞回去: 自己克隆一张图来飞(FLIP)。试过用 View Transition 做反向, 浏览器不给它建变形组,
  // 表现就是"啪"一下换完、看不见过程——所以这条腿改成手工克隆, 完全可控。
  function flyCloseComic() {
    var c = comic;
    var src = null;
    try { var ims = document.querySelectorAll("#stage img"); src = (ims && ims.length) ? ims[0] : null; } catch (e) {}
    var card = c ? document.querySelector('.card[data-dir="' + CSS.escape(c.dir) + '"]') : null;
    var cardImg = card ? card.querySelector(".thumb img") : null;
    if (!SET.flyAnim || !c || !src || !cardImg || !src.getBoundingClientRect) { closeComic(); return; }
    var a = src.getBoundingClientRect();   // 先量阅读器那张图(此刻书架还是 hide, 量卡片会得到 0)
    if (!a.width || !a.height) { closeComic(); return; }
    closeComic();                          // 先切回书架, 卡片才有真实位置
    var b = cardImg.getBoundingClientRect();
    if (!b || !b.width) return;            // 卡片量不到就算了(已经切回去了)
    var cardBox = card.getBoundingClientRect();
    if (cardBox && cardBox.width && (cardBox.bottom < 0 || cardBox.top > innerHeight)) return;   // 卡片不在可视区就别飞了
    var fly = document.createElement("img");
    fly.src = src.currentSrc || src.src;
    fly.setAttribute("aria-hidden", "true");
    var ease = "cubic-bezier(.3,.7,.3,1)";
    fly.style.cssText = "position:fixed;left:" + a.left + "px;top:" + a.top + "px;width:" + a.width + "px;height:" + a.height + "px;object-fit:contain;z-index:9999;pointer-events:none;opacity:1;transition:left 380ms " + ease + ",top 380ms " + ease + ",width 380ms " + ease + ",height 380ms " + ease + ",opacity 380ms ease-out";
    document.body.appendChild(fly);
    void fly.offsetWidth;   // 强制先算出初始位置/尺寸, 否则和终止值同帧应用 → 过渡不会跑(表现为瞬间跳到终点)
    // (closeComic 已经在上面调过了)
    requestAnimationFrame(function () {
      fly.style.left = b.left + "px";
      fly.style.top = b.top + "px";
      fly.style.width = b.width + "px";
      fly.style.height = b.height + "px";
      fly.style.opacity = "0";   // 淡到卡片封面上, 收尾不跳
    });
    setTimeout(function () { try { fly.remove(); } catch (e) {} }, 460);
  }
  function closeComic() {
    cancelScrollRestore();
    save();
    if (comic) NAVFWD.push(comic.dir);
    var dir = comic ? comic.dir : null;
    comic = null;
    if (io) { io.disconnect(); io = null; }
    elReader.getAnimations().forEach(function(a){a.cancel()});
    elReader.style.position = "fixed";
    elReader.style.inset = "0";
    elReader.style.zIndex = "100";
    elShelf.classList.remove("hide");
    if (vtBusy) {
      // 飞回去: 由 View Transition 负责过渡, 这里立刻收尾(不再叠一层淡出)
      elReader.classList.add("hide");
      elReader.style.opacity = "";
      elReader.style.position = "";
      elReader.style.inset = "";
      elReader.style.zIndex = "";
    } else {
    elReader.animate([{opacity:1},{opacity:0}],{duration:300,easing:'ease-in',fill:'forwards'}).onfinish = function(){
      elReader.classList.add("hide");
      elReader.style.opacity = "";
      elReader.style.position = "";
      elReader.style.inset = "";
      elReader.style.zIndex = "";
    };
    }
    document.title = LIBTITLE;
    // 不重建整个书架, 只更新刚读那本书的进度显示, 保留滚动位置
    if (dir) {
      var el = document.querySelector('.card[data-dir="' + CSS.escape(dir) + '"]');
      if (el) {
        // 简单更新: 找到进度条和进度文字, 不重建 DOM
        var p = prog(dir);
        if (p) {
          var mf = manifestOf(dir) || {};
          var total = totalPages(mf);
          var done = 0;
          for (var i = 0; i < (p.ci||0); i++) done += nOf(mf.chapters && mf.chapters[i]);
          done += Math.min(p.pi||0, nOf(mf.chapters && mf.chapters[p.ci]) - 1);
          var bar = el.querySelector(".bar i");
          if (bar) bar.style.width = total ? Math.round(done/total*100) + "%" : "0%";
          var sub = el.querySelector(".csub");
          // 进度文字不动也行, 下次自然刷新会更新
        }
      }
    }
  }

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
  function saveRev() {   // 只写 rev, 不受 save() 里"停在书签页不记历史"的影响
    if (!comic) return;
    var p = prog(comic.dir) || {};
    p.rev = !!S.rev;
    p.prevRev = !!S.prevRev;
    setProg(comic.dir, p);
  }
  if (bRev) bRev.onclick = function () { S.rev = !S.rev; syncButtons(); renderChapters(); saveRev(); save(); hint(S.rev ? "倒序观看：从最新的一话开始（封面也换成最新一话的图）" : "恢复正序观看"); };
  var bPrevRev = document.getElementById("prevrev");
  if (bPrevRev) bPrevRev.onclick = function () {
    S.prevRev = !S.prevRev;
    S.pi = S.prevRev ? Math.max(0, pages().length - 1) : 0;   // 切换后直接落在"该看的开头"
    syncButtons(); applyThumbs(); render(); saveRev(); save();
    hint(S.prevRev ? "预览倒序：列表和翻页都从最后一页往前" : "预览恢复正序：从第一页往后");
  };
  // 按钮缩放一律以"画面中心"为锚点(滚轮才是以光标为锚点); 每次 ±25%
  function zoomStep(d) {
    var z = Math.round(((S.zscale || 1) + d) * 100) / 100;
    z = Math.max(0.2, Math.min(8, z));
    zoomAt(z, elStage.clientWidth / 2, elStage.clientHeight / 2);
    hint("缩放 " + Math.round(z * 100) + "%");
  }
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
  // 放大/缩小: 按住右键滚轮(以光标位置为锚点, 100% 起逐步缩放); 平移: 按住右键拖动
  var rightDown = false;
  document.addEventListener("mousedown", function (ev) { if (ev.button === 2) rightDown = true; }, true);
  document.addEventListener("mouseup", function () { rightDown = false; }, true);
  var zoomRetryT = 0, zoomRetryN = 0;
  function applyZoom(z) {
    S.zscale = z; S.zoom = Math.abs(z - 1) > 0.001;
    elStage.style.setProperty("--zscale", String(z));
    var cls = "stage mode-" + S.mode + " fit-" + S.fit + " dir-" + S.dir;
    elStage.className = cls + (S.zoom ? " zoom" : "");
    var i, ims = elStage.querySelectorAll("img.pageimg");
    if (!S.zoom) {
      for (i = 0; i < ims.length; i++) {
        var im = ims[i];
        im.style.width = ""; im.style.height = ""; im.style.maxWidth = ""; im.style.maxHeight = "";
        im.removeAttribute("data-basew");
      }
      var ws0 = elStage.querySelectorAll(".pagewrap");
      for (i = 0; i < ws0.length; i++) { ws0[i].style.width = ""; ws0[i].style.height = ""; }
      if (elCanvas) elCanvas.style.transform = "";
      S.tx = 0; S.ty = 0;
      return;
    }
    // 100% 基准宽 = 该模式下这一页原本显示出来的宽度: 先摘掉 zoom 类量一次, 量完立刻戴回
    var need = elStage.querySelectorAll("img.pageimg:not([data-basew])");
    if (need.length) {
      elStage.className = cls;
      for (i = 0; i < need.length; i++) {
        var w0 = Math.round(need[i].getBoundingClientRect().width);
        if (w0 < 3 && need[i].naturalWidth) w0 = need[i].naturalWidth;
        if (w0 >= 3) need[i].setAttribute("data-basew", String(w0));
      }
      elStage.className = cls + " zoom";
    }
    var pending = false;
    var wraps = elStage.querySelectorAll(".pagewrap");
    for (var wi = 0; wi < wraps.length; wi++) {
      var wrap = wraps[wi];
      var wims = wrap.querySelectorAll("img.pageimg"), total = 0, cnt = 0, ready = true;
      var gap = S.mode === "scroll" ? 0 : 2;
      for (i = 0; i < wims.length; i++) {
        var wim = wims[i];
        var base = parseFloat(wim.getAttribute("data-basew") || "0");
        if (!base) {
          ready = false; pending = true;
          wim.addEventListener("load", function () { if (S.zoom) applyZoom(S.zscale || 1); }, { once: true });
          continue;
        }
        var wpx = Math.round(base * z);
        wim.style.maxWidth = "none"; wim.style.maxHeight = "none";
        wim.style.width = wpx + "px"; wim.style.height = "auto";
        total += wpx; cnt++;
      }
      if (ready && cnt) { wrap.style.width = (total + gap * (cnt - 1)) + "px"; wrap.style.height = ""; }
    }
    panCanvas();
    if (pending && zoomRetryN < 40) {   // 图还没解码 -> 稍后重试, 别让这次缩放白做
      zoomRetryN++;
      clearTimeout(zoomRetryT);
      zoomRetryT = setTimeout(function () { zoomRetryT = 0; if (S.zoom) applyZoom(S.zscale || 1); }, 150);
    }
  }
  function panCanvas() {
    if (elCanvas) elCanvas.style.transform = "translate(" + Math.round(S.tx || 0) + "px," + Math.round(S.ty || 0) + "px)";
  }
  // SAI2 式画布缩放: 光标(或视口中心)对着的内容点, 缩放前后纹丝不动
  function zoomAt(z, ax, ay) {
    var k = z / (S.zscale || 1);
    if (!S.zoom && elCanvas) {   // 刚进缩放: 用"内容原点"(第一页左上角)的屏幕位置当画布原点 -> 进缩放这一下也不跳
      var sr = elStage.getBoundingClientRect();
      var im0 = elCanvas.querySelector("img.pageimg");   // 内容原点 = 第一张图的左上角
      var r0 = (im0 && im0.getBoundingClientRect().width > 2) ? im0.getBoundingClientRect()
             : (elCanvas.querySelector(".pagewrap") || elCanvas).getBoundingClientRect();
      S.tx = r0.left - sr.left; S.ty = r0.top - sr.top;
    }
    S.tx = ax - (ax - (S.tx || 0)) * k;
    S.ty = ay - (ay - (S.ty || 0)) * k;
    applyZoom(z);
  }
  // 换页/换模式后的落位: 横向居中; 纵向装得下就居中, 装不下从页顶开始
  function centerCanvas() {
    if (!S.zoom || !elCanvas) return;
    var sr = elStage.getBoundingClientRect();
    var cw = elCanvas.offsetWidth, ch = elCanvas.offsetHeight;
    S.tx = Math.round((sr.width - cw) / 2);
    S.ty = 0;
    if (S.mode === "scroll") {
      var t = elCanvas.querySelector("img.pageimg[data-i='" + S.pi + "']");
      if (t && t.parentElement) S.ty = -t.parentElement.offsetTop;
    } else if (ch <= sr.height) S.ty = Math.round((sr.height - ch) / 2);
    panCanvas();
  }
  document.addEventListener("wheel", function (ev) {
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

  document.getElementById("bfull").onclick = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  };
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
  elSearch.oninput = function () {
    S.q = elSearch.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { searchTimer = 0; renderShelf(); saveShelfView(); }, 80);
  };
  /* ---------- 折叠式筛选面板 + chips（作者/分级/平台 多选，并集过滤） ---------- */
  var elFilterPanel = document.getElementById("filterpanel");
  var elBtnFilter = document.getElementById("btn-filter");
  // 通用 chips 渲染: items=[{value,label}], selected 是会被原地修改的数组; onPick 在切换后回调
  function renderChips(boxId, items, selected, onPick) {
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
  function updateFilterBadge() {
    var n = (S.authors ? S.authors.length : 0) + (S.ratings ? S.ratings.length : 0) + (S.plats ? S.plats.length : 0) + (S.works ? S.works.length : 0);
    var badge = document.getElementById("btn-filter-badge");
    if (badge) {
      badge.textContent = n ? (" " + n) : "";
      badge.className = "fbadge" + (n ? "" : " clean");
    }
  }
  // 作者/平台筛选行的折叠: 默认收起, 点 flabel 展开; 选中时高亮
  function applyFRowState() {
    var rowA = document.getElementById("frow-author"), flA = document.getElementById("fl-author");
    if (rowA) {
      rowA.classList.toggle("open", !!S.authOpen);
      rowA.classList.toggle("closed", !S.authOpen);
      var selA = (S.authors && S.authors.length) || 0;
      rowA.classList.toggle("sel", selA > 0);
      if (flA) flA.textContent = "作者" + (selA > 0 ? " 已选" + selA : "");
    }
    var rowP = document.getElementById("frow-plat"), flP = document.getElementById("fl-plat");
    if (rowP) {
      rowP.classList.toggle("open", !!S.platOpen);
      rowP.classList.toggle("closed", !S.platOpen);
      var selP = (S.plats && S.plats.length) || 0;
      rowP.classList.toggle("sel", selP > 0);
      if (flP) flP.textContent = "平台" + (selP > 0 ? " 已选" + selP : "");
    }
    var rowW = document.getElementById("frow-work"), flW = document.getElementById("fl-work");
    if (rowW) {
      rowW.classList.toggle("open", !!S.workOpen);
      rowW.classList.toggle("closed", !S.workOpen);
      var selW = (S.works && S.works.length) || 0;
      rowW.classList.toggle("sel", selW > 0);
      if (flW) flW.textContent = "作品" + (selW > 0 ? " 已选" + selW : "");
    }
  }
  function animateFRow(row, open) {
    if (!row) return;
    var chips = row.querySelector(".fchips");
    if (!chips) return;
    chips.style.cssText = "";
    if (open) {
      chips.style.display = "";
      chips.style.height = "auto";
      chips.style.overflow = "hidden";
      var h = chips.offsetHeight;
      chips.style.height = "0px";
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          chips.style.transition = "height .3s ease";
          chips.style.height = h + "px";
        });
      });
      setTimeout(function(){
        chips.style.cssText = "";
      }, 300);
    } else {
      var h2 = chips.offsetHeight;
      chips.style.height = h2 + "px";
      chips.style.overflow = "hidden";
      requestAnimationFrame(function(){
        chips.style.transition = "height .3s ease";
        chips.style.height = "0px";
      });
      setTimeout(function(){
        chips.style.display = "none";
        chips.style.cssText = "";
      }, 300);
    }
  }
  function setupFRowToggles() {
    var flA = document.getElementById("fl-author");
    if (flA) flA.onclick = function () {
      S.authOpen = !S.authOpen;
      var row = document.getElementById("frow-author");
      if (S.authOpen) { row.classList.remove("closed"); row.classList.add("open"); var ch=row.querySelector(".fchips"); if(ch) ch.style.display=""; applyFRowState(); }
      animateFRow(row, S.authOpen);
      if(!S.authOpen) setTimeout(function(){ row.classList.add("closed"); row.classList.remove("open"); applyFRowState(); }, 300);
      saveShelfView(true);
    };
    var flP = document.getElementById("fl-plat");
    if (flP) flP.onclick = function () {
      S.platOpen = !S.platOpen;
      var row = document.getElementById("frow-plat");
      if (S.platOpen) { row.classList.remove("closed"); row.classList.add("open"); var ch=row.querySelector(".fchips"); if(ch) ch.style.display=""; applyFRowState(); }
      animateFRow(row, S.platOpen);
      if(!S.platOpen) setTimeout(function(){ row.classList.add("closed"); row.classList.remove("open"); applyFRowState(); }, 300);
      saveShelfView(true);
    };
    var flW = document.getElementById("fl-work");
    if (flW) flW.onclick = function () {
      S.workOpen = !S.workOpen;
      var row = document.getElementById("frow-work");
      if (S.workOpen) { row.classList.remove("closed"); row.classList.add("open"); var ch=row.querySelector(".fchips"); if(ch) ch.style.display=""; applyFRowState(); }
      animateFRow(row, S.workOpen);
      if(!S.workOpen) setTimeout(function(){ row.classList.add("closed"); row.classList.remove("open"); applyFRowState(); }, 300);
      saveShelfView(true);
    };
    applyFRowState();
  }
  // 平台 chips: 全部平台 / AI 生成 / 各站点(带本数)
  function renderPlatSel() {
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
  // 作者 chips
  function renderAuthorSel() {
    var names = {};
    for (var i = 0; i < COMICS.length; i++) { var a = authorOf(COMICS[i].dir); names[a] = (names[a] || 0) + 1; }
    var keys = Object.keys(names).sort(function (x, y) { return x.localeCompare(y, "zh"); });
    var items = keys.map(function (k) { return { value: (k === "未标注" ? "" : k), label: k + " (" + names[k] + ")" }; });
    renderChips("chips-author", items, S.authors = S.authors || [], function () { renderShelf(); saveShelfView(); applyFRowState(); });
  }
  // 分级 chips(固定两项)
  function renderRatingSel() {
    var items = [
      { value: "18+", label: "18+" },
      { value: "sfw", label: "非 18+" }
    ];
    renderChips("chips-rating", items, S.ratings = S.ratings || [], function () { renderShelf(); saveShelfView(true); });
  }
  // 作品 chips: 全部作品(按书数排序)
  function renderWorkSel() {
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
  // 分组 chips(多选): [不分组]=清空; 其余按 GROUP_DIM_LABEL
  function renderGroupSel() {
    var items = GROUP_DIM_ORDER.map(function (d) { return { value: d, label: GROUP_DIM_LABEL[d] }; });
    renderChips("chips-group", items, S.groups = S.groups || [], function () { renderShelf(); saveShelfView(); });
  }
  // 排序 chips(单选)
  var SORT_ITEMS = [
    { value: "recent", label: "最近阅读" },
    { value: "name", label: "名称" },
    { value: "fav", label: "收藏优先" },
    { value: "time", label: "按时间↓" },
    { value: "timeasc", label: "按时间↑" }
  ];
  function renderSortSel() {
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
  if (elBtnFilter) elBtnFilter.onclick = function () {
    var open = elFilterPanel.classList.toggle("open");
    elBtnFilter.classList.toggle("on", open);
    var txt = document.getElementById("btn-filter-txt");
    if (txt) txt.textContent = open ? "筛选 ▴" : "筛选 ▾";
  };
  setupFRowToggles();

  var wheelAcc = 0, wheelLock = 0;
  function onWheel(e) {
    if (S.zoom) {   // 缩放状态: 普通滚轮同样是缩放(以光标为锚点), 绝不翻页
      e.preventDefault();
      var zz0 = S.zscale || 1;
      var zz = Math.max(0.2, Math.min(8, zz0 + (e.deltaY < 0 ? 0.1 : -0.1)));
      if (Math.abs(zz - zz0) > 0.001) {
        var rr = elStage.getBoundingClientRect();
        zoomAt(zz, e.clientX - rr.left, e.clientY - rr.top);
        hint("缩放 " + Math.round(zz * 100) + "%");
      }
      return;
    }
    if (!S.wheel || S.mode === "scroll" || e.ctrlKey) return;
    if (rightDown || (e.buttons & 2)) return;   // 右键按下时滚轮是缩放, 不翻页
    // 若当前页比视口高(适宽/原始模式), 先把这一页滚完再翻页
    if (elStage.scrollHeight > elStage.clientHeight + 4) {
      var atTop = elStage.scrollTop <= 1;
      var atBot = elStage.scrollTop + elStage.clientHeight >= elStage.scrollHeight - 2;
      if (e.deltaY > 0 && !atBot) return;
      if (e.deltaY < 0 && !atTop) return;
    }
    e.preventDefault();
    var now = Date.now();
    if (now < wheelLock) return;
    wheelAcc += (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);   // 行滚动的浏览器换算成像素
    if (Math.abs(wheelAcc) < 18) return;                          // 原来 40: 轻轻一滚就能翻页
    var goNext = wheelAcc > 0;
    wheelAcc = 0;
    wheelLock = now + 90;                                         // 原来 180ms: 连滚更跟手
    if (goNext) nextPage(); else prevPage();
  }
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

  document.addEventListener("keydown", function (e) {
    if (e.target && e.target.tagName === "INPUT") return;
    if (elModal && elModal.classList.contains("on")) { if (e.key === "Escape") closeModal(); return; }
    if (!comic) {
      if (e.key === "/") { e.preventDefault(); elSearch.focus(); return; }
      if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); SEL = visibleDirs(); renderShelf(); hint("已全选当前视图 " + SEL.length + " 本"); return; }
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
    if (k === "f" || k === "F") { document.getElementById("bfull").onclick(); return; }
    if (k === "s" || k === "S") { S.sidebar = !S.sidebar; syncButtons(); save(); saveReaderDefaults(); return; }
    if (k === "p" || k === "P") { S.thumbs = !S.thumbs; render(); saveReaderDefaults(); return; }
  });

  function afterBoot() {
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

  try { window.addEventListener("beforeunload", function () { saveShelfView(true); }); } catch (e) {}

  window.mlBooted = false;
  if (DISK) {
    DISK.getAll().then(function (d) {
      LIBROOT = d.libRoot || "";
      if (DISK.onDownload) DISK.onDownload(onDlEvent);
      if (DISK.onLibraryRebuilt) DISK.onLibraryRebuilt(function () {
        // 离线重建完成: 保存滚动位置后刷新(滚动恢复逻辑会自动对准)
        saveShelfView(true);
        location.reload();
      });
      CACHE = d.progress || {};
      LIBRARY = (d.library && d.library.comics) ? d.library : { version: 1, categories: ["在看", "想读", "已读完"], comics: {} };
      if (!LIBRARY.categories) LIBRARY.categories = ["在看", "想读", "已读完"];
      window.mlBooted = true;
      requestAnimationFrame(function () { setTimeout(afterBoot, 0); });   // 先让出一帧, 让书页骨架先画出来(否则主线程一路占着, 首帧要等卡片全建完)
    }).catch(function (err) {
      window.mlBootError = String(err && err.message || err);
      CACHE = {}; LIBRARY = { version: 1, categories: [], comics: {} };
      window.mlBooted = true;
      requestAnimationFrame(function () { setTimeout(afterBoot, 0); });   // 先让出一帧, 让书页骨架先画出来(否则主线程一路占着, 首帧要等卡片全建完)
    });
  } else {
    window.mlBooted = true;
    requestAnimationFrame(function () { setTimeout(afterBoot, 0); });   // 先让出一帧, 让书页骨架先画出来(否则主线程一路占着, 首帧要等卡片全建完)
  }
})();
