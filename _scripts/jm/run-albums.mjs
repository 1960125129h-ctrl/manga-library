
// 多连接测试: 每个专辑一个专用页面(各自只开一个链接), 验证码环节全局串行(同一会话只有一张验证码有效)
// 用法: node run-albums.mjs <url1> [url2] [url3] ...
import fs from 'node:fs';
import { requirePython } from '../lib/python.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { openPage, sleep } from './cdp.mjs';
import { normTargets } from './target.mjs';

const T0 = Date.now();
const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const CAT = '漫画';
const DL = path.join(process.env.USERPROFILE || '', 'Downloads');
const STAGE = path.join(LIB, '_zips');
const PY = requirePython('禁漫下载(要 拼页/切页校验)');
const PORT = Number(process.env.JM_PORT || 9333);
const urls = normTargets(process.argv.slice(2));   // JM1452133 / 纯数字 / 专辑链接 / 单话链接 都认
const argNum = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); const v = m ? parseInt(m.split('=')[1], 10) : NaN; return isFinite(v) ? v : d; };
const FROM = argNum('from', 1), TO = argNum('to', 99999);   // 只下第 FROM~TO 话(默认全部)
const BOOK_DIRS = new Set();   // 本次真正动过的书目录(相对 LIB)，收尾只重建这些
const STAGGER_MS = parseInt((process.argv.find(a => a.startsWith('--stagger=')) || '').split('=')[1] || '3500', 10);   // 并发提交间隔, 默认 3.5 秒
// --img: 跳过「点免等待 → 验证码 OCR → 表单提交 → 收 zip → 解压」整条重链路，
//        改为图片 CDN 直取（图片域名不挂 Cloudflare、无验证码，实测单话 1.7~2.9 秒）。
const IMG_MODE = process.argv.includes('--img') || process.env.JM_IMG === '1';
const IMG_WORKERS = parseInt((process.argv.find(a => a.startsWith('--img-workers=')) || '').split('=')[1] || '12', 10);
fs.mkdirSync(STAGE, { recursive: true });
console.log('多连接测试: ' + urls.length + ' 个专辑, 每专辑一个专用页面');

// 浏览器级连接(开/关页面)
const ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { bws.onopen = res; bws.onerror = () => rej(new Error('browser ws')); });
let bid = 0; const bpend = new Map();
bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && bpend.has(m.id)) { const q = bpend.get(m.id); bpend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } };
const bsend = (method, params) => new Promise((res, rej) => { const id = ++bid; bpend.set(id, { res, rej }); bws.send(JSON.stringify({ id, method, params: params || {} })); });

// 共享 OCR: 只有老方式(浏览器过 CF + 验证码 + 收 zip)才需要; 图片直取模式不启动它
// 打包版不含 ocr_server.py, 走到老方式时直接明确报错, 不留半截状态
let py = null;
let ocrAsk = null;
const q = [], waiters = []; let obuf = '';
if (!IMG_MODE) {
  const OCR = path.join(WORK, 'ocr_server.py');
  if (!fs.existsSync(OCR)) { console.error('  [缺少验证码识别组件] 老方式需要它; 请用图片直取(--img)'); process.exit(2); }
  py = spawn(PY, [OCR], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  py.stdout.on('data', (d) => { obuf += d.toString(); let i; while ((i = obuf.indexOf('\n')) >= 0) { const l = obuf.slice(0, i).trim(); obuf = obuf.slice(i + 1); if (!l || l === 'READY') continue; if (waiters.length) waiters.shift()(l); else q.push(l); } });
  py.stderr.on('data', () => {});
  ocrAsk = (f) => new Promise((res) => { if (q.length) return res(q.shift()); waiters.push(res); py.stdin.write(f + '\n'); });
}

// 全局互斥: 取验证码 -> 识别 -> 提交 必须原子完成
let chain = Promise.resolve();
const withCaptchaLock = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => {}, () => {}); return run; };

const capTag = (i) => path.join(WORK, 'cap-' + i + '.jpg');

