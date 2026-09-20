// verify-packaged.mjs —— 打包产物验收
//
// 打包版和开发版最大的不同: 书库根目录是**用户选的**(不再是项目目录),
// 界面源码 src/ 要在首次启动时被拷过去, 数据从那个目录读。
// 这条路径一点错就是"装完打开白屏", 所以必须真跑一次。
//
//   node _scripts\jm\verify-packaged.mjs
// 退出码 0 = 全过

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, sleep } from './cdp.mjs';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const EXE = path.join(LIB, '_dist', 'win-unpacked', '漫画书库重构v0.exe');
const PORT = 9860;
const CFG_DIR = path.join(process.env.APPDATA, 'manga-library-v0');
const CFG = path.join(CFG_DIR, 'config.json');
const TESTLIB = path.join(os.tmpdir(), 'manga-lib-v0-pkgtest');
const LOG = path.join(LIB, '_pkg-boot.log');

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };

let cfgBackup = null, child = null;
const stop = () => { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} };
const restoreCfg = () => {
  try {
    if (cfgBackup === null) { try { fs.unlinkSync(CFG); } catch (e) {} }
    else fs.writeFileSync(CFG, cfgBackup, 'utf8');
  } catch (e) {}
};

try {
  chk('打包产物存在', fs.existsSync(EXE), EXE);
  if (!fs.existsSync(EXE)) throw new Error('先跑打包: cd _app; .\\node_modules\\.bin\\electron-builder --win');

  // 备份配置(打包版和开发版共用 userData, 测完必须还原)
  try { cfgBackup = fs.readFileSync(CFG, 'utf8'); } catch (e) { cfgBackup = null; }

  // 造一个"用户选的书库目录", 手动做首次启动会做的那几件事
  fs.rmSync(TESTLIB, { recursive: true, force: true });
  fs.mkdirSync(TESTLIB, { recursive: true });
  const RES = path.join(LIB, '_dist', 'win-unpacked', 'resources');
  chk('产物里有 src/', fs.existsSync(path.join(RES, 'src', 'index.html')));
  fs.cpSync(path.join(RES, 'src'), path.join(TESTLIB, 'src'), { recursive: true });
  fs.cpSync(path.join(RES, '_scripts'), path.join(TESTLIB, '_scripts'), { recursive: true });
  for (const f of ['library.json', '角色作品表.json', '外部目录.json']) {
    try { fs.copyFileSync(path.join(RES, f), path.join(TESTLIB, f)); } catch (e) {}
  }
  fs.mkdirSync(path.join(TESTLIB, '漫画'), { recursive: true });
  fs.writeFileSync(path.join(TESTLIB, '_manifest.json'), JSON.stringify({ count: 0, comics: [] }), 'utf8');
  chk('测试书库目录已就位', fs.existsSync(path.join(TESTLIB, 'src', 'main.js')));

  // 让打包版直接用这个目录(跳过首次启动的选目录弹窗)
  fs.mkdirSync(CFG_DIR, { recursive: true });
  const cfg = cfgBackup ? JSON.parse(cfgBackup) : {};
  cfg.libraryRoot = TESTLIB;
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8');

  try { fs.unlinkSync(LOG); } catch (e) {}
  const fd = fs.openSync(LOG, 'a');
  child = spawn(EXE, ['--remote-debugging-port=' + PORT], { detached: true, stdio: ['ignore', fd, fd] });
  child.unref();

  let page = null;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      page = l.find((x) => x.type === 'page');
      if (page) break;
    } catch (e) {}
  }
  chk('打包版起了窗口', !!page);
  if (page) {
    const u = decodeURIComponent(page.url || '');
    chk('从"用户选的书库目录"加载界面', u.indexOf(TESTLIB.replace(/\\/g, '/')) >= 0 || u.indexOf(TESTLIB) >= 0, u.slice(0, 120));
    const p = await openPage(PORT, page.id);
    let booted = false;
    for (let i = 0; i < 50; i++) { await sleep(400); try { if (await p.ev('!!window.mlBooted', 2)) { booted = true; break; } } catch (e) {} }
    chk('界面核心启动成功', booted);
    const st = String(await p.ev('JSON.stringify({title: document.title, hasGrid: !!document.getElementById("grid"), hasTitlebar: !!document.getElementById("titlebar")})', 2));
    console.log('     ' + st);
    const o = JSON.parse(st);
    chk('标题栏/书架都在', !!o.hasGrid && !!o.hasTitlebar);
    const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
    chk('零未捕获异常', exs.length === 0, exs.length ? String(exs.length) : '');
    try { p.close(); } catch (e) {}
  } else {
    console.log('     日志尾部: ' + fs.readFileSync(LOG, 'utf8').slice(-400));
  }
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  stop();
  restoreCfg();
  try { fs.rmSync(TESTLIB, { recursive: true, force: true }); } catch (e) {}
  console.log('  (配置已还原, 测试书库已清掉)');
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
