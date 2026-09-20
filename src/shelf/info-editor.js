// 书的简介/来源 与 分类标签编辑器
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构 · 书架域第 8 批)。
// 依赖: save(存进度) + DISK。

import { LIBRARY } from '../app/state.js';
import { libEntry, libSave } from '../library/store.js';
import { hint, showModal, modalFoot, closeModal } from '../shared/ui.js';
import { hostOf } from '../shared/url.js';
import { invalidateCard, renderShelf } from '../shelf/render.js';
import { copyText } from '../shelf/util.js';

export function openEditor(dir) {
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
export function openInfo(dir) {
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

// ---- 由 core 注入 ----
let save, DISK;

export function initShelfInfoEditor(ctx) {
  save = ctx.save; DISK = ctx.DISK
}
