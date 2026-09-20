// E-Hentai 适配器(纯 HTTP, 不开浏览器) —— 一个画廊 = 一本书(整本一话)
// 只需要 cookie: _scripts/sites/cookies/e-hentai.org.txt (登录一次, node _scripts\jm\site-login.mjs e-hentai.org)
// 流程: 画廊页 → 翻 ?p=N 收集 /s/ 链接 → 并发打开每个 /s/ 页读 <img id="img"> 的直链
import { cookieHeader, hostOf } from './cookies.mjs';
export const id = 'ehentai';
export const label = 'E-Hentai';
export const home = 'https://e-hentai.org/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
export function match(url) { return /(^|\.|\/\/)(e-hentai|exhentai)\.org\//i.test(String(url || '') + '/'); }
export function galleryOf(url) {
  const m = String(url || '').match(/\/g\/(\d+)\/([0-9a-fA-F]+)/);
  return m ? { gid: m[1], token: m[2] } : null;
}
function hostFor(url) { const h = hostOf(url); return (h === 'exhentai.org' || /(^|\.)exhentai\.org$/.test(h)) ? 'exhentai.org' : 'e-hentai.org'; }
async function get(url, host, extra) {
  const hd = Object.assign({
    'User-Agent': UA,
    'Referer': 'https://' + host + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }, cookieHeader(host), extra || {});
  const r = await fetch(url, { headers: hd });
  return { status: r.status, url: r.url, text: await r.text() };
}
function failMsg(st, html) {
  if (st === 509) return new Error('E-Hentai 图片配额用尽(sad panda)，等一会儿再试，或减少一次下载的页数');
  if (st === 403) return new Error('被 E-Hentai 拦了(403)：先登录一次 node _scripts\\jm\\site-login.mjs e-hentai.org');
  if (html && html.indexOf('visible to logged-in users only') >= 0) return new Error('这个画廊只有登录用户能看：先登录 node _scripts\\jm\\site-login.mjs e-hentai.org');
  if (st !== 200) return new Error('E-Hentai 返回 HTTP ' + st);
  return null;
}
// 配额/权限这类"再试也没用"的错误: 带 fatal=true, 外层 fetch-book 会提前收工(已下的不丢, 重跑自动续下)
function fatalErr(msg) { const e = new Error(msg); e.fatal = true; return e; }
const FATAL_MSG = 'E-Hentai 图片配额用尽(sad panda)，已下载的话不会丢，等配额恢复后重跑会自动续下';
function titleOf(html) {
  const g1 = html.match(/<h1[^>]*id="gn"[^>]*>([\s\S]*?)<\/h1>/i);
  const g2 = html.match(/<h1[^>]*id="gj"[^>]*>([\s\S]*?)<\/h1>/i);
  const g3 = html.match(/<h1[^>]*id="g"\s*[^>]*>([\s\S]*?)<\/h1>/i);
  const t = (g1 && g1[1]) || (g3 && g3[1]) || '';
  const j = (g2 && g2[1]) || '';
  const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  return { en: strip(t), jp: strip(j) };
}
function sLinks(html) {
  const out = [];
  const re = /href="(https?:\/\/(?:e-hentai|exhentai)\.org\/s\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) { if (out.indexOf(m[1]) < 0) out.push(m[1]); }
  return out;
}
function imgOf(html) {
  const tag = html.match(/<img[^>]*id="img"[^>]*>/i) || html.match(/<img[^>]*id='img'[^>]*>/i);
  if (!tag) return '';
  const src = tag[0].match(/\ssrc="([^"]+)"/i);
  return src ? src[1] : '';
}
const CACHE = { url: '', at: 0, meta: null };
const CACHE_MS = 300000;
export async function resolve(url) {
  const g = galleryOf(url);
  if (!g) throw new Error('这不是画廊地址（形如 https://e-hentai.org/g/1234567/abcdef1234/）');
  if (CACHE.meta && CACHE.url === url && Date.now() - CACHE.at < CACHE_MS) return CACHE.meta;
  const host = hostFor(url);
  const r = await get('https://' + host + '/g/' + g.gid + '/' + g.token + '/', host);
  const bad = failMsg(r.status, r.text);
  if (bad) throw bad;
  const t = titleOf(r.text);
  const info = (r.text.match(/<div[^>]*id="gdd"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
  const tagList = [];          // 所有 tag 的显示文本(不再截前 40, fetch-book 写库时再限长)
  const artistTags = [];       // artist: 前缀的项, 作为作者
  const tre = /href="(https:\/\/(?:e-hentai|exhentai)\.org\/tag\/[^"?#]+)"[^>]*>([^<]+)<\/a>/g;
  let tm;
  while ((tm = tre.exec(r.text))) {
    const s2 = String(tm[2]).replace(/&amp;/g, '&').trim();
    if (!s2 || tagList.indexOf(s2) < 0) tagList.push(s2);
    const rawTag = decodeURIComponent(String(tm[1].split('/tag/')[1] || '')).replace(/\+/g, ' ');
    if (/^artist:/i.test(rawTag) && artistTags.indexOf(s2) < 0) {
      // 排除 AI 生成标记: artist:ai-generated 不是真人作者
      if (/^ai[ _\-]?generated|ai[ _\-]?绘画|ai[ _\-]?作画/i.test(s2)) continue;
      artistTags.push(s2);
    }
  }
  const meta = {
    tags: tagList,
    title: (t.en || t.jp || ('画廊 ' + g.gid)).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 90),
    author: artistTags.join(', '),
    desc: [t.jp, String(info).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' | ').slice(0, 300),
    cover: (function () { const cv = coverOf(r.text); return (cv && cv.thumb) ? cv.thumb : null; })(),
    coverCrop: (function () { const cv = coverOf(r.text); return cv ? { cl: 0, ct: 0, cw: cv.cw || 200, ch: cv.ch || 300 } : null; })(),   // 封面永远是雪碧图第一格
    status: 'E-Hentai',
  };
  CACHE.url = url; CACHE.at = Date.now(); CACHE.meta = meta;
  return meta;
}
export async function chapters(url) {
  const g = galleryOf(url);
  if (!g) throw new Error('这不是画廊地址（形如 https://e-hentai.org/g/1234567/abcdef1234/）');
  const meta = (CACHE.meta && CACHE.url === url) ? CACHE.meta : await resolve(url).then(() => CACHE.meta);
  return [{ id: g.gid + '-' + g.token, title: '全本', index: 1, order: 1, _eh: g, _meta: meta, _host: hostFor(url) }];
}
// 页清单(给"下载前预览"用): 直接读画廊页里已经排好的缩略图, 不额外打开 /s/ 页、不耗图片配额
// 返回 [{ n, url, thumb, pageUrl }] —— thumb 是 ehgt.org 的 200px 图(展示用), url 是能推断出的原图地址
// 从 <div title="Page N: 文件" style="... url(sprite) -Xpx Ypx ..."> 里抠出页号 / 缩略图 / 裁切位置
// 纯字符串解析(不用正则): 这类 HTML 的转义坑太多, 字符串切分最稳
// 从 <div title="Page N: 文件" style="... url(sprite) -Xpx Ypx ..."> 里抠出页号 / 缩略图 / 裁切位置
// 纯字符串解析(不用正则): 这类 HTML 的转义坑太多, 字符串切分最稳
// 把 sprite 里某一格裁成独立 PNG(给桌面版预览用)。只用 node 内置能力 + Electron 的 nativeImage:
// 自己写一个最小 PNG 编解码器, 省得为了一张缩略图去装 sharp/canvas。
function pngCrc(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tp = Buffer.from(type, "ascii");
  const body = Buffer.concat([tp, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const zlib = require("node:zlib");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
export async function cropSprite(buf, sx, sy, tw, th) {
  const { nativeImage } = await import("electron");
  const img = nativeImage.createFromBuffer(buf);
  if (!img || img.isEmpty()) throw new Error("sprite 解不出来");
  const size = img.getSize();
  const x = Math.max(0, Math.abs(sx || 0)), y = Math.max(0, Math.abs(sy || 0));
  const w = Math.min(tw || 200, size.width - x), h = Math.min(th || 292, size.height - y);
  if (w <= 0 || h <= 0) throw new Error("裁切范围超出 sprite");
  const cropped = img.crop({ x: x, y: y, width: w, height: h });
  try { const p = cropped.toPNG(); if (p && p.length > 100) return p; } catch (e) {}
  const bmp = cropped.toBitmap();
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * 4;
    rgba[s] = bmp[s + 2]; rgba[s + 1] = bmp[s + 1]; rgba[s + 2] = bmp[s]; rgba[s + 3] = bmp[s + 3];
  }
  return encodePng(rgba, w, h);
}

// 从已经抓到的画廊页 HTML 里取"第一张缩略图"当封面 —— 不用再跑 pageList(那要抓所有分页, 一本 16 秒)
export function coverOf(text) {
  try {
    let idx = 0;
    while (idx < text.length) {
      const a0 = text.indexOf('<a href="https://', idx);
      if (a0 < 0) break;
      idx = a0 + 1;
      const q0 = text.indexOf('"', a0 + 9);
      if (q0 < 0) break;
      const href = text.slice(a0 + 9, q0);
      if (href.indexOf('/s/') < 0) continue;
      const blk = text.slice(q0, Math.min(text.length, q0 + 600));
      const pb = parseThumbBlock(blk);
      if (pb && pb.thumb) return pb;
    }
  } catch (e) {}
  return null;
}

export function parseThumbBlock(blk) {
  if (!blk) return null;
var Q = String.fromCharCode(34);   // 双引号, 免得在各层转义里被吃掉
  var title = "";
  var i = blk.indexOf("title=" + Q);
  if (i >= 0) { i += 7; var j = blk.indexOf(Q, i); if (j > i) title = blk.slice(i, j); }
  var thumb = "", after = "";
  var k = blk.indexOf("url(");
  if (k >= 0) {
    var j2 = blk.indexOf(")", k);
    if (j2 > k) { thumb = blk.slice(k + 4, j2).trim(); after = blk.slice(j2 + 1, j2 + 40); }
  }
  if (!thumb) {
    var m = blk.indexOf("<img");
    if (m >= 0) { var a = blk.indexOf("src=" + Q, m); if (a >= 0) { var b2 = blk.indexOf(Q, a + 5); if (b2 > a) thumb = blk.slice(a + 5, b2); } }
  }
  var baseW = 0;
  var wm = blk.match(/width:(\d+)px/);
  if (wm) baseW = parseInt(wm[1], 10) || 0;
  var sx = 0, sy = 0, hasPos = false;
  if (after) {
    var t2 = after.trim();
    var j3 = t2.indexOf("px");
    if (j3 > 0) {
      var head = t2.slice(0, j3).trim();
      var rest2 = t2.slice(j3 + 2).trim();
      var j4 = rest2.indexOf("px");
      var head2 = j4 > 0 ? rest2.slice(0, j4).trim() : "";
      if (/^-?\d+$/.test(head)) {
        sx = -Math.abs(parseInt(head, 10) || 0);
        if (/^-?\d+$/.test(head2)) sy = -Math.abs(parseInt(head2, 10) || 0);
        hasPos = true;
      }
    }
  }
  if (!thumb) return null;
  var nm = title.match(/Page\s+(\d+)/i);
  return { thumb: thumb, n: nm ? parseInt(nm[1], 10) : 0, sx: sx, sy: sy, hasPos: hasPos, baseW: baseW };
}
export async function pageList(url) {
  const g = galleryOf(url);
  if (!g) throw new Error('这不是画廊地址（形如 https://e-hentai.org/g/1234567/abcdef1234/）');
  const host = hostFor(url);
  const pageUrl = 'https://' + host + '/g/' + g.gid + '/' + g.token + '/';
  const out = [];
  // 并行抓取: 实测每次请求约 435ms, 串行抓 7 页要 3.5s; 4 页一批并行后约 1s。
  // (?p=N 由我们自己递增, 所以能并行; 结束判据 = 某一批一张新图都没解析出来)
  const CHUNK = 4;
  async function fetchPage(pg) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await get(pageUrl + '?p=' + pg, host);
      if (r.status === 509) throw fatalErr(FATAL_MSG);
      if (r.status === 200 && r.text.indexOf('id="gdt"') >= 0) return r.text;
      const bad = failMsg(r.status, r.text);
      if (bad && r.status !== 200) throw bad;
      if (attempt < 2) await new Promise((res) => setTimeout(res, 900));
    }
    return null;
  }
  function parsePage(text) {
    let idx = 0, added = 0;
    while (idx < text.length) {
      const a0 = text.indexOf('<a href="https://', idx);
      if (a0 < 0) break;
      idx = a0 + 1;
      const q0 = text.indexOf('"', a0 + 9);
      if (q0 < 0) break;
      const href = text.slice(a0 + 9, q0);
      if (href.indexOf('/s/') < 0 || out.some((x) => x.pageUrl === href)) continue;
      const blk = text.slice(q0, Math.min(text.length, q0 + 600));
      const pb = parseThumbBlock(blk);
      if (!pb) continue;
      const o = { n: pb.n || (out.length + 1), pageUrl: href, thumb: pb.thumb, url: '' };
      if (pb.hasPos) { o.sx = pb.sx; o.sy = pb.sy; o.tw = 200; o.th = 292; }
      out.push(o);
      added++;
    }
    return added;
  }
  for (let base = 0; base < 400; base += CHUNK) {
    const texts = await Promise.all(Array.from({ length: CHUNK }, (_, k) => fetchPage(base + k).catch((err) => { if (err && err.fatal) throw err; return null; })));
    let added = 0;
    for (const tx of texts) { if (!tx) continue; added += parsePage(tx); }
    if (!added) break;
  }
  // 实测几何(2026-09-18, 4000x300 的 sprite): 每格就是 200x300, 整条 20 页; 页面给的 background-position 也是每页 200px。
  // 所以: 裁切矩形 left = (页序-1) * 200, 宽 285, 高 sprite 高。
  var STEP_X = 200, TILE_W = 200, TILE_H = 300;   // 实测: 每格 200x300, 整条 4000 宽 = 20 页, 与页面给的 background-position 步长 200 完全吻合
  var kept = out.filter(function (x) { return x.thumb; });
  // 偏移必须"每张 sprite 内重新计数": 实测一张 sprite 宽 4000 = 20 页 x 200px, 第 21 页起换新 sprite,
  // 如果还按整本第几页算(4000/4200...), 新 sprite 上没有那个位置 → 裁切失败(以前只出前 20 页就是这个原因)。
  var spriteUrl = null, inSprite = 0;
  kept.forEach(function (x) {
    if (x.thumb !== spriteUrl) { spriteUrl = x.thumb; inSprite = 0; }
    x.cl = inSprite * STEP_X;
    inSprite++;
    x.ct = 0;
    x.cw = TILE_W;
    x.ch = TILE_H;
    delete x.sx; delete x.sy; delete x.hasPos; delete x.baseW;
  });
  if (kept.length) console.log("  预览用缩略图: " + kept.length + " 页（直接读画廊页, 不打开 /s/ 页、不耗图片配额）");
  return kept;
}
export async function images(chapter) {
  const g = chapter._eh;
  if (!g) throw new Error('缺少画廊信息');
  const host = chapter._host || 'e-hentai.org';
  const links = [];
  for (let pg = 0; pg < 200; pg++) {
    // 区分"真的没有下一页"与"请求失败/被限流返回空页":
    //   - 509 配额用尽: 直接 fatal 收工
    //   - 其它非 200 / 没有画廊容器 id="gdt": 重试 2 次(间隔 1 秒), 仍失败才 break 并告警
    //   - 200 但确实没有新 /s/ 链接: 真的最后一页, 正常 break
    let r = null, pageOk = false;
    for (let attempt = 0; attempt < 3 && !pageOk; attempt++) {
      r = await get('https://' + host + '/g/' + g.gid + '/' + g.token + '/?p=' + pg, host);
      if (r.status === 509) throw fatalErr(FATAL_MSG);
      if (r.status === 200 && r.text.indexOf('id="gdt"') >= 0) { pageOk = true; break; }
      const loginBad = r.text && r.text.indexOf('visible to logged-in users only') >= 0;
      if (loginBad) throw failMsg(r.status, r.text);
      if (attempt < 2) await new Promise((res) => setTimeout(res, 1000));
    }
    if (!pageOk) {
      console.log('  警告: 第 ' + pg + ' 页多次请求失败或无画廊容器, 停止翻页(已收集 ' + links.length + ' 页)');
      break;
    }
    const got = sLinks(r.text);
    let added = 0;
    for (const u of got) if (links.indexOf(u) < 0) { links.push(u); added++; }
    if (pg === 0 || pg % 5 === 0) console.log('  正在数页数…已找到 ' + links.length + ' 页');
    try { process.stdout.write('@@PROG@@' + JSON.stringify({ stage: 'count', got: links.length, total: 0 }) + '\n'); } catch (e) {}
    if (!added) break;
  }
  console.log('  共 ' + links.length + ' 页，开始取图片地址…');
  if (!links.length) throw new Error('没在这个画廊里找到图片链接');
  const out = new Array(links.length);
  let idx = 0, doneN = 0, lastLog = 0;
  const tick = () => {
    doneN++;
    if (doneN - lastLog >= 10 || doneN === links.length) { lastLog = doneN; console.log('  取图片地址 ' + doneN + '/' + links.length); }
    if (process.stdout && process.stdout.write) {
      try { process.stdout.write('@@PROG@@' + JSON.stringify({ stage: 'resolve', got: doneN, total: links.length }) + '\n'); } catch (e) {}
    }
  };
  const worker = async () => {
    while (idx < links.length) {
      const i = idx++;
      for (let a = 0; a < 3; a++) {
        try {
          const r = await get(links[i], host);
          // 取图片直链阶段: 509/403 是配额/封禁, 重试无用, 直接 fatal 收工
          if (r.status === 509 || r.status === 403) throw fatalErr(FATAL_MSG);
          if (r.status !== 200) continue;
          const src = imgOf(r.text);
          if (src) { out[i] = src; break; }
        } catch (e) { if (e && e.fatal) throw e; await new Promise((res) => setTimeout(res, 600 * (a + 1))); }
      }
      tick();
    }
  };
  const JOBS = Math.max(1, Math.min(8, parseInt(process.env.EH_JOBS || '4', 10) || 4));   // 默认 4 路并发(可 EH_JOBS=6 调高)
  await Promise.all(Array.from({ length: JOBS }, () => worker()));
  const urls = out.filter(Boolean);
  if (!urls.length) throw new Error('没拿到图片直链（可能配额用尽或需要登录）');
  return urls.map((u) => ({ url: u, headers: { 'Referer': 'https://' + host + '/', 'User-Agent': UA } }));
}

/* ================= Tag 批量下载 ================= */
// 判断是否为 tag 页 URL(如 https://e-hentai.org/tag/cosplayer:iruri 或带 ?next=NNN)
export function matchTag(url) {
  return /^https?:\/\/(?:e-hentai|exhentai)\.org\/tag\//i.test(String(url || ''));
}
function resolveUrl(base, ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  try { return new URL(ref, base).href; } catch (e) { return null; }
}
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
export async function search(kw, page) {
  const p = Math.max(1, parseInt(page || 1, 10) || 1);
  const host = 'e-hentai.org';
  const url = 'https://' + host + '/?f_search=' + encodeURIComponent(String(kw || '')) + '&page=' + (p - 1);
  const r = await get(url, host);
  if (r.status === 403 || r.status === 509) throw failMsg(r.status, r.text);
  const out = [];
  const linkRe = /href="(https?:\/\/(?:e-hentai|exhentai)\.org\/g\/(\d+)\/([0-9a-f]+)\/?)"[^>]*>/gi;
  let bm;
  const seen = {};
  while ((bm = linkRe.exec(r.text))) {
    const gid = bm[2], token = bm[3], key = gid + '/' + token;
    if (seen[key]) continue; seen[key] = 1;
    const win = r.text.substr(bm.index, 1200);
    let title = '';
    let tm = win.match(/<img[^>]+alt="([^"]+)"/i);
    if (!tm) tm = win.match(/class="glink"[^>]*>([\s\S]*?)<\/div>/i);
    if (tm) title = stripHtml(tm[1]).trim();
    title = title || ('画廊 ' + gid);
    const im = win.match(/<img[^>]+src="(https?:\/\/ehgt\.org[^"]+)"/i) || win.match(/<img[^>]+src="([^"]+)"/i);
    const thumb = im ? im[1] : '';
    const pm = win.match(/<div>(\d+)\s*pages?<\/div>/i);
    out.push({ title: title, author: '', url: bm[1], cover: thumb, extra: pm ? (parseInt(pm[1], 10) + ' 页') : '' });
  }
  return out;
}
// 遍历 tag 所有分页, 收集画廊链接; 每页最多 25 个, 翻 ?next=XXX 直到没有下一页
export async function tagGalleries(url, opts) {
  const host = hostFor(url);
  const out = [];
  const seen = {};
  let nextUrl = url;
  let page = 0;
  const maxPages = (opts && opts.maxPages) ? opts.maxPages : 500;
  while (nextUrl && page < maxPages) {
    page++;
    const r = await get(nextUrl, host);
    if (r.status === 509 || r.status === 403) throw fatalErr(FATAL_MSG);
    const bad = failMsg(r.status, r.text);
    if (bad) throw bad;
    // 找所有画廊链接, 每个 gid 只取一次; 标题在链接附近的 HTML 里找
    const linkRe = /href="(https?:\/\/(?:e-hentai|exhentai)\.org\/g\/(\d+)\/([0-9a-f]+)\/?)"[^>]*>/gi;
    const pageStart = out.length;   // 本页新增的起点(流式回调要用)
    let bm, added = 0;
    while ((bm = linkRe.exec(r.text))) {
      const gid = bm[2], token = bm[3];
      const key = gid + '/' + token;
      if (seen[key]) continue;
      seen[key] = 1;
      // 取链接后 ~1200 字符的窗口(标题链接在缩略图链接后面约 800 字符)
      const win = r.text.substr(bm.index, 1200);
      let title = '';
      // 最稳: 缩略图 <img alt="标题"> 或 <img title="标题">
      let tm = win.match(/<img[^>]+alt="([^"]+)"/i);
      if (!tm) tm = win.match(/<img[^>]+title="([^"]+)"/i);
      // 其次: <div class="glink">标题</div>
      if (!tm) tm = win.match(/class="glink"[^>]*>([\s\S]*?)<\/div>/i);
      if (!tm) tm = win.match(/class="glname"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
      if (tm) title = stripHtml(tm[1]).trim();
      title = title || ('画廊 ' + gid);
      const im = win.match(/<img[^>]+src="(https?:\/\/ehgt\.org[^"]+)"/i) || win.match(/<img[^>]+src="([^"]+)"/i);
      const thumb = im ? im[1] : '';
      // 页数: <div>60 pages</div> 或 <div>1 page</div>
      const pm = win.match(/<div>(\d+)\s*pages?<\/div>/i);
      const pages = pm ? parseInt(pm[1], 10) : 0;
      out.push({ gid: gid, token: token, title: title, thumb: thumb, pages: pages, url: bm[1] });
      added++;
    }
    // 下一页: ?next=NNN
    const nextM = r.text.match(/href="([^"]*[?&]next=[0-9]+[^"]*)"/i);
    nextUrl = nextM ? resolveUrl(nextUrl, nextM[1]) : null;
    console.log('  tag 翻页 ' + page + ': 本页新增 ' + added + ', 累计 ' + out.length + ' 个画廊');
    if (opts && typeof opts.onBatch === 'function') {
      try { opts.onBatch(out.slice(pageStart), page, out.length, nextUrl); } catch (e) {}
    }
  }
  return out;
}
