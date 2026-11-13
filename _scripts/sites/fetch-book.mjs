// 通用抓书: node fetch-book.mjs --url <来源链接> --dir <书名> [--from N] [--to M] [--author X] [--desc Y]
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { spawnSync, spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkMeta, checkChapters, checkGalleries, checkImages } from './contract.mjs';
const SELF = fileURLToPath(import.meta.url);
if (process.env.JM_PROXY_READY !== '1') {   // 保证代理环境在进程启动时就位(NODE_USE_ENV_PROXY 必须启动时存在)
  // 代理地址由主进程通过 MANGA_PROXY 传下来(设置里可改); 独立跑 CLI 时没这个变量, 沿用旧的 7890
  const rawPx = Object.prototype.hasOwnProperty.call(process.env, 'MANGA_PROXY') ? String(process.env.MANGA_PROXY || '') : 'http://127.0.0.1:7890';
  const direct = !rawPx || rawPx === 'off' || rawPx === 'none' || rawPx === 'direct';
  const px = direct ? '' : (/^https?:\/\//i.test(rawPx) ? rawPx : 'http://' + rawPx);
  const env2 = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', JM_PROXY_READY: '1' };
  if (px) { env2.HTTP_PROXY = px; env2.HTTPS_PROXY = px; env2.NODE_USE_ENV_PROXY = '1'; }
  else { delete env2.HTTP_PROXY; delete env2.HTTPS_PROXY; delete env2.NODE_USE_ENV_PROXY; }
  const r0 = spawnSync(process.execPath, [SELF, ...process.argv.slice(2)], { stdio: 'inherit', env: env2 });
  process.exit(r0.status || 0);
}
const LIB = path.resolve(SELF, '..', '..', '..');
const CAT = '漫画';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : (d === undefined ? null : d); };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const say = (s) => console.log(s);

/* 直连抓一张图（绕开代理）。
   起因：node 24 的 NODE_USE_ENV_PROXY 连 https.request 一起接管了，同一个进程里没法「只让这张图直连」。
   EH 的 H@H 图床有一批节点在 22334 / 45123 / 62000 这类高端口，代理不放行（ECONNRESET），直连是通的。
   系统 curl.exe 不认那个环境变量，--noproxy '*' 就是干净直连。实测 62000 端口 200 / 137KB / 0.79s。 */
function curlDirectImg(url, headers, timeoutMs) {
  return new Promise((resolve) => {
    const secs = Math.max(15, Math.floor((timeoutMs || 30000) / 1000));
    // 【关键】--connect-timeout 单独限死"连不上"的等待。
    // 原来只有一个 --max-time 30，连不上的死节点要干等 30 秒；实测 EH 里约 10% 的图是死节点，
    // 88 页就是 9 张 × 30 秒 = 270 秒纯空等，这才是"改了还是慢"的真凶。
    // 现在：连不上 6 秒放弃，已经在传的图仍然给足 30 秒，正常大图不受影响。
    const args = ['-sS', '--noproxy', '*', '--connect-timeout', '6', '--max-time', String(secs)];
    for (const k of Object.keys(headers || {})) {
      if (!/^[A-Za-z0-9-]+$/.test(k)) continue;
      args.push('-H', k + ': ' + headers[k]);
    }
    args.push(url);   // 默认写 stdout
    execFile('curl.exe', args, { encoding: 'buffer', maxBuffer: 96 * 1024 * 1024, timeout: (secs + 5) * 1000 }, (err, stdout) => {
      if (err || !stdout || stdout.length < 100) return resolve(null);   // 和 looksValidImage 的阈值对齐，别把正常小图当失败
      resolve(stdout);
    });
  });
}
let url = arg('url');
// 规范化：剥掉 ?p=N / ?next= 这类查询参数。
// EH 画廊地址形如 /g/<gid>/<token>/，带 ?p=6 会让缓存 key 对不上，
// 虽然 galleryOf 的正则还能提出 gid/token，但没必要留这个尾巴。
if (url) {
  const u0 = String(url).trim();
  const uq = u0.indexOf('?');
  if (uq > 0) url = u0.slice(0, uq).replace(/\/+$/, '/');
}
const PROBE = argv.includes('--probe');   // 只解析不出下载: 给 App 的「通用链接」页签用
// --pick-details: 给一批 pixiv ID, 逐个查标题+缩略图, 逐行输出(在 adapter 检查之前)
if (argv.includes('--pick-details')) {
  const ids = (arg('ids') || '').split(',').filter(Boolean);
  if (!ids.length) process.exit(0);
  const { pixiv } = await import('./index.mjs');
  // 先看缓存: 标题+缩略图都有就直接回, 不打接口(pixiv 限流很快, 同一作者二次打开能省掉全部请求)
  const queue = [];
  const attempts = new Map();
  const doneIds = new Set();
  let rateNotified = false;
  for (const id of ids) {
    const c = (typeof pixiv.cachedWork === 'function') ? pixiv.cachedWork(id) : null;
    if (c && c.title && c.thumb) {
      console.log('@@PICK@@' + JSON.stringify({ id: id, title: c.title, thumb: c.thumb, cached: true }));
      doneIds.add(id);
    } else {
      queue.push({ id: id, title: (c && c.title) || '', thumb: (c && c.thumb) || '' });
    }
  }
  const MAX_ATTEMPTS = 8;
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      try {
        const b = await pixiv.ajax('/ajax/illust/' + it.id, 5);
        const thumb = (b.urls && (b.urls.small || b.urls.thumb)) || it.thumb || '';
        const title = b.illustTitle || it.title || '';
        if (typeof pixiv.rememberWork === 'function') pixiv.rememberWork(it.id, title, thumb);
        console.log('@@PICK@@' + JSON.stringify({ id: it.id, title: title, thumb: thumb }));
        doneIds.add(it.id);
      } catch (e) {
        const isRate = !!(e && e.fatal) || /429|限流|too many requests/i.test(String(e && e.message || e));
        if (isRate) {
          if (!rateNotified) {
            rateNotified = true;
            console.log('@@PICK-RATE@@' + JSON.stringify({ msg: 'Pixiv 限流(429)：正在续跑，稍后自动重试，已缓存的会立刻出', remaining: queue.length + 1 }));
          }
          const waitMs = Math.max(5000, (e && e.retryAfter) || 20000);
          await new Promise((r) => setTimeout(r, waitMs));
          const n = (attempts.get(it.id) || 0) + 1;
          attempts.set(it.id, n);
          if (n < MAX_ATTEMPTS) queue.push(it);
          else console.log('@@PICK-ERR@@' + JSON.stringify({ id: it.id, msg: '多次限流后仍未取到，可关闭重开或点重试继续补' }));
        } else {
          console.log('@@PICK-ERR@@' + JSON.stringify({ id: it.id, msg: String(e && e.message || e).slice(0, 160) }));
        }
      }
    }
  };
  await Promise.all([worker(), worker()]);   // 降为 2 并发, 配合 400ms 节流减少 429
  if (rateNotified) console.log('@@PICK-RATE@@' + JSON.stringify({ msg: 'Pixiv 限流续跑结束：仍未取到的作品可关闭重开或点重试继续补', done: doneIds.size, failed: ids.length - doneIds.size }));
  process.exit(0);
}

