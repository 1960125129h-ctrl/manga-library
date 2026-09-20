// 自绘标题栏
//
// frameless 窗口没有系统标题栏, 最小化/最大化/关闭 与"最大化态图标切换"都在这里做。
// 拖动由 CSS 的 -webkit-app-region: drag 负责(Windows 的窗口吸附也靠它), 这里不接管拖动。

import { call, isElectron } from '../lib/ipc.js';

const SVG_MAX = '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg>';
const SVG_RESTORE = '<svg viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor"/><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor"/></svg>';

export function initTitlebar() {
  const bar = document.getElementById('titlebar');
  if (!bar) return;

  // 浏览器直开时没有窗口控制可言, 整条藏掉
  if (!isElectron()) { document.body.classList.add('not-electron'); return; }

  const btnMin = document.getElementById('tb-min');
  const btnMax = document.getElementById('tb-max');
  const btnClose = document.getElementById('tb-close');

  if (btnMin) btnMin.addEventListener('click', () => { call('winMin').catch(() => {}); });
  if (btnMax) btnMax.addEventListener('click', () => { call('winMax').catch(() => {}); });
  if (btnClose) btnClose.addEventListener('click', () => { call('winClose').catch(() => {}); });

  // 最大化 / 还原: 换图标 + 换提示
  const paint = (maximized) => {
    if (!btnMax) return;
    btnMax.innerHTML = maximized ? SVG_RESTORE : SVG_MAX;
    btnMax.title = maximized ? '向下还原' : '最大化';
  };
  if (window.mangaLib && window.mangaLib.onWinState) {
    window.mangaLib.onWinState((d) => paint(!!(d && d.maximized)));
  }
  call('winState').then((s) => paint(!!(s && s.maximized))).catch(() => paint(false));
}
