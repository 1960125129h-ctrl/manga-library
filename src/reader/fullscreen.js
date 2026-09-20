let btnFull;
let btnExit;
let immersive = false;

function nativeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
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
    return;
  }

  setImmersive(true);
  const target = document.getElementById('reader') || document.documentElement;
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
}

function onNativeChange() {
  setImmersive(!!nativeFullscreenElement());
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
