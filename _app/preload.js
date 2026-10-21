'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 捕获渲染进程未处理异常, 把堆栈打到控制台便于诊断
window.addEventListener('error', function (e) {
  try {
    var m = e.error && e.error.stack ? e.error.stack : (e.message + ' @ ' + e.filename + ':' + e.lineno);
    console.error('UNCAUGHT ' + m);
  } catch (x) {}
});
window.addEventListener('unhandledrejection', function (e) {
  try {
    var r = e.reason;
    console.error('UNHANDLED ' + (r && r.stack ? r.stack : String(r)));
  } catch (x) {}
});

contextBridge.exposeInMainWorld('mangaLib', {
  isElectron: true,
  getRoot: () => ipcRenderer.invoke('lib:root'),
  readManifest: () => ipcRenderer.invoke('lib:manifest'),
  /* 自绘标题栏 */
  menuPopup: () => ipcRenderer.invoke('menu:popup'),
  onMenuAction: (cb) => { ipcRenderer.removeAllListeners('menu:action'); ipcRenderer.on('menu:action', (e, a) => cb(a)); },
  winMin: () => ipcRenderer.invoke('win:min'),
  winMax: () => ipcRenderer.invoke('win:max'),
  winClose: () => ipcRenderer.invoke('win:close'),
  winState: () => ipcRenderer.invoke('win:state'),
  onWinState: (cb) => { ipcRenderer.removeAllListeners('win:state'); ipcRenderer.on('win:state', (e, d) => cb(d)); },
  pickRoot: () => ipcRenderer.invoke('lib:pick'),
  getAll: () => ipcRenderer.invoke('state:all'),
  setProgress: (dir, val) => ipcRenderer.invoke('state:progress', dir, val),
  /* 工作台(美术参考): 虚拟引用的图 + 参考板 + 收件箱 */
  getWorkbench: () => ipcRenderer.invoke('wb:get'),
  saveWorkbench: (wb) => ipcRenderer.invoke('wb:save', wb),
  imageColors: (src, opts) => ipcRenderer.invoke('ref:imageColors', src, opts),
  saveLibrary: (lib) => ipcRenderer.invoke('state:library', lib),
  rescan: (opts) => ipcRenderer.invoke('lib:rescan', opts),
  bookTimes: () => ipcRenderer.invoke('lib:bookTimes'),
  jmStart: (urls, browser) => ipcRenderer.invoke('jm:start', urls, browser),
  jmOpenBrowser: (browser) => ipcRenderer.invoke('jm:browser', browser),
  siteOpen: (url, browser) => ipcRenderer.invoke('site:open', url, browser),
  jmCheckUpdate: (dir) => ipcRenderer.invoke('jm:checkUpdate', dir),
  jmFetchBook: (dir, opts) => ipcRenderer.invoke('jm:fetchBook', { dir: dir, chapters: (opts && opts.chapters) || '' }),
  jmCancel: () => ipcRenderer.invoke('jm:cancel'),
  logsOpen: () => ipcRenderer.invoke('logs:open'),
  saveAuthorAlias: (map) => ipcRenderer.invoke('alias:save', map),
  getAuthorAlias: () => ipcRenderer.invoke('alias:get'),
  jmQueue: {
    list: () => ipcRenderer.invoke('jmq:list'),
    add: (texts) => ipcRenderer.invoke('jmq:add', texts),
    start: (browser) => ipcRenderer.invoke('jmq:start', browser),
    pause: () => ipcRenderer.invoke('jmq:pause'),
    clear: (mode) => ipcRenderer.invoke('jmq:clear', mode),
    retry: (id) => ipcRenderer.invoke('jmq:retry', id),
    remove: (id) => ipcRenderer.invoke('jmq:remove', id),
    on: (cb) => { ipcRenderer.removeAllListeners('jmq:event'); ipcRenderer.on('jmq:event', (e, d) => cb(d)); }
  },
  jmBusy: () => ipcRenderer.invoke('jm:busy'),
  onJm: (cb) => { ipcRenderer.removeAllListeners('jm:event'); ipcRenderer.on('jm:event', (e, d) => cb(d)); },
  deleteComic: (dir) => ipcRenderer.invoke('lib:delete', dir),
  deleteChapter: (dir, ch) => ipcRenderer.invoke('lib:deleteChapter', dir, ch),
  deleteImage: (dir, rel) => ipcRenderer.invoke('lib:deleteImage', dir, rel),
  renameBook: (oldDir, newName) => ipcRenderer.invoke('lib:renameBook', oldDir, newName),
  mergeBook: (dir) => ipcRenderer.invoke('lib:mergeBook', dir),
  siteSearch: (kw, sites) => ipcRenderer.invoke('site:search', kw, sites),
  comicPath: (dir) => ipcRenderer.invoke('lib:comicPath', dir),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  versions: () => ipcRenderer.invoke('app:versions'),
  metaFetch: (url) => ipcRenderer.invoke('meta:fetch', url),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  dlResolve: (url) => ipcRenderer.invoke('dl:resolve', url),
  dlStart: (opts) => ipcRenderer.invoke('dl:start', opts),
  dlCancel: () => ipcRenderer.invoke('dl:cancel'),
  onMoreWorks: (cb) => { ipcRenderer.removeAllListeners('dl:more-works'); ipcRenderer.on('dl:more-works', (e, d) => cb(d)); },
  onResolveLog: (cb) => { ipcRenderer.removeAllListeners('dl:resolve-log'); ipcRenderer.on('dl:resolve-log', (e, d) => cb(d)); },
  worksStop: () => ipcRenderer.invoke('dl:works-stop'),
  worksMore: (nextUrl) => ipcRenderer.invoke('dl:works-more', nextUrl),
  previewEnd: () => ipcRenderer.invoke('dl:preview-end'),
  perfLog: (msg) => ipcRenderer.invoke('perf:log', msg),
  tabsList: () => ipcRenderer.invoke('tabs:list'),
  tabsCurrent: () => ipcRenderer.invoke('tabs:current'),
  tabsClose: (id) => ipcRenderer.invoke('tabs:close', id),
  tabsPending: () => ipcRenderer.invoke('tabs:pending'),
  tabsPendingAdd: (it) => ipcRenderer.invoke('tabs:pending-add', it),
  tabsPendingClear: () => ipcRenderer.invoke('tabs:pending-clear'),
  tabsPendingDrop: (u) => ipcRenderer.invoke('tabs:pending-drop', u),
  previewKeep: (works) => ipcRenderer.invoke('dl:preview-keep', works),
  dlStartBatch: (req) => ipcRenderer.invoke('dl:startBatch', req),
  dlBatchCancel: () => ipcRenderer.invoke('dl:batchCancel'),
  dlBusy: () => ipcRenderer.invoke('dl:busy'),
  onDownload: (cb) => {
    // 允许多个监听并存(全局一套 + 下载时一套), 但**同一个函数只挂一次**, 防止同一批事件被处理两遍。
    // 以前用 removeAllListeners 会导致后来者顶掉前者 → 批量下载时 done 收不到 → 进度卡在 95%。
    if (typeof cb === 'function' && cb.__dshDlHooked) return;
    if (typeof cb === 'function') { try { cb.__dshDlHooked = true; } catch (e) {} }
    const h = (e, d) => { try { cb(d); } catch (err) {} };
    ipcRenderer.on('dl:event', h);
  },
  onLibraryRebuilt: (cb) => {
    ipcRenderer.removeAllListeners('library:rebuilt');
    ipcRenderer.on('library:rebuilt', () => cb());
  },
  webStart: (options) => ipcRenderer.invoke('web:start', options),
  webStop: () => ipcRenderer.invoke('web:stop'),
  webStatus: () => ipcRenderer.invoke('web:status'),
  dlThumb: (req) => ipcRenderer.invoke('dl:thumb', req),
  pickDetails: (ids) => ipcRenderer.invoke('dl:pick-details', ids),
  pickStop: () => ipcRenderer.invoke('dl:pick-stop'),
  onPickDetail: (cb) => {
    ipcRenderer.removeAllListeners('pick-detail');
    ipcRenderer.removeAllListeners('pick-detail-done');
    ipcRenderer.on('pick-detail', (e, d) => cb(d));
    ipcRenderer.on('pick-detail-done', (ev, d) => cb({ done: true, rate: (d && d.rate) || '', err: (d && d.err) || '' }));
  }
});
