// verify.mjs —— 固定验证入口。用法: node _scripts\jm\verify.mjs <场景名>
// 它负责: 找到/启动 App(自动挑可用端口) → 选中书库页面 → 跑 _scripts\jm\scenarios\<场景>.js → 打印结果
// 场景就是一段在页面里执行的 JS, 想加新检查就往 scenarios 目录丢一个文件, 不用改这里。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './cdp.mjs';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..');
const JM = path.join(LIB, '_scripts/jm');
const SCEN = path.join(JM, 'scenarios');
const PORTFILE = path.join(JM, '.port');

const name = process.argv[2];
if (!name || name === '--help' || name === '-h') {
  const list = fs.existsSync(SCEN) ? fs.readdirSync(SCEN).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')) : [];
  console.log('用法: node _scripts\\jm\\verify.mjs <场景名>');
  console.log('可用场景: ' + (list.length ? list.join(', ') : '(还没有)'));
  process.exit(name ? 0 : 1);
}
const scenFile = path.join(SCEN, name + '.js');
if (!fs.existsSync(scenFile)) { console.log('没有这个场景: ' + name); process.exit(1); }

async function ping(p, timeoutMs = 800) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch('http://127.0.0.1:' + p + '/json/version', { signal: ac.signal });
    clearTimeout(timer);
    return r.ok;
  } catch (e) { return false; }
}
async function run(cmd, args) {
  return await new Promise((res) => {
    const p = spawn(process.execPath, [cmd, ...args], { cwd: LIB, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.on('exit', (code) => res({ code: code, out: out }));
  });
}

// ① 拿到一个"真的能应答"的端口: 先用上次记下的, 不行就让 app-start 去挑一个并启动
let port = 0;
let last = 0;
try { last = parseInt(fs.readFileSync(PORTFILE, 'utf8').trim(), 10) || 0; } catch (e) {}
if (last && await ping(last)) port = last;
if (!port) {
  console.log('(App 没在跑或者端口不通, 交给 app-start 处理…)');
  const r = await run(path.join(JM, 'app-start.mjs'), []);
  process.stdout.write(r.out);
  const m = r.out.match(/PORT=(\d+)/);
  if (!m) { console.log('拿不到端口, 中止'); process.exit(1); }
  port = parseInt(m[1], 10);
}
console.log('用端口 ' + port);

// ② 选中书库页面(没有就导航过去)
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
let target = list.find((x) => x.type === 'page' && /%E4%B9%A6%E5%BA%93\.html|书库\.html/.test(x.url)) || list.find((x) => x.type === 'page');
if (!target) { console.log('没有可用的页面目标'); process.exit(1); }
const page = await openPage(port, target.id);
if (!/%E4%B9%A6%E5%BA%93\.html|书库\.html/.test(target.url)) {
  await page.goto('file:///' + LIB.replace(/ /g, '%20') + '/%E4%B9%A6%E5%BA%93.html');
}

// ③ 等页面真的渲染出来(冷启动约 1~2 秒) —— 不然后面读到的全是 0
let ready = false;
for (let i = 0; i < 50; i++) {
  try { const n = await page.ev('document.querySelectorAll("#grid .card").length'); if (Number(n) > 0) { ready = true; break; } } catch (e) {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) console.log('(提示: 25 秒内没等到卡片, 场景数据可能为空)');

// ④ 让它稳定一下再跑(封面解码/懒加载需要一点时间)
await new Promise((r) => setTimeout(r, 1200));

// ⑤ 跑场景(最多 4 次 —— 自足场景可能会先点开一本书, 需要再来一次才有数据)
const code = fs.readFileSync(scenFile, 'utf8');
let out = null, err = null;
for (let i = 0; i < 5; i++) {
  try { out = await page.ev(code); err = null; } catch (e) { err = e; }
  const s = (typeof out === 'string') ? out : JSON.stringify(out);
  // 结果里带"状态"= 场景在说"我刚点了书/切了模式, 再跑一次才有真数据"
  if (!err && s && s.indexOf('"状态"') < 0) break;
  await new Promise((r) => setTimeout(r, 2500));
}if (err) { console.log('场景执行失败: ' + String(err && err.message || err).slice(0, 300)); page.close(); process.exit(1); }
console.log('=== ' + name + ' ===');
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
page.close();
