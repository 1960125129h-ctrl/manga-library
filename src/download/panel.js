// 下载面板

//

// 从 core.js 抽出来的第二个域, 手法同 settings/panel.js:

//   · 属于这个域的: 下载弹窗三个页签 / 页预览 / 容器作品列表 / 批量下载 / 下载状态与进度

//   · core 提供的东西通过 initDownload(ctx) 注入, 用**同名模块级 let** 接住 -> 搬来的代码逐字不变

//   · 通用件从 shared/ import

//

// 有一类东西要特别小心: **会被重新赋值的状态**(JM_BUSY/JM_LOGEL/JmQRender/dlState)。

// 用 let X = ctx.X 接住只会拿到"快照", core 之后改了就不同步 -> 静默错行为。

// 所以这几个直接由本模块持有(export let), core 那边要用 setter 改。

// 只赋值一次的状态(DISK/DL_SVG/JM_LOG/PVQ/PV_TILE_W)才能按值注入。



import { hint, showModal, closeModal } from '../shared/ui.js';

import { fmtBytes } from '../shared/format.js';
import { hostOf } from '../shared/url.js';
import { SET } from '../settings/panel.js';   // 读用户那个 下载前预览 开关
import { LIBRARY } from '../app/state.js';     // 下载完要按当前书库判断是否已入库



// ---- 由 core 注入(同名接住) ----

let DISK = null, DL_SVG, JM_LOG, PVQ, PV_TILE_W;

let PVCLOSE, card, jmAppend, libEntry, libSave, pages, prog, runInBackground, showChapterPicker, syncJmBtn, doRebuild;



export function initDownload(c) {

  const o = c || {};

  DISK = o.DISK || null;

  DL_SVG = o.DL_SVG; JM_LOG = o.JM_LOG; PVQ = o.PVQ; PV_TILE_W = o.PV_TILE_W;

  PVCLOSE = o.PVCLOSE; card = o.card; jmAppend = o.jmAppend; libEntry = o.libEntry; libSave = o.libSave;

  pages = o.pages; prog = o.prog; runInBackground = o.runInBackground;

  showChapterPicker = o.showChapterPicker; syncJmBtn = o.syncJmBtn; doRebuild = o.doRebuild;

}



// ---- 本域自己的、会被重新赋值的状态 ----

export let JM_BUSY = false;    // 禁漫任务在跑(弹窗里的按钮状态靠它)

export let JM_LOGEL = null;    // 下载日志的 DOM 节点

export let JmQRender = null;   // 弹窗开着时的队列渲染函数

export let dlState = null;     // 当前下载任务的 UI 句柄(进度条/步骤条/日志)

export function setJmBusy(v) { JM_BUSY = v; }   // core 里也有改它的地方, 走 setter



