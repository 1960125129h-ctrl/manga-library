#!/usr/bin/env node
/**
 * 扫描书库目录, 生成:
 *   1) 书库根/书库.html          —— 书架 + 阅读器 (单文件, file:// 双击即用)
 *   2) 每本漫画/漫画阅读器.html   —— 单行本独立阅读器 (便于单独分享)
 * 用法: node build-library.mjs --lib "D:\...\漫画书库"
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTables, saveTables, learn, learnChars, refreshAliases, matchWT, isAI, ratingOf, loadAliasCache, MANGA_SITE_RE } from './tags.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const LIB = arg('lib');
const REMATCH = argv.includes('--rematch');   // 强制重新匹配所有书的作品/角色(忽略旧缓存)
if (!LIB) { console.error('missing --lib'); process.exit(1); }

// 识别规则版本号: 每次改识别逻辑(tags.mjs 的正则/词典)就把这个字符串改一下,
// 增量构建发现旧 manifest 的版本号对不上就自动退回全量重识别。
const RECOG_VERSION = 'v3-20260914';

// 作者别名表(UI 里"合并作者"写到这个文件, 每次构建都会重新套用)
const ALIAS_FILE = path.join(LIB, '_scripts', 'author-alias.json');
let AUTHOR_ALIAS = {};
try { AUTHOR_ALIAS = JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8')) || {}; } catch (e) { AUTHOR_ALIAS = {}; }

// 封面缩略图: 有 python 就顺手更新(已存在的会跳过), 失败不影响主流程
const THUMB_W = 200;   // 缩略图宽度(px), 书架用; 阅读时仍是原图
try {
  const py = 'C:\\Users\\终楠\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';
  const script = path.join(HERE, 'jm', 'make-thumbs.py');
  if (fs.existsSync(py) && fs.existsSync(script)) {
    const out = execSync('"' + py + '" "' + script + '" "' + LIB + '" ' + THUMB_W, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    if (out.trim()) console.log('  ' + out.trim());
  }
} catch (e) { console.log('  (缩略图更新跳过: ' + String(e.message).slice(0, 60) + ')'); }

// 卡片封面: _thumbs/<sha1(相对路径)[0:16]>.webp
function coverOf(relDir) {
  const h = crypto.createHash('sha1').update(relDir).digest('hex').slice(0, 16);
  const rel = '_thumbs/' + h + '-w' + THUMB_W + '.webp';
  return fs.existsSync(path.join(LIB, rel)) ? rel : null;
}
// 用户手动设的封面: 从 library.json 读 coverOverride {ci,pi}, 返回对应图片相对路径
function coverOverrideOf(c) {
  const e = META_COMICS[c.dir];
  if (!e || !e.coverOverride) return null;
  const ch = c.chapters[e.coverOverride.ci];
  if (!ch) return null;
  const pi = Math.min(e.coverOverride.pi, (ch.files ? ch.files.length : ch.n) - 1);
  if (ch.files) return joinRel(c.dir, ch.files[pi]);
  const dp = ch.path !== undefined ? ch.path : (ch.name || '');
  const base = c.dir + (dp ? '/' + dp + '/' : '/');
  let s = String(pi + 1); while (s.length < ch.pad) s = '0' + s;
  return base + s + (ch.ext || '.jpg');
}

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4'];
const numOf = (s) => parseInt((String(s).split('_')[0].match(/\d+/) || ['0'])[0], 10);
const esc = (s) => String(s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');

/* ---- 中文数字 -> 阿拉伯数字 (仅用于排序键, 不改变显示) ---- */
const CN_D = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const CN_U = { '十': 10, '百': 100, '千': 1000 };
function cn2num(run) {
  let total = 0, num = 0;
  for (const ch of run) {
    if (ch in CN_D) num = CN_D[ch];
    else if (ch in CN_U) { total += (num || 1) * CN_U[ch]; num = 0; }
  }
  return total + num;
}
function sortKey(s) {
  return String(s).replace(/[零〇一二三四五六七八九十百千两]+/g, function (m) {
    return String(cn2num(m)).padStart(6, '0');
  }).toLowerCase();   // ASCII 作者名大小写不敏感: [A] 与 [a] 排在一起
}
function natCmp(a, b) { return sortKey(a).localeCompare(sortKey(b), 'zh', { numeric: true, sensitivity: 'base' }); }

function joinRel(rel, f) { return rel ? rel + '/' + f : f; }

function compact(label, rel, files) {
  const ext = path.extname(files[0]).toLowerCase();
  const pad = path.basename(files[0], path.extname(files[0])).length;
  let seq = true;
  for (let i = 0; i < files.length; i++) {
    if (path.extname(files[i]).toLowerCase() !== ext) { seq = false; break; }
    const b = path.basename(files[i], path.extname(files[i]));
    let e = String(i + 1); while (e.length < pad) e = '0' + e;
    if (b !== e) { seq = false; break; }
  }
  if (seq) return { label: label, path: rel, n: files.length, pad: pad, ext: ext };
  return { label: label, path: rel, files: files.map(f => joinRel(rel, f)) };
}

/* 递归找出所有"直接含图片"的目录, 每个算一话 */
function scanComic(cdir, relDir) {
  const name = relDir.split('/').pop();
  const found = [];
  let bytes = 0;   // 这本书所有图片的字节数(书架卡片显示体积用)
  (function walk(dir, rel, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    const files = entries
      .filter(e => e.isFile() && IMG_EXT.indexOf(path.extname(e.name).toLowerCase()) >= 0)
      .map(e => e.name).sort(natCmp);
    if (files.length) {
      found.push({ rel: rel, files: files });
      for (const f of files) { try { bytes += fs.statSync(path.join(dir, f)).size; } catch (e) {} }   // 顺手统计这本的体积
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.charAt(0) === '.') continue;
      walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name, depth + 1);
    }
  })(cdir, '', 0);

  let chapters = found;
  if (found.length > 1) {
    const noRoot = found.filter(f => f.rel !== '');
    if (noRoot.length) chapters = noRoot;   // 根目录里那几张通常是封面/散图
  }
  if (!chapters.length) return null;

  chapters.sort((a, b) => natCmp(a.rel, b.rel));
  const labels = chapters.map(f => f.rel ? f.rel.split('/').pop() : name);
  const dup = labels.some((l, i) => labels.indexOf(l) !== i);
  const out = chapters.map(function (f, i) {
    const lab = dup ? (f.rel ? f.rel.split('/').join(' · ') : name) : labels[i];
    return compact(lab, f.rel, f.files);
  });
  return { dir: relDir, chapters: out, size: bytes };
}

/* 目录自身是否直接含图片 */
function hasImgDirect(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .some(e => e.isFile() && IMG_EXT.indexOf(path.extname(e.name).toLowerCase()) >= 0);
  } catch (e) { return false; }
}

/* 类目目录: 自己不含图片, 且它的每个子目录也不直接含图片 => 里面装的是「书」而不是「话」 */
function isCategoryDir(dir) {
  if (hasImgDirect(dir)) return false;
  let subs;
  try {
    subs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.charAt(0) !== '.' && e.name.charAt(0) !== '_');
  } catch (e) { return false; }
  if (!subs.length) return false;
  return subs.every(e => !hasImgDirect(path.join(dir, e.name)));
}

