// 微博适配器 —— 一个人 = 一本书(图包); 单条微博链接也归到这个人的图包里, 不另开新书。
// 枚举: 调试浏览器打开 weibo.com 个人主页, 抓页面自己发的 /ajax/ 时间线响应(带 X-XSRF-TOKEN 等头),
//       再在页内换 page/since_id 翻页取全(和 X 同一套: 不滚动, 一页 0.3~0.8 秒)
// 图片: pics[].large.url 是高清档; type=gif 的原样存 .gif(微博动图本身就是 gif, 不用转)
import { openPage, sleep } from '../jm/cdp.mjs';
export const id = 'weibo';
export const label = '微博';
export const home = 'https://weibo.com/';
export function match(url) { return /(^|\.|\/\/)(weibo\.com|weibo\.cn|m\.weibo\.cn)\//i.test(String(url || '') + '/'); }
export function uidOf(url) {
  const s = String(url || '');
  let m = s.match(/\/u\/(\d{5,})/);
  if (m) return m[1];
  m = s.match(/(?:weibo\.(?:com|cn))\/(\d{5,})(?=\/|$|\?)/);
  if (m) return m[1];
  m = s.match(/[?&]uid=(\d{5,})/);
  if (m) return m[1];
  return '';
}
export function bidOf(url) {
  const m = String(url || '').match(/(?:status|detail|\/u\/\d+)\/([A-Za-z0-9]{8,})/);
  return m ? m[1] : '';
}
const HOOK = `(function(){
  window.__wb = [];
  function keep(u, h, j) { try { window.__wb.push({ u: String(u), h: h || {}, j: j }); } catch (e) {} }
  function isApi(u) { return String(u).indexOf('/ajax/') >= 0 || String(u).indexOf('/api/container/') >= 0; }
  var of = window.fetch;
  window.fetch = function (a, b) {
    var u = (a && a.url) || a, h = (b && b.headers) || (a && a.headers) || {}, hh = {};
    try { if (h && typeof h.forEach === 'function') h.forEach(function (v, k) { hh[k] = v; }); else { for (var k in h) hh[k] = h[k]; } } catch (e) {}
    var pr = of.apply(this, arguments);
    try { if (isApi(u)) pr.then(function (r) { try { r.clone().json().then(function (j) { keep(u, hh, j); }); } catch (e) {} }); } catch (e) {}
    return pr;
  };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send, sh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { this.__h[k] = v; } catch (e) {} return sh.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    if (isApi(self.__u)) self.addEventListener('load', function () { try { keep(self.__u, self.__h, JSON.parse(self.responseText)); } catch (e) {} });
    return os.apply(this, arguments);
  };
})();`;
/* 相册(推荐): 在 m.weibo.cn 页面里同源调用容器接口, 把这个人相册里的图全部拉下来
   相册 = 所有图片的正路(含转发带图), 时间线只作兜底 */
function albumScript(uid, maxPages) {
  return '(async function(){var uid=' + JSON.stringify(String(uid)) + ';var maxP=' + (maxPages || 60) + ';'
    + 'var who="",albumCid="";'
    + '(window.__wb||[]).forEach(function(r){'
    + '  (function walk(o,d){ if(!o||d>14)return; if(Array.isArray(o)){for(var i=0;i<o.length;i++)walk(o[i],d+1);return;} if(typeof o!=="object")return;'
    + '    if(o.screen_name&&!who)who=String(o.screen_name);'
    + '    if(o.tab_type&&String(o.tab_type).indexOf("album")>=0&&o.containerid&&!albumCid)albumCid=String(o.containerid);'
    + '    for(var k in o)walk(o[k],d+1); })(r.j,0);'
    + '});'
    + 'if(!albumCid){var j0=null;try{var r0=await fetch("/api/container/getIndex?type=uid&value="+uid,{credentials:"include"});j0=await r0.json();}catch(e){}'
    + '  (function walk(o,d){ if(!o||d>14)return; if(Array.isArray(o)){for(var i=0;i<o.length;i++)walk(o[i],d+1);return;} if(typeof o!=="object")return;'
    + '    if(o.screen_name&&!who)who=String(o.screen_name);'
    + '    if(o.tab_type&&String(o.tab_type).indexOf("album")>=0&&o.containerid&&!albumCid)albumCid=String(o.containerid);'
    + '    for(var k in o)walk(o[k],d+1); })(j0,0);}'
    + 'if(!albumCid)return JSON.stringify({who:who,items:[],pages:0,note:"没找到相册"});'
    + 'var all=[],seen={},since="",pages=0;'
    + 'for(var pg=0;pg<maxP;pg++){'
    + '  var u="/api/container/getIndex?containerid="+encodeURIComponent(albumCid)+"&page_type=3"+(since?("&since_id="+encodeURIComponent(since)):"");'
    + '  var r=null;try{r=await fetch(u,{credentials:"include"});}catch(e){break;}'
    + '  if(!r||!r.ok)break;'
    + '  var j=null;try{j=await r.json();}catch(e){break;}'
    + '  var cards=(j&&j.data&&j.data.cards)||[];'
    + '  cards.forEach(function(c){(function walk(o,d){ if(!o||d>12)return; if(Array.isArray(o)){for(var i=0;i<o.length;i++)walk(o[i],d+1);return;} if(typeof o!=="object")return;'
    + '    if(o.pics&&o.pics.length){ for(var q=0;q<o.pics.length;q++){var pv=o.pics[q];var uu=(pv.large&&pv.large.url)||pv.url||"";if(uu&&!seen[uu]){seen[uu]=1;all.push({u:uu,gif:(pv.type==="gif")||/\.gif$/i.test(String(uu).split("?")[0])});}} }'
    + '    for(var k in o){ if(k==="pics")continue; walk(o[k],d+1);} })(c,0);});'
    + '  var next="";'
    + '  try{ next=String((j&&j.data&&j.data.cardlistInfo&&j.data.cardlistInfo.since_id)||(j&&j.data&&j.data.since_id)||""); }catch(e){}'
    + '  pages++;'
    + '  if(!cards.length||!next||next===since)break;'
    + '  since=next;'
    + '}'
    + 'return JSON.stringify({who:who,items:all.length?[{id:"全部",text:"全部",t:0,pics:all}]:[],pages:pages,note:all.length?"":"相册里没图"});})()';
}
/* 页内直连微博桌面接口翻页: /ajax/statuses/mymblog?uid=..&page=N (带 XSRF 头 + cookie),
   不依赖"页面自己发过请求", 一次翻到底, 比滚页面快得多 */
function pullScript(uid, maxPages) {
  return '(async function(){var uid=' + JSON.stringify(String(uid)) + ';var maxP=' + (maxPages || 40) + ';'
    + 'var m=document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);var xsrf=m?decodeURIComponent(m[1]):"";'
    + 'function picsOf(mm){var out=[];'
    + '  var pi=mm.pic_infos||{};var ks=Object.keys(pi);'
    + '  for(var i=0;i<ks.length;i++){var pv=pi[ks[i]]||{};var u=(pv.original&&pv.original.url)||(pv.mw2000&&pv.mw2000.url)||(pv.largest&&pv.largest.url)||(pv.large&&pv.large.url)||"";if(u)out.push({u:u,gif:(pv.type==="gif")||/\.gif$/i.test(String(u).split("?")[0])});}'
    + '  var ps=mm.pics||[];for(var k=0;k<ps.length;k++){var pp=ps[k];var u2=(pp.large&&pp.large.url)||pp.url||"";if(u2)out.push({u:u2,gif:pp.type==="gif"});}'
    + '  return out;}'
    + 'var all=[],seen={},who="",pages=0;'
    + 'for(var pg=1;pg<=maxP;pg++){'
    + '  var r=null;try{r=await fetch("/ajax/statuses/mymblog?uid="+uid+"&page="+pg+"&feature=0",{credentials:"include",headers:{"X-XSRF-TOKEN":xsrf,"X-Requested-With":"XMLHttpRequest","Accept":"application/json, text/plain, */*"}});}catch(e){break;}'
    + '  if(!r||!r.ok)break;'
    + '  var j=null;try{j=await r.json();}catch(e){break;}'
    + '  var list=(j&&j.data&&j.data.list)||[];if(!list.length)break;'
    + '  var added=0;'
    + '  for(var i=0;i<list.length;i++){var mm=list[i];var id=String(mm.bid||mm.mblogid||mm.id);if(seen[id])continue;seen[id]=1;added++;'
    + '    if(!who&&mm.user&&mm.user.screen_name)who=mm.user.screen_name;'
    + '    var ps2=picsOf(mm);if(!ps2.length)continue;'
    + '    all.push({id:id,text:String(mm.text_raw||mm.text||""),t:Date.parse(mm.created_at||"")||0,pics:ps2});}'
    + '  pages++;if(!added)break;}'
    + 'all.sort(function(x,y){return (x.t||0)-(y.t||0);});'
    + 'return JSON.stringify({who:who,items:all,pages:pages});})()';
}
const PULL_ALL = `(async function () {
  function collect(list) {
    var out = [], seen = {};
    function walk(o, d) {
      if (!o || d > 18) return;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], d + 1); return; }
      if (typeof o !== 'object') return;
      if (o.pics && o.pics.length && (o.bid || o.mblogid || o.id)) {
        var k = String(o.bid || o.mblogid || o.id);
        if (!seen[k]) { seen[k] = 1; out.push(o); }
      }
      for (var k2 in o) { if (k2 === 'pics' || k2 === 'retweeted_status' || k2 === 'page_info') continue; walk(o[k2], d + 1); }
    }
    (list || []).forEach(function (g) { walk(g, 0); });
    return out;
  }
  function pack(items) {
    var out = [], who = '';
    items.forEach(function (m) {
      var u = m.user || {};
      if (!who && u.screen_name) who = u.screen_name;
      var pics = (m.pics || []).map(function (pp) {
        var large = (pp.large && pp.large.url) || pp.url || '';
        return { u: large, gif: pp.type === 'gif' };
      }).filter(function (x) { return x.u; });
      if (!pics.length) return;
      out.push({ id: String(m.bid || m.mblogid || m.id), text: String(m.text_raw || m.text || ''), t: Date.parse(m.created_at || '') || 0, pics: pics });
    });
    out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    return { who: who, items: out };
  }
  var base = pack(collect((window.__wb || []).map(function (x) { return x.j; })));
  var req = (window.__wb || []).filter(function (r) {
    var s = JSON.stringify(r.j || '');
    return s.indexOf('pics') > 0 || s.indexOf('mblog') > 0 || s.indexOf('statuses') > 0;
  })[0];
  if (!req) return JSON.stringify({ url: location.href, who: base.who, items: base.items, pages: 0, note: '没抓到时间线请求' });
  var maxPages = Number(window.__wbMaxPages || 40);
  var all = collect((window.__wb || []).map(function (x) { return x.j; }));
  var pages = 0, idle = 0, lastN = 0;
  for (var pg = 1; pg <= maxPages; pg++) {
    var u2 = req.u;
    if (u2.indexOf('since_id=') >= 0) {
      var sid = '';
      try {
        (window.__wb || []).forEach(function (r) {
          var pi = r.j && r.j.data && r.j.data.pageInfo;
          if (pi && pi.since_id) sid = String(pi.since_id);
          if (r.j && r.j.pageInfo && r.j.pageInfo.since_id) sid = String(r.j.pageInfo.since_id);
        });
      } catch (e) {}
      if (!sid) break;
      u2 = u2.replace(/since_id=\d+/, 'since_id=' + sid);
    } else {
      u2 = u2.replace(/([?&])page=\d+/, '$1page=' + (pg + 1));
      if (u2 === req.u) u2 = req.u + (req.u.indexOf('?') >= 0 ? '&' : '?') + 'page=' + (pg + 1);
    }
    if (u2 === req.u) break;
    var res = null;
    try { res = await fetch(u2, { headers: req.h, credentials: 'include' }); } catch (e) { break; }
    if (!res || !res.ok) break;
    var js = null;
    try { js = await res.json(); } catch (e) { break; }
    window.__wb.push({ u: u2, h: req.h, j: js });
    pages++;
    all = collect((window.__wb || []).map(function (x) { return x.j; }));
    if (all.length > lastN) { lastN = all.length; idle = 0; } else { idle++; if (idle >= 2) break; }
  }
  var out = pack(all);
  return JSON.stringify({ url: location.href, who: out.who, items: out.items, pages: pages });
})()`;
async function withBrowser(fn) {
  const p = await openPage(Number(process.env.JM_PORT || 9333));
  try { await p.send('Page.bringToFront').catch(() => {}); return await fn(p); } finally { try { p.close(); } catch (e) {} }
}
let CACHE_MEM = { url: '', at: 0, data: null };
const CACHE_MS = 90000;
function wantPages(url) { return bidOf(url) && !uidOf(url) ? 1 : (process.env.FETCH_PROBE === '1' ? 3 : 40); }
function clean(s, n) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 24);
}
async function grab(url, pages) {
  if (CACHE_MEM.data && CACHE_MEM.url === url && Date.now() - CACHE_MEM.at < CACHE_MS) return CACHE_MEM.data;
  const uid = uidOf(url);
  if (!uid) throw new Error('链接里没有微博 uid（形如 https://weibo.com/u/1234567890）');
  const got = await withBrowser(async (p) => {
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }).catch(() => {});
    // 全程走 weibo.com 桌面版(不用手机端)
    await p.send('Page.navigate', { url: 'https://weibo.com/u/' + uid }).catch(() => {});
    await sleep(9000);   // 等登录态和 XSRF cookie 就位
    let best = null;
    for (let i = 0; i < 5; i++) {
      let j = null;
      try { j = JSON.parse(String(await p.ev(pullScript(uid, pages)) || '') || '{}'); } catch (e) {}
      if (j && j.items && j.items.length) { best = j; break; }
      await sleep(1500);
    }
    if (!best) throw new Error('没读到微博数据（先在调试浏览器登录 weibo.com，再重试）');
    return best;
  });
  CACHE_MEM = { url: url, at: Date.now(), data: got };
  return got;
}
export async function resolve(url) {
  const got = await grab(url, wantPages(url));
  const name = clean(got.who, 40);
  if (!name) throw new Error('没读出微博昵称，确认已在调试浏览器登录 weibo.com');
  const uid = uidOf(url);
  return { title: name, author: name + (uid ? ' (uid:' + uid + ')' : ''), desc: '', cover: null, status: '微博' };
}
export async function chapters(url) {
  const got = await grab(url, wantPages(url));
  const bid = bidOf(url);
  let list = got.items;
  if (bid) list = list.filter((x) => x.id === bid);
  if (!list.length) throw new Error('这条微博里没找到图片（微博动图/长图在 pics 里，视频作品不下）');
  return list.map((x, i) => ({ id: x.id, title: clean(x.text, 24) || ('t' + x.id), index: i + 1, order: i + 1, _pics: x.pics }));
}
export async function images(chapter) {
  if (chapter._pics && chapter._pics.length) {
    return chapter._pics.map((p) => ({ url: p.u, headers: { 'Referer': 'https://weibo.com/' } }));
  }
  throw new Error('这条微博没有图片数据');
}