const { pick } = await import('./index.mjs');
// 从整段口令(如抖音复制文本)里提取 http(s) 链接, 提取不到就用原文
{ const um = String(url || '').match(/https?:\/\/[^\s，。、；）)]+/i); if (um) url = um[0]; }
/* ---------- 页清单(前端下载前预览用): 每页一个缩略图格子 ---------- */
// 适配器给了 pageList() 就用它(带 thumb); 没有就退回 chapters() 的头一话, 缩略图走 App 的通用代理
async function buildPagePreview(adapter, u) {
  try {
    let pages = [];
    if (typeof adapter.pageList === 'function') {
      // nhentai 的 pageList 收 gallery id; e-hentai 的 pageList 收整个画廊 URL —— 两个都喂, 各自取自己认的
      const gid = (String(u).match(/\/g\/(\d+)/) || [])[1] || String(u).trim();
      pages = await adapter.pageList(adapter.id === 'ehentai' ? u : gid);
    } else {
      const chs = await adapter.chapters(u);
      if (!chs.length) return null;
      const imgs = await adapter.images(chs[0]);
      pages = imgs.map(function (im, i) {
        const o = (typeof im === 'string') ? { url: im, headers: {} } : im;
        return { n: i + 1, url: o.url, headers: o.headers || {} };
      });
    }
    if (!pages || !pages.length) return null;
    return {
      pageUrl: u,   // 原页面地址: 预览图要按它推 Referer(防盗链)
      book: arg('dir') || '',
      chapterId: '',
      pages: pages.map(function (p) {
        // 只带前端要用的字段: 不带 headers/Cookie(预览图由 App 主进程代理拉, 前端不需要凭据)
        const o = { n: p.n, url: p.url, thumb: p.thumb || '' };
        if (!o.thumb) o.thumbProxy = 1;   // 没给缩略图: 让主进程把大图当缩略图拉(带 Referer), 前端不直连防盗链 CDN
        if (p.w) { o.w = p.w; o.h = p.h; }
        if (typeof p.cl === "number") { o.cl = p.cl; o.ct = p.ct || 0; o.cw = p.cw || 285; o.ch = p.ch || 300; }   // EH sprite: 交给主进程按这个矩形裁这一格
        if (!o.thumb && p.thumb) o.thumb = p.thumb;   // EH 的 sprite 也要给前端一个地址(主进程按 pageUrl 带 Referer 拉)
        return o;
      }),
    };
  } catch (e) {
    return { error: String(e && e.message || e).slice(0, 160) };
  }
}
if (!url && argv.includes("--tag-next")) url = arg("tag-next");   // 续取模式: 用 next 链接当 url, 好让适配器认出来
  // ── 浏览器标签: browsertabs:list / browsertabs:current / browsertabs:pending ──
  // 从带 --remote-debugging-port=9333 的 Chrome 读标签, 当"容器"返回给界面, 复用同一套列表 UI。
  // 待挑列表存在 _scripts/jm/pending.json: 收下的会累积、关弹窗不丢、已入库的自动移出。
  if (/^browsertabs:/i.test(String(url || ''))) {
    const fsx = await import('node:fs');
    const PENDING = path.join(LIB, '_scripts', 'jm', 'pending.json');
    const LIBJ = path.join(LIB, 'library.json');
    const readPending = () => { try { const a = JSON.parse(fsx.readFileSync(PENDING, 'utf8')); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    const writePending = (l) => { try { fsx.writeFileSync(PENDING, JSON.stringify(l, null, 1), 'utf8'); } catch (e) {} };
    const libTxt = () => { try { return fsx.readFileSync(LIBJ, 'utf8'); } catch (e) { return ''; } };
    const libUrls = () => { try { const j = JSON.parse(fsx.readFileSync(LIBJ, 'utf8')); const c = (j && j.comics) || {}; return new Set(Object.keys(c).map((k) => String((c[k] && c[k].source && c[k].source.url) || '').trim()).filter(Boolean)); } catch (e) { return new Set(); } };
    const prune = () => { const set = libUrls(); const l = readPending(); const k = l.filter((x) => !set.has(String(x.url || '').trim())); if (k.length !== l.length) writePending(k); return k; };
    const BT_PORT = 9333;
    const mode = String(url).split(':')[1] || 'list';
    const isWork = (u) => /e-hentai\.org\/g\/\d+\/[0-9a-f]+/i.test(u) || /nhentai\.net\/g\/\d+/i.test(u) || /pixiv\.net\/artworks\/\d+/i.test(u);
    const isBox = (u) => /pixiv\.net\/users\/\d+/i.test(u) || /e-hentai\.org\/tag\//i.test(u);
    const emit = (list, desc) => {
      say('@@RESULT@@' + JSON.stringify({ ok: true, site: 'browsertabs', title: '浏览器标签', rawTitle: '', author: '', desc: desc, cover: '', chapters: list.length, url: url, tagBatch: true, galleries: list, next: '' }));
      process.exit(0);
    };
    if (mode === 'pending') {
      const list = prune();
      say('待挑列表 ' + list.length + ' 本');
      emit(list, '待挑列表（下载成功后自动移出）');
    }
    let tabs = [];
    try {
      const ac = new AbortController();
      const tm = setTimeout(() => ac.abort(), 4000);
      const r = await fetch('http://127.0.0.1:' + BT_PORT + '/json/list', { signal: ac.signal });
      clearTimeout(tm);
      const list = await r.json();
      tabs = (list || []).filter((x) => x.type === 'page' && x.url && !/^(devtools:|chrome:|about:)/i.test(x.url));
    } catch (e) {
      say('@@RESULT@@' + JSON.stringify({ ok: false, msg: '连不上浏览器调试端口 ' + BT_PORT }));
      process.exit(0);
    }
    if (mode === 'current') {
      const probe = async (t) => new Promise((res) => {
        let done = false, ws = null;
        const fin = (v) => { if (done) return; done = true; try { if (ws) ws.close(); } catch (e) {} res(v); };
        if (!t.webSocketDebuggerUrl) return fin(null);
        try { ws = new WebSocket(t.webSocketDebuggerUrl); } catch (e) { return fin(null); }
        const tm = setTimeout(() => fin(null), 700);
        ws.onopen = () => { try { ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.visibilityState', returnByValue: true } })); } catch (e) { fin(null); } };
        ws.onmessage = (ev) => { try { const m = JSON.parse(String(ev.data)); if (m.id === 1) { clearTimeout(tm); fin(String((m.result && m.result.result && m.result.result.value) || '')); } } catch (e) {} };
        ws.onerror = () => fin(null); ws.onclose = () => fin(null);
      });
      const pr = await Promise.all(tabs.map((t) => probe(t).then((v) => ({ t, v }))));
      const vis = pr.filter((p) => p.v === 'visible');
      if (!vis[0]) { say('@@RESULT@@' + JSON.stringify({ ok: false, msg: '没找到你正在看的那个标签' })); process.exit(0); }
      tabs = [vis[0].t];
    }
    const works = tabs.filter((t) => isWork(t.url));
    const boxes = tabs.filter((t) => isBox(t.url));
    say('浏览器标签 ' + tabs.length + ' 个: 单作品 ' + works.length + ' 个, 容器页 ' + boxes.length + ' 个(容器页请单独粘到通用链接)');
    const { pick: pickAdapter } = await import('./index.mjs');
    const fresh = [];
    const seen = {};
    for (const t of works) {
      const key = t.url.replace(/[?#].*$/, '');
      if (seen[key]) continue;
      seen[key] = 1;
      const idm = t.url.match(/\/(?:g|artworks)\/(\d+)/);
      fresh.push({ title: (t.title || '').replace(/\s*[-\u2013]\s*(E-Hentai|nhentai|pixiv).*$/i, '').trim() || t.url, url: t.url, thumb: '', extra: '待取封面', tabId: t.id, id: idm ? idm[1] : '' });
    }
    const resolveOne = async (item) => {
      try {
        const ad = pickAdapter(item.url);
        if (!ad || !ad.resolve) return;
        const m = await ad.resolve(item.url);
        if (m && m.title) item.title = m.title;
        if (m && m.cover) { item.thumb = m.cover; if (m.coverCrop) { item.cl = m.coverCrop.cl; item.ct = m.coverCrop.ct; item.cw = m.coverCrop.cw; item.ch = m.coverCrop.ch; } }
        if (m && m.status) item.extra = m.status;
        if (!item.thumb && ad.pageList) {
          try { const pl = await ad.pageList(item.url); if (pl && pl[0] && pl[0].thumb) { item.thumb = pl[0].thumb; item.cl = pl[0].cl; item.ct = pl[0].ct || 0; item.cw = pl[0].cw || 200; item.ch = pl[0].ch || 300; } } catch (e) {}
        }
      } catch (e) { say('  解析失败(仍保留): ' + String(e.message || e).slice(0, 60)); }
    };
    let next = 0;
    const CONC = 4;
    await Promise.all(Array.from({ length: CONC }, async () => { while (next < fresh.length) { const it = fresh[next++]; await resolveOne(it); } }));
    const pend = prune();
    for (const it of fresh) if (!pend.some((x) => x.url === it.url)) pend.push(it);
    writePending(pend);
    const kept = prune();
    say('新列 ' + fresh.length + ' 本, 待挑列表现在共 ' + kept.length + ' 本（容器页 ' + boxes.length + ' 个已跳过）');
    emit(kept, '待挑列表（下载成功后自动移出）');
  }
const adapter = pick(url);
if (!adapter) { say('暂不支持该站点: ' + url); if (PROBE) say('@@RESULT@@' + JSON.stringify({ ok: false, msg: '暂不支持该站点' })); process.exit(1); }
// EH Tag 批量下载: 识别 tag 页 URL, 走批量分支
const isTagBatch = !!(adapter.matchTag && adapter.matchTag(url));
const skipResolve = PROBE && adapter.id === 'pixiv' && /\/users\//i.test(url);   // probe 模式下 pixiv 用户链接跳过 resolve(省一次 API)
// resolve 失败原来被 .catch(() => ({})) 静静吞掉，结果书名变成「未命名」、目录建错。
// 现在把原因打出来，界面和日志都能看见。
const meta = (isTagBatch || skipResolve) ? {} : checkMeta(
  await adapter.resolve(url).catch((err) => { say('  [警告] 解析书名失败: ' + String((err && err.message) || err).slice(0, 120)); return {}; }),
  adapter.id
);
if (!isTagBatch && !skipResolve && !(meta && meta.title)) say('  [警告] 没拿到书名，将用「未命名」建目录（建议在下载面板手动填书名）');
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);
const book = arg('dir') || safe(meta.title) || '未命名';
if (PROBE) {   // 只报元数据 + 话数
  if (isTagBatch) {   // tag 列表: 首屏只取 4 页(100 本)就返回, 后面按需再取(界面滚到底/点按钮时)
    say('站点: ' + adapter.id + ' | EH Tag 批量下载: ' + url);
    const FIRST_PAGES = 4;
    let first = [], sent = false, nextUrl = '';
    const sendFirst = () => {
      if (sent) return;
      sent = true;
      say('@@RESULT@@' + JSON.stringify({ ok: true, site: adapter.id, title: 'EH Tag 批量下载', rawTitle: '', author: '', desc: '共 ' + first.length + ' 个画廊（可继续加载）', cover: '', chapters: first.length, url: url, tagBatch: true, galleries: first, next: nextUrl }));
    };
    const STOP = new Error('__stop__');
    try {
      await adapter.tagGalleries(url, {
        maxPages: FIRST_PAGES,
        onBatch: function (batch, pageNo, tot, nxt) {
          for (const g of checkGalleries(batch, adapter.id)) first.push(g);   // 契约: 缺 gid/url 直接抛, 会被下面的 catch 变成界面可见的报错
          nextUrl = nxt || '';
          if (pageNo >= FIRST_PAGES || !nxt) { sendFirst(); throw STOP; }
        },
      });
      if (!sent) sendFirst();
    } catch (e) {
      if (e !== STOP) {
        if (!sent) say('@@RESULT@@' + JSON.stringify({ ok: false, msg: '抓画廊列表失败: ' + String(e.message || e).slice(0, 120) }));
        else say('@@WORKS-ERR@@' + JSON.stringify({ msg: String(e.message || e).slice(0, 120) }));
      }
    }
    process.exit(0);
  }
  // 继续取下一批(界面"加载更多"/滚到底时调用): 从给定的 next 链接再取 4 页
  if (argv.includes('--tag-next')) {
    const start = arg('tag-next');
    if (!start) { say('@@RESULT@@' + JSON.stringify({ ok: false, msg: '缺少 next 链接' })); process.exit(1); }
    let out2 = [], nxt2 = '';
    try {
      await adapter.tagGalleries(start, {
        maxPages: 4,
        onBatch: function (batch, pageNo, tot, nxt) { for (const g of checkGalleries(batch, adapter.id)) out2.push(g); nxt2 = nxt || ''; },
      });
      say('@@RESULT@@' + JSON.stringify({ ok: true, site: adapter.id, galleries: out2, next: nxt2 }));
    } catch (e) {
      say('@@RESULT@@' + JSON.stringify({ ok: false, msg: '继续取失败: ' + String(e.message || e).slice(0, 120) }));
    }
    process.exit(0);
  }

  process.env.FETCH_PROBE = '1';
  let n = 0, chList = null, chErr = '';
  // pixiv 用户链接: 快速拿作品 ID 列表(不逐个查标题, 标题后台补)
  let pickList = null;
  if (adapter.id === 'pixiv' && /\/users\//i.test(url)) {
    try {
      const { pixiv } = await import('./index.mjs');
      const uid = (url.match(/\/users\/(\d+)/) || [])[1];
      const all = await pixiv.ajax('/ajax/user/' + uid + '/profile/all');
      const works = [];
      const push = (v) => { if (!v) return; const items = Array.isArray(v) ? v : Object.keys(v); items.forEach(k => works.push({id: String(k)})); };
      push(all.illusts); push(all.manga);
      works.sort((a,b) => parseInt(b.id) - parseInt(a.id));   // pixiv ID 越大越新
      console.error('[pick-debug] first 3 ids:', works.slice(0,3).map(w=>w.id).join(','), 'last 3:', works.slice(-3).map(w=>w.id).join(','));
      pickList = works.slice(0, 500).map(function(w) {
        const cc = pixiv.cachedWork(w.id);
        return { id: w.id, title: (cc && cc.title) || ('pixiv ' + w.id), thumb: (cc && cc.thumb) || '', url: 'https://www.pixiv.net/artworks/' + w.id };
      });
      n = works.length;
    } catch (e) { say('pixiv 列表失败: ' + e.message); }
  }
  if (!pickList) {
    try { chList = checkChapters(await adapter.chapters(url), adapter.id); n = chList.length; } catch (e) { say('取章节失败: ' + e.message); chErr = String(e && e.message || e).slice(0, 160); }
  }
  // 章节勾选列表: 每话带 done 标记(先按话 id 认, 老引擎书没有 id 记录就按预期话目录名兜底)
  let chapterList = null;
  if (chList) {
    let doneIds = new Set(), existingDirs = new Set();
    try { Object.keys(JSON.parse(fs.readFileSync(path.join(LIB, CAT, book, '.fetch-meta.json'), 'utf8')).ids || {}).forEach((k) => doneIds.add(String(k))); } catch (e) {}
    try { const bp = path.join(LIB, CAT, book); for (const d of fs.readdirSync(bp)) { if (fs.statSync(path.join(bp, d)).isDirectory()) existingDirs.add(d); } } catch (e) {}
    const expectedName = (c, i) => {
      const t = String(c.title || '').trim();
      const m = t.match(/^第?\s*(\d{1,4})\s*[话話卷]$/);
      if (m) return '第' + String(parseInt(m[1], 10)).padStart(2, '0') + (/卷$/.test(t) ? '卷' : '話');
      if (t) return String(i).padStart(2, '0') + ' ' + safe(t).slice(0, 60);
      return '第' + String(i).padStart(2, '0') + '話';
    };
    chapterList = chList.map((c, i) => ({ i: i + 1, title: c.title || '', done: (!!(c.id && doneIds.has(String(c.id)))) || existingDirs.has(expectedName(c, i + 1)) }));
  }
  // 页预览: 单本链接也给一份页清单(--no-preview 可跳过)
  let pagePreview = null;
  if (!pickList && !isTagBatch && !argv.includes('--no-preview')) {
    pagePreview = await buildPagePreview(adapter, url);
    if (pagePreview && pagePreview.error) say('页预览取不到(不影响下载): ' + pagePreview.error);
  }
  say('站点: ' + adapter.id + ' | 书名: ' + book + ' | 共 ' + n + ' 话' + (pagePreview && pagePreview.pages ? ' | 页预览 ' + pagePreview.pages.length + ' 页' : ''));
  say('@@RESULT@@' + JSON.stringify({ ok: !!(meta.title || n), site: adapter.id, title: book, rawTitle: meta.title || '', author: meta.author || '', desc: meta.desc || '', cover: meta.cover || '', chapters: n, url: url, pickList: pickList, chapterList: chapterList, pagePreview: pagePreview, msg: (chErr ? ('取章节失败: ' + chErr) : (!!(meta.title || n) ? undefined : '解析不出书名和章节，链接可能失效或格式不对')) }));
  process.exit(0);
}
const judge = /^\s*$|bad request|not found|forbidden|too many requests|^\d{3}\b|^error/i.test(book);   // 错误页标题: 别拿它当书名建库
if (!isTagBatch && judge) { say('书名看起来是错误页标题（' + book + '），拒绝建库；确认书名后用 --dir "正确书名" 再跑。'); process.exit(1); }

/* ---------- 图片完整性校验: 大小 + 魔数 ---------- */
function looksValidImage(buf) {
  if (!buf || buf.length < 100) return false;   // 至少几百字节
  const b = buf;
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;        // JPEG: FF D8
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true;  // PNG: 89 50 4E 47
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'RIFF') return true;                  // WebP: RIFF
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'GIF8') return true;                   // GIF: GIF8
  return false;
}
function fileLooksValid(p) {
  try {
    const st = fs.statSync(p);
    if (st.size < 100) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(512);
    fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    return looksValidImage(buf);
  } catch (e) { return false; }
}
/* 配额用尽 fatal 错误(连续 5 张 509/403 才抛) */
function quotaErr() { const e = new Error('E-Hentai 图片配额用尽(sad panda)，已下载的话不会丢，等配额恢复后重跑会自动续下'); e.fatal = true; return e; }

/* ---------- 动图(mp4)转 GIF: 用便携版 ffmpeg(_scripts/tools/ffmpeg) ---------- */
let FF = null;
function ffmpegPath() {
  if (FF !== null) return FF;
  FF = 'ffmpeg';
  try {
    const base = path.join(LIB, '_scripts', 'tools', 'ffmpeg');
    const find = (d, depth) => {
      if (depth > 4) return null;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p2 = path.join(d, e.name);
        if (e.isDirectory()) { const hit = find(p2, depth + 1); if (hit) return hit; }
        else if (e.name.toLowerCase() === 'ffmpeg.exe') return p2;
      }
      return null;
    };
    if (fs.existsSync(base)) { const hit = find(base, 0); if (hit) FF = hit; }
  } catch (e) {}
  return FF;
}
function ffprobePath() {   // ffprobe 与 ffmpeg 同目录
  try { return ffmpegPath().replace(/ffmpeg\.exe$/i, 'ffprobe.exe'); } catch (e) { return 'ffprobe'; }
}
function toGif(mp4, out) {   // out 写成 .part 临时文件, 校验后由调用方 rename
  const args = ['-y', '-i', mp4, '-vf', "fps=12,scale='min(900,iw)':-1:flags=lanczos,zscale=primaries=bt709:transfer=bt709:matrix=bt709,format=rgb24,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a", '-loop', '0', '-f', 'gif', out];
  try { fs.rmSync(out, { force: true }); } catch (e) {}
  const r2 = spawnSync(ffmpegPath(), args, { encoding: 'utf8' });
  const ok = r2.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1024;
  return { ok: ok, why: ok ? '' : ('exit=' + r2.status + ' ' + String(r2.stderr || '').split('\n').filter(function (l) { return l.trim(); }).slice(-2).join(' / ').slice(0, 200)) };
}
// 动图 mp4 静态截图: 按视频时长的 1/6、3/6、5/6 处 + 末帧 各截一帧(任何长度都均匀不重复); ffprobe 不可用时退回固定秒点。
function grabSnaps(mp4, dir, seq) {
  // 读时长
  let dur = 0;
  try { const rp = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' });
        dur = parseFloat(String(rp.stdout || '').trim()) || 0; } catch (e) {}
  let times;
  if (dur >= 1.5) {
    times = [dur / 6, dur / 2, dur * 5 / 6];   // 前三个点; 第四张固定取末帧
  } else {
    times = [1, 3, 5];   // 拿不到时长: 退回老规律的前三个点
  }
  let got = 0;
  times.forEach((t, k) => {
    const out = path.join(dir, seq + '_' + (k + 2) + '.jpg');
    try { fs.rmSync(out, { force: true }); } catch (e) {}
    const tryAt = (ssArgs) => {
      try { const r = spawnSync(ffmpegPath(), ssArgs, { encoding: 'utf8' });
            return r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1024; } catch (e) { return false; }
    };
    if (tryAt(['-y', '-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', '-q:v', '3', '-f', 'image2', out])) { got++; return; }
    try { fs.rmSync(out, { force: true }); } catch (e) {}
    if (tryAt(['-y', '-sseof', '-0.2', '-i', mp4, '-frames:v', '1', '-q:v', '3', '-f', 'image2', out])) got++;
  });
  // 第 4 张: 固定末帧
  const lastOut = path.join(dir, seq + '_5.jpg');
  try { fs.rmSync(lastOut, { force: true }); } catch (e) {}
  try { const r = spawnSync(ffmpegPath(), ['-y', '-sseof', '-0.2', '-i', mp4, '-frames:v', '1', '-q:v', '3', '-f', 'image2', lastOut], { encoding: 'utf8' });
        if (r.status === 0 && fs.existsSync(lastOut) && fs.statSync(lastOut).size > 1024) got++; } catch (e) {}
  return got;
}
async function headLen(u, hd) {   // 同一张图有多档地址时, 用体积挑最大的那档
  try { const r = await fetch(u, { headers: hd, method: 'HEAD' }); const L = parseInt(r.headers.get('content-length') || '0', 10); return isNaN(L) ? 0 : L; } catch (e) { return 0; }
}
// hasDir: 判定目录是否已有图; .part 临时文件不算(中断后重跑会重新下载损坏的图)
const hasDir = (d) => { try { return fs.existsSync(d) && fs.readdirSync(d).some((f) => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)); } catch (e) { return false; } };

/* ---------- 通用图片下载 worker: 临时文件 + 魔数校验 + 连续509/403 fatal + 逐张进度 ---------- */
async function downloadImagesToDir(dir, urls, ctx) {
  ctx = ctx || {};
  // 契约: 图片项没有可用地址时直接停。继续下会得到残页, 而残页比报错更难发现。
  urls = checkImages(urls, adapter.id, ctx.label);
  const merge = !!ctx.merge;
  const seqRef = ctx.seqRef || { n: 0 };
  const label = ctx.label || '';
  // 并发按站点定：适配器可以 export const jobs = N 声明自己的限流脾气
  // （nhentai 12 / ehentai 4 / pixiv 2 / 其余 8），命令行 --jobs 可临时覆盖
  const DEF_JOBS = Math.max(1, parseInt((adapter && adapter.jobs) || 8, 10) || 8);
  const JOBS = Math.max(1, Math.min(20, parseInt(arg('jobs', String(DEF_JOBS)), 10) || DEF_JOBS));
  let n = 0, bi = 0, failed = 0, done = 0, lastProg = 0;
  const failures = [];   // 记录没下来的页 -> 结束时写 .fetch-errors.json 到书目录
  const recordFail = (seq, ext, why, url) => {
    failures.push({ seq: seq, ext: ext, why: String(why || '').slice(0, 120), url: String(url || '').slice(0, 300), at: Date.now() });
  };
  let consecQuota = 0;   // 连续 509/403 计数(跨 worker 共享, JS 单线程 await 间安全)
  const queue = urls.map((u, i) => ({ u: u, i: i }));
  const emitProg = () => {
    if (done - lastProg >= 5 || done === urls.length) {
      lastProg = done;
      say('@@PROG@@' + JSON.stringify({ stage: 'download', index: done, got: done, total: urls.length, bytes: bi }));
    }
  };
  const worker = async () => {
    while (queue.length) {
      const q2 = queue.shift();
      const u2 = typeof q2.u === 'string' ? { url: q2.u, headers: {} } : q2.u;   // 适配器可以给每张图带专属请求头
      const hd = Object.assign({ 'User-Agent': UA, 'Referer': adapter.home || 'https://manhua.zaimanhua.com/' }, u2.headers || {});
      let mainUrl = u2.gif ? u2.gif : u2.url;   // 动图(mp4)优先, 否则用图片地址
      if (u2.alts && u2.alts.length) {   // 有备用地址: 挑体积最大的那档(最清晰)
        let best = await headLen(mainUrl, hd);
        for (const a2 of u2.alts) { const L = await headLen(a2, hd); if (L > best) { best = L; mainUrl = a2; } }
      }
      // 页级勾选(--pages): 文件名用真实页号(5 位补零), 空档不会把后一页顶到前面去
      const seq = u2.pageNum ? String(u2.pageNum).padStart(5, '0')
        : (merge ? String(++seqRef.n).padStart(4, '0') : String(q2.i + 1).padStart(3, '0'));
      const extGuess = (String(mainUrl).split('?')[0].match(/\.(jpg|jpeg|png|webp|gif)$/i) || ['.jpg'])[0].toLowerCase();
      // 断点续传：目标文件已存在且大小>0 就跳过，不再从头下一遍。
      // 两种编号都要认：普通下载用 3 位（003），页级勾选用 5 位（00003）。
      // 只认当前模式那一种的后果：同一张图两种模式各下一次，88 页的目录里堆了 165 个文件。
      if (!ctx.forceRedl) {
        const num = parseInt(seq, 10);
        const cands = [seq + extGuess];
        if (!isNaN(num)) {
          cands.push(String(num).padStart(3, '0') + extGuess);
          cands.push(String(num).padStart(5, '0') + extGuess);
        }
        let hit = false;
        for (const nm of cands) {
          try {
            const st = fs.statSync(path.join(dir, nm));
            if (st.size > 0) { done++; bi += st.size; n++; emitProg(); hit = true; break; }
          } catch (e2) {}
        }
        if (hit) continue;
      }
      let r = null, buf = null, why = '';
      if (u2.direct) {
        // 适配器声明这路图必须直连（EH 的 H@H 高端口代理一律不放行）。
        // 直接走 curl，不再先浪费 3 次代理重试 —— 日志里 2405 次「代理不通」全是白等。
        const d = await curlDirectImg(mainUrl, hd);
        if (d) { buf = d; r = { status: 200 }; }
        else why = '直连失败';
      } else {
        for (let attempt = 0; attempt < 2 && !r; attempt++) {   // 代理只试 2 次（原来是 3 次）
          try {
            const rr = await fetch(mainUrl, { headers: hd });
            if (rr.status === 509 || rr.status === 403) {          // 配额/封禁: 连续 5 张才 fatal
              consecQuota++;
              if (consecQuota >= 5) throw quotaErr();
              await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
              continue;
            }
            consecQuota = 0;
            const ctype = String((rr.headers && rr.headers.get && rr.headers.get('content-type')) || '');
            if (rr.ok && /^image\//i.test(ctype)) {
              buf = Buffer.from(await rr.arrayBuffer()); r = rr;
            } else if (rr.ok) {
              // 200 但不是图片：CF 挑战页 / 错误页 / 配额提示，当场换路，别等到最后校验才丢图
              why = '代理返回非图片(' + (ctype || '无 Content-Type') + ')';
              await new Promise((res) => setTimeout(res, 300));
            }
          } catch (e) { if (e && e.fatal) throw e; why = '代理异常:' + String((e && e.message) || e).slice(0, 60); await new Promise((res2) => setTimeout(res2, 500)); }
        }
        // 代理下不来 → 同一条地址直连再试一次
        if (!r) {
          const d = await curlDirectImg(mainUrl, hd);
          if (d) { buf = d; r = { status: 200 }; say('  [直连] 第 ' + (q2.i + 1) + " 页代理不通，已改用直连"); }
          else why = why || '代理与直连均失败';
        }
      }
      // 还是不行，再试适配器给的备用档（例如 EH 原图 <-> 降级档互换），别整页丢掉
      if (!r && u2.alts && u2.alts.length) {
        for (const a3 of u2.alts) {
          const au = typeof a3 === 'string' ? a3 : a3.url;
          const ah = typeof a3 === 'string' ? hd : Object.assign({}, hd, a3.headers || {});
          try {
            if (a3 && a3.direct) {
              const ad = await curlDirectImg(au, ah);
              if (ad) { buf = ad; r = { status: 200 }; say('  [回退] 备用档(直连)兜住第 ' + (q2.i + 1) + ' 页'); break; }
              continue;
            }
            const rr3 = await fetch(au, { headers: ah });
            const ct3 = String((rr3.headers && rr3.headers.get && rr3.headers.get('content-type')) || '');
            if (rr3.ok && /^image\//i.test(ct3)) { buf = Buffer.from(await rr3.arrayBuffer()); r = rr3; say('  [回退] 备用档兜住第 ' + (q2.i + 1) + ' 页'); break; }
          } catch (e3) {}
        }
      }
      if (!r) { recordFail(seq, extGuess, why || '下载失败', mainUrl); failed++; done++; emitProg(); continue; }
      if (u2.gif) {   // 动图: 下 mp4 -> ffmpeg 转 GIF(写 .part, 校验后 rename)
        const tmp = path.join(dir, '__dy_' + q2.i + '.mp4');
        const out = path.join(dir, seq + '_1.gif');   // _1 让 GIF 在文件排序里排第一, 静态图 _2~_5 跟后
        const partOut = out + '.part';
        fs.writeFileSync(tmp, buf);
        let g = toGif(tmp, partOut);
        if (!g.ok) {   // 转换失败: 重下一次 mp4 再转
          try {
            const r3 = await fetch(mainUrl, { headers: hd });
            if (r3.ok) { const b3 = Buffer.from(await r3.arrayBuffer()); fs.writeFileSync(tmp, b3); g = toGif(tmp, partOut); }
          } catch (e3) {}
        }
        const snaps = grabSnaps(tmp, dir, seq);   // 同一 mp4 截 4 张静态, 在挪走 tmp 前截
        try { fs.renameSync(tmp, path.join(dir, seq + '.mp4')); } catch (e2) { try { fs.rmSync(tmp, { force: true }); } catch (e2b) {} }   // 保留原 mp4(不在图片扩展名里, 阅读器不显示)
        if (!g.ok || !fileLooksValid(partOut)) {
          // 诊断: 校验失败时保留文件头, 看 ffmpeg 到底写出了什么
          try { const hx = fs.readFileSync(partOut).slice(0, 16).toString('hex'); say('    [诊断] partOut hex: ' + hx + ' size=' + fs.statSync(partOut).size); } catch (eD) {}
          try { fs.rmSync(partOut, { force: true }); } catch (e3) {} say('    动图转 GIF 失败: ' + g.why); failed++; done++; emitProg(); continue; }
        fs.renameSync(partOut, out);
        n++; bi += fs.statSync(out).size;
        for (let sk = 2; sk <= snaps + 1; sk++) { const sp = path.join(dir, seq + '_' + sk + '.jpg'); try { n++; bi += fs.statSync(sp).size; } catch (e4) {} }
      } else {
        const ext = (String(mainUrl).split('?')[0].match(/\.(jpg|jpeg|png|webp|gif)$/i) || ['.jpg'])[0].toLowerCase();
        const finalP = path.join(dir, seq + ext);
        const partP = finalP + '.part';
        if (!looksValidImage(buf)) {   // 太小或魔数不符: 丢弃, 不写正式文件
          try { fs.rmSync(partP, { force: true }); } catch (e3) {}
          // 把头部字节打出来：是 HTML（CF 挑战页）还是真图（魔数不认识）一目了然
          const hexHead = buf.slice(0, 32).toString('hex');
          const txtHead = buf.slice(0, 80).toString('utf8').replace(/[^\x20-\x7e]/g, '.');
          say('    图片校验失败(太小或魔数不符), 已丢弃: ' + seq + ext + ' size=' + buf.length + ' hex=' + hexHead + ' txt=' + txtHead);
          recordFail(seq, ext, '校验失败 size=' + buf.length + ' head=' + txtHead.slice(0, 60), mainUrl);
          failed++; done++; emitProg(); continue;
        }
        fs.writeFileSync(partP, buf);
        fs.renameSync(partP, finalP);   // 原子 rename: 不会出现"半张正式图"
        n++; bi += buf.length;
      }
      done++; emitProg();
    }
  };
  await Promise.all(Array.from({ length: JOBS }, () => worker()));
  // 把没下来的页写到书目录的 .fetch-errors.json（不动 .fetch-meta.json —— 那是记账文件）
  try {
    const ef = path.join(dir, '.fetch-errors.json');
    if (failures.length) {
      failures.sort((a, b) => String(a.seq).localeCompare(String(b.seq)));
      fs.writeFileSync(ef, JSON.stringify({ site: adapter.id, at: Date.now(), total: urls.length, ok: n, failed: failures }, null, 1), 'utf8');
      say('  未完成的页已记录: .fetch-errors.json (' + failures.length + ' 页)');
    } else if (n > 0 && fs.existsSync(ef)) {
      // 只有"真的下了并且全成功"才清掉残留。
      // 原来不管有没有下载都会删——一轮 todo 为空的重跑就把上次的失败记录抹了，
      // 下次连"这本书还没下完"都不知道，缺页永远补不上。
      fs.rmSync(ef, { force: true });
    }
  } catch (e9) { say('写 .fetch-errors.json 失败: ' + (e9 && e9.message)); }
  return { n: n, bi: bi, failed: failed, nextSeq: seqRef.n };
}

/* ---------- 把一本书写进 library.json(去重 + 限长 + 备份 + 原子写) ---------- */
function writeLibraryEntries(entries) {
  // entries: [{ book, meta, sourceUrl }]
  const libFile = path.join(LIB, 'library.json');
  const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
  try {   // 写之前备份原文件
    fs.mkdirSync(path.join(LIB, '_backup'), { recursive: true });
    fs.copyFileSync(libFile, path.join(LIB, '_backup', 'library.json.bak'));
  } catch (eb) { say('备份 library.json 失败(忽略): ' + eb.message); }
  const plat = '漫画站';
  const BIG = { pixiv: 'pixiv', x: 'X', twitter: 'X', douyin: '抖音', weibo: '微博' };
  for (const en of entries) {
    const p = BIG[adapter.id] || (adapter.id === 'ehentai' ? 'E-Hentai' : plat);
    const key = CAT + '/' + en.book;
    const prev = lib.comics[key] || {};
    let tags = Array.isArray(prev.tags) ? prev.tags.slice() : [];
    if (tags.indexOf(p) < 0) tags.push(p);
    ((en.meta && en.meta.tags) || []).forEach((t) => { const s = String(t || '').trim(); if (s && tags.indexOf(s) < 0) tags.push(s); });
    const removedT = Array.isArray(prev.tagsRemoved) ? prev.tagsRemoved : [];
    tags = tags.filter((t) => removedT.indexOf(t) < 0);
    tags = Array.from(new Set(tags));          // 完整去重
    if (tags.length > 100) tags = tags.slice(0, 100);   // 上限 100
    let cats = Array.isArray(prev.categories) ? prev.categories.slice() : [];
    if (cats.indexOf(p) < 0) cats.push(p);
    cats = Array.from(new Set(cats));           // categories 去重
    lib.comics[key] = Object.assign({ favorite: false, categories: [], tags: [], note: '' }, prev, {
      author: prev.author || (en.meta && en.meta.author) || '',
      desc: prev.desc || (en.meta && en.meta.desc) || '',
      source: { site: adapter.id, url: en.sourceUrl },
      tags: tags,
      categories: cats,
    });
    fs.mkdirSync(path.join(LIB, CAT, en.book), { recursive: true });
  }
  if (!Array.isArray(lib.categories)) lib.categories = [];
  const pAll = BIG[adapter.id] || (adapter.id === 'ehentai' ? 'E-Hentai' : plat);
  if (lib.categories.indexOf(pAll) < 0) lib.categories.push(pAll);
  // 原子写: 先 .tmp 再 rename
  const tmpF = libFile + '.tmp';
  fs.writeFileSync(tmpF, JSON.stringify(lib, null, 2), 'utf8');
  fs.renameSync(tmpF, libFile);
}
/* 末尾重建: 异步 spawn, 不阻塞下载进程; 完成后发 @@REBUILT@@ */
function rebuildAsync(onlyBook) {
  return new Promise((res) => {
    const args = [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB, '--offline'];
    if (onlyBook) args.push('--only', onlyBook);
    const bp = spawn(process.execPath, args, { stdio: 'inherit' });
    bp.on('exit', (code) => res(code === 0));
  });
}

/* ================= EH Tag 批量下载 ================= */
async function runTagBatch(tagUrl) {
  say('识别为 EH Tag 批量下载: ' + tagUrl);
  let galleries = [];
  try { galleries = checkGalleries(await adapter.tagGalleries(tagUrl), adapter.id); } catch (e) {
    say('tag 列表获取失败: ' + e.message);
    say('@@DONE@@' + JSON.stringify({ chapters: 0, images: 0, bytes: 0, out: '', book: '' }));
    process.exit(e && e.fatal ? 2 : 1);
  }
  // 前端勾选: --pick gid1,url1;gid2,url2  只下选中的
  const pickArg = arg('pick');
  if (pickArg) {
    const want = {};
    pickArg.split(';').filter(Boolean).forEach(function (p) {
      const parts = p.split('|');
      want[parts[0]] = true;
    });
    galleries = galleries.filter(function (g) { return want[g.gid] || want[g.url]; });
    say('已勾选 ' + galleries.length + ' 个画廊（从列表里筛出）');
  }
  if (!galleries.length) { say('这个 tag 下没有任何画廊（或勾选后一个都没剩）'); say('@@DONE@@' + JSON.stringify({ chapters: 0, images: 0, bytes: 0, out: '', book: '' })); process.exit(1); }
  say('@@TAGSTART@@' + JSON.stringify({ total: galleries.length }));
  const entries = [];
  let totalImgs = 0, totalBytes = 0, doneN = 0;
  for (const g of galleries) {
    doneN++;
    // 先拿真标题再定文件夹名。
    // 列表里的 title 初始值是 'pixiv <作品ID>' (作者主页批量时), 只有补详情成功才会换成真标题,
    // 一旦补详情被限流就永久留下 'pixiv 139172953' 这种目录名(库里曾经有 343 本中招)。
    // resolve 本来就要调, 这里只是把它提到"命名之前"。
    let gMeta = null;
    for (let k = 0; k < 2 && !gMeta; k++) {
      try { gMeta = await adapter.resolve(g.url); } catch (e2) {
        if (k === 0) await new Promise(function (r) { setTimeout(r, 1500); });
        else say('  取真标题失败, 退回列表标题: ' + String((e2 && e2.message) || e2).slice(0, 100));
      }
    }
    const realTitle = safe((gMeta && gMeta.title) || '');
    const bName = realTitle || safe(g.title);
    if (!realTitle) say('  ! 真标题取不到, 这本书会用占位名: ' + bName);
    const bDir = path.join(LIB, CAT, bName);
    say('@@CH@@' + JSON.stringify({ index: doneN, label: bName }));
    let success = false;
    for (let attempt = 0; attempt < 2 && !success; attempt++) {
      if (attempt > 0) { say('  重试第 ' + attempt + ' 次…'); await new Promise(function (r) { setTimeout(r, 2000); }); }
      try {
        if (hasDir(bDir)) { say('  已存在, 跳过: ' + bName); success = true; break; }
        if (!gMeta) gMeta = await adapter.resolve(g.url);
        const chaps = await adapter.chapters(g.url);
        for (const c of chaps) {
          const imgs = await adapter.images(c);
          if (!imgs.length) continue;
          const cdir = path.join(bDir, '全本');
          fs.mkdirSync(cdir, { recursive: true });
          const res = await downloadImagesToDir(cdir, imgs, { label: bName });
          totalImgs += res.n; totalBytes += res.bi;
          if (res.n < imgs.length) say('  缺页 ' + (imgs.length - res.n) + ' 张');
        }
        try { if (typeof adapter.clearCache === 'function') adapter.clearCache(g.url); } catch (e2) {}   // 下载成功：这条缓存没用了

        entries.push({ book: bName, meta: gMeta, sourceUrl: g.url });
        say('  完成: ' + bName);
        success = true;
      } catch (e) {
        if (e && e.fatal) { say('  ' + bName + ' 失败(致命): ' + String(e.message).slice(0, 120)); throw e; }
        say('  ' + bName + ' 失败(第' + (attempt + 1) + '次): ' + String(e.message).slice(0, 120));
      }
    }
    say('@@TAGPROG@@' + JSON.stringify({ done: doneN, total: galleries.length, title: bName }));
  }
  if (entries.length) {
    try { writeLibraryEntries(entries); } catch (e) { say('写 library.json 失败: ' + e.message); }
  }
  // 增量重建: 只重建本次下到的每个画廊文件夹, 不全库重扫
  let ok = true;
  for (const e of entries) {
    try { const r = await rebuildAsync(CAT + '/' + e.book); if (!r) ok = false; } catch (e2) { ok = false; }
  }
  say('@@PROG@@' + JSON.stringify({ stage: 'organize', got: 1, total: 1 }));
  say('@@REBUILT@@' + JSON.stringify({ ok: ok }));
  say('完成: 批量 ' + doneN + '/' + galleries.length + ' 个画廊, 共 ' + totalImgs + ' 张图');
  say('@@DONE@@' + JSON.stringify({ chapters: entries.length, images: totalImgs, bytes: totalBytes, out: path.join(LIB, CAT), book: '' }));
  process.exit(totalImgs ? 0 : 1);
}
if (isTagBatch) { await runTagBatch(url); process.exit(0); }

/* ================= 单画廊/单本正常流程 ================= */
const list = checkChapters(await adapter.chapters(url), adapter.id);
// nhentai: 把 v2 的 pages(每页 number/path)挂到章节对象上 —— 按页勾选和精确地址都靠它
if (adapter.id === 'nhentai') {
  for (const c of list) {
    if (Array.isArray(c.pageUrls) && c.pageUrls.length) continue;
    try {
      const pg = await adapter.pageList(String(c.id));
      if (pg.length) { c.pageUrls = pg; break; }   // 页清单挂 pageUrls: pages 这个字段是「页数」
    } catch (e) { say('取页清单失败(退回逐页探测): ' + String(e.message).slice(0, 100)); }
  }
}
if (!list.length) {
  say('站点没给章节表（共 0 话），不建目录、不写书库。');
  say('常见原因：这本是付费/受限内容、需要登录、地区限制，或者地址不是目录页。换一个来源或换本书吧。');
  process.exit(1);
}
// 前端勾选: --pick id1,id2  只下选中的话(pixiv 用户作品集等)
const pickCh = arg('pick');
if (pickCh) {
  const want = {};
  pickCh.split(',').filter(Boolean).forEach(function (x) { want[x.trim()] = true; });
  const before = list.length;
  const filtered = list.filter(function (c) { return want[String(c.id)]; });
  if (filtered.length < list.length) { say('已勾选 ' + filtered.length + ' / ' + before + ' 话（从列表里筛出）'); list.length = 0; list.push.apply(list, filtered); }
}
const from = parseInt(arg('from', '1'), 10), to = parseInt(arg('to', '99999'), 10);
// --pages "1,3,5-8": 前端勾选的页号(1-based), 页级勾选时只下这些页
const PAGESEL = arg('pages');
const pageSet = new Set();
if (PAGESEL) String(PAGESEL).split(',').forEach((p) => {
  const r = p.trim(); if (!r) return;
  const m = r.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) { for (let k = +m[1]; k <= +m[2]; k++) pageSet.add(k); }
  else if (/^\d+$/.test(r)) pageSet.add(+r);
});
// --chapters "1,3,5-8": 前端勾选的话序号(1-based), 任意子集; 不传=全部
const CHSEL = arg('chapters');
const chSet = new Set();
if (CHSEL) String(CHSEL).split(',').forEach((p) => {
  const r = p.trim(); if (!r) return;
  const m = r.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) { for (let k = +m[1]; k <= +m[2]; k++) chSet.add(k); }
  else if (/^\d+$/.test(r)) chSet.add(+r);
});