// library.json 里的作者/标签/来源等元数据也塞进 manifest, 这样"双击 书库.html"在浏览器里也能显示这些字段
const META = (() => { try { return JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')); } catch (e) { return { comics: {} }; } })();
const META_COMICS = META.comics || {};
function scanLibrary(lib) {
  const comics = [];
  for (const ent of fs.readdirSync(lib, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.charAt(0) === '_' || ent.name.charAt(0) === '.') continue;
    const full = path.join(lib, ent.name);
    if (isCategoryDir(full)) {
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        if (sub.name.charAt(0) === '_' || sub.name.charAt(0) === '.') continue;
        const c = scanComic(path.join(full, sub.name), ent.name + '/' + sub.name);
        if (c) comics.push(c);
      }
      continue;
    }
    const c = scanComic(full, ent.name);
    if (c) comics.push(c);
  }
  comics.sort((a, b) => a.dir.localeCompare(b.dir, 'zh'));
  for (const c of comics) {
    const m = META_COMICS[c.dir];
    if (!m) continue;
    if (m.author) c.author = m.author;
    if (m.tags && m.tags.length) c.tags = m.tags;
    if (m.categories && m.categories.length) c.categories = m.categories;
    if (m.source) c.source = m.source;
    if (m.desc) c.desc = m.desc;
    if (m.favorite) c.favorite = true;
  }
  return comics;
}

const CSS = [
'*{box-sizing:border-box}',
':root{--bg:#0a0a0a;--surface:#161616;--surface2:#202020;--surface3:#2e2e2e;--border:#1c1c1c;--border2:#303030;--fg:#d8dade;--fg2:#909090;--fg3:#606060;--accent:#3b7bf6;--accent2:#5a95f8;--card-bg:#1a1a1a;--thumb-bg:#060606}',
'body[data-shelf-theme="light"]{--bg:#e8eaed;--surface:#f5f6f8;--surface2:#ffffff;--surface3:#e0e3e8;--border:#d1d5db;--border2:#c5c9cf;--fg:#11151a;--fg2:#3d434b;--fg3:#6b7280;--accent:#2f6df6;--accent2:#4a8af8;--card-bg:#ffffff;--thumb-bg:#eef0f3}',
'body[data-shelf-theme="eye"]{--bg:#e2e8d8;--surface:#ebeedd;--surface2:#f2f5e6;--surface3:#dce2cc;--border:#c8cfb4;--border2:#bcc4a6;--fg:#2a3320;--fg2:#5e6a4e;--fg3:#7e8a6e;--accent:#5a9a5a;--accent2:#6aaa6a;--card-bg:#eef2e0;--thumb-bg:#d4dcc4}',
'body[data-shelf-theme="paper"]{--bg:#f3ead8;--surface:#ece0c8;--surface2:#e0d3b7;--surface3:#d4c6a8;--border:#cfc0a4;--border2:#c4b498;--fg:#3d3428;--fg2:#7a6d58;--fg3:#9a8a70;--accent:#8b6f3e;--accent2:#9b7f4e;--card-bg:#ece0c8;--thumb-bg:#d8ccb0}',
'*{transition:background-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1)}',
'html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.5 "Microsoft YaHei","PingFang SC",system-ui,sans-serif;overflow:hidden}',
'body.bgimg{background-size:cover;background-position:center;background-attachment:fixed}',
'body.bgimg .card{background:color-mix(in srgb, var(--card-bg) var(--bg-op,50%), transparent);backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #shelfbar{background:color-mix(in srgb, var(--surface) var(--bg-op,50%), transparent);backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #cattabs{background:color-mix(in srgb, var(--surface) var(--bg-op,50%), transparent);backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg .ahead{background:color-mix(in srgb, var(--surface) var(--bg-op,50%), transparent)!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #filterpanel{background:transparent!important}',
'body.bgimg #filterpanel>.fpanel-inner{background:color-mix(in srgb, var(--surface) var(--bg-op,50%), transparent)!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg button.b{background:color-mix(in srgb, var(--surface2,var(--surface)) calc(var(--bg-op,50%) * 1.5)!important, transparent);backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8));-webkit-backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8))}',
'body.bgimg #reader button.b{background:color-mix(in srgb, var(--r-panel2,var(--surface)) calc(var(--bg-op,50%) * 1.5)!important, transparent)}',
'body.bgimg .chip{background:color-mix(in srgb, var(--surface2,var(--surface)) calc(var(--bg-op,50%) * 1.5), transparent);backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8));-webkit-backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8))}',
'body.bgimg .chip.sel{background:linear-gradient(135deg,var(--accent),var(--accent2))!important;color:#fff!important}',
'body.bgimg #searchwrap{background:color-mix(in srgb, var(--surface2,var(--surface)) calc(var(--bg-op,50%) * 1.5)!important, transparent);backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8));-webkit-backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8))}',
'body.bgimg #searchwrap #btn-sitesearch{background:color-mix(in srgb, var(--surface3,var(--surface)) 70%, transparent)!important;backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8));-webkit-backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8))}',
'body.bgimg .tab{background:color-mix(in srgb, var(--surface2,var(--surface)) calc(var(--bg-op,50%) * 1.5), transparent);backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8));-webkit-backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.8))}',
'body.bgimg .tab.on,body.bgimg .tab.sel{background:linear-gradient(135deg,var(--accent),var(--accent2))!important;color:#fff!important}',
'body.bgimg #filterpanel .flabel{font-weight:600!important}',
'body.bgimg.cover-opaque .thumb{background:rgba(0,0,0,calc(var(--bg-op,50%) * 1.2))!important;backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.6));-webkit-backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.6))}',
'body.bgimg .thumb{background:rgba(0,0,0,calc(var(--bg-op,50%) * 1.2))!important;backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.6));-webkit-backdrop-filter:blur(calc(var(--bg-blur,12px) * 0.6))}',
'.view{height:100%}',
'.hide{display:none !important}',
'#shelf{display:flex;flex-direction:column;height:100%}',
'#shelfbar{display:flex;align-items:center;gap:10px;padding:6px 16px;background:var(--surface);border-bottom:1px solid var(--border);flex-wrap:wrap;position:sticky;top:0;z-index:20;transition:padding .3s,background-color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1)}',
'#shelfbar.compact{padding:2px 16px}',
'#shelfbar h1{margin:0;font-size:15px;font-weight:600;letter-spacing:.5px}',
'#search{background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:8px;padding:6px 11px;width:220px;font-family:inherit;font-size:13px;outline:none;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1)}',
'#search:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(47,109,246,.15)}',
'#searchwrap{display:flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding-right:4px;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1)}',
'#searchwrap:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(47,109,246,.15)}',
'#searchwrap #search{border:none;background:transparent;flex:1;min-width:0}',
'#searchwrap #btn-sitesearch{background:var(--surface3);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:3.5px 7px;font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
'#searchwrap #btn-sitesearch:hover{background:var(--border2)}',
'#searchwrap #btn-sitesearch:disabled{opacity:.45;cursor:default}',
'#sortsel{background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:8px;padding:6px 10px;font-family:inherit;font-size:13px;outline:none;cursor:pointer;max-width:170px;transition:border-color .15s,box-shadow .15s}'
,'.cauthor{font-size:.78em;color:var(--fg2);margin-bottom:.25em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
,'body.no-author .cauthor{display:none}',
'#sortsel:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(47,109,246,.15)}',
'#btn-filter{background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:8px;padding:6px 11px;font-family:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:5px;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1),box-shadow .3s ease}',
'#btn-filter:hover{background:var(--surface3);border-color:var(--border2)}',
'#btn-filter.on{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#fff;box-shadow:0 2px 8px rgba(47,109,246,.3)}',
'#btn-filter .fbadge{font-weight:600}',
'#btn-filter .fbadge.clean{color:#5a9b6e}',
'#btn-filter.on .fbadge.clean{color:#d6ffe3}',
'#filterpanel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .5s cubic-bezier(.4,0,.2,1);background:var(--surface)}',
'#filterpanel>.fpanel-inner{overflow:hidden;min-height:0;display:flex;flex-direction:column;gap:6px;padding:0 16px 1px;background:var(--surface)}',
'#filterpanel.open{grid-template-rows:1fr}',
'#filterpanel .frow{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}',
'#filterpanel .flabel{flex:0 0 auto;width:34px;color:var(--fg2);font-size:11.5px;padding:3px 0;letter-spacing:.5px}',
'#filterpanel .fchips{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:5px}',
'#filterpanel .frow.collapsible .flabel{cursor:pointer;user-select:none;width:auto;white-space:nowrap;padding-right:6px;opacity:.85}',
'#filterpanel .frow.collapsible .flabel:hover{opacity:1;color:#c9ced6}',
'#filterpanel .frow.collapsible .flabel::after{content:" ▾";opacity:.6;font-size:10px}',
'#filterpanel .frow.collapsible.open .flabel::after{content:" ▴"}',
'#filterpanel .frow.collapsible.closed .fchips{display:none!important}',
'#filterpanel .frow.collapsible.sel .flabel{color:#7fb3ff;opacity:1}',
'.chip{background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:12px;padding:3px 11px;font-size:11.5px;cursor:pointer;user-select:none;white-space:nowrap;line-height:1.5;transition:background .15s,border-color .15s,color .15s}',
'.chip:hover{background:var(--surface3);border-color:var(--border2)}',
'.chip.sel{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#fff;box-shadow:0 2px 8px rgba(47,109,246,.3)}',
'.chip .x{margin-left:4px;opacity:.85;font-size:10.5px}',
'#shelfstat{margin-left:auto;color:var(--fg2);font-size:12.5px}',
'#shelfbar{position:relative}',
'@media (max-width:950px){#shelfstat{opacity:0;transition:opacity .2s}#shelfbar:hover #shelfstat{opacity:1}}',
'body.icon-only #appactions .b{font-size:0;padding:7px 9px;min-width:0}body.icon-only #appactions .b svg{margin-right:0!important}',
'body.icon-only #btn-sitesearch{font-size:11.5px}',
'#grid{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:var(--pad,12px);display:grid;grid-template-columns:repeat(auto-fill,var(--card-w,176px));justify-content:start;gap:var(--gap,12px);font-size:calc(var(--card-w,176px) * var(--t-scale,0.072));align-content:start;align-items:start;grid-auto-rows:max-content;scroll-behavior:smooth;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--fg3) var(--bg);transition:scrollbar-color 1s cubic-bezier(.4,0,.2,1)}',

'#grid.scrolling{filter:blur(1.5px)}',
'.card{cursor:pointer;content-visibility:auto;contain-intrinsic-size:150px 210px;border-radius:var(--radius,16px);overflow:hidden;background:var(--card-bg);border:none;box-shadow:0 2px 10px rgba(0,0,0,.5);transition:transform .3s ease,background-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;max-width:none;-webkit-user-select:none;user-select:none;will-change:auto;position:relative}',
'.card.h{flex-direction:row;align-items:stretch}',
'.card.h .thumb{aspect-ratio:auto;width:160px;flex:0 0 auto;min-height:100%}',
'.card.h .cmeta{flex:1;display:flex;flex-direction:column;justify-content:center;padding:10px 20px;min-width:0;font-size:1.1em}',
'#grid.h{grid-template-columns:repeat(auto-fill,minmax(420px,1fr))!important}',
'.card:hover{transform:scale(1.07);z-index:5}',
/* 卡片光效: 两层伪元素(斜向渐变 + 右下角光斑), 悬停 .6s 渐入 / 移开 1.2s 渐出 */
/* 渐变必须放在 ::before 里才动得起来: background-image 本身不可过渡, 直接改它就是一帧闪没 */
'.card .cmeta{position:relative;overflow:hidden}',
'.card .cmeta>*{position:relative;z-index:1}',
'.card .cmeta::before,.card .cmeta::after{content:"";position:absolute;pointer-events:none;z-index:0;opacity:0;transition:opacity 1.2s cubic-bezier(.22,.61,.36,1),transform 1.2s cubic-bezier(.22,.61,.36,1)}',
'.card .cmeta::before{inset:0;background:linear-gradient(315deg,var(--c1,rgba(139,92,246,.62)) 0.1%,transparent 72%)}',
'.card .cmeta::after{right:0;bottom:0;width:120px;height:120px;transform-origin:100% 100%;transform:scale(.88);background:radial-gradient(circle at bottom right,var(--c2,var(--c1,rgba(139,92,246,.3))),transparent 72%)}',
'.card:hover .cmeta::before{opacity:1;transition:opacity .6s cubic-bezier(.4,0,.2,1)}',
'.card:hover .cmeta::after{opacity:.62;transform:scale(1);transition:opacity .6s cubic-bezier(.4,0,.2,1),transform .6s cubic-bezier(.4,0,.2,1)}',
'.thumb{aspect-ratio:3/4;flex:0 0 auto;background:var(--thumb-bg);overflow:hidden;position:relative;transition:background-color 1.2s cubic-bezier(.4,0,.2,1)}',
'.thumb img{width:100%;height:100%;object-fit:var(--fit,contain);display:block;background:var(--thumb-bg);filter:saturate(1.30);transition:transform .3s cubic-bezier(.4,0,.2,1),background-color 1.2s cubic-bezier(.4,0,.2,1)}',
'.card:hover .thumb img{transform:scale(1.08)}',
'.thumb .none{display:flex;align-items:center;justify-content:center;height:100%;color:var(--fg3);font-size:12px}',
'.cmeta{padding:0.9em 1em 1em;flex:0 0 auto;min-width:0}',
'.ctitle{font-size:1em;font-weight:600;line-height:1.3;margin-bottom:0.25em;overflow:hidden;word-break:break-all;max-height:2.6em;transition:max-height .6s ease,overflow .6s ease}',
'.card:hover .ctitle{max-height:12em;overflow-y:auto;scrollbar-width:none}',
'.card:hover .ctitle::-webkit-scrollbar{display:none}',
'.csub{font-size:0.85em;color:var(--fg2);margin-bottom:0.35em}',
'.bar{height:4px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:5px}',
'.bar i{display:block;height:100%;background:var(--accent);border-radius:3px}',
'.cread{font-size:0.78em;color:var(--fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
'#bmnote{padding:6px 2px 12px;color:var(--fg2);font-size:12.5px}',
'#empty{padding:60px;text-align:center;color:var(--fg3);grid-column:1/-1}',
'#reader{display:flex;height:100%}',
'body.bgimg #reader{background:transparent!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #stage{background-color:color-mix(in srgb, var(--r-view,var(--bg)) var(--bg-op,50%), transparent)!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #reader[data-theme] #stage{background-color:color-mix(in srgb, var(--r-view) var(--bg-op,50%), transparent)!important;background-image:none!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #bar{background-color:color-mix(in srgb, var(--r-panel,var(--surface)) var(--bg-op,50%), transparent)!important;background-image:none!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #sidebar{background-color:color-mix(in srgb, var(--r-panel,var(--surface)) var(--bg-op,50%), transparent)!important;background-image:none!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #thumbs{background-color:color-mix(in srgb, var(--r-panel,var(--surface)) var(--bg-op,50%), transparent)!important;background-image:none!important;backdrop-filter:blur(var(--bg-blur,12px));-webkit-backdrop-filter:blur(var(--bg-blur,12px))}',
'body.bgimg #stage::-webkit-scrollbar-track{background:color-mix(in srgb, var(--r-view,var(--bg)) calc(var(--bg-op,50%) * 0.7), transparent)!important}',
'body.bgimg #stage::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--r-fg2,var(--fg2)) 55%, transparent)!important;border-color:transparent!important}',
'body.bgimg #thumblist::-webkit-scrollbar-track{background:transparent!important}',
'body.bgimg #thumblist::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--r-fg2,var(--fg2)) 55%, transparent)!important}',
'#sidebar{width:230px;flex:0 0 230px;background:#17181c;border-right:1px solid var(--r-line,#26282e);display:flex;flex-direction:column;position:relative;overflow:hidden;transition:width .7s ease,flex-basis .7s ease,border-color 1.2s cubic-bezier(.4,0,.2,1),opacity .3s}',
'#sidebar h2,#sidebar #chapters{opacity:1;visibility:visible;transition:opacity .5s,visibility .5s,width .7s}',
'#sidebar.collapsed{width:26px;flex:0 0 26px}',
'#sidebar.collapsed > h2,#sidebar.collapsed > #chapters{opacity:0;visibility:hidden;transition:opacity .3s,visibility 0s .3s,width .7s}',
'#sidebar h2{padding-right:34px}',
'#sidebar #chapters{padding-right:26px}',
'#sidebar h2{font-size:12.5px;font-weight:600;margin:0;padding:14px 14px 9px;color:#9aa0aa;letter-spacing:.5px;word-break:break-all;line-height:1.4}',
'#chapters{flex:1;overflow:auto;padding:0 8px 16px}',
'.ch{display:block;width:100%;text-align:left;background:none;border:0;color:#c3c8d0;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit}',
'.ch:hover{background:#22242a;color:#fff}',
'.ch.on{background:#2f6df6;color:#fff;font-weight:600}',
'.ch .n{float:right;opacity:.55;font-size:11px}',
'#main{flex:1;display:flex;flex-direction:column;min-width:0}',
'#bar{display:flex;align-items:center;gap:6px;padding:7px 10px;background:var(--surface);border-bottom:1px solid var(--r-line,var(--border));flex-wrap:wrap;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1)}',
'.grp{display:flex;gap:2px;background:var(--surface2);border-radius:7px;padding:2px}',
'button.b{background:var(--surface2);border:1px solid var(--border);color:var(--fg);padding:5px 11px;border-radius:8px;cursor:pointer;font-size:12.5px;font-family:inherit;white-space:nowrap;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1),transform .15s ease}',
'button.b:hover{background:var(--surface3);color:var(--fg);border-color:var(--border2)}',
'button.b.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 2px 8px rgba(47,109,246,.3);border-color:transparent}',
'#info{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--fg2);font-size:12.5px;white-space:nowrap}',
'#pageinput{width:52px;background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:5px;padding:4px 6px;text-align:center;font-family:inherit;font-size:12.5px}',
'#stage{flex:1;overflow:auto;display:flex;flex-direction:column;background:#0d0e10;transition:flex .7s ease}',
'#stage.mode-scroll{display:block;padding:0}',
'.pagewrap{display:flex;gap:2px;align-items:center;justify-content:center;max-width:100%;flex:0 0 auto}',
'#stage.dir-rtl .pagewrap{flex-direction:row-reverse}',
'.pageimg{display:block;user-select:none;-webkit-user-drag:none;flex:0 0 auto}',
'/* 适宽/适高: 可用尺寸由 JS 按 #stage 真实大小写进这两条变量(不再拿 100vh-52px 硬算) */',
'#stage{--sw:100vw;--sh:calc(100vh - 52px)}',
'#stage.fit-height .pageimg{max-height:var(--sh);max-width:var(--sw);width:auto;height:auto;object-fit:contain}',
'#stage.fit-contain .pageimg{max-width:var(--sw);max-height:var(--sh);width:auto;height:auto;object-fit:contain}',
'#stage.fit-width .pageimg{width:var(--sw);height:auto;max-height:none;object-fit:contain}',
'#stage.fit-width .pagewrap{width:var(--sw)}',
'#stage.fit-original .pageimg{max-width:none;max-height:none;width:auto;height:auto}',
'/* 双页: 两张并排, 每张最多占一半可用宽 */',
'#stage.mode-double .pagewrap{width:var(--sw);justify-content:center}',
'#stage.mode-double.fit-width .pageimg{width:calc((var(--sw) - 2px) / 2)}',
'#stage.mode-double.fit-height .pageimg{max-width:calc((var(--sw) - 2px) / 2);max-height:var(--sh)}',

'#stage.mode-scroll .pageimg{width:var(--sw);height:auto;display:block;margin:0 auto;max-width:none;max-height:none}',   // 长条: 保持比例往下流, 不被适高截断
    '#stage.mode-scroll .pagewrap{display:block;width:100%;max-width:none;max-height:none;margin:0;gap:0}',
'.empty{padding:40px;color:#6a7078;text-align:center;width:100%}',
'#hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);background:linear-gradient(135deg,#2f6df6,#4a8af8);color:#fff;padding:9px 18px;border-radius:10px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:99;box-shadow:0 4px 16px rgba(47,109,246,.35)}',
'#hint.show{opacity:1}',
'/* ---- 设置面板可调项 ---- */',
'body.no-tags .ctags{display:none}',
'body.no-src .csrc{display:none}'
,'body.no-author .cauthor{display:none}',
'body.no-prog .bar,body.no-prog .cread{display:none}',
'body.no-star .star{display:none}',
'body.no-sticky #shelfbar,body.no-sticky #cattabs{position:static}',
'body.no-totop #totop{display:none !important}',
'#mbox textarea{width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:7px;padding:8px 10px;font-family:inherit;font-size:12.5px;outline:none;resize:vertical}',
'#mbox textarea:focus{border-color:var(--accent)}',
'#mbox input[type=number],#mbox select{width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:7px;padding:7px 10px;font-family:inherit;font-size:13px;outline:none;margin-bottom:2px}',
'#mbox input[type=number]:focus,#mbox select:focus{border-color:var(--accent)}',
'#grid::-webkit-scrollbar{width:var(--sbw,11px);height:var(--sbw,11px)}',
'#grid::-webkit-scrollbar-track{background:var(--bg);border-radius:6px;transition:background-color 1.2s cubic-bezier(.4,0,.2,1)}',
'#grid::-webkit-scrollbar-thumb{background:var(--fg3);border-radius:6px;border:2px solid var(--bg);box-shadow:0 0 6px rgba(255,255,255,.08);transition:background-color 1.2s cubic-bezier(.4,0,.2,1)}',
'#grid::-webkit-scrollbar-thumb:hover{background:var(--fg2)}',
'.thumb{background:var(--thumb-bg)}',
'#shelf{min-height:0}',
'#cattabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:0 16px 10px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:19;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1)}',
'#totop{position:fixed;right:22px;bottom:22px;width:42px;height:42px;border-radius:50%;border:0;background:#2f6df6;color:#fff;font-size:18px;cursor:pointer;display:none;z-index:60;box-shadow:0 6px 18px rgba(0,0,0,.45)}',
'#totop.on{display:block}',
'#grid.grouped{display:grid;grid-template-columns:repeat(var(--acols,2),minmax(0,1fr));gap:14px 20px;align-items:start;grid-auto-flow:row dense;padding-top:0}',
'.agroup{grid-column:1/-1}',
'.agroup.single{grid-column:span 1;padding-right:14px;border-right:1px solid var(--border)}',
'.card.dragging{opacity:.45}',
'.card.droptarget{outline:2px dashed #2f6df6;outline-offset:2px}',
'@media (max-width:1100px){#grid.grouped{grid-template-columns:1fr}}',
'.agroup{grid-column:1/-1;margin:0 0 16px;padding-top:0}',
'.ahead{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:8px;padding:8px 12px;margin:0 0 10px 0;background:var(--surface)!important;border-left:3px solid var(--accent);border-bottom:none;font-size:13px;font-weight:600;color:var(--fg);min-height:24px;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1)}',
'.ahead .cnt{color:var(--fg2);font-weight:400;font-size:12px}',
'.agrid{display:grid;grid-template-columns:repeat(auto-fill, var(--card-w,176px));gap:var(--gap,12px);justify-content:start;align-content:start}',
'.agrid.h{grid-template-columns:repeat(auto-fill,minmax(420px,1fr))!important}',
'.acard{flex-direction:row;align-items:stretch}',
'.acard .thumb{aspect-ratio:auto;width:160px;flex:0 0 auto;min-height:100%}',
'.acard .cmeta{flex:1;display:flex;flex-direction:column;justify-content:center;padding:10px 20px;min-width:0;font-size:1.1em}',
'#grid.grouped .cauthor{display:none}',
'#hlist{flex:1;overflow:auto;padding:14px 16px 24px;display:flex;flex-direction:column;gap:10px}',
'#history{display:flex;flex-direction:column;height:100%;position:fixed;inset:0;z-index:50}',
'.hrow{display:flex;gap:12px;align-items:center;background:var(--card-bg);border:1px solid var(--border);border-radius:9px;padding:10px;cursor:pointer}',
'.hrow:hover{border-color:var(--accent)}',
'.hrow img{width:56px;height:75px;object-fit:contain;background:var(--thumb-bg);border-radius:6px;flex:0 0 auto}',
'.hmeta{flex:1;min-width:0}',
'.htitle{font-size:13.5px;font-weight:600;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.hsub{font-size:12px;color:var(--fg2)}',
'.hgo{flex:0 0 auto}',
'#thumbs{width:152px;flex:0 0 152px;background:#17181c;border-left:1px solid var(--r-line,#26282e);display:flex;flex-direction:column;position:relative;overflow:hidden;transition:width .7s ease,flex-basis .7s ease,border-color 1.2s cubic-bezier(.4,0,.2,1),opacity .3s}',
'#thumbs h2,#thumbs #thumblist{opacity:1;visibility:visible;transition:opacity .5s,visibility .5s,width .7s}',
'#thumbs.collapsed{width:26px;flex:0 0 26px}',
'#thumbs.collapsed > h2,#thumbs.collapsed > #thumblist{opacity:0;visibility:hidden;transition:opacity .3s,visibility 0s .3s,width .7s}',
'#thumbs h2{padding-left:34px}',
'#thumbs #thumblist{padding-left:26px}',
'#thumbs h2{font-size:12.5px;font-weight:600;margin:0;padding:12px 10px 8px 34px;color:#9aa0aa;white-space:nowrap;display:flex;align-items:center;gap:6px}',
'#thumbs h2 .mini{margin-left:6px;background:#212329;border:1px solid #33363e;color:#c9ced6;border-radius:6px;padding:2px 7px;font:inherit;font-size:11px;cursor:pointer}',
'#thumbs h2 .mini.on{background:#2f6df6;border-color:#2f6df6;color:#fff}',
'#thumblist{flex:1;overflow:auto;padding:0 10px 12px;display:flex;flex-direction:column;gap:6px;scrollbar-gutter:stable}',
'#cattabs .tab.dragover{outline:2px dashed #2f6df6;outline-offset:2px}',
'#cattabs .tab.multi{background:#2f6df6;border-color:#2f6df6;color:#fff}',
'#cattabs .tab.multi .cnt{color:#dbe6ff}',
'#albumbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:0 16px 8px;background:var(--surface);border-bottom:1px solid var(--border)}',
'#albumbar.hide{display:none}',
'#albumbar .abtn{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:14px;border:1px solid var(--border2);background:var(--surface2);color:var(--fg2);cursor:pointer;font-size:12px}',
'#albumbar .abtn.on{background:#2d4a3e;border-color:#3a7a5e;color:#a8e6c8}',
'#albumbar .abtn .cnt{color:#6a7080;font-size:10px}',
'#albumbar .abtn.on .cnt{color:#7ac8a0}',
'#btn-download.running{background:#7c3aed;border-color:#7c3aed;color:#fff}',
'.agroup.droptarget{outline:2px dashed #2f6df6;outline-offset:4px;border-radius:10px}',
'.card.droptarget{outline:2px dashed #2f6df6}',
'.card.dragghost{opacity:.85;box-shadow:0 10px 26px rgba(0,0,0,.5)}',
'.card.dragging{cursor:grabbing}',
'.titem{cursor:pointer;border:2px solid transparent;border-radius:6px;overflow:hidden;background:#0d0e10;position:relative}',
'.titem img{max-width:100%;max-height:190px;width:auto;height:auto;display:block;margin:0 auto}',
'.titem{display:flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden}',
'#thumblist{scrollbar-width:thin;scrollbar-color:var(--r-fg2) var(--r-panel)}',
'#thumblist::-webkit-scrollbar{width:9px}',
'#thumblist::-webkit-scrollbar-thumb{background:var(--r-fg2);border-radius:6px}',
'.titem.on{border-color:#184ed8;background:rgba(24,78,216,.20);box-shadow:0 0 0 1px rgba(45,110,255,.8),0 0 18px 5px rgba(24,78,216,.6)}',
'.aibadge{position:absolute;right:4px;top:4px;background:rgba(59,123,246,.9);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;letter-spacing:.5px;z-index:2}',
'.cauthor.ai{color:#a78bfa;font-weight:600}',
'.r18badge{position:absolute;left:4px;top:4px;background:rgba(192,57,43,.95);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;z-index:2}',
'.cwt{font-size:11px;color:#7fb3ff;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
'.titem .tn{position:absolute;left:4px;bottom:3px;font-size:10px;color:#dfe3e8;text-shadow:0 0 4px #000}',
'#canvas{margin:auto;min-width:100%;width:max-content;display:flex;align-items:center;justify-content:center;}',
    '#stage.mode-scroll #canvas{display:block;height:auto;min-height:0}',
    '#stage.zoom{display:block;padding:0;overflow:hidden;position:relative}',
    '#stage.zoom #canvas{position:absolute;left:0;top:0;display:block;width:max-content;height:auto;min-height:0;margin:0;will-change:transform}',
'/* 放大: 由 JS 给图片设显式像素宽(保证横向纵向都能滚) */',
/* 放大后取消尺寸上限, 让内容真正溢出 -> 出现横向+纵向滚动条, 顶部也能滚到 */
'#stage.zoom .pagewrap{max-width:none;max-height:none;margin:0;align-items:flex-start}',
'#stage.zoom .pageimg{max-width:none;max-height:none;overflow:visible}',
'#stage.zoom.mode-scroll .pageimg{width:100%;max-width:none}',
'#stage{scrollbar-width:thin;scrollbar-color:var(--r-fg2) transparent;scrollbar-gutter:stable}',
'#stage::-webkit-scrollbar{width:8px;height:8px}',
'#stage::-webkit-scrollbar-track{background:transparent}',
'#stage::-webkit-scrollbar-thumb{background:var(--r-fg2);border-radius:4px;border:none}',
'#stage::-webkit-scrollbar-thumb:hover{background:var(--r-fg)}',
'#stage.panning{cursor:grabbing}',
    '#stage.zoom{cursor:grab}',
'.tab{background:var(--surface2);border:0;color:var(--fg2);padding:5px 14px;border-radius:14px;cursor:pointer;font-size:12.5px;font-family:inherit;white-space:nowrap;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1)}',
'.tab:hover{color:var(--fg);background:var(--surface3)}',
'.tab.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:600;box-shadow:0 2px 8px rgba(47,109,246,.3)}',
'.tab:hover{background:var(--surface3);color:var(--fg)}',
'.tab.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 2px 8px rgba(47,109,246,.3)}',
'#dltabs{display:flex;gap:6px;margin:2px 0 12px}',
'#dltabs .tab.on{background:#2f6df6;color:#fff}',
'.sidehandle{position:absolute;top:0;bottom:0;width:22px;padding:0;border:0;background:#1d2027;color:#8b93a1;font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;font-family:inherit;transition:background-color .3s,color .3s,border-color .3s,opacity .3s}',
'.sidehandle span{display:inline-block;transition:transform .7s cubic-bezier(.4,0,.2,1)}',
'#bar,#sidebar,#thumbs{transition:opacity .3s,transform .3s ease}',
':fullscreen #bar{transform:translateY(-100%);position:fixed;top:0;left:0;right:0;z-index:100}',
':fullscreen #bar.show{transform:translateY(0)}',
'body.bar-autohide #bar{transform:translateY(-100%);position:fixed;top:0;left:0;right:0;z-index:100;transition:transform .25s ease}',
'body.bar-autohide #bar.show{transform:translateY(0)}',
'#sidebar .sidehandle{right:0;border-left:1px solid #26282e}',
'#thumbs .sidehandle{left:0;border-right:1px solid #26282e}',
'.sidehandle:hover{background:#2b2f38;color:#fff}',
'#sidebar.collapsed .sidehandle span{transform:rotate(180deg)}',
'#thumbs.collapsed .sidehandle span{transform:rotate(180deg)}',
'#reader[data-theme]{--r-tex:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/%3E%3CfeColorMatrix type=%22saturate%22 values=%220%22/%3E%3C/filter%3E%3Crect width=%22160%22 height=%22160%22 filter=%22url(%23n)%22 opacity=%220.1%22/%3E%3C/svg%3E")}',
'#reader[data-theme="mono"]{--r-view:#000;--r-panel:#0a0a0b;--r-panel2:#17181a;--r-line:#232326;--r-fg:#d5d9df;--r-fg2:#8b919b}',
'#reader[data-theme="dark"]{--r-view:var(--bg);--r-panel:var(--surface);--r-panel2:var(--surface2);--r-line:var(--border2);--r-fg:var(--fg);--r-fg2:var(--fg2)}',
'#reader[data-theme="light"]{--r-view:var(--bg);--r-panel:var(--surface);--r-panel2:var(--surface2);--r-line:var(--border2);--r-fg:var(--fg);--r-fg2:var(--fg2)}',
'#reader[data-theme="eye"]{--r-view:var(--bg);--r-panel:var(--surface);--r-panel2:var(--surface2);--r-line:var(--border2);--r-fg:var(--fg);--r-fg2:var(--fg2)}',
'#reader[data-theme="paper"]{--r-view:var(--bg);--r-panel:var(--surface);--r-panel2:var(--surface2);--r-line:var(--border2);--r-fg:var(--fg);--r-fg2:var(--fg2)}',
'#reader[data-theme="paper"]{--r-view:var(--bg);--r-panel:var(--surface);--r-panel2:var(--surface2);--r-line:var(--border2);--r-fg:var(--fg);--r-fg2:var(--fg2);--r-tex:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22260%22 height=%22260%22%3E%3Cfilter id=%22p%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.03%200.85%22 numOctaves=%223%22/%3E%3CfeColorMatrix type=%22saturate%22 values=%220%22/%3E%3C/filter%3E%3Crect width=%22260%22 height=%22260%22 filter=%22url(%23p)%22 opacity=%220.35%22/%3E%3C/svg%3E")}',
'#reader[data-theme="green"]{--r-view:#cbe4cf;--r-panel:#bedac3;--r-panel2:#aecfb4;--r-line:#9dbfa4;--r-fg:#22301f;--r-fg2:#4e6a52}',
'#reader[data-theme] #bar,#reader[data-theme] #sidebar,#reader[data-theme] #thumbs{background-color:var(--r-panel);background-image:var(--r-tex);background-size:160px 160px;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1),border-color 1.2s cubic-bezier(.4,0,.2,1)}',
'#reader[data-theme="paper"] #bar,#reader[data-theme="paper"] #sidebar,#reader[data-theme="paper"] #thumbs{background-size:260px 260px}',
'#reader[data-theme] #bar{border-bottom:1px solid var(--r-line);color:var(--r-fg)}',
'#reader[data-theme] #sidebar{border-right:1px solid var(--r-line)}',
'#reader[data-theme] #thumbs{border-left:1px solid var(--r-line)}',
'#reader[data-theme="paper"] #bar{border-bottom:1px solid rgba(60,45,20,.15) !important}',
'#reader[data-theme="paper"] #sidebar{border-right:1px solid rgba(60,45,20,.15) !important}',
'#reader[data-theme="paper"] #thumbs{border-left:1px solid rgba(60,45,20,.15) !important}',
'#reader[data-theme] .b{background:var(--r-panel2);color:var(--r-fg)}',
'#reader[data-theme] .b.on{background:#2f6df6;color:#fff}',
'#reader[data-theme] #bookname,#reader[data-theme] #thumbs h2,#reader[data-theme] #info{color:var(--r-fg2)}',
'#reader[data-theme] .ch{color:var(--r-fg)}',
'#reader[data-theme] .ch:hover{background:var(--r-panel2);color:var(--r-fg)}',
'#reader[data-theme] .ch.on{background:#2f6df6;color:#fff}',
'#reader[data-theme] #pageinput{background:var(--r-panel2);border:1px solid var(--r-line);color:var(--r-fg)}',
'#reader[data-theme] .sidehandle{background:var(--r-panel2);color:var(--r-fg2);border-color:var(--r-line)}',
'#reader[data-theme] .titem{background:var(--r-view)}',
'#reader[data-theme] #stage{position:relative;background-color:var(--r-view);background-image:linear-gradient(rgba(0,0,0,var(--r-dim,0)),rgba(0,0,0,var(--r-dim,0))),var(--r-tex);background-size:auto,160px 160px;background-repeat:repeat,repeat}',
'#reader[data-theme] #stage::-webkit-scrollbar-track{background:var(--r-panel)}',
'#rtswatch{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px}',
'#rtswatch button{width:78px;height:52px;border-radius:8px;border:2px solid #33363e;cursor:pointer;font-family:inherit;font-size:12px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px}',
'#rtswatch button.on{border-color:#2f6df6}',
'#selbar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--border2);border-radius:12px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,.3);z-index:60}',
'#selbar span{color:var(--fg);font-size:12.5px;margin-right:4px}',
'#selbar.hide{display:none}',
'#selbar #seldel{background:#c0392b;color:#fff}',
'#grid .card.sel{outline:2px solid #2f6df6;outline-offset:-2px;box-shadow:0 0 0 3px rgba(47,109,246,.3)}',
'.cnote{font-size:.76em;color:var(--fg2);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
'body.no-note .cnote{display:none}',
'.ctag{cursor:pointer}',
'.ctag.tag:hover{background:#2f6df6;color:#fff}',
'.ctag.cat:hover{background:#3a4150;color:#fff}',
'#sitebox{max-height:360px;overflow:auto;border:1px solid #26282e;border-radius:8px;padding:6px 8px;margin:6px 0 10px}',
'.sitegrp{font-size:12.5px;color:#f0c04a;padding:8px 2px 4px;border-top:1px solid #1d1f25}',
'.sitegrp:first-child{border-top:0;padding-top:2px}',
'.siterow{display:flex;align-items:baseline;gap:8px;padding:3px 2px}',
'.siterow .sitename{background:none;border:0;color:#6fa8ff;cursor:pointer;font-family:inherit;font-size:12.5px;padding:0;text-align:left;flex:0 0 auto}',
'.siterow .sitename:hover{color:#fff;text-decoration:underline}',
'.siterow .sitenote{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:#8b919b}',
'.siterow .siteok{color:#4ec27a;font-size:11.5px;flex:0 0 auto}',
'#dupbox{max-height:300px;overflow:auto;border:1px solid #26282e;border-radius:8px;padding:6px 8px;margin:6px 0 10px}',
'.duphead{font-size:12.5px;color:#f0c04a;padding:6px 2px 3px;border-top:1px solid #1d1f25}',
'.duphead:first-child{border-top:0}',
'.duprow{display:flex;align-items:center;gap:8px;padding:3px 2px}',
'.duprow .dupname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:#c3c8d0}',
'.duprow .dupmisc{font-size:11.5px;color:#8b919b;white-space:nowrap}',
'.toolrow{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 4px}',
'#aliasbox{max-height:240px;overflow:auto;border:1px solid #26282e;border-radius:8px;padding:6px 8px;margin:4px 0 10px}',
'.arow{display:flex;align-items:center;gap:8px;padding:3px 2px;border-bottom:1px solid var(--border)}',
'.arow:last-child{border-bottom:0}',
'.arow .aname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--fg)}',
'.arow .acnt{font-size:11.5px;color:var(--fg2);white-space:nowrap}',
'.arow .tab{padding:2px 9px;border-radius:8px;font-size:11.5px}',
'.arow input{background:var(--surface3);border:1px solid var(--border2);color:var(--fg);border-radius:6px;padding:4px 7px;font-family:inherit;font-size:12.5px;min-width:0}',
'.ahead{cursor:context-menu}',
'#jmqbox{max-height:170px;overflow:auto;background:#101115;border:1px solid #26282e;border-radius:8px;padding:6px 8px;margin-bottom:10px}',
'#jmqbox .stat{display:block!important}',
'.jmqrow{display:flex;align-items:center;gap:8px;padding:4px 2px;border-bottom:1px solid #1d1f25}',
'.jmqrow:last-child{border-bottom:0}',
'.jmqrow .jmqn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#c3c8d0}',
'.jmqrow .jmqs{font-size:11.5px;color:#8b919b;white-space:nowrap}',
'.jmqrow .jmqs.run{color:#f0c04a}',
'.jmqrow .jmqs.done{color:#4ec27a}',
'.jmqrow .jmqs.fail{color:#f06a6a}',
'.jmqrow .tab{padding:2px 8px;border-radius:8px;font-size:11.5px}',
'.tab:hover{background:#31343c;color:#fff}',
'.tab.on{background:#2f6df6;color:#fff}',
'.tab .cnt{opacity:.55;margin-left:6px;font-size:11px}',
'.tab.add{background:none;border:1px dashed #3a3e46;color:#8b919b}',
'.tab.add:hover{border-color:#2f6df6;color:var(--fg)}',
'body[data-shelf-theme="light"] .tab.add:hover{color:#1a1a1a}',
'body[data-shelf-theme="eye"] .tab.add:hover{color:#1a2a1a}',
'.star{position:absolute;bottom:6px;right:6px;width:auto;height:auto;background:none;border:0;color:#ffc53d;cursor:pointer;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;z-index:10;text-shadow:0 1px 4px rgba(0,0,0,.8)}',
'.star:hover{transform:scale(1.2)}',
'.star.on{color:#ffc53d}',
'.ctags{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}',
'.ctag{font-size:0.72em;background:var(--surface3);color:var(--fg);padding:2px 9px;border-radius:10px;white-space:nowrap;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;transition:background-color 1.2s cubic-bezier(.4,0,.2,1),color 1.2s cubic-bezier(.4,0,.2,1)}',
'.ctag.moretag{cursor:pointer;background:var(--surface2);color:var(--fg3);opacity:.85}',
'.ctag.moretag:hover{opacity:1;color:var(--fg)}',
'#ctx{position:fixed;z-index:200;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:4px;min-width:158px;box-shadow:0 8px 26px rgba(0,0,0,.4);display:none}',
'#ctx.on{display:block}',
'#ctx button{display:block;width:100%;text-align:left;background:none;border:0;color:var(--fg);padding:7px 12px;border-radius:5px;cursor:pointer;font-size:12.5px;font-family:inherit}',
'#ctx button:hover{background:var(--accent);color:#fff}',
'#modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:300;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .5s ease}',
'#modal.on{opacity:1;pointer-events:auto}',
'#mbox{background:var(--card-bg);border:1px solid var(--border2);border-radius:12px;padding:20px 22px;width:430px;max-width:92vw;max-height:86vh;overflow:auto;color:var(--fg);transform:scale(.95);transition:transform .5s ease}',
'#mbox.wide{width:680px;display:flex;flex-direction:column;align-self:flex-start;margin-top:100px}' + String.fromCharCode(10) + '#mbox.xl{width:92vw;max-width:1200px;height:88vh;display:flex;flex-direction:column;overflow-y:auto}',
'#mbox.wide .tabpanel{flex:1;overflow:visible;min-height:0}',
// 下载弹窗专用大尺寸: 比 #mbox 默认(430px)宽一倍以上, 页缩略图才排得下 5~6 列
'#mbox.dlg{width:min(1080px,94vw);max-width:94vw;height:min(88vh,900px);max-height:88vh;display:flex;flex-direction:column;overflow:hidden}',
'#mbox.dlg #dlpane{flex:1;min-height:0;overflow:auto}   // 注意: 这里别用 display:flex 列布局, 会把里面的页网格压成一行高',
'#mbox.dlg .tabpanel{flex:1;min-height:0;overflow:hidden}',
'#mbox.wide > *:not(div:last-child){flex-shrink:0}',
'#modal.on #mbox{transform:scale(1)}',
':root{--ease:cubic-bezier(.22,.61,.36,1);--t1:120ms;--t2:180ms;--t3:240ms}',
'/* 阅读页大图/页面图渐进显现(只动 opacity/blur, 不碰 transform, 免得和缩放/拖动打架) */',
'.pgin{opacity:0;transition:opacity 140ms var(--ease)}',
'.pgin-on{opacity:1}',
'/* View Transitions: 重排时老内容与新内容各自的过渡时长/曲线 */',
'::view-transition-old(root){animation-duration:var(--t2);animation-timing-function:var(--ease)}',
'::view-transition-new(root){animation-duration:var(--t3);animation-timing-function:var(--ease)}',
'::view-transition-group(*){animation-duration:var(--t3);animation-timing-function:var(--ease)}',
'/* 封面飞入/飞回的那一组单独慢一点, 240ms 太快会看不见 */',
'::view-transition-group(vt-cover){animation-duration:360ms;animation-timing-function:cubic-bezier(.3,.7,.3,1)}',
'#mbox h3{margin:0 0 5px;font-size:15px}',
'#mbox .sub{color:var(--fg2);font-size:12px;margin-bottom:12px;word-break:break-all;line-height:1.45}',
'#mbox label{display:block;color:var(--fg2);font-size:12.5px;margin:15px 0 6px}',
'#mbox input[type=text]{width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:7px;padding:8px 11px;font-family:inherit;font-size:13px;outline:none}',
'#mbox input[type=text]:focus{border-color:var(--accent)}',
'.chk{display:block;padding:6px 10px;border-radius:6px;cursor:pointer;color:#c3c8d0;font-size:13px;margin:0 !important}',
'.chk:hover{background:#22242a}',
'.chk input{margin-right:9px;vertical-align:middle}',
'#mfoot{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}',
'.btn{background:linear-gradient(135deg,#2f6df6,#4a8af8);border:0;color:#fff;padding:8px 19px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;box-shadow:0 2px 10px rgba(47,109,246,.3);transition:transform .15s,box-shadow .15s}',
'.btn.ghost{background:var(--surface3);color:var(--fg)}',
'.btn:hover{filter:brightness(1.12)}',
'#dlbar{height:6px;background:var(--surface3);border-radius:4px;overflow:hidden;margin:12px 0 4px}',
'#dlbar i{display:block;height:100%;background:var(--accent);border-radius:4px;transition:width .25s}',
'#dlinfo{display:flex;justify-content:space-between;font-size:12px;color:var(--fg2);margin-bottom:6px}',
'#dlinfo .pct{color:var(--accent2);font-weight:600}',
'#dlsteps{display:flex;font-size:10.5px;color:var(--fg3);margin-bottom:8px}',
'#dlsteps span{flex:1;text-align:center;position:relative;padding-top:7px}',
'#dlsteps span::before{content:empty;position:absolute;top:2px;left:0;right:0;height:1px;background:var(--border2)}',
'#dlsteps span:first-child::before{left:50%}',
'#dlsteps span:last-child::before{right:50%}',
'#dlsteps b{position:absolute;top:-1px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:var(--border2);font-weight:normal}',
'#dlsteps .ok{color:#5a9b6e}',
'#dlsteps .ok b{background:#5a9b6e}',
'#dlsteps .now{color:var(--accent2)}',
'#dlsteps .now b{background:var(--accent);box-shadow:0 0 5px var(--accent)}',
'#dllog{background:var(--thumb-bg);border:1px solid var(--border2);border-radius:7px;padding:9px 11px;height:150px;overflow:auto;font:11.5px/1.65 Consolas,Menlo,monospace;color:var(--fg2);white-space:pre-wrap;word-break:break-all;margin-top:10px}',
'#dllog .ok{color:#4ec9a0}',
'#dllog .er{color:#f06a6a}',
'#mbox .stat{color:#c3c8d0;font-size:12.5px;margin:10px 0 0;line-height:1.55;word-break:break-all}',
'#mbox textarea{width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--fg);border-radius:7px;padding:8px 11px;font-family:inherit;font-size:12.5px;line-height:1.65;outline:none;resize:vertical}',
'#mbox textarea:focus{border-color:#2f6df6}',
'.csrc{font-size:10.5px;color:#5f8fd8;margin-bottom:6px;word-break:break-all}'
].join('\n');

const JS_CORE = fs.readFileSync(path.join(HERE, 'reader-core.js'), 'utf8');

function buildHtml(comics, standalone, title) {
  const L = [];
  const p = (s) => L.push(s);
  p('<!DOCTYPE html>');
  p('<!-- 此文件由 build-library.mjs 自动生成，请勿手动编辑！手动修改会在下次构建时被覆盖。 -->');
  p('<html lang="zh-Hant">');
  p('<head>');
  p('<meta charset="utf-8">');
  p('<meta name="viewport" content="width=device-width,initial-scale=1">');
  p('<title>' + esc(title) + '</title>');
  p('<style>');
  p(CSS);
  p('</style>');
  p('</head>');
  p('<body>');
  p('<div id="shelf" class="view">');
  p('  <header id="shelfbar">');
  p('    <h1>' + esc(title) + '</h1>');
  p('    <div id="searchwrap"><input id="search" placeholder="搜索书名…   ( / )"><button id="btn-sitesearch" title="用这个关键词跨站搜索正经漫画站（再漫画 / Komiic …）">跨站搜索</button></div>');
  p('    <button id="btn-filter" title="展开/收起筛选面板：分组 / 排序 / 作者 / 分级 / 平台"><span id="btn-filter-txt">筛选 ▾</span><span class="fbadge clean" id="btn-filter-badge"></span></button>');
  p('    <div id="appactions" class="grp">');
  p('      <button class="b" id="btn-download" title="下载漫画：通用站点链接 / 禁漫天堂（两个页签）"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>下载漫画</button>');
  p('      <button class="b" id="btn-rebuild" title="全量重建：扫描整个书库，慢。下载/更新后的刷新是自动增量，不用点这个"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>更新书库</button>');
  p('      <button class="b" id="btn-history" title="阅读历史（按最近阅读时间）"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>历史</button>');
  p('      <button class="b" id="btn-settings" title="调整缩略图尺寸、间距、字号等"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>设置</button>');
  p('      <button class="b" id="btn-sites" title="免费中文漫画站总览：点站名就用「下载用的那个浏览器」打开"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>漫画网站总览</button>');
  p('      <button class="b" id="btn-theme" title="切换主题：暗黑 / 灰白 / 护眼"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span id="btn-theme-label">暗黑</span></button>');
  p('    </div>');
  p('    <span id="shelfstat"></span>');
  p('  </header>');
  p('  <div id="filterpanel"><div class="fpanel-inner">');
  p('    <div class="frow"><span class="flabel">分组</span><div class="fchips" id="chips-group"></div></div>');
  p('    <div class="frow"><span class="flabel">排序</span><div class="fchips" id="chips-sort"></div></div>');
  p('    <div class="frow collapsible closed" id="frow-author"><span class="flabel" id="fl-author">作者</span><div class="fchips" id="chips-author"></div></div>');
  p('    <div class="frow"><span class="flabel">分级</span><div class="fchips" id="chips-rating"></div></div>');
  p('    <div class="frow collapsible closed" id="frow-work"><span class="flabel" id="fl-work">作品</span><div class="fchips" id="chips-work"></div></div>');
  p('    <div class="frow collapsible closed" id="frow-plat"><span class="flabel" id="fl-plat">平台</span><div class="fchips" id="chips-plat"></div></div>');
  p('  </div></div>');
  p('  <nav id="cattabs"></nav>');
  p('  <nav id="albumbar"></nav>');
  p('  <div id="grid"></div>');
  p('  <div id="selbar" class="hide"><span id="seln">已选 0 本</span><button class="b" id="selalbum">新建专辑</button><button class="b hide" id="selremovealbum">移出专辑</button><button class="b" id="seltag">加标签</button><button class="b" id="selcat">移动分类</button><button class="b" id="seldel">删除</button><button class="b ghost" id="selclear">取消</button></div>');
  p('  <button id="totop" title="回到顶部">↑</button>');
  p('</div>');
  p('<div id="reader" class="view hide">');
  p('  <aside id="sidebar">');
  p('    <button class="sidehandle" id="sidetoggle" title="收起目录 (S)"><span>‹</span></button>');
  p('    <h2 id="bookname"></h2>');
  p('    <div id="chapters"></div>');
  p('  </aside>');
  p('  <div id="main">');
  p('    <div id="bar">');
  p('      <div class="grp"><button class="b" id="bback" title="返回书架 (Esc)">‹ 书架</button></div>');
  p('      <div class="grp">');
  p('        <button class="b" id="bprevch" title="上一话 ([)">‹ 上一话</button>');
  p('        <button class="b" id="bnextch" title="下一话 (])">下一话 ›</button>');
  p('      </div>');
  p('      <div class="grp">');
  p('        <button class="b" id="m-single" title="单页 (1)">单页</button>');
  p('        <button class="b" id="m-double" title="双页 (2)">双页</button>');
  p('        <button class="b" id="m-scroll" title="长条 (3)">长条</button>');
  p('      </div>');
  p('      <div class="grp">');
  p('        <button class="b" id="f-width" title="适应宽度">适宽</button>');
  p('        <button class="b" id="f-height" title="适应高度">适高</button>');
  p('        <button class="b" id="f-original" title="原始大小">原始</button>');
  p('      </div>');
  p('      <div class="grp">');
  p('        <button class="b" id="bdir" title="阅读方向">日漫「右→左」</button>');
p('        <button class="b" id="brev" title="章节观看顺序：正序(旧→新) / 倒序(新→旧)。X 这类站第一话是最早的图，想从最新看起就切倒序">顺序：旧→新</button>');
  p('        <button class="b" id="bcover" title="第一页作为封面单独显示">封面独立</button>');
  p('        <button class="b" id="bzoomout" title="缩小（以画面中心为准，每次 -25%）">－</button>');
    p('        <button class="b" id="bzoom" title="放大（以画面中心为准，每次 +25%）">＋</button>');
    p('        <button class="b" id="bzoomreset" title="重置画面大小（回到 100%）">⟲</button>');
  p('      </div>');
  p('      <div class="grp">');
  p('        <button class="b" id="bwheel" title="滚轮翻页 开/关">滚轮翻页</button>');
  p('        <button class="b" id="btheme" title="阅读配色与亮度（纯黑/深灰/米白纸/护眼绿）">配色</button>');
  p('        <button class="b" id="bbm" title="给当前页加书签 (B)">☆ 书签</button>');
  p('        <button class="b" id="bfull" title="全屏 (F)">全屏</button>');
  p('      </div>');
  p('      <div id="info">');
  p('        <span id="chname">-</span>');
  p('        <input id="pageinput" type="text" inputmode="numeric" title="输入页码后回车跳转">');
  p('        <span id="pageinfo">/ 0</span>');
  p('      </div>');
  p('    </div>');
  p('    <div id="stage" class="stage mode-single fit-height dir-rtl"></div>');
  p('  </div>');
  p('  <aside id="thumbs">');
  p('    <button class="sidehandle" id="thumbtoggle" title="展开预览 (P)"><span>›</span></button>');
  p('    <h2>预览 <button class="mini" id="prevrev" title="预览/翻页顺序">顺序</button></h2>');
  p('    <div id="thumblist"></div>');
  p('  </aside>');
  p('</div>');
  p('<div id="history" class="view hide">');
  p('  <header id="shelfbar">');
  p('    <h1>阅读历史</h1>');
  p('    <div class="grp"><button class="b" id="hback">‹ 返回书架</button></div>');
  p('    <span id="hstat"></span>');
  p('  </header>');
  p('  <div id="hlist"></div>');
  p('</div>');
  p('<div id="ctx"></div>');
  p('<div id="modal"></div>');
  p('<div id="hint"></div>');
  p('<script>');
  p('var RECOG_VER = ' + JSON.stringify(RECOG_VERSION) + ';');
  p(JS_CORE.split('__MANIFEST__').join(JSON.stringify(comics)).split('__STANDALONE__').join(standalone ? 'true' : 'false').split('__TITLE_JSON__').join(JSON.stringify(title)).split('__AUTHOR_ALIAS__').join(JSON.stringify(AUTHOR_ALIAS)));
  p('<\/script>');
  p('</body>');
  p('</html>');
  return L.join('\n');
}

/* 增量重建: --only "漫画/书名" (可多个, 逗号分隔) -> 只扫这些书, 其余从现有 书库.html 读回来
   这样下载完一本书就只重建一本, 不再每次全库扫描 */
const ONLY = String(arg('only', '') || '').split(/[,，]/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
function readOldManifest() {
  // 优先读构建直接产出的数据文件(稳定格式), 不再从生成的 HTML 里正则抠
  try {
    const j = JSON.parse(fs.readFileSync(path.join(LIB, '_manifest.json'), 'utf8'));
    if (j && Array.isArray(j.comics)) return { arr: j.comics, ver: j.recogVer || null };
  } catch (e) {}
  // 过渡期兼容: 老工程只有 书库.html 时仍能从里面抠出来
  try {
    const h = fs.readFileSync(path.join(LIB, '书库.html'), 'utf8');
    const vm = h.match(/var RECOG_VER = "([^"]*)"/);
    const oldVer = vm ? vm[1] : null;
    const at = h.indexOf('var COMICS = ');
    if (at < 0) return { arr: null, ver: oldVer };
    let rest = h.slice(at + 13);
    const nl = rest.indexOf('\n');
    if (nl >= 0) rest = rest.slice(0, nl);
    rest = rest.trim().replace(/;\s*$/, '');
    const arr = JSON.parse(rest);
    return { arr: Array.isArray(arr) ? arr : null, ver: oldVer };
  } catch (e) { return { arr: null, ver: null }; }
}
function incrementalScan(lib, only) {
  const old = readOldManifest();
  if (!old.arr) { console.log('读不回旧 manifest，退回全量重建'); return null; }
  if (old.ver !== RECOG_VERSION) {
    console.log('识别规则版本不匹配（旧 ' + (old.ver || '无') + ' → 新 ' + RECOG_VERSION + '），强制全量重建');
    return null;
  }
  const byDir = new Map();
  for (const c of old.arr) byDir.set(String(c.dir).replace(/\\/g, '/'), c);
  for (const d of only) {
    const parts = String(d).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const full = path.join(lib, ...parts);
    const relDir = parts.join('/');
    if (!fs.existsSync(full)) { byDir.delete(relDir); console.log('  ' + relDir + ' 已不存在, 从书库摘掉'); continue; }
    if (isCategoryDir(full)) { byDir.delete(relDir); continue; }
    const c = scanComic(full, relDir);
    if (c) { byDir.set(relDir, c); }
  }
  const list = Array.from(byDir.values());
  list.sort((x, y) => String(x.dir).localeCompare(String(y.dir), 'zh'));
  return list;
}
let comics = ONLY.length ? incrementalScan(LIB, ONLY) : null;
if (!comics) comics = scanLibrary(LIB);
if (ONLY.length) console.log('增量重建: 只处理 ' + ONLY.join(' , ') + '（其余 ' + (comics.length - ONLY.length) + ' 本从旧 manifest 沿用）');

/* ---------- 外部目录: 根目录放 外部目录.json, 就能"引用"别处的图包(不复制文件) ----------
   [ { "name": "书架上显示的名字", "path": "D:\\图包\\某人", "site": "x", "author": "某人" } ]
   目录结构和普通书一样: 子文件夹 = 一话, 里面的图片 = 页 */
let extList = [];
try { extList = JSON.parse(fs.readFileSync(path.join(LIB, '外部目录.json'), 'utf8')); } catch (e) { extList = []; }
for (const e2 of (Array.isArray(extList) ? extList : [])) {
  const nm = String(e2 && e2.name || '').trim();
  const p2 = String(e2 && e2.path || '').trim();
  if (!nm || !p2) continue;
  const abs = path.isAbsolute(p2) ? p2 : path.resolve(LIB, p2);
  if (!fs.existsSync(abs)) { console.log('外部目录不存在: ' + abs); continue; }
  const c = scanComic(abs, '外部/' + nm);
  if (!c) { console.log('外部目录里没有图片: ' + abs); continue; }
  c.ext = true; c.extPath = abs;
  comics.push(c);
}
comics.sort((a, b) => a.dir.localeCompare(b.dir, 'zh'));
let totalCh = 0, totalPg = 0;
for (const c of comics) { totalCh += c.chapters.length; for (const ch of c.chapters) totalPg += (ch.files ? ch.files.length : ch.n); }

/* ---------- 作者字段清洗 + 旧书作者回填（必须在识别/自动学习之前跑） ----------
   否则 learn() 拿到的 authorSet 是空的，作者名/汉化组会被当成"作品"学进表里 */
const AI_AUTHOR_RE = /^(ai[ _\-]?generated|ai\s*生成|ai\s*作画|ai\s*绘|ai\s*画集|ai\s*cg|ai\s*イラスト|ai\s*画|stable\s?diffusion|novelai|midjourney|生成ai)$/i;
const PLATFORM_AUTHOR_RE = /^(patreon|fantia|fanbox|booth|dlsite|pixiv|twitter|x|ci-en|gumroad|unifans)$/i;
const SKIP_AUTHOR_RE = /汉化|漢化|翻译|翻譯|嵌字|重嵌|个人汉化|汉化组|^ai[ _\-]?generated|^ai\s*生成|chinese|japanese|korean|^C\d{2,3}$|^DL$|^無?修正$|^Digital$|^Decensored$|^中国翻訳|核动力|^A\+$|^patreon$|^fantia$|^fanbox$|^booth$|^dlsite$|^pixiv$|^twitter$|^unifans$/i;
// 从 "社团名 (个人名)" 里提取括号内的个人名; 括号内是 @handle/uid 时用括号外的显示名
function pickAuthorName(raw) {
  var n = String(raw || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  var m = n.match(/^(.{1,60}?)[（(]([^（()）]{1,40})[)）]?\s*$/);
  if (m) {
    var inner = m[2].trim();
    if (/^[@＠]/.test(inner) || /^uid\s*[:：]/i.test(inner)) {
      return m[1].trim() || n;
    }
    if (inner && inner.length >= 2 && inner !== n) return inner;
  }
  return n;
}
let authorCleaned = 0, authorBackfilled = 0;
for (const c of comics) {
  if (c.ext) continue;
  const e = META_COMICS[c.dir] || (META_COMICS[c.dir] = { favorite: false, categories: [], tags: [], note: '' });
  if (e.author && (AI_AUTHOR_RE.test(String(e.author).trim()) || PLATFORM_AUTHOR_RE.test(String(e.author).trim()))) {
    delete e.author; authorCleaned++;
  }
  if (!e.author) {
    try {
      const fm = JSON.parse(fs.readFileSync(path.join(LIB, c.dir, '.fetch-meta.json'), 'utf8'));
      const fa = String(fm.author || fm.artist || '').trim();
      if (fa) { e.author = fa; authorBackfilled++; }
    } catch (e2) { /* 没有就跳过 */ }
  }
  if (!e.author) {
    const allBrackets = [...String(c.dir || '').matchAll(/[\[\(]([^\]\)]{2,30})[\]\)]/g)].map(m => m[1].trim());
    for (const cand0 of allBrackets) {
      const cand = pickAuthorName(cand0);
      if (!cand || cand.length < 2) continue;
      if (SKIP_AUTHOR_RE.test(cand)) continue;
      if (/^\d+$/.test(cand)) continue;
      e.author = cand; authorBackfilled++;
      break;
    }
  }
  if (!e.author) {
    const m4 = String(c.dir || '').match(/^漫画\/([A-Za-z0-9_][A-Za-z0-9 _·.\-]{1,28}?)\s*[-—–]\s*\S/);
    if (m4) {
      const cand = m4[1].trim();
      if (!SKIP_AUTHOR_RE.test(cand) && cand.length >= 3 && !/[\u4e00-\u9fff]/.test(cand)) {
        e.author = cand; authorBackfilled++;
      }
    }
  }
  if (e.author) {
    const fixed = pickAuthorName(String(e.author).trim());
    if (SKIP_AUTHOR_RE.test(fixed)) {
      delete e.author; authorCleaned++;
    } else if (fixed && fixed !== e.author) { e.author = fixed; }
  }
}
if (authorCleaned) console.log('作者清洗: 清掉 ' + authorCleaned + ' 个纯 AI 标记作者名');
if (authorBackfilled) console.log('作者回填: 从 .fetch-meta.json 补了 ' + authorBackfilled + ' 个作者');

/* ---------- 作品/角色识别 + AI 判定 + 自动学习 ---------- */
const authorSet = new Set();
for (const k of Object.keys(META_COMICS)) {
  const a = META_COMICS[k] && META_COMICS[k].author;
  if (a) {
    authorSet.add(String(a));                                   // 原样
    authorSet.add(String(a).replace(/[\[\]()（）]/g, ' ').replace(/\s+/g, ' ').trim());   // 去括号后的整串(社团+作者)
    String(a).split(/[\/(（]/).forEach((x) => { const t = x.replace(/[)）\]]/g, '').trim(); if (t) authorSet.add(t); });
  }
}
const tables = loadTables(LIB);
const titles = comics.map((c) => c.dir + ' ' + ((META_COMICS[c.dir] && META_COMICS[c.dir].desc) || ''));
const learned = learn(LIB, tables, titles, authorSet);
const allNames = tables.作品.map((w) => w.名).concat(tables.角色.map((c) => c.名));
let fetched = 0;
if (!argv.includes('--offline')) {
  try { fetched = await refreshAliases(HERE, allNames, 20, console.log); } catch (e) {}
}
const aliasCache = loadAliasCache(HERE);
if (learned.length) console.log('自动学到作品 ' + learned.length + ' 个: ' + learned.slice(0, 8).join(' / ') + (learned.length > 8 ? ' …' : ''));
if (fetched) console.log('联网刷新别名 ' + fetched + ' 个（其余用本地表/缓存，离线也能跑）');

