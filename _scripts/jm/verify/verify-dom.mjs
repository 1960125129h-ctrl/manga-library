// verify-dom.mjs —— 界面结构验收: id 撞车检测
//
// "属性栏位置错误"那类问题的根因是**新组件复用了已存在的 id**:
// 浏览器不报错, 但 getElementById/querySelector 只会拿到先出现的那个,
// 于是新组件的样式和事件全作用到旧元素上。工程记录里中过(三处按钮栏都用 id="mfoot")。
//
// 这个工具把主要界面挨个打开扫一遍, 发现重复 id 就报出来。
//
//   node _scripts\jm\verify\verify-dom.mjs     退出码 0 = 全过

import { startApp, waitBooted } from '../appctl.mjs';

// 自足的扫描: 不依赖应用暴露任何东西
const SCAN = '(function(){var m={},e=document.querySelectorAll("[id]");for(var i=0;i<e.length;i++){var k=e[i].id;if(!k)continue;(m[k]=m[k]||[]).push(e[i].tagName.toLowerCase());}var d=[];for(var k2 in m){if(m[k2].length>1)d.push({id:k2,n:m[k2].length,els:m[k2].slice(0,3).join("/")});}return JSON.stringify(d);})()';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };

const app = await startApp(9820);
const { p } = app;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scan(label) {
  const dups = JSON.parse(String(await p.ev(SCAN, 2) || '[]'));
  if (dups.length) {
    console.log('     ' + label + ' 发现 ' + dups.length + ' 个重复 id:');
    dups.slice(0, 6).forEach((d) => console.log('       "' + d.id + '" ×' + d.n + '  (' + d.els + ')'));
  }
  return dups;
}

try {
  chk('界面核心已启动', await waitBooted(p));
  await sleep(1500);

  const surfaces = [
    { name: '书架', open: null },
    { name: '下载弹窗', open: 'btn-download', close: 'ctrl:modal' },
    { name: '设置面板', open: 'btn-settings', close: 'ctrl:modal' },
    { name: '阅读历史', open: 'btn-history', close: null }
  ];

  let totalDups = 0;
  for (const s of surfaces) {
    if (s.open) {
      const clicked = await p.ev('(function(){var b=document.getElementById(' + JSON.stringify(s.open) + '); if(b){b.click();return true;} return false;})()', 2);
      if (!clicked) { console.log('  SKIP  ' + s.name + '（界面上没有 #' + s.open + '）'); continue; }
      await sleep(2200);
    }
    const dups = await scan(s.name);
    totalDups += dups.length;
    chk(s.name + ' 无重复 id', dups.length === 0, dups.length ? dups.map((d) => d.id).slice(0, 4).join(', ') : '');
    // 关掉(避免影响下一屏): 发 Esc
    if (s.close) { await p.ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))', 2); await sleep(900); }
  }

  // 回归守卫: 历史页的标题栏不能和书架共用 id。
  // 它们曾经都是 id="shelfbar", 结果"标题栏已有应用名, 藏掉书架栏 h1"这条规则
  // 把历史页的"阅读历史"也一起藏了(而按 id 取只会命中第一个, 单看代码发现不了)。
  const histH1 = String(await p.ev('(function(){var h=document.querySelector("#histbar > h1"); if(!h) return "NOEL"; return getComputedStyle(h).display;})()', 2));
  chk('历史页标题可见(没被书架的规则误伤)', histH1 !== 'none' && histH1 !== 'NOEL', 'display=' + histH1);
  const shelfH1 = String(await p.ev('(function(){var h=document.querySelector("#shelfbar > h1"); if(!h) return "NOEL"; return getComputedStyle(h).display;})()', 2));
  chk('书架栏标题仍隐藏(与窗口标题栏不重复)', shelfH1 === 'none', 'display=' + shelfH1);

  // 应用自带的巡检有没有也发现(它走 console.warn)
  const warns = (p.events || []).filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'warning')
    .map((e) => { try { return (e.params.args || []).map((a) => a.value || '').join(' '); } catch (x) { return ''; } })
    .filter((s) => s.indexOf('id 撞车') >= 0);
  chk('应用自带巡检也一致', warns.length === (totalDups > 0 ? warns.length : 0), warns.length ? warns[0].slice(0, 140) : '无告警');
  chk('总计零重复 id', totalDups === 0, totalDups ? String(totalDups) + ' 个' : '');

  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  chk('渲染进程零未捕获异常', exs.length === 0, exs.length ? String(exs.length) + ' 个' : '');
  exs.slice(0, 4).forEach((e) => {
    try {
      const d = e.params.exceptionDetails;
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '';
      console.log('     ' + String(desc).split('\n').slice(0, 3).join(' | ').slice(0, 240));
    } catch (x) {}
  });
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
