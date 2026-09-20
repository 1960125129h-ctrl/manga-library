// verify-shell.mjs —— 窗口外壳层验收: 标题栏行为 + 桌面化手感
//
// 验的是"行为"不是"外观": 最大化真点了没有、拖动区是不是真设上了、
// 去网页味的规则是不是真生效(读计算样式), 而不是看截图觉得像。
//
//   node _scripts\jm\verify-shell.mjs     退出码 0 = 全过

import { startApp, waitBooted } from './appctl.mjs';

const R = [];
const chk = (name, ok, detail) => { R.push({ name, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); };

const app = await startApp(9700);
const { p } = app;
try {
  chk('界面核心已启动', await waitBooted(p));
  await new Promise((r) => setTimeout(r, 800));

  await p.ev('window.__cs=function(s,pr){var e=document.querySelector(s);if(!e)return "NOEL";var v=getComputedStyle(e)[pr];return v==null?"NULL":String(v);};', 2);
  const cs = async (sel, prop) => String(await p.ev('window.__cs(' + JSON.stringify(sel) + ',' + JSON.stringify(prop) + ')', 2));

  // ---------- 标题栏 ----------
  chk('标题栏存在', await p.ev('!!document.getElementById("titlebar")', 2));
  chk('三个窗口控制按钮', (await p.ev('["tb-min","tb-max","tb-close"].filter(function(i){return !!document.getElementById(i);}).length', 2)) === 3);
  chk('菜单按钮存在', await p.ev('!!document.getElementById("tb-menu")', 2));
  chk('标题栏可拖动', (await cs('#titlebar', 'webkitAppRegion')) === 'drag', 'webkitAppRegion=' + (await cs('#titlebar', 'webkitAppRegion')));
  chk('关闭按钮不参与拖动', (await cs('#tb-close', 'webkitAppRegion')) === 'no-drag');
  chk('书架栏 h1 已隐藏(避免与标题栏重复)', (await cs('#shelfbar > h1', 'display')) === 'none');

  // 最大化: 真点按钮 -> 查主进程状态 -> 图标是否切换 -> 再点还原
  const state = async () => String(await p.ev('window.mangaLib.winState().then(function(s){return JSON.stringify(s);})', 2));
  await p.ev('document.getElementById("tb-max").click()', 2);
  await new Promise((r) => setTimeout(r, 1600));
  chk('最大化真的生效', (await state()).indexOf('"maximized":true') >= 0, await state());
  chk('图标切换为"还原"', String(await p.ev('document.getElementById("tb-max").title', 2)).indexOf('还原') >= 0);
  await p.ev('document.getElementById("tb-max").click()', 2);
  await new Promise((r) => setTimeout(r, 1600));
  chk('还原真的生效', (await state()).indexOf('"maximized":false') >= 0);

  // ---------- 桌面化(去网页味) ----------
  chk('body 禁止随手选中文字', (await cs('body', 'userSelect')) === 'none', 'userSelect=' + (await cs('body', 'userSelect')));
  chk('输入框仍可选中', (await cs('#search', 'userSelect')) === 'text');
  chk('整页禁用滚动回弹', (await cs('body', 'overscrollBehavior')) === 'none');
  chk('书架禁用滚动链', (await cs('#grid', 'overscrollBehaviorY')) === 'contain', 'overscrollBehaviorY=' + (await cs('#grid', 'overscrollBehaviorY')));

  await p.ev('(function(){var i=document.createElement("img");i.id="__ti";i.src="data:image/gif;base64,R0lGODlhAQABAAAAACw=";i.style.cssText="position:fixed;left:50%;top:82%;width:4px;height:4px";document.body.appendChild(i);return 1;})()', 2);
  chk('图片不可拖拽', (await cs('#__ti', 'webkitUserDrag')) === 'none', 'webkitUserDrag=' + (await cs('#__ti', 'webkitUserDrag')));

  // 焦点圈: 必须用真鼠标点。程序化 focus() 会被 Chromium 判成 focus-visible(键盘态)。
  await p.ev('(function(){var b=document.createElement("button");b.id="__tb";b.textContent="t";b.style.cssText="position:fixed;left:50%;top:75%;width:40px;height:24px";document.body.appendChild(b);return 1;})()', 2);
  const rc = JSON.parse(String(await p.ev('JSON.stringify((function(){var b=document.getElementById("__tb").getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})())', 2)));
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rc.x, y: rc.y, button: 'left', clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rc.x, y: rc.y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 350));
  chk('鼠标点击不出焦点外圈', (await cs('#__tb', 'outlineStyle')) === 'none', 'outlineStyle=' + (await cs('#__tb', 'outlineStyle')));
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
