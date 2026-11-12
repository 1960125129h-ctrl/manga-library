// 设置面板
//
// 这是从 core.js 抽出来的第一个"域", 用的是"工厂 + 上下文"模式:
//   · 属于这个域的: SET_DEFAULT / SET / applySettings / autoCardW / cardWForCols / openSettings
//   · 它需要 core 提供的几个函数, 通过 initSettings(ctx) 注入, 用**同名模块级 let** 接住 ——
//     这样搬过来的代码可以逐字不变(裸标识符照样解析), 不用把调用点改成 ctx.xxx
//   · 通用件(模态框/提示/localStorage/文本)直接从 shared/ import
//
// SET 用 export let: 重置按钮会整体替换它, core 那边靠实时绑定始终看到最新对象。

import { hint, showModal, closeModal, modalFoot } from '../shared/ui.js';
import { getBgHist, setBgHist } from '../shared/storage.js';
import { normName } from '../shared/text.js';
import { showGuide } from '../shell/guide.js';

// ---- 由 core 注入的同名依赖(别改名字, 改了搬来的代码就找不到) ----
let DISK = null, renderShelf, renderCatTabs, invalidateAllCards, authorGroups,
    saveAliasMap, mergeAuthorInto, mergeAuthorDialog, autoTagsAll, dupDialog;

export function initSettings(c) {
  const o = c || {};
  DISK = o.DISK || null;
  renderShelf = o.renderShelf;
  renderCatTabs = o.renderCatTabs;
  invalidateAllCards = o.invalidateAllCards;
  authorGroups = o.authorGroups;
  saveAliasMap = o.saveAliasMap;
  mergeAuthorInto = o.mergeAuthorInto;
  mergeAuthorDialog = o.mergeAuthorDialog;
  autoTagsAll = o.autoTagsAll;
  dupDialog = o.dupDialog;
}

export const SET_DEFAULT = {
flyAnim: true, cols: 10, acols: 2, author: true, cardW: 176, gap: 12, pad: 12, tScale: 0.072, radius: 16, fit: 'contain', sbw: 11, tags: true, src: true, prog: true, star: true, sticky: true, totop: true, note: true, autoFit: true, netAlias: false, iconOnly: false, catIcons: true, catLabels: true, barAutohide: false, dlPreview: false };

