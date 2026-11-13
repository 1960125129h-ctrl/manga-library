// 抖音适配器 —— 一个人 = 一本书(图包); 单条作品链接也归到这个人的图包里, 不另开新书。
// 枚举: 调试浏览器打开主页/作品页, 注入捕获器读页面自己发的 /aweme/v1/web/aweme/post/ 响应(签名/cookie 都由浏览器搞定)
// 【硬规则】只收图文作品(视频作品跳过); 图片取 url_list 里体积最大的那档; 动图(image.video 存在)= 下载 mp4 转 GIF 存盘
import { openPage, sleep } from '../jm/cdp.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const id = 'douyin';
export const label = '抖音';
export const home = 'https://www.douyin.com/';
export function match(url) { return /(^|\.|\/\/)(douyin|iesdouyin)\.com\//i.test(String(url || '') + '/'); }
export function secOf(url) {
  const m = String(url || '').match(/\/user\/([A-Za-z0-9_\-]+)/);
  return m ? m[1] : '';
}
export function itemOf(url) {
  const m = String(url || '').match(/\/(?:note|video)\/(\d{6,})/);
  return m ? m[1] : '';
}
const HOOK = `(function(){
  window.__cap = [];
  function keep(u, j) { try { window.__cap.push({ u: String(u), j: j }); } catch (e) {} }
  var of = window.fetch;
  window.fetch = function () {
    var u = (arguments[0] && arguments[0].url) || arguments[0];
    var pr = of.apply(this, arguments);
    try { if (String(u).indexOf('/aweme/') >= 0) pr.then(function (r) { try { r.clone().json().then(function (j) { keep(u, j); }); } catch (e) {} }); } catch (e) {}
    return pr;
  };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener('load', function () { try { keep(self.__u, JSON.parse(self.responseText)); } catch (e) {} });
    return os.apply(this, arguments);
  };
})();`;
// 页面内取数据: 图文作品按发布时间排好, 每张图给出候选地址和动图 mp4
export const READ = `(function(){
  var items = [];
  function walk(o, d) {
    if (!o || d > 16) return;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], d + 1); return; }
    if (typeof o !== 'object') return;
    if (Array.isArray(o.images) && o.images.length) items.push(o);
    for (var k in o) { if (k === 'images' || k === 'author' || k === 'music') continue; walk(o[k], d + 1); }
  }
  var pages = [];
  function readCapture(c) {
    if (!c || !c.j) return;
    walk(c.j, 0);
    var j = c.j;
    var isPost = String(c.u || '').indexOf('/aweme/v1/web/aweme/post/') >= 0 ||
      (Array.isArray(j.aweme_list) && Object.prototype.hasOwnProperty.call(j, 'has_more'));
    if (isPost) {
      pages.push({
        u: String(c.u || '').slice(0, 180),
        status: Number(j.status_code || 0),
        hasMore: (j.has_more === true || Number(j.has_more) === 1) ? 1 : 0,
        cursor: Number(j.max_cursor || 0),
        minCursor: Number(j.min_cursor || 0),
        count: Array.isArray(j.aweme_list) ? j.aweme_list.length : 0
      });
    }
  }
  (window.__cap || []).forEach(readCapture);
  try { if (window._ROUTER_DATA) walk(window._ROUTER_DATA, 0); } catch (e) {}
  try {
    var renderEl = document.getElementById('RENDER_DATA');
    if (renderEl && renderEl.textContent) {
      var renderJson = JSON.parse(decodeURIComponent(renderEl.textContent));
      walk(renderJson, 0);
    }
  } catch (e) {}

  function scrollMetrics() {
    var win = window, doc = document.documentElement, body = document.body;
    var cands = [
      { name: 'documentElement', el: doc, top: win.scrollY || doc.scrollTop || 0, h: doc.scrollHeight, c: doc.clientHeight },
      { name: 'body', el: body, top: body.scrollTop || win.scrollY || 0, h: body.scrollHeight, c: body.clientHeight }
    ];
    var nodes = document.querySelectorAll('main,[class*=scroll],[class*=container],[data-e2e*=scroll]');
    for (var i = 0; i < Math.min(nodes.length, 120); i++) {
      var el = nodes[i];
      if (el.scrollHeight <= el.clientHeight + 100) continue;
      cands.push({ name: el.tagName + '.' + String(el.className || '').slice(0, 24), el: el, top: el.scrollTop || 0, h: el.scrollHeight, c: el.clientHeight });
    }
    cands.sort(function (a, b) { return (b.h - b.c) - (a.h - a.c); });
    var best = cands[0] || {};
    return {
      name: best.name || '',
      top: Math.round(best.top || 0),
      height: best.h || 0,
      client: best.c || 0,
      innerWidth: win.innerWidth,
      innerHeight: win.innerHeight,
      remaining: Math.max(0, (best.h || 0) - (best.top || 0) - (best.c || 0)),
      ended: /暂时没有更多了|已经到底了|没有更多内容|已经到最后/.test(body.innerText)
    };
  }

  var seen = {}, out = [];
  items.forEach(function (a) {
    var id = String(a.aweme_id || '');
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({
      id: id, desc: String(a.desc || ''), t: a.create_time || 0, type: a.aweme_type,
      sec: (a.author && a.author.sec_uid) || '', nick: (a.author && a.author.nickname) || '',
      imgs: (a.images || []).map(function (im) {
        var v = im.video && im.video.play_addr && im.video.play_addr.url_list;
        return { u: (im.url_list || []).slice(0, 4), v: (v && v[0]) || '' };
      })
    });
  });
  out.sort(function (x, y) { return (y.t || 0) - (x.t || 0); });
  pages.sort(function (a, b) { return (b.cursor || 0) - (a.cursor || 0); });
  return JSON.stringify({
    url: location.href,
    title: document.title,
    items: out,
    pages: pages,
    page: pages[0] || null,
    anyMore: pages.some(function (p) { return p.hasMore === 1; }),
    caps: (window.__cap || []).length,
    scroll: scrollMetrics()
  });
})()`;
const FALLBACK_SCROLL = `(function(d){
  window.scrollBy({ top: d, behavior: 'smooth' });
  var nodes = Array.prototype.slice.call(document.querySelectorAll('main,[class*=scroll],[class*=container]'), 0, 120);
  nodes.sort(function(a,b){
    return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
  });
  for (var i = 0; i < Math.min(4, nodes.length); i++) {
    var el = nodes[i];
    if (el.scrollHeight > el.clientHeight + 100) el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + d);
  }
  return true;
})(900)`;
const JUMP_BOTTOM = `(function(){
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  var nodes = Array.prototype.slice.call(document.querySelectorAll('main,[class*=scroll],[class*=container]'), 0, 120);
  nodes.sort(function(a,b){
    return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
  });
  for (var i = 0; i < Math.min(4, nodes.length); i++) nodes[i].scrollTop = nodes[i].scrollHeight;
  return true;
})()`;
async function withPage(fn) {
  const p = await openPage(Number(process.env.JM_PORT || 9333));
  try { await p.send('Page.bringToFront').catch(() => {}); return await fn(p); } finally { try { p.close(); } catch (e) {} }
}
/* 同一次运行里 resolve+chapters 会连着调: 缓存住, 别把同一个页面加载两遍(省 10 秒以上) */
let CACHE = { url: '', at: 0, rounds: -1, data: null };
const CACHE_MS = 90000;
// 同一次运行要滚几轮: 单条作品页第一批数据里就有, 不用滚; 预览模式少量采样; 正式下载持续滚到底
function wantRounds(url) { return itemOf(url) ? 0 : (process.env.FETCH_PROBE === '1' ? 8 : 0); }
async function readPage(p) {
  try { return JSON.parse(String(await p.ev(READ) || '') || '{}'); } catch (e) { return null; }
}
/* 磁盘缓存：预览和下载是两个独立的 node 进程，内存缓存互相看不见，
   结果就是"解析一次要开一次浏览器、下载时又开一次"。
   这里把页面抓到的结果落到 _scripts/sites/cache-douyin.json，两个进程共用。 */
const DISK = path.join(HERE, 'cache-douyin.json');
const DISK_TTL = 60 * 60 * 1000;   // 1 小时   // 30 分钟；抖音主页/作品基本不会在这个窗口里变
// 体积上限：一个博主动辄上千条作品，单条记录就有 11MB 左右（每张图 4 个签名 URL）。
// 只按"条数"限会撑到几百 MB，所以再压一道总字节数，超了按时间删最旧的。
const DISK_MAX = 300 * 1024 * 1024;   // 只按体积限，不限条数：一个千条作品的大主页约 11MB，够放 27 个
function diskLoad(url) {
  try {
    const all = JSON.parse(fs.readFileSync(DISK, 'utf8'));
    const hit = all[url];
    if (hit && Date.now() - hit.at < DISK_TTL && hit.data && hit.data.items && hit.data.items.length) return hit.data;
  } catch (e) {}
  return null;
}
function diskSave(url, data) {
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(DISK, 'utf8')); } catch (e) { all = {}; }
    all[url] = { at: Date.now(), rounds: 0, data: data };
    const ks = Object.keys(all);
    if (ks.length > 60) for (const k of ks.slice(0, ks.length - 60)) delete all[k];   // 条数上限
    let json = JSON.stringify(all);
    if (json.length > DISK_MAX) {                       // 体积上限：从最旧的开始删
      const byAge = Object.keys(all).sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
      while (json.length > DISK_MAX && byAge.length > 1) { delete all[byAge.shift()]; json = JSON.stringify(all); }
    }
    fs.writeFileSync(DISK, json, 'utf8');
  } catch (e) {}
}
// 下载成功后把这条缓存删掉：它只为"解析→下载"这段服务，下载完就没用了。
// 下载失败时不要调 —— 留着缓存重试才不用重新开浏览器。
export function clearCache(url) {
  try {
    const all = JSON.parse(fs.readFileSync(DISK, 'utf8'));
    let hit = false;
    for (const k of [url, 'note:' + (itemOf(url) || '')]) {
      if (k && all[k]) { delete all[k]; hit = true; }
    }
    if (hit) fs.writeFileSync(DISK, JSON.stringify(all), 'utf8');
  } catch (e) {}
}
async function grab(url, rounds) {
  if (CACHE.data && CACHE.url === url && (rounds || 0) <= CACHE.rounds && Date.now() - CACHE.at < CACHE_MS) return CACHE.data;
  const disk = diskLoad(url);
  if (disk) { CACHE = { url: url, at: Date.now(), rounds: rounds || 0, data: disk }; return disk; }
  const got = await withPage(async (p) => {
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }).catch(() => {});
    await p.send('Page.navigate', { url: url }).catch(() => {});
    let best = null, partial = null;
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      const j = await readPage(p);
      if (j) {
        partial = j;
        if (j.items && j.items.length) { best = j; break; }
      }
    }
    if (!best) {
      let debug = '';
      if (partial) {
        const s = partial.scroll || {};
        debug = ` caps=${partial.caps || 0}, pages=${(partial.pages || []).length}, top=${s.top || 0},height=${s.height || 0}`;
      }
      throw new Error('没读到抖音数据（可能需要登录：先在调试浏览器登录抖音，或页面被风控了）' + debug);
    }

    const one = itemOf(url) || itemOf(best.url || '');
    if (!one) {
      const maxRounds = rounds > 0 ? rounds : 300;
      const idleLimit = rounds > 0 ? 6 : 12;
      let idle = 0;
      let lastCount = best.items.length;
      let lastTop = (best.scroll && best.scroll.top) || 0;
      let lastHeight = (best.scroll && best.scroll.height) || 0;
      for (let r = 0; r < maxRounds; r++) {
        const beforeScroll = best.scroll || {};
        const cx = Math.round((beforeScroll.innerWidth || 1200) / 2);
        const cy = Math.round((beforeScroll.innerHeight || 800) * 0.55);
        const delta = 750 + Math.round(Math.random() * 450);
        await p.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: delta
        }).catch(() => {});

        let grew = false, moved = false;
        for (let k = 0; k < 12; k++) {
          await sleep(350);
          const j = await readPage(p);
          if (!j) continue;
          const s = j.scroll || {};
          if (Math.abs((s.top || 0) - lastTop) > 30 || (s.height || 0) > lastHeight + 100) moved = true;
          best = j;
          lastTop = s.top || 0;
          lastHeight = s.height || 0;
          if ((j.items || []).length > lastCount) { lastCount = j.items.length; grew = true; break; }
        }

        if (!grew) {
          await p.ev(FALLBACK_SCROLL).catch(() => {});
          await sleep(800);
          const j = await readPage(p);
          if (j) {
            const s = j.scroll || {};
            if (Math.abs((s.top || 0) - lastTop) > 30 || (s.height || 0) > lastHeight + 100) moved = true;
            best = j;
            lastTop = s.top || 0;
            lastHeight = s.height || 0;
            if ((j.items || []).length > lastCount) { lastCount = j.items.length; grew = true; }
          }
        }

        if (grew) { idle = 0; continue; }
        if ((idle + 1) % 3 === 0) await p.ev(JUMP_BOTTOM).catch(() => {});
        idle++;
        const s = best.scroll || {};
        const serverEnded = (best.pages && best.pages.length && !best.anyMore) ||
          (best.page && best.page.hasMore === 0);
        if ((s.ended || serverEnded) && idle >= 2) break;
        if (idle >= idleLimit) break;
      }

      await sleep(900);
      const finalData = await readPage(p);
      if (finalData && (finalData.items || []).length >= best.items.length) best = finalData;
    }
    return best;
  });
  CACHE = { url: url, at: Date.now(), rounds: rounds || 0, data: got };
    diskSave(url, got);   // 落盘给别的进程用（预览抓过，下载就不必再开浏览器）
  return got;
}
function clean(s, n) { return String(s || '').replace(/https?:\/\/\S+/g, ' ').replace(/[\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 24); }
/* 主页主人是谁：
   不能只看第一条作品的作者 —— 抖音的"共创/合拍"作品 author 是合作方，
   实测某个主页第一条是共创，作者叫"韦伯机长"，而主页主人是"热茶"（78 条里 78 条都是他）。
   所以按"作品作者出现次数最多的那个"来定，再用页面标题（"热茶的抖音 - 抖音"）兜底。 */
function pickOwner(got) {
  const counts = {};
  for (const it of ((got && got.items) || [])) {
    const n = clean(it.nick || '', 40);
    if (n) counts[n] = (counts[n] || 0) + 1;
  }
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  const fromTitle = clean(String((got && got.title) || '')
    .replace(/\s*[-–—]\s*抖音.*$/, '')
    .replace(/的抖音$/, '')
    .replace(/\s*\(@[^)]*\)/, ''), 40);
  return top || fromTitle;
}
export async function resolve(url) {
  const got = await grab(url, wantRounds(url));   // 和 chapters 用同样的深度: 命中缓存, 只加载一次页面
  const one = itemOf(url) || itemOf(got.url || '');
  const it = got.items.filter((x) => x.imgs && x.imgs.length).find((x) => one ? x.id === one : true) || got.items[0];
  const nick = pickOwner(got);
  if (!nick) throw new Error('没读出抖音昵称，可能是页面没加载出来或需要登录');
  // 提取作品文案里的 #话题 -> tags
  const tags = [];
  if (it && it.desc) {
    const re = /#([^#\s]+)/g; let m;
    while ((m = re.exec(String(it.desc))) !== null) { const tg = clean(m[1], 24); if (tg && tags.indexOf(tg) < 0) tags.push(tg); }
  }
  // 单条作品链接: 书名用文案正文; 正文为空或就是作者昵称时, 用话题词拼; 主页链接仍用昵称
  let title = nick;
  if (one && it && it.desc) {
    const d = clean(String(it.desc).replace(/#[^#\s]+/g, ' ').replace(/@[\w\-·]+/g, ' '), 40);
    if (d && d.length >= 5 && d !== nick) title = d;
    else { const tg = tags.filter((t) => t !== nick).slice(0, 4).join(' '); if (tg) title = clean(tg, 40); }
  }
  // 作者栏只放昵称：抖音没有 X 那种可读的 @handle，sec_uid 是 MS4wLjABAAAA… 这种一百多位的内部
  // ID，截一段贴在作者后面纯属噪音（以前是 "韦伯机长 (@MS4wLjABAAAAt4…)"）。
  return { title: title, author: nick, desc: String((it && it.desc) || ''), cover: null, status: '抖音', tags: tags };
}
export async function chapters(url) {
  const got = await grab(url, wantRounds(url));   // App 点「解析」时只快速采样, 别让它等超时
  const one = itemOf(url) || itemOf(got.url || '');   // 分享短链: 用浏览器落地后的地址取作品 id
  const sec = secOf(url) || (got.items[0] && got.items[0].sec) || '';
  let list = got.items.filter((x) => x.imgs && x.imgs.length);          // 只要图文
  if (one) list = list.filter((x) => x.id === one);
  else if (sec) list = list.filter((x) => x.sec === sec);
  if (!list.length) throw new Error('这个号里没找到图文作品（抖音图文才有图片，纯视频作品不下）');
  list.sort((a, b) => (b.t || 0) - (a.t || 0));
  return list.map((x, i) => ({
    id: x.id,
    title: clean(x.desc, 24) || ('t' + x.id),
    cover: (x.imgs && x.imgs[0] && (x.imgs[0].u[x.imgs[0].u.length - 1] || x.imgs[0].u[0])) || "",
    url: 'https://www.douyin.com/note/' + x.id,
    extra: (x.imgs && x.imgs.length) + ' 图',
    index: i + 1, order: i + 1, _dy: x
  }));
}
export async function images(chapter) {
  const x = chapter._dy;
  if (!x || !x.imgs || !x.imgs.length) throw new Error('这条作品没有图片数据');
  const out = [];
  for (const im of x.imgs) {
    if (im.v) { out.push({ gif: im.v, url: im.u[im.u.length - 1] || im.u[0], headers: { 'Referer': 'https://www.douyin.com/' } }); continue; }   // 动图: 下 mp4 转 GIF
    if (im.u && im.u.length) out.push({ url: im.u[im.u.length - 1], alts: im.u.slice(0, -1), headers: { 'Referer': 'https://www.douyin.com/' } });
  }
  return out;
}