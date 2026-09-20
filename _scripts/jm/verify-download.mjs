// verify-download.mjs —— 下载链路端到端验收
//
// 前面几个验收工具都不碰真实下载, 所以 fetch-book 里那层契约校验、
// 图片地址构造、任务栏进度事件 都没被验证过。这个工具补上:
// 通过 App 自己触发一次"只下 2 页"的极小下载, 全程收集事件, 最后清掉。
//
//   node _scripts\jm\verify-download.mjs [目标URL] [书名]
// 退出码 0 = 全过
//
// 默认目标是一个 nhentai 单画廊, 只下第 1、2 页(很小)。

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { startApp, waitBooted, LIB } from './appctl.mjs';

// 下载要走本地代理(fetch-book.mjs 里 NODE_USE_ENV_PROXY 那段写死了 127.0.0.1:7890)。
// 代理没开时请求必然 ECONNREFUSED —— 那是环境问题不是代码问题, 所以这里先探一下,
// 没开就报"跳过"并正常退出, 免得每次代理没开都误报成回归失败。
const PROXY = { host: '127.0.0.1', port: 7890 };
const proxyUp = await new Promise((res) => {
  const s = net.connect(PROXY.port, PROXY.host);
  const done = (v) => { try { s.destroy(); } catch (e) {} res(v); };
  s.setTimeout(900);
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
  s.once('timeout', () => done(false));
});
if (!proxyUp) {
  console.log('  跳过: 代理 ' + PROXY.host + ':' + PROXY.port + ' 没开 —— 下载要走它, 这不是代码问题。');
  console.log('');
  console.log('结果: 跳过(代理未开)');
  process.exit(0);
}

const URL_ = process.argv[2] || 'https://nhentai.net/g/435944/';
const NAME = process.argv[3] || '_下载验收';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };

const app = await startApp(9800);
const { p } = app;
const outDir = path.join(LIB, '漫画', NAME);

try {
  chk('界面核心已启动', await waitBooted(p));

  // 收集下载事件
  await p.ev('window.__evs=[]; window.mangaLib.onDownload(function(e){ try{window.__evs.push(e);}catch(x){} }); "ok"', 2);

  const started = JSON.parse(String(await p.ev('window.mangaLib.dlStart({url:' + JSON.stringify(URL_) + ',name:' + JSON.stringify(NAME) + ',pages:"1,2"}).then(function(r){return JSON.stringify(r);})', 2) || '{}'));
  chk('下载已启动', !!started.ok, started.msg || '');

  // 轮询到结束
  let evs = [], finished = null;
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    evs = JSON.parse(String(await p.ev('JSON.stringify(window.__evs||[])', 2) || '[]'));
    const term = evs.filter((e) => e && (e.type === 'done' || e.type === 'error'));
    if (term.length) { finished = term[term.length - 1]; break; }
  }
  chk('下载走到结束', !!finished, finished ? ('type=' + finished.type) : '超时未结束');

  const types = {};
  evs.forEach((e) => { const k = (e && e.type) || '?'; types[k] = (types[k] || 0) + 1; });
  console.log('     事件统计: ' + JSON.stringify(types));

  const progs = evs.filter((e) => e && e.type === 'prog');
  chk('有进度事件(任务栏进度就是靠它驱动)', progs.length > 0, 'prog=' + progs.length + (progs.length ? (' 末次 got/total=' + progs[progs.length - 1].got + '/' + progs[progs.length - 1].total) : ''));

  const logLines = evs.filter((e) => e && e.type === 'log').map((e) => String(e.line || ''));
  const contract = logLines.filter((s) => s.indexOf('契约') >= 0 || s.indexOf('不符合契约') >= 0);
  chk('无契约报错', contract.length === 0, contract.length ? contract[0].slice(0, 160) : '');
  // 契约层"拦住"的报错也会出现在 error 事件里
  const errMsg = finished && finished.type === 'error' ? String(finished.message || '') : '';
  chk('结束时没有报错', !errMsg, errMsg.slice(0, 160));

  // 磁盘上真有文件吗
  let files = [];
  try {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (/\.(webp|jpg|jpeg|png|gif)$/i.test(e.name)) files.push(q);
    });
    if (fs.existsSync(outDir)) walk(outDir);
  } catch (e) {}
  const bytes = files.reduce((a, f) => { try { return a + fs.statSync(f).size; } catch (e) { return a; } }, 0);
  chk('图片真的落盘了', files.length > 0, files.length + ' 个 / ' + Math.round(bytes / 1024) + ' KB');
  if (files.length) console.log('     ' + files.slice(0, 4).map((f) => path.basename(f)).join(', '));

  // 主进程会按事件类型校验必备字段, 缺了会写进应用日志。这里回读确认没违反。
  let contractLog = [];
  try {
    const logDir = path.join(LIB, '_scripts', 'jm', 'logs');
    const today = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const lf = path.join(logDir, today.getFullYear() + '-' + p2(today.getMonth() + 1) + '-' + p2(today.getDate()) + '.log');
    if (fs.existsSync(lf)) {
      const all = fs.readFileSync(lf, 'utf8').split('\n');
      const since = all.slice(-400);   // 只看最近一段, 免得把历史记录算进来
      contractLog = since.filter((l) => l.indexOf('[契约]') >= 0 && l.indexOf('dl:event') >= 0);
    }
  } catch (e) {}
  chk('事件字段契约没被违反', contractLog.length === 0, contractLog.length ? contractLog[contractLog.length - 1].slice(0, 170) : '应用日志里无 [契约] 告警');

  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  chk('渲染进程零未捕获异常', exs.length === 0, exs.length ? String(exs.length) + ' 个' : '');
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
  // 清掉这次验收下下来的书
  try { fs.rmSync(outDir, { recursive: true, force: true }); console.log('  (已清掉 ' + outDir + ')'); } catch (e) {}
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
