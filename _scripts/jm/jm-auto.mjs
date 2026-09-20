
// 一键全自动: 确保浏览器调试会话 -> 逐本下载入库 -> 重建书库
// 用法: node jm-auto.mjs "<专辑链接>" [更多链接...]   或把链接一行一条写进 待下载.txt 后直接运行
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', '..');
const NODE = process.execPath;

// 参数可以是 JM 编号 / 纯数字 / 专辑链接 / 单话链接 / 无协议域名, 一行一个或空格分开
import { normTargets } from './target.mjs';
let urls = normTargets(process.argv.slice(2).join('\n').split(/[\s,;，；]+/));
const listFile = path.join(LIB, '待下载.txt');
if (!urls.length && fs.existsSync(listFile)) urls = normTargets(fs.readFileSync(listFile, 'utf8').split(/\r?\n/));
if (!urls.length) { console.log('没有可识别的目标。可写: JM1452133 / 1452133 / https://18comic.vip/album/1452133/ ，或写进 ' + listFile); process.exit(1); }
console.log('待处理 ' + urls.length + ' 个目标');
for (const u of urls) console.log('  → ' + u);

// 1) 确保 Chrome 调试会话在
// 默认用 Edge(禁漫登录态在 Edge); 加 --chrome 可强制用 Chrome
const useEdge = process.argv.includes('--edge');      // 默认 Chrome, 加 --edge 切到 Edge
const useChrome = !useEdge;
const PORT = useEdge ? 9334 : 9333;
process.env.JM_PORT = String(PORT);
async function portUp() { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch (e) { return false; } }
if (!(await portUp())) {
  console.log('[1] 调试浏览器(' + (useChrome ? 'Chrome' : 'Edge') + ')没开, 正在启动 ...');
  const lr = spawnSync(NODE, [path.join(HERE, useChrome ? 'open-chrome.mjs' : 'open-edge.mjs')], { stdio: 'inherit', env: { ...process.env, JM_PORT: String(PORT) } });
  for (let i = 0; i < 60 && !(await portUp()); i++) await new Promise(r => setTimeout(r, 500));
  if (!(await portUp())) {
    console.log('[1] 浏览器没起来(启动器退出码 ' + lr.status + '), 已中止。' + (useChrome ? '' : ' 若是登录态被占用: 先完全关闭 Edge 再重跑一次(只需一次)。'));
    process.exit(1);
  }
}
console.log('[1] 调试浏览器(' + (useChrome ? 'Chrome' : 'Edge') + '): ' + ((await portUp()) ? '就绪 (' + PORT + ')' : '启动失败'));

// 2) 下载 + 入库
const r = spawnSync(NODE, [path.join(HERE, 'run-albums.mjs'), ...urls], { stdio: 'inherit', cwd: LIB });
if (r.status !== 0) { console.log('[2] 下载环节退出码 ' + r.status); }

// 3) 顺手把下载目录里手动下的包也收进来
const DL = path.join(process.env.USERPROFILE || '', 'Downloads');
try {
  const nums = fs.existsSync(DL) ? fs.readdirSync(DL).filter(f => /^\d+( \(\d+\))?\.zip$/.test(f)) : [];
  if (nums.length) { console.log('[3] 下载目录里有 ' + nums.length + ' 个手动包, 一并导入'); spawnSync(NODE, [path.join(HERE, 'import-zips.mjs'), '--dir', DL], { stdio: 'inherit', cwd: LIB }); }
} catch (e) {}

// 4) 重建书库
spawnSync(NODE, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB], { stdio: 'inherit', cwd: LIB });
console.log('全部完成。');
