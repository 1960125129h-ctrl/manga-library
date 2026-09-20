'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { cpSync } = require('node:fs');
const { pathToFileURL, fileURLToPath } = require('node:url');

const DEFAULT_LIB = path.resolve(__dirname, '..');

function cfgFile() { return path.join(app.getPath('userData'), 'config.json'); }
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } }
function writeCfg(c) { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2), 'utf8'); } catch (e) {} }

let LIB = readCfg().libraryRoot || DEFAULT_LIB;
// 渲染层入口与书库数据: 都不再由 build-library 生成内联 HTML, 改成运行时装配
const rendererPath = () => path.join(LIB, 'src', 'index.html');
const manifestPath = () => path.join(LIB, '_manifest.json');
let win = null;
// 单实例: 第二次启动不再开新窗口, 只把已有窗口拉到前面
// (顺便治好一个真问题: 多开会各自抢 9445 调试端口, 导致自动化连到僵尸实例)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    try { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } } catch (e) {}
    // 第二次启动往往就是"又双击了一个压缩包": 把文件交给已在跑的实例, 不再开新窗口
    const f = pickArchiveArg(argv);
    if (f) openArchive(f);
  });
}
let libWatcher = null;
const NODE_BIN = 'node';   // 真实 Node(24), 走 PATH; 漫画站要走代理时必须用它
let jmRunning = false;    // 禁漫任务在跑时不让自动刷新把日志冲掉
let dlActive = false;     // 通用下载(fetch-book)任务在跑时不让自动刷新: 与任务生命周期绑定, 不固定 30 分钟
let pendingReload = false;
let watchMuteUntil = 0;   // 这段时间内书库.html 被重建也不刷新窗口(自己触发的重建: 删章节等, 免得把用户踢回书架)

/* 书库.html 被重建(更新书库/外部脚本)时自动刷新窗口, 不用手动 F5 */
function watchLibrary() {
  try { if (libWatcher) { libWatcher.close(); libWatcher = null; } } catch (e) {}
  try {
    let t = null;
    libWatcher = fs.watch(LIB, (ev, fn) => {
      if (String(fn) !== '_manifest.json') return;
      if (Date.now() < watchMuteUntil) return;            // 自己刚重建的: 不刷新, 用户还停在阅读器里
      if (jmRunning || dlActive) { pendingReload = true; return; }   // 任务进行中: 先不发刷新, 免得日志被冲掉
      clearTimeout(t);
      t = setTimeout(() => { try { reload(); } catch (e) {} }, 500);
    });
  } catch (e) {}
}

/* 删章节/删图/重命名后: 异步增量重建该书, 期间静默文件监听(不阻塞 IPC) */
function rebuildBook(dir) {
  try {
    const script = path.join(LIB, '_scripts', 'build-library.mjs');
    if (!fs.existsSync(script)) return Promise.resolve(false);
    const { spawn } = require('node:child_process');
    watchMuteUntil = Date.now() + 30000;   // 重建期间别让监听把页面刷掉
    return new Promise((res) => {
      const p2 = spawn(process.execPath, [script, '--lib', LIB, '--only', dir, '--offline'], { cwd: LIB, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      p2.on('error', () => res(false));
      p2.on('exit', (code) => res(code === 0));
    });
  } catch (e) { return Promise.resolve(false); }
}

/* ---------- 文件关联: 双击压缩包用本应用打开 ----------
   Windows 把文件路径当参数传给进程(可能带引号, 也可能混着 Electron 自己的开关)。
   做法: 解压成 漫画/<文件名>/全本/, 再重建这本的书库数据。 */

const ARCHIVE_RE = /\.(cbz|zip)$/i;
const IMG_RE = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i;

// 从命令行里挑出真正的压缩包路径(忽略开关和自己的脚本路径)
function pickArchiveArg(argv) {
  const list = Array.isArray(argv) ? argv.slice(1) : [];
  for (const a of list) {
    if (!a || a.charAt(0) === '-') continue;
    if (!ARCHIVE_RE.test(a)) continue;
    try { if (fs.existsSync(a) && fs.statSync(a).isFile()) return a; } catch (e) {}
  }
  return null;
}

// 书库只认"话目录里直接的图", 所以有些包里图放在子目录时要把它们提上来
function flattenChapter(dir) {
  const found = [];
  const walk = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 6) walk(q, depth + 1); }
      else if (IMG_RE.test(e.name)) found.push(q);
    }
  };
  walk(dir, 0);
  const nested = found.filter((q) => path.dirname(q) !== dir);
  if (!nested.length) return 0;   // 本来就是一层的: 一个都不动, 不打扰原来的文件名
  // 有嵌套 -> 整批按自然序重排。只重编嵌套那几张会把页序弄乱
  // (平铺的保留原名 001.jpg, 嵌套的重编成 00001.jpg, 混起来排序就错了)。
  found.sort((a, b) => a.localeCompare(b, 'zh', { numeric: true, sensitivity: 'base' }));
  // 两阶段改名: 先全部挪到临时名, 再落到目标名。
  // 否则"甲的新名字 == 乙的旧名字"时会互相占位, rename 被静默跳过(工程记录里中过)。
  const staged = [];
  found.forEach((src, i) => {
    const tmp = path.join(dir, '__fx' + String(i).padStart(5, '0') + path.extname(src).toLowerCase());
    try { fs.renameSync(src, tmp); staged.push(tmp); } catch (e) {}
  });
  let n = 0;
  for (const tmp of staged) {
    n++;
    try { fs.renameSync(tmp, path.join(dir, String(n).padStart(5, '0') + path.extname(tmp).toLowerCase())); } catch (e) {}
  }
  // 清掉空目录(留着一堆空壳会让书库扫描看着很乱)
  const rmdir = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) if (e.isDirectory()) rmdir(path.join(d, e.name));
    try { if (!fs.readdirSync(d).length && d !== dir) fs.rmdirSync(d); } catch (e) {}
  };
  rmdir(dir);
  return nested.length;
}

// 解压进书库并重建这本的数据。返回 { ok, book, images, flatten, msg }
async function importArchive(file) {
  try {
    const base = path.basename(file).replace(ARCHIVE_RE, '');
    const name = String(base).replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120) || '未命名';
    const bookDir = path.join(LIB, '漫画', name);
    const chapDir = path.join(bookDir, '全本');
    fs.mkdirSync(chapDir, { recursive: true });
    const unzipper = require('unzipper');
    await new Promise((res, rej) => {
      fs.createReadStream(file)
        .pipe(unzipper.Extract({ path: chapDir }))
        .on('close', res)
        .on('error', rej);
    });
    const flat = flattenChapter(chapDir);
    const imgs = (() => { try { return fs.readdirSync(chapDir).filter((f) => IMG_RE.test(f)).length; } catch (e) { return 0; } })();
    if (!imgs) return { ok: false, book: name, images: 0, flatten: flat, msg: '压缩包里没有找到图片' };
    const rebuilt = await rebuildBook('漫画/' + name);
    logLine('导入', '[压缩包] ' + path.basename(file) + ' -> 漫画/' + name + ' (' + imgs + ' 图' + (flat ? ', 提上来 ' + flat + ' 张' : '') + ') 重建=' + rebuilt);
    return { ok: true, book: name, images: imgs, flatten: flat, rebuilt: rebuilt };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    logLine('导入', '[压缩包] 失败: ' + msg);
    return { ok: false, msg: msg };
  }
}

// 关联的包被打开时: 导入 -> 刷新窗口 -> 给个提示
async function openArchive(file) {
  try {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    const r = await importArchive(file);
    if (win && !win.isDestroyed()) {
      win.webContents.send('archive:imported', r);
      if (r.ok) setTimeout(() => { try { reload(); } catch (e) {} }, 600);
    }
    return r;
  } catch (e) { return { ok: false, msg: (e && e.message) || String(e) }; }
}

/* 下载/更新日志落盘: _scripts\jm\logs\YYYY-MM-DD.log, 出问题能回溯 */
function logsDir() { return path.join(LIB, '_scripts', 'jm', 'logs'); }
function logLine(kind, text) {
  try {
    const body = String(text == null ? '' : text).replace(/\s+$/, '');
    if (!body) return;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const day = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(path.join(logsDir(), day + '.log'), '[' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + '][' + kind + '] ' + body + '\n', 'utf8');
  } catch (e) {}
}
ipcMain.handle('logs:open', async () => {
  try { fs.mkdirSync(logsDir(), { recursive: true }); const r = await shell.openPath(logsDir()); return { ok: !r, msg: r || logsDir() }; }
  catch (e) { return { ok: false, msg: String(e && e.message || e) }; }
});

const libJson = () => path.join(LIB, 'library.json');
const progJson = () => path.join(LIB, '.progress.json');
// 工作台(美术参考): 虚拟引用的图 + 参考板 + 收件箱。
// 用点开头的名字和 .progress.json 一致 —— 它也是"用户数据", 不该被书库扫描当成类目目录。
const wbJson = () => path.join(LIB, '.workbench.json');
function defaultWorkbench() { return { version: 1, images: {}, boards: {}, inbox: [] }; }

function readJSON(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return dflt; } }
async function writeJSON(f, v) {
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(v, null, 2), 'utf8');
  await fsp.rename(tmp, f);
}
function defaultLibrary() {
  return { version: 1, categories: ['在看', '想读', '已读完'], comics: {} };
}

// ── 窗口位置记忆: 位置+大小存 config.json; 越界(拔屏/改分辨率)就回主屏居中 ──
function usableWinBounds(b) {
  try {
    const { screen } = require("electron");
    if (!b || typeof b.x !== "number" || typeof b.y !== "number") return null;
    const w = Math.max(600, Math.min(Number(b.width) || 1440, 20000));
    const h = Math.max(400, Math.min(Number(b.height) || 940, 20000));
    for (const d of screen.getAllDisplays()) {
      const a = d.workArea;
      const ox = Math.max(0, Math.min(b.x + w, a.x + a.width) - Math.max(b.x, a.x));
      const oy = Math.max(0, Math.min(b.y + h, a.y + a.height) - Math.max(b.y, a.y));
      if (ox >= 160 && oy >= 80) return { x: b.x, y: b.y, width: w, height: h };   // 露出的面积够多才算"还在屏幕上"
    }
  } catch (e) {}
  return null;   // 越界 → 交给系统居中
}
function saveWinBounds() {
  try {
    if (!win || win.isDestroyed()) return;
    const b = (typeof win.getNormalBounds === "function") ? win.getNormalBounds() : win.getBounds();
    const c = readCfg();
    c.winBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    writeCfg(c);
  } catch (e) {}
}
function createWindow() {
  let cfgB = null;
  try { cfgB = readCfg().winBounds || null; } catch (e) {}
  const lastB = usableWinBounds(cfgB);   // 上次的窗口位置(不可用就是 null → 居中)
  logLine("启动", "[窗口] 读到的 winBounds=" + JSON.stringify(cfgB) + " 判定=" + (lastB ? JSON.stringify(lastB) : "不可用(居中)"));
  appMenu = buildAppMenu();
  createTray();
  try { Menu.setApplicationMenu(appMenu); } catch (e) {}   // frameless 下不显示, 但快捷键靠它挂上
  win = new BrowserWindow(Object.assign({
    width: 1440, height: 940, minWidth: 900, minHeight: 600,
    backgroundColor: '#111214',
    title: '漫画书库重构v0',
    frame: false,            // 自绘标题栏(src/shell/titlebar) —— 去掉系统边框, 才有"桌面应用"的样子
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  }, lastB || {}));
  let winSaveT = null;
  const saveLater = () => { clearTimeout(winSaveT); winSaveT = setTimeout(saveWinBounds, 500); };
  win.on('move', saveLater);
  win.on('resize', saveLater);
  win.on('close', () => { try { clearTimeout(winSaveT); saveWinBounds(); } catch (e) {} });   // 关窗前再兜一次
  // 最大化状态变化要通知渲染层(切换"最大化/还原"图标)
  const pushWinState = () => { try { if (win && !win.isDestroyed()) win.webContents.send('win:state', { maximized: win.isMaximized() }); } catch (e) {} };
  win.on('maximize', pushWinState);
  win.on('unmaximize', pushWinState);
  win.once('ready-to-show', () => win.show());
  win.loadFile(rendererPath());
  win.webContents.setWindowOpenHandler((o) => { shell.openExternal(o.url); return { action: 'deny' }; });
  // 全局右键菜单: 输入框/文本框里给 剪切/复制/粘贴/全选
  win.webContents.on('context-menu', (e, params) => {
    const items = [];
    if (params.isEditable) {
      if (params.editFlags.canCut)   items.push({ label: '剪切', role: 'cut' });
      if (params.editFlags.canCopy)  items.push({ label: '复制', role: 'copy' });
      if (params.editFlags.canPaste) items.push({ label: '粘贴', role: 'paste' });
      items.push({ label: '全选', role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ label: '复制', role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function reload() { if (win) win.loadFile(rendererPath()); }

/* ---------- 原生菜单 ----------
   frameless 窗口没有系统菜单栏的位置, 所以:
     · setApplicationMenu 只用来挂快捷键(界面上不显示)
     · 标题栏上的菜单按钮调 menu:popup 弹原生菜单
   菜单项不重复实现业务, 一律 send('menu:action', X) 让界面去点它自己那个按钮。 */
function buildAppMenu() {
  const hit = (a) => () => { try { if (win && !win.isDestroyed()) win.webContents.send('menu:action', a); } catch (e) {} };
  const sep = { type: 'separator' };
  return Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '下载漫画…', accelerator: 'Ctrl+N', click: hit('download') },
      { label: '更新书库', accelerator: 'Ctrl+U', click: hit('rebuild') },
      sep,
      { label: '阅读历史', click: hit('history') },
      { label: '设置', accelerator: 'Ctrl+,', click: hit('settings') },
      sep,
      { label: '退出', role: 'quit' }
    ]},
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, sep,
      { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }
    ]},
    { label: '视图', submenu: [
      { label: '刷新界面', accelerator: 'F5', click: () => reload() },
      { label: '开发者工具', accelerator: 'Ctrl+Shift+I', click: () => { try { win.webContents.toggleDevTools(); } catch (e) {} } },
      sep,
      { label: '全屏', accelerator: 'F11', click: () => { try { win.setFullScreen(!win.isFullScreen()); } catch (e) {} } },
      sep,
      { label: '放大界面', role: 'zoomIn' }, { label: '缩小界面', role: 'zoomOut' }, { label: '实际大小', role: 'resetZoom' }
    ]},
    { label: '帮助', submenu: [
      { label: '打开书库文件夹', click: () => { try { shell.openPath(LIB); } catch (e) {} } },
      { label: '打开日志文件夹', click: () => { try { fs.mkdirSync(logsDir(), { recursive: true }); shell.openPath(logsDir()); } catch (e) {} } }
    ]}
  ]);
}
let appMenu = null;