/* ---------- 分组: 站点把章节分成「连载 / 单行本 / 番外篇 / 其他系列」时, 按组分书 ---------- */
const groupOf = (c) => String(c.group || '').trim();
const groups = [];
for (const c of list) { const g = groupOf(c); if (groups.indexOf(g) < 0) groups.push(g); }
const countOf = (g) => list.filter((c) => groupOf(c) === g).length;
const mainGroup = groups.slice().sort((a, b) => countOf(b) - countOf(a))[0] || '';
const onlyG = String(arg('group', '') || '').split(/[,，\s]+/).filter(Boolean);
const skipG = String(arg('skip-group', '') || '').split(/[,，\s]+/).filter(Boolean);
if (!onlyG.length && skipG.indexOf('单行本') < 0) skipG.push('单行本');   // 单行本=正篇合订, 默认跳过
const useGroup = (g) => (onlyG.length ? onlyG.indexOf(g) >= 0 : skipG.indexOf(g) < 0);
const bookOf = (g) => ((g === mainGroup || !g) ? book : book + ' · ' + safe(g));

say('站点: ' + adapter.id + ' | 书名: ' + book + ' | 共 ' + list.length + ' 话');
if (groups.length > 1 || (groups[0] || '')) {
  for (const g of groups) say('  「' + (g || '未分组') + '」' + countOf(g) + ' 话' + (useGroup(g) ? '' : ' → 跳过') + '   → ' + CAT + '/' + bookOf(g));
}

