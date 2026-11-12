// 再漫画 (manhua.zaimanhua.com) 适配器: 纯 HTTP API, 不用浏览器
// 登录态: node _scripts\jm\site-login.mjs manhua.zaimanhua.com --wait
// 存到 _scripts\sites\cookies\manhua.zaimanhua.com.txt
import { cookieHeader, cookiesFor } from './cookies.mjs';
const API = 'https://manhua.zaimanhua.com/api/v1/comic2';
const HOST = 'manhua.zaimanhua.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Referer': 'https://manhua.zaimanhua.com/', 'Accept': 'application/json, text/plain, */*' };
const Q = 'channel=pc&app_name=zmh&version=1.0.0&uid=0';   // uid=0 是游客；登录态走 cookie
export const id = 'zaimanhua';
export const label = '再漫画';
export function match(url) { return /zaimanhua\.com/i.test(String(url || '')); }
export function comicId(url) { const m = String(url).match(/(?:details|view)\/(?:[^/]+\/)?(\d+)/); return m ? m[1] : ''; }
// 登录态：再漫画认的是 Authorization: Bearer <token>，不是 Cookie。
// cookie 文件里存着 token（由 site-login.mjs 抓的），这里取出来塞进请求头。
// 不加这个头的话，/comic/detail 会返回 canRead:false + 空 chapterList，
// 上层就报「站点没给章节表（共 0 话）」——付费/受限作品尤其明显。
function authHeader() {
  try {
    const raw = cookiesFor(HOST) || cookieHeader(HOST).Cookie || '';
    const m = String(raw).match(/(?:^|;\s*)token=([^;]+)/);
    if (m) return { Authorization: 'Bearer ' + decodeURIComponent(m[1]) };
  } catch (e) {}
  return {};
}
async function api(path, params) {
  const hd = Object.assign({}, H, cookieHeader(HOST), authHeader());
  const r = await fetch(API + path + '?' + Q + '&timestamp=' + Date.now() + '&' + params, { headers: hd });
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
// 有些书（如《孤独摇滚》）API 的 chapterList 是空的，章节只在页面客户端渲染后才出现。
// 这时回退到调试浏览器抓 DOM 里的 /view/ 链接。
async function chaptersByBrowser(cid, bookTitle) {
  try {
    const { openPage, sleep } = await import('../jm/cdp.mjs');
    const p = await openPage(9333);
    const target = 'https://manhua.zaimanhua.com/details/' + cid;
    await p.send('Page.navigate', { url: target });
    await sleep(7000);
    // 校验：页面真的停在目标书上，别抓成浏览器里残留的别的标签
    const cur = await p.ev('location.href');
    if (String(cur).indexOf('/details/' + cid) < 0) return [];
    const raw = await p.ev('JSON.stringify(Array.prototype.slice.call(document.querySelectorAll("a[href*=view]")).map(function(a){return {t:a.textContent.trim(),h:a.getAttribute("href")}}))');
    const arr = JSON.parse(raw);
    const out = [], seen = new Set();
    for (const x of arr) {
      const mm = String(x.h || '').match(/\/view\/([^/]+)\/(\d+)\/(\d+)/);
      if (!mm) continue;
      if (mm[2] !== String(cid)) continue;            // 只认这本书的 id
      if (seen.has(mm[3])) continue;
      const nm = String(x.t || '').trim();
      if (!nm || /^(继续阅读|上一话|下一话|上一章|下一章|返回|目录)/.test(nm)) continue;
      seen.add(mm[3]);
      out.push({ id: mm[3], title: nm, group: '', order: 0, url: 'https://manhua.zaimanhua.com' + x.h, book: bookTitle });
    }
    return out;
  } catch (e) { return []; }
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
  if (!list.length) {
    // API 没给章节 -> 走浏览器抓 DOM
    const viaDom = await chaptersByBrowser(cid, ci.title || '');
    // DOM 里的顺序是「最新在前」，反转成正常顺序
    viaDom.reverse();
    viaDom.forEach((c, i) => { c.index = i + 1; c.order = i + 1; });
    return viaDom;
  }
  return list;
}
// 图片地址是规律拼接的：https://images.zaimanhua.com/g%2F{漫画名}%2F{话名}%2F{页号}.jpg
// 老的 /chapter/detail 接口对这类书返回 errno=4（已废），只能靠拼。
// 页数是逐页探到 404 为止（先连续 3 个 404 才停，容忍中间缺页）。
async function probeImages(book, chapter) {
  const title = String(book || chapter.book || '').trim();
  const chName = String(chapter.title || '').trim();
  if (!title || !chName) return [];
  const nameVariants = Array.from(new Set([chName, chName.replace(/話/g, '话'), chName.replace(/话/g, '話')]));
  const bookVariants = Array.from(new Set([title, title.replace(/\s+/g, '')]));
  const H = { 'User-Agent': UA, Referer: 'https://manhua.zaimanhua.com/', Accept: 'image/*' };
  const prefixes = [];
  for (const bv of bookVariants) for (const cv of nameVariants) {
    prefixes.push('https://images.zaimanhua.com/g%2F' + encodeURIComponent(bv) + '%2F' + encodeURIComponent(cv) + '%2F');
  }
  // 页号命名两种：`2.jpg` / `02.jpg`。逐前缀试 4 种组合（1 / 01 / 2 / 02）确定用哪种。
  let prefix = '', pad = false;
  outer:
  for (const pf of prefixes) {
    for (const [nm, isPad] of [['1.jpg', false], ['01.jpg', true], ['2.jpg', false], ['02.jpg', true]]) {
      try {
        const r = await fetch(pf + nm, { headers: H });
        if (r.ok) { prefix = pf; pad = isPad; break outer; }
      } catch (e) {}
    }
  }
  if (!prefix) return [];

  const found = [];
  let miss = 0;
  for (let n = 1; n <= 60 && miss < 4; n += 6) {
    const batch = [];
    for (let k = 0; k < 6 && n + k <= 60; k++) {
      const idx = n + k;
      batch.push((async () => {
        const nm = pad ? String(idx).padStart(2, '0') + '.jpg' : String(idx) + '.jpg';
        try { const r = await fetch(prefix + nm, { headers: H }); return r.ok ? { idx, url: prefix + nm } : null; } catch (e) { return null; }
      })());
    }
    const res = await Promise.all(batch);
    for (const x of res) { if (x) { found.push(x); miss = 0; } else miss++; }
  }
  found.sort((a, b) => a.idx - b.idx);
  return found.map(x => x.url);
}

export async function images(chapter) {
  const m = String(chapter.url || '').match(/\/view\/([^/]+)\/(\d+)\/(\d+)/);
  const cid = m ? m[2] : '';
  const chid = m ? m[3] : String(chapter.id);
  try {
    const d = await api('/chapter/detail', 'comic_id=' + cid + '&chapter_id=' + chid);
    const ci = d.chapterInfo || {};
    const arr = ci.page_url || ci.image_list || ci.images || ci.pageUrl || ci.chapterImages || [];
    if (Array.isArray(arr) && arr.length) {
      const list = arr.map((x) => (typeof x === 'string' ? x : (x.url || x.page_url || x.image_url || ''))).filter(Boolean);
      if (list.length) return list;
    }
  } catch (e) {}
  // 接口没给 -> 拼地址探测
  return probeImages(chapter.book, chapter);
}