/* ---------- 托盘 ----------
   常驻应用的存在感: 托盘图标 + 右键菜单。窗口的 ✕ 仍然是"退出"(不改这个行为,
   免得用户以为关了其实还在后台跑); 想只收起来用托盘的「隐藏到托盘」。 */
let tray = null;
function createTray() {
  if (tray) return;
  try {
    const p = path.join(__dirname, 'icon.ico');
    if (!fs.existsSync(p)) { logLine('启动', '[托盘] 找不到图标 ' + p); return; }
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) { logLine('启动', '[托盘] 图标解码为空'); return; }
    tray = new Tray(img);
    tray.setToolTip('漫画书库');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { try { if (win) { win.show(); win.focus(); } } catch (e) {} } },
      { label: '隐藏到托盘', click: () => { try { if (win) win.hide(); } catch (e) {} } },
      { type: 'separator' },
      { label: '打开书库文件夹', click: () => { try { shell.openPath(LIB); } catch (e) {} } },
      { label: '打开日志文件夹', click: () => { try { fs.mkdirSync(logsDir(), { recursive: true }); shell.openPath(logsDir()); } catch (e) {} } },
      { type: 'separator' },
      { label: '退出', click: () => { try { app.quit(); } catch (e) {} } }
    ]));
    // 左键点托盘: 在"显示/隐藏"之间切换(和常见桌面应用一致)
    tray.on('click', () => {
      try {
        if (!win) return;
        if (win.isVisible() && !win.isMinimized()) win.hide();
        else { win.show(); win.focus(); }
      } catch (e) {}
    });
    logLine('启动', '[托盘] 已创建');
  } catch (e) { logLine('启动', '[托盘] 创建失败: ' + ((e && e.message) || e)); }
}

const SMOKE = process.argv.includes('--smoke');

app.whenReady().then(async () => {
  try { setTimeout(() => { try { sweepPreviewCache(); } catch (e) {} }, 4000); } catch (e) {}   // 启动 4 秒后兜底清理预览缓存
  // 打包版首次启动: 弹窗选书库根目录, 拷初始模板文件
  if (app.isPackaged && !readCfg().libraryRoot) {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['选择文件夹', '退出'],
      title: '漫画书库',
      message: '首次启动：请选择一个文件夹作为书库根目录',
      detail: '下载的漫画、library.json、设置等都会放在这个文件夹里。建议新建一个空文件夹。'
    });
    if (response === 1) { app.quit(); return; }
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择书库根目录' });
    if (picked.canceled || !picked.filePaths[0]) { app.quit(); return; }
    LIB = picked.filePaths[0];
    writeCfg({ ...readCfg(), libraryRoot: LIB });
    // 拷初始模板文件 + 脚本资源（如果目标里没有）
    const RES = process.resourcesPath;
    ['library.json', '角色作品表.json', '外部目录.json'].forEach(function (f) {
      try {
        const dst = path.join(LIB, f);
        if (!fs.existsSync(dst)) fs.copyFileSync(path.join(RES, f), dst);
      } catch (e) {}
    });
    // 拷 _scripts（首次启动，已存在则跳过）
    try {
      const srcScripts = path.join(RES, '_scripts');
      const dstScripts = path.join(LIB, '_scripts');
      if (fs.existsSync(srcScripts) && !fs.existsSync(dstScripts)) {
        fs.mkdirSync(dstScripts, { recursive: true });
        cpSync(srcScripts, dstScripts, { recursive: true });
      }
    } catch (e) { console.error('拷 _scripts 失败', e); }
    // 拷渲染层源码 src/: 界面从这里加载(rendererPath), 不拷打开就是白屏
    try {
      const srcDir = path.join(RES, 'src');
      const dstSrc = path.join(LIB, 'src');
      if (fs.existsSync(srcDir) && !fs.existsSync(dstSrc)) cpSync(srcDir, dstSrc, { recursive: true });
    } catch (e) { console.error('拷 src 失败', e); }
    // 拷书库.html(旧版单文件界面, 留着兼容)
    try {
      const dstHtml = path.join(LIB, '书库.html');
      if (!fs.existsSync(dstHtml)) fs.copyFileSync(path.join(RES, '书库.html'), dstHtml);
    } catch (e) {}
  }
  // pixiv 图片(i.pximg.net)需要 Referer 头才能访问, 自动给这类请求加上
  try {
    const { session } = require('electron');
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.pximg.net/*'] }, function (details, cb) {
      details.requestHeaders['Referer'] = 'https://www.pixiv.net/';
      cb({ requestHeaders: details.requestHeaders });
    });
  } catch (e) {}
  createWindow();
  watchLibrary();
  // 书库数据文件必须存在, 否则界面一启动就报"读 _manifest.json 失败"(空库也要有)
  try {
    const mf = path.join(LIB, '_manifest.json');
    if (!fs.existsSync(mf)) fs.writeFileSync(mf, JSON.stringify({ count: 0, comics: [] }), 'utf8');
  } catch (e) {}
  // 双击关联文件启动: 等窗口先出来, 再导(导入要解压+重建, 会占用一会儿)
  try {
    const f0 = pickArchiveArg(process.argv);
    if (f0) setTimeout(() => { openArchive(f0); }, 1200);
  } catch (e) {}
  loadQueue();   // 载入上次的下载队列(关掉 App 也会留在 queue.json 里)
  if (jmQueue.wasRunning && jmQueue.items.some(function (i) { return i.status === 'wait'; })) {
    console.log('[队列] 上次没跑完, 3 秒后自动接着跑');
    setTimeout(function () { runQueue(); }, 3000);
  }

  if (SMOKE) {
    const SMOKE_FILE = path.join(__dirname, 'smoke-result.json');
    const R = { stage: 'start', logs: [] };
    const flush = () => { try { fs.writeFileSync(SMOKE_FILE, JSON.stringify(R, null, 2), 'utf8'); } catch (e) {} };
    flush();
    const logs = R.logs;
    win.webContents.on('console-message', (a, b, c) => {
      let lvl, msg;
      if (a && typeof a === 'object' && 'level' in a) { lvl = a.level; msg = a.message; }
      else { lvl = b; msg = c; }
      logs.push(String(lvl) + ': ' + String(msg));
    });
    win.webContents.on('did-fail-load', (e, code, desc) => logs.push('ERROR: did-fail-load ' + code + ' ' + desc));
    win.webContents.on('render-process-gone', (e, d) => logs.push('ERROR: render-gone ' + JSON.stringify(d)));

    try {
      await new Promise((res) => win.webContents.once('did-finish-load', res));
      let booted = false;
      for (let i = 0; i < 60; i++) {
        try { booted = await win.webContents.executeJavaScript('!!window.mlBooted'); } catch (e) {}
        if (booted) break;
        await new Promise((res) => setTimeout(res, 150));
      }
      R.bootWait = booted;
      await new Promise((res) => setTimeout(res, 700));

      const steps = [
        ['1_tabs_initial', 'JSON.stringify(Array.from(document.querySelectorAll("#cattabs .tab")).map(function(b){return b.textContent}))'],
        ['2_click_star', '(function(){var s=document.querySelector(".card .star"); if(!s) return "NO-STAR"; var before=s.textContent; s.click(); var after=document.querySelector(".card .star").textContent; return before+" -> "+after;})()'],
        ['3_add_category', '(function(){var a=document.querySelector(".tab.add"); if(!a) return "NO-ADD"; a.click(); var i=document.querySelector("#mbox input[type=text]"); if(!i) return "NO-INPUT"; i.value="测试分类"; var ok=document.querySelector("#mfoot .btn:not(.ghost)"); if(!ok) return "NO-OK"; ok.click(); return "created";})()'],
        ['4_tabs_after', 'JSON.stringify(Array.from(document.querySelectorAll("#cattabs .tab")).map(function(b){return b.textContent}))'],
        ['5_filter_to_cat', '(function(){var t=Array.from(document.querySelectorAll("#cattabs .tab")).filter(function(x){return x.textContent.indexOf("测试分类")===0})[0]; if(!t) return "NO-TAB"; t.click(); return "cards="+document.querySelectorAll(".card").length+" stat="+document.getElementById("shelfstat").textContent;})()'],
        ['6_back_to_all', '(function(){var t=document.querySelectorAll("#cattabs .tab")[0]; t.click(); return "cards="+document.querySelectorAll(".card").length;})()'],
        ['7_ctx_menu', '(function(){var c=document.querySelector(".card"); c.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:120,clientY:120})); return JSON.stringify(Array.from(document.querySelectorAll("#ctx button")).map(function(b){return b.textContent}));})()'],
        ['8_editor', '(function(){var b=Array.from(document.querySelectorAll("#ctx button")).filter(function(x){return x.textContent.indexOf("编辑")>=0})[0]; if(!b) return "NO-EDIT"; b.click(); var chks=document.querySelectorAll("#mbox .chk input"); if(!chks.length) return "NO-CHK"; chks[0].checked=true; var ti=document.querySelectorAll("#mbox input[type=text]")[0]; ti.value="奇幻, 冒险"; document.querySelector("#mfoot .btn:not(.ghost)").click(); return "saved";})()'],
        ['9_card_tags', 'JSON.stringify(Array.from(document.querySelectorAll(".card .ctag")).map(function(b){return b.textContent}))'],
        ['10_search_tag', '(function(){var s=document.getElementById("search"); s.value="冒险"; s.dispatchEvent(new Event("input",{bubbles:true})); return "cards="+document.querySelectorAll(".card").length;})()'],
        ['11_clear_search', '(function(){var s=document.getElementById("search"); s.value=""; s.dispatchEvent(new Event("input",{bubbles:true})); return "cards="+document.querySelectorAll(".card").length;})()'],
        ['12_open_comic', '(function(){document.querySelector(".card").click(); return "opened";})()'],
        ['13_reader_state', 'JSON.stringify({chname:(document.getElementById("chname")||{}).textContent,imgNatural:(function(){var i=document.querySelector("#stage img");return i?i.naturalWidth+"x"+i.naturalHeight:"none"})()})'],
        ['14_jump_ch2', '(function(){document.querySelectorAll("#chapters .ch")[1].click(); return (document.getElementById("chname")||{}).textContent+" p"+(document.getElementById("pageinput")||{}).value;})()'],
        ['15_prev_at_ch2_start', '(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true})); return (document.getElementById("chname")||{}).textContent+" p"+(document.getElementById("pageinput")||{}).value+"/"+(document.getElementById("pageinfo")||{}).textContent;})()'],
        ['16_prev_again', '(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true})); return (document.getElementById("chname")||{}).textContent+" p"+(document.getElementById("pageinput")||{}).value;})()'],
        ['17_next_back_to_ch2', '(function(){for(var i=0;i<3;i++){document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));} return (document.getElementById("chname")||{}).textContent+" p"+(document.getElementById("pageinput")||{}).value;})()'],
        ['18_explicit_prev_button', '(function(){document.getElementById("bprevch").click(); return (document.getElementById("chname")||{}).textContent+" p"+(document.getElementById("pageinput")||{}).value;})()'],
        ['19_card_source', 'JSON.stringify({srcTags:Array.from(document.querySelectorAll(".card .csrc")).map(function(e){return e.textContent}), backdrop:Array.from(document.querySelectorAll("#ctx button")).map(function(b){return b.textContent})})'],
        ['20a_queue_add', '(async function(){var r=await window.mangaLib.jmQueue.add("JM1452133 1452134"); return JSON.stringify({ok:r.ok,added:r.added,total:(r.items||[]).length,first:((r.items||[])[0]||{}).url});})()'],
        ['20b_queue_list', '(async function(){var q=await window.mangaLib.jmQueue.list(); return JSON.stringify({n:(q.items||[]).length,counts:q.counts});})()'],
        ['20c_queue_badge', 'JSON.stringify({btn:(document.getElementById("btn-download")||{}).textContent})'],
        ['20d_queue_pause', '(async function(){var q=await window.mangaLib.jmQueue.pause(); return JSON.stringify({running:q.running});})()'],
        ['20e_queue_clear', '(async function(){var q=await window.mangaLib.jmQueue.clear("all"); return JSON.stringify({n:(q.items||[]).length});})()'],
        ['20_info_dialog', '(function(){var c=document.querySelector(".card"); c.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:120,clientY:120})); var b=Array.from(document.querySelectorAll("#ctx button")).filter(function(x){return x.textContent.indexOf("简介")>=0})[0]; if(!b) return "NO-ITEM"; b.click(); var ui=document.querySelector("#mbox input[type=text]"); var ta=document.querySelector("#mbox textarea"); var fbs=Array.from(document.querySelectorAll("#mfoot button")).map(function(x){return x.textContent}); return JSON.stringify({link:ui?ui.value:"",desc:(ta?ta.value:"").slice(0,50),buttons:fbs});})()']
      ];

      R.steps = [];
      for (const st of steps) {
        let v;
        try { v = await win.webContents.executeJavaScript(st[1]); } catch (e) { v = 'JS-ERR ' + e.message; }
        R.steps.push({ n: st[0], v: String(v) });
        flush();
        await new Promise((res) => setTimeout(res, 800));
      }
      // ---- 真实下载测试: 走完整 IPC 链路 ----
      R.dl = {};
      try {
        R.dl.resolve = await win.webContents.executeJavaScript('window.mangaLib.dlResolve("https://www.xmanhua.net/26577xm/")');
        await win.webContents.executeJavaScript('(function(){window.__evs=[];window.mangaLib.onDownload(function(e){window.__evs.push(e.type+(e.type==="chapter-done"?":"+e.got+"/"+e.expected:"")+(e.type==="done"?"#imgs="+e.summary.images:""));});return 1;})()');
        R.dl.start = await win.webContents.executeJavaScript('window.mangaLib.dlStart({slug:"/26577xm/",name:"_下载自测",from:1,to:1})');
        R.dl.events = await win.webContents.executeJavaScript('JSON.stringify(window.__evs)');
        const fdir = path.join(LIB, '_下载自测');
        R.dl.folder = fs.existsSync(fdir);
        if (R.dl.folder) {
          const chs = fs.readdirSync(fdir).filter(n => n.indexOf('話') >= 0);
          R.dl.chapterDirs = chs;
          R.dl.files = chs.length ? fs.readdirSync(path.join(fdir, chs[0])).length : 0;
          R.dl.cbz = fs.readdirSync(fdir).filter(n => n.endsWith('.cbz'));
        }
      } catch (e) { R.dl.error = String(e && e.message || e); }
      flush();

      R.library = readJSON(libJson(), {});
      R.progress = readJSON(progJson(), {});
      R.stage = 'done';
    } catch (e) {
      R.stage = 'error';
      R.error = String(e && e.stack || e);
    }
    R.errs = logs.filter((l) => l.indexOf('ERROR') === 0 || /^(3|error):/i.test(l));
    flush();
    app.exit(R.stage === 'done' && R.errs.length === 0 ? 0 : 1);
    return;
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { if (tray) { tray.destroy(); tray = null; } } catch (e) {} });

ipcMain.handle('lib:root', () => LIB);

/* ---------- 自绘标题栏的窗口控制 ---------- */
ipcMain.handle('menu:popup', () => { try { appMenu.popup({ window: win }); } catch (e) {} });
ipcMain.handle('win:min', () => { try { win.minimize(); } catch (e) {} });
ipcMain.handle('win:max', () => { try { win.isMaximized() ? win.unmaximize() : win.maximize(); } catch (e) {} });
ipcMain.handle('win:close', () => { try { win.close(); } catch (e) {} });
ipcMain.handle('win:state', () => { try { return { maximized: win.isMaximized() }; } catch (e) { return { maximized: false }; } });

// 书库数据: 渲染层启动时来取(替代原来的构建期内联 __MANIFEST__)
ipcMain.handle('lib:manifest', () => {
  try {
    const txt = fs.readFileSync(manifestPath(), 'utf8');
    const j = JSON.parse(txt);
    const comics = Array.isArray(j) ? j : (j && j.comics) || [];
    return { ok: true, comics: comics };
  } catch (e) {
    return { ok: false, msg: '读 _manifest.json 失败: ' + ((e && e.message) || e) };
  }
});

ipcMain.handle('lib:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择漫画书库目录' });
  if (r.canceled || !r.filePaths.length) return null;
  LIB = r.filePaths[0];
  const c = readCfg(); c.libraryRoot = LIB; writeCfg(c);
  watchLibrary();
  reload();
  return LIB;
});

