import fs from 'node:fs';
const bak = fs.readdirSync('_backup').filter((f) => f.startsWith('library-')).sort().pop();
const lib = JSON.parse(fs.readFileSync('_backup/' + bak, 'utf8'));
const comics = lib.comics || {};
const keys = Object.keys(comics);
const noPref = keys.filter((k) => k.indexOf('漫画/') !== 0);
console.log('备份文件: ' + bak);
console.log('总记录 ' + keys.length + ' | 不带 漫画/ 前缀的 ' + noPref.length);
let match = 0, orphan = 0; const recover = {};
for (const k of noPref) {
  const cand = '漫画/' + k;
  if (fs.existsSync(cand)) { match++; recover[cand] = comics[k]; } else { orphan++; }
}
console.log('  其中磁盘上能找到 漫画/<同名> 的: ' + match);
console.log('  真正没有目录的: ' + orphan);
console.log('  样例: ' + Object.keys(recover).slice(0, 5).map((x) => x.slice(3, 34)).join(' | '));
console.log('  可恢复记录里带来源链接的: ' + Object.keys(recover).filter((k) => recover[k].source).length);