// 跨域的小动作: 下载日志追加 / 预览队列关闭 / 重建书库 / 转后台 / 章节选择器 / 下载按钮同步
//
// 从 core.js 的 IIFE 闭包里搬出来的(渐进式重构)。这几个是抽完各域之后剩下的散件 ——
// 每个都只有几百字节, 但都真实被界面在用, 所以没有理由继续留在 core 里。
//
// 状态归属(这批的关键):
//   · JM_LOG —— 只被 jmAppend 写; core 要把它传给 initDownload, 所以 export 成实时绑定。
//   · JQ(下载队列快照)—— core 顶层的订阅回调里会**整体重新赋值**它, 而那个回调
//     还没搬走, 所以这里必须给 setter(setJQ), 不能靠按值注入(那只会拿到快照)。
//     这是"状态归谁持有"的第三种情况: 读写点分属两个模块时, 谁持有都要给对方一个口子。

import { JM_LOGEL, JM_BUSY, openDownload } from '../download/panel.js';
import { SET } from '../settings/panel.js';
import { closeModal, hint } from '../shared/ui.js';

// ---- 本模块持有的状态 ----
export let JM_LOG = "";   // 下载日志留在内存, 弹窗关了再打开还能看(只被 jmAppend 写)
export let JQ = null;      // 下载队列快照(core 顶层的订阅回调负责灌进来 -> setJQ)
export function setJQ(v) { JQ = v; }

export function jmAppend(t) { JM_LOG += t; if (JM_LOGEL && JM_LOGEL.isConnected) { JM_LOGEL.textContent = JM_LOG; JM_LOGEL.scrollTop = JM_LOGEL.scrollHeight; } }
export function syncJmBtn() {
  var b = document.getElementById("btn-download");
  if (!b) return;
  var n = 0;
  if (JQ && JQ.items) for (var i = 0; i < JQ.items.length; i++) if (JQ.items[i].status === "wait" || JQ.items[i].status === "run") n++;
  var busy = JM_BUSY || !!(JQ && JQ.running);
  b.innerHTML = DL_SVG + (busy ? "下载中…" : "下载漫画") + (n ? " (" + n + ")" : "");
  b.title = busy ? "下载中…（点开看队列）" : (n ? "下载队列里还有 " + n + " 本未完成" : "下载漫画：通用站点链接 / 禁漫天堂（两个页签）");
}   // 书目录修改时间(桌面版提供), 用于"按时间排序"
export function PVCLOSE() {
  PVQ.pending.length = 0;
  PVQ.obs.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
  PVQ.obs.length = 0;
}
export function showChapterPicker(S2, r, cl, ui, ni, st, goBtn, onStart) {
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
export function runInBackground() {
  closeModal();
  var bd = document.getElementById("btn-download");
  if (bd) { bd.classList.add("running"); bd.textContent = "下载中…"; }
  hint("已转到后台继续下载，点顶栏「下载中…」可以看进度");
}
export async function doRebuild() {
  if (!DISK) { hint("需要桌面版"); return; }
  hint("正在重建书库…");
  var r = await DISK.rescan({ offline: !SET.netAlias });
  if (!r || !r.ok) hint("重建失败: " + ((r && r.msg) || "未知错误"));
}

// ---- 由 core 注入 ----
let DISK, PVQ, DL_SVG;   // DL_SVG 是下载按钮里的那个图标 SVG 串

export function initAppActions(ctx) {
  DISK = ctx.DISK; PVQ = ctx.PVQ; DL_SVG = ctx.DL_SVG;
}