ipcMain.handle('state:all', async () => ({
  libRoot: LIB,
  progress: readJSON(progJson(), {}),
  library: readJSON(libJson(), defaultLibrary()),
  workbench: readJSON(wbJson(), defaultWorkbench())
}));

// 工作台整体读写。渲染进程是唯一写入方, 所以这里不做合并; 但写前会做一次结构性校验,
// 防止半成品(比如 images 变成数组)被落盘 —— 那个文件丢了就等于参考图全丢。
ipcMain.handle('wb:get', async () => readJSON(wbJson(), defaultWorkbench()));
ipcMain.handle('wb:save', async (e, wb) => {
  if (!wb || typeof wb !== 'object' || Array.isArray(wb)) return { ok: false, msg: '工作台数据必须是对象' };
  if (typeof wb.images !== 'object' || Array.isArray(wb.images)) return { ok: false, msg: 'images 必须是对象(以 id 为键)' };
  if (typeof wb.boards !== 'object' || Array.isArray(wb.boards)) return { ok: false, msg: 'boards 必须是对象' };
  if (!Array.isArray(wb.inbox)) return { ok: false, msg: 'inbox 必须是数组' };
  await writeJSON(wbJson(), wb);
  return { ok: true, images: Object.keys(wb.images).length };
});
const { registerRefColorIpc } = require('./ref-colors.js');
registerRefColorIpc({ ipcMain, libRoot: () => LIB, loadSharp, logLine });


ipcMain.handle('state:progress', async (e, dir, val) => {
  const p = readJSON(progJson(), {});
  p[dir] = val;
  await writeJSON(progJson(), p);
  return true;
});

ipcMain.handle('state:library', async (e, lib) => {
  // 落盘前先和磁盘上的 library.json 合并: 命令行下载刚写的 作者/来源/标签/分类 不能被渲染进程的旧副本冲掉
  try {
    const disk = readJSON(libJson(), null);
    if (disk && disk.comics && lib && lib.comics) {
      for (const k of Object.keys(disk.comics)) {
        const d = disk.comics[k] || {};
        const m = lib.comics[k];
        if (!m) { lib.comics[k] = d; continue; }
        const merged = Object.assign({}, d, m);
        if (m.tags) merged.tags = Array.from(new Set((m.tags || []).concat(d.tags || [])));
        if (m.categories) merged.categories = Array.from(new Set((m.categories || []).concat(d.categories || [])));
        if (!merged.author && d.author) merged.author = d.author;
        if (!merged.source && d.source) merged.source = d.source;
        lib.comics[k] = merged;
      }
      if (Array.isArray(lib.categories) && Array.isArray(disk.categories)) {
        lib.categories = Array.from(new Set(lib.categories.concat(disk.categories)));
      }
    }
  } catch (e2) {}
  await writeJSON(libJson(), lib);
  return true;
});

ipcMain.handle('lib:rescan', async (e, opts) => {
  if (opts && opts.quiet) watchMuteUntil = Date.now() + 20000;   // 静默重建: 连"文件变了自动刷新"也一起压住
  const { execFile } = require('node:child_process');
  const script = path.join(LIB, '_scripts', 'build-library.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 _scripts/build-library.mjs' };
  return await new Promise((res) => {
    // 关键: Electron 作为 Node 跑脚本必须带 ELECTRON_RUN_AS_NODE, 否则子进程不退出, 回调永不触发, 界面点了没反应
    const args = [script, '--lib', LIB];
    if (opts && opts.offline) args.push('--offline');
    execFile(process.execPath, args, { cwd: LIB, timeout: 120000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, stdout, stderr) => {
      if (err) res({ ok: false, msg: String(stderr || err.message).slice(0, 800) });
      else {
        if (opts && opts.quiet) {
          if (win && !win.isDestroyed()) win.webContents.send('library:rebuilt');   // 复用前端现成监听器: saveShelfView + reload
        } else {
          reload();
        }
        res({ ok: true, msg: String(stdout).trim() });
      }
    });
  });
});

/* ================= 下载 ================= */
let dlAbort = null;
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);   // 与渲染层同名规则一致

async function dlmod() {
  const p = path.join(LIB, '_scripts', 'lib', 'downloader.mjs');
  if (!fs.existsSync(p)) throw new Error('找不到下载模块: ' + p);
  return await import(pathToFileURL(p).href);
}

function sendDl(ev) {
  validateDlEvent(ev);
  if (win && !win.isDestroyed()) win.webContents.send('dl:event', ev);
  updateTaskbarProgress(ev);
}

/* dl:event 的字段契约
   fetch-book 用 @@XXX@@ 标记行把事件打到 stdout, 主进程用
   s.slice(s.indexOf('@@XXX@@') + 长度) 抠出 JSON 再转成对象发给界面。
   这套解析**少一个字段不会报错** —— 界面只会"什么都不显示"或"步骤条卡在第一步"
   (工程记录里两者都真实发生过)。所以在这里按类型校验必备字段。
   表里只列"界面真的依赖"的字段, 免得把可有可无的也吵出来。 */
const DL_EVENT_FIELDS = {
  start: ['total'],
  'chapter-start': ['index'],
  'chapter-done': ['index'],
  'chapter-error': ['index', 'message'],
  prog: ['stage', 'got', 'total'],            // stage 缺失会让四步进度条永远停在第一步
  'tag-start': ['total'],
  'tag-progress': ['done', 'total'],
  'batch-start': ['total'],
  'work-start': ['index', 'total'],
  'work-done': ['index', 'total'],
  log: ['line'],
  error: ['message'],
  done: [], rebuilt: [], cancelled: []
};
function validateDlEvent(ev) {
  try {
    const t = ev && ev.type;
    if (!t) return;
    const need = DL_EVENT_FIELDS[t];
    if (!need) { logLine('契约', '[dl:event] 未知事件类型 "' + t + '"（主进程与 fetch-book 的标记行协议可能对不上）'); return; }
    const miss = need.filter((k) => ev[k] === undefined || ev[k] === null);
    if (miss.length) {
      logLine('契约', '[dl:event] "' + t + '" 缺字段: ' + miss.join(', ') + ' | 实到: ' + JSON.stringify(ev).slice(0, 200));
    }
  } catch (e) {}
}

/* 任务栏进度: 下载/更新时在任务栏图标上画进度条(Windows 自带那种)。
   所有下载事件都经过 sendDl, 所以挂这一处就够, 不必改每个转发点。
   事件语义: prog=单本逐章, tag-progress=容器批量逐本, done/error/cancelled=整个任务结束。 */
function updateTaskbarProgress(ev) {
  try {
    if (!win || win.isDestroyed()) return;
    const t = ev && ev.type;
    if (t === 'done' || t === 'error' || t === 'cancelled') { win.setProgressBar(-1); return; }   // -1 = 清除
    let got = 0, total = 0;
    if (t === 'tag-progress') { got = Number(ev.done) || 0; total = Number(ev.total) || 0; }
    else if (t === 'prog') { got = Number(ev.got) || 0; total = Number(ev.total) || 0; }
    else return;
    if (total > 0) win.setProgressBar(Math.max(0, Math.min(1, got / total)));
  } catch (e) {}
}

// 通用解析: 交给适配器 CLI(_scripts\sites\fetch-book.mjs --probe), 它自己会把代理环境准备好
let probeChild = null;
async function probeSite(url, onMore) {
  const u = String(url || '').trim();
  if (!u) return { ok: false, msg: '地址不能为空' };
  const script = path.join(LIB, '_scripts', 'sites', 'fetch-book.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 _scripts\\sites\\fetch-book.mjs' };
  const { spawn } = require('node:child_process');
  if (probeChild) { try { probeChild.kill(); } catch (e) {} probeChild = null; }
  const out = await new Promise((res) => {
    const p2 = spawn(NODE_BIN, [script, '--probe', '--url', u], { cwd: LIB, env: { ...process.env } });
    probeChild = p2;
    let buf = '', result = null;
    const feed = (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.indexOf('@@MORE@@') >= 0) {
          if (onMore) { try { onMore(JSON.parse(line.slice(8))); } catch (e) {} }
          continue;
        }
        if (line.indexOf('@@WORKS-DONE@@') >= 0) {
          if (onMore) { try { const j2 = JSON.parse(line.slice(14)); onMore({ done: true, total: j2.total }); } catch (e) {} }
          if (probeChild === p2) probeChild = null;
          continue;
        }
        if (line.indexOf('@@WORKS-ERR@@') >= 0) {
          if (onMore) { try { onMore({ error: JSON.parse(line.slice(13)).msg }); } catch (e) {} }
          continue;
        }
        if (line.indexOf('@@RESULT@@') >= 0 && !result) {
          result = line;
          if (onMore) res(line + '\n');
          continue;
        }
        // 其它行(如'正在数页数…已找到 119 页'): 也转发给界面, 否则解析那 10~20 秒界面一片死寂
        const s0 = line.trim();
        if (s0 && s0.indexOf('@@') < 0 && onMore) { try { onMore({ log: s0 }); } catch (e) {} }
      }
    };
    p2.stdout.on('data', feed);
    p2.stderr.on('data', feed);
    p2.on('error', (err) => res('SPAWN-ERR ' + String(err && err.message || err)));
    p2.on('exit', () => res(result ? result : buf));
    setTimeout(() => { try { p2.kill(); } catch (e2) {} }, 300000);
  });
  const line = String(out).split('\n').filter((l) => l.indexOf('@@RESULT@@') >= 0).pop();
  if (!line) return { ok: false, msg: '解析失败: ' + String(out).trim().split('\n').slice(-3).join(' ') };
  let j;
  try { j = JSON.parse(line.replace('@@RESULT@@', '').trim()); } catch (e) { return { ok: false, msg: '解析结果读不出来' }; }
  if (!j.ok) return { ok: false, msg: j.msg || '解析失败' };
  return j;
}

ipcMain.handle('dl:resolve', async (e, url) => {
  try {
    const sender = e.sender;
    const j = await probeSite(url, (more) => {
      try {
        if (more && more.log) sender.send('dl:resolve-log', more.log);   // 解析进度(数页数/取地址)实时给界面
        else sender.send('dl:more-works', more);
      } catch (e2) {}
    });
    if (!j.ok) return j;
    return { ok: true, site: j.site, title: j.title, rawTitle: j.rawTitle, author: j.author, desc: j.desc, cover: j.cover, chapters: j.chapters, chapterList: j.chapterList || null, url: j.url, tagBatch: j.tagBatch, galleries: j.galleries, pickList: j.pickList, pagePreview: j.pagePreview || null, next: j.next || "" };
  } catch (err) {
    return { ok: false, msg: String(err && err.message || err) };
  }
});

// 后台补 pixiv 作品缩略图和标题
let pickChild = null, pickRateMsg = '', pickErrMsg = '';
ipcMain.handle('dl:pick-details', async (e, ids) => {
  pickRateMsg = ''; pickErrMsg = '';
  logLine('下载', '[pick-details] 收到 ' + ((Array.isArray(ids) ? ids.length : 0)) + ' 个 id: ' + (Array.isArray(ids) ? ids.slice(0, 4).join(',') : String(ids)) + (Array.isArray(ids) && ids.length > 4 ? ' …' : ''));
  if (!Array.isArray(ids) || !ids.length) return { ok: false };
  if (pickChild) { try { pickChild.kill(); } catch (e) {} }
  const script = path.join(LIB, '_scripts', 'sites', 'fetch-book.mjs');
  const { spawn } = require('node:child_process');
  pickChild = spawn(NODE_BIN, [script, '--pick-details', '--ids', ids.join(',')], {
    cwd: LIB,
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890', NODE_USE_ENV_PROXY: '1', JM_PROXY_READY: '1' }
  });
  const child = pickChild;
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('@@PICK-RATE@@')) { try { pickRateMsg = JSON.parse(line.slice(13)).msg || 'pixiv 限流'; } catch (e) {} }
      else if (line.startsWith('@@PICK-ERR@@')) { try { pickErrMsg = JSON.parse(line.slice(12)).msg || ''; } catch (e) {} }
      else if (line.startsWith('@@PICK@@')) {
        try {
          const j = JSON.parse(line.slice(8));
          e.sender.send('pick-detail', j);
        } catch (err) { console.error('[pick-details] parse error:', err.message, line.slice(0, 100)); }
      } else if (line) {
        console.log('[pick-details] stdout:', line.slice(0, 200));
      }
    }
  });
  child.stderr.on('data', (d) => { console.log('[pick-details] stderr:', String(d).slice(0, 300)); });
  child.on('error', (err) => { console.error('[pick-details] spawn error:', err.message); });
  child.on('close', (code) => { console.log('[pick-details] exit code:', code); pickChild = null; e.sender.send('pick-detail-done', { rate: pickRateMsg, err: pickErrMsg }); pickRateMsg = ''; pickErrMsg = ''; });
  return { ok: true };
});
ipcMain.handle('dl:pick-stop', () => { if (pickChild) { try { pickChild.kill(); } catch (e) {} pickChild = null; } return { ok: true }; });

