// css-snapshot.mjs —— 抓/比"全部元素 × CSS 涉及的全部属性"的计算样式
//
//   node _scripts\jm\css-snapshot.mjs before.json
//   node _scripts\jm\css-snapshot.mjs after.json before.json     抓完并逐字段比对(有差异则退出码 1)
//
// 为什么不用截图: 截图证明的是"看起来一样", 而 CSS 重排最危险的是**层叠顺序变了**
// —— 同优先级规则换了胜出者, 经常只差 1px 或只在某个界面态里出现。计算样式是权威答案。
//
// 只抓 CSS 文件里**真正出现过**的属性: 没被任何规则设置的属性, 其计算值与层叠顺序无关,
// 抓了也是浪费 —— 而且全属性抓会产出 ~1.6MB 的 CDP 消息把连接卡死(踩过)。
//
// 会在 8 个界面态下各抓一遍, 落盘成 JSON。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, waitBooted } from './appctl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = process.argv[2];
const cmp = process.argv[3];

// 纯比对模式: 拿两份已抓好的快照比, 不用起 App
//   node _scripts\jm\css-snapshot.mjs --diff <基准.json> <新版.json>
if (out === '--diff') {
  const A = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const B = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const shown = []; let diffs = 0, checked = 0;
  for (const ba of A) {
    const bb = B.find((x) => x.name === ba.name);
    if (!bb) { console.log('  !! 缺界面态 ' + ba.name); diffs++; continue; }
    if (ba.els.length !== bb.els.length) { console.log('  !! [' + ba.name + '] 元素数 ' + ba.els.length + ' -> ' + bb.els.length); diffs++; }
    const map = new Map(bb.els.map((e) => [e.k, e.s]));
    for (const be of ba.els) {
      const as = map.get(be.k);
      if (!as) { diffs++; if (shown.length < 25) shown.push('[' + ba.name + '] 缺 ' + be.k.slice(-70)); continue; }
      for (const pr in be.s) { checked++; if (as[pr] !== be.s[pr]) { diffs++; if (shown.length < 30) shown.push('[' + ba.name + '] ' + be.k.slice(-60) + '  ' + pr + ': ' + be.s[pr] + ' -> ' + as[pr]); } }
      for (const pr in as) if (!(pr in be.s)) { diffs++; if (shown.length < 30) shown.push('[' + ba.name + '] ' + be.k.slice(-60) + '  多出 ' + pr + '=' + as[pr]); }
    }
  }
  console.log('比对 ' + process.argv[3] + ' vs ' + process.argv[4]);
  console.log(checked + ' 个(元素,属性)对, 差异 ' + diffs + ' 处');
  shown.forEach((s) => console.log('  ' + s));
  if (!diffs) console.log('等价性成立: 全部计算样式逐字段一致');
  process.exit(diffs ? 1 : 0);
}

if (!out) { console.log('用法: node _scripts\\jm\\css-snapshot.mjs <输出.json> [对比.json] | --diff <基准.json> <新版.json>'); process.exit(1); }

// 从 styles/ 抽出所有出现过的属性名
const PROPS = (() => {
  const dir = path.join(ROOT, 'src/styles');
  const set = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.css')) continue;
    const t = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of t.matchAll(/([a-z-]{2,})\s*:/g)) set.add(m[1]);
  }
  return [...set].sort();
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 每次抓取前把"会影响布局的持久化状态"清干净。
// 不清的话两次运行会拿到不同结果(上次留下的侧栏/缩略图栏开关) —— 快照就没法当基准了。
// 这是同一个坑的第三次: verify-reader 那次是 .progress.json 的阅读位置, 这次是它里面的
// sidebar/thumbs 开关 + localStorage 里的 readerDefaults/shelfView/shelfTheme。
try { fs.rmSync(path.join(ROOT, '.progress.json'), { force: true }); } catch (e) {}

const app = await startApp(9870);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 3));
const click = async (id) => { try { await p.ev('(function(){var b=document.getElementById(' + JSON.stringify(id) + ');if(b)b.click();})()', 2); } catch (e) {} await sleep(550); };

