import fs from 'node:fs';
const lib = JSON.parse(fs.readFileSync('library.json', 'utf8'));
const comics = lib.comics || {};
const keys = Object.keys(comics);
const sizes = {};
for (const k of keys) { const n = Object.keys(comics[k]).length; sizes[n] = (sizes[n] || 0) + 1; }
console.log('每条记录的字段数分布: ' + JSON.stringify(sizes));
const small = keys.filter((k) => Object.keys(comics[k]).length <= 4);
console.log('字段<=4 的条目数: ' + small.length);
small.slice(0, 6).forEach((k) => console.log('  ' + k.replace('漫画/', '').slice(0, 30) + ' => ' + JSON.stringify(comics[k])));
const noSite = keys.filter((k) => !(comics[k].source && comics[k].source.url));
console.log('无来源条目字段数样本:');
noSite.slice(0, 4).forEach((k) => console.log('  ' + k.replace('漫画/', '').slice(0, 24) + ' => 字段=' + Object.keys(comics[k]).join(',') + ' | cats=' + JSON.stringify(comics[k].categories)));
console.log('顶层 library.json 键: ' + Object.keys(lib).join(','));