let dlProc = null;
ipcMain.handle('dl:start', async (e, opts) => {
  if (dlProc) return { ok: false, msg: '已有下载任务在进行中' };
  const url = String(opts && (opts.url || opts.slug) || '').trim();
  const name = String(opts && opts.name || '').trim();
  if (!url || !name) return { ok: false, msg: '缺少地址或书名' };
  const script = path.join(LIB, '_scripts', 'sites', 'fetch-book.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 _scripts\\sites\\fetch-book.mjs' };
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);
  const out = path.join(LIB, '漫画', safe(name));
  if (fs.existsSync(out)) {   // 已下过且有图 -> 直接说已下载过
    let hasImg = false;
    try {
      const walk = (p2) => {
        for (const e2 of fs.readdirSync(p2, { withFileTypes: true })) {
          if (hasImg) return;
          const q2 = path.join(p2, e2.name);
          if (e2.isDirectory()) walk(q2);
          else if (/\.(webp|jpg|jpeg|png|gif)$/i.test(e2.name)) { hasImg = true; return; }
        }
      };
      walk(out);
    } catch (e2) {}
    // 目录里已经有图也不再拦着: fetch-book 会跳过已存在的话、只补齐缺的
    if (hasImg) logLine('下载', '[续下] ' + safe(name) + ' 目录已有图片，继续补齐缺的章节');
  }
  const { spawn } = require('node:child_process');
  const args = [script, '--url', url, '--dir', safe(name)];
  if (opts.from) args.push('--from', String(opts.from));
  if (opts.to) args.push('--to', String(opts.to));
  if (opts.merge) args.push('--merge');   // 所有图片合并到一个文件夹
  if (opts.pick) args.push('--pick', String(opts.pick));   // 前端勾选的列表(gid|url;gid2|url2 或 id1,id2)
  if (opts.chapters) args.push('--chapters', String(opts.chapters));   // 前端勾选的话序号 "1,3,5-8"
  if (opts.pages) args.push('--pages', String(opts.pages));   // 前端勾选的页号 "1,3,5-8"(下载前预览用)
  dlActive = true; pendingReload = false;   // jmRunning 归源站更新/jm 任务独立使用, 双路并行各自管自己的静默标记
  logLine('下载', '[开始] ' + url + ' -> ' + safe(name) + (args.indexOf('--from') >= 0 ? ' [' + args.slice(args.indexOf('--from')).join(' ') + ']' : ''));
  dlProc = spawn(NODE_BIN, args, { cwd: LIB, env: { ...process.env } });
  let buf = '', doneInfo = null, lastProgSent = 0, childRebuilt = false;
  const SD = (ev) => sendDl(Object.assign({ src: 'dl' }, ev));   // 通用下载链路事件统一打 src:'dl'
  const handleLine = (line) => {
    const s = String(line);
    if (s.indexOf('@@START@@') >= 0) {
      try { const j = JSON.parse(s.slice(s.indexOf('@@START@@') + 9)); SD({ type: 'start', total: j.total, out: j.out }); } catch (e2) {}
      return;
    }
    if (s.indexOf('@@CH@@') >= 0) {
      try { const j = JSON.parse(s.slice(s.indexOf('@@CH@@') + 6)); SD({ type: 'chapter-start', index: j.index - 1, label: j.label }); } catch (e2) {}
      return;
    }
    if (s.indexOf('@@CHDONE@@') >= 0) {
      try { const j = JSON.parse(s.slice(s.indexOf('@@CHDONE@@') + 10)); SD({ type: 'chapter-done', index: j.index - 1, label: j.label, got: j.got, expected: j.expected, bytes: j.bytes, widths: [], failed: j.failed || 0, cbz: false }); } catch (e2) {}
      return;
    }
    if (s.indexOf('@@CHERR@@') >= 0) {
      try { const j = JSON.parse(s.slice(s.indexOf('@@CHERR@@') + 9)); SD({ type: 'chapter-error', index: j.index - 1, label: j.label, message: j.message }); } catch (e2) {}
      return;
    }
              if (s.indexOf('@@PROG@@') >= 0) {
      const now = Date.now();
      if (now - lastProgSent < 200) return;
      lastProgSent = now;
      try { const j = JSON.parse(s.slice(s.indexOf('@@PROG@@') + 8)); SD({ type: 'prog', stage: j.stage, index: j.index, got: j.got, total: j.total, bytes: j.bytes }); } catch (e2) {}
      return;
    }
    if (s.indexOf('@@TAGSTART@@') >= 0) {
      try { const j = JSON.parse(s.slice(s.indexOf('@@TAGSTART@@') + 12)); SD({ type: 'tag-start', total: j.total }); } catch (e2) {}
      return;
    }
    if (s.indexOf('@@TAGPROG@@') >= 0) {
      try { const j = JSON.parse(s.slice(s.indexOf('@@TAGPROG@@') + 12)); SD({ type: 'tag-progress', done: j.done, total: j.total, title: j.title }); } catch (e2) {}
      return;
    }
    if (s.indexOf('@@REBUILT@@') >= 0) {
      try { const j = JSON.parse(s.slice(s.indexOf('@@REBUILT@@') + 11)); childRebuilt = true; SD({ type: 'rebuilt', ok: !!j.ok }); } catch (e2) {}
      return;
    }
    if (s.indexOf('@@DONE@@') >= 0) { try { doneInfo = JSON.parse(s.slice(s.indexOf('@@DONE@@') + 8)); } catch (e2) {} return; }   // 收尾统一在 exit 里发
    if (s.trim()) { logLine('下载', s.trim()); SD({ type: 'log', line: s.trim() }); }
  };
  const onData = (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); handleLine(line); }
  };
  dlProc.stdout.on('data', onData);
  dlProc.stderr.on('data', onData);
  dlProc.on('error', (err) => SD({ type: 'log', line: '[启动失败] ' + String(err && err.message || err) }));
  dlProc.on('exit', async (code) => {
    if (buf.trim()) handleLine(buf);
    buf = '';
    logLine('下载', '[结束] ' + safe(name) + ' 退出码 ' + code);
    dlProc = null; dlActive = false;   // 不动 jmRunning: 源站更新可能还在并行跑
    // 任务结束后不自动 reload: 是否刷新由前端在收到 done/rebuilt 事件后自行决定
    if (code === 0) {
      // 子进程已自己重建过(tag 批量/单本都会发 @@REBUILT@@), 不再重复重建
      let incOk = false;
      if (childRebuilt) {
        logLine('下载', '[增量] 子进程已重建完毕');
        incOk = true;
      } else {
        const bookDir = '漫画/' + safe(name);
        try { incOk = await rebuildBook(bookDir); logLine('下载', incOk ? '[增量] 已重建 ' + bookDir : '[增量重建失败] ' + bookDir); }
        catch (e3) { logLine('下载', '[增量重建异常] ' + String(e3 && e3.message || e3)); }
      }
      SD({ type: 'done', incremental: !!childRebuilt, summary: { chapters: (doneInfo && doneInfo.chapters) || 0, images: (doneInfo && doneInfo.images) || 0, bytes: (doneInfo && doneInfo.bytes) || 0 }, incremental: incOk });
    } else {
      SD({ type: 'error', message: '下载脚本退出码 ' + code });
    }
    // 吞掉收尾异步重建对 书库.html 的写事件(短暂静默), 不主动 reload
    watchMuteUntil = Date.now() + 3000;
  });
  return { ok: true, started: true, out: out, dir: path.basename(out) };
});