const wt = {};
let aiCount = 0;
for (const c of comics) {
  const m = META_COMICS[c.dir] || {};
  const text = [c.dir, m.desc || '', (m.tags || []).join(' ')].join(' ');
  const r2 = matchWT(text, tables, aliasCache);
  const ai = isAI(text);
  if (ai) aiCount++;
  wt[c.dir] = { work: r2.work, char: r2.char, ai: ai };
}
console.log('AI 生成的书 ' + aiCount + ' 本 | 识别到作品 ' + Object.keys(wt).filter((k) => wt[k].work).length + ' 本 | 识别到角色 ' + Object.keys(wt).filter((k) => wt[k].char).length + ' 本');
// 角色也自动学: 用"作品已识别"的书名里的反复出现的候选
try {
  const bookList = comics.map((c) => ({ work: (wt[c.dir] && wt[c.dir].work) || '', text: c.dir + ' ' + ((META_COMICS[c.dir] && META_COMICS[c.dir].desc) || '') }));
  const learnedCh = learnChars(LIB, tables, bookList, authorSet);
  if (learnedCh.length) console.log('自动学到角色 ' + learnedCh.length + ' 个: ' + learnedCh.slice(0, 6).join(' | '));
  // 学完重新匹配一遍, 让新角色立刻生效
  for (const c of comics) {
    const m2 = META_COMICS[c.dir] || {};
    const t2 = [c.dir, m2.desc || '', (m2.tags || []).join(' ')].join(' ');
    const r3 = matchWT(t2, tables, loadAliasCache(HERE));
    wt[c.dir] = { work: r3.work, char: r3.char, ai: wt[c.dir] ? wt[c.dir].ai : isAI(t2) };
  }
} catch (e) { console.log('角色学习跳过: ' + e.message); }
/* ---------- 分级: 18+ / 非18+ ----------
   H 站(禁漫/EH/nhentai)用"非H"正则判定, 命中才算非18+, 否则默认18+; 正经站一律非18+; 手动优先 */
