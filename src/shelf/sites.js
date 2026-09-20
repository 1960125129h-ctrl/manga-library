// 站点相关: 站点目录 / 跨站搜索 / 检查更新 / 快速下载
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 7 批)。
// 五个函数共 15.2K, 依赖只有 jmAppend/syncJmBtn + DISK。
//
// 注意 multiUpdate 和 checkUpdate 是 async 函数。

import { openDownload, setJmBusy } from '../download/panel.js';
import { manifestOf } from '../library/store.js';
import { showModal, hint, closeModal } from '../shared/ui.js';
import { SITES, SS_SITES } from './site-data.js';

export function openSitesDialog() {
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
export async function multiUpdate(dir) {
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
export async function checkUpdate(dir) {
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
      setJmBusy(true); syncJmBtn();
      var r2 = await DISK.jmFetchBook(dir);
      if (!r2 || !r2.ok) { setJmBusy(false); syncJmBtn(); jmAppend("[错误] " + ((r2 && r2.msg) || "启动失败") + "\n"); }
    };
  });
}
export function quickDownload(url) {
  closeModal();
  openDownload("general");
  setTimeout(function () {
    var el2 = document.getElementById("dl-url");
    if (el2) { el2.value = url; hint("地址已填好，点「开始下载」即可"); }
    else hint("把地址贴进下载框: " + url);
  }, 120);
}
export function openSiteSearch(prefill) {
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

// ---- 由 core 注入 ----
let jmAppend, syncJmBtn, DISK;

export function initShelfSites(ctx) {
  jmAppend = ctx.jmAppend; syncJmBtn = ctx.syncJmBtn; DISK = ctx.DISK
}
