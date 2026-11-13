// shot.mjs —— 一条命令把 HTML 截成 PNG(内部用 Electron, 不开调试端口)
// 用法: node _scripts\jm\probe\shot.mjs --html "D:/.../书库.html" --out "_visual-check/x.png" [--w 1400] [--h 900] [--wait 3000] [--js 脚本.js] [--show]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..', '..');
const ELECTRON = path.join(LIB, '_app/node_modules/electron/dist/electron.exe');
const MAIN = path.join(LIB, '_scripts/jm/shot-main.cjs');

if (!fs.existsSync(ELECTRON)) { console.log('找不到 electron: ' + ELECTRON); process.exit(1); }
if (!fs.existsSync(MAIN)) { console.log('找不到 shot-main.cjs'); process.exit(1); }

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('用法: node _scripts\\jm\\shot.mjs --html <文件> --out <png> [--w 1400] [--h 900] [--wait 3000] [--js 脚本.js] [--show]');
  process.exit(args.length ? 0 : 1);
}
const hasOut = args.includes('--out');
if (!hasOut) args.push('--out', path.join(LIB, '_visual-check', 'shot-' + Date.now() + '.png'));

const p = spawn(ELECTRON, [MAIN, ...args], { stdio: 'inherit', cwd: LIB });
p.on('exit', (code) => process.exit(code === 0 ? 0 : 1));
