// 再漫画 (manhua.zaimanhua.com) 适配器: 纯 HTTP API, 不用浏览器
const API = 'https://manhua.zaimanhua.com/api/v1/comic2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Referer': 'https://manhua.zaimanhua.com/', 'Accept': 'application/json, text/plain, */*' };
const Q = 'channel=pc&app_name=zmh&version=1.0.0&uid=0';
export const id = 'zaimanhua';
export const label = '再漫画';
export function match(url) { return /zaimanhua\.com/i.test(String(url || '')); }
export function comicId(url) { const m = String(url).match(/(?:details|view)\/(?:[^/]+\/)?(\d+)/); return m ? m[1] : ''; }
async function api(path, params) {
  const r = await fetch(API + path + '?' + Q + '&timestamp=' + Date.now() + '&' + params, { headers: H });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.data || {};
}
/* 站内搜索: 给"跨站搜索"面板用 */
export async function search(kw, page) {
  const p = Math.max(1, parseInt(page || 1, 10) || 1);
  const d = await api('/search', 'keyword=' + encodeURIComponent(String(kw || '')) + '&page=' + p + '&size=20');
  const list = (d && d.comicList) || [];
  return list.map((x) => ({
    title: String(x.name || ''),
    author: Array.isArray(x.authors) ? x.authors.map((a) => a.name || a).filter(Boolean).join(' / ') : String(x.authors || ''),
    url: 'https://manhua.zaimanhua.com/details/' + x.id,
    cover: String(x.cover || ''),
    extra: [x.status, x.last_update_chapter_name].filter(Boolean).join(' · '),
  }));
}
export async function resolve(url) {
  const d = await api('/comic/detail', 'id=' + comicId(url));
  const ci = d.comicInfo || {};
  return {
    title: ci.title || null,
    desc: ci.description || null,
    cover: ci.cover || null,
    author: (ci.authorsTagList || []).map((x) => x.tagName).join(' / '),
    status: (ci.statusTagList || []).map((x) => x.tagName).join(''),
  };
}
export async function chapters(url) {
  const cid = comicId(url);
  const d = await api('/comic/detail', 'id=' + cid);
  const ci = d.comicInfo || {};
  const py = ci.comicPy || '';
  const list = [];
  // 每组自带组名(连载 / 单行本 / 番外篇 / 其他系列), 章节自带真实标题 —— 都带上给上层决定怎么分书、怎么命名
  for (const grp of (ci.chapterList || [])) for (const c of (grp.data || [])) {
    list.push({ id: String(c.chapter_id), title: c.chapter_title || '', group: grp.title || '', order: c.chapter_order || 0, url: 'https://manhua.zaimanhua.com/view/' + py + '/' + cid + '/' + c.chapter_id });
  }
  list.sort((a, b) => a.order - b.order);
  list.forEach((c, i) => { c.index = i + 1; });
  return list;
}
export async function images(chapter) {
  const m = String(chapter.url || '').match(/\/view\/([^/]+)\/(\d+)\/(\d+)/);
  const cid = m ? m[2] : '';
  const chid = m ? m[3] : String(chapter.id);
  const d = await api('/chapter/detail', 'comic_id=' + cid + '&chapter_id=' + chid);
  const ci = d.chapterInfo || {};
  const arr = ci.page_url || ci.image_list || ci.images || ci.pageUrl || ci.chapterImages || [];
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => (typeof x === 'string' ? x : (x.url || x.page_url || x.image_url || ''))).filter(Boolean);
}