// verify-functional.mjs —— 功能级回归: 书架 -> 阅读器 -> 章节 -> 图片真的解码
//
// 只跑 verify.mjs boot 是不够的: 空库时它只报"卡片数 0", 阅读器整条链路都没被碰过。
//
//   node _scripts\jm\verify\verify-functional.mjs     退出码 0 = 全过
// 前置: 书库里要有书。空库时先跑 node _scripts\jm\probe\make-fixture.mjs

import { startApp, waitBooted } from '../appctl.mjs';

const R = [];
const chk = (name, ok, detail) => { R.push({ name, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); };

const app = await startApp(9750);
const { p } = app;
try {
  chk('核心启动 (mlBooted)', await waitBooted(p));

  const shelf = JSON.parse(String(await p.ev('JSON.stringify({cards: document.querySelectorAll("#grid > *").length, stat: (document.getElementById("shelfstat")||{}).textContent||""})', 2) || '{}'));
  chk('书架有书', shelf.cards > 0, 'cards=' + shelf.cards + ' ' + (shelf.stat || ''));

  if (shelf.cards > 0) {
    await p.ev('(function(){var c=document.querySelector("#grid > *"); if(c) c.click(); return !!c;})()', 2);
    await new Promise((r) => setTimeout(r, 2800));
    const rd = JSON.parse(String(await p.ev('JSON.stringify({ vis: !document.getElementById("reader").classList.contains("hide"), chname: (document.getElementById("chname")||{}).textContent||"", pageinfo: (document.getElementById("pageinfo")||{}).textContent||"", chapters: document.querySelectorAll("#chapters > *").length, imgs: document.querySelectorAll("#stage img").length })', 2) || '{}'));
    chk('进入阅读器', !!rd.vis);
    chk('章节列表', rd.chapters > 0, 'chapters=' + rd.chapters);
    chk('渲染页面元素', rd.imgs > 0, 'imgs=' + rd.imgs);
    const im = JSON.parse(String(await p.ev('(function(){var im=document.querySelector("#stage img"); if(!im) return "{}"; return JSON.stringify({complete: im.complete, nw: im.naturalWidth});})()', 2) || '{}'));
    chk('图片真的解码', im.nw > 0, 'naturalWidth=' + im.nw);
  } else {
    console.log('  (书库为空, 跳过阅读器检查 —— 先跑 make-fixture.mjs)');
  }

  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  const errs = (p.events || []).filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
  chk('零未捕获异常', exs.length === 0, exs.length ? String(exs.length) + ' 个' : '');
  chk('零控制台错误', errs.length === 0, errs.length ? String(errs.length) + ' 个' : '');
  exs.slice(0, 3).forEach((e) => { try { console.log('     ' + String(e.params.exceptionDetails.exception.description).slice(0, 200)); } catch (x) {} });
  errs.slice(0, 3).forEach((e) => { try { console.log('     ' + (e.params.args || []).map((a) => a.value || a.description).join(' ').slice(0, 200)); } catch (x) {} });
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ name: 'exception', ok: false });
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
