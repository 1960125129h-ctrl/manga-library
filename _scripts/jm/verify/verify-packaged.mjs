// verify-packaged.mjs —— 打包产物验收
//
// 打包版和开发版最大的不同:
//   · 书库根目录是用户选的(不再是项目目录)
//   · src/ 界面、_scripts/ 脚本、icons + manifest + service-worker(手机端) 要在首次启动时从 resources 同步过去
//   · 换版本后必须重新同步, 否则出现"外壳新、界面旧", 且毫无报错
// 这三条任一条错了就是"装完白屏"或"升级后界面不变", 所以必须真跑打包产物。
//
//   node _scripts\jm\verify\verify-packaged.mjs
// 退出码 0 = 全过

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, sleep } from '../cdp.mjs';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..', '..');
const DIST = path.join(LIB, '_dist');
const EXE = path.join(DIST, 'win-unpacked', '书库.exe');
const RES = path.join(DIST, 'win-unpacked', 'resources');
const PORT = 9860;
const TESTLIB = path.join(os.tmpdir(), 'manga-lib-v0-pkgtest');
const TESTUD = path.join(os.tmpdir(), 'manga-lib-v0-testdata');   // 独立 userData: 不和正在跑的 App 抢单实例锁, 也不碰真实配置
const CFG = path.join(TESTUD, 'config.json');
const LOG = path.join(LIB, '_pkg-boot.log');

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };

let child = null;

function stop() {
  try { if (child && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
  child = null;
}


async function waitPage(tries) {
  for (let i = 0; i < (tries || 240); i++) {
    await sleep(500);
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = (l || []).find((x) => x.type === 'page');
      if (page) return page;
    } catch (e) {}
  }
  return null;
}

async function startApp() {
  try { fs.unlinkSync(LOG); } catch (e) {}
  const fd = fs.openSync(LOG, 'a');
  child = spawn(EXE, ['--remote-debugging-port=' + PORT], { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, MANGA_USERDATA: TESTUD } });
  child.unref();
  return await waitPage(240);
}

async function bootCheck(page, tag) {
  let p = null;
  let booted = false;
  try { p = await openPage(PORT, page.id); } catch (e) { chk(tag + ': 界面核心启动', false, String((e && e.message) || e)); return false; }
  for (let i = 0; i < 60; i++) { await sleep(400); try { if (await p.ev('!!window.mlBooted', 2)) { booted = true; break; } } catch (e) {} }
  chk(tag + ': 界面核心启动', booted);
  try { p.close(); } catch (e) {}
  return booted;
}

