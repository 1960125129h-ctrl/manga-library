import fs from 'node:fs';
const lib = JSON.parse(fs.readFileSync('library.json', 'utf8'));
const comics = lib.comics || {};
const bad = Object.keys(comics).filter((k) => !(comics[k].source && comics[k].source.site));
console.log('没有 source.site 的记录: ' + bad.length);
bad.slice(0, 6).forEach((k) => {
  console.log('=== ' + k.slice(3, 50));
  console.log('  字段: ' + Object.keys(comics[k]).join(','));
  console.log('  source: ' + JSON.stringify(comics[k].source));
  console.log('  tags: ' + JSON.stringify(comics[k].tags) + ' cats: ' + JSON.stringify(comics[k].categories));
  console.log('  author: ' + JSON.stringify(comics[k].author) + ' desc: ' + JSON.stringify(String(comics[k].desc || '').slice(0, 60)));
});
const withSite = Object.keys(comics).filter((k) => comics[k].source && comics[k].source.site).length;
console.log('有 source.site 的记录: ' + withSite);
const sites = {};
for (const k of Object.keys(comics)) { const s = (comics[k].source && comics[k].source.site) || '(无)'; sites[s] = (sites[s] || 0) + 1; }
console.log('站点分布: ' + JSON.stringify(sites));