// X (Twitter) 适配器 —— 一个人 = 一本书(图包); 单条推文链接也归到这个人的图包里, 不另开新书。
// 枚举: 调试浏览器打开主页, 注入捕获器直接读页面自己发的 /i/api/graphql/ 响应(不滚到底也能拿全, 比死等滚动快得多)
// 归属: 只要作者自己发的、带图片的推文(转推别人的不算); 视频推文跳过。
// 【硬规则】X 必须保存**原图**: 一律拼 ?name=orig(见 origUrl), 不许存缩略图。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, sleep } from '../jm/cdp.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache-x.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const id = 'x';
export const label = 'X';
export const home = 'https://x.com/';
export function match(url) { return /(^|\.|\/\/)(x|twitter)\.com\//i.test(String(url || '') + '/'); }
export function handleOf(url) {
  const m = String(url || '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?=[\/?#]|$)/);
  return m ? m[1] : '';
}
export function statusOf(url) {
  const m = String(url || '').match(/\/status\/(\d+)/);
  return m ? m[1] : '';
}
/* ---------- 页面内: 抓 GraphQL 响应, 再从中还原"带图的原创推文" ---------- */
const HOOK = `(function(){
  window.__xcap = [];   // 抓到的 GraphQL 响应
  window.__xreq = [];   // 抓到的 GraphQL 请求模板(URL + 请求头), 用来在页内翻页
  function keep(u, j) { try { if (String(u).indexOf('/i/api/graphql/') >= 0) window.__xcap.push(j); } catch (e) {} }
  function note(u, h) { try { if (/Timeline/.test(String(u))) window.__xreq.push({ u: String(u), h: h || {} }); } catch (e) {} }
  var of = window.fetch;
  window.fetch = function (a, b) {
    var u = (a && a.url) || a;
    var h = (b && b.headers) || (a && a.headers) || {};
    var hh = {};
    try { if (typeof h.forEach === 'function') h.forEach(function (v, k) { hh[k] = v; }); else { for (var k in h) hh[k] = h[k]; } } catch (e) {}
    note(u, hh);
    var pr = of.apply(this, arguments);
    try { if (String(u).indexOf('/i/api/graphql/') >= 0) pr.then(function (r) { try { r.clone().json().then(function (j) { keep(u, j); }); } catch (e) {} }); } catch (e) {}
    return pr;
  };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send, sh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { this.__h[k] = v; } catch (e) {} return sh.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    note(self.__u, self.__h || {});
    this.addEventListener('load', function () { try { keep(self.__u, JSON.parse(self.responseText)); } catch (e) {} });
    return os.apply(this, arguments);
  };
})();`;
const READ = `(function(){
  var tweets = [];
  function walk(o, d) {
    if (!o || d > 18) return;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], d + 1); return; }
    if (typeof o !== 'object') return;
    if (o.legacy && (o.legacy.extended_entities || o.legacy.entities) && (o.rest_id || o.legacy.id_str)) tweets.push(o);
    for (var k in o) { if (k === 'legacy' || k === 'core' || k === 'note_tweet') continue; walk(o[k], d + 1); }
  }
  (window.__xcap || []).forEach(function (g) { walk(g, 0); });
  var seen = {}, out = [], who = '';
  tweets.forEach(function (t) {
    var id2 = String(t.rest_id || t.legacy.id_str);
    if (seen[id2]) return;
    seen[id2] = 1;
    if (t.legacy.retweeted_status_result) return;   // 转推别人的不算
    var L = t.legacy;
    var name = (t.core && t.core.user_results && t.core.user_results.result && t.core.user_results.result.legacy && t.core.user_results.result.legacy.screen_name)
      || (L.user && L.user.screen_name) || '';
    var disp = (t.core && t.core.user_results && t.core.user_results.result && (t.core.user_results.result.legacy && t.core.user_results.result.legacy.name || t.core.user_results.result.core && t.core.user_results.result.core.name)) || '';
    if (name && !who) who = name;
    var ent = L.extended_entities || L.entities || {};
    var media = ent.media || [];
    var pics = [];
    for (var i = 0; i < media.length; i++) { if (media[i].type === 'photo' && media[i].media_url_https) pics.push(media[i].media_url_https); }
    var txt = (t.note_tweet && t.note_tweet.note_tweet_results && t.note_tweet.note_tweet_results.result && t.note_tweet.note_tweet_results.result.text) || L.full_text || '';
    out.push({ id: id2, name: name, disp: disp, t: Date.parse(L.created_at || '') || 0, pics: pics, text: String(txt) });
  });
  out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
  return JSON.stringify({ url: location.href, title: document.title, who: who, items: out });
})()`;
/* 页内翻页取全: 拿页面自己发的 UserOriginalsTimeline 请求(带签名头), 换 cursor 反复请求,
   比"一直往下滚"快一个数量级(不滚了, 每页请求 0.3~0.8 秒) */
const PULL_ALL = `(async function () {
  function collect(list) {
    var tweets = [];
    function walk(o, d) {
      if (!o || d > 18) return;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], d + 1); return; }
      if (typeof o !== 'object') return;
      if (o.legacy && (o.legacy.extended_entities || o.legacy.entities) && (o.rest_id || o.legacy.id_str)) tweets.push(o);
      for (var k in o) { if (k === 'legacy' || k === 'core' || k === 'note_tweet') continue; walk(o[k], d + 1); }
    }
    (list || []).forEach(function (g) { walk(g, 0); });
    return tweets;
  }
  function bottomCursor() {   // 正经遍历 JSON 找 Bottom 游标(别用正则, 字段顺序不固定)
    var cur = '';
    (window.__xcap || []).forEach(function (g) {
      (function walk(o, d) {
        if (!o || d > 20) return;
        if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], d + 1); return; }
        if (typeof o !== 'object') return;
        if (o.cursorType === 'Bottom' && o.value) cur = String(o.value);
        for (var k in o) { if (k === 'value' || k === 'cursorType') continue; walk(o[k], d + 1); }
      })(g, 0);
    });
    return cur;
  }
  function pack(tweets) {
    var seen = {}, out = [], who = '';
    tweets.forEach(function (t) {
      var id2 = String(t.rest_id || t.legacy.id_str);
      if (seen[id2]) return;
      seen[id2] = 1;
      if (t.legacy.retweeted_status_result) return;
      var L = t.legacy;
      var ur = (t.core && t.core.user_results && t.core.user_results.result) || {};
      var name = (ur.legacy && ur.legacy.screen_name) || (L.user && L.user.screen_name) || '';
      var disp = (ur.legacy && ur.legacy.name) || (ur.core && ur.core.name) || '';
      if (name && !who) who = name;
      var ent = L.extended_entities || L.entities || {};
      var media = ent.media || [], pics = [];
      for (var i = 0; i < media.length; i++) if (media[i].type === 'photo' && media[i].media_url_https) pics.push(media[i].media_url_https);
      var txt = (t.note_tweet && t.note_tweet.note_tweet_results && t.note_tweet.note_tweet_results.result && t.note_tweet.note_tweet_results.result.text) || L.full_text || '';
      out.push({ id: id2, name: name, disp: disp, t: Date.parse(L.created_at || '') || 0, pics: pics, text: String(txt) });
    });
    out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    return { who: who, items: out };
  }
  var req = (window.__xreq || []).filter(function (r) { return /UserOriginalsTimeline|UserTweets|UserMedia/.test(r.u); })[0];
  var base = pack(collect(window.__xcap));
  if (!req) return JSON.stringify({ url: location.href, title: document.title, who: base.who, items: base.items, pages: 0, note: '没抓到时间线请求' });
  var v0 = {};
  try { v0 = JSON.parse(decodeURIComponent((req.u.match(/variables=([^&]+)/) || [])[1] || '{}')); } catch (e) {}
  var maxPages = Number(window.__xMaxPages || 60);
  var all = collect(window.__xcap);
  var pages = 0, idle = 0, lastN = 0;
  for (var pg = 0; pg < maxPages; pg++) {
    var cur = bottomCursor();
    if (!cur) break;
    var v = JSON.parse(JSON.stringify(v0));
    v.cursor = cur;
    var u = req.u.replace(/variables=[^&]+/, 'variables=' + encodeURIComponent(JSON.stringify(v)));
    var res = null;
    try { res = await fetch(u, { headers: req.h, credentials: 'include' }); } catch (e) { break; }
    if (!res || !res.ok) break;
    var js = null;
    try { js = await res.json(); } catch (e) { break; }
    window.__xcap.push(js);
    pages++;
    all = collect(window.__xcap);
    if (all.length > lastN) { lastN = all.length; idle = 0; } else { idle++; if (idle >= 2) break; }
  }
  var out = pack(all);
  return JSON.stringify({ url: location.href, title: document.title, who: out.who, items: out.items, pages: pages });
})()`;
async function withBrowser(fn) {
  const p = await openPage(Number(process.env.JM_PORT || 9333));
  try { await p.send('Page.bringToFront').catch(() => {}); return await fn(p); } finally { try { p.close(); } catch (e) {} }
}
let CACHE_MEM = { url: '', at: 0, data: null };
const CACHE_MS = 90000;
// 单条推文: 第一批数据里就有, 不滚; 主页: 滚, 但探到新数据就继续、连着几轮没新增就停
function wantRounds(url) { return statusOf(url) ? 0 : (process.env.FETCH_PROBE === '1' ? 6 : 80); }
const IDLE_MAX = () => (process.env.FETCH_PROBE === '1' ? 2 : 9);   // 连续这么多轮没新增才认为到底了(X 加载下一批有时候要等十几秒)
async function grab(url, rounds) {
  if (CACHE_MEM.data && CACHE_MEM.url === url && Date.now() - CACHE_MEM.at < CACHE_MS) return CACHE_MEM.data;
  const got = await withBrowser(async (p) => {
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }).catch(() => {});
    await p.send('Page.navigate', { url: url }).catch(() => {});
    let best = null;
    for (let i = 0; i < 60; i++) {   // 有数据就走(一般 2~4 秒)
      await sleep(250);
      let j = null;
      try { j = JSON.parse(String(await p.ev(READ) || '') || '{}'); } catch (e) {}
      if (j && j.items && j.items.length) { best = j; break; }
    }
    if (!best) throw new Error('没读到 X 的数据（确认调试浏览器已登录 X）');
    // 首选: 页内用抓到的请求模板翻页取全(不滚动) —— 一页 0.3~0.8 秒
    try {
      await p.ev('window.__xMaxPages = ' + (process.env.FETCH_PROBE === '1' ? 4 : 60)).catch(() => {});
      const full = JSON.parse(String(await p.ev(PULL_ALL) || '') || '{}');
      if (full && full.items && full.items.length >= best.items.length) best = full;
    } catch (e) {}
    // 兜底: 没抓到时间线请求(或翻页没生效)时才回退到滚动
    if (best.pages) return best;   // 页内翻页成功: 直接返回, 不再滚动
    let idle = 0, last = best.items.length;
    for (let r = 0; r < (rounds || 0) && idle < IDLE_MAX(); r++) {
      await p.ev('window.scrollBy(0, 2400)').catch(() => {});
      let grew = false;
      for (let k = 0; k < 6; k++) {
        await sleep(280);
        let j = null;
        try { j = JSON.parse(String(await p.ev(READ) || '') || '{}'); } catch (e) {}
        if (j && j.items && j.items.length > last) { last = j.items.length; best = j; grew = true; break; }
      }
      if (grew) idle = 0; else idle++;
    }
    return best;
  });
  CACHE_MEM = { url: url, at: Date.now(), data: got };
  return got;
}
let cache = null;
function loadCache() { if (cache) return cache; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { cache = {}; } return cache; }
function saveCache() { try { fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) {} }
function clean(s, n) {
  return String(s || '').replace(/https?:\/\/\S+/g, ' ').replace(/[\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 24);
}
function origUrl(u0) {   // X 的裸地址给的是缩略图(small), 必须显式加 name=orig 才是原图
  const u = String(u0 || '');
  if (!u) return u;
  if (/[?&]name=/i.test(u)) return u.replace(/([?&])name=[^&]*/i, '$1name=orig');
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'name=orig';
}
async function tweet(idNum) {   // 备用通道(单条推文 / 页面没抓到时): 免登录接口
  const c = loadCache();
  if (c[idNum]) return c[idNum];
  let j = null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://cdn.syndication.twimg.com/tweet-result?id=' + idNum + '&token=a', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      if (r.status === 429) { await sleep(2500 * (i + 1)); continue; }
      if (!r.ok) break;
      j = await r.json(); break;
    } catch (e) { await sleep(1500 * (i + 1)); }
  }
  // 只留用得上的字段, 别把整份推文 JSON 存进缓存(之前能涨到几百 KB)
  c[idNum] = j ? {
    u: j.user ? { name: j.user.name, screen_name: j.user.screen_name } : null,
    t: String(j.text || '').slice(0, 300),
    m: (j.mediaDetails || []).map((m2) => ({ type: m2.type, media_url_https: m2.media_url_https })),
  } : { _miss: 1 };
  const ks = Object.keys(c);
  if (ks.length > 400) for (const k of ks.slice(0, ks.length - 400)) delete c[k];   // 缓存上限, 免得越滚越大
  saveCache();
  return j;
}
function photosOf(j) {
  const out = []; const seen = {};
  for (const m of (j && j.mediaDetails) || []) {
    if (m.type !== 'photo' || !m.media_url_https) continue;
    const u = origUrl(m.media_url_https);
    if (seen[u]) continue; seen[u] = 1; out.push(u);
  }
  return out;
}
export async function resolve(url) {
  const h = handleOf(url);
  const st = statusOf(url);
  if (!h) throw new Error('链接里没有 X 用户名（形如 https://x.com/某人）');
  if (st) {   // 单条推文 -> 书还是这个人的图包
    const j = await tweet(st);
    if (j && j.user) {
      const ph = photosOf(j);
      return { title: clean(j.user.name, 40) || ('@' + j.user.screen_name), author: j.user.name + ' (@' + j.user.screen_name + ')', desc: clean(j.text, 120), cover: ph[0] || null, status: 'X / @' + j.user.screen_name };
    }
  }
  const got = await grab('https://x.com/' + h, wantRounds(url));
  const it = got.items[0] || {};
  const name = clean(it.disp || '', 40) || clean(String(got.title || '').replace(/\s*\(@.*$/, '').replace(/\s*\/\s*X.*$/, ''), 40) || ('@' + h);
  return { title: name, author: name + ' (@' + h + ')', desc: '', cover: null, status: 'X / @' + h };
}
export async function chapters(url) {
  const h = handleOf(url);
  const st = statusOf(url);
  if (!h) throw new Error('链接里没有 X 用户名（形如 https://x.com/某人）');
  if (st) {
    const j = await tweet(st);
    return [{ id: st, title: clean(j && j.text, 24) || ('t' + st), index: 1, order: 1, handle: h }];
  }
  const got = await grab('https://x.com/' + h, wantRounds(url));
  const list = got.items.filter((x) => x.pics && x.pics.length);
  if (!list.length) throw new Error('@' + h + ' 主页里没有带图片的原创推文');
  return list.map((x, i) => ({ id: x.id, title: clean(x.text, 24) || ('t' + x.id), index: i + 1, order: i + 1, handle: h, _pics: x.pics }));
}
export async function images(chapter) {
  if (chapter._pics && chapter._pics.length) {   // 枚举时已经从页面响应里拿到原图地址: 不用再发请求
    return chapter._pics.map((u) => ({ url: origUrl(u), headers: { 'Referer': 'https://x.com/' } }));
  }
  const j = await tweet(chapter.id);
  const ph = photosOf(j);
  if (!ph.length) throw new Error('这条推文里没有图片（可能是视频/纯文字）');
  return ph.map((u) => ({ url: u, headers: { 'Referer': 'https://x.com/' } }));
}
