'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// dl:event 的监听槽位表：同一槽位重复注册只保留最新回调（弹窗每次打开都是新匿名函数）
const onDlSlots = Object.create(null);

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
  jmStart: (urls, browser, imgMode) => ipcRenderer.invoke('jm:start', urls, browser, imgMode),
  jmSetMode: (img) => ipcRenderer.invoke('jm:setMode', img),
  jmCaps: () => ipcRenderer.invoke('jm:caps'),
  /* 联网更新 */
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  promptUpdate: () => ipcRenderer.invoke('update:prompt'),
  openReleases: () => ipcRenderer.invoke('update:openPage'),
  downloadPrefs: {
    get: () => ipcRenderer.invoke('prefs:getDownload'),
    set: (j) => ipcRenderer.invoke('prefs:setDownload', j),
  },
  tools: {
    clearProfile: () => ipcRenderer.invoke('tools:clearProfile'),
    importZips: () => ipcRenderer.invoke('tools:importZips'),
  },
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
  deleteImage: (dir, rel, opts) => ipcRenderer.invoke('lib:deleteImage', dir, rel, opts),   // opts.rebuild=false: 批量删图时不要每张都重建
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
  tabsJmCollect: (port) => ipcRenderer.invoke('tabs:jm-collect', { port: port || 0 }),   // 收走开着的禁漫作品页(链接交回), 并把那些标签关掉
  tabsPending: () => ipcRenderer.invoke('tabs:pending'),
  tabsPendingAdd: (it) => ipcRenderer.invoke('tabs:pending-add', it),
  tabsPendingClear: () => ipcRenderer.invoke('tabs:pending-clear'),
  tabsPendingDrop: (u) => ipcRenderer.invoke('tabs:pending-drop', u),
  previewKeep: (works) => ipcRenderer.invoke('dl:preview-keep', works),
  dlStartBatch: (req) => ipcRenderer.invoke('dl:startBatch', req),
  dlBatchCancel: () => ipcRenderer.invoke('dl:batchCancel'),
  dlBusy: () => ipcRenderer.invoke('dl:busy'),
  // 允许多个监听并存(全局一套 + 弹窗一套), 但按「槽位」去重:
  // 同一个 slot 反复调用只保留最新那个回调 —— 弹窗每次打开都传新的匿名函数,
  // 靠函数对象去重是无效的(之前在日志里表现为「每条信息显示两遍」)。
  onDownload: (cb, slot) => {
    if (typeof cb !== 'function') return;
    const key = slot || 'auto';
    if (!onDlSlots[key]) onDlSlots[key] = null;
    if (onDlSlots[key]) { try { ipcRenderer.removeListener('dl:event', onDlSlots[key]); } catch (e) {} }
    const h = (e, d) => { try { cb(d); } catch (err) {} };
    onDlSlots[key] = h;
    ipcRenderer.on('dl:event', h);
  },
  onLibraryRebuilt: (cb) => {
    ipcRenderer.removeAllListeners('library:rebuilt');
    ipcRenderer.on('library:rebuilt', () => cb());
  },
  readerPrefsGet: () => ipcRenderer.invoke('reader:prefsGet'),
  readerPrefsSave: (p) => ipcRenderer.invoke('reader:prefsSave', p),
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