// 容器(EH tag / pixiv 作者主页)串行批量: 勾了哪几本、每本勾了哪几页, 逐本跑 fetch-book
let dlBatchProc = null, dlBatchAbort = false;
ipcMain.handle('dl:startBatch', async (e, req) => {
  if (dlProc || dlBatchProc) return { ok: false, msg: '已有下载任务在进行中' };
  const { spawn } = require('node:child_process');   // 批量路径原来漏了这行 → spawn 未定义被 catch 吞掉, 点了完全没反应
  const jobs = ((req && req.jobs) || []).filter((j) => j && j.url);
  if (!jobs.length) return { ok: false, msg: '没有勾选任何作品' };
  const script = path.join(LIB, '_scripts', 'sites', 'fetch-book.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 _scripts\\sites\\fetch-book.mjs' };
  dlActive = true;
  dlBatchAbort = false;
  const SD = (ev) => sendDl(Object.assign({ src: 'dl' }, ev));
  logLine('下载', '[批量开始] ' + jobs.length + ' 本 <- ' + String((req && req.from) || '').slice(0, 120));
  SD({ type: 'batch-start', total: jobs.length, titles: jobs.map((j) => safeName(j.name || '')) });
  (async () => {
    let okN = 0, failN = 0, totalImgs = 0, totalBytes = 0, stopped = false, anyRebuilt = false;
    for (let i = 0; i < jobs.length; i++) {
      if (dlBatchAbort) { stopped = true; break; }
      const j = jobs[i];
      const name = safeName(j.name || '未命名');
      SD({ type: 'work-start', index: i, total: jobs.length, title: name });
      logLine('下载', '[' + (i + 1) + '/' + jobs.length + '] 开始 ' + name + (j.pages ? '（只下勾选的页）' : ''));
      const args = [script, '--url', String(j.url), '--dir', name];
      if (j.pages) args.push('--pages', String(j.pages));
      if (j.chapters) args.push('--chapters', String(j.chapters));
      if (j.merge) args.push('--merge');
      const res = await new Promise((resolve) => {
        const child = spawn(NODE_BIN, args, { cwd: LIB, env: { ...process.env } });
        dlBatchProc = child;
        let buf = '', lastProgSent = 0, lastStage = '', doneInfo = null, childRebuilt = false;
        const handleLine = (line) => {
          const s = String(line);
          if (s.indexOf('@@START@@') >= 0) { try { const k = JSON.parse(s.slice(9)); SD({ type: 'start', total: k.total, out: k.out, work: i }); } catch (e2) {} return; }
          if (s.indexOf('@@CH@@') >= 0) { try { const k = JSON.parse(s.slice(6)); SD({ type: 'chapter-start', index: k.index - 1, label: k.label, work: i }); } catch (e2) {} return; }
          if (s.indexOf('@@CHDONE@@') >= 0) { try { const k = JSON.parse(s.slice(10)); SD({ type: 'chapter-done', index: k.index - 1, label: k.label, got: k.got, expected: k.expected, bytes: k.bytes, failed: k.failed || 0, cbz: false, work: i }); } catch (e2) {} return; }
          if (s.indexOf('@@CHERR@@') >= 0) { try { const k = JSON.parse(s.slice(9)); SD({ type: 'chapter-error', index: k.index - 1, label: k.label, message: k.message, work: i }); } catch (e2) {} return; }
                    if (s.indexOf('@@PROG@@') >= 0) {
            try { logLine('诊断', '批量收到 PROG: ' + s.trim().slice(0, 120)); } catch (e) {}
            const now = Date.now();
            // 阶段切换(stage 变了)必须立刻转发, 否则步骤条会卡在旧的一步
            let stg = ''; try { stg = JSON.parse(s.slice(8)).stage || ''; } catch (e) {}
            if (stg === lastStage) { if (now - lastProgSent < 200) return; }
            lastStage = stg;
            lastProgSent = now;
            try { const k = JSON.parse(s.slice(8)); SD({ type: 'prog', stage: k.stage, index: k.index, got: k.got, total: k.total, bytes: k.bytes, work: i }); } catch (e2) {}
            return;
          }
          if (s.indexOf('@@REBUILT@@') >= 0) { try { const k = JSON.parse(s.slice(11)); childRebuilt = true; SD({ type: 'rebuilt', ok: !!k.ok, work: i }); } catch (e2) {} return; }
          if (s.indexOf('@@DONE@@') >= 0) { try { doneInfo = JSON.parse(s.slice(8)); } catch (e2) {} return; }
          if (s.trim()) { logLine('下载', '  ' + s.trim()); SD({ type: 'log', line: s.trim(), work: i }); SD({ type: 'resolve-log', line: s.trim() }); }
        };
        const onData = (d) => {
          buf += String(d);
          let ix;
          while ((ix = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, ix); buf = buf.slice(ix + 1); handleLine(line); }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', (err) => { SD({ type: 'log', line: '[启动失败] ' + String(err && err.message || err), work: i }); resolve({ code: -1 }); });
        child.on('exit', (code) => {
          if (buf.trim()) handleLine(buf);
          buf = '';
          resolve({ code: code, info: doneInfo, rebuilt: childRebuilt });
        });
      });
      dlBatchProc = null;
      const info = res.info || {};
      totalImgs += info.images || 0;
      totalBytes += info.bytes || 0;
      if (res.code === 0) okN++; else failN++;
      logLine('下载', '[' + (i + 1) + '/' + jobs.length + '] ' + (res.code === 0 ? '完成' : '失败(退出码 ' + res.code + ')') + ' ' + name);
      SD({ type: 'work-done', index: i, total: jobs.length, title: name, ok: res.code === 0, images: info.images || 0, bytes: info.bytes || 0, rebuilt: !!res.rebuilt });
      anyRebuilt = anyRebuilt || !!res.rebuilt;
    }
    dlActive = false;
    dlBatchProc = null;
    logLine('下载', '[批量结束] 成功 ' + okN + ' / 失败 ' + failN + (stopped ? '（被取消）' : ''));
    SD({ type: 'done', incremental: anyRebuilt, summary: { chapters: okN, images: totalImgs, bytes: totalBytes }, cancelled: stopped, batch: true, jobs: jobs.length });   // 批量也要报增量, 否则收尾按钮显示成「全量更新书库」
    watchMuteUntil = Date.now() + 3000;
  })();
  return { ok: true, started: true, jobs: jobs.length };
});
ipcMain.handle('dl:batchCancel', () => {
  dlBatchAbort = true;
  if (dlBatchProc) { try { dlBatchProc.kill(); } catch (e) {} dlBatchProc = null; }
  sendDl({ type: 'cancelled', src: 'dl' });
  return true;
});

ipcMain.handle('dl:works-more', async (e, nextUrl) => {
  const nx = String(nextUrl || '').trim();
  if (!nx) return { ok: false, msg: '没有下一批的链接了' };
  const script = path.join(LIB, '_scripts', 'sites', 'fetch-book.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 fetch-book.mjs' };
  const { spawn } = require('node:child_process');
  const out = await new Promise((res) => {
    const p2 = spawn(NODE_BIN, [script, '--probe', '--tag-next', nx], { cwd: LIB, env: { ...process.env } });
    let buf = '';
    p2.stdout.on('data', (d) => { buf += String(d); });
    p2.stderr.on('data', (d) => { buf += String(d); });
    p2.on('error', (err) => res('SPAWN-ERR ' + String(err && err.message || err)));
    p2.on('exit', () => res(buf));
    setTimeout(() => { try { p2.kill(); } catch (e2) {} }, 60000);
  });
  const line = String(out).split('\n').filter((l) => l.indexOf('@@RESULT@@') >= 0).pop();
  if (!line) return { ok: false, msg: '继续取失败: ' + String(out).trim().split('\n').slice(-2).join(' ') };
  try { return JSON.parse(line.replace('@@RESULT@@', '').trim()); } catch (e2) { return { ok: false, msg: '继续取的结果读不出来' }; }
});
ipcMain.handle('dl:preview-end', () => clearPreviewCache('预览结束'));
ipcMain.handle('dl:preview-keep', (e, works) => {
  try { (Array.isArray(works) ? works : []).forEach((w) => { if (w) keptWorks.add(String(w)); }); } catch (e2) {}
  return { ok: true, kept: keptWorks.size };
});
// ── 浏览器标签（读那个带 --remote-debugging-port=9333 的 Chrome，主进程直接 HTTP，不用起子进程）──
const BROWSER_PORT = 9333;
function isWorkTabUrl(u) {
  return /e-hentai\.org\/g\/\d+\/[0-9a-f]+/i.test(u) ||
         /nhentai\.net\/g\/\d+/i.test(u) ||
         /pixiv\.net\/artworks\/\d+/i.test(u) ||
         /pixiv\.net\/users\/\d+/i.test(u) ||
         /e-hentai\.org\/tag\//i.test(u);
}
async function browserTabs() {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    const r = await fetch('http://127.0.0.1:' + BROWSER_PORT + '/json/list', { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, msg: '浏览器调试端口没响应(HTTP ' + r.status + ')' };
    const list = await r.json();
    const tabs = (list || []).filter((x) => x.type === 'page' && x.url && !/^(devtools:|chrome:|about:)/i.test(x.url))
      .map((x) => ({ id: x.id, url: x.url, title: x.title || '', active: !!x.active, work: isWorkTabUrl(x.url) }));
    return { ok: true, port: BROWSER_PORT, tabs: tabs, 作品页: tabs.filter((t) => t.work).length };
  } catch (e) {
    return { ok: false, msg: '连不上浏览器调试端口 ' + BROWSER_PORT + '（浏览器没开，或者不是用 open-chrome.mjs 启动的）' };
  }
}
ipcMain.handle('tabs:list', async () => browserTabs());
// ── 浏览器标签的"待挑列表"(pending.json): 收下的本子会累积, 关弹窗不丢; 已入库的自动移出 ──
const PENDING_FILE = path.join(DEFAULT_LIB, '_scripts', 'jm', 'pending.json');   // 和 fetch-book 里的路径一致(装在哪个盘都跟安装目录走)
function readPending() {
  try { const a = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function writePending(list) { try { fs.writeFileSync(PENDING_FILE, JSON.stringify(list, null, 1), 'utf8'); } catch (e) {} }
function inLibrary(url) {
  // 按 url 精确比对: 以前是"在 library.json 全文里搜字符串", id 是 7 位数字,
  // 撞上任何别的字段(页数/日期/别站 id)都会误判成"已入库" → 把待挑列表里刚收的条目误删。
  const u = String(url || '').trim();
  if (!u) return false;
  try {
    const lib = JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));
    const comics = (lib && lib.comics) || {};
    for (const k of Object.keys(comics)) {
      const s = comics[k] && comics[k].source;
      if (s && String(s.url || '').trim() === u) return true;
    }
    return false;
  } catch (e) { return false; }
}
function prunePending() {
  const list = readPending();
  const keep = list.filter((x) => !inLibrary(x.url));   // 按 url 精确比对(以前按 id 全文搜, 会误判)   // 下载成功后(已入库)自动移出
  if (keep.length !== list.length) writePending(keep);
  return keep;
}
ipcMain.handle('tabs:pending', () => ({ ok: true, items: prunePending() }));
ipcMain.handle('tabs:pending-add', (e, item) => {
  const it = item && typeof item === 'object' ? item : null;
  if (!it || !it.url) return { ok: false, msg: '没有 url' };
  const list = prunePending();
  if (!list.some((x) => x.url === it.url)) list.push(it);
  writePending(list);
  return { ok: true, count: list.length };
});
ipcMain.handle('tabs:pending-clear', () => { writePending([]); return { ok: true }; });
ipcMain.handle('tabs:pending-drop', (e, url) => {
  const list = readPending().filter((x) => x.url !== String(url || ''));
  writePending(list);
  return { ok: true, count: list.length };
});
// 找出"用户正在看的那个标签": CDP 不给 active 标记, 所以挨个问每个标签
// "你可见吗/你有焦点吗"(document.visibilityState / hasFocus)。实测 54 个标签里恰好 1 个 visible。
// 后台被 Chrome 冻结的标签会连不上, 所以超时要短(700ms), 否则一次要点两秒多。
async function probeTabVisible(t) {
  return new Promise((resolve) => {
    let done = false, ws = null;
    const finish = (v) => { if (done) return; done = true; try { if (ws) ws.close(); } catch (e) {} resolve(v); };
    if (!t || !t.webSocketDebuggerUrl) return finish(null);
    try { ws = new WebSocket(t.webSocketDebuggerUrl); } catch (e) { return finish(null); }
    const timer = setTimeout(() => finish(null), 700);
    ws.onopen = () => { try { ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.visibilityState + "|" + document.hasFocus()', returnByValue: true } })); } catch (e) { finish(null); } };
    ws.onmessage = (ev) => { try { const m = JSON.parse(String(ev.data)); if (m.id === 1) { clearTimeout(timer); finish(String((m.result && m.result.result && m.result.result.value) || '')); } } catch (e) {} };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}
async function browserCurrentTab() {
  let list = null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    const r = await fetch('http://127.0.0.1:' + BROWSER_PORT + '/json/list', { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, msg: '浏览器调试端口没响应(HTTP ' + r.status + ')' };
    list = await r.json();
  } catch (e) {
    return { ok: false, msg: '连不上浏览器调试端口 ' + BROWSER_PORT + '（浏览器没开，或者不是用 open-chrome.mjs 启动的）' };
  }
  const pages = (list || []).filter((x) => x.type === 'page' && x.url && !/^(devtools:|chrome:|about:)/i.test(x.url));
  const probe = await Promise.all(pages.map((x) => probeTabVisible(x).then((v) => ({ x: x, v: v }))));
  const vis = probe.filter((p) => p.v && p.v.indexOf('visible') === 0);
  const pick = vis.filter((p) => p.v.indexOf('|true') > 0)[0] || vis[0] || null;
  if (!pick) return { ok: false, msg: '没找到正在看的那个标签（浏览器可能最小化了），请用「列出开着的标签」挑' };
  return { ok: true, tab: { id: pick.x.id, url: pick.x.url, title: pick.x.title || '', active: true, work: isWorkTabUrl(pick.x.url) }, 可见数: vis.length };
}ipcMain.handle('tabs:current', async () => browserCurrentTab());
ipcMain.handle('tabs:close', async (e, id) => {
  const tid = String(id || '');
  if (!tid) return { ok: false, msg: '没给标签 id' };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    const r = await fetch('http://127.0.0.1:' + BROWSER_PORT + '/json/close/' + encodeURIComponent(tid), { signal: ac.signal });
    clearTimeout(timer);
    return { ok: r.ok, msg: r.ok ? '' : '关标签失败(HTTP ' + r.status + ')' };
  } catch (e2) { return { ok: false, msg: '关标签失败: ' + String(e2 && e2.message || e2) }; }
});

ipcMain.handle('perf:log', (e, msg) => { try { logLine('性能', String(msg || '')); } catch (e2) {} return true; });   // 渲染进程的现场性能采样写进日志
ipcMain.handle('dl:works-stop', () => {
  if (probeChild) { try { probeChild.kill(); } catch (e) {} probeChild = null; }
  return true;
});

ipcMain.handle('dl:cancel', () => {
  if (!dlProc) return false;
  try { dlProc.kill(); } catch (e) {}
  sendDl({ type: 'cancelled', src: 'dl' });
  dlProc = null; dlActive = false;   // 不动 jmRunning: 源站更新可能还在并行跑
  return true;
});
ipcMain.handle('dl:busy', () => !!dlProc);
ipcMain.handle('lib:comicPath', (e, dir) => path.join(LIB, dir));

/* ============ 禁漫一键下载: 在 App 里跑 _scripts\jm\jm-auto.mjs, 日志实时回传 ============ */
let jmProc = null;
ipcMain.handle('jm:start', (e, urls, browser) => {
  if (jmProc) return { ok: false, msg: '已有下载任务在跑' };
  const script = path.join(LIB, '_scripts', 'jm', 'jm-auto.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 _scripts\\jm\\jm-auto.mjs' };
  // 这里不做格式过滤: JM1452133 / 纯数字 / 链接 都交给 _scripts\jm\target.mjs 归一化
  const list = (Array.isArray(urls) ? urls.join(' ') : String(urls || '')).split(/[\s,;，；]+/).filter(Boolean);
  if (!list.length) return { ok: false, msg: '没有有效目标' };
  const { spawn } = require('node:child_process');
  jmRunning = true; pendingReload = false;
  const args = [script, list.join(' ')];
  const useEdge = String(browser || 'chrome') === 'edge';   // 默认 Chrome
  const useChrome = !useEdge;
  if (useEdge) args.push('--edge');
  jmProc = spawn(process.execPath, args, { cwd: LIB, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', JM_PORT: useChrome ? '9333' : '9334' } });
  const send = (t) => { logLine('禁漫', t); if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'log', line: String(t) }); };
  jmProc.stdout.on('data', (d) => send(d));
  jmProc.stderr.on('data', (d) => send(d));
  jmProc.on('error', (err) => {
    if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'log', line: '[启动失败] ' + String(err && err.message || err) + '\n' });
  });
  jmProc.on('exit', (code) => {
    logLine('禁漫', '[结束] 退出码 ' + code);
    jmProc = null;
    jmRunning = false;
    if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'done', code: code });
    // 等 3 秒让大家看完日志, 再离线重建书库(不联网), 然后通知前端刷新而非整页 reload
    setTimeout(async () => {
      try {
        if (pendingReload) {
          pendingReload = false;
          // 离线重建书库.html(不联网, 不扫别名)
          const script = path.join(LIB, '_scripts', 'build-library.mjs');
          if (fs.existsSync(script)) {
            const { spawn } = require('node:child_process');
            await new Promise((res) => {
              const bp = spawn(process.execPath, [script, '--lib', LIB, '--offline'], { cwd: LIB, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
              bp.on('exit', () => res());
            });
          }
          // 通知前端刷新书架(保留滚动位置), 不整页 reload
          if (win && !win.isDestroyed()) win.webContents.send('library:rebuilt');
        }
      } catch (e2) {}
    }, 3000);
  });
  return { ok: true, count: list.length, browser: useChrome ? 'chrome' : 'edge' };
});
/* ============ 下载队列: 排队(并发1) + 失败自动重试 + 持久化(关掉 App 下次继续) ============ */
const QUEUE_MAX_TRIES = 3;
let jmQueue = { items: [], running: false, wasRunning: false };
let queueBrowser = 'chrome';
function queueFile() { return path.join(LIB, '_scripts', 'jm', 'queue.json'); }
function queueInfo() {
  const n = { wait: 0, run: 0, done: 0, fail: 0 };
  for (const it of jmQueue.items) n[it.status] = (n[it.status] || 0) + 1;
  return { running: jmQueue.running, items: jmQueue.items, counts: n };
}
function loadQueue() {
  const q = readJSON(queueFile(), null);
  jmQueue = { items: [], running: false, wasRunning: false };
  if (q && Array.isArray(q.items)) {
    jmQueue.items = q.items.filter(x => x && x.url).map(x => ({ id: x.id || ('q' + Math.random().toString(36).slice(2, 9)), raw: x.raw || x.url, url: x.url, status: x.status === 'run' ? 'wait' : (x.status || 'wait'), tries: x.tries || 0, note: x.status === 'run' ? '上次被关闭, 待继续' : (x.note || ''), addedAt: x.addedAt || Date.now() }));
    jmQueue.wasRunning = !!q.wasRunning;     // 上次是在跑的时候被关掉的 -> 启动后自动接着跑
  }
}
function saveQueue() {
  jmQueue.wasRunning = jmQueue.running || jmQueue.wasRunning;
  try { fs.mkdirSync(path.dirname(queueFile()), { recursive: true }); fs.writeFileSync(queueFile(), JSON.stringify({ items: jmQueue.items, running: jmQueue.running, wasRunning: jmQueue.wasRunning }, null, 2), 'utf8'); } catch (e) {}
}
function queueEmit() { if (win && !win.isDestroyed()) win.webContents.send('jmq:event', queueInfo()); }
async function normList(texts) {
  const { normTargets } = await import(pathToFileURL(path.join(LIB, '_scripts', 'jm', 'target.mjs')).href);
  return normTargets(Array.isArray(texts) ? texts : String(texts || '').split(/[\s,;，；]+/));
}
function spawnJmOne(url) {
  return new Promise((resolve) => {
    const script = path.join(LIB, '_scripts', 'jm', 'jm-auto.mjs');
    if (!fs.existsSync(script)) return resolve({ code: -1, out: '找不到 _scripts\\jm\\jm-auto.mjs' });
    const { spawn } = require('node:child_process');
    const useEdge = String(queueBrowser) === 'edge';
    const args = [script, url];
    if (useEdge) args.push('--edge');
    jmRunning = true; pendingReload = false;
    jmProc = spawn(process.execPath, args, { cwd: LIB, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', JM_PORT: useEdge ? '9334' : '9333' } });
    let out = '';
    logLine('队列', '[开始] ' + url + (useEdge ? ' (Edge)' : ' (Chrome)'));
    const send = (t) => { out += String(t); logLine('队列', t); if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'log', line: String(t) }); };
    jmProc.stdout.on('data', send);
    jmProc.stderr.on('data', send);
    jmProc.on('error', (err) => send('[启动失败] ' + String((err && err.message) || err) + '\n'));
    jmProc.on('exit', (code) => { logLine('队列', '[结束] ' + url + ' 退出码 ' + code); jmProc = null; jmRunning = false; resolve({ code: code == null ? -1 : code, out }); });
  });
}
async function runQueue() {
  if (jmQueue.running) return;
  jmQueue.running = true; saveQueue(); queueEmit();
  for (;;) {
    if (!jmQueue.running) break;
    const it = jmQueue.items.find(x => x.status === 'wait');
    if (!it) break;
    it.status = 'run'; it.tries = (it.tries || 0) + 1; it.note = '第 ' + it.tries + ' 次尝试';
    saveQueue(); queueEmit();
    const r = await spawnJmOne(it.url);
    if (!jmQueue.running) { it.status = 'wait'; it.note = '已暂停'; break; }
    if (r.code === 0) {
      const skipped = /已下载过|跳过|已在库/.test(r.out);
      it.status = 'done'; it.note = skipped ? '已在库 · 跳过' : '完成';
    } else if ((it.tries || 0) < QUEUE_MAX_TRIES) {
      it.status = 'wait'; it.note = '失败(退出码 ' + r.code + ')，自动重试';
    } else {
      it.status = 'fail'; it.note = '失败 ' + it.tries + ' 次(退出码 ' + r.code + ')';
    }
    saveQueue(); queueEmit();
  }
  jmQueue.running = false; jmQueue.wasRunning = false; saveQueue(); queueEmit();
  if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'done', code: 0 });
  setTimeout(() => { try { reload(); } catch (e) {} }, 3000);
}
/* 作者别名: UI 里"合并作者"写到 _scripts\author-alias.json, 下次重建书库时套用 */
ipcMain.handle('alias:get', () => {
  try { return { ok: true, map: readJSON(path.join(LIB, '_scripts', 'author-alias.json'), {}) }; }
  catch (e) { return { ok: false, msg: String(e && e.message || e), map: {} }; }
});
ipcMain.handle('alias:save', async (e, map) => {
  try {
    const f = path.join(LIB, '_scripts', 'author-alias.json');
    const cur = readJSON(f, {});
    for (const k in (map || {})) { if (String(k).trim()) cur[k] = String(map[k] == null ? '' : map[k]); }
    await writeJSON(f, cur);
    logLine('作者别名', JSON.stringify(map));
    return { ok: true, n: Object.keys(cur).length, file: f };
  } catch (err) { return { ok: false, msg: String(err && err.message || err) }; }
});

