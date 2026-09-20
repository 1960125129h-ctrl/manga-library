// 生成最终代码归档：包含活动源码、主进程、脚本、视觉验证截图和根配置。
// 不包含 .git、备份、运行依赖、缩略图缓存、预览缓存、漫画正文。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const stage = path.join(root, '_backup', `package-stage-${stamp}`);
const zip = path.join(root, '_backup', `workbench-douyin-final-${stamp}.zip`);

const includeDirs = ['src', '_app', '_scripts', '_visual-check', 'icons'];
const skipDirs = new Set(['node_modules', '.git', '_backup', '_css-backup', '_thumbs', '_预览', '漫画']);
const skipFiles = new Set(['.app-pid']);

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function walkDir(dir, relBase) {
  for (const name of fs.readdirSync(dir)) {
    const from = path.join(dir, name);
    const rel = relBase ? path.join(relBase, name) : name;
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      if (skipDirs.has(name)) continue;
      walkDir(from, rel);
    } else if (st.isFile()) {
      if (skipFiles.has(name)) continue;
      copyFile(from, path.join(stage, rel));
    }
  }
}

try {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const dir of includeDirs) {
    const from = path.join(root, dir);
    if (fs.existsSync(from)) walkDir(from, dir);
  }
  for (const name of fs.readdirSync(root)) {
    const from = path.join(root, name);
    if (fs.statSync(from).isFile() && !skipFiles.has(name)) {
      copyFile(from, path.join(stage, name));
    }
  }

  const ps = `Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath '${stage}' -Force).FullName -DestinationPath '${zip}' -Force`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    throw new Error('Compress-Archive failed');
  }
  console.log(zip);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
