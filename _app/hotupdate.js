'use strict';
// 站点脚本热更新: 只拉 _scripts/sites/*.mjs, 不重装应用、不用重启
//
// 为什么可行: 每次下载都是 spawn 一个新的 node 进程跑 _scripts/sites/fetch-book.mjs,
// 所以覆盖文件后, 下一次下载用的就是新脚本。改个站点适配器只要几百 KB, 不必发 170MB 安装包。
//
// 安全与稳妥:
//   · 只同步 .mjs, 且只写 <书库根>/_scripts/sites/, 不碰别的目录
//   · 覆盖前把旧文件备份到 <书库根>/_scripts/sites/.hotprev/
//   · 逐字节比对, 内容一样就不写(不产生无谓改动)
//   · 只信任本仓库 master 的 raw 内容; 失败静默重试(不打扰用户)

const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const OWNER = '1960125129h-ctrl';
const REPO = 'manga-library';
const BRANCH = 'master';
const DIR = '_scripts/sites';
const LIST_API = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + DIR + '?ref=' + BRANCH;
const raw = function (name) { return 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/' + DIR + '/' + name; };

function cfgPath() { return path.join(app.getPath('userData'), 'config.json'); }
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return {}; } }
function writeCfg(c) { try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2), 'utf8'); } catch (e) {} }

function httpsGetBuf(url, redirects) {
  const n = redirects === undefined ? 3 : redirects;
  return new Promise(function (resolve, reject) {
    const req = https.get(url, { headers: { 'User-Agent': 'shuku-hot', 'Accept': '*/*' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n > 0) { res.resume(); return resolve(httpsGetBuf(res.headers.location, n - 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks)); });
    });
    req.on('error', reject);
    req.setTimeout(20000, function () { req.destroy(new Error('timeout')); });
  });
}

async function fetchBuf(url) {
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'shuku-hot' } });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
  } catch (e) {}
  return await httpsGetBuf(url);   // 代理环境下 net.fetch 可能被拦, 退回直连
}

async function listRemote() {
  const buf = await fetchBuf(LIST_API);
  const arr = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(arr)) throw new Error('列表格式不对');
  return arr.filter(function (x) { return x && x.type === 'file' && /\.mjs$/i.test(x.name); });
}

// libRoot: 书库根(用户目录); 返回 {ok, checked, changed:[], msg}
async function sync(libRoot, opts) {
  const o = opts || {};
  if (!libRoot || !fs.existsSync(libRoot)) return { ok: false, msg: '书库目录不存在' };
  const dstDir = path.join(libRoot, DIR);
  if (!fs.existsSync(dstDir)) return { ok: false, msg: '书库里没有 ' + DIR };
  let files = [];
  try { files = await listRemote(); } catch (e) { return { ok: false, msg: '拉列表失败: ' + String((e && e.message) || e) }; }
  if (!files.length) return { ok: false, msg: '远端没有可同步的脚本' };

  const prevDir = path.join(dstDir, '.hotprev');
  const changed = [], failed = [];
  for (const f of files) {
    const dst = path.join(dstDir, f.name);
    let remote;
    try { remote = await fetchBuf(raw(f.name)); } catch (e) { failed.push(f.name); continue; }
    let local = null;
    try { local = fs.readFileSync(dst); } catch (e) {}
    if (local && local.length === remote.length && local.equals(remote)) continue;   // 一样, 跳过
    try {
      if (local) { try { fs.mkdirSync(prevDir, { recursive: true }); fs.writeFileSync(path.join(prevDir, f.name), local); } catch (e) {} }
      const tmp = dst + '.hot-tmp';
      fs.writeFileSync(tmp, remote);
      fs.renameSync(tmp, dst);
      changed.push(f.name);
    } catch (e) { failed.push(f.name); }
  }

  const c = readCfg();
  c.lastScriptSync = Date.now();
  c.lastScriptSyncResult = changed.length + ' 个更新' + (failed.length ? (', ' + failed.length + ' 个失败') : '');
  writeCfg(c);
  return { ok: failed.length === 0, checked: files.length, changed: changed, failed: failed, msg: failed.length ? ('部分失败: ' + failed.join(',')) : '' };
}

// 启动后按需自动同步(打包版, 12 小时一次)
function maybeAutoSync(libRoot) {
  if (!app.isPackaged) return false;
  const c = readCfg();
  if (c.hotSync === false) return false;
  const last = Number(c.lastScriptSync) || 0;
  if (Date.now() - last < 12 * 3600 * 1000) return false;
  sync(libRoot).catch(function () {});
  return true;
}

function status() {
  const c = readCfg();
  return { enabled: c.hotSync !== false, last: Number(c.lastScriptSync) || 0, lastResult: String(c.lastScriptSyncResult || '') };
}
function setEnabled(v) { const c = readCfg(); c.hotSync = !!v; writeCfg(c); return status(); }

module.exports = { sync, status, setEnabled, maybeAutoSync, DIR };
