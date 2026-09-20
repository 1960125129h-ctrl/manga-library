
// 一次下载 = 单开一个标签页; 全程计时(开页 -> 解析 -> 逐话下载入库 -> 重建书库 -> 关页)
// 用法: node run-album.mjs "https://18comic.vip/album/491045/?series_sort=2"
import fs from 'node:fs';
import { requirePython } from '../lib/python.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { openPage, sleep } from './cdp.mjs';

const T_START = Date.now();
const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const CAT = '漫画';
const DL = path.join(process.env.USERPROFILE || '', 'Downloads');
const STAGE = path.join(LIB, '_zips');
const PY = requirePython('禁漫下载(要 OCR 解验证码 + 拼页)');
const CAP = path.join(WORK, 'cap-live.jpg');
const PORT = 9333;
const albumUrl = process.argv[2];
const noInstall = process.argv.includes('--no-install');
const onlyFrom = parseInt((process.argv.find(a => a.startsWith('--from=')) || '').split('=')[1] || '1', 10);
const onlyTo = parseInt((process.argv.find(a => a.startsWith('--to=')) || '').split('=')[1] || '9999', 10);

// ---------- 1. 单开一个页面 ----------
const ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { bws.onopen = res; bws.onerror = () => rej(new Error('browser ws')); });
let bid = 0; const bpend = new Map();
bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && bpend.has(m.id)) { const p2 = bpend.get(m.id); bpend.delete(m.id); m.error ? p2.rej(new Error(JSON.stringify(m.error))) : p2.res(m.result); } };
const bsend = (method, params) => new Promise((res, rej) => { const id = ++bid; bpend.set(id, { res, rej }); bws.send(JSON.stringify({ id, method, params: params || {} })); });
const { targetId } = await bsend('Target.createTarget', { url: albumUrl });
console.log('[1] 新开页面 targetId=' + targetId + '  (+' + ((Date.now() - T_START) / 1000).toFixed(1) + 's)');

const p = await openPage(PORT, targetId);
const title = await p.goto(albumUrl);
await sleep(2000);
const info = JSON.parse(await p.ev('JSON.stringify({title:(document.querySelector("h1")||{}).textContent?document.querySelector("h1").textContent.trim():"",links:Array.from(document.querySelectorAll("a[data-album][data-index]")).map(a=>({i:parseInt(a.getAttribute("data-index"),10)+1,id:a.getAttribute("data-album")})),read:(document.querySelector("a.reading")||{}).getAttribute?document.querySelector("a.reading").getAttribute("href"):null,url:location.href})'));
const rawTitle = info.title || title.split(' Comics')[0].trim();
// Windows 文件名非法字符 -> 下划线(例: 专辑里的 "Signal:Violet" 会让 mkdir 直接 ENOENT)
  let authors = '';
  try {
    authors = JSON.parse(await p.ev('JSON.stringify(Array.from(document.querySelectorAll(\'span[itemprop="author"][data-type="author"]\')).map(function(e){return e.textContent.replace(/\\s+/g," ").trim()}).filter(Boolean))')).join(' / ');
  } catch (e) {}
  if (authors) console.log(tag + ' 作者: ' + authors);

const albumTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);
if (albumTitle !== rawTitle) console.log('[2.0] 书名含非法字符, 已替换为: ' + albumTitle);
let chapters = [];
if (info.links && info.links.length) {
  const seen = new Set();
  for (const l of info.links) { if (!seen.has(l.i)) { seen.add(l.i); chapters.push(l); } }
  chapters.sort((a, b) => a.i - b.i);
} else {
  const m = (info.url || albumUrl).match(/album\/(\d+)/);
  chapters = [{ i: 1, id: m ? m[1] : '491045' }];
}
chapters = chapters.filter(c => c.i >= onlyFrom && c.i <= onlyTo);
console.log('[2] 专辑解析完成: ' + albumTitle + ' | 共 ' + chapters.length + ' 话  (+' + ((Date.now() - T_START) / 1000).toFixed(1) + 's)');
const tParse = Date.now();

// ---------- 跳过已入库 ----------
const bookDir = path.join(LIB, CAT, albumTitle);
const done = new Set();
if (fs.existsSync(bookDir)) {
  for (const e of fs.readdirSync(bookDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const m = e.name.match(/^第(\d+)[話话]$/);
    if (!m) continue;
    const n = fs.readdirSync(path.join(bookDir, e.name)).filter(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)).length;
    if (n) done.add(parseInt(m[1], 10));
  }
}
const todo = chapters.filter(c => !done.has(c.i));
console.log('[3] 已入库 ' + done.size + ' 话(跳过) | 本次待下载 ' + todo.length + ' 话');