/* ---------- 命名: 第N话/第N卷这种规范名照旧; 番外/插图/附录等用站点真实标题(带两位序号保序) ---------- */
function chDirName(c, n) {
  let raw = c.title;
  if (raw && typeof raw === 'object') raw = raw.text || raw.title || raw.cn || raw.jp || JSON.stringify(raw);
  const t = String(raw || '').trim();
  const m = t.match(/^第?\s*(\d{1,4})\s*[话話卷]$/);
  if (m) return '第' + String(parseInt(m[1], 10)).padStart(2, '0') + (/卷$/.test(t) ? '卷' : '話');
  if (t) return String(n).padStart(2, '0') + ' ' + safe(t).slice(0, 60);
  return '第' + String(n).padStart(2, '0') + '話';
}
const plan = [], usedName = {};
for (const g of groups) {
  if (!useGroup(g)) continue;
  const inGroup = list.filter((c) => groupOf(c) === g).slice().sort((a, b) => a.order - b.order || a.index - b.index);
  const bdir = path.join(LIB, CAT, bookOf(g));
  // 同一本书分次下载时, 新话从已有最大序号后面继续编号, 避免又从 01 开始造成"开头重复"
  let maxSeq = 0;
  try { for (const de of fs.readdirSync(bdir, { withFileTypes: true })) { if (!de.isDirectory()) continue; const m = de.name.match(/^(\d{1,4})(\s|$)/); if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10)); } } catch (e) {}
  inGroup.forEach((c, i) => {
    let name;
    if (PAGESEL) {
      // 页级勾选是"给已经下过的章节补页"，不该新建一个章节。
      // 原来这里走 maxSeq+1，补第 2 页就多出一个「02 全本」，图散在两处。
      // 现在先找已有的同名章节（忽略前面的序号）复用。
      const bare = chDirName(c, 1).replace(/^\d+\s*/, '');
      let reuse = null;
      try {
        for (const de of fs.readdirSync(bdir, { withFileTypes: true })) {
          if (!de.isDirectory()) continue;
          if (de.name.replace(/^\d+\s*/, '') === bare) { reuse = de.name; break; }
        }
      } catch (e0) {}
      name = reuse || chDirName(c, maxSeq + i + 1);
    } else {
      name = chDirName(c, maxSeq + i + 1);
    }
    if (usedName[bookOf(g) + '/' + name]) { let k = 2; while (usedName[bookOf(g) + '/' + name + ' (' + k + ')']) k++; name += ' (' + k + ')'; }
    usedName[bookOf(g) + '/' + name] = 1;
    plan.push({ c: c, book: bookOf(g), dir: path.join(bdir, name), label: name });
  });
}
/* ---------- --merge: 不按话分文件夹, 所有图片合并到一本里的一个文件夹 ---------- */
const MERGE = argv.includes('--merge');
if (MERGE) {
  const mdir = path.join(LIB, CAT, book, '全部');
  plan.length = 0;
  list.slice().sort((a, b) => a.index - b.index).forEach((c) => plan.push({ c: c, book: book, dir: mdir, label: '全部' }));
  say('--merge: 所有话的图片合并到 ' + CAT + '/' + book + '/全部');
}
plan.sort((a, b) => a.c.index - b.c.index);

