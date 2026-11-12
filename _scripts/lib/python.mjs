// 找 Python 解释器 —— 缩略图 / 拼页 / 切页校验 三件事都靠它
//
// 【为什么要单独一个模块】
// 以前这个路径是**写死在 4 个文件里**的:
//   C:\Users\终楠\AppData\Local\Programs\Python\Python311\python.exe
// 换电脑、改用户名、或者把项目交给别人 —— 三件事会**一起坏**, 而且是静默地坏:
//   · 缩略图不再生成      -> 表现为"书架卡片没图"
//   · 禁漫拼页没做出来    -> 表现为"长条图没拼上"
//   · 拼页不生效          -> 表现为"长条图没拼上"
// 都不会报"找不到 Python"。
//
// 解析顺序(先到先用):
//   ① 环境变量 MANGA_PY        —— 显式指定最优先, 也是换机时的逃生口
//   ② 用户级安装目录 %LOCALAPPDATA%\Programs\Python\Python3*
//   ③ 系统级 C:\Python3*  /  C:\Program Files\Python3*
//   ④ PATH 上的 python / python3

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

let cached;
let looked = false;

function candidates() {
  const out = [];
  if (process.env.MANGA_PY) out.push(process.env.MANGA_PY);

  const bases = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Python'),
    'C:\\', 'C:\\Program Files', 'C:\\Program Files (x86)',
  ];
  for (const base of bases) {
    if (!base) continue;
    let dirs = [];
    try { dirs = fs.readdirSync(base).filter((x) => /^Python3\d+$/.test(x)); } catch (e) { continue; }
    // 版本号大的优先(311 > 310 > 39)
    dirs.sort((a, b) => parseInt(b.slice(6), 10) - parseInt(a.slice(6), 10));
    for (const d of dirs) out.push(path.join(base, d, 'python.exe'));
  }
  out.push('python', 'python3');   // 走 PATH
  return out;
}

// 返回可用的 python 路径, 找不到返回 null(不抛错 —— 调用方自己决定是跳过还是报错)
export function findPython() {
  if (looked) return cached;
  looked = true;
  for (const c of candidates()) {
    if (!c) continue;
    const isPath = c.includes('\\') || c.includes('/');
    if (isPath) { if (fs.existsSync(c)) { cached = c; return cached; } continue; }
    try { execSync('"' + c + '" -V', { stdio: 'ignore', timeout: 5000 }); cached = c; return cached; } catch (e) {}
  }
  cached = null;
  return null;
}

// 需要 Python 才能干活的地方用它: 找不到就**明确报错退出**, 别静默跳过
export function requirePython(what) {
  const p = findPython();
  if (p) return p;
  console.error('');
  console.error('  [找不到 Python] ' + (what || '这个功能') + ' 需要它。');
  console.error('  装一个:  https://www.python.org/downloads/   (装完可能要重开一次终端)');
  console.error('  装依赖:  pip install pillow opencv-python numpy');
  console.error('  或指定:  set MANGA_PY=D:\\somewhere\\python.exe');
  console.error('');
  process.exit(2);
}

// 可选的(比如缩略图): 找不到就返回 null, 调用方打印一句说明后继续
export function optionalPython() { return findPython(); }