export let SET = (function () {
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

export function applySettings() {
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

export function openSettings() {
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
    // 使用引导入口(随时重看首次引导)
    var guideRow = document.createElement('div');
    guideRow.style.cssText = 'margin:-4px 0 10px'
    var guideBtn = document.createElement('button');
    guideBtn.className = 'btn ghost';
    guideBtn.textContent = '使用引导（怎么加书 / 怎么操作）';
    guideBtn.onclick = function () { closeModal(); setTimeout(function () { showGuide(true); }, 200); };
    guideRow.appendChild(guideBtn);
    // 版本 + 检查更新
    var verRow = document.createElement('div');
    verRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:-6px 0 10px;font-size:12px;color:var(--fg2)'
    var verTxt = document.createElement('span'); verTxt.textContent = '版本 …';
    var updBtn = document.createElement('button'); updBtn.className = 'btn ghost'; updBtn.textContent = '检查更新';
    updBtn.onclick = async function () {
      updBtn.disabled = true; updBtn.textContent = '检查中…';
      var r = null;
      try { r = await DISK.checkUpdate(); } catch (e) {}
      updBtn.disabled = false; updBtn.textContent = '检查更新';
      if (!r || !r.ok) { hint('检查更新失败：' + ((r && r.msg) || '网络不可用')); return; }
      if (!r.hasUpdate) { hint('已是最新版本 ' + r.current); return; }
      hint('发现新版本 ' + r.latest);
      try { await DISK.promptUpdate(); } catch (e) {}
    };
    verRow.appendChild(verTxt); verRow.appendChild(updBtn);
    if (DISK && DISK.appVersion) {
      try { DISK.appVersion().then(function (v) { verTxt.textContent = '版本 ' + v; }).catch(function () {}); } catch (e) {}
    }
    box.appendChild(guideRow);
    box.appendChild(verRow);
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
    // 下载
    var dlSep = document.createElement('div');
    dlSep.style.cssText = 'border-top:1px solid var(--border);margin:14px 0 8px;padding-top:10px;font-weight:600';
    dlSep.textContent = '下载';
    pAdvanced.appendChild(dlSep);
    var ehLbl = document.createElement('label'); ehLbl.textContent = 'E-Hentai 画质档位'; pAdvanced.appendChild(ehLbl);
    var ehSel = document.createElement('select');
    [['standard', '降级档（站点压缩版，快，默认）'], ['original', '原图（按站点标注的原始尺寸，单张几 MB~十几 MB，很慢）']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; ehSel.appendChild(op);
    });
    pAdvanced.appendChild(ehSel);
    var ehHint = document.createElement('div'); ehHint.className = 'hint';
    ehHint.textContent = 'EH 对高频 IP 只给压缩过的降级档；选原图会走 /fullimg 拿上传者原本的文件 —— 每张的尺寸和体积都不一样（站点在页面上标注），速度约慢 5~10 倍。原图拿不到时自动退回降级档。只影响 EH。';
    pAdvanced.appendChild(ehHint);
    (function () {
      var api = (window.mangaLib && window.mangaLib.downloadPrefs);
      if (!api) { ehSel.disabled = true; ehHint.textContent += '（需要桌面版）'; return; }
      api.get().then(function (j) { ehSel.value = (j && j.ehQuality === 'original') ? 'original' : 'standard'; }).catch(function () {});
      ehSel.onchange = function () { api.set({ ehQuality: ehSel.value }); ehHint.textContent = (ehSel.value === 'original' ? '已切到原图：按站点标注的原始尺寸下载，会明显变慢。' : '已切回降级档：下载快，画质是站点压缩过的版本。') + '（对下一本生效）'; };
    })();

    // 工具（原来靠根目录的两个 .cmd）
    var toolSep = document.createElement('div');
    toolSep.style.cssText = 'border-top:1px solid var(--border);margin:14px 0 8px;padding-top:10px;font-weight:600';
    toolSep.textContent = '工具';
    pAdvanced.appendChild(toolSep);
    var toolRow = document.createElement('div');
    toolRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:4px 0';
    var impBtn = document.createElement('button'); impBtn.className = 'btn ghost'; impBtn.textContent = '扫描下载文件夹并收录';
    impBtn.title = '扫 Downloads 里的 <id>.zip，自动反查书名后入库（需要调试浏览器，会自动拉起来）';
    var clrBtn = document.createElement('button'); clrBtn.className = 'btn ghost'; clrBtn.textContent = '清理浏览器缓存';
    clrBtn.title = '只删缓存目录，不会动 Cookies / 登录态';
    toolRow.appendChild(impBtn); toolRow.appendChild(clrBtn);
    pAdvanced.appendChild(toolRow);
    var toolOut = document.createElement('div'); toolOut.className = 'hint';
    toolOut.style.cssText = 'white-space:pre-wrap;max-height:120px;overflow-y:auto;display:none;margin-top:6px';
    pAdvanced.appendChild(toolOut);
    (function () {
      var api = (window.mangaLib && window.mangaLib.tools);
      if (!api) { impBtn.disabled = true; clrBtn.disabled = true; toolOut.style.display = 'block'; toolOut.textContent = '（需要桌面版）'; return; }
      function show(txt, bad) {
        toolOut.style.display = 'block';
        toolOut.style.color = bad ? '#ff8a80' : '';
        toolOut.textContent = txt;
      }
      function tail(s, n) { return String(s || '').split(/\r?\n/).filter(Boolean).slice(-(n || 6)).join('\n'); }
      impBtn.onclick = async function () {
        impBtn.disabled = true; var old = impBtn.textContent; impBtn.textContent = '扫描中…';
        show('正在扫描下载文件夹…（第一次会先把调试浏览器拉起来，可能要几十秒）');
        var r2 = await api.importZips();
        impBtn.disabled = false; impBtn.textContent = old;
        show(((r2 && r2.ok) ? '完成。' : '未成功（退出码 ' + (r2 && r2.code) + '）。') +
          (r2 && r2.dir ? '\n目录: ' + r2.dir : '') + (r2 && r2.browser ? '' : '\n注意: 调试浏览器没起来，反查书名会失败') +
          (tail(r2 && r2.out) ? '\n' + tail(r2 && r2.out) : ''), !(r2 && r2.ok));
      };
      clrBtn.onclick = async function () {
        clrBtn.disabled = true; var old2 = clrBtn.textContent; clrBtn.textContent = '清理中…';
        show('正在清理缓存目录（不会动登录态）…');
        var r2 = await api.clearProfile();
        clrBtn.disabled = false; clrBtn.textContent = old2;
        show(((r2 && r2.ok) ? '完成。' : '未完成。') + (tail(r2 && r2.out) ? '\n' + tail(r2 && r2.out) : ''), !(r2 && r2.ok));
      };
    })();

    var netChk = chk(pAdvanced, 'netAlias', '联网刷新别名');
    netChk.title = '更新书库时补日/英别名';
    var netHint = document.createElement('div'); netHint.className = 'sub';
    netHint.textContent = '联网刷新：新书名第一次出现时补日/英别名，之后缓存。';
    pAdvanced.appendChild(netHint);

    if (DISK && DISK.webStatus) {
    var webSep = document.createElement('div'); webSep.style.cssText = 'border-top:1px solid var(--border);margin:12px 0;padding-top:10px;font-weight:600;font-size:14px';
    webSep.textContent = '局域网访问（手机看书库）';
    pAdvanced.appendChild(webSep);
    var webPwRow = document.createElement('div'); webPwRow.style.cssText = 'margin:6px 0;display:flex;gap:8px;align-items:center';
    var webPwLbl = document.createElement('span'); webPwLbl.textContent = '密码:';
    var webPwInput = document.createElement('input'); webPwInput.type = 'password'; webPwInput.placeholder = '设置访问密码';
    webPwInput.style.cssText = 'flex:1;padding:6px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--fg)';
    webPwRow.appendChild(webPwLbl); webPwRow.appendChild(webPwInput);
    pAdvanced.appendChild(webPwRow);

    var webPortRow = document.createElement('div'); webPortRow.style.cssText = 'margin:6px 0;display:flex;gap:8px;align-items:center';
    var webPortLbl = document.createElement('span'); webPortLbl.textContent = '端口:';
    var webPortInput = document.createElement('input'); webPortInput.type = 'number'; webPortInput.min = '1024'; webPortInput.max = '65535'; webPortInput.value = '9580';
    webPortInput.title = '自定义局域网访问端口';
    webPortInput.style.cssText = 'width:120px;padding:6px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--surface2);color:var(--fg)';
    webPortRow.appendChild(webPortLbl); webPortRow.appendChild(webPortInput);
    pAdvanced.appendChild(webPortRow);
    var webPortHint = document.createElement('div'); webPortHint.className = 'sub';
    webPortHint.textContent = '端口修改后，服务运行中点“重启应用”生效。';
    pAdvanced.appendChild(webPortHint);

    var webBtnRow = document.createElement('div'); webBtnRow.style.cssText = 'display:flex;gap:8px;margin:8px 0';
    var webBtn = document.createElement('button'); webBtn.className = 'btn ghost'; webBtn.textContent = '开启';
    var webApplyBtn = document.createElement('button'); webApplyBtn.className = 'btn ghost'; webApplyBtn.textContent = '重启应用'; webApplyBtn.style.display = 'none';
    webBtnRow.appendChild(webBtn); webBtnRow.appendChild(webApplyBtn);
    pAdvanced.appendChild(webBtnRow);
    var webInfo = document.createElement('div'); webInfo.style.cssText = 'margin:6px 0;padding:8px;background:#1a2a1a;border-radius:6px;font-size:13px;display:none;line-height:1.6';
    pAdvanced.appendChild(webInfo);
    var webCurrent = null;

    function validPort() {
      var port = Number.parseInt(webPortInput.value, 10);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        hint('端口需为 1024 到 65535 之间的整数');
        return null;
      }
      return port;
    }
    function showWebInfo(st) {
      webInfo.style.display = 'block';
      webInfo.innerHTML = '已开启<br>手机浏览器打开:<br><b style="color:#4f8;font-size:16px">http://' + st.ip + ':' + st.port + '</b><br>密码: ' + (st.password || '无密码');
    }
    function setRunningUI(st) {
      webCurrent = st;
      webBtn.textContent = '关闭';
      webApplyBtn.style.display = 'inline-block';
      webPwInput.value = st.password || '';
      webPortInput.value = st.port || 9580;
      showWebInfo(st);
    }
    function setStoppedUI() {
      webCurrent = null;
      webBtn.textContent = '开启';
      webApplyBtn.style.display = 'none';
      webInfo.style.display = 'none';
    }
    async function startWeb() {
      var pw = webPwInput.value.trim();
      var port = validPort(); if (!port) return;
      var r = await DISK.webStart({ password: pw, port: port });
      if (r.ok) setRunningUI({ ip: r.ip, port: r.port, password: pw });
      else hint('启动失败: ' + r.msg);
    }
    async function restartWeb() {
      var pw = webPwInput.value.trim() || (webCurrent && webCurrent.password) || '';
      var port = validPort(); if (!port) return;
      var r = await DISK.webStart({ password: pw, port: port });
      if (r.ok) setRunningUI({ ip: r.ip, port: r.port, password: pw });
      else hint('重启失败: ' + r.msg);
    }
    async function webToggle() {
      if (webBtn.textContent === '开启') await startWeb();
      else { await DISK.webStop(); setStoppedUI(); }
    }
    webBtn.onclick = webToggle;
    webApplyBtn.onclick = restartWeb;
    DISK.webStatus().then(function (st) {
      if (st.running) setRunningUI(st);
      else { webPortInput.value = st.port || 9580; webPwInput.value = st.password || ''; }
    });
    }


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