const GRAB = '(function(){' +
  'var P=' + JSON.stringify(PROPS) + ';' +
  'var path=function(el){var parts=[],cur=el;' +
  ' while(cur&&cur.nodeType===1&&parts.length<8){' +
  '  var s=cur.tagName.toLowerCase(); if(cur.id)s+="#"+cur.id;' +
  '  if(cur.className&&typeof cur.className==="string")s+="."+cur.className.trim().split(/\\s+/).join(".");' +
  '  var par=cur.parentNode;' +
  '  if(par){var sib=par.children,k=0,idx=-1; for(var i=0;i<sib.length;i++){if(sib[i]===cur)idx=k; if(sib[i].tagName===cur.tagName)k++;} s+="["+idx+"]";}' +
  '  parts.unshift(s);cur=par;}' +
  ' return parts.join(">");};' +
  'var all=document.querySelectorAll("body *"),res=[];' +   // 只比 body 子树: head 里的 link 数量是结构差异, 不影响视觉
  'for(var i=0;i<all.length;i++){var el=all[i],cs=getComputedStyle(el),rec={};' +
  ' for(var j=0;j<P.length;j++){var v=cs.getPropertyValue(P[j]); if(v)rec[P[j]]=v;}' +
  ' res.push({k:path(el),s:rec});}' +
  'return JSON.stringify(res);})()';

// 等界面"停止变化"再抓。
// 不等的话会拿到半成品: 卡片颜色是异步从封面图提取的(#f5 的发光), cmeta 是懒建的,
// 右键菜单的位置取决于点击有没有落地 —— 同一份代码抓两次能差出十几个字段(实测)。
// 判据: 元素数 + #grid 高度 + body.innerHTML 长度 连续 3 次不变。
const settle = async (timeout = 10000) => {
  let prev = '', stable = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let sig = '';
    try {
      // 还要看"有没有动画/过渡在跑" —— CSS 过渡不改变 DOM, 光看 DOM 会在过渡中途抓到
      // 中间值(下载弹窗那个 #dlp 的边框色就是这么飘的)。
      sig = await ev('(function(){var g=document.getElementById("grid");' +
        'var run=0; try{run=document.getAnimations().filter(function(a){return a.playState==="running";}).length;}catch(e){}' +
        'return document.body.querySelectorAll("*").length+"|"+(g?Math.round(g.getBoundingClientRect().height):0)+"|"+document.body.innerHTML.length+"|"+run;})()');
      if (sig && sig.split('|').pop() !== '0') { stable = 0; prev = ''; await sleep(300); continue; }
    } catch (e) {}
    if (sig && sig === prev) { if (++stable >= 3) return true; } else { stable = 0; prev = sig; }
    await sleep(400);
  }
  return false;
};

const states = [];
const snap = async (name) => {
  await settle();
  // 焦点态也是不定因素: 弹窗里的元素有没有焦点决定 :focus-visible 那条规则生不生效,
  // 而焦点取决于前面的点击序列。统一先 blur, 让状态确定。
  await ev('(function(){try{if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();}catch(e){}})()').catch(() => {});
  await sleep(300);
  let arr = [];
  try { const raw = await ev(GRAB); arr = JSON.parse(raw); }
  catch (e) { console.log('  !! ' + name + ' 抓取失败: ' + ((e && e.message) || e)); }
  states.push({ name, els: arr });
  console.log('  抓取 ' + name.padEnd(20) + arr.length + ' 个元素');
};