const FORCE = argv.includes('--force');   // 已经下过的话也重下(覆盖), 用来替换成更清晰的版本
/* 已下过的判定改成"按作品 id 认", 不再只看目录名 */
const META_F = path.join(LIB, CAT, book, '.fetch-meta.json');
let idMap = {};
try { idMap = JSON.parse(fs.readFileSync(META_F, 'utf8')); } catch (e) { idMap = {}; }
const ids = (idMap && idMap.ids && typeof idMap.ids === 'object') ? idMap.ids : {};
const todo = [], renames = [], pageTargets = new Map();
let skippedAll = 0, skippedFull = 0;   // 统计「已经下过、这轮不用动」的话, 用来把退出码判成成功
/* 页级勾选(--pages): 这本书整本可能已经下过, 但用户点的是"只要这几页", 所以必须单独走一条路
   —— 先看该话目录有没有这些页(按 5 位页号命名的文件), 缺哪页补哪页; 有了就跳过。
   注意不能走下面"整本已入库直接跳过"的分支, 否则页级勾选在已下载的书上会失效(以前就是这样, 会退 1)。 */
const fileAt = (dir, f) => path.join(dir, Array.isArray(f) ? f.join(path.sep) : f);
function existingPages(dir, nums) {
  const out = new Set();
  for (const n of nums) {
    const seq = String(n).padStart(5, '0');
    for (const ext of ['webp', 'jpg', 'jpeg', 'png', 'gif']) {
      const pth = fileAt(dir, seq + '.' + ext);
      try { if (fs.existsSync(pth) && fs.statSync(pth).size > 100) { out.add(n); break; } } catch (e) {}
    }
  }
  return out;
}
for (const it of plan) {
  if (it.c.index < from || it.c.index > to) continue;
  // 【修复】plan 里的目录名是按 maxSeq+1 新编的，但 .fetch-meta.json 里记着这本上次用的名字。
  // 不认那个名字的后果：每跑一次就多出一个「02 全本」「03 全本」，图散在好几个目录里，
  // 而且 hasDir 判定全部落空 —— 等于每次都在"新"章节上重下。
  {
    const cid0 = it.c.id ? String(it.c.id) : '';
    const kN = (cid0 && ids[cid0]) ? ids[cid0] : '';
    const kP = kN ? path.join(path.dirname(it.dir), kN) : '';
    if (kP && fs.existsSync(kP) && path.basename(kP) !== path.basename(it.dir)) {
      it.dir = kP;
      it.label = kN;
    }
  }
  if (pageSet.size) {   // 页级勾选: 给已下过的章节"补页/覆盖这几页"
    // 【严重 bug 修复】原来这里直接 rmSync 整个目录，注释写的是"勾选的页重下、没勾的不管"，
    // 实际却是先删光整章再只下勾选的那几页 —— 补 3 页能把 40 多张已下好的图全删掉（踩过）。
    // 现在不删目录：由 worker 里的断点续传跳过已存在的，勾选页想覆盖就加 --force。
    pageTargets.set(it, pageSet);
    todo.push(it);
    continue;
  }
  if (chSet.size) {
    // 勾选模式: 勾到的话一律重下(覆盖已下载/没下完的); 没勾到的跳过
    if (!chSet.has(it.c.index)) continue;
    try { fs.rmSync(it.dir, { recursive: true, force: true }); } catch (e) {}
    todo.push(it); continue;
  }
  const cid = it.c.id ? String(it.c.id) : '';
  const known = (cid && ids[cid]) ? path.join(path.dirname(it.dir), ids[cid]) : '';
  if (FORCE) {                       // --force: 先把这个目录清干净, 免得旧文件残留混进来
    try { fs.rmSync(it.dir, { recursive: true, force: true }); } catch (e) {}
    todo.push(it); continue;
  }
  if (known && hasDir(known)) {
    // 同一条规矩：目录里有 .fetch-errors.json 说明上次没下完，得继续补，不能当"已入库"跳过
    let incomplete2 = false;
    try { incomplete2 = fs.existsSync(path.join(known, '.fetch-errors.json')); } catch (e) {}
    if (!incomplete2) {
      if (path.basename(known) !== path.basename(it.dir)) renames.push({ from: known, to: it.dir });
      skippedAll++; skippedFull++;
      continue;
    }
    it.dir = known;
    it.label = path.basename(known);
    say('  续下: ' + it.label + ' 上次还有没下完的页');
  }
  if (hasDir(it.dir)) {
    // 上次没下完的话（还留着 .fetch-errors.json）不能当成"已入库"直接跳过，
    // 否则缺页永远补不上，只能靠手动 --pages 一张张点。
    let incomplete = false;
    try { incomplete = fs.existsSync(path.join(it.dir, '.fetch-errors.json')); } catch (e) {}
    if (!incomplete) { skippedAll++; skippedFull++; continue; }
    say('  续下: ' + it.label + ' 上次还有没下完的页');
  }
  todo.push(it);
}
if (renames.length) {   // 两阶段改名, 避免互相覆盖
  const tmp = [];
  renames.forEach((r, i) => { try { fs.renameSync(r.from, r.from + '.__rn' + i); tmp.push({ t: r.from + '.__rn' + i, to: r.to }); } catch (e) {} });
  let ok = 0;
  tmp.forEach((t) => { try { fs.renameSync(t.t, t.to); ok++; } catch (e) {} });
  if (ok) say('按最新顺序校正了 ' + ok + ' 个话目录名(内容不变)');
}
say('待下载 ' + todo.length + ' 话 (跳过已入库 ' + (plan.length - todo.length) + ')' + (skippedFull ? ' —— 已入库的话不会重下, 只补缺的' : ''));
say('@@START@@' + JSON.stringify({ total: todo.length, book: book, out: path.join(LIB, CAT, book), site: adapter.id, chapters: list.length }));
let done = 0, gotImages = 0, gotBytes = 0, didDownload = 0;
let fileSeq = 0;
// --merge 续跑: 统计目标目录已有图片数, fileSeq 从该数量开始接续编号(中断重跑不覆盖旧文件)
if (MERGE && todo.length) {
  const mdir = path.join(LIB, CAT, book, '全部');
  let existing = 0;
  try { existing = fs.readdirSync(mdir).filter((f) => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)).length; } catch (e) {}
  fileSeq = existing;
  if (existing) say('--merge 续跑: 已有 ' + existing + ' 张, 从 ' + (existing + 1) + ' 继续编号');
}
const seqRef = { n: fileSeq };
for (const it of todo) {
  const dir = it.dir;
  say('@@CH@@' + JSON.stringify({ index: it.c.index, label: it.label }));
  try {
    let urls = await adapter.images(it.c);
    if (!urls.length) { say('  ' + it.label + ' 没拿到图片'); say('@@CHERR@@' + JSON.stringify({ index: it.c.index, label: it.label, message: '没拿到图片' })); continue; }
    // 页级勾选: 只留选中的页; 文件名按真实页号(00005.webp), 未勾选的不下载
    if ((pageTargets.get(it) || pageSet).size) {
      const want = pageTargets.get(it) || pageSet;
      const before2 = urls.length;
      const all = urls.map(function (u2, i2) {
        const o = (typeof u2 === 'string') ? { url: u2 } : u2;
        return Object.assign({}, o, { pageNum: o.pageNum || (i2 + 1) });
      }).filter(function (o) { return want.has(o.pageNum); });
      const have = existingPages(dir, Array.from(want));
      urls = all.filter(function (o) { return !have.has(o.pageNum); });
      say('  按页勾选: ' + all.length + ' / ' + before2 + ' 页 (' + Array.from(want).sort(function (a2, b2) { return a2 - b2; }).join(',') + ')' + (have.size ? '，磁盘已有 ' + have.size + ' 页，跳过' : ''));
      if (!all.length) { say('  ' + it.label + ' 勾选的页都不存在'); say('@@CHERR@@' + JSON.stringify({ index: it.c.index, label: it.label, message: '勾选的页号超出范围' })); continue; }
      if (!urls.length) {   // 勾的页都已经在磁盘上: 不算失败, 直接跳过(重跑同一次勾选时就会走到这里)
        say('  勾选的页都已存在，跳过');
        for (const o of all) { try { gotBytes += fs.statSync(path.join(dir, String(o.pageNum).padStart(5, '0') + (String(o.url).match(/\.(webp|jpg|jpeg|png|gif)$/i) || ['.webp'])[0])).size; } catch (e3) {} }
        gotImages += all.length; done++; didDownload++;
        say('@@CHDONE@@' + JSON.stringify({ index: it.c.index, label: it.label, got: 0, expected: 0, bytes: 0, failed: 0 }));
        continue;
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    const res = await downloadImagesToDir(dir, urls, { merge: MERGE, seqRef: seqRef, label: it.label });
    say('  ' + it.label + ' OK ' + res.n + '/' + urls.length + ' 张 (' + (res.bi / 1048576).toFixed(1) + ' MB)' + (res.failed ? ', 失败 ' + res.failed + ' 张' : ''));
    if (res.n < urls.length) say('  缺页 ' + (urls.length - res.n) + ' 张 (已下载的不会丢, 重跑会自动续下)');
    say('@@CHDONE@@' + JSON.stringify({ index: it.c.index, label: it.label, got: res.n, expected: urls.length, bytes: res.bi, failed: res.failed }));
    done++; gotImages += res.n; gotBytes += res.bi; didDownload++;
  } catch (e) {
    say('  ' + it.label + ' 失败: ' + String(e.message).slice(0, 120));
    say('@@CHERR@@' + JSON.stringify({ index: it.c.index, label: it.label, message: String(e.message).slice(0, 160) }));
    if (e && e.fatal) {   // 配额/权限这类: 后面的话也别试了, 早点收工
      say('检测到"再试也没用"的错误, 本轮提前收工。已下载的话不会丢, 下次跑会自动跳过续下。');
      break;
    }
  }
}
// 写 library.json(简介/来源/作者): 去重 + 限长 + 备份 + 原子写
try {
  const libFile = path.join(LIB, 'library.json');
  const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
  try {
    fs.mkdirSync(path.join(LIB, '_backup'), { recursive: true });
    fs.copyFileSync(libFile, path.join(LIB, '_backup', 'library.json.bak'));
  } catch (eb) {}
  const booksUsed = [];
  for (const it of plan) {   // 只给"确实有图入库"的书建条目, 免得失败一次就留下空书
    if (booksUsed.indexOf(it.book) >= 0) continue;
    let has = false;
    try { has = fs.readdirSync(path.dirname(it.dir)).some((f) => /^(\d|第)/.test(f)); } catch (e) { has = false; }
    if (has || hasDir(it.dir)) booksUsed.push(it.book);
  }
  // 记下 id -> 目录名, 下次重跑按 id 判"下过没", 不受序号变动影响
  try {
    const outIds = {};
    for (const it of plan) {
      if (!it.c.id) continue;
      const nm = path.basename(it.dir);
      if (fs.existsSync(it.dir) || hasDir(it.dir)) outIds[String(it.c.id)] = nm;
    }
    fs.mkdirSync(path.join(LIB, CAT, book), { recursive: true });
    fs.writeFileSync(path.join(LIB, CAT, book, '.fetch-meta.json'), JSON.stringify({ site: adapter.id, ids: outIds, at: Date.now() }), 'utf8');
  } catch (e) { say('写 .fetch-meta.json 失败: ' + e.message); }
  if (!booksUsed.length) say('这一轮没有任何图片入库, 不建目录也不写 library.json。');
  // 平台归类: 大平台单独算, 其它漫画站统一「漫画站」
  const BIG = { pixiv: 'pixiv', x: 'X', twitter: 'X', douyin: '抖音', weibo: '微博' };
  const plat = BIG[adapter.id] || (adapter.id === 'ehentai' ? 'E-Hentai' : '漫画站');
  for (const b of booksUsed) {          // 按组分书时, 每个分书都要有自己的条目
    const key = CAT + '/' + b;
    const prev = lib.comics[key] || {};
    const tags = (prev.tags || []).slice();
    if (tags.indexOf(plat) < 0) tags.push(plat);        // 自动打上平台标签
    // 站点的 tag: 适配器给的(如 E-Hentai 画廊标签) + 章节标题里的 #话题
    const autoTags = [];
    ((meta && meta.tags) || []).forEach((t) => { const s = String(t || '').trim(); if (s && autoTags.indexOf(s) < 0) autoTags.push(s); });
    for (const it2 of todo) {
      const mm2 = String(it2.label || '').match(/#[^\s#]{2,30}/g) || [];
      mm2.forEach((x) => { const s2 = x.slice(1).trim(); if (s2 && autoTags.indexOf(s2) < 0) autoTags.push(s2); });
    }
    const removedT = Array.isArray(prev.tagsRemoved) ? prev.tagsRemoved : [];   // 本地删掉的 tag 不再自动加回来
    for (const t3 of autoTags) { if (removedT.indexOf(t3) < 0 && tags.indexOf(t3) < 0) tags.push(t3); }
    let dedupTags = Array.from(new Set(tags));          // 完整去重
    if (dedupTags.length > 100) dedupTags = dedupTags.slice(0, 100);   // 上限 100
    const cats = Array.from(new Set((prev.categories || []).concat([plat])));  // categories 去重
    lib.comics[key] = Object.assign({ favorite: false, categories: [], tags: [], note: '' }, prev, {
      author: prev.author || meta.author || '',
      desc: prev.desc || (meta.desc || ''),
      source: { site: adapter.id, url: url },
      tags: dedupTags,
      categories: cats,
    });
    fs.mkdirSync(path.join(LIB, CAT, b), { recursive: true });
  }
  if (!Array.isArray(lib.categories)) lib.categories = [];
  if (lib.categories.indexOf(plat) < 0) lib.categories.push(plat);   // 分类栏里补上这个平台
  // 原子写: 先 .tmp 再 rename(崩溃不会损坏整库)
  const tmpF = libFile + '.tmp';
  fs.writeFileSync(tmpF, JSON.stringify(lib, null, 2), 'utf8');
  fs.renameSync(tmpF, libFile);
} catch (e) { say('写 library.json 失败: ' + e.message); }
// 只重建这一本(增量): 异步 spawn, 不阻塞下载进程; 完成后发 @@REBUILT@@
const rebuiltOk = await rebuildAsync(CAT + '/' + book);
say('@@REBUILT@@' + JSON.stringify({ ok: rebuiltOk }));
say('完成: 下载 ' + done + '/' + todo.length + ' 话');
  try { if (done === todo.length && typeof adapter.clearCache === 'function') adapter.clearCache(url); } catch (e3) {}   // 全部下完才清缓存
say('@@DONE@@' + JSON.stringify({ chapters: done, images: gotImages, bytes: gotBytes, out: path.join(LIB, CAT, book), book: book }));
if (skippedAll && !done && !gotImages) say('这本已经完整下过了，没有需要补的（已下过的话不会重下；要重下请加 --force 或按页勾选）。');
process.exit(done || gotImages || skippedAll ? 0 : 1);   // 一张都没下到且本来也没有 = 失败, 让上层能看出来
