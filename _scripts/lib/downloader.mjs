/**
 * xmanhua 下载核心 (可被 CLI 和 Electron 主进程共同调用)
 * 只抓取图片文件本身, 不含任何页面/广告/脚本内容。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const SITE = 'https://www.xmanhua.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getBuf(url, referer, tries, signal) {
  tries = tries || 3;
  let lastErr;
  return (async function () {
    for (let a = 0; a < tries; a++) {
      if (signal && signal.aborted) throw new Error('已取消');
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': UA, 'Referer': referer || SITE + '/', 'Accept-Language': 'zh-CN,zh;q=0.9' },
          signal: signal || AbortSignal.timeout(45000)
        });
        if (!r.ok) lastErr = new Error('HTTP ' + r.status);
        else return Buffer.from(await r.arrayBuffer());
      } catch (e) {
        if (signal && signal.aborted) throw new Error('已取消');
        lastErr = e;
      }
      await new Promise(function (s) { setTimeout(s, 700 * (a + 1)); });
    }
    throw lastErr || new Error('fetch failed');
  })();
}

function unpack(src) {
  const ctx = vm.createContext(Object.create(null));
  const code = src + ';globalThis.__r={d:(typeof d!=="undefined"?d:null),hd:(typeof hd_c!=="undefined"?hd_c:null)};';
  vm.runInContext(code, ctx, { timeout: 5000 });
  return ctx.__r;
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const mk = buf[o + 1];
    if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { o += 2; continue; }
    if (mk === 0xff) { o++; continue; }
    const len = buf.readUInt16BE(o + 2);
    if (len < 2) return null;
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
      return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
    }
    o += 2 + len;
  }
  return null;
}
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
export function imgSize(b) { return jpegSize(b) || pngSize(b); }

const CRC_T = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); } t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) { c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); } return (c ^ -1) >>> 0; }

export function zipStore(files) {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nb = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data), sz = f.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(sz, 18); lh.writeUInt32LE(sz, 22);
    lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nb, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(sz, 20);
    ch.writeUInt32LE(sz, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nb);
    offset += 30 + nb.length + sz;
  }
  const cdStart = offset;
  let cdSize = 0; for (const c of central) { cdSize += c.length; }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat(parts.concat(central, [eocd]));
}

async function pool(items, n, fn, onTick) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async function () {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
      if (onTick) onTick();
    }
  });
  await Promise.all(workers);
  return out;
}

export async function listChapters(comic, signal) {
  const html = (await getBuf(SITE + comic, SITE + '/', 3, signal)).toString('utf8');
  const out = [];
  const re = /href="(\/m\d+\/)"[^>]*class="detail-list-form-item[^"]*"[^>]*>([^<]*)/g;
  let m; const seen = new Map();
  while ((m = re.exec(html))) {
    const url = m[1], raw = m[2].trim();
    const num = parseInt((raw.match(/(\d+)/) || [])[1] || '0', 10);
    const n = (seen.get(num) || 0) + 1; seen.set(num, n);
    out.push({ url: url, raw: raw, num: num, dupIndex: n, isPreview: /試看|试看/.test(raw) });
  }
  return out;
}

function decodeEnt(s) {
  return String(s).split('&quot;').join('"').split('&#39;').join("'").split('&amp;').join('&')
    .split('&lt;').join('<').split('&gt;').join('>').split('&nbsp;').join(' ').trim();
}

/** 抓取 书名 / 简介 / 封面 */
export async function resolveMeta(slug, signal) {
  const out = { title: null, desc: null, cover: null };
  try {
    const r = await fetch(SITE + '/' + slug + '/', { headers: { 'User-Agent': UA, 'Referer': SITE + '/' }, signal: signal || AbortSignal.timeout(20000) });
    if (!r.ok) return out;
    const h = await r.text();
    const one = function (re) { const m = h.match(re); return m ? decodeEnt(m[1]) : null; };

    out.title = one(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)/i);
    if (!out.title) {
      const t = h.match(/<title>([^<]*)<\/title>/i);
      if (t) {
        let s = decodeEnt(t[1]);
        const c1 = s.indexOf('漫畫'), c2 = s.indexOf('漫画');
        const cut = c1 >= 0 ? c1 : c2;
        if (cut > 0) s = s.slice(0, cut);
        s = s.replace(/[_|].*$/, '').trim();
        if (s) out.title = s;
      }
    }
    out.desc = one(/<meta[^>]+name=["']Description["'][^>]+content=["']([^"']*)/i)
            || one(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']Description["']/i)
            || one(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i);
    out.cover = one(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)/i)
             || one(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i);
  } catch (e) {}
  return out;
}

