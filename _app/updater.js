'use strict';
// 联网更新: 查 GitHub Releases 最新版, 下载安装包, 交给安装程序
//
// 设计取舍:
//   · 不用 electron-updater: 它要求 build.publish 配置 + 每个包都带 latest.yml,
//     而且便携版(portable)根本不支持自动更新; 这里自己查 API 更简单可控, 两种包都能提示。
//   · 网络走 Electron 的 net.fetch -> 自动带上系统代理(用户开了 Clash 也能用)。
//   · 只下载不静默安装: 下载完交给安装程序(用户点两下), 避免被杀软当成静默升级。

const { app, net, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// 直连兜底: 有些机器上 Electron 的 net.fetch 会走系统代理(如 Clash), 代理对 api.github.com 回 403;
// curl 直连却是通的。所以先 net.fetch, 不成就用 Node 的 https 直连再试一次。
const https = require('node:https');

function httpsGetJSON(url, redirects) {
  const n = redirects === undefined ? 3 : redirects;
  return new Promise(function (resolve, reject) {
    const req = https.get(url, { headers: { 'User-Agent': 'shuku-updater', 'Accept': 'application/vnd.github+json' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n > 0) {
        res.resume();
        return resolve(httpsGetJSON(res.headers.location, n - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(new Error('timeout')); });
  });
}


const OWNER = '1960125129h-ctrl';
const REPO = 'manga-library';
const API_LATEST = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/latest';
const PAGE_RELEASES = 'https://github.com/' + OWNER + '/' + REPO + '/releases';

function vnum(v) {
  return String(v || '').replace(/^v/i, '').split(/[.+-]/).map(function (x) { return parseInt(x, 10) || 0; });
}
// 返回 >0 表示 a 比 b 新
function cmpVer(a, b) {
  const A = vnum(a), B = vnum(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 便携版: electron-builder 会注入 PORTABLE_EXECUTABLE_DIR
function isPortable() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

async function fetchLatest() {
  const r0 = await fetchLatestVia('net');
  if (r0.ok) return r0;
  const r1 = await fetchLatestVia('node');
  if (r1.ok) return r1;
  return { ok: false, msg: r0.msg + ' / 直连: ' + r1.msg };
}

async function fetchLatestVia(via) {
  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, 15000);
  try {
    let j;
    if (via === 'node') {
      j = await httpsGetJSON(API_LATEST);
    } else {
      const r = await net.fetch(API_LATEST, {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'shuku-updater' },
        signal: ac.signal
      });
      if (!r.ok) return { ok: false, msg: 'HTTP ' + r.status };
      j = await r.json();
    }
    const assets = Array.isArray(j.assets) ? j.assets : [];
    const pick = function (suffix) {
      const hit = assets.filter(function (a) { return new RegExp(suffix + '$', 'i').test(a.name); })[0];
      return hit ? { name: hit.name, url: hit.browser_download_url, size: hit.size } : null;
    };
    return {
      ok: true,
      tag: String(j.tag_name || ''),
      version: String(j.tag_name || '').replace(/^v/i, ''),
      name: j.name || j.tag_name || '',
      notes: String(j.body || ''),
      page: j.html_url || PAGE_RELEASES,
      setup: pick('setup\\.exe'),
      portable: pick('portable\\.exe')
    };
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function check() {
  const cur = app.getVersion();
  const info = await fetchLatest();
  if (!info.ok) return { ok: false, current: cur, msg: info.msg };
  const newer = cmpVer(info.version, cur) > 0;
  return { ok: true, current: cur, latest: info.version, hasUpdate: newer, page: info.page, notes: info.notes, setup: info.setup, portable: info.portable };
}

function progressWin() {
  return require('electron').BrowserWindow.getAllWindows().filter(function (w) { return w && !w.isDestroyed(); })[0] || null;
}


// 直连下载兜底(net.fetch 走代理失败时用)
function httpsDownload(url, dst, onProgress, redirects) {
  const n = redirects === undefined ? 4 : redirects;
  return new Promise(function (resolve) {
    const req = https.get(url, { headers: { 'User-Agent': 'shuku-updater' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n > 0) {
        res.resume();
        return resolve(httpsDownload(res.headers.location, dst, onProgress, n - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, msg: 'HTTP ' + res.statusCode }); }
      const total = Number(res.headers['content-length']) || 0;
      const ws = fs.createWriteStream(dst);
      let got = 0, last = 0;
      res.on('data', function (chunk) {
        got += chunk.length;
        ws.write(chunk);
        const now = Date.now();
        if (onProgress && now - last > 200) { last = now; onProgress(got, total); }
      });
      res.on('end', function () {
        ws.end(function () {
          if (onProgress) onProgress(got, total || got);
          if (total && got !== total) return resolve({ ok: false, msg: '大小不符(' + got + '/' + total + ')' });
          resolve({ ok: true, path: dst });
        });
      });
      res.on('error', function (e) { try { ws.close(); } catch (e2) {} resolve({ ok: false, msg: String(e && e.message || e) }); });
    });
    req.on('error', function (e) { resolve({ ok: false, msg: '下载失败: ' + String(e && e.message || e) }); });
    req.setTimeout(60000, function () { req.destroy(new Error('timeout')); });
  });
}

// 下载到临时目录, 边下边回报进度
async function download(asset, onProgress) {
  if (!asset || !asset.url) return { ok: false, msg: '没有可下载的安装包' };
  const dir = path.join(app.getPath('temp'), 'shuku-update');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const dst = path.join(dir, asset.name);
  try { if (fs.existsSync(dst) && fs.statSync(dst).size === asset.size) return { ok: true, path: dst, cached: true }; } catch (e) {}

  const r = await net.fetch(asset.url, { headers: { 'User-Agent': 'shuku-updater' } }).catch(function () { return null; });
  if (!r || !r.ok || !r.body) return await httpsDownload(asset.url, dst, onProgress);
  const total = Number(r.headers.get('content-length')) || asset.size || 0;
  const ws = fs.createWriteStream(dst);
  let got = 0, last = 0;
  const reader = r.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      ws.write(Buffer.from(value));
      const now = Date.now();
      if (onProgress && now - last > 200) { last = now; onProgress(got, total); }
    }
  } catch (e) {
    try { ws.close(); } catch (e2) {}
    return { ok: false, msg: '下载中断: ' + String((e && e.message) || e) };
  }
  await new Promise(function (res) { ws.end(res); });
  if (total && got !== total) return { ok: false, msg: '大小不符(' + got + '/' + total + ')' };
  if (onProgress) onProgress(got, total || got);
  return { ok: true, path: dst };
}

// 启动安装程序并退出自己; 便携版没法自更新, 直接打开发布页
function runInstaller(file) {
  if (isPortable()) { try { shell.openExternal(PAGE_RELEASES); } catch (e) {} return { ok: true, portable: true }; }
  try {
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(function () { app.quit(); }, 800);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e) };
  }
}

// 启动后静默检查一次: 有新版本就弹窗(可稍后)
async function promptIfUpdate(win) {
  const r = await check();
  if (!r.ok || !r.hasUpdate) return r;
  const btn = isPortable() ? ['前往下载', '稍后'] : ['下载并安装', '稍后'];
  const { response } = await dialog.showMessageBox(win || undefined, {
    type: 'info',
    buttons: btn,
    defaultId: 0,
    cancelId: 1,
    title: '发现新版本',
    message: '书库 ' + r.latest + '（当前 ' + r.current + '）',
    detail: String(r.notes || '').split('\n').slice(0, 12).join('\n') || '有新版本可用。'
  });
  if (response !== 0) return r;
  if (isPortable()) { try { shell.openExternal(r.page); } catch (e) {} return r; }
  const asset = r.setup;
  if (!asset) { try { shell.openExternal(r.page); } catch (e) {} return r; }
  const w = win || progressWin();
  const dl = await download(asset, function (got, total) {
    try { if (w && !w.isDestroyed()) w.setProgressBar(total ? got / total : -1); } catch (e) {}
  });
  try { if (w && !w.isDestroyed()) w.setProgressBar(-1); } catch (e) {}
  if (!dl.ok) { dialog.showErrorBox('更新失败', dl.msg); return r; }
  runInstaller(dl.path);
  return r;
}

module.exports = { check, download, install: runInstaller, promptIfUpdate, cmpVer, isPortable, PAGE_RELEASES };