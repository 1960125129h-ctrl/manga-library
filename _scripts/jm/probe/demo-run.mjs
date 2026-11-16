#!/usr/bin/env node
/**
 * 演示模式启动器。
 *
 * 为什么不让 .cmd 直接起 electron：
 *   cmd 在 GBK 环境下处理含中文的 %~dp0 变量不可靠，
 *   MANGA_USERDATA 传不过去时应用会回落到默认书库（真实书目）。
 *   这里由 Node 拼路径并 spawn，UTF-8 全程安全。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', '..', '..');
const DEMO = path.join(LIB, '_demo');
const LIB_DIR = path.join(DEMO, 'library');
const UD = path.join(DEMO, 'userdata');
const APP = path.join(LIB, '_app');
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');

if (!fs.existsSync(ELECTRON)) {
  console.error('找不到 electron: ' + ELECTRON);
  console.error('请先在 _app 目录执行 npm install');
  process.exit(1);
}
if (!fs.existsSync(path.join(LIB_DIR, '_manifest.json'))) {
  console.error('演示库还没生成，请先运行:');
  console.error('  node _scripts\\jm\\probe\\make-demo.mjs');
  process.exit(1);
}

fs.mkdirSync(UD, { recursive: true });
// 每次都确保 config.json 指向演示库
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  ...(function () { try { return JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')); } catch (e) { return {}; } })(),
  libraryRoot: LIB_DIR,
}, null, 2), 'utf8');

const env = { ...process.env, MANGA_USERDATA: UD };
delete env.ELECTRON_RUN_AS_NODE;   // 这个变量会让 electron 以纯 Node 跑，不建窗口

console.log('演示书库: ' + LIB_DIR);
console.log('独立配置: ' + UD);
console.log('');
console.log('提示：演示库无任何 18+ 标记，可放心截图 / 录屏。');

const child = spawn(ELECTRON, ['.'], { cwd: APP, env, detached: true, stdio: 'ignore' });
child.unref();