function zipOk(f) { try { execSync('tar.exe -tf "' + f + '"', { stdio: "ignore" }); return true; } catch (e) { return false; } }

function stitch(chDir) {
  try {
    const rep = execSync('"' + PY + '" "' + path.join(WORK, 'stitch-pages.py') + '" "' + chDir + '"', { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    return rep.trim().split('\n');
  } catch (e) { return ['校验失败: ' + String(e.message).slice(0, 100)]; }
}

let activeWorkers = 0;
async function worker(url, idx) {
  activeWorkers++;
  try { return await workerInner(url, idx); } finally { activeWorkers--; }
}
async function workerInner(url, idx) {
  const tag = '[专辑' + (idx + 1) + ']';
  const { targetId } = await bsend('Target.createTarget', { url });
  const p = await openPage(PORT, targetId);
  await p.goto(url);
  try { const m2 = await import('./cdp.mjs'); await m2.closePopups(p); await m2.passAgeGate(p); } catch (e2) {}
  await sleep(1500);
  const info = JSON.parse(await p.ev('JSON.stringify({title:(document.querySelector("h1")||{}).textContent?document.querySelector("h1").textContent.trim():"",links:Array.from(document.querySelectorAll("a[data-album][data-index]")).map(a=>({i:parseInt(a.getAttribute("data-index"),10)+1,id:a.getAttribute("data-album")})),url:location.href})'));
  let rawTitle = info.title;
  if (!rawTitle) rawTitle = await p.ev('String((document.querySelector("meta[property=\'og:title\']")||{}).content||document.title||"").replace(/\\s*[|｜]\\s*[^|｜]*$/,"").trim()');
  rawTitle = (rawTitle || '').replace(/^第\d+[話话]\s*/, '').trim() || ('JM' + (chapters[0] && chapters[0].id || ''));   // 单话页标题常是"第N话 xxx"
  const title = rawTitle.replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);
  let chapters = [];
  const seen = new Set();
  for (const l of (info.links || [])) { if (!seen.has(l.i)) { seen.add(l.i); chapters.push(l); } }
  chapters.sort((a, b) => a.i - b.i);
  // 单话(/photo/<id>)或专辑页没有章节列表时: 就把这一页本身当第 1 话下
  if (!chapters.length) { const m = info.url.match(/album\/(\d+)/) || info.url.match(/photo\/(\d+)/); chapters = [{ i: 1, id: m ? m[1] : '' }]; }

  let authors = '';
  try {
    authors = JSON.parse(await p.ev('JSON.stringify(Array.from(document.querySelectorAll(\'span[itemprop="author"][data-type="author"]\')).map(function(e){return e.textContent.replace(/\\s+/g," ").trim()}).filter(Boolean))')).filter(function(v,i,a){return v && a.indexOf(v) === i}).join(' / ');
  } catch (e) {}
  if (authors) console.log(tag + ' 作者: ' + authors);

  const bookDir = path.join(LIB, CAT, title);
  const done = new Set();
  if (fs.existsSync(bookDir)) for (const e of fs.readdirSync(bookDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const m = e.name.match(/^第(\d+)[話话]$/); if (!m) continue;
    if (fs.readdirSync(path.join(bookDir, e.name)).some(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f))) done.add(parseInt(m[1], 10));
  }
  const todo = chapters.filter(c => !done.has(c.i) && c.i >= FROM && c.i <= TO);
  if (!todo.length && done.size) console.log(tag + ' 已下载过：' + title.slice(0, 34) + '（' + done.size + ' 话已在库，跳过）');
  else console.log(tag + ' ' + title.slice(0, 34) + ' | 共 ' + chapters.length + ' 话, 已下载过 ' + done.size + ' 话跳过, 本次下 ' + todo.length + ' 话 (+' + ((Date.now() - T0) / 1000).toFixed(1) + 's)');
  if (!todo.length) { await bsend('Target.closeTarget', { targetId }); return { title, todo: 0, ok: 0, secs: (Date.now() - T0) / 1000 }; }

  await p.goto('https://18comic.vip/album_download/' + todo[0].id);
  await sleep(600);
  const hasForm = await p.ev('!!document.querySelector("#album_down")');
  if (!hasForm) { console.log(tag + ' 下载页无表单, 放弃'); await bsend('Target.closeTarget', { targetId }); return { title, todo: todo.length, ok: 0, secs: 0 }; }

  const capGet = () => p.ev('(async()=>{const r=await fetch("https://18comic.vip/captcha/?t="+Date.now(),{credentials:"include",cache:"no-store"});const b=new Uint8Array(await r.arrayBuffer());let s="";for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);})()');
  const submit = (id, ans) => p.ev('(function(){var f=document.querySelector("#album_down");if(!f)return "noform";f.setAttribute("action","https://18comic.vip/album_download/' + id + '");var a=f.querySelector("input[name=album_id]");if(a)a.value="' + id + '";var i=document.querySelector("#invite_verification");if(i)i.value=' + JSON.stringify(String(ans)) + ';var b=document.querySelector("#download_submit");if(b){b.click();return "clicked";}f.submit();return "submitted";})()');

  const tabsNow = async () => { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); return l.filter(function (t) { return t.type === 'page'; }).map(function (t) { return { id: t.id, url: t.url }; }); } catch (e) { return []; } };
  // 点「免等待、點我直接下載」: 会弹一个广告页 + 露出验证码表单; 弹窗立刻关掉
  const clickTriggerAndCloseAds = async () => {
    const before = await tabsNow();
    try { await p.ev('(function(){var a=document.querySelector(".triggerpop"); if(a) a.click(); var i=document.querySelector("#invite_verification"); if(i) i.value=""; return 1;})()'); } catch (e) {}
    await sleep(900);
    const after = await tabsNow();
    for (const t of after) {
      if (t.id === targetId) continue;
      if (before.some(function (b) { return b.id === t.id; })) continue;
      try { await bsend('Target.closeTarget', { targetId: t.id }); console.log('[广告页已关闭] ' + String(t.url).slice(0, 60)); } catch (e) {}
    }
  };

  const collect = async (id) => {
    // 只要看到该话的包体出现就算成功(不做稳定性/临时文件判断)
    const pat = new RegExp('^' + id + '( \\(\\d+\\))?\\.zip$');
    for (let i = 0; i < 480; i++) {
      await sleep(250);
      let sz = 0;
      try {
        for (const f of fs.readdirSync(DL)) {
          if (!pat.test(f)) continue;
          const s = fs.statSync(path.join(DL, f)).size;
          if (s > 20000 && s > sz) sz = s;
        }
      } catch (e) {}
      if (sz) return sz;
    }
    return 0;
  };

  let ok = 0;
  const chTimes = [];
  const failed = [];
  const doChapter = async (ch) => {
    const t0 = Date.now();
    if (activeWorkers > 1) await sleep(300);   // 多连接时错开提交, 减少会话级争用
    const staged = path.join(STAGE, ch.id + '.zip');
    let cands = [], sz = 0;
    if (fs.existsSync(staged) && fs.statSync(staged).size > 20000 && zipOk(staged)) {
      cands = ['暂存']; sz = fs.statSync(staged).size;
      console.log(tag + ' 第' + ch.i + '話 命中暂存 zip(不重新下载) ' + (sz / 1048576).toFixed(2) + 'MB');
    } else {
    const r = await withCaptchaLock(async () => {
          await clickTriggerAndCloseAds();   // 先点免等(会弹广告页)并关掉弹窗, 表单才露出来
          let c = [];
          for (let round = 1; round <= 4; round++) {
            try {
              const b64 = await capGet();
              fs.writeFileSync(capTag(idx), Buffer.from(b64, "base64"));
              const line = await ocrAsk(capTag(idx));
              c = (JSON.parse(line.replace(/^RESULT\s*/, "")).cands) || [];
              if (c.length) { await submit(ch.id, c[0]); break; }
            } catch (e) {}
          }
          if (!c.length) return { cands: [], sz: 0 };
          // 全局串行: 提交与收包都在锁内 -> 同一时刻只有一个下载在途
          const z = await collect(ch.id);
          return { cands: c, sz: z };
        });
        cands = r.cands; sz = r.sz;   // 必须赋值给外层变量, 不能 const 遮蔽(否则外层 sz 恒为 0, 会误判失败并重复下载)
    }
    if (!sz) {
      let pg = '';
      try { const t2 = String(await p.ev('document.body.innerText.replace(/\\s+/g," ")') || ''); pg = (t2.indexOf('驗證代碼無效') >= 0 ? '验码无效! ' : '') + t2.slice(-120); } catch (e) { pg = '(取文本失败)'; }
      console.log(tag + ' 第' + ch.i + '話 未拿到 zip | 页面回显: ' + pg);
      return false;
    }
    // 解压 + 入库 + 校验 + 删 zip
    const dst = path.join(STAGE, ch.id + '.zip');
    const pat = new RegExp('^' + ch.id + '( \\(\\d+\\))?\\.zip$');
    const got = fs.readdirSync(DL).filter(function (f) { return pat.test(f); })
      .map(function (f) { return { f: f, t: fs.statSync(path.join(DL, f)).mtimeMs }; })
      .sort(function (a, b) { return b.t - a.t; })[0];
    if (got && !fs.existsSync(dst)) {
      const zip = path.join(DL, got.f);
      try { fs.renameSync(zip, dst); } catch (e) { fs.copyFileSync(zip, dst); fs.unlinkSync(zip); }
    }
    const tmp = path.join(STAGE, '.x' + ch.id);
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    let unzipped = false;
    for (let t = 0; t < 6 && !unzipped; t++) {
      try { execSync('tar.exe -xf "' + dst + '" -C "' + tmp + '"'); unzipped = true; }
      catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); await sleep(2000); }
    }
    if (!unzipped) { console.log(tag + ' 第' + ch.i + '話 zip 解不开(可能仍在写入)'); return false; }
    const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const s = path.join(d, e.name); if (e.isDirectory()) walk(s, out); else if (/\.(webp|jpg|jpeg|png|gif)$/i.test(e.name)) out.push(s); } return out; };
    const chDir = path.join(LIB, CAT, title, '第' + String(ch.i).padStart(2, '0') + '話');
    fs.mkdirSync(chDir, { recursive: true });
    for (const f of walk(tmp).sort()) fs.copyFileSync(f, path.join(chDir, path.basename(f)));
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.unlinkSync(dst);
    const rep = stitch(chDir);
    const pages = fs.readdirSync(chDir).filter(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)).length;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    chTimes.push(+secs);
    BOOK_DIRS.add(path.relative(LIB, path.join(LIB, CAT, title)).replace(/\\/g, '/'));
    console.log(tag + ' 第' + ch.i + '話 OK ' + (sz / 1048576).toFixed(2) + 'MB ' + pages + '页 候选=' + cands[0] + ' 本话 ' + secs + 's | ' + rep[1]);
    return true;
  };

  if (IMG_MODE) {
    // ---- 图片直取：浏览器只用来拿章节表（上面已完成），图片走 CDN 并发下载 ----
    console.log(tag + ' [直取] ' + todo.length + ' 话，并发 ' + IMG_WORKERS + '（跳过验证码/zip）');
    const pyImg = path.join(WORK, 'jm-img.py');
    const r = spawnSync(PY, [pyImg, ...todo.map(c => c.id), '--book', title, '--lib', LIB,
      '--start', String(todo[0].i), '--workers', String(IMG_WORKERS)],
      { encoding: 'utf8', timeout: 6 * 3600 * 1000 });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) console.log(tag + ' [直取] python 退出码 ' + r.status);
    // jm-img 会做简繁同名匹配，实际落的目录名可能与本页解析出的不同，以它返回的为准
    try {
      const mm = String(r.stdout || '').match(/__JSON__(.+)/);
      if (mm) {
        const j = JSON.parse(mm[1].trim());
        for (const a of (j.albums || [])) if (a.dir && fs.existsSync(a.dir)) BOOK_DIRS.add(path.relative(LIB, a.dir).replace(/\\/g, '/'));
      }
    } catch (e3) {}
    for (const ch of todo) {
      const dir = path.join(LIB, CAT, title, '第' + String(ch.i).padStart(2, '0') + '話');
      const n = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)).length : 0;
      if (n > 0) {
        ok++;
        console.log(tag + ' 第' + ch.i + '話 OK ' + n + ' 页（直取，已跳过切页拼合）');
      } else failed.push(ch);
    }
  } else {
    for (const ch of todo) { if (await doChapter(ch)) ok++; else failed.push(ch); }
    for (let pass = 2; pass <= 5 && failed.length; pass++) {
      console.log(tag + ' 重试第 ' + pass + ' 轮 (' + failed.length + ' 话)');
      await sleep(2000);
      const still = [];
      for (const ch of failed) { if (await doChapter(ch)) ok++; else still.push(ch); }
      failed.length = 0; failed.push(...still);
    }
  }
  if (failed.length) console.log(tag + ' 仍未成功: ' + failed.map(f => f.i).join(','));
  // 写 library.json: 简介 + 来源 + 作者
  try {
    const libFile = path.join(LIB, 'library.json');
    const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
    const key = CAT + '/' + title;
    const prev = lib.comics[key] || {};
    const lines = ['来源：禁漫天堂（18comic.vip）', '专辑页：' + info.url, ''];
    if (authors) lines.push('作者：' + authors, '');
    lines.push('共 ' + chapters.length + ' 话。', '', '各话下载链接：');
    for (const c of chapters) lines.push('第' + c.i + '話  https://18comic.vip/album_download/' + c.id);
    lib.comics[key] = Object.assign({ favorite: false, categories: [], tags: [], note: '' }, prev, {
      desc: prev.desc || lines.join('\n'),
      author: authors || prev.author || '',
      source: { site: '18comic.vip', url: info.url },
    });
    fs.writeFileSync(libFile, JSON.stringify(lib, null, 2), 'utf8');
    console.log(tag + ' library.json 已更新（作者: ' + (authors || '未标注') + '）');
  } catch (e) { console.log(tag + ' 写 library.json 失败: ' + String(e.message).slice(0, 90)); }

  await bsend('Target.closeTarget', { targetId });
  const avg = chTimes.length ? (chTimes.reduce((a, b) => a + b, 0) / chTimes.length).toFixed(1) : '0';
  console.log(tag + ' 完成 ' + ok + '/' + todo.length + ' 话, 平均 ' + avg + 's/话, 用时 ' + ((Date.now() - T0) / 1000).toFixed(1) + 's');
  return { title, todo: todo.length, ok, secs: (Date.now() - T0) / 1000 };
}

const results = await Promise.all(urls.map((u, i) => worker(u, i).catch(e => { console.log('[专辑' + (i + 1) + '] 异常: ' + String(e.message).slice(0, 140)); return null; })));
{
  const blArgs = [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB];
  const dirs = Array.from(BOOK_DIRS);
  if (dirs.length && dirs.length <= 40) {
    blArgs.push('--only', dirs.join(','));
    console.log('增量重建: ' + dirs.length + ' 本（其余沿用 _manifest.json）');
  } else {
    console.log('全量重建: 本次动过的书 ' + dirs.length + ' 本，不划算或没记录');
  }
  spawnSync(process.execPath, blArgs, { stdio: 'inherit' });
}
try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch {}
try { py.stdin.end(); } catch {}
try { bws.close(); } catch {}
console.log('================ 多连接汇总 ================');
for (const r of results) if (r) console.log('  ' + (r.title || '').slice(0, 34) + ' -> ' + r.ok + '/' + r.todo + ' 话, 收官 ' + r.secs.toFixed(1) + 's');
console.log('总耗时 ' + ((Date.now() - T0) / 1000).toFixed(1) + 's (' + urls.length + ' 专辑并行)');
process.exit(0);
