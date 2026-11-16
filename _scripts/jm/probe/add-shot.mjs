#!/usr/bin/env node
/**
 * 把你自己截的图 / 录的 GIF 收进 README 素材目录。
 *
 * 用法（把文件拖进命令行也行）：
 *
 *   node _scripts\jm\probe\add-shot.mjs <文件> <名字> [说明文字]
 *
 * 例子：
 *   node _scripts\jm\probe\add-shot.mjs "%USERPROFILE%\Desktop\截图.png" shelf 书架总览
 *   node _scripts\jm\probe\add-shot.mjs "%USERPROFILE%\Desktop\录屏.mp4" strip 长条模式
 *
 * 它做四件事：
 *   1) 按扩展名分流：png/jpg 直接复制，mp4/mov/webm 调 ffmpeg 转 GIF
 *   2) 统一改名成「<名字>.png / <名字>.gif」放进 assets/screenshots/
 *   3) 超过 1.5MB 的 GIF 自动压一轮（缩宽 + 减色）
 *   4) 打印可以直接粘进 README 的 markdown
 *
 * 加 --replace 覆盖同名文件（默认遇到同名会拦下来）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(LIB, 'assets', 'screenshots');
const FF = path.join(LIB, '_scripts', 'tools', 'ffmpeg', 'ffmpeg-9.0.1-essentials_build', 'bin', 'ffmpeg.exe');

const argv = process.argv.slice(2).filter((a) => a !== '--replace');
const replace = process.argv.includes('--replace');
const [src, name, caption] = argv;

if (!src || !name) {
  console.log('用法: node _scripts\\jm\\probe\\add-shot.mjs <文件> <名字> [说明文字] [--replace]');
  console.log('');
  console.log('  <文件>  截图或录屏，png/jpg/mp4/mov/webm 都行');
  console.log('  <名字>  英文小写，用连字符，例如 shelf、mode-strip');
  console.log('  --replace  同名文件直接覆盖');
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error('找不到文件: ' + src);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const ext = path.extname(src).toLowerCase();
const isVideo = ['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext);
const targetExt = isVideo ? '.gif' : '.png';
const target = path.join(OUT, name + targetExt);

if (fs.existsSync(target) && !replace) {
  console.error('已存在同名文件: ' + path.basename(target));
  console.error('要覆盖请加 --replace');
  process.exit(1);
}

if (isVideo) {
  if (!fs.existsSync(FF)) {
    console.error('找不到 ffmpeg: ' + FF);
    process.exit(1);
  }
  console.log('转 GIF: ' + path.basename(src) + ' → ' + path.basename(target));
  const tmp = path.join(OUT, '_tmp-' + name + '.gif');
  let r = spawnSync(FF, [
    '-y', '-i', src,
    '-vf', 'fps=12,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none',
    '-loop', '0', tmp,
  ], { stdio: 'pipe' });
  if (r.status !== 0) {
    console.error('ffmpeg 失败:');
    console.error(String(r.stderr || '').split('\n').slice(-6).join('\n'));
    process.exit(1);
  }
  // 太大再压一轮
  let size = fs.statSync(tmp).size;
  if (size > 1.5 * 1024 * 1024) {
    console.log('  ' + Math.round(size / 1024) + 'KB 偏大，再压一轮');
    const tmp2 = path.join(OUT, '_tmp2-' + name + '.gif');
    spawnSync(FF, [
      '-y', '-i', tmp,
      '-vf', 'fps=10,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none',
      '-loop', '0', tmp2,
    ], { stdio: 'pipe' });
    if (fs.existsSync(tmp2)) { fs.rmSync(tmp); fs.renameSync(tmp2, tmp); }
    size = fs.statSync(tmp).size;
  }
  fs.renameSync(tmp, target);
} else {
  fs.copyFileSync(src, target);
}

const kb = Math.round(fs.statSync(target).size / 1024);
const rel = 'assets/screenshots/' + path.basename(target);
const alt = caption || name;
console.log('');
console.log('已放入: ' + rel + '  (' + kb + 'KB)');
console.log('');
console.log('粘进 README 用这一行：');
console.log('');
console.log('![' + alt + '](' + rel + ')');
console.log('');
if (kb > 1200 && targetExt === '.gif') {
  console.log('提示：' + kb + 'KB 偏大，可以用 --replace 重跑，或先裁剪录屏范围再转。');
}
