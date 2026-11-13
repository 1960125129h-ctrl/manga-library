import fs from 'node:fs';
const lib = JSON.parse(fs.readFileSync('library.json', 'utf8'));
const comics = lib.comics || {};
const keys = Object.keys(comics);
const out = [];
const P = (x) => out.push(x);

P('== 条数 ==');
P('library.json 条目: ' + keys.length);
const missing = keys.filter((k) => !fs.existsSync(k));
P('目录不存在的孤儿: ' + missing.length + (missing.length ? ' -> ' + missing.join(' | ') : ''));
const dirs = fs.readdirSync('漫画', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => '漫画/' + d.name);
const notInLib = dirs.filter((d) => !comics[d]);
P('磁盘有目录但 library.json 没记录: ' + notInLib.length + (notInLib.length ? ' -> ' + notInLib.slice(0, 8).join(' | ') : ''));

P('');
P('== 分类互斥 ==');
const both = [], neither = [], mismatch = [];
for (const k of keys) {
  const c = comics[k].categories || [];
  const is18 = comics[k].rating === '18+';
  const has18 = c.indexOf('18+') >= 0, hasM = c.indexOf('漫画') >= 0;
  if (has18 && hasM) both.push(k);
  if (!has18 && !hasM) neither.push(k);
  if (is18 !== has18) mismatch.push(k + '  rating=' + (comics[k].rating || '空') + ' cats=' + JSON.stringify(c));
}
P('同时有 漫画 和 18+: ' + both.length);
both.slice(0, 10).forEach((k) => P('   ! ' + k.replace('漫画/', '').slice(0, 40) + '  site=' + ((comics[k].source && comics[k].source.site) || '无')));
P('两个分类都没有: ' + neither.length);
neither.slice(0, 10).forEach((k) => P('   ! ' + k.replace('漫画/', '').slice(0, 40) + '  cats=' + JSON.stringify(comics[k].categories) + ' site=' + ((comics[k].source && comics[k].source.site) || '无')));
P('评级与 18+ 分类不一致: ' + mismatch.length);
mismatch.slice(0, 10).forEach((k) => P('   ! ' + k.slice(0, 90)));

P('');
P('== 分级与来源矛盾 ==');
const H = /18comic|e-hentai|nhentai|jmcomic|hanime/i;
const SFW = /zaimanhua|xmanhua|komiic|manhuagui|dm5|pixiv/i;
const bad1 = [], bad2 = [];
for (const k of keys) {
  const site = (comics[k].source && comics[k].source.site) || '';
  const is18 = comics[k].rating === '18+';
  if (is18 && SFW.test(site) && !H.test(site)) bad1.push(k + ' (' + site + ')');
  if (!is18 && H.test(site)) bad2.push(k + ' (' + site + ')');
}
P('18+ 但来源标记为正经站: ' + bad1.length); bad1.slice(0, 8).forEach((x) => P('   ! ' + x.slice(0, 80)));
P('非18+ 但来源是H站: ' + bad2.length); bad2.slice(0, 8).forEach((x) => P('   ! ' + x.slice(0, 80)));

P('');
P('== 标签重复 ==');
let dupSelf = 0, overlap = 0; const samples = [];
for (const k of keys) {
  const t = comics[k].tags || [], c = comics[k].categories || [];
  if (t.length !== new Set(t).size) { dupSelf++; if (samples.length < 6) samples.push('自身重复: ' + k.replace('漫画/', '').slice(0, 20) + ' ' + JSON.stringify(t)); }
  const ov = t.filter((x) => c.indexOf(x) >= 0);
  if (ov.length) { overlap++; if (samples.length < 12) samples.push('tags与分类重叠: ' + k.replace('漫画/', '').slice(0, 18) + ' tags=' + JSON.stringify(t) + ' cats=' + JSON.stringify(c)); }
}
P('tags 内部重复: ' + dupSelf);
P('tags 与 categories 重叠(卡片上会连出两次): ' + overlap);
samples.forEach((x) => P('   ' + x));

P('');
P('== 元数据缺失 ==');
const noSite = keys.filter((k) => !(comics[k].source && comics[k].source.url));
P('没有来源链接: ' + noSite.length); noSite.slice(0, 12).forEach((k) => P('   ! ' + k.replace('漫画/', '').slice(0, 44) + ' tags=' + JSON.stringify(comics[k].tags) + ' cats=' + JSON.stringify(comics[k].categories)));
const noTags = keys.filter((k) => !(comics[k].tags || []).length);
P('没有任何 tags: ' + noTags.length);
const noDesc = keys.filter((k) => !comics[k].desc);
P('没有 desc: ' + noDesc.length);

P('');
P('== 来源/分级统计 ==');
const pl = {}, rt = {};
for (const k of keys) { const p = (comics[k].source && comics[k].source.site) || '无来源'; pl[p] = (pl[p] || 0) + 1; const r = comics[k].rating || '非18+'; rt[r] = (rt[r] || 0) + 1; }
P('来源: ' + JSON.stringify(pl));
P('分级: ' + JSON.stringify(rt));
fs.writeFileSync('_audit-out.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