try {
  chk('打包产物存在', fs.existsSync(EXE), EXE);
  if (!fs.existsSync(EXE)) throw new Error('先跑打包: cd _app; .\\node_modules\\.bin\\electron-builder.cmd --win');

  // ---- 包里不该带的东西 ----
  const sitesDir = path.join(RES, '_scripts', 'sites');
  chk('包里没有 cookies 目录', !fs.existsSync(path.join(sitesDir, 'cookies')));
  const siteFiles = fs.existsSync(sitesDir) ? fs.readdirSync(sitesDir) : [];
  const leak = siteFiles.filter((f) => /cookie/i.test(f) && /\.(txt|json)$/i.test(f));
  chk('包里没有 cookie 文件', leak.length === 0, leak.join(','));
  chk('包里没有 pixiv 抓取缓存', !siteFiles.some((f) => /^cache-pixiv/.test(f)));
  chk('包里没有开发期调试脚本', !fs.existsSync(path.join(RES, '_scripts', 'jm', 'p013052.mjs')));
  // OCR: 打包版只走图片直取, 验证码识别组件与老方式脚本一律不进包
  chk('包里没有验证码识别组件(ocr_server.py)', !fs.existsSync(path.join(RES, '_scripts', 'jm', 'ocr_server.py')));
  chk('包里没有老方式脚本(run-album.mjs)', !fs.existsSync(path.join(RES, '_scripts', 'jm', 'run-album.mjs')));
  chk('包里没有 jm 开发文档(README)', !fs.existsSync(path.join(RES, '_scripts', 'jm', 'README.md')));
  chk('包里没有旧单文件界面(书库.html)', !fs.existsSync(path.join(RES, '书库.html')));
  chk('包里没有老方式界面模块(legacy-jm.js)', !fs.existsSync(path.join(RES, 'src', 'download', 'legacy-jm.js')));
  chk('图片直取链路仍在(jm-auto + run-albums)', fs.existsSync(path.join(RES, '_scripts', 'jm', 'jm-auto.mjs')) && fs.existsSync(path.join(RES, '_scripts', 'jm', 'run-albums.mjs')));

  // ---- 包里必须带的东西 ----
  // 私人数据与开发文档不能进包
  let libTpl = null;
  try { libTpl = JSON.parse(fs.readFileSync(path.join(RES, 'library.json'), 'utf8')); } catch (e) {}
  const libComics = (libTpl && libTpl.comics && Object.keys(libTpl.comics).length) || 0;
  chk('包里的 library.json 是空模板(不含私人书库)', !!libTpl && libComics === 0, 'comics=' + libComics);
  const mdInSrc = (function () {
    const walk = (d) => { let n = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p2 = path.join(d, e.name); if (e.isDirectory()) n = n.concat(walk(p2)); else if (/\.md$/i.test(e.name)) n.push(p2); } } catch (e) {} return n; };
    return walk(path.join(RES, 'src'));
  })();
  chk('包里 src 下没有 .md(README/改动索引)', mdInSrc.length === 0, mdInSrc.map((x) => path.basename(x)).join(','));
  chk('包里 _scripts 下没有 .md', !(function () {
    const walk = (d) => { let n = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p2 = path.join(d, e.name); if (e.isDirectory()) n = n.concat(walk(p2)); else if (/\.md$/i.test(e.name)) n.push(p2); } } catch (e) {} return n; };
    return walk(path.join(RES, '_scripts')).length;
  })());

  chk('包里带了 node.exe(下载链路要用)', fs.existsSync(path.join(RES, '_scripts', 'tools', 'node', 'node.exe')));
  chk('包里带了 sharp(缩略图/取色要用)', fs.existsSync(path.join(RES, 'app.asar.unpacked', 'node_modules', 'sharp')));
  chk('包里带了 icons(手机端)', fs.existsSync(path.join(RES, 'icons', 'icon-192.png')));
  chk('包里带了首次使用引导(src/shell/guide.js)', fs.existsSync(path.join(RES, 'src', 'shell', 'guide.js')));
  chk('包里带了 manifest.webmanifest', fs.existsSync(path.join(RES, 'manifest.webmanifest')));
  chk('包里带了 service-worker.js', fs.existsSync(path.join(RES, 'service-worker.js')));

  // ---- 造一个空书库目录: 什么都不拷, 让 App 自己同步 ----
  fs.rmSync(TESTLIB, { recursive: true, force: true });
  fs.mkdirSync(TESTLIB, { recursive: true });
  fs.rmSync(TESTUD, { recursive: true, force: true });
  fs.mkdirSync(TESTUD, { recursive: true });
  const cfg = {};
  cfg.libraryRoot = TESTLIB;
  delete cfg.resSig;   // 别让上一轮的签名把同步跳过
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8');

  // ---- 第一次启动: 应把资源全同步过去并加载界面 ----
  const page = await startApp();
  chk('打包版起了窗口', !!page);
  if (page) {
    const u = decodeURIComponent(page.url || '');
    chk('从"用户选的书库目录"加载界面', u.indexOf(TESTLIB.replace(/\\/g, '/')) >= 0 || u.indexOf(TESTLIB) >= 0, u.slice(0, 120));
    await bootCheck(page, '首启');
  } else {
    try { console.log('     日志尾部: ' + fs.readFileSync(LOG, 'utf8').slice(-400)); } catch (e) {}
  }

  chk('首启同步了 src/(界面)', fs.existsSync(path.join(TESTLIB, 'src', 'index.html')));
  chk('首启同步了 _scripts/(下载器)', fs.existsSync(path.join(TESTLIB, '_scripts', 'build-library.mjs')));
  chk('首启同步了 icons/', fs.existsSync(path.join(TESTLIB, 'icons', 'icon-192.png')));
  chk('首启同步了 manifest.webmanifest', fs.existsSync(path.join(TESTLIB, 'manifest.webmanifest')));
  chk('首启同步了 service-worker.js', fs.existsSync(path.join(TESTLIB, 'service-worker.js')));
  const stamp1 = (function () { try { return fs.readFileSync(path.join(TESTLIB, '.pkg-version'), 'utf8').trim(); } catch (e) { return ''; } })();
  chk('写了 .pkg-version(升级戳)', !!stamp1, stamp1);

  // ---- 升级语义: 界面改脏 + 戳改成旧的 -> 重启必须被覆盖回来 ----
  stop();
  await sleep(1500);
  const idx = path.join(TESTLIB, 'src', 'index.html');
  try { fs.appendFileSync(idx, '\n<!-- STALE-MARK -->\n', 'utf8'); } catch (e) {}
  try { fs.writeFileSync(path.join(TESTLIB, '.pkg-version'), 'stale', 'utf8'); } catch (e) {}
  try { const c2 = JSON.parse(fs.readFileSync(CFG, 'utf8')); delete c2.resSig; fs.writeFileSync(CFG, JSON.stringify(c2, null, 2), 'utf8'); } catch (e) {}

  const page2 = await startApp();
  chk('升级后能正常重启', !!page2);
  if (page2) await bootCheck(page2, '升级');
  let idxNow = '';
  try { idxNow = fs.readFileSync(idx, 'utf8'); } catch (e) {}
  chk('升级后界面被重新同步(不残留旧内容)', idxNow.length > 0 && idxNow.indexOf('STALE-MARK') < 0);
  const stamp2 = (function () { try { return fs.readFileSync(path.join(TESTLIB, '.pkg-version'), 'utf8').trim(); } catch (e) { return ''; } })();
  chk('升级戳已更新', !!stamp2 && stamp2 !== 'stale', stamp2);
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  stop();
  await sleep(800);
  try { fs.rmSync(TESTLIB, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(TESTUD, { recursive: true, force: true }); } catch (e) {}
  console.log('  (测试书库与测试 userData 已清掉; 真实配置没动过)');
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
