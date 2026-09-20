// 书库体检: 数据结构一致性 + 残留垃圾检查。用法: node _scripts\doctor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..');
const CAT = '漫画';
const out = [];
const say = (k, v) => { out.push([k, v]); console.log(k + ': ' + v); };

// 1) 适配器
try {
  const { pathToFileURL } = await import('node:url');
  const m = await import(pathToFileURL(path.join(HERE, 'sites', 'index.mjs')).href);
  say('适配器', m.ids());
} catch (e) { say('适配器', '加载失败 → ' + e.message); }

// 2) 书库一致性
let lib = { comics: {} };
try { lib = JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')); } catch (e) { say('library.json', '读不出来 → ' + e.message); }
const dirs = fs.readdirSync(path.join(LIB, CAT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => CAT + '/' + d.name);
const keys = Object.keys(lib.comics || {});
say('书目录数', dirs.length + ' 本');
say('library.json 条目', keys.length + ' 条');
const orphan = keys.filter((k) => !fs.existsSync(path.join(LIB, k)));
const noEntry = dirs.filter((d) => !lib.comics[d]);
say('孤儿条目(条目在、目录没了)', orphan.length ? orphan.join(' | ') : '无');
say('缺条目的书(目录在、条目没了)', noEntry.length ? noEntry.slice(0, 12).join(' | ') + (noEntry.length > 12 ? ' …共' + noEntry.length : '') : '无');

// 3) 来源缺失 / 空话 / 残留文件
let noSrc = 0, emptyCh = [], junk = [], metaOk = 0, withMeta = 0;
for (const d of dirs) {
  const e = lib.comics[d];
  if (e && !(e.source && (e.source.site || e.source.url))) noSrc++;
  const full = path.join(LIB, d);
  let mf = null;
  try { mf = JSON.parse(fs.readFileSync(path.join(full, '.fetch-meta.json'), 'utf8')); } catch (x) {}
  if (mf) withMeta++;
  let chs = 0, imgs = 0;
  const walk = (p2, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(p2, { withFileTypes: true }); } catch (x) { return; }
    let here = 0;
    for (const en of ents) {
      if (en.name.charAt(0) === '.') continue;
      if (en.name.indexOf('__tmp_') === 0 || en.name.indexOf('__dy_') === 0 || en.name.indexOf('__rn') > 0 || en.name === '__m') junk.push(d + '/' + en.name);
      if (en.isDirectory()) walk(path.join(p2, en.name), depth + 1);
      else if (/\.(jpg|jpeg|png|webp|gif)$/i.test(en.name)) { here++; imgs++; }
    }
    if (depth > 0 && here === 0) emptyCh.push(d + '/' + path.basename(p2));
    if (depth > 0) chs++;
  };
  walk(full, 0);
  if (mf && Object.keys(mf.ids || {}).length) metaOk++;
}
say('没有来源(未标注)的书', noSrc + ' 本');
say('空话(目录里一张图都没有)', emptyCh.length ? emptyCh.slice(0, 8).join(' | ') + (emptyCh.length > 8 ? ' …共' + emptyCh.length : '') : '无');
say('临时文件残留', junk.length ? junk.slice(0, 8).join(' | ') + (junk.length > 8 ? ' …共' + junk.length : '') : '无');
say('平台书的 id 记账(.fetch-meta.json)', withMeta + ' 本有 / 其中 ' + metaOk + ' 本有 id 记录');

// 4) 体积
const size = (p2) => { try { return Math.round(fs.statSync(p2).size / 1024) + 'KB'; } catch (e) { return '-'; } };
say('缓存体积', ['cache-x.json', 'cache-pixiv.json'].map((f) => f + ' ' + size(path.join(HERE, 'sites', f))).join(' / '));
say('书库总体积', Math.round(dirs.reduce((s, d) => { let t = 0; try { t = fs.readdirSync(path.join(LIB, d)).length; } catch (e) {} return s + (t ? 0 : 0); }, 0) || 0) === 0 ? (() => { let b = 0; const w = (p2) => { for (const en of fs.readdirSync(p2, { withFileTypes: true })) { const q = path.join(p2, en.name); if (en.isDirectory()) w(q); else try { b += fs.statSync(q).size; } catch (e) {} } }; w(path.join(LIB, CAT)); return (b / 1073741824).toFixed(2) + ' GB'; })() : '-');
console.log('\n体检完成：' + out.length + ' 项');