ipcMain.handle('jmq:list', () => queueInfo());
ipcMain.handle('jmq:add', async (e, texts) => {
  const urls = await normList(texts);
  if (!urls.length) return Object.assign({ ok: false, msg: '没识别出目标（可填 JM1452133 / 1452133 / 专辑链接 / 单话链接）' }, queueInfo());
  let added = 0;
  for (const u of urls) {
    if (jmQueue.items.some(it => it.url === u && it.status !== 'fail')) continue;
    jmQueue.items.push({ id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), raw: u, url: u, status: 'wait', tries: 0, note: '', addedAt: Date.now() });
    added++;
  }
  saveQueue(); queueEmit();
  return Object.assign({ ok: true, added }, queueInfo());
});
ipcMain.handle('jmq:start', (e, browser) => { if (browser) queueBrowser = String(browser); runQueue(); return queueInfo(); });
ipcMain.handle('jmq:pause', () => {
  jmQueue.running = false; jmQueue.wasRunning = false;
  try { if (jmProc) jmProc.kill(); } catch (e) {}
  saveQueue(); queueEmit();
  return queueInfo();
});
ipcMain.handle('jmq:clear', (e, mode) => {
  jmQueue.items = String(mode) === 'all' ? [] : jmQueue.items.filter(it => it.status !== 'done');
  saveQueue(); queueEmit();
  return queueInfo();
});
ipcMain.handle('jmq:remove', (e, id) => { jmQueue.items = jmQueue.items.filter(it => it.id !== id); saveQueue(); queueEmit(); return queueInfo(); });
ipcMain.handle('jmq:retry', (e, id) => {
  const it = jmQueue.items.find(x => x.id === id);
  if (it) { it.status = 'wait'; it.tries = 0; it.note = ''; }
  saveQueue(); queueEmit();
  return queueInfo();
});

/* 打开/前置调试浏览器(停在禁漫首页) */
/* 在"下载用的那个调试浏览器"里打开链接(Chrome:9333 / Edge:9334), 没起来就先启动 */
async function openInDebug(rawUrl, browser) {
  const useEdge = String(browser || 'chrome') === 'edge';
  const port = useEdge ? 9334 : 9333;
  const name = useEdge ? 'Edge' : 'Chrome';
  const target = String(rawUrl || 'https://18comic.vip/').trim();
  const enc = encodeURIComponent(target);
  const isUp = async () => { try { const r0 = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(3000) }); return r0.ok; } catch (e) { return false; } };
  const openTab = async () => {
    try { const r1 = await fetch('http://127.0.0.1:' + port + '/json/new?' + enc, { method: 'PUT', signal: AbortSignal.timeout(4000) }); if (r1.ok) return true; } catch (e) {}
    try { const r2 = await fetch('http://127.0.0.1:' + port + '/json/new?' + enc, { signal: AbortSignal.timeout(4000) }); if (r2.ok) return true; } catch (e) {}
    return false;
  };
  const host = (() => { try { return new URL(target).host; } catch (e) { return target; } })();
  if (await isUp()) {
    const opened = await openTab();
    return { ok: true, opened: opened, msg: name + ' 已在运行(端口 ' + port + ')，' + (opened ? '已打开 ' + host : '已有窗口, 请在任务栏切过去') };
  }
  const script = path.join(LIB, '_scripts', 'jm', useEdge ? 'open-edge.mjs' : 'open-chrome.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到启动脚本 ' + path.basename(script) };
  const { spawn } = require('node:child_process');
  const run = new Promise((res) => {
    const p2 = spawn(process.execPath, [script], { cwd: LIB, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', JM_PORT: String(port) } });
    let out = '';
    p2.stdout.on('data', (d) => { out += d; });
    p2.stderr.on('data', (d) => { out += d; });
    p2.on('error', (err) => res({ ok: false, msg: '启动失败: ' + String((err && err.message) || err) }));
    p2.on('exit', async (code) => {
      const last = out.trim().split('\n').filter(Boolean).pop() || ('退出码 ' + code);
      if (!(await isUp())) return res({ ok: false, msg: '启动失败: ' + last });
      const opened = await openTab();
      res({ ok: true, opened: opened, msg: name + ' 已启动，' + (opened ? '已打开 ' + host : '请手动切到 ' + host) });
    });
  });
  const timeout = new Promise((res) => setTimeout(() => res({ ok: false, msg: '启动超时(45 秒), 请手动跑 _scripts\\jm\\open-' + (useEdge ? 'edge' : 'chrome') + '.mjs' }), 45000));
  return await Promise.race([run, timeout]);
}

ipcMain.handle('jm:browser', async (e, browser) => {
  const r = await openInDebug('https://18comic.vip/', browser);
  if (r.ok) logLine('浏览器', '打开禁漫首页(端口 ' + (String(browser) === 'edge' ? 9334 : 9333) + ')');
  return r;
});

/* 漫画网站总览: 在同一个调试浏览器里打开某个站; 调试浏览器起不来就退回系统默认浏览器 */
ipcMain.handle('site:open', async (e, url, browser) => {
  let r = await openInDebug(url, browser);
  if (!r.ok) {
    try {
      await shell.openExternal(url);
      r = { ok: true, opened: true, msg: '调试浏览器没起来（' + r.msg + '），已用系统默认浏览器打开 ' + url };
    } catch (e2) {}
  }
  logLine('浏览器', (r.ok ? '打开 ' : '打开失败 ') + url + ' | ' + r.msg);
  return r;
});

/* 检查某本是否有新话(走站点适配器) */
ipcMain.handle('jm:checkUpdate', async (e, dir) => {
  try {
    const lib = readJSON(libJson(), defaultLibrary());
    const ent = (lib.comics || {})[dir];
    const url = ent && ent.source && ent.source.url;
    if (!url) return { ok: false, msg: '这本书没有来源链接（右键「简介与来源」可以补）' };
    const script = path.join(LIB, '_scripts', 'jm', 'check-update.mjs');
    if (!fs.existsSync(script)) return { ok: false, msg: '找不到 check-update.mjs' };
    const book = dir.indexOf('/') >= 0 ? dir.split('/').pop() : dir;
    const { spawn } = require('node:child_process');
    const outTxt = await new Promise((res) => {
      // 必须用真实 Node(24): Electron 自带的 Node 22 不支持 NODE_USE_ENV_PROXY, 走不了代理 → 漫画站会 fetch failed
      const p2 = spawn(NODE_BIN, [script, '--url', url, '--dir', book], { cwd: LIB, env: { ...process.env } });
      let buf = '';
      p2.stdout.on('data', (d) => { buf += d; });
      p2.stderr.on('data', (d) => { buf += d; });
      p2.on('error', () => res(''));
      p2.on('exit', () => res(buf));
      setTimeout(() => { try { p2.kill(); } catch (e2) {} }, 300000);
    });
    const line = String(outTxt).split('\n').filter((l) => l.indexOf('@@RESULT@@') >= 0).pop();
    if (!line) return { ok: false, msg: '检查失败: ' + String(outTxt).trim().slice(-120) };
    const j = JSON.parse(line.replace('@@RESULT@@', '').trim());
    j.url = url;
    return j;
  } catch (err) { return { ok: false, msg: String(err && err.message || err) }; }
});

/* 更新某一本: 漫画站走适配器, 其它(禁漫等)走 jm-auto */
ipcMain.handle('jm:fetchBook', async (e, payload) => {
  const dir = (payload && payload.dir) || payload;   // 兼容老调用只传 dir
  const chapters = (payload && payload.chapters) || '';   // 勾选的话序号 "1,3,5-8"
  if (jmProc) return { ok: false, msg: '已有任务在跑' };
  const lib = readJSON(libJson(), defaultLibrary());
  const ent = (lib.comics || {})[dir];
  const url = ent && ent.source && ent.source.url;
  if (!url) return { ok: false, msg: '这本书没有来源链接' };
  const book = dir.indexOf('/') >= 0 ? dir.split('/').pop() : dir;
  // 除了 18comic, 其它来源都交给适配器(fetch-book.mjs); 不认识的站它会明确说"暂不支持", 不会再拿禁漫流程硬跑
  const isAdapter = !/(^|\.|\/)18comic\.(vip|org|com)|jmcomic/i.test(url);
  const script = isAdapter ? path.join(LIB, '_scripts', 'sites', 'fetch-book.mjs') : path.join(LIB, '_scripts', 'jm', 'jm-auto.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 ' + path.basename(script) };
  const args = isAdapter ? [script, '--url', url, '--dir', book] : [script, url];
  if (isAdapter && chapters) args.push('--chapters', String(chapters));
  const { spawn } = require('node:child_process');
  jmRunning = true; pendingReload = false;
  jmProc = spawn(isAdapter ? NODE_BIN : process.execPath, args, { cwd: LIB, env: isAdapter ? { ...process.env } : { ...process.env, ELECTRON_RUN_AS_NODE: '1', JM_PORT: '9333' } });
  const send2 = (t) => { if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'log', line: String(t) }); };
  if (isAdapter) {
    // 漫画站(fetch-book.mjs): 和通用下载(dl:start)同一套协议解析, 事件打 src:'jm', 复用通用进度条显示
    let buf = '', doneInfo = null, lastProgSent = 0, childRebuilt = false;
    const onLine = (line) => {
      const s = String(line);
      if (s.indexOf('@@START@@') >= 0) {
        try { const j = JSON.parse(s.slice(s.indexOf('@@START@@') + 9)); sendDl({ type: 'start', total: j.total, out: j.out, src: 'jm' }); } catch (e2) {}
        return;
      }
      if (s.indexOf('@@CH@@') >= 0) {
        try { const j = JSON.parse(s.slice(s.indexOf('@@CH@@') + 6)); sendDl({ type: 'chapter-start', index: j.index - 1, label: j.label, src: 'jm' }); } catch (e2) {}
        return;
      }
      if (s.indexOf('@@CHDONE@@') >= 0) {
        try { const j = JSON.parse(s.slice(s.indexOf('@@CHDONE@@') + 10)); sendDl({ type: 'chapter-done', index: j.index - 1, label: j.label, got: j.got, expected: j.expected, bytes: j.bytes, widths: [], failed: j.failed || 0, cbz: false, src: 'jm' }); } catch (e2) {}
        return;
      }
      if (s.indexOf('@@CHERR@@') >= 0) {
        try { const j = JSON.parse(s.slice(s.indexOf('@@CHERR@@') + 9)); sendDl({ type: 'chapter-error', index: j.index - 1, label: j.label, message: j.message, src: 'jm' }); } catch (e2) {}
        return;
      }
                if (s.indexOf('@@PROG@@') >= 0) {
            try { logLine('诊断', '批量收到 PROG: ' + s.trim().slice(0, 120)); } catch (e) {}
        const now = Date.now();
        if (now - lastProgSent < 200) return;
        lastProgSent = now;
        try { const j = JSON.parse(s.slice(s.indexOf('@@PROG@@') + 8)); sendDl({ type: 'prog', stage: j.stage, index: j.index, got: j.got, total: j.total, bytes: j.bytes, src: 'jm' }); } catch (e2) {}
        return;
      }
      if (s.indexOf('@@TAGSTART@@') >= 0) {
        try { const j = JSON.parse(s.slice(s.indexOf('@@TAGSTART@@') + 12)); sendDl({ type: 'tag-start', total: j.total, src: 'jm' }); } catch (e2) {}
        return;
      }
      if (s.indexOf('@@TAGPROG@@') >= 0) {
        try { const j = JSON.parse(s.slice(s.indexOf('@@TAGPROG@@') + 12)); sendDl({ type: 'tag-progress', done: j.done, total: j.total, title: j.title, src: 'jm' }); } catch (e2) {}
        return;
      }
      if (s.indexOf('@@REBUILT@@') >= 0) {
        try { const j = JSON.parse(s.slice(s.indexOf('@@REBUILT@@') + 11)); childRebuilt = true; sendDl({ type: 'rebuilt', ok: !!j.ok, src: 'jm' }); } catch (e2) {}
        return;
      }
      if (s.indexOf('@@DONE@@') >= 0) { try { doneInfo = JSON.parse(s.slice(s.indexOf('@@DONE@@') + 8)); } catch (e2) {} return; }
      if (s.trim()) { send2(s.trim()); sendDl({ type: 'log', line: s.trim(), src: 'jm' }); }
    };
    const onData = (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); onLine(line); }
    };
    jmProc.stdout.on('data', onData);
    jmProc.stderr.on('data', onData);
    jmProc.on('error', (err) => sendDl({ type: 'log', line: '[启动失败] ' + String(err && err.message || err), src: 'jm' }));
    jmProc.on('exit', async (code) => {
      if (buf.trim()) onLine(buf);
      buf = '';
      jmProc = null; jmRunning = false;
      if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'done', code: code });
      // 和通用下载一致: 发 done/error 让进度条收尾; 是否增量重建看子进程有没有发 @@REBUILT@@
      if (code === 0) {
        let incOk = false;
        if (childRebuilt) {
          logLine('更新', '[增量] 子进程已重建完毕');
          incOk = true;
        } else {
          const bookDir = '漫画/' + book;
          try { incOk = await rebuildBook(bookDir); logLine('更新', incOk ? '[增量] 已重建 ' + bookDir : '[增量重建失败] ' + bookDir); }
          catch (e3) { logLine('更新', '[增量重建异常] ' + String(e3 && e3.message || e3)); }
        }
        sendDl({ type: 'done', incremental: !!childRebuilt, summary: { chapters: (doneInfo && doneInfo.chapters) || 0, images: (doneInfo && doneInfo.images) || 0, bytes: (doneInfo && doneInfo.bytes) || 0 }, incremental: incOk, src: 'jm' });
      } else {
        sendDl({ type: 'error', message: '更新脚本退出码 ' + code, src: 'jm' });
      }
      watchMuteUntil = Date.now() + 3000;
      setTimeout(() => { try { reload(); } catch (e2) {} }, 2500);
    });
  } else {
    jmProc.stdout.on('data', (d) => send2(d));
    jmProc.stderr.on('data', (d) => send2(d));
    jmProc.on('exit', (code) => {
      jmProc = null; jmRunning = false;
      if (win && !win.isDestroyed()) win.webContents.send('jm:event', { type: 'done', code: code });
      setTimeout(() => { try { reload(); } catch (e2) {} }, 2500);
    });
  }
  return { ok: true, msg: '已开始更新: ' + book };
});
ipcMain.handle('jm:cancel', () => { if (!jmProc) return false; try { jmProc.kill(); } catch (e) {} return true; });
ipcMain.handle('jm:busy', () => !!jmProc);

