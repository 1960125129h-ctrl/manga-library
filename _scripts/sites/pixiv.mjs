// Pixiv 适配器: 公开作品不需要登录, 只要请求时带 Referer: https://www.pixiv.net/
// R-18 / 关注限定 / 收藏夹 需要登录态 -> node _scripts\jm\site-login.mjs pixiv.net
// 支持: https://www.pixiv.net/artworks/<id>  (一个作品 = 一话, 多页自动展开)
//       https://www.pixiv.net/users/<uid>    (一位作者 = 一本书, 作品按顺序当话)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookieHeader } from './cookies.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
export const id = 'pixiv';
export const label = 'Pixiv';
export const home = 'https://www.pixiv.net/';
export function match(url) { return /pixiv\.net/i.test(String(url || '')); }
let LAST_CALL = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {   // pixiv 对接口调用有频率限制, 每次调用之间留 400ms(作者页批量补封面时用稳定性换速度)
  const wait = LAST_CALL + 400 - Date.now();
  if (wait > 0) await sleep(wait);
  LAST_CALL = Date.now();
}
const CACHE_FILE = path.join(HERE, 'cache-pixiv.json');
function readCache() { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function writeCache(o) { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(o), 'utf8'); } catch (e) {} }
export async function ajax(path, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    await throttle();
    let r = null;
    try {
      r = await fetch('https://www.pixiv.net' + path, {
        headers: Object.assign({ 'User-Agent': UA, 'Referer': 'https://www.pixiv.net/', 'Accept': 'application/json' }, cookieHeader('pixiv.net'))
      });
    } catch (e) {
      if (i === n - 1) throw new Error('pixiv 网络失败: ' + String(e.message));
      await sleep(1500 * (i + 1));
      continue;
    }
    if (r.status === 429) {   // 限流: 退避重试, 实在不行就明确说"等会儿再来", 不要连撞 20 次
      const ra = parseInt(r.headers.get('retry-after') || '0', 10);
      if (i === n - 1) {
        const err = new Error('pixiv 限流(429)：正在按退避续跑，已缓存的会自动跳过');
        err.fatal = true;
        err.retryAfter = ra ? Math.min(ra * 1000, 30000) : 30000;
        throw err;
      }
      await sleep(ra ? Math.min(ra * 1000, 30000) : 4000 * (i + 1));
      continue;
    }
    if (!r.ok) throw new Error('pixiv HTTP ' + r.status + ' (' + path + ')' + (r.status === 403 ? ' 可能要登录: 先跑 site-login.mjs pixiv.net' : ''));
    const j = await r.json();
    if (j.error) throw new Error('pixiv: ' + (j.message || 'error'));
    return j.body;
  }
}
export function ids(url) {
  const s = String(url || '');
  const a = s.match(/artworks\/(\d+)/);
  const u = s.match(/users\/(\d+)/);
  return { illust: a ? a[1] : '', user: u ? u[1] : '' };
}
export async function resolve(url) {
  const { illust, user } = ids(url);
  if (illust) {
    const b = await fetchIllust(illust);   // 共用缓存, 同进程只查一次
    return { title: b.illustTitle || ('pixiv ' + illust), desc: (b.illustComment || '').replace(/<[^>]+>/g, ' ').trim(), cover: (b.urls && (b.urls.thumb || b.urls.small)) || null, author: b.userName || '', status: String(b.pageCount || 0) + ' 张' };
  }
  if (user) {
    const b = await ajax('/ajax/user/' + user + '?full=1');
    return { title: (b.name || ('pixiv用户' + user)) + ' 作品集', desc: b.comment || '', cover: b.image || null, author: b.name || '', status: '' };
  }
  throw new Error('这个 pixiv 链接看不懂（支持 /artworks/<id> 和 /users/<uid>）');
}
function worksOf(all, cap) {
  const out = [];
  const push = (v, kind) => {   // pixiv: illusts 是 { "12345": {createDate:...}, ... } 对象
    if (!v) return;
    const items = Array.isArray(v) ? v : Object.keys(v).map((k) => ({ id: k, createDate: (v[k] && v[k].createDate) || '' }));
    items.forEach((x) => { if (x) out.push({ id: String(x.id || x), kind: kind, ts: Date.parse(x.createDate || 0) || 0 }); });
  };
  push(all.illusts || all.illust, 'illust');
  push(all.manga, 'manga');
  out.sort((a, b) => b.ts - a.ts);   // 新到旧
  return out.slice(0, cap || 500);
}
export async function chapters(url) {
  const { illust, user } = ids(url);
  if (illust) {
    const b = await fetchIllust(illust);   // 共用缓存, 同进程只查一次
    return [{ id: illust, title: b.illustTitle || ('pixiv ' + illust), index: 1, order: 1, kind: 'illust' }];
  }
  if (!user) throw new Error('这个 pixiv 链接看不懂');
  const all = await ajax('/ajax/user/' + user + '/profile/all');
  const works = worksOf(all, 1000);   // 上限 1000 话, 防止离谱作者把接口刷爆
  const list = works.map((w) => ({ id: w.id, title: 'pixiv ' + w.id, index: 0, order: w.ts, kind: 'illust' }));
  for (const c of list) { const cc = cachedWork(c.id); if (cc && cc.title) c.title = cc.title; }
  const todo = list.filter((c) => { const cc = cachedWork(c.id); return !(cc && cc.title && cc.thumb); });   // 标题+封面都完整才跳过, 避免预览页再为封面重复请求
  let next = 0;
  const worker = async () => {   // 只取没缓存完整的; 接口限流靠 ajax() 里的节流+退避
    while (next < todo.length) {
      const c = todo[next++];
      try {
        const b = await ajax('/ajax/illust/' + c.id, 4);
        const title = b.illustTitle || c.title || '';
        const thumb = (b.urls && (b.urls.small || b.urls.thumb)) || '';
        if (title) c.title = title;
        rememberWork(c.id, title, thumb);
      } catch (e) { if (e && e.fatal) throw e; }
    }
  };
  try { await Promise.all([worker(), worker()]); } finally { }
  list.forEach((c, i) => { c.index = i + 1; });
  return list;
}
// 页清单(给"下载前预览"用): 用 /ajax/illust/<id>/pages 拿每页的小图, 便宜(不下载大图)
// 返回 [{ n, url(原图), thumb(小图), headers }]; 小图在 i.pximg.net, 需要 Referer: https://www.pixiv.net/
// (主进程按 pageUrl 自动推 Referer, 这里把 headers 带上只是给下载链路兜底)
// 作品信息缓存: 标题 + 缩略图都存(同一个作者二次打开就不用再打接口, 也避开 pixiv 限流)
export function cachedWork(id) {
  const c = readCache()[String(id)];
  if (!c) return null;
  if (typeof c === 'string') return { title: c, thumb: '' };   // 老格式: 只存了标题
  return { title: c.t || '', thumb: c.u || '' };
}
export function rememberWork(id, title, thumb) {
  const c = readCache();
  c[String(id)] = { t: String(title || ''), u: String(thumb || '') };
  const keys = Object.keys(c);
  if (keys.length > 4000) { for (const k of keys.slice(0, keys.length - 4000)) delete c[k]; }   // 别无限涨
  writeCache(c);
}

