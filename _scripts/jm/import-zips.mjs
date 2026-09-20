
// 手动下载的 zip 导入器: 只靠文件名里的 <photo_id> 反查书名/话号, 再解压入库
// 用法:
//   node import-zips.mjs                 # 扫描 _zips 目录并全部导入
//   node import-zips.mjs --dir "C:\Users\终楠\Downloads"
//   node import-zips.mjs --probe 1452133 # 只查这个 id 的书名与话号(不导入)
import fs from 'node:fs';
import { requirePython } from '../lib/python.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { openPage, sleep } from './cdp.mjs';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const CAT = '漫画';
const ZIPS = path.join(LIB, '_zips');
const PY = requirePython('导入 zip 包(要拼页)');
const PORT = Number(process.env.JM_PORT || 9333);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };

fs.mkdirSync(ZIPS, { recursive: true });

// 单开一个专用页面做查询
const ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { bws.onopen = res; bws.onerror = () => rej(new Error('bws')); });
let bid = 0; const bp = new Map();
bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && bp.has(m.id)) { const q = bp.get(m.id); bp.delete(m.id); m.error ? q.rej(new Error('e')) : q.res(m.result); } };
const bsend = (m, p) => new Promise((res, rej) => { const id = ++bid; bp.set(id, { res, rej }); bws.send(JSON.stringify({ id, method: m, params: p || {} })); });

const { targetId } = await bsend('Target.createTarget', { url: 'https://18comic.vip/' });
const p = await openPage(PORT, targetId);

async function lookup(id) {
  await p.goto('https://18comic.vip/photo/' + id);
  await sleep(900);
  const a = JSON.parse(await p.ev('JSON.stringify({title:(document.querySelector("h1")||{}).textContent?document.querySelector("h1").textContent.trim():"",series:(document.body.innerHTML.match(/var series_id = (\\d+)/)||[])[1]||"0"})'));
  let chapter = 1, total = 1;
  if (a.series && a.series !== '0') {   // 多话本也要查, 才能知道自己是第几话/共几话
    await p.goto('https://18comic.vip/album/' + a.series + '/');
    await sleep(900);
    const idx = await p.ev('(function(){var el=document.querySelector("a[data-album=\\"' + id + '\\"][data-index]");var all=document.querySelectorAll("a[data-album][data-index]");return JSON.stringify({idx:el?parseInt(el.getAttribute("data-index"),10)+1:0,total:new Set(Array.from(all).map(function(x){return x.getAttribute("data-index")})).size})})()');
    const j = JSON.parse(idx);
    if (j.idx) chapter = j.idx;
    if (j.total) total = j.total;
  }
  const title = (((a.title || '').split('|')[0] || '').replace(/^\d+-/, '').replace(/ Comics$/, '')).trim() || ('album' + id);
  let authors = '';
  try {
    authors = JSON.parse(await p.ev('JSON.stringify(Array.from(document.querySelectorAll(\'span[itemprop="author"][data-type="author"]\')).map(function(e){return e.textContent.replace(/\\s+/g," ").trim()}).filter(Boolean))')).filter(function(v,i,a){return v && a.indexOf(v) === i}).join(' / ');
  } catch (e) {}
  return { id, title, safe: title.replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120), series: a.series, chapter, total };
}

if (opt('probe')) {
  const r = await lookup(opt('probe'));
  console.log(JSON.stringify(r, null, 1));
  await bsend('Target.closeTarget', { targetId });
  process.exit(0);
}

const dir = opt('dir', ZIPS);
const zips = fs.readdirSync(dir).filter(f => /^\d+\.zip$/i.test(f));
console.log('扫描 ' + dir + ' → 找到 ' + zips.length + ' 个 <id>.zip');
let ok = 0;
for (const z of zips) {
  const id = z.replace(/\.zip$/i, '');
  const info = await lookup(id);
  const chDir = path.join(LIB, CAT, info.safe, '第' + String(info.chapter).padStart(2, '0') + '話');
  if (fs.existsSync(chDir) && fs.readdirSync(chDir).some(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f))) {
    console.log(id + ' → ' + info.title.slice(0, 30) + ' 第' + info.chapter + '話 已下载过(跳过)，zip 保留');
    continue;
  }
  const tmp = path.join(ZIPS, '.x' + id);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  execSync('tar.exe -xf "' + path.join(dir, z) + '" -C "' + tmp + '"');
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const s = path.join(d, e.name); if (e.isDirectory()) walk(s, out); else if (/\.(webp|jpg|jpeg|png|gif)$/i.test(e.name)) out.push(s); } return out; };
  const imgs = walk(tmp).sort();
  if (!imgs.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(id + ' → 解不出图片，判定不是漫画包，跳过（zip 原样保留）');
    continue;
  }
  fs.mkdirSync(chDir, { recursive: true });
  for (const f of imgs) fs.copyFileSync(f, path.join(chDir, path.basename(f)));
  fs.rmSync(tmp, { recursive: true, force: true });
  let rep = '';
  try { rep = execSync('"' + PY + '" "' + path.join(WORK, 'stitch-pages.py') + '" "' + chDir + '"', { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).trim().split('\n')[1] || ''; } catch (e) {}
  fs.unlinkSync(path.join(dir, z));
  try {
    const libFile = path.join(LIB, 'library.json');
    const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
    const key = CAT + '/' + info.safe;
    const prev = lib.comics[key] || {};
    const albumId = (info.series && info.series !== '0') ? info.series : info.id;
    lib.comics[key] = Object.assign({ favorite: false, categories: [], tags: [], note: '' }, prev, {
      author: info.authors || prev.author || '',
      source: prev.source || { site: '18comic.vip', url: 'https://18comic.vip/album/' + albumId + '/' },
    });
    fs.writeFileSync(libFile, JSON.stringify(lib, null, 2), 'utf8');
  } catch (e) {}
  const pages = fs.readdirSync(chDir).filter(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f)).length;
  console.log(id + ' → ' + info.title.slice(0, 30) + ' 第' + info.chapter + '/' + info.total + '話 | ' + pages + ' 页 | ' + rep);
  ok++;
}
await bsend('Target.closeTarget', { targetId });
try { bws.close(); } catch {}
if (ok) execSync('node "' + path.join(LIB, '_scripts', 'build-library.mjs') + '" --lib "' + LIB + '"', { stdio: 'inherit' });
console.log('导入完成: ' + ok + ' 个 zip');
process.exit(0);
