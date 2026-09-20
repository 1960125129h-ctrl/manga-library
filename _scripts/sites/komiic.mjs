// Komiic (komiic.cc 中文站 / komiic.com) 适配器: GraphQL API + 图片票据(X-Image-Ticket)
// 链路: comicById -> chaptersByComicId -> imagesByChapterId -> getImageTicket -> GET url (带 X-Image-Ticket 头)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookiesFor } from './cookies.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
// 登录态: node _scripts\jm\site-login.mjs komiic.cc 抓下来, 存 sites/cookies/komiic.cc.txt
// 有它就用账号配额(高), 没有就匿名(300 张/天)。旧文件 komiic-cookies.txt 也兼容。
function cookies() {
  const ck = cookiesFor('komiic.cc');
  if (ck) return ck;
  try { return fs.readFileSync(path.join(HERE, 'komiic-cookies.txt'), 'utf8').trim(); } catch (e) { return ''; }
}
const HOSTS = ['https://komiic.cc', 'https://komiic.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
export const id = 'komiic';
export const label = 'Komiic';
export const home = 'https://komiic.cc/';
export function match(url) { return /komiic\.(cc|com)/i.test(String(url || '')); }
export function comicId(url) {
  const s = String(url || '').trim();
  const m = s.match(/\/comic\/(\d+)/);
  if (m) return m[1];
  return /^\d+$/.test(s) ? s : '';
}
let WORKING = '';
async function gqlRaw(query, vars) {   // 不改写错误: 让调用方看到 GraphQL 的 errors
  const list = WORKING ? [WORKING].concat(HOSTS.filter((h) => h !== WORKING)) : HOSTS;
  let lastErr = null;
  for (const host of list) {
    try {
      const ck = cookies();
      const r = await fetch(host + '/api/query', {
        method: 'POST',
        headers: Object.assign({ 'User-Agent': UA, 'Content-Type': 'application/json', 'Referer': host + '/', 'Origin': host }, ck ? { Cookie: ck } : {}),
        body: JSON.stringify({ query: query, variables: vars || {} })
      });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status + ' @' + host); continue; }
      const j = await r.json();
      WORKING = host;
      return j;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('komiic 请求失败');
}
async function gql(query, vars) {
  const list = WORKING ? [WORKING].concat(HOSTS.filter((h) => h !== WORKING)) : HOSTS;
  let lastErr = null;
  for (const host of list) {
    try {
      const r = await fetch(host + '/api/query', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Referer': host + '/', 'Origin': host },
        body: JSON.stringify({ query: query, variables: vars || {} })
      });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status + ' @' + host); continue; }
      const j = await r.json();
      if (j.errors && j.errors.length) { lastErr = new Error(j.errors[0].message); continue; }
      WORKING = host;
      return j.data || {};
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('komiic 请求失败');
}
/* 站内搜索: 给"跨站搜索"面板用(adult=false 只搜非成人) */
export async function search(kw, page) {
  const p = Math.max(1, parseInt(page || 1, 10) || 1);
  const q = 'query($k:String!,$o:Int!){ searchComics(keyword:$k, pagination:{limit:20, offset:$o, orderBy:COMIC_DATE_UPDATED, asc:false}){ id title imageUrl status authors{name} } }';
  const j = await gql(q, { k: String(kw || ''), o: (p - 1) * 20 });
  const list = (j && j.searchComics) || [];   // gql() 已经返回 data 本身
  return list.map((x) => ({
    title: String(x.title || ''),
    author: (x.authors || []).map((a) => a.name).filter(Boolean).join(' / '),
    url: 'https://komiic.cc/comic/' + x.id,
    cover: String(x.imageUrl || ''),
    extra: String(x.status || ''),
  }));
}
export async function resolve(url) {
  const cid = comicId(url);
  if (!cid) throw new Error('链接里没有 comic id');
  const d = await gql('query($id:ID!){ comicById(comicId:$id){ id title status year imageUrl authors { name } categories { name } } }', { id: cid });
  const c = d.comicById || {};
  return {
    title: c.title || null,
    desc: null,
    cover: c.imageUrl || null,
    author: (c.authors || []).map((x) => x.name).join(' / '),
    status: c.status || ''
  };
}
export async function chapters(url) {
  const cid = comicId(url);
  if (!cid) throw new Error('链接里没有 comic id');
  const d = await gql('query($id:ID!){ chaptersByComicId(comicId:$id){ id serial } }', { id: cid });
  const list = (d.chaptersByComicId || []).map((c) => ({
    id: String(c.id),
    title: '第' + String(c.serial || '').padStart(2, '0') + '话',
    serial: String(c.serial || ''),
    order: parseInt(c.serial, 10) || 0,
    url: home + 'comic/' + cid + '/chapter/' + c.id + '/images/all',
    comicId: cid
  }));
  list.sort((a, b) => a.order - b.order);
  list.forEach((c, i) => { c.index = i + 1; });
  return list;
}
async function ticket(kid) {   // 取一张图的票据; 配额用完这种是"整轮都别下了", 标 fatal 让上层直接停
  let r;
  try { r = await gqlRaw('query($kid:String!){ getImageTicket(kid:$kid){ url ticket } }', { kid: kid }); }
  catch (e) { const err = new Error('取图失败: ' + (e && e.message)); err.fatal = false; throw err; }
  if (r.errors && r.errors.length) {
    const msg = String(r.errors[0].message || '');
    const err = new Error('Komiic: ' + msg + (r.errors[0].extensions && r.errors[0].extensions.limit ? '（' + r.errors[0].extensions.current + '/' + r.errors[0].extensions.limit + '，登录后配额更高）' : ''));
    err.fatal = /quota|limit|unauthor|forbidden/i.test(msg);
    throw err;
  }
  return r.data && r.data.getImageTicket;
}
export async function images(chapter) {
  const chid = String(chapter.id);
  const d = await gql('query($cid:ID!){ imagesByChapterId(chapterId:$cid){ kid width height orderNumber } }', { cid: chid });
  const imgs = (d.imagesByChapterId || []).slice().sort((a, b) => (a.orderNumber || 0) - (b.orderNumber || 0));
  const out = [];
  for (const im of imgs) {   // 每张图要单独换一张票
    const tk = await ticket(im.kid);          // 配额/权限类错误直接抛出去(带 fatal), 不再静默跳过
    if (tk && tk.url && tk.ticket) {
      const h = { 'X-Image-Ticket': tk.ticket };
      const ck = cookies(); if (ck) h.Cookie = ck;
      out.push({ url: tk.url, headers: h });
    }
  }
  return out;
}