try {
  await waitBooted(p); await sleep(500);
  // 清 localStorage 再刷新一次, 保证从"全新用户"的默认状态开始
  await p.ev('(function(){try{localStorage.clear();}catch(e){} location.reload();})()', 2).catch(() => {});
  await sleep(3000);
  await waitBooted(p); await sleep(1200);
  // 关掉过渡/动画再抓: 否则会抓到过渡途中的中间值(input 边框色差 1~2 个色阶就是这么来的)。
  // getAnimations() 兜不住 —— 过渡可能在"DOM 已稳定"之后才起跑。关掉动画之后计算样式直接是终值,
  // 而两轮运行用的是同一条覆盖规则, 比对依然有效。
  await ev('(function(){var s=document.createElement("style");s.id="__snap_noanim";' +
    's.textContent="*,*::before,*::after{transition:none !important;animation:none !important}";' +
    'document.head.appendChild(s);})()');
  await sleep(600);
  await snap('书架-默认');
  await ev('(function(){var c=document.querySelector("#grid > *");if(c)c.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:300,clientY:300}));})()');
  await sleep(500); await snap('书架-右键菜单');
  await ev('document.body.dispatchEvent(new MouseEvent("click",{bubbles:true}))'); await sleep(300);

  await ev('(function(){var c=document.querySelector("#grid > *");if(c)c.click();})()'); await sleep(2200);
  for (const [btn, nm] of [['m-single','阅读器-单页'],['m-double','阅读器-双页'],['m-scroll','阅读器-滚动']]) {
    await click(btn); await sleep(700); await snap(nm);
  }
  await click('thumbtoggle'); await sleep(700); await snap('阅读器-缩略图栏');
  await click('btheme'); await sleep(600); await snap('阅读器-主题弹窗');
  await ev('(function(){var b=document.querySelector("#mfoot button");if(b)b.click();})()'); await sleep(500);
  await click('bback'); await sleep(1200);

  await click('btn-download'); await sleep(1200); await snap('下载弹窗');
  await ev('(function(){var m=document.getElementById("modal");if(m&&m.onmouseup)m.onmouseup({target:m});})()'); await sleep(600);
  await click('btn-settings'); await sleep(900); await snap('设置面板');
  await ev('(function(){var m=document.getElementById("modal");if(m&&m.onmouseup)m.onmouseup({target:m});})()'); await sleep(600);
  await click('btn-history'); await sleep(900); await snap('历史面板');

  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  console.log('  未捕获异常: ' + exs.length);
} catch (e) {
  console.log('  ERR ' + ((e && e.message) || e));
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}

fs.writeFileSync(out, JSON.stringify(states));
console.log('已写入 ' + out + ': ' + states.length + ' 个界面态 / ' + states.reduce((s, x) => s + x.els.length, 0) + ' 个元素');

if (cmp) {
  const before = JSON.parse(fs.readFileSync(cmp, 'utf8'));
  let diffs = 0, checked = 0;
  const shown = [];
  for (const b of before) {
    const a = states.find((x) => x.name === b.name);
    if (!a) { console.log('  !! 缺少界面态 ' + b.name); diffs++; continue; }
    if (a.els.length !== b.els.length) { console.log('  !! [' + b.name + '] 元素数 ' + b.els.length + ' -> ' + a.els.length); diffs++; }
    const map = new Map(a.els.map((e) => [e.k, e.s]));
    for (const be of b.els) {
      const as = map.get(be.k);
      if (!as) { diffs++; if (shown.length < 25) shown.push('[' + b.name + '] 少了 ' + be.k.slice(0, 80)); continue; }
      for (const pr in be.s) { checked++; if (as[pr] !== be.s[pr]) { diffs++; if (shown.length < 30) shown.push('[' + b.name + '] ' + be.k.slice(-70) + '  ' + pr + ': ' + be.s[pr] + ' -> ' + as[pr]); } }
      for (const pr in as) if (!(pr in be.s)) { diffs++; if (shown.length < 30) shown.push('[' + b.name + '] ' + be.k.slice(0, 55) + '  多出 ' + pr + '=' + as[pr]); }
    }
  }
  console.log('');
  console.log('比对: ' + checked + ' 个(元素,属性)对, 差异 ' + diffs + ' 处');
  shown.forEach((s) => console.log('  ' + s));
  if (!diffs) console.log('等价性成立: 全部计算样式逐字段一致');
  process.exit(diffs ? 1 : 0);
}
