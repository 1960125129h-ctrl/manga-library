'use strict';
// 站点脚本 + 界面源码 热更新(不重装应用)
//
// 两条通道:
//   A) _scripts/sites/*.mjs   每次下载 spawn 新 node 进程 -> 覆盖即生效, 连重启都不用
//   B) src/**                 渲染层静态文件 -> 写完要 reload 窗口才生效, 所以带"契约检查 + 失败回滚"
//
// 安全与稳妥:
//   · 逐字节比对, 一样就不写; 覆盖前备份到 <目录>/.hotprev/
//   · 先写 .tmp 再 rename, 不留半截文件
//   · src 通道额外做契约检查: 新界面用到 mangaLib.xxx, 而 preload 没暴露 -> 整个 src 通道放弃(避免白屏)
//   · reload 后如果没起来(window.mlBooted 为假) -> 自动用 .hotprev 回滚再 reload

const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const OWNER = '1960125129h-ctrl';
const REPO = 'manga-library';
const BRANCH = 'master';
const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
const rawUrl = function (p) { return 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/' + p.split(path.sep).join('/'); };

// ---- 配置(和主进程同一个 userData) ----
function cfgPath() { return path.join(app.getPath('userData'), 'config.json'); }
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return {}; } }
function writeCfg(c) { try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2), 'utf8'); } catch (e) {} }

// ---- 网络: 先 net.fetch(带系统代理), 失败退回 Node https 直连 ----
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
  return await httpsGetBuf(url);
}

// ---- 远端文件清单: 一次 tree 递归拿到, 省 API 配额 ----
async function listTree() {
  const buf = await fetchBuf(API + '/git/trees/' + BRANCH + '?recursive=1');
  const j = JSON.parse(buf.toString('utf8'));
  const tree = Array.isArray(j.tree) ? j.tree : [];
  // 浏览器启动脚本也走热更新：它每次点站名都由主进程重新 spawn，覆盖即生效，
  // 但它在 _scripts/jm/ 下（原来只有 sites/ 和 src/ 会同步），所以单列出来。
  const HOT_EXTRA = [
    '_scripts/jm/open-chrome.mjs',
    '_scripts/jm/open-edge.mjs',
    '_scripts/jm/profile-cache.mjs'
  ];
  const want = function (p) {
    if (p.indexOf('_scripts/sites/') === 0) return /\.mjs$/i.test(p);
    if (p.indexOf('src/') === 0) return /\.(js|mjs|css|html|json)$/i.test(p);
    if (HOT_EXTRA.indexOf(p) >= 0) return true;
    return false;
  };
  return tree.filter(function (x) { return x.type === 'blob' && want(x.path); }).map(function (x) { return x.path; });
}