// ── 提速 1: 同一个作品只查一次接口(resolve / chapters / pageList 共用), 省掉重复的 260ms ──
const illustMem = new Map();
async function fetchIllust(id) {
  const k = String(id);
  if (illustMem.has(k)) return illustMem.get(k);
  const b = await ajax('/ajax/illust/' + k);
  illustMem.set(k, b);
  if (illustMem.size > 60) illustMem.delete(illustMem.keys().next().value);
  return b;
}
// ── 提速 2: 作品的页清单落盘缓存(单作品的页地址基本不变), 同一本二次打开零请求 ──
const PAGES_FILE = path.join(HERE, 'cache-pixiv-pages.json');
const PAGES_TTL = 7 * 86400000;
function readPagesCache() { try { return JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function writePagesCache(o) { try { fs.writeFileSync(PAGES_FILE, JSON.stringify(o), 'utf8'); } catch (e) {} }

// 页清单(给"下载前预览"用): 每页一张小图; 优先 128px 的 thumb_mini(每张约 10KB, 格子里显示正好)
// 返回 [{ n, url(原图, 下载用), thumb(小图), headers }]
export async function pageList(urlOrId) {
  const s = String(urlOrId || '');
  const { illust: iid } = ids(s);
  const wid = iid || s.trim();
  if (!/^[0-9]+$/.test(wid)) throw new Error('拿不到作品 id: ' + s.slice(0, 60));
  const pc = readPagesCache();
  const hit = pc[wid];
  if (hit && Array.isArray(hit.pages) && hit.pages.length && (Date.now() - (hit.at || 0)) < PAGES_TTL) return hit.pages;
  const b = await fetchIllust(wid);
  const n = parseInt(b.pageCount || 1, 10) || 1;
  let pages = [];
  if (n > 1) {
    try {
      const p = await ajax('/ajax/illust/' + wid + '/pages');
      if (Array.isArray(p)) pages = p;
    } catch (e) { if (e && e.fatal) throw e; }
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = (pages[i] && pages[i].urls) || (i === 0 ? b.urls : null) || {};
    const thumb = u.thumb_mini || u.small || u.thumb || u.regular || '';
    const full = u.original || u.regular || '';
    if (!thumb && !full) continue;
    out.push({ n: i + 1, url: full, thumb: thumb, headers: { Referer: 'https://www.pixiv.net/' } });
  }
  if (out.length) {
    pc[wid] = { at: Date.now(), pages: out };
    const keys = Object.keys(pc);
    if (keys.length > 300) { for (const k of keys.slice(0, keys.length - 300)) delete pc[k]; }
    writePagesCache(pc);
  }
  return out;
}

export async function images(chapter) {
  const wid = String(chapter.id);
  const b = await ajax('/ajax/illust/' + wid);
  const out = [];
  const push = (u) => { if (u) out.push({ url: u, headers: { 'Referer': 'https://www.pixiv.net/' } }); };
  const orig = (b.urls && b.urls.original) || '';
  const n = b.pageCount || 1;
  if (n <= 1) { push(orig); return out; }
  try {
    const pages = await ajax('/ajax/illust/' + wid + '/pages');
    const arr = Array.isArray(pages) ? pages : ((pages && pages.body) || []);
    arr.forEach((q) => push(q.urls && q.urls.original));
    if (out.length) return out;   // 这条最准, 拿得到就用它
  } catch (e) { /* 有的作品 /pages 会 404(要登录或被限制): 退回按 _pN 拼原图地址 */ }
  if (!orig && (b.xRestrict === 1 || b.xRestrict === 2)) {
    const err = new Error('这本是 R-18（xRestrict=' + b.xRestrict + '），匿名拿不到原图地址：先在调试浏览器登录 pixiv，再跑 node _scripts\\jm\\site-login.mjs pixiv.net');
    err.fatal = true;
    throw err;
  }
  if (orig && /_p\d+\.[a-z]+$/i.test(orig)) {
    for (let i = 0; i < n; i++) push(orig.replace(/_p\d+(\.[a-z]+)$/i, '_p' + i + '$1'));
  } else push(orig);
  return out;
}
export async function search(kw, page) {
  const p = Math.max(1, parseInt(page || 1, 10) || 1);
  const b = await ajax('/ajax/search/artworks/' + encodeURIComponent(String(kw || '')) + '?p=' + p + '&s_mode=s_tag&order=date_d&type=all');
  const items = (b && b.illusts) || [];
  return items.map((g) => ({
    title: String(g.illustTitle || g.title || ('pixiv ' + g.id)),
    author: '',
    url: 'https://www.pixiv.net/artworks/' + g.id,
    cover: g.urls && g.urls.thumb ? g.urls.thumb : '',
    extra: String(g.pageCount || 0) + ' 张',
  }));
}
