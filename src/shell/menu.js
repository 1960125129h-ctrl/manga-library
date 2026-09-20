// 原生菜单 -> 界面按钮的桥
//
// 菜单项不重复实现业务: 主进程发 menu:action, 这里去点界面上已经有的那个按钮。
// 好处是逻辑只有一份, 菜单和按钮永远一致。

import { isElectron } from '../lib/ipc.js';

const BRIDGE = {
  download: 'btn-download',
  rebuild: 'btn-rebuild',
  history: 'btn-history',
  settings: 'btn-settings',
  sites: 'btn-sites'
};

export function initMenu() {
  const btn = document.getElementById('tb-menu');
  if (!btn) return;
  if (!isElectron()) { btn.style.display = 'none'; return; }

  btn.addEventListener('click', () => {
    if (window.mangaLib && window.mangaLib.menuPopup) window.mangaLib.menuPopup();
  });

  if (window.mangaLib && window.mangaLib.onMenuAction) {
    window.mangaLib.onMenuAction((action) => {
      const id = BRIDGE[action];
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.click();
      else console.warn('[menu] 界面上没有对应按钮: ' + action + ' -> #' + id);
    });
  }
}