export function openDownload(tab) {
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
    t2.title = "18comic：自动过验证码、逐话下载、切页校验、入库";
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

export function buildGeneralPane(box, presetUrl, onResolved) {
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
               running: false, total: 0, doneCh: 0, curSeq: 0, imgs: 0, bytes: 0,
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
        S2.total = data.total || 0; S2.doneCh = data.doneCh || 0; S2.curSeq = data.curSeq || 0; S2.imgs = data.imgs || 0; S2.bytes = data.bytes || 0;
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

export function buildJmPane(box) {
    if (!DISK || !DISK.jmStart) { hint("需要桌面版：请用「启动书库.cmd」打开"); return; }
    var s = document.createElement("div"); s.className = "sub";
    s.textContent = "支持：JM 编号（如 JM1452133）、纯数字（1452133）、专辑链接、单话链接（/photo/<id>），多个用空格或换行分开；换镜像域名也认编号。自动完成：过 CF → 点免等关广告 → 识别验证码 → 逐话下载 → 切页拼合+像素校验 → 入库 → 重建书库，已入库的自动跳过。";
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

export function showPagePreview(S2, r, later, ui, ni, fi, ti, mc, cancelBtn, goBtn, bgBtn, bar, pct, log) {
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

export function showWorkList(S2, r, items, ui, ni, fi, ti, mc, cancelBtn, goBtn, bgBtn, bar, pct, log) {
  var box = S2.box;
  var isTag = !!r.galleries;
  var pageUrl = r.url || "";
  box.querySelectorAll("label,input,.sub,.chk,#dlbar,#dlinfo,#dlsteps,#dllog,#mfoot").forEach(function (x) { x.style.display = "none"; });

  var states = items.map(function (it) {
    return { it: it, checked: false, expanded: false, pgrid: null, loading: false, card: null,
             name: (it.title || (isTag ? "画廊" : String(it.id || "作品"))) };
  });
  // ---- pixiv 作品封面: 列表接口不带封面, 必须逐本查(有 400ms 节流+限流续跑) → 滚到才拉 + 本地缓存 ----
  var needCover = {}, askedCover = {}, askedN = 0, gotN = 0, warned = false, gotIds = {}, failedCoverIds = {};
  function addCoverRetryButton() {
    if (document.getElementById('retry-cover-btn')) return;
    var b = document.createElement('button');
    b.id = 'retry-cover-btn';
    b.className = 'btn ghost';
    b.textContent = '重试未取到的封面';
    b.style.marginLeft = '8px';
    b.onclick = function () {
      for (var k in failedCoverIds) delete askedCover[k];
      failedCoverIds = {};
      askCovers();
      hint('正在重试未取到的封面…');
    };
    if (toolbar) toolbar.appendChild(b);
  }
  if (window.mangaLib && DISK.pickDetails && DISK.onPickDetail) {
    DISK.onPickDetail(function (d) {
      if (d && d.rate) { hint(d.msg || 'Pixiv 限流，正在续跑，稍后自动重试'); return; }
      if (d && d.error) { failedCoverIds[String(d.id)] = 1; return; }
      if (!d || d.done) {   // 全部队列查完了
        var missing = askedN - gotN;
        for (var kk in needCover) {
          if (gotIds[kk]) continue;
          var rf = needCover[kk];
          failedCoverIds[kk] = 1;
          try {
            rf.img.style.background = "#3a1d1d";
            if (rf.img.parentNode && rf.img.parentNode.style) rf.img.parentNode.style.outline = "1px solid #a33";
            if (rf.title && !rf.title.getAttribute("data-missing")) { rf.title.textContent = rf.title.textContent + "（封面/标题取不到）"; rf.title.setAttribute("data-missing", "1"); }
          } catch (e) {}
        }
        if (missing > 0 && !warned) {
          warned = true;
          hint((d && d.rate) ? ('Pixiv 限流后还有 ' + missing + ' 本未取到，可点“重试未取到的封面”继续补') : ('有 ' + missing + ' 本取不到封面/标题，可点“重试未取到的封面”重试'));
          addCoverRetryButton();
        }
        return;
      }
      gotN++;
      gotIds[String(d.id)] = 1;
      delete failedCoverIds[String(d.id)];
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
      else if (ev.type === "work-start") { line((ev.index + 1) + "/" + ev.total + "　" + ev.title); if (dlinfoL) dlinfoL.textContent = "第 " + (ev.index + 1) + " / " + ev.total + " 本　" + ev.title; }
      else if (ev.type === "work-done") { line((ev.ok ? "完成 " : "失败 ") + (ev.index + 1) + "/" + ev.total + "　" + ev.title + (ev.ok ? ("　" + (ev.images || 0) + " 张") : "　失败"), ev.ok ? "#8bc98b" : "#e08a8a"); }
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

export function showPickList(S2, r, items, ui, ni, fi, ti, mc, cancelBtn, goBtn, bgBtn, bar, pct, log) {
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
    if (bd3) { bd3.classList.add("running"); bd3.textContent = "下载中…"; }
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

export function onDlEvent(ev) {
  var s = dlState;
  if (!s || !s.running) return;
  if (ev.src) s.src = ev.src === "jm" ? "jm" : "dl";   // 取消下载要按来源选接口
  if (ev.type === "start") {
    s.total = ev.total; s.doneCh = 0; s.curSeq = 0; s.imgs = 0; s.bytes = 0;
    s.head.textContent = "共 " + ev.total + " 话，开始下载…";
    dlSetStage(s, 0, "正在数页数…", 0);
    dlLog(s, "输出目录: " + ev.out);
  } else if (ev.type === "chapter-start") {
    s.curSeq = (s.curSeq || 0) + 1;
    s.head.textContent = (s.total ? "[" + s.curSeq + "/" + s.total + "] " : "") + ev.label + "  准备中…";
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
    s.head.textContent = (s.total ? "[" + (s.curSeq || (ev.index + 1)) + "/" + s.total + "] " : "") + ev.label + "  " + ev.done + "/" + ev.images;
  } else if (ev.type === "chapter-done") {
    s.doneCh = s.curSeq || (ev.index + 1); s.imgs += ev.got; s.bytes += ev.bytes;
    dpSet(s, s.doneCh, s.total);
    dlSetStage(s, 3, "正在整理书库…", 95);
    dlLog(s, "[" + ev.label + "] " + ev.got + "/" + ev.expected + " 张  " + fmtBytes(ev.bytes) +
      "  " + (ev.widths.join("/") || "?") + "px" + (ev.cbz ? "  +CBZ" : "") +
      (ev.failed.length ? "  !! 缺页 " + ev.failed.length : ""), ev.failed.length ? "er" : "ok");
  } else if (ev.type === "chapter-error") {
    s.doneCh = s.curSeq || (ev.index + 1); dpSet(s, s.doneCh, s.total);
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
    dlSetStage(s, 4, "下载完成", 100);
    dlLog(s, "合计: " + sum.chapters + " 话 / " + sum.images + " 张 / " + fmtBytes(sum.bytes) + (s.incr ? "（已增量重建）" : ""), "ok");
    dlDone(s, true);
  }
  dlSnap(s);   // 事件处理完再存, 快照才是最新一步(存早了会慢一拍)
}

export function dlDone(s, ok) {
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
          location.reload();   // 后端已完成增量重建，只刷新一次，不再重复触发重建
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
      location.reload();   // 后端已完成增量重建，只刷新一次，不再重复触发重建
    };
    // 放到列表页脚那一排(和 取消/[下载选中] 同排), 不再单独挤在 #mfoot 里
    var lf = s.box ? s.box.querySelector("[id^='listfoot']") : null;
    if (lf) lf.insertBefore(b, lf.firstChild); else s.foot.insertBefore(b, s.foot.firstChild);
  }
}

export function dlLog(s, t, cls) {
  if (!s || !s.log) return;
  var d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = t;
  s.log.appendChild(d);
  s.log.scrollTop = s.log.scrollHeight;
}

export function dpSet(s, done, total) {
  if (!s || !s.bar) return;
  s.bar.style.width = (total ? Math.round(done / total * 100) : 0) + "%";
  if (s.pct) s.pct.textContent = "进度 " + done + " / " + total + " 话";
}

export function dlSetStage(s, n, label, pct) {
  if (!s || !s.stepEls) return;
  for (var i = 0; i < s.stepEls.length; i++) {
    s.stepEls[i].className = i < n ? "ok" : (i === n ? "now" : "");
  }
  if (s.dlinfoL) s.dlinfoL.textContent = label || "";
  if (s.dlinfoR) s.dlinfoR.textContent = (pct != null ? pct + "%" : "");
}

export function dlSnap(s) {
  if (!s || !s.running) return;
  if (!window._dlProgress) window._dlProgress = {};
  var p = window._dlProgress;
  p.total = s.total; p.doneCh = s.doneCh; p.curSeq = s.curSeq || 0; p.imgs = s.imgs; p.bytes = s.bytes;
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

export function buildPageGrid(host, r, pages) {
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

export function PVWATCH(img, pg, root) {
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

export function PVQPUMP() {
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

export function PVSPRITE(img, pg) { return; }