const rating = {};
for (const c of comics) {
  const m3 = META_COMICS[c.dir] || {};
  const site = (m3.source && (m3.source.site || m3.source.url)) || (c.ext ? 'external' : '');
  const text2 = [c.dir, m3.desc || '', (m3.tags || []).join(' ')].join(' ');
  const manual = (typeof m3.restricted === 'boolean') ? m3.restricted : undefined;
  rating[c.dir] = ratingOf(site, text2, manual);
}
const r18 = Object.keys(rating).filter((k) => rating[k] === '18+').length;
console.log('分级: 18+ ' + r18 + ' 本 | 非18+ ' + (Object.keys(rating).length - r18) + ' 本');
// 互相排斥地写进分类: 18+ 的书只进「18+」; 「漫画」只给正经漫画站的书
let catFixed = 0;
for (const c of comics) {
  const m4 = META_COMICS[c.dir] || (META_COMICS[c.dir] = { favorite: false, categories: [], tags: [], note: '' });
  const s4 = (m4.source && (m4.source.site || m4.source.url)) || (c.ext ? 'external' : '');
  const is18 = rating[c.dir] === '18+';
  const cats0 = (m4.categories || []).slice();
  // 两个分级分类先全部摘掉, 再按规则挂回去: 18+ 只挂「18+」, 正经漫画站的非18+书才挂「漫画」
  const want = is18 ? '18+' : (MANGA_SITE_RE.test(s4) ? '漫画' : '');
  let cats = cats0.filter((x) => x !== '18+' && x !== '漫画');
  if (want && cats.indexOf(want) < 0) cats.push(want);
  // EH 来源的书: 把旧的「漫画站」标签替换成「E-Hentai」
  if (/ehentai/i.test(s4)) {
    cats = cats.filter((x) => x !== '漫画站');
    if (cats.indexOf('E-Hentai') < 0) cats.push('E-Hentai');
  }
  if (cats.join('|') !== cats0.join('|')) { m4.categories = cats; catFixed++; } else { m4.categories = cats; }
  const tags0 = (m4.tags || []).slice();
  if (is18 && tags0.indexOf('18+') < 0) tags0.push('18+');
  if (/ehentai/i.test(s4)) {
    const iEH = tags0.indexOf('漫画站');
    if (iEH >= 0) { tags0.splice(iEH, 1); if (tags0.indexOf('E-Hentai') < 0) tags0.push('E-Hentai'); }
  }
  // 清洗脏标签: 一个标签里用 | 拼了多个词的(站点导出常见, 如 "frieren | beyond journeys end"), 拆开去重
  {
    const flat = [];
    for (const t of tags0) {
      if (typeof t !== 'string') { if (flat.indexOf(t) < 0) flat.push(t); continue; }
      const parts = t.split('|').map((x) => x.trim()).filter(Boolean);
      if (parts.length <= 1) { if (flat.indexOf(t) < 0) flat.push(t); }
      else for (const p of parts) if (flat.indexOf(p) < 0) flat.push(p);
    }
    m4.tags = flat;
    c.tags = flat;   // scanComics 早先把旧 m.tags 引用赋给了 c.tags, 这里同步
  }
}
if (catFixed) console.log('分类修正: ' + catFixed + ' 本(18+ 与 漫画 互斥)');
// AI 的书往 library.json 的标签里补「AI 生成」(书架的标签/筛选认的是 library.json)
let tagAdded = 0;
for (const c of comics) {
  const w = wt[c.dir];
  if (!w || !w.ai) continue;
  const e = META_COMICS[c.dir] || (META_COMICS[c.dir] = { favorite: false, categories: [], tags: [], note: '' });
  const tags = (e.tags || []).slice();
  if (tags.indexOf('AI 生成') < 0) { tags.push('AI 生成'); e.tags = tags; tagAdded++; }
}
if (tagAdded) console.log('已给 ' + tagAdded + ' 本书补上「AI 生成」标签');
/* 作者清洗块已挪到上方（识别/学习之前），此处不再重复 */
// --rematch: 把新匹配的 work/char 写回 library.json, 这样下次普通构建也用新值
if (REMATCH) {
  let remapped = 0;
  for (const c of comics) {
    const w = wt[c.dir];
    if (!w) continue;
    const e = META_COMICS[c.dir] || (META_COMICS[c.dir] = { favorite: false, categories: [], tags: [], note: '' });
    if (e.work !== w.work || e.char !== w.char) { e.work = w.work; e.char = w.char; remapped++; }
  }
  console.log('--rematch: 重写了 ' + remapped + ' 本书的 work/char 到 library.json');
}
// 一次性落盘: 标签 / 分类(含 18+ 与 漫画) / 分级 / 作者
try {
  META.comics = META_COMICS;
  if (!Array.isArray(META.categories)) META.categories = [];
  for (const c of ['漫画', '18+']) if (META.categories.indexOf(c) < 0) META.categories.push(c);
  fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify(META, null, 2), 'utf8');
} catch (e) { console.log('写 library.json 失败: ' + e.message); }