/* 每本书目录的修改时间, 供书架"按时间排序"用 */
ipcMain.handle('lib:bookTimes', () => {
  const out = {};
  const scan = (base, prefix) => {
    try {
      for (const e of fs.readdirSync(base, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name.charAt(0) === '_' || e.name.charAt(0) === '.') continue;
        try { out[prefix + e.name] = fs.statSync(path.join(base, e.name)).mtimeMs; } catch (x) {}
      }
    } catch (e) {}
  };
  scan(path.join(LIB, '漫画'), '漫画/');
  scan(LIB, '');
  return { times: out };
});

/* 删除一本书: 磁盘文件夹 + library.json 条目 + 阅读进度 */
ipcMain.handle('lib:delete', async (e, dir) => {
  try {
    if (!dir || typeof dir !== 'string') return { ok: false, msg: '无效的目录参数' };
    const root = path.resolve(LIB);
    const target = path.resolve(root, dir);
    if (target === root || !target.startsWith(root + path.sep)) return { ok: false, msg: '拒绝删除书库以外的路径' };
    if (!fs.existsSync(target)) return { ok: false, msg: '目录不存在（可能已被删除）' };
    const st = fs.statSync(target);
    if (st.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.rmSync(target, { force: true });
    const lib = readJSON(libJson(), defaultLibrary());
    if (lib.comics && lib.comics[dir]) { delete lib.comics[dir]; await writeJSON(libJson(), lib); }
    const prog = readJSON(progJson(), {});
    if (prog[dir]) { delete prog[dir]; await writeJSON(progJson(), prog); }
    return { ok: true, msg: '已删除 ' + dir };
  } catch (err) {
    return { ok: false, msg: String(err && err.message || err) };
  }
});

/* 删除一本书里的某一话(只删这一话的文件夹, 不碰整本书) */
ipcMain.handle('lib:deleteChapter', async (e, dir, chPath) => {
  try {
    if (!dir || typeof dir !== 'string' || !chPath || typeof chPath !== 'string') return { ok: false, msg: '无效的章节参数' };
    const root = path.resolve(LIB);
    const bookDir = path.resolve(root, dir);
    const target = path.resolve(bookDir, chPath);
    if (bookDir === root || !bookDir.startsWith(root + path.sep)) return { ok: false, msg: '拒绝改书库以外的路径' };
    if (target === bookDir || !target.startsWith(bookDir + path.sep)) return { ok: false, msg: '拒绝删除书目录本身' };
    if (!fs.existsSync(target)) return { ok: false, msg: '没找到这一话的文件夹' };
    fs.rmSync(target, { recursive: true, force: true });
    logLine('书库', '[删除章节] ' + dir + ' \\ ' + chPath);
    rebuildBook(dir);   // 异步增量重建该书, 校正页数/元数据(不阻塞 IPC, 期间静默监听)
    return { ok: true, rebuilt: true, msg: '已删除 ' + chPath };
  } catch (err) {
    return { ok: false, msg: String(err && err.message || err) };
  }
});

/* 删除某一张图: 删完把同一文件夹里剩下的图重新编号, 免得阅读器按序号取图错位 */
ipcMain.handle('lib:deleteImage', async (e, dir, rel) => {
  try {
    if (!dir || typeof dir !== 'string' || !rel || typeof rel !== 'string') return { ok: false, msg: '无效参数' };
    const root = path.resolve(LIB);
    const bookDir = path.resolve(root, dir);
    const target = path.resolve(bookDir, rel);
    if (bookDir === root || !bookDir.startsWith(root + path.sep)) return { ok: false, msg: '拒绝改书库以外的路径' };
    if (!target.startsWith(bookDir + path.sep)) return { ok: false, msg: '拒绝删除书目录以外的文件' };
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return { ok: false, msg: '没找到这张图' };
    if (!/\.(webp|jpg|jpeg|png|gif)$/i.test(target)) return { ok: false, msg: '只支持删图片文件' };
    const pad = Math.max(3, path.basename(target, path.extname(target)).length);
    const folder = path.dirname(target);
    fs.rmSync(target, { force: true });
    let renamed = false;
    try {
      const isImg = (f) => /^\d+\.(webp|jpg|jpeg|png|gif)$/i.test(f);
      const imgs = fs.readdirSync(folder).filter(isImg).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      imgs.forEach((f, i) => {                                  // 第一步: 全部改成临时名, 避免互相覆盖
        const want = String(i + 1).padStart(pad, '0') + path.extname(f).toLowerCase();
        if (f === want) return;
        fs.renameSync(path.join(folder, f), path.join(folder, '__tmp_' + want));
      });
      fs.readdirSync(folder).filter((f) => f.indexOf('__tmp_') === 0).forEach((f) => {   // 第二步: 临时名换成正式编号
        fs.renameSync(path.join(folder, f), path.join(folder, f.slice(6)));
        renamed = true;
      });
    } catch (e2) {}
    logLine('书库', '[删除图片] ' + dir + ' \\ ' + rel + (renamed ? '（剩余已重排编号）' : ''));
    rebuildBook(dir);   // 删除并重编号后校正页数/阅读进度(异步, 不阻塞 IPC)
    return { ok: true, renamed: renamed, rebuilt: true };
  } catch (err) {
    return { ok: false, msg: String(err && err.message || err) };
  }
});

/* 重命名一本书: 改磁盘目录 + 迁移 library.json 条目 + 迁移 .progress.json 进度 + 增量重建 */
ipcMain.handle('lib:renameBook', async (e, oldDir, newName) => {
  try {
    if (!oldDir || typeof oldDir !== 'string' || !newName || typeof newName !== 'string') return { ok: false, msg: '参数无效' };
    const root = path.resolve(LIB);
    const from = path.resolve(root, oldDir);
    const cleanName = String(newName).replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);
    if (!cleanName) return { ok: false, msg: '书名无效' };
    const newDir = '漫画/' + cleanName;
    const to = path.resolve(root, newDir);
    if (from === root || !from.startsWith(root + path.sep)) return { ok: false, msg: '拒绝操作书库以外的路径' };
    if (!fs.existsSync(from)) return { ok: false, msg: '原目录不存在（可能已被删除）' };
    if (fs.existsSync(to)) return { ok: false, msg: '目标书名「' + cleanName + '」已存在' };
    fs.renameSync(from, to);
    // library.json: oldDir 条目迁移到 newDir
    const lib = readJSON(libJson(), defaultLibrary());
    if (lib.comics && lib.comics[oldDir]) {
      const ent = lib.comics[oldDir];
      delete lib.comics[oldDir];
      lib.comics[newDir] = ent;
      await writeJSON(libJson(), lib);   // 原子写
    }
    // .progress.json: 旧进度迁移到新 key(收藏/备注在 library.json 里, 随条目一起迁)
    const prog = readJSON(progJson(), {});
    if (prog[oldDir]) { prog[newDir] = prog[oldDir]; delete prog[oldDir]; await writeJSON(progJson(), prog); }
    logLine('书库', '[重命名] ' + oldDir + ' -> ' + newDir);
    rebuildBook(newDir);   // 异步增量重建
    return { ok: true, rebuilt: true, newDir: newDir };
  } catch (err) {
    return { ok: false, msg: String(err && err.message || err) };
  }
});

/* 把一本书里各话的图片合并到一个文件夹(调用 _scripts/merge-book.mjs) */
ipcMain.handle('lib:mergeBook', async (e, dir) => {
  if (!dir || typeof dir !== 'string') return { ok: false, msg: '无效的书目录' };
  const script = path.join(LIB, '_scripts', 'merge-book.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 _scripts\\merge-book.mjs' };
  const { execFile } = require('node:child_process');
  watchMuteUntil = Date.now() + 60000;      // 合并过程会动文件, 别让监听把窗口刷掉
  return await new Promise((res) => {
    execFile(process.execPath, [script, '--dir', dir], { cwd: LIB, timeout: 300000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim().split('\n').pop() || '';
      if (err) res({ ok: false, msg: String(stderr || err.message).slice(0, 300) });
      else { logLine('书库', '[合并] ' + dir + ' → ' + out); res({ ok: true, msg: out, images: 0, out: dir + '/全部' }); }
    });
  });
});

/* 跨站搜索: 调 _scripts/sites/search.mjs, 它是纯 HTTP, 不需要浏览器 */
ipcMain.handle('site:search', async (e, keyword, sites) => {
  const kw = String(keyword || '').trim();
  if (!kw) return { ok: false, msg: '关键词不能为空' };
  const script = path.join(LIB, '_scripts', 'sites', 'search.mjs');
  if (!fs.existsSync(script)) return { ok: false, msg: '找不到 _scripts\\sites\\search.mjs' };
  const { spawn } = require('node:child_process');
  const args = [script, '--keyword', kw, '--lib', LIB];
  if (sites && String(sites).trim()) args.push('--sites', String(sites));
  const out = await new Promise((res) => {
    const p2 = spawn(NODE_BIN, args, { cwd: LIB, env: { ...process.env } });
    let buf = '';
    p2.stdout.on('data', (d) => { buf += d; });
    p2.stderr.on('data', (d) => { buf += d; });
    p2.on('error', (err) => res('SPAWN-ERR ' + String(err && err.message || err)));
    p2.on('exit', () => res(buf));
    setTimeout(() => { try { p2.kill(); } catch (e2) {} }, 60000);
  });
  const line = String(out).split('\n').filter((l) => l.indexOf('@@RESULT@@') >= 0).pop();
  if (!line) return { ok: false, msg: '搜索失败: ' + String(out).trim().split('\n').slice(-2).join(' ') };
  try { return JSON.parse(line.replace('@@RESULT@@', '').trim()); } catch (e) { return { ok: false, msg: '搜索结果解析失败' }; }
});

ipcMain.handle('meta:fetch', async (e, url) => {
  // 和「通用链接」下载走同一条适配器链路, 不再只认 xmanhua
  try {
    const j = await probeSite(url);
    if (!j.ok) return j;
    return { ok: true, site: j.site, title: j.title, rawTitle: j.rawTitle, author: j.author, desc: j.desc, cover: j.cover, url: j.url };
  } catch (err) {
    return { ok: false, msg: String(err && err.message || err) };
  }
});

