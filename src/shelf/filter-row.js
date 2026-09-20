// 书架的筛选行(作者 / 平台 / 作品 三行可折叠的 chip 行)
//
// 含: 三行的展开/收起动画、状态回填、以及书架浏览状态的持久化。
// viewTimer 原本是 core 闭包里的, 但它只服务 saveShelfView, 所以跟着搬进来做模块私有变量。

import { S, elGrid } from '../app/state.js';
import { VIEW_KEY } from '../shared/storage.js';

let viewTimer = 0;

export function saveShelfView(now) {
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

export function setupFRowToggles() {
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

export function applyFRowState() {
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

export function animateFRow(row, open) {
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
