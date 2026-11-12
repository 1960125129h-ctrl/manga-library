
// 一键全自动: 直取优先 → 接口不通才开浏览器 → 入库 → 重建书库
// 用法: node jm-auto.mjs "<专辑链接>" [更多...] [--img] [--edge]
//   --img : 图片直取（跳过验证码 / zip / 解压）。先走 jmcomic 接口（不开浏览器），
//           接口被 Cloudflare 拦住时才回退到「浏览器取章节表 + 图床直取」。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normTargets } from './target.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', '..');
const NODE = process.execPath;

const RAW_ARGS = process.argv.slice(2);
const IMG_MODE = RAW_ARGS.includes('--img');
const IMG_WORKERS = (RAW_ARGS.find(a => a.startsWith('--img-workers=')) || '').split('=')[1] || '';
const useEdge = RAW_ARGS.includes('--edge');
const useChrome = !useEdge;
const PORT = useEdge ? 9334 : 9333;
process.env.JM_PORT = String(PORT);

const targetArgs = RAW_ARGS.filter(a => !a.startsWith('--img') && a !== '--edge');
let urls = normTargets(targetArgs.join('\n').split(/[\s,;，；]+/));
const listFile = path.join(LIB, '待下载.txt');
if (!urls.length && fs.existsSync(listFile)) urls = normTargets(fs.readFileSync(listFile, 'utf8').split(/\r?\n/));
if (!urls.length) { console.log('没有可识别的目标。可写: JM1452133 / 1452133 / https://18comic.vip/album/1452133/'); process.exit(1); }
console.log((IMG_MODE ? '[模式] 图片直取' : '[模式] 老方式（浏览器 + 验证码 + zip）') + ' 待处理 ' + urls.length + ' 个目标');
for (const u of urls) console.log('  → ' + u);

async function portUp() {
  try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch (e) { return false; }
}
async function ensureBrowser() {
  if (await portUp()) { console.log('[浏览器] 已在运行 (' + PORT + ')'); return true; }
  console.log('[浏览器] 没开, 正在启动 ' + (useChrome ? 'Chrome' : 'Edge') + ' ...');
  const lr = spawnSync(NODE, [path.join(HERE, useChrome ? 'open-chrome.mjs' : 'open-edge.mjs')], { stdio: 'inherit', env: { ...process.env, JM_PORT: String(PORT) } });
  for (let i = 0; i < 60 && !(await portUp()); i++) await new Promise(r => setTimeout(r, 500));
  const ok = await portUp();
  if (!ok) console.log('[浏览器] 启动失败(退出码 ' + lr.status + ')');
  return ok;
}

let downloadOk = true;
let imported = false;

if (IMG_MODE) {
  // 1) 先走接口直取，全程不开浏览器
  console.log('[1] 走禁漫接口直取（不开浏览器）');
  // 不传 --no-build：让 jm-fast 自己按本次动过的书做增量重建
  const fastArgs = [path.join(HERE, 'jm-fast.mjs'), ...urls];
  if (IMG_WORKERS) fastArgs.push('--image-workers=' + IMG_WORKERS);
  const fast = spawnSync(NODE, fastArgs, { stdio: 'inherit', cwd: LIB });
  if (fast.status === 0) {
    console.log('[1] 接口直取完成');
  } else {
    // 2) 接口不通（多是 Cloudflare 挑战 / 域名被限），回退到浏览器取章节表 + 图床直取
    console.log('[2] 接口直取失败(退出码 ' + fast.status + ')，回退：浏览器取章节表 + 图床直取');
    if (!(await ensureBrowser())) {
      console.log('[2] 浏览器起不来，放弃');
      downloadOk = false;
    } else {
      const raArgs = [path.join(HERE, 'run-albums.mjs'), ...urls, '--img'];
      if (IMG_WORKERS) raArgs.push('--img-workers=' + IMG_WORKERS);
      const r = spawnSync(NODE, raArgs, { stdio: 'inherit', cwd: LIB });
      if (r.status !== 0) { console.log('[2] 回退下载退出码 ' + r.status); downloadOk = false; }
    }
  }
} else {
  // 老方式：必须有浏览器
  if (!(await ensureBrowser())) { console.log('浏览器没起来, 已中止。'); process.exit(1); }
  const r = spawnSync(NODE, [path.join(HERE, 'run-albums.mjs'), ...urls], { stdio: 'inherit', cwd: LIB });
  if (r.status !== 0) { console.log('[下载] 退出码 ' + r.status); downloadOk = false; }
}

// 3) 顺手把下载目录里手动下的包也收进来（仅老方式会产生 zip）
if (!IMG_MODE) {
  const DL = path.join(process.env.USERPROFILE || '', 'Downloads');
  try {
    const nums = fs.existsSync(DL) ? fs.readdirSync(DL).filter(f => /^\d+( \(\d+\))?\.zip$/.test(f)) : [];
    if (nums.length) { console.log('[3] 下载目录里有 ' + nums.length + ' 个手动包, 一并导入'); spawnSync(NODE, [path.join(HERE, 'import-zips.mjs'), '--dir', DL], { stdio: 'inherit', cwd: LIB }); imported = true; }
  } catch (e) {}
}

// 4) 重建书库：下载脚本已经按「本次动过的书」做过增量重建，这里只兜底
if (process.env.JM_NO_BUILD === '1') {
  console.log('[4] 跳过重建（由调用方处理）');
} else if (downloadOk && imported) {
  console.log('[4] 导入过手动包，全量重建一次');
  spawnSync(NODE, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB], { stdio: 'inherit', cwd: LIB });
} else if (downloadOk) {
  console.log('[4] 增量重建已由下载脚本完成，跳过');
} else {
  console.log('[4] 下载环节有问题，全量重建兜底');
  spawnSync(NODE, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB], { stdio: 'inherit', cwd: LIB });
}
console.log('全部完成。');
process.exit(downloadOk ? 0 : 1);