const libComics = comics.map(c => ({
  rating: rating[c.dir] || '',
  ratingAuto: (function () { const m5 = META_COMICS[c.dir] || {}; const st = (m5.source && (m5.source.site || m5.source.url)) || (c.ext ? 'external' : ''); return ratingOf(st, [c.dir, m5.desc || '', (m5.tags || []).join(' ')].join(' '), undefined); })(),
  ai: (META_COMICS[c.dir] && typeof META_COMICS[c.dir].ai === 'boolean') ? META_COMICS[c.dir].ai : !!(wt[c.dir] && wt[c.dir].ai),
  // 手动改过的以 library.json 为准(拖动改分组就写在这里), 其余用自动识别
  work: (!REMATCH && META_COMICS[c.dir] && META_COMICS[c.dir].work !== undefined) ? META_COMICS[c.dir].work : ((wt[c.dir] && wt[c.dir].work) || ''),
  char: (!REMATCH && META_COMICS[c.dir] && META_COMICS[c.dir].char !== undefined) ? META_COMICS[c.dir].char : ((wt[c.dir] && wt[c.dir].char) || ''),
  dir: c.dir, name: c.dir.split('/').pop(),
  cover: c.ext ? null : (coverOverrideOf(c) || coverOf(c.dir)),
  // 外部引用的书: 前缀用绝对 file:// 地址, 阅读器直接读别处的图
  prefix: c.ext ? ('file:///' + c.extPath.split(path.sep).join('/') + '/') : c.dir + '/',   // 不预先编码: 交给阅读器的 enc() 统一编码(否则 % 会被二次编码)
  ext: !!c.ext, extPath: c.extPath || '',
  size: c.size || 0,
  chapters: c.chapters,
  author: c.author, tags: c.tags, categories: c.categories, source: c.source, desc: c.desc, favorite: c.favorite
}));
// 书库数据落盘: 渲染层运行时来读(src/main.js -> 主进程 lib:manifest), 不再依赖构建期内联
fs.writeFileSync(path.join(LIB, '_manifest.json'), JSON.stringify({ recogVer: RECOG_VERSION, builtAt: new Date().toISOString(), count: libComics.length, comics: libComics }), 'utf8');
fs.writeFileSync(path.join(LIB, '书库.html'), buildHtml(libComics, false, path.basename(LIB)), 'utf8');