export async function resolveTitle(slug, signal) {
  const m = await resolveMeta(slug, signal);
  return m.title;
}

export function safeName(s) {
  const out = String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 80);
  return out || '未命名';
}

export async function chapterImages(ch, opt, signal) {
  const html = (await getBuf(SITE + ch.url, SITE + opt.comic, 3, signal)).toString('utf8');
  const g = function (k) { const r = html.match(new RegExp('var ' + k + '\\s*=\\s*"?([^";]*)')); return r ? r[1] : undefined; };
  const cid = g('XMANHUA_CID'), mid = g('XMANHUA_MID');
  const count = parseInt(g('XMANHUA_IMAGE_COUNT') || '0', 10);
  const sign = g('XMANHUA_VIEWSIGN'), dt = g('XMANHUA_VIEWSIGN_DT');
  if (!cid || !count) throw new Error('metadata parse failed for ' + ch.url);

  const pages = Array.from({ length: count }, function (_, i) { return i + 1; });
  const urls = await pool(pages, opt.apiConcurrency, async function (p) {
    const qs = new URLSearchParams({ cid: cid, page: String(p), key: '', _cid: cid, _mid: mid, _dt: dt, _sign: sign });
    const body = (await getBuf(SITE + ch.url + 'chapterimage.ashx?' + qs.toString(), SITE + ch.url, 3, signal)).toString('utf8');
    const r = unpack(body);
    return { page: p, url: (r.d && r.d[0]) ? r.d[0] : null, hd: (r.hd && r.hd[0]) ? r.hd[0] : null };
  });
  return {
    cid: cid, count: count,
    urls: urls.map(function (u) { return u.hd || u.url; }),
    hdCount: urls.filter(function (u) { return u.hd; }).length
  };
}

