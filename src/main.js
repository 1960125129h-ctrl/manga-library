// 书库 · 渲染层入口
//
// 装配顺序:
//   1. 取书库数据(运行时取得, 不再依赖构建期内联)
//   2. 注入界面核心需要的全局
//   3. 载入界面核心
//
// 界面核心目前仍是单体(src/legacy/core.js, 约 290KB),
// 后续按功能域逐步抽到 src/shelf、src/reader、src/download、src/settings。

import { loadManifest } from './lib/manifest.js';
import { initTitlebar } from './shell/titlebar.js';
import { initMenu } from './shell/menu.js';
import { watchDuplicateIds } from './shared/domcheck.js';
import { isElectron } from './lib/ipc.js';

function registerServiceWorker() {
  if (isElectron() || !('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/service-worker.js').catch(() => {}); });
}

async function boot() {
  // 窗口 chrome 先立起来: 它不依赖书库数据, 数据读失败也要能用(至少能关窗口)
  registerServiceWorker();
  initTitlebar();
  initMenu();
  watchDuplicateIds();   // id 撞车巡检(界面变动后节流扫描, 只在真撞了才警告)

  let manifest = [];
  try {
    manifest = await loadManifest();
    console.log('[boot] 书库数据 ' + manifest.length + ' 本');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error('[boot] 取书库数据失败: ' + msg);
    showBootError(msg);
    return;
  }

  // 界面核心读的是裸标识符 __MANIFEST__, 它会落到 globalThis 上
  globalThis.__MANIFEST__ = manifest;

  try {
    await import('./legacy/core.js');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error('[boot] 载入界面核心失败: ' + msg);
    showBootError(msg);
  }
}

function showBootError(msg) {
  const el = document.getElementById('hint');
  if (!el) return;
  el.textContent = '启动失败: ' + msg;
  el.style.display = 'block';
  el.style.padding = '24px';
  el.style.color = '#e66';
  el.style.whiteSpace = 'pre-wrap';
}

boot();
