// 扫描活动源码中的 emoji。不扫描依赖、备份、构建产物、浏览器 Profile 和漫画正文。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const skipDirs = new Set(['node_modules', '.git', '_backup', '_dist', '漫画', 'chrome-profile', 'tools', '__pycache__']);
const exts = new Set(['.js', '.mjs', '.css', '.html', '.md', '.cmd']);
const emojiRe = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
let hits = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!skipDirs.has(name)) walk(p);
      continue;
    }
    if (!exts.has(path.extname(name))) continue;
    const text = fs.readFileSync(p, 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      const ms = line.match(emojiRe);
      if (!ms) return;
      hits += ms.length;
      console.log(path.relative(root, p) + ':' + (i + 1) + ' ' + ms.join(' ') + '  ' + line.trim().slice(0, 140));
    });
  }
}

walk(root);
console.log('emoji count: ' + hits);
process.exit(hits ? 1 : 0);