/* ============ 下载前预览: 缩略图代理(带 Referer/Cookie) + 磁盘缓存 ============ */
const THUMB_DIR = () => path.join(LIB, '_thumbs', 'preview');
const thumbMem = new Map();        // url -> { data, ext }  内存缓存(有上限, 防爆内存)
const THUMB_MEM_MAX = 300;
const THUMB_INFLIGHT = new Map();  // url -> Promise  同一张图并发只拉一次
function thumbKey(url) { return require('node:crypto').createHash('sha1').update(String(url)).digest('hex').slice(0, 24); }
async function fetchImage(url, referer, cookie, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 20000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        'Referer': referer || 'https://nhentai.net/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    if (!r.ok) return { ok: false, msg: 'HTTP ' + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 60) return { ok: false, msg: '响应太小(' + buf.length + ')不是图片' };
    return { ok: true, buf: buf, ct: r.headers.get('content-type') || '' };
  } catch (err) {
    return { ok: false, msg: String(err && err.message || err).slice(0, 120) };
  } finally { clearTimeout(timer); }
}
function thumbExt(url, ct) {
  const m = String(url).split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (/png/i.test(ct)) return 'png';
  if (/gif/i.test(ct)) return 'gif';
  if (/webp/i.test(ct)) return 'webp';
  return 'jpg';
}
// 缩略图 worker: 有些站(i1/t.nhentai.net 之类)要经代理才连得上, 而 NODE_USE_ENV_PROXY 只能在进程启动时生效,
// 所以单独起一个带代理环境的常驻子进程去拉图, 主进程只负责读缓存文件 + 发 data URL。
let thumbChild = null, thumbSeq = 0;
const thumbWait = new Map();
function thumbWorker() {
  if (thumbChild && !thumbChild.killed) return thumbChild;
  const script = path.join(LIB, '_scripts', 'sites', 'thumbs.mjs');
  if (!fs.existsSync(script)) return null;
  const { spawn } = require('node:child_process');
  const c = spawn(NODE_BIN, [script], { cwd: LIB, env: { ...process.env } });
  let buf = '';
  c.stdout.on('data', (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let j = null;
      try { j = JSON.parse(line); } catch (e2) { continue; }
      if (j.ready) continue;
      const w = thumbWait.get(j.id);
      if (w) { thumbWait.delete(j.id); w(j); }
    }
  });
  c.stderr.on('data', (d) => console.log('[thumb-worker] ' + String(d).slice(0, 200)));
  c.on('exit', (code) => {
    thumbChild = null;
    for (const w of thumbWait.values()) w({ ok: false, msg: '缩略图 worker 退出(' + code + ')', noWorker: true });
    thumbWait.clear();
  });
  thumbChild = c;
  return c;
}
function thumbViaWorker(url, referer) {
  return new Promise((res) => {
    const c = thumbWorker();
    if (!c) return res({ ok: false, msg: '找不到 _scripts\sites\thumbs.mjs', noWorker: true });
    const id = ++thumbSeq;
    const timer = setTimeout(() => { thumbWait.delete(id); res({ ok: false, msg: '缩略图请求超时', noWorker: true }); }, 45000);
    thumbWait.set(id, (j) => { clearTimeout(timer); res(j); });
    try { c.stdin.write(JSON.stringify({ id: id, url: url, referer: referer || '' }) + '\n'); }
    catch (e2) { clearTimeout(timer); thumbWait.delete(id); res({ ok: false, msg: String(e2 && e2.message || e2), noWorker: true }); }
  });
}
// 前端不需要读本地文件: 直接把图当 data URL 给渲染层(file:// 也能显示, 不受防盗链限制)
// EH 的画廊页把 5 张缩略图横拼成一张 sprite: 按 sx/sy 裁出这一格再发
// 注意: Electron 的 nativeImage 解不了 WebP(sprite 就是 webp), 所以用 sharp(DSH 自带依赖, 零新增)
const { createRequire } = require('node:module');
const appRequire = createRequire(__filename);
let sharpMod = null, sharpTried = false;
function loadSharp() {
  if (sharpTried) return sharpMod;
  sharpTried = true;
  try { sharpMod = appRequire('sharp'); } catch (e) { logLine('下载', '[缩略图] sharp 加载失败: ' + String(e && e.message || e)); sharpMod = null; }
  return sharpMod;
}
// ---- 缩略图提速: sprite 只下一次、只解一次 ----
// ① 整张 sprite 的字节缓存(内存 LRU + 磁盘), 避免 20 页各下一遍 270KB;
// ② 正在看的那张 sprite 额外缓存"解码后的像素", 之后每页只做内存切片(~5ms), 不再重复解码(~30ms);
// ③ 输出用 WebP: 单张 117KB -> 12KB, 过 IPC 的 base64 也从 155KB 降到 16KB。
const SPRITE_MEM_MAX = 12;
const spriteMem = new Map();
let spriteRaw = null;   // { url, data, w, h, ch } 单条, 只服务当前正在看的那张
function spriteRemember(url, buf) {
  spriteMem.set(url, buf);
  while (spriteMem.size > SPRITE_MEM_MAX) spriteMem.delete(spriteMem.keys().next().value);
}
async function getSpriteBuf(url, referer) {
  const m = spriteMem.get(url);
  if (m) { spriteMem.delete(url); spriteMem.set(url, m); return { ok: true, buf: m, from: "mem" }; }
  const dir = THUMB_DIR();
  const key = thumbKey(url);
  try {
    const hit = fs.readdirSync(dir).filter((x) => x.indexOf(key) === 0);
    if (hit.length) {
      const buf = fs.readFileSync(path.join(dir, hit[0]));
      if (buf && buf.length > 60) { noteTouched(path.join(dir, hit[0])); spriteRemember(url, buf); return { ok: true, buf: buf, from: "disk" }; }
    }
  } catch (e) {}
  // 先交给带代理的 worker(这台机器上直连这些图床连不出去, 直连会白等十几秒), 直连只当兜底
  const w = await thumbViaWorker(url, referer);
  if (w.ok) {
    try {
      const b2 = fs.readFileSync(path.join(dir, w.key + "." + w.ext));
      if (b2 && b2.length > 60) { spriteRemember(url, b2); return { ok: true, buf: b2, from: "worker" }; }
    } catch (e2) {}
  }
  if (!w.noWorker) return { ok: false, msg: w.msg || "取图失败" };   // worker 已明确回答(404/网络错), 别再直连白等
  const r = await fetchImage(url, referer, "", 6000);
  if (!r.ok) return { ok: false, msg: r.msg };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dst = path.join(dir, key + "." + thumbExt(url, r.ct));
    fs.writeFileSync(dst + ".part", r.buf);
    fs.renameSync(dst + ".part", dst);
  } catch (e) {}
  spriteRemember(url, r.buf);
  return { ok: true, buf: r.buf, from: "net" };
}
async function cropSprite(url, referer, sx, sy, tw, th) {
  const sharp = loadSharp();
  if (!sharp) return { ok: false, msg: "没有可用的图片库(sharp)" };
  const got = await getSpriteBuf(url, referer);
  if (!got.ok) return { ok: false, msg: got.msg };
  const buf = got.buf;
  try {
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    const left = Math.max(0, Math.abs(sx || 0)), top = Math.max(0, Math.abs(sy || 0));
    const w = Math.min(tw || 200, W - left), h = Math.min(th || 300, H - top);
    if (W <= 0 || H <= 0) return { ok: false, msg: "sprite 不是有效图片(webp 解不开?)" };
    if (w <= 0 || h <= 0) return { ok: false, msg: "裁切范围超出 sprite (" + W + "x" + H + " @" + left + "," + top + ")" };
    let out = null;
    // 走"解码一次 + 内存切片"的快路
    if (!spriteRaw || spriteRaw.url !== url) {
      const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      spriteRaw = { url: url, data: raw.data, w: raw.info.width, h: raw.info.height, ch: raw.info.channels };
    }
    if (spriteRaw && spriteRaw.url === url && left + w <= spriteRaw.w && top + h <= spriteRaw.h) {
      const R = spriteRaw, ch = R.ch;
      const cut = Buffer.alloc(w * h * ch);
      for (let y = 0; y < h; y++) {
        const sOff = ((top + y) * R.w + left) * ch;
        R.data.copy(cut, y * w * ch, sOff, sOff + w * ch);
      }
      out = await sharp(cut, { raw: { width: w, height: h, channels: ch } }).webp({ quality: 78, effort: 0 }).toBuffer();
    } else {
      out = await sharp(buf).extract({ left: left, top: top, width: w, height: h }).webp({ quality: 78, effort: 0 }).toBuffer();
    }
    if (!out || out.length < 50) return { ok: false, msg: "裁切结果异常" };
    const data = "data:image/webp;base64," + out.toString("base64");
    thumbMem.set(url + "#" + left + "," + top + "#" + w + "x" + h, { data: data, ext: "webp" });
    if (thumbMem.size > THUMB_MEM_MAX) thumbMem.delete(thumbMem.keys().next().value);
    return { ok: true, data: data, ext: "webp", bytes: out.length, from: got.from };
  } catch (e) {
    return { ok: false, msg: "裁图失败: " + String(e && e.message || e).slice(0, 100) };
  }
}

/* ============ 预览缩略图的清理(用户要求: 下载完 / 没选上的, 缓存要清掉) ============ */
// 三级:
//  ① 预览会话结束(关弹窗/取消/开始下载) → 删掉本次会话用到的那些图
//  ② 启动时兜底: 删 2 天前的 + 总量超过 150MB 时从最旧的删起(防崩溃/断电留下的残留)
//  ③ 书架的封面缩略图(_thumbs 根)不动 —— 那是长期资产, 只有 _thumbs/preview 是临时预览
const previewTouched = new Set();
const previewPages = new Set();      // 页缩略图/sprite: 只服务"挑页", 预览结束就删
const previewCovers = new Set();     // 作品封面: 留着(以后浏览/核对还要用)
const fileOwner = new Map();         // 文件 → 属于哪个作品(用于"已下载的保留")
const keptWorks = new Set();         // 本轮已选择下载的作品
let curKind = 'page', curOwner = '';  // dl:thumb 每次请求前设置
function noteTouched(p) {
  try {
    if (!p) return;
    if (curKind === 'cover') previewCovers.add(p); else previewPages.add(p);
    if (curOwner) fileOwner.set(p, String(curOwner));
  } catch (e) {}
}
function clearPreviewCache(reason) {
  // 规则(用户定的): 封面留着; 页缩略图只服务"挑页" → 预览结束就删,
  // 但"已经选去下载/进库"的那些作品留着(以后还要看它的缩略图)。
  let n = 0, bytes = 0, kept = 0;
  for (const p of previewPages) {
    const owner = fileOwner.get(p) || "";
    if (owner && keptWorks.has(owner)) { kept++; continue; }
    try { const st = fs.statSync(p); bytes += st.size; fs.rmSync(p, { force: true }); n++; } catch (e) {}
  }
  previewPages.clear();
  previewCovers.clear();
  fileOwner.clear();
  keptWorks.clear();
  if (n) logLine("下载", "[缓存] " + (reason || "预览结束") + ": 清掉预览用页缩略图 " + n + " 个 / " + (Math.round(bytes / 1048576 * 10) / 10) + " MB" + (kept ? ("（保留已选作品 " + kept + " 个）") : ""));
  return { ok: true, deleted: n, bytes: bytes, kept: kept };
}
function sweepPreviewCache() {
  const dir = THUMB_DIR();
  const MAX_BYTES = 150 * 1048576, MAX_AGE = 2 * 86400000;
  let all = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { const s = fs.statSync(p); if (s.isFile()) all.push({ p: p, m: s.mtimeMs, s: s.size }); } catch (e) {}
    }
  } catch (e) { return; }
  const now = Date.now();
  const del = all.filter((x) => (now - x.m) > MAX_AGE);
  const rest = all.filter((x) => (now - x.m) <= MAX_AGE).sort((a, b) => a.m - b.m);
  let total = rest.reduce((s, x) => s + x.s, 0);
  while (total > MAX_BYTES && rest.length) { const x = rest.shift(); del.push(x); total -= x.s; }
  let n = 0, bytes = 0;
  for (const x of del) { try { bytes += x.s; fs.rmSync(x.p, { force: true }); n++; } catch (e) {} }
  if (n) logLine('下载', '[缓存] 启动清理预览缩略图 ' + n + ' 个 / ' + (Math.round(bytes / 1048576 * 10) / 10) + ' MB (剩余 ' + rest.length + ' 个)');
  return { ok: true, deleted: n, bytes: bytes, left: rest.length };
}

ipcMain.handle('dl:thumb', async (e, req) => {
  const o = (typeof req === 'string') ? { url: req } : (req || {});
  const url = String(o.url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, msg: '不是 http(s) 地址' };
  // 防盗链站(ehgt.org / i.pximg.net …)只认同源 Referer: 优先用页面 URL 的同源, 没有就按图床域名推
  if (o.pageUrl) { try { o.referer = new URL(String(o.pageUrl)).origin + '/'; } catch (e0) {} }
  if (!o.referer) {
    const host = (() => { try { return new URL(url).host; } catch (e0) { return ''; } })();
    if (/(^|\.)ehgt\.org$|\.e-hentai\.org$|\.exhentai\.org$/.test(host)) o.referer = 'https://e-hentai.org/';
    else if (/(^|\.)pximg\.net$/.test(host)) o.referer = 'https://www.pixiv.net/';
    else if (/(^|\.)nhentai\.net$/.test(host)) o.referer = 'https://nhentai.net/';
  }
  // 缓存键必须带裁切参数: 否则整张 sprite 的缓存会把裁切分支短路(踩过一次)
  const cropKey = (typeof o.cl === 'number') ? ('#' + o.cl + ',' + (o.ct || 0) + '#' + (o.cw || 0) + 'x' + (o.ch || 0)) : '';
  curKind = o.kind || 'page'; curOwner = o.w || '';   // 这一张是封面还是页图 / 属于哪个作品
  // 不管这次是从内存/磁盘/worker 哪一层拿到的, 都把对应的磁盘文件登记成"本次预览用到的"
  // (否则热进程里全命中内存缓存, 关弹窗时就无文件可清)
  try {
    const k0 = thumbKey(url);
    const dir0 = THUMB_DIR();
    const hit0 = fs.readdirSync(dir0).filter((x) => x.indexOf(k0) === 0);
    if (hit0.length) noteTouched(path.join(dir0, hit0[0]));
  } catch (e0) {}
  const memKey = url + cropKey;
  const mem = thumbMem.get(memKey);
  if (mem) { thumbMem.delete(memKey); thumbMem.set(memKey, mem); return { ok: true, data: mem.data, ext: mem.ext, cached: true }; }
  // sprite: EH 把整条缩略图横拼成一张大图, 必须按裁切矩形真裁出一格再发(前端拿整张会串页)
  if (typeof o.cl === "number") {
    const ck = "#" + o.cl + "," + (o.ct || 0) + "#" + (o.cw || 285) + "x" + (o.ch || 300);
    const cm = thumbMem.get(url + ck);
    if (cm) { thumbMem.delete(url + ck); thumbMem.set(url + ck, cm); return { ok: true, data: cm.data, ext: cm.ext, cached: true }; }
    const cr = await cropSprite(url, o.referer, o.cl, o.ct || 0, o.cw || 285, o.ch || 300);
    if (cr.ok) return cr;
    return { ok: false, msg: "裁图失败: " + (cr.msg || "未知") };
  }

  const prev = THUMB_INFLIGHT.get(url);
  if (prev) return await prev;
  const job = (async () => {
    const key = thumbKey(url);
    const dir = THUMB_DIR();
    let ext = '';
    let buf = null;
    try {
      const hit = fs.readdirSync(dir).filter((f) => f.indexOf(key) === 0);
      if (hit.length) { ext = hit[0].split('.').pop() || 'jpg'; buf = fs.readFileSync(path.join(dir, hit[0])); noteTouched(path.join(dir, hit[0])); }
    } catch (e2) {}
    if (!buf) {
      // 先走带代理的 worker(直连这些图床连不出去, 会白等十几秒), 失败再直连兜底
      const w = await thumbViaWorker(url, o.referer);
      if (w.ok) {
        try { buf = fs.readFileSync(path.join(dir, w.key + '.' + w.ext)); ext = w.ext; noteTouched(path.join(dir, w.key + '.' + w.ext)); } catch (e2) { return { ok: false, msg: 'worker 拉到了但读不到缓存文件' }; }
      } else {
        if (!w.noWorker) return { ok: false, msg: w.msg || "取图失败" };
        const r = await fetchImage(url, o.referer, o.cookie, 6000);
        if (!r.ok) return { ok: false, msg: r.msg };
        buf = r.buf;
        ext = thumbExt(url, r.ct);
        try {
          fs.mkdirSync(dir, { recursive: true });
          const dst = path.join(dir, key + '.' + ext);
          fs.writeFileSync(dst + '.part', buf);
          fs.renameSync(dst + '.part', dst);
        } catch (e3) { console.log('[thumb] 缓存写入失败(不影响显示): ' + String(e3 && e3.message || e3)); }
      }
    }
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const data = 'data:' + mime + ';base64,' + buf.toString('base64');
    thumbMem.set(url, { data: data, ext: ext });
    if (thumbMem.size > THUMB_MEM_MAX) thumbMem.delete(thumbMem.keys().next().value);
    return { ok: true, data: data, ext: ext, bytes: buf.length };
  })();
  THUMB_INFLIGHT.set(url, job);
  try { return await job; } finally { THUMB_INFLIGHT.delete(url); }
});

ipcMain.handle('shell:openExternal', (e, url) => {
  const u = String(url || '');
  if (/^https?:\/\//i.test(u)) { shell.openExternal(u); return true; }
  return false;
});

ipcMain.handle('shell:open', (e, p) => shell.openPath(p));
ipcMain.handle('shell:reveal', (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('app:versions', () => ({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }));

/* ============ 局域网 Web 服务器(手机看) ============ */
const webServer = require('./web-server.js');
ipcMain.handle('web:start', async (e, password) => {
  try {
    const cfg = readCfg();
    cfg.webPassword = password || '';
    writeCfg(cfg);
    webServer.startServer(LIB);
    return { ok: true, ip: webServer.getIP(), port: 9527 };
  } catch (err) { return { ok: false, msg: String(err.message || err) }; }
});
ipcMain.handle('web:stop', () => { webServer.stopServer(); return { ok: true }; });
ipcMain.handle('web:status', () => {
  const cfg = readCfg();
  return { running: !!webServer.server, ip: webServer.getIP(), port: 9527, password: cfg.webPassword || '' };
});
