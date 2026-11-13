import fs from 'node:fs';
const h = fs.readFileSync('书库.html', 'utf8');
const i0 = h.indexOf('var COMICS = ');
const start = h.indexOf('[', i0);
let depth = 0, inStr = false, esc = false, end = -1;
for (let i = start; i < h.length; i++) {
  const ch = h[i];
  if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
  if (ch === '"') { inStr = true; continue; }
  if (ch === '[') depth++;
  else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const a = JSON.parse(h.slice(start, end));
const out = [];
const P = (x) => out.push(x);
P('manifest 本数: ' + a.length);
const H = /18comic|e-hentai|nhentai|jmcomic|hanime/i;
const r18 = a.filter((c) => c.rating === '18+');
P('rating=18+ 的本数: ' + r18.length + ' | 其他: ' + (a.length - r18.length));
P('');
P('== 18+ 分类里但评级不是18+ 的 ==');
const bad = a.filter((c) => (c.categories || []).indexOf('18+') >= 0 && c.rating !== '18+');
P('数量: ' + bad.length);
bad.slice(0, 10).forEach((c) => P('   ! ' + c.dir.replace('漫画/', '').slice(0, 40) + ' | rating=' + (c.rating || '空') + ' | site=' + ((c.source && c.source.site) || '无')));
P('');
P('== 漫画 分类里但来源是H站 的 ==');
const bad2 = a.filter((c) => (c.categories || []).indexOf('漫画') >= 0 && H.test((c.source && c.source.site) || ''));
P('数量: ' + bad2.length);
bad2.slice(0, 12).forEach((c) => P('   ! ' + c.dir.replace('漫画/', '').slice(0, 40) + ' | rating=' + (c.rating || '空') + ' | site=' + ((c.source && c.source.site) || '无')));
P('');
P('== 漫画 分类里来源缺失 的 ==');
const bad3 = a.filter((c) => (c.categories || []).indexOf('漫画') >= 0 && !(c.source && c.source.site));
P('数量: ' + bad3.length);
bad3.slice(0, 14).forEach((c) => P('   ! ' + c.dir.replace('漫画/', '').slice(0, 46) + ' | rating=' + (c.rating || '空')));
P('');
P('== 无来源的本(全部) ==');
const nosrc = a.filter((c) => !(c.source && c.source.site));
P('数量: ' + nosrc.length);
P('');
P('== 卡片标签重复(会连出两次) ==');
let dupn = 0; const samp = [];
for (const c of a) {
  const t = (c.tags || []).concat(c.categories || []);
  const seen = new Set(), dup = [];
  for (const x of t) { if (seen.has(x)) dup.push(x); else seen.add(x); }
  if (dup.length) { dupn++; if (samp.length < 8) samp.push(c.dir.replace('漫画/', '').slice(0, 26) + ' -> 重复: ' + JSON.stringify(dup) + ' | tags=' + JSON.stringify(c.tags) + ' cats=' + JSON.stringify(c.categories)); }
}
P('会重复显示的本数: ' + dupn + ' / ' + a.length);
samp.forEach((x) => P('   ' + x));
P('');
P('== 分类计数 ==');
const cnt = {};
for (const c of a) for (const x of c.categories || []) cnt[x] = (cnt[x] || 0) + 1;
P(JSON.stringify(cnt));
fs.writeFileSync('_audit-out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
