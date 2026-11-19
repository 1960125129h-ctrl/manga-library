let btnFull;
let btnExit;
let immersive = false;

function nativeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

/* 全屏时浏览器只渲染「全屏元素及其后代」。
   #reader 进全屏后，挂在 body 下的 #modal / #hint / #ctx 全都不在它的子树里，
   于是「设置」按钮点了没反应（其实 showModal 已经执行了，只是根本没被画出来），
   一退出全屏就立刻冒出来 —— 就是这个原因。
   办法：进全屏把这三块搬到 #reader 里，退出再搬回 body。
   它们都是 position:fixed，换了父节点不影响定位，#reader 也没有 transform。 */
const OVERLAYS = ['modal', 'hint', 'ctx'];
function adoptOverlays(on) {
  const root = document.getElementById('reader');
  for (let i = 0; i < OVERLAYS.length; i++) {
    const el = document.getElementById(OVERLAYS[i]);
    if (!el) continue;
    const want = on ? (root || document.body) : document.body;
    if (el.parentNode !== want) want.appendChild(el);
  }
}

function setImmersive(on) {
  immersive = !!on;
  document.body.classList.toggle('reader-immersive', immersive);
  if (btnFull) {
    btnFull.textContent = immersive ? '退出全屏' : '全屏';
    btnFull.title = immersive ? '退出全屏 (F)' : '全屏 (F)';
  }
  if (btnExit) {
    btnExit.textContent = immersive ? '退出全屏' : '全屏';
  }
}

export async function toggleReaderFullscreen() {
  if (nativeFullscreenElement()) {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) {}
    return;
  }

  if (immersive) {
    setImmersive(false);
    adoptOverlays(false);
    return;
  }

  setImmersive(true);
  const target = document.getElementById('reader') || document.documentElement;
  adoptOverlays(true);          // 先搬到全屏元素里，再进全屏
  try {
    if (target.requestFullscreen) await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
  } catch (e) {
    // iPhone Safari may not expose Fullscreen API; the in-app immersive mode remains available.
  }
}

export function resetReaderFullscreen() {
  if (nativeFullscreenElement()) {
    try {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) {}
  }
  setImmersive(false);
  adoptOverlays(false);
}

function onNativeChange() {
  const on = !!nativeFullscreenElement();
  setImmersive(on);
  adoptOverlays(on);   // Esc 退出 / 系统收回全屏时也要搬回 body，否则弹窗就永远藏在 #reader 里了
}

export function initReaderFullscreen() {
  btnFull = document.getElementById('bfull');
  btnExit = document.getElementById('exit-fullscreen');
  if (btnFull) btnFull.addEventListener('click', function (ev) {
    ev.preventDefault();
    toggleReaderFullscreen();
  });
  if (btnExit) btnExit.addEventListener('click', function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    toggleReaderFullscreen();
  });
  document.addEventListener('fullscreenchange', onNativeChange);
  document.addEventListener('webkitfullscreenchange', onNativeChange);
}
