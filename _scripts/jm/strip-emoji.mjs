// 一次性清理活动源码和文档中的 emoji。不处理 JSON 数据、依赖、备份、构建产物和漫画正文。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const skipDirs = new Set(['node_modules', '.git', '_backup', '_dist', '漫画', 'chrome-profile', 'tools', '__pycache__']);
const exts = new Set(['.js', '.mjs', '.css', '.html', '.md', '.cmd']);
const emojiRe = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
let changed = 0;

function cleanText(text) {
  return text.replace(emojiRe, '');
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!skipDirs.has(name)) walk(p);
      continue;
    }
    if (!exts.has(path.extname(name))) continue;
    const old = fs.readFileSync(p, 'utf8');
    const next = cleanText(old);
    if (next !== old) {
      fs.writeFileSync(p, next, 'utf8');
      changed++;
      console.log('cleaned ' + path.relative(root, p));
    }
  }
}

walk(path.join(root, 'src'));
walk(path.join(root, '_app'));
walk(path.join(root, '_scripts'));
for (const name of fs.readdirSync(root)) {
  if (name.endsWith('.md') || name === '书库.html') {
    const p = path.join(root, name);
    const old = fs.readFileSync(p, 'utf8');
    const next = cleanText(old);
    if (next !== old) {
      fs.writeFileSync(p, next, 'utf8');
      changed++;
      console.log('cleaned ' + name);
    }
  }
}
console.log('changed files: ' + changed);
