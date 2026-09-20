// 模态框与提示条
//
// 原本挤在 core.js 的闭包里, 依赖 elModal / elHint / hintTimer 和下载状态。
// 抽出来后:
//   · DOM 自己按 id 懒查 —— 不依赖加载顺序, 也不怕元素被重建
//   · "是否正在下载"和"转到后台"由外部注入(setModalHooks), 这里不反向依赖下载模块
//
// 这样一来 core.js 里那几十处 hint()/showModal()/closeModal() 的调用点一行都不用改。

let busyProbe = null;        // () => boolean
let backgroundHook = null;   // () => void
let haptic = null;           // 保留给将来: 提示音/震动之类

// 由 core 在启动时注入(见下方 setModalHooks 调用处)
export function setModalHooks(opts) {
  const o = opts || {};
  if (typeof o.isBusy === 'function') busyProbe = o.isBusy;
  if (typeof o.toBackground === 'function') backgroundHook = o.toBackground;
  if (typeof o.haptic === 'function') haptic = o.haptic;
}

const modalEl = () => document.getElementById('modal');
const hintEl = () => document.getElementById('hint');
let hintTimer = 0;

// 顶部一闪而过的提示
export function hint(msg) {
  const el = hintEl();
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(function () { el.classList.remove('show'); }, 1100);
  if (haptic) { try { haptic(); } catch (e) {} }
}

// 打开模态框: build 收到一个空的 #mbox 容器, 往里塞内容
export function showModal(build) {
  const el = modalEl();
  if (!el) return;
  el.innerHTML = '';
  const box = document.createElement('div');
  box.id = 'mbox';
  el.appendChild(box);
  el.classList.add('on');
  // 点遮罩空白处关闭: 按下与抬起都在遮罩上才算, 防止拖选误关
  let downOnOverlay = false;
  el.onmousedown = function (ev) { downOnOverlay = (ev.target === el); };
  el.onmouseup = function (ev) {
    if (!(downOnOverlay && ev.target === el)) { downOnOverlay = false; return; }
    downOnOverlay = false;
    // 下载中: 收起来继续下, 不中断
    if (busyProbe && busyProbe()) { if (backgroundHook) backgroundHook(); return; }
    closeModal();
  };
  build(box);
}

export function closeModal() {
  // 预览结束 -> 清掉本次预览的缩略图缓存
  try { if (window.mangaLib && window.mangaLib.previewEnd) window.mangaLib.previewEnd(); } catch (e) {}
  const el = modalEl();
  if (!el) return;
  el.classList.remove('on');
  setTimeout(function () { if (!el.classList.contains('on')) el.innerHTML = ''; }, 500);
}

// 模态框底部的 取消/确定 栏
export function modalFoot(box, onOk, okLabel) {
  const foot = document.createElement('div');
  foot.id = 'mfoot';
  box.appendChild(foot);
  const c = document.createElement('button');
  c.className = 'btn ghost';
  c.textContent = '取消';
  const o = document.createElement('button');
  o.className = 'btn';
  o.textContent = okLabel || '确定';
  foot.appendChild(c);
  foot.appendChild(o);
  c.onclick = closeModal;
  o.onclick = onOk;
  return { cancel: c, ok: o };
}

// 要一个字符串
export function askText(title, def, cb) {
  showModal(function (box) {
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = def || '';
    box.appendChild(inp);
    const f = modalFoot(box, function () { const v = inp.value.trim(); closeModal(); if (v) cb(v); });
    inp.onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') f.ok.click();
      else if (e.key === 'Escape') closeModal();
    };
    setTimeout(function () { inp.focus(); inp.select(); }, 30);
  });
}

// 确认框
export function askConfirm(title, msg, okLabel, cb) {
  showModal(function (box) {
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    const s = document.createElement('div');
    s.className = 'sub';
    s.textContent = msg;
    box.appendChild(s);
    modalFoot(box, function () { closeModal(); cb(); }, okLabel);
  });
}