// ---- 契约检查: 新 src 里用到的 mangaLib.xxx 必须都在 preload 里暴露 ----
function preloadApiNames() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
    const m = src.match(/exposeInMainWorld\(\s*['"]mangaLib['"]\s*,\s*\{([\s\S]*?)\n\}\);/);
    const body = m ? m[1] : src;
    const names = [];
    body.replace(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm, function (_, n) { if (names.indexOf(n) < 0) names.push(n); return _; });
    return names;
  } catch (e) { return []; }
}
function usedApiNames(buffers) {
  const used = {};
  buffers.forEach(function (b) {
    const s = b.toString('utf8');
    s.replace(/mangaLib\.([A-Za-z_$][\w$]*)/g, function (_, n) { used[n] = 1; return _; });
  });
  return Object.keys(used);
}
function contractCheck(files) {
  const have = preloadApiNames();
  if (!have.length) return { ok: true, missing: [] };   // 读不到 preload 就不拦, 免得误伤
  const used = usedApiNames(files.map(function (f) { return f.buf; }));
  const missing = used.filter(function (n) { return have.indexOf(n) < 0; });
  return { ok: missing.length === 0, missing: missing };
}

// ---- 写入一个文件(带备份 + 原子替换) ----
function writeFile(libRoot, rel, buf) {
  const dst = path.join(libRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  let old = null;
  try { old = fs.readFileSync(dst); } catch (e) {}
  if (old && old.length === buf.length && old.equals(buf)) return false;   // 一样
  if (old) {
    const bak = path.join(path.dirname(dst), '.hotprev', path.basename(dst));
    try { fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.writeFileSync(bak, old); } catch (e) {}
  }
  const tmp = dst + '.hot-tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dst);
  return true;
}

// ---- 主入口 ----
// opts.only: 'scripts' | 'src' | undefined(两个都做)
async function sync(libRoot, opts) {
  const o = opts || {};
  if (!libRoot || !fs.existsSync(libRoot)) return { ok: false, msg: '书库目录不存在' };
  let list = [];
  try { list = await listTree(); } catch (e) { return { ok: false, msg: '拉清单失败: ' + String((e && e.message) || e) }; }
  if (o.only === 'scripts') list = list.filter(function (p) { return p.indexOf('_scripts/sites/') === 0; });
  if (o.only === 'src') list = list.filter(function (p) { return p.indexOf('src/') === 0; });
  if (!list.length) return { ok: false, msg: '远端没有可同步的文件' };

  // 先全部拉下来(小文件, 通常只变几个)
  const fetched = [], failed = [];
  for (const p of list) {
    try { fetched.push({ rel: p, buf: await fetchBuf(rawUrl(p)) }); } catch (e) { failed.push(p); }
  }

  const srcFiles = fetched.filter(function (f) { return f.rel.indexOf('src/') === 0; });
  const scriptFiles = fetched.filter(function (f) { return f.rel.indexOf('_scripts/sites/') === 0; });

  // 契约检查(仅对 src, 且确实有变化时才做, 省得每次启动都读=读)
  let contractBlocked = [];
  const changedScripts = [], changedSrc = [];
  for (const f of scriptFiles) {
    try { if (writeFile(libRoot, f.rel, f.buf)) changedScripts.push(f.rel); } catch (e) { failed.push(f.rel); }
  }
  if (srcFiles.length) {
    const chk = contractCheck(srcFiles);
    if (!chk.ok) {
      contractBlocked = chk.missing;
    } else {
      for (const f of srcFiles) {
        try { if (writeFile(libRoot, f.rel, f.buf)) changedSrc.push(f.rel); } catch (e) { failed.push(f.rel); }
      }
    }
  }

  const c = readCfg();
  c.lastScriptSync = Date.now();
  c.lastScriptSyncResult = changedScripts.length + ' 个脚本 / ' + changedSrc.length + ' 个界面文件' + (failed.length ? (', ' + failed.length + ' 失败') : '');
  writeCfg(c);

  return {
    ok: failed.length === 0,
    checked: list.length,
    changed: changedScripts,
    changedSrc: changedSrc,
    needsReload: changedSrc.length > 0,
    blocked: contractBlocked,          // 非空 -> 说明这版界面依赖了新的主进程接口, 只能发版
    failed: failed,
    msg: failed.length ? ('部分失败: ' + failed.join(', ')) : ''
  };
}

// ---- reload 后的自愈: 起不来就用 .hotprev 回滚 ----
// 备份位置约定: <dir>/.hotprev/<文件> 对应 <dir>/<文件>
function rollbackSrc(libRoot) {
  const root = path.join(libRoot, 'src');
  let n = 0;
  (function walk(dir) {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    const prev = path.join(dir, '.hotprev');
    if (fs.existsSync(prev)) {
      let olds = [];
      try { olds = fs.readdirSync(prev, { withFileTypes: true }); } catch (e) {}
      for (const f of olds) {
        if (!f.isFile()) continue;
        try { fs.copyFileSync(path.join(prev, f.name), path.join(dir, f.name)); n++; } catch (e) {}
      }
    }
    for (const it of items) {
      if (it.isDirectory() && it.name !== '.hotprev') walk(path.join(dir, it.name));
    }
  })(root);
  return n;
}
function status() {
  const c = readCfg();
  return { enabled: c.hotSync !== false, last: Number(c.lastScriptSync) || 0, lastResult: String(c.lastScriptSyncResult || '') };
}
function setEnabled(v) { const c = readCfg(); c.hotSync = !!v; writeCfg(c); return status(); }

function maybeAutoSync(libRoot) {
  if (!app.isPackaged) return false;
  const c = readCfg();
  if (c.hotSync === false) return false;
  if (Date.now() - (Number(c.lastScriptSync) || 0) < 12 * 3600 * 1000) return false;
  sync(libRoot).catch(function () {});
  return true;
}

module.exports = { sync, status, setEnabled, maybeAutoSync, rollbackSrc, preloadApiNames, DIR: '_scripts/sites' };