// 抖音适配器 —— 一个人 = 一本书(图包); 单条作品链接也归到这个人的图包里, 不另开新书。
// 枚举: 调试浏览器打开主页/作品页, 注入捕获器读页面自己发的 /aweme/v1/web/aweme/post/ 响应(签名/cookie 都由浏览器搞定)
// 【硬规则】只收图文作品(视频作品跳过); 图片取 url_list 里体积最大的那档; 动图(image.video 存在)= 下载 mp4 转 GIF 存盘
import { openPage, sleep } from '../jm/cdp.mjs';
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
async function grab(url, rounds) {
  if (CACHE.data && CACHE.url === url && (rounds || 0) <= CACHE.rounds && Date.now() - CACHE.at < CACHE_MS) return CACHE.data;
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
  return got;
}
/* ---------- 纯 HTTP 通道（单条作品） ----------
   抖音的 m.douyin.com 分享页开了服务端渲染（renderInSSR=1），
   页面里有一段 window._ROUTER_DATA = {...}，作品图和文案都在里面。
   所以单条作品可以完全不开浏览器、也不算 a_bogus：
     v.douyin.com/短链 --跟随302--> www.douyin.com/note/{id}
     https://m.douyin.com/share/note/{id} --GET--> HTML -> _ROUTER_DATA -> 图集
   主页时间线仍然只能走浏览器（要签名 + cookie）。 */
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
function extractRouterData(html) {
  const i = String(html || '').indexOf('_ROUTER_DATA');
  if (i < 0) return null;
  const s = html.indexOf('{', i);
  if (s < 0) return null;
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let k = s; k < html.length; k++) {
    const ch = html[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(html.slice(s, end)); } catch (e) { return null; }
}
// 递归找所有"带 url_list 的媒体对象"——不去猜具体层级（抖音字段名改过好几轮）
function findMedia(root) {
  const out = [];
  (function walk(o, d) {
    if (!o || typeof o !== 'object' || d > 14) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (Array.isArray(o.url_list) && o.url_list.length) {
      out.push({
        u: o.url_list.filter((u) => typeof u === 'string').slice(0, 4),
        v: String((o.video && o.video.play_addr && (o.video.play_addr.url_list || [])[0]) || '')
      });
    }
    for (const k in o) walk(o[k], d + 1);
  })(root, 0);
  return out;
}
function findField(root, name, maxD) {
  let hit = '';
  (function walk(o, d) {
    if (hit || !o || typeof o !== 'object' || d > (maxD || 14)) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (typeof o[name] === 'string' && o[name]) { hit = o[name]; return; }
    for (const k in o) walk(o[k], d + 1);
  })(root, 0);
  return hit;
}
// 分享短链 v.douyin.com/xxx 先跟随 302 拿到真实地址，才能取到 aweme_id
async function expandShort(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': MOBILE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    return String(r.url || '');
  } catch (e) { return ''; }
}
async function httpOne(aid) {
  if (!aid) return null;
  for (const path of ['/share/note/', '/share/video/']) {
    let html = '';
    try {
      const r = await fetch('https://m.douyin.com' + path + aid, {
        headers: { 'User-Agent': MOBILE_UA, 'Referer': 'https://m.douyin.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' }
      });
      if (!r.ok) continue;
      html = await r.text();
    } catch (e) { continue; }
    const data = extractRouterData(html);
    if (!data) continue;
    const imgs = findMedia(data);
    if (!imgs.length) continue;
    return {
      id: aid,
      desc: findField(data, 'desc') || findField(data, 'title') || '',
      nick: findField(data, 'nickname') || findField(data, 'nickName') || '',
      sec: findField(data, 'sec_uid') || findField(data, 'secUid') || '',
      t: 0, type: 0, imgs: imgs, _http: true
    };
  }
  return null;
}
function clean(s, n) { return String(s || '').replace(/https?:\/\/\S+/g, ' ').replace(/[\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 24); }
export async function resolve(url) {
  // 单条作品：纯 HTTP 就够，别开浏览器
  let oneId = itemOf(url);
  if (!oneId && /v\.douyin\.com|iesdouyin\.com\/share/i.test(url)) {
    const real = await expandShort(url);
    oneId = itemOf(real) || itemOf(String(real).replace(/\?.*$/, ''));
  }
  if (oneId) {
    try {
      const hp = await httpOne(oneId);
      if (hp && hp.imgs && hp.imgs.length) {
        const nick = clean(hp.nick || '', 40) || '抖音';
        const tags = [];
        if (hp.desc) {
          const re = /#([^#\s]+)/g; let m;
          while ((m = re.exec(String(hp.desc))) !== null) { const tg = clean(m[1], 24); if (tg && tags.indexOf(tg) < 0) tags.push(tg); }
        }
        let title = nick;
        const d = clean(String(hp.desc || '').replace(/#[^#\s]+/g, ' ').replace(/@[\w\-·]+/g, ' '), 40);
        if (d && d.length >= 5 && d !== nick) title = d;
        else { const tg = tags.filter((t) => t !== nick).slice(0, 4).join(' '); if (tg) title = clean(tg, 40); }
        return { title: title, author: nick, desc: String(hp.desc || ''), cover: null, status: '抖音 / 纯 HTTP' };
      }
    } catch (e) {}
  }
  const got = await grab(url, wantRounds(url));   // 和 chapters 用同样的深度: 命中缓存, 只加载一次页面
  const one = itemOf(url) || itemOf(got.url || '');
  const it = got.items.filter((x) => x.imgs && x.imgs.length).find((x) => one ? x.id === one : true) || got.items[0];
  const nick = clean((it && it.nick) || String(got.title || '').replace(/\s*-\s*抖音.*$/, ''), 40);
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
  return { title: title, author: nick + (it && it.sec ? ' (@' + it.sec.slice(0, 14) + '…)' : ''), desc: String((it && it.desc) || ''), cover: null, status: '抖音', tags: tags };
}
export async function chapters(url) {
  // 单条作品链接：先试纯 HTTP（不开浏览器、不算签名），拿不到再回退浏览器
  let oneId = itemOf(url);
  if (!oneId && /v\.douyin\.com|iesdouyin\.com\/share/i.test(url)) {
    const real = await expandShort(url);
    oneId = itemOf(real) || itemOf(String(real).replace(/\?.*$/, ''));
  }
  if (oneId) {
    try {
      const hp = await httpOne(oneId);
      if (hp && hp.imgs && hp.imgs.length) {
        return [{
          id: hp.id,
          title: clean(hp.desc, 24) || ('t' + hp.id),
          cover: (hp.imgs[0] && (hp.imgs[0].u[hp.imgs[0].u.length - 1] || hp.imgs[0].u[0])) || '',
          url: 'https://www.douyin.com/note/' + hp.id,
          extra: hp.imgs.length + ' 图',
          index: 1, order: 1, _dy: hp
        }];
      }
    } catch (e) {}
  }
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