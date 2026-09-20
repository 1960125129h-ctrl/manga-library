// nhentai 适配器: 用 v2 API(老接口已下线) + i.nhentai.net 直链
// 直连会被 403(Cloudflare), 所以走 site-login 抓下来的 cookie: node _scripts\jm\site-login.mjs nhentai.net
import { cookieHeader, cookiesFor } from './cookies.mjs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
export const id = 'nhentai';
export const label = 'nhentai';
export const home = 'https://nhentai.net/';
export function match(url) { return /nhentai\.net/i.test(String(url || '')); }
export function galleryId(url) {
  const s = String(url || '').trim();
  const m = s.match(/\/g\/(\d+)/);
  if (m) return m[1];
  return /^\d+$/.test(s) ? s : '';
}
async function api(path) {
  const r = await fetch('https://nhentai.net' + path, {
    headers: Object.assign({ 'User-Agent': UA, 'Referer': 'https://nhentai.net/', Accept: 'application/json' }, cookieHeader('nhentai.net'))
  });
  if (!r.ok) throw new Error('nhentai HTTP ' + r.status + (r.status === 403 ? '（先跑 node _scripts\\jm\\site-login.mjs nhentai.net 抓 cookie）' : ''));
  return await r.json();
}
const titleOf = (j) => (j.title && (j.title.english || j.title.japanese || j.title.pretty)) || ('nhentai ' + j.id);
const artistsOf = (j) => (j.tags || []).filter((t) => t.type === 'artist').map((t) => t.name).join(' / ');
const extOf = (t) => (t === 'p' ? 'png' : t === 'g' ? 'gif' : t === 'w' ? 'webp' : 'jpg');
export async function resolve(url) {
  const gid = galleryId(url);
  if (!gid) throw new Error('链接里没有 gallery id（形如 https://nhentai.net/g/123456/）');
  const j = await api('/api/v2/galleries/' + gid);
  return {
    title: titleOf(j),
    desc: [ ((j.tags || []).filter((t) => t.type === 'parody').map((t) => t.name).join(' / ')), ((j.tags || []).filter((t) => t.type === 'group').map((t) => t.name).join(' / ')) ].filter(Boolean).join('　'),
    cover: 'https://t.nhentai.net/galleries/' + j.media_id + '/cover.' + (j.images && j.images.cover ? extOf(j.images.cover.t) : 'jpg'),
    author: artistsOf(j),
    status: String(j.num_pages || 0) + ' 页'
  };
}
export async function chapters(url) {
  const gid = galleryId(url);
  const j = await api('/api/v2/galleries/' + gid);
  return [{ id: gid, title: titleOf(j), index: 1, order: 1, media_id: j.media_id, pages: j.num_pages, images: j.images }];
}
// 页清单: v2 API 直接给每页的 path / thumbnail(200px), 不用再去探 CDN 节点
// 返回 [{ n, url, thumb, headers }]  n 是 1-based 页号
export async function pageList(gid) {
  const j = await api('/api/v2/galleries/' + gid);
  const mid = j.media_id;
  const ck = cookiesFor('nhentai.net');
  const hd = ck ? { 'Referer': 'https://nhentai.net/', 'Cookie': ck } : { 'Referer': 'https://nhentai.net/' };
  const pages = Array.isArray(j.pages) ? j.pages : [];
  return pages.map(function (p, i) {
    const n = p.number || (i + 1);
    const full = String(p.path || '').indexOf('galleries/') === 0 ? ('https://i1.nhentai.net/' + p.path) : '';
    const th = String(p.thumbnail || '').indexOf('galleries/') === 0 ? ('https://t.nhentai.net/' + p.thumbnail) : '';
    return { n: n, url: full, thumb: th, w: p.width || 0, h: p.height || 0, headers: hd };
  });
}
export async function search(kw, page) {
  const p = Math.max(1, parseInt(page || 1, 10) || 1);
  const j = await api('/api/v2/galleries?query=' + encodeURIComponent(String(kw || '')) + '&page=' + p);
  return (j.result || []).map((g) => ({
    title: titleOf(g),
    author: (g.tags || []).filter((t) => t.type === 'artist').map((t) => t.name).join(' / '),
    url: 'https://nhentai.net/g/' + g.id + '/',
    cover: g.thumb && g.thumb.t ? ('https://t.nhentai.net/galleries/' + g.media_id + '/cover.' + extOf(g.thumb.t)) : '',
    extra: String(g.num_pages || 0) + ' 页',
  }));
}
export async function images(chapter) {
  const gid = chapter.id;
  const ck = cookiesFor('nhentai.net');
  const hd = ck ? { 'Referer': 'https://nhentai.net/', 'Cookie': ck } : { 'Referer': 'https://nhentai.net/' };

  let mid = chapter.media_id;
  let pages = null;

  // 首选: v2 API 的 pages(每页带 number 和 path) —— 直连可用, 不需要再探 CDN
  // 注意: chapters() 里的 pages 是「页数」数字, 页清单挂在 pageUrls 上, 别用 Array.isArray(pages) 判断
  if (Array.isArray(chapter.pageUrls) && chapter.pageUrls.length) {
    const out2 = [];
    chapter.pageUrls.forEach(function (p, i) {
      const n = p.number || p.n || (i + 1);
      // 页清单可能是 pageList() 的 {n,url} 或 {number,path} 两种形状, 都吃
      let full = String(p.url || '');
      if (!/^https?:/i.test(full)) {
        const rel = String(p.path || p.url || '');
        if (rel.indexOf('galleries/') !== 0) return;
        full = 'https://i1.nhentai.net/' + rel;
      }
      out2.push({ url: full, pageNum: n, headers: hd });
    });
    if (out2.length) return out2;
  }

  // 先试 fetch 主页面拿 gallery JSON(可能被 Cloudflare 403, 失败就 fallback)
  try {
    const r = await fetch('https://nhentai.net/g/' + gid + '/', {
      headers: Object.assign({ 'User-Agent': UA, 'Referer': 'https://nhentai.net/' }, hd)
    });
    if (r.ok) {
      const html = await r.text();
      const gm = html.match(/gallery\s*=\s*(\{[\s\S]+?\})\s*;\s*</);
      if (gm) {
        try {
          const g = JSON.parse(gm[1]);
          mid = g.media_id || mid;
          if (g.images && Array.isArray(g.images.pages)) pages = g.images.pages;
        } catch (e) {}
      }
    }
  } catch (e) {}

  // 如果没有 pages 数组(API v2 已废弃), 自动探测 CDN 节点和扩展名
  // 试 i1/i2/i3/i4 × webp/jpg/png, 第一个 HEAD 200 的就用
  let cdn = 'https://i1.nhentai.net', ext = 'webp';
  if (!pages || !pages.length) {
    outer:
    for (const n of [1, 2, 3, 4]) {
      for (const e of ['webp', 'jpg', 'png']) {
        try {
          const testUrl = 'https://i' + n + '.nhentai.net/galleries/' + mid + '/1.' + e;
          const r = await fetch(testUrl, { headers: hd, method: 'HEAD' });
          if (r.ok) {
            cdn = 'https://i' + n + '.nhentai.net';
            ext = e;
            break outer;
          }
        } catch (e) {}
      }
    }
  }

  const out = [];
  if (Array.isArray(pages) && pages.length) {
    pages.forEach((p, i) => out.push({ url: cdn + '/galleries/' + mid + '/' + (i + 1) + '.' + extOf(p && p.t), headers: hd }));
  } else {
    for (let i = 1; i <= (chapter.pages || 0); i++) out.push({ url: cdn + '/galleries/' + mid + '/' + i + '.' + ext, headers: hd });
  }
  return out;
}