/** 下载一整本漫画. onEvent 收到进度事件. 返回汇总. */
export async function downloadComic(opts, onEvent) {
  const emit = onEvent || function () {};
  const comic = opts.comic;
  const out = opts.out;
  const signal = opts.signal;
  const opt = {
    comic: comic,
    concurrency: opts.concurrency || 8,
    apiConcurrency: opts.apiConcurrency || 6
  };

  const all = await listChapters(comic, signal);
  let todo;
  if (opts.only) {
    todo = opts.only.map(function (k) {
      const dup = String(k).endsWith('b');
      const n = parseInt(k, 10);
      return all.find(function (c) { return c.num === n && c.dupIndex === (dup ? 2 : 1); });
    }).filter(Boolean);
  } else {
    const from = opts.from || 1, to = opts.to || 9999;
    todo = all.filter(function (c) { return c.num >= from && c.num <= to; });
  }

  fs.mkdirSync(out, { recursive: true });
  emit({ type: 'start', total: todo.length, comic: comic, out: out });

  const report = [];
  let grandImages = 0, grandBytes = 0;

  for (let idx = 0; idx < todo.length; idx++) {
    if (signal && signal.aborted) { emit({ type: 'cancelled' }); break; }
    const ch = todo[idx];
    const label = '第' + String(ch.num).padStart(2, '0') + '話' + (ch.dupIndex > 1 ? '_v' + ch.dupIndex : '');
    const dir = path.join(out, label);
    emit({ type: 'chapter-start', index: idx, total: todo.length, label: label, cid: ch.url.replace(/\D/g, '') });

    try {
      const info = await chapterImages(ch, opt, signal);
      fs.mkdirSync(dir, { recursive: true });

      let doneCount = 0;
      const results = await pool(info.urls, opt.concurrency, async function (u, i) {
        const name = String(i + 1).padStart(3, '0') + '.jpg';
        const fp = path.join(dir, name);
        if (!opts.force && fs.existsSync(fp) && fs.statSync(fp).size > 1024) {
          const b = fs.readFileSync(fp);
          return { name: name, ok: true, size: b.length, dim: imgSize(b), cached: true };
        }
        if (!u) return { name: name, ok: false, reason: 'no-url' };
        try {
          const b = await getBuf(u, SITE + ch.url, 3, signal);
          const dim = imgSize(b);
          if (b.length < 1024 || !dim) return { name: name, ok: false, reason: 'bad-payload ' + b.length };
          fs.writeFileSync(fp, b);
          return { name: name, ok: true, size: b.length, dim: dim };
        } catch (e) { return { name: name, ok: false, reason: e.message }; }
      }, function () {
        doneCount++;
        emit({ type: 'chapter-progress', index: idx, label: label, done: doneCount, images: info.urls.length });
      });

      const ok = results.filter(function (r) { return r.ok; });
      const bad = results.filter(function (r) { return !r.ok; });
      const widths = Array.from(new Set(ok.map(function (r) { return r.dim && r.dim.w; }).filter(Boolean))).sort(function (a, b) { return a - b; });
      let bytes = 0; for (const r of ok) { bytes += (r.size || 0); }
      grandImages += ok.length; grandBytes += bytes;

      let cbz = false;
      if (opts.cbz !== false && bad.length === 0 && ok.length === info.count) {
        const sorted = ok.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        const files = sorted.map(function (r) { return { name: r.name, data: fs.readFileSync(path.join(dir, r.name)) }; });
        fs.writeFileSync(path.join(out, label + '.cbz'), zipStore(files));
        cbz = true;
      }

      const rec = {
        label: label, cid: info.cid, expected: info.count, got: ok.length,
        failed: bad.map(function (f) { return f.name; }), bytes: bytes,
        widths: widths, hdAvailable: info.hdCount, preview: ch.isPreview, cbz: cbz
      };
      report.push(rec);
      emit({ type: 'chapter-done', index: idx, total: todo.length, label: label, got: ok.length,
             expected: info.count, bytes: bytes, widths: widths, cbz: cbz, failed: rec.failed });
    } catch (e) {
      if (signal && signal.aborted) { emit({ type: 'cancelled' }); break; }
      report.push({ label: label, error: String(e && e.message || e) });
      emit({ type: 'chapter-error', index: idx, total: todo.length, label: label, message: String(e && e.message || e) });
    }
  }

  // 写报告
  try {
    const lines = [];
    lines.push('漫画下载报告');
    lines.push('来源: ' + SITE + comic);
    lines.push('生成时间: ' + new Date().toLocaleString('zh-CN'));
    lines.push('说明: 仅下载漫画图片文件本身, 不含网站任何页面/广告/脚本内容; 图片为站内原始文件, 未做转码或压缩。');
    lines.push('');
    for (const r of report) {
      if (r.error) { lines.push('[' + r.label + '] 失败: ' + r.error); continue; }
      lines.push('[' + r.label + '] cid=' + r.cid + '  图片 ' + r.got + '/' + r.expected + '  ' +
        (r.bytes / 1048576).toFixed(2) + ' MB  宽度: ' + r.widths.join('/') + 'px' +
        (r.cbz ? '  CBZ: 已生成' : '') + (r.failed.length ? '  !! 缺页: ' + r.failed.join(',') : ''));
    }
    lines.push('');
    lines.push('合计: ' + report.length + ' 话, ' + grandImages + ' 张图, ' + (grandBytes / 1073741824).toFixed(2) + ' GB');
    fs.writeFileSync(path.join(out, '_下载报告.txt'), lines.join('\r\n'), 'utf8');
  } catch (e) {}

  const summary = { chapters: report.length, images: grandImages, bytes: grandBytes, report: report };
  emit({ type: 'done', summary: summary });
  return summary;
}