// 关键一步: 在同一个页面里切到"下载页", 表单 #album_down 只存在于该页
if (todo.length) {
  await p.goto('https://18comic.vip/album_download/' + todo[0].id);
  await sleep(800);
  const hasForm = await p.ev('!!document.querySelector("#album_down")');
  console.log('[3.1] 下载页就绪 form=' + hasForm + '  (+' + ((Date.now() - T_START) / 1000).toFixed(1) + 's)');
  if (!hasForm) { console.log('  下载页没有表单, 退出'); process.exit(1); }
}

// ---------- OCR 常驻 ----------
fs.mkdirSync(STAGE, { recursive: true });
const py = spawn(PY, [path.join(WORK, 'ocr_server.py')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const q = [], waiters = []; let obuf = '';
py.stdout.on('data', (d) => { obuf += d.toString(); let i; while ((i = obuf.indexOf('\n')) >= 0) { const l = obuf.slice(0, i).trim(); obuf = obuf.slice(i + 1); if (!l) continue; if (l === 'READY') continue; if (waiters.length) waiters.shift()(l); else q.push(l); } });
py.stderr.on('data', () => {});
const ocrAsk = (f) => new Promise((res) => { if (q.length) return res(q.shift()); waiters.push(res); py.stdin.write(f + '\n'); });

const capGet = () => p.ev('(async()=>{const r=await fetch("https://18comic.vip/captcha/?t="+Date.now(),{credentials:"include",cache:"no-store"});const b=new Uint8Array(await r.arrayBuffer());let s="";for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);})()');
const submit = (id, ans) => p.ev('(function(){var f=document.querySelector("#album_down");if(!f)return "noform";f.setAttribute("action","https://18comic.vip/album_download/' + id + '");var a=f.querySelector("input[name=album_id]");if(a)a.value="' + id + '";var i=document.querySelector("#invite_verification");if(i)i.value=' + JSON.stringify(String(ans)) + ';var b=document.querySelector("#download_submit");if(b){b.click();return "clicked";}f.submit();return "submitted";})()');

function installZip(zipPath, id, index) {
  const no = String(index).padStart(2, '0');
  const tmp = path.join(STAGE, '.x' + id);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  execSync('tar.exe -xf "' + zipPath + '" -C "' + tmp + '"');
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const s = path.join(d, e.name); if (e.isDirectory()) walk(s, out); else if (/\.(webp|jpg|jpeg|png|gif)$/i.test(e.name)) out.push(s); } return out; };
  const imgs = walk(tmp).sort();
  const chDir = path.join(LIB, CAT, albumTitle, '第' + no + '話');
  fs.mkdirSync(chDir, { recursive: true });
  for (const f of imgs) fs.copyFileSync(f, path.join(chDir, path.basename(f)));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.unlinkSync(zipPath);
  // 拼合被站点按高度切开的页, 并验证尺寸是否异常
  try {
    const rep = execSync('"' + PY + '" "' + path.join(WORK, 'stitch-pages.py') + '" "' + chDir + '"',
      { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    for (const l of rep.trim().split('\n')) console.log('    [校验] ' + l);
  } catch (e) { console.log('    [校验] 失败: ' + String(e.message).slice(0, 120)); }
  return fs.readdirSync(chDir).filter(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)).length;
}

const collect = async (item, maxWait = 90000) => {
  // 只要看到该话的包体出现就算成功, 不再判断 .crdownload / 大小稳定性
  const pat = new RegExp('^' + item.id + '( \\(\\d+\\))?\\.zip$');
  const t = Date.now();
  while (Date.now() - t < maxWait) {
    await sleep(250);
    const hit = fs.readdirSync(DL).filter(function (f) { return pat.test(f) && fs.statSync(path.join(DL, f)).size > 20000; })
      .map(function (f) { return { f: f, t: fs.statSync(path.join(DL, f)).mtimeMs }; })
      .sort(function (a, b) { return b.t - a.t; })[0];
    if (hit) {
      const zipPath = path.join(DL, hit.f);
      const dst = path.join(STAGE, item.id + '.zip');
      try { fs.renameSync(zipPath, dst); } catch (e) { fs.copyFileSync(zipPath, dst); fs.unlinkSync(zipPath); }
      const mb = (fs.statSync(dst).size / 1048576).toFixed(2);
      const pages = noInstall ? 0 : installZip(dst, item.id, item.index);
      const secs = ((Date.now() - item.t0) / 1000).toFixed(1);
      console.log('  第' + item.index + '話 OK ' + mb + 'MB ' + (noInstall ? '' : pages + '页 ') + '本话 ' + secs + 's  (+' + ((Date.now() - T_START) / 1000).toFixed(1) + 's)');
      return true;
    }
  }
  console.log('  第' + item.index + '話 FAIL 等不到 zip');
  return false;
};

// ---------- 逐话 ----------
let pending = null; const perChapter = []; const t0All = Date.now();
for (const ch of todo) {
  const t0 = Date.now();
  let cands = [];
  for (let round = 1; round <= 4 && !cands.length; round++) {
    try {
      const b64 = await capGet();
      fs.writeFileSync(CAP, Buffer.from(b64, 'base64'));
      const line = await ocrAsk(CAP);
      cands = (JSON.parse(line.replace(/^RESULT\s*/, '')).cands) || [];
    } catch (e) { cands = []; }
  }
  const tOcr = Date.now();
  if (pending) { await collect(pending); perChapter.push((Date.now() - pending.t0) / 1000); pending = null; }
  if (cands.length) {
    const st = await submit(ch.id, cands[0]);
    pending = { id: ch.id, index: ch.i, t0 };
    console.log('  第' + ch.i + '話 提交(' + st + ') 候选=' + cands[0] + ' 取码+识别 ' + ((tOcr - t0) / 1000).toFixed(1) + 's');
  } else {
    console.log('  第' + ch.i + '話 FAIL 验证码无候选');
  }
}
if (pending) { await collect(pending); perChapter.push((Date.now() - pending.t0) / 1000); }
const tDl = Date.now();
const sum = perChapter.reduce((a, b) => a + b, 0);
console.log('[4] 下载完成 ' + perChapter.length + '/' + todo.length + ' 话 | 墙钟 ' + ((tDl - t0All) / 1000).toFixed(1) + 's | 单话合计 ' + sum.toFixed(1) + 's');
try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch {}

// ---------- 写简介(library.json) ----------
{
  const libFile = path.join(LIB, 'library.json');
  try {
    const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
    const lines = [
      '来源：禁漫天堂（18comic.vip）',
      '专辑页：' + albumUrl,
      '',
      '共 ' + chapters.length + ' 话，均已入库。',
      '',
      '各话下载链接：',
    ];
    for (const c of chapters) lines.push('第' + c.i + '話  https://18comic.vip/album_download/' + c.id);
    lib.comics[CAT + '/' + albumTitle] = {
      favorite: false, categories: [], tags: [], note: '',
      desc: lines.join('\n'),
      author: authors || '',
      source: { site: '18comic.vip', url: albumUrl },
    };
    fs.writeFileSync(libFile, JSON.stringify(lib, null, 2), 'utf8');
    console.log('[5] library.json 已写入简介与来源 (' + Object.keys(lib.comics).length + ' 本)');
  } catch (e) { console.log('[5] 写 library.json 失败: ' + e.message); }
}

// ---------- 重建书库 ----------
execSync('node "' + path.join(LIB, '_scripts', 'build-library.mjs') + '" --lib "' + LIB + '"', { stdio: 'inherit' });
const tEnd = Date.now();

// ---------- 关掉本次专用页面 ----------
await bsend('Target.closeTarget', { targetId });
try { bws.close(); } catch {}
try { py.stdin.end(); } catch {}

console.log('================ 本次总计 ================');
console.log('专辑        : ' + albumTitle);
console.log('话数        : ' + todo.length + ' 话(已跳过 ' + done.size + ' 话)');
console.log('开页+解析   : ' + ((tParse - T_START) / 1000).toFixed(1) + 's');
console.log('逐话下载    : ' + ((tDl - t0All) / 1000).toFixed(1) + 's  (平均 ' + (sum / Math.max(1, perChapter.length)).toFixed(1) + 's/话)');
console.log('重建书库    : ' + ((tEnd - tDl) / 1000).toFixed(1) + 's');
console.log('总计        : ' + ((tEnd - T_START) / 1000).toFixed(1) + 's');
process.exit(0);
