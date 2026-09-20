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
const READ = `(function(){
  var items = [];
  function walk(o, d) {
    if (!o || d > 16) return;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], d + 1); return; }
    if (typeof o !== 'object') return;
    if (Array.isArray(o.images) && o.images.length) items.push(o);
    for (var k in o) { if (k === 'images' || k === 'author' || k === 'music') continue; walk(o[k], d + 1); }
  }
  // var dbg = { all: [] };
  (window.__cap || []).forEach(function (c) {
    // var before = items.length;
    walk(c.j, 0);
    // var found = items.length - before;
    // if (found > 0) dbg.all.push({ u: String(c.u || '').slice(0, 150), found: found });
  });
  var seen = {}, out = [];
  items.forEach(function (a) {
    if (seen[a.aweme_id]) return;
    seen[a.aweme_id] = 1;
    out.push({
      id: String(a.aweme_id), desc: String(a.desc || ''), t: a.create_time || 0, type: a.aweme_type,
      sec: (a.author && a.author.sec_uid) || '', nick: (a.author && a.author.nickname) || '',
      imgs: (a.images || []).map(function (im) {
        var v = im.video && im.video.play_addr && im.video.play_addr.url_list;
        return { u: (im.url_list || []).slice(0, 4), v: (v && v[0]) || '' };
      })
    });
  });
  out.sort(function (x, y) { return (y.t || 0) - (x.t || 0); });
  return JSON.stringify({ url: location.href, title: document.title, items: out });
})()`;
async function withPage(fn) {
  const p = await openPage(Number(process.env.JM_PORT || 9333));
  try { await p.send('Page.bringToFront').catch(() => {}); return await fn(p); } finally { try { p.close(); } catch (e) {} }
}
/* 同一次运行里 resolve+chapters 会连着调: 缓存住, 别把同一个页面加载两遍(省 10 秒以上) */
let CACHE = { url: '', at: 0, rounds: -1, data: null };
const CACHE_MS = 90000;
// 同一次运行要滚几轮: 单条作品页第一批数据里就有, 不用滚; 主页要滚(解析模式少滚一点)
function wantRounds(url) { return itemOf(url) ? 0 : (process.env.FETCH_PROBE === '1' ? 3 : 6); }
async function grab(url, rounds) {
  if (CACHE.data && CACHE.url === url && (rounds || 0) <= CACHE.rounds && Date.now() - CACHE.at < CACHE_MS) return CACHE.data;
  const got = await withPage(async (p) => {
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }).catch(() => {});
    await p.send('Page.navigate', { url: url }).catch(() => {});
    // 不再死等固定秒数: 每 250ms 探一次, 有数据就走(一般 2~4 秒出)
    let best = null;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      let j = null;
      try { j = JSON.parse(String(await p.ev(READ) || '') || '{}'); } catch (e) {}
      if (j && j.items && j.items.length) { best = j; break; }
    }
    if (!best) throw new Error('没读到抖音数据（可能需要登录：先在调试浏览器登录抖音，或页面被风控了）');
    // if (best.dbg) {
      // console.log('[抖音调试] 找到图文对象的响应:');
      // (best.dbg.all || []).forEach(function (x) { console.log('  [' + x.found + '个] ' + x.u); });
    // }
    // 往下滚: 大距离快滚 + 短间隔探测, 连着 3 轮没新增就停
    let idle = 0, last = best.items.length;
    for (let r = 0; r < 300 && idle < 15; r++) {
      await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 500, deltaX: 0, deltaY: 5000 }).catch(() => {});
      let grew = false;
      for (let k = 0; k < 10; k++) {
        await sleep(300);
        let j = null;
        try { j = JSON.parse(String(await p.ev(READ) || '') || '{}'); } catch (e) {}
        if (j && j.items && j.items.length > last) { last = j.items.length; best = j; grew = true; break; }
      }
      if (grew) idle = 0; else idle++;
    }
    // if (best.dbg) { console.log('[抖音调试-滚动后] 最终 items ' + best.items.length + ' 个'); }
    return best;
  });
  CACHE = { url: url, at: Date.now(), rounds: rounds || 0, data: got };
  return got;
}
function clean(s, n) { return String(s || '').replace(/https?:\/\/\S+/g, ' ').replace(/[\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 24); }
export async function resolve(url) {
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