let n = 0;
const onlySet = new Set(ONLY);
for (const c of comics) {
  if (c.ext) continue;   // 外部引用的书不往人家目录里写文件
  if (ONLY.length && !onlySet.has(String(c.dir))) continue;   // 增量: 别的书不重写单行本阅读器(81 本 ×160KB 很费时间)
  const one = [{ dir: c.dir, name: c.dir.split('/').pop(), cover: null, prefix: '', chapters: c.chapters }];
  fs.writeFileSync(path.join(LIB, c.dir, '漫画阅读器.html'), buildHtml(one, true, c.dir.split('/').pop()), 'utf8');
  n++;
}

console.log('书库: ' + path.join(LIB, '书库.html') + '  (' + (fs.statSync(path.join(LIB, '书库.html')).size / 1024).toFixed(1) + ' KB)');
console.log('单行本阅读器: ' + n + ' 个');
console.log('合计: ' + comics.length + ' 本 / ' + totalCh + ' 话 / ' + totalPg + ' 页');
if (!ONLY.length) {   // 全量构建才列书单; 增量/下载收尾时别把全部书刷进日志
  for (const c of comics) {
    let pg = 0; for (const ch of c.chapters) pg += (ch.files ? ch.files.length : ch.n);
    console.log('  ' + c.dir + '   ' + c.chapters.length + ' 话 / ' + pg + ' 页');
  }
}
