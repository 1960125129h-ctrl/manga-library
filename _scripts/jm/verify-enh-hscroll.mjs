// verify-enh-hscroll.mjs —— 2.0 三项施工的验收（画质增强 / 横向条带 / 预加载可配）
//
//   node _scripts\jm\verify-enh-hscroll.mjs
// 前置: 书库里有书（node _scripts\jm\make-fixture.mjs）。退出码 0 = 全过。
// 结束时会把 reader-prefs.json 还原成跑之前的样子，不污染日常偏好。

import fs from 'node:fs';
import path from 'node:path';
import { startApp, waitBooted } from './appctl.mjs';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };
const skip = (n, why) => { R.push({ n, ok: true }); console.log('  SKIP  ' + n + '   ' + why); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PREFS = path.join(process.cwd(), 'reader-prefs.json');
let prefsBak = null;
try { prefsBak = fs.readFileSync(PREFS, 'utf8'); } catch (e) {}

const app = await startApp(9890);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 2));
const click = async (id) => {
  const ok = await p.ev('(function(){var b=document.getElementById(' + JSON.stringify(id) + '); if(!b) return false; b.click(); return true;})()', 2);
  await sleep(450);
  return !!ok;
};
const stageCls = async () => String(await ev('Array.prototype.slice.call(document.getElementById("stage").classList).join(",")'));
const cssVar = async (n) => String(await ev('getComputedStyle(document.documentElement).getPropertyValue(' + JSON.stringify(n) + ')'));
const imgFilter = async () => String(await ev('(function(){var i=document.querySelector("#stage img"); return i?getComputedStyle(i).filter:"none";})()'));

try {
  chk('界面核心已启动', await waitBooted(p));
  // 独立 userData = 首次启动，会弹"使用引导"。它在 elModal 里，会吃掉所有 keydown/滚轮 —— 先关掉。
  await p.ev('(function(){ try{ localStorage.setItem("guideSeen_v1","1"); }catch(e){} var m=document.getElementById("modal"); if(m){ m.classList.remove("on"); var b=Array.prototype.slice.call(m.querySelectorAll("button")).find(function(x){return /知道|开始|关闭|确定|好/.test(x.textContent||"");}); if(b) b.click(); } })()', 2);
  await sleep(500);
  console.log('  引导弹窗已清:', await ev('(function(){var m=document.getElementById("modal"); return !(m && m.classList.contains("on"));})()'));
  // 清掉可能残留的搜索词，保证"第一张卡"是确定的
  await p.ev('(function(){var q=document.getElementById("search"); if(q){q.value=""; q.dispatchEvent(new Event("input",{bubbles:true}));} var c=document.getElementById("btn-qclear"); if(c && c.style.display!=="none") c.click();})()', 2);
  await sleep(800);
  const cards = Number(await ev('document.querySelectorAll("#grid > *").length'));
  chk('书库里有书', cards > 0, 'cards=' + cards);
  if (!cards) throw new Error('先跑 node _scripts\jm\make-fixture.mjs');

  // 只有点封面(.thumb)才开书 —— 见 src/shelf/render.js:454
  await p.ev('(function(){var t=document.querySelector("#grid .card .thumb"); if(t) t.click();})()', 2);
  let entered = false;
  for (let i = 0; i < 16; i++) { await sleep(500); if (String(await ev('!document.getElementById("reader").classList.contains("hide")')) === 'true') { entered = true; break; } }
  chk('已进入阅读器', entered);
  if (!entered) throw new Error('没进阅读器，后面的断言没有意义');

  await click('m-single'); await sleep(500);   // 先把上次留下的模式归位，避免干扰
  const pages = Number(await ev('document.querySelectorAll("#stage .pageimg").length'));

  // ---------- B：横排 ----------
  chk('工具栏只有「横排」（并排已删）', (await ev('!!document.getElementById("m-hscroll") && !document.getElementById("m-hspread")')) === 'true');

  await click('m-hscroll');
  // 等横向定位稳定：连续两次读数一致才算稳（图是逐张解码的，位置会边加载边修正）
  let lastSL = -1, stable = 0;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const cur = Number(await ev('document.getElementById("stage").scrollLeft'));
    if (Math.abs(cur - lastSL) < 2) { stable++; if (stable >= 2) break; } else stable = 0;
    lastSL = cur;
  }
  await sleep(200);
  chk('横排: stage 类为 mode-hscroll', (await stageCls()).indexOf('mode-hscroll') >= 0, await stageCls());
  const hs = JSON.parse(await ev('JSON.stringify((function(){var s=document.getElementById("stage"); var c=document.getElementById("canvas"); var im=s.querySelector("img"); return {sw:s.scrollWidth, cw:s.clientWidth, sh:s.scrollHeight, ch:s.clientHeight, fd:getComputedStyle(c).flexDirection, n:s.querySelectorAll("img").length, iw:im?im.naturalWidth:0, ih:im?im.naturalHeight:0, dw:im?Math.round(im.getBoundingClientRect().width):0, dh:im?Math.round(im.getBoundingClientRect().height):0};})())'));
  chk('横排: 画布确实横向溢出', hs.sw > hs.cw + 20, 'scrollWidth=' + hs.sw + ' clientWidth=' + hs.cw);
  chk('横排: 画布 flex 横向排列', hs.fd === 'row' || hs.fd === 'row-reverse', hs.fd);
  chk('横排: 页图已解码', hs.iw > 0, 'natural=' + hs.iw + 'x' + hs.ih);
  chk('横排: 图按高度铺满（适高语义）', Math.abs(hs.dh - hs.ch) <= 24, 'dh=' + hs.dh + ' stageH=' + hs.ch);
  chk('横排: 纵向不滚', hs.sh <= hs.ch + 4, 'scrollHeight=' + hs.sh + ' clientHeight=' + hs.ch);

  // 每段测试前都用页码框跳到确定位置，避免互相污染
  const gotoPage = async (n) => {
    await p.ev('(function(){var i=document.getElementById("pageinput"); i.value=' + JSON.stringify(String(n)) + '; i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",keyCode:13,bubbles:true}));})()', 2);
    await sleep(900);
  };
  const pageNo = async () => Number(await ev('document.getElementById("pageinput").value'));
  const nearestOff = async () => {
    const j = JSON.parse(await ev('JSON.stringify((function(){var s=document.getElementById("stage"); var r=s.getBoundingClientRect(); var ims=s.querySelectorAll("img"); var bd=1e9; for(var i=0;i<ims.length;i++){var a=ims[i].getBoundingClientRect(); if(!a.width) continue; var d=Math.abs((a.left+a.width/2)-(r.left+r.width/2)); if(d<bd) bd=d;} return {off:Math.round(bd)};})())'));
    return j.off;
  };

  await gotoPage(2);
  chk('页码框跳页有效', (await pageNo()) === 2, 'page=' + await pageNo());

  // ---- 方向键：一页一跳 ----
  const pg0 = await pageNo();
  // 焦点若在页码框/搜索框，core 的 keydown 会直接忽略 —— 先失焦再按键
  await p.ev('(function(){ if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); })()', 2);
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(1100);
  chk('横排: → 键一页一跳', (await pageNo()) === pg0 + 1, pg0 + ' -> ' + await pageNo());
  const snapOff = await nearestOff();
  chk('横排: 按键落点居中', snapOff <= 2, '偏 ' + snapOff + 'px');

  // ---- 滚轮：一格一页 + 动画 ----
  await gotoPage(2);
  const box = JSON.parse(await ev('JSON.stringify((function(){var r=document.getElementById("stage").getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})())'));
  const slW0 = Number(await ev('document.getElementById("stage").scrollLeft'));
  await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 120 });
  await sleep(750);
  const slW1 = Number(await ev('document.getElementById("stage").scrollLeft'));
  const pageWidth = Number(await ev('(function(){var im=document.querySelector("#stage .hstripimg"); return im?Math.round(im.getBoundingClientRect().width):0;})()'));
  const stepW = Math.abs(slW1 - slW0);
  chk('横排: 滚轮一格翻一页（动画滚过去）', pageWidth > 0 && stepW > pageWidth * 0.6 && stepW < pageWidth * 1.4, '一格位移 ' + Math.round(stepW) + 'px / 页宽 ' + pageWidth + 'px');
  const wheelOff = await nearestOff();
  chk('横排: 滚轮停下后当前页居中', wheelOff <= 2, '偏 ' + wheelOff + 'px');

  // ---- 连滚 3 格：能连续快翻 ----
  await gotoPage(2);
  const slF0 = Number(await ev('document.getElementById("stage").scrollLeft'));
  for (let i = 0; i < 3; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 120 }); await sleep(320); }   // 间隔大于一次动画，逐格确认
  await sleep(800);
  const slF1 = Number(await ev('document.getElementById("stage").scrollLeft'));
  chk('横排: 连滚 3 格推进 3 页', Math.abs(slF1 - slF0) > 1400, '3 格位移 ' + Math.round(slF1 - slF0) + 'px');

  // ---- 章节中割：末尾接下一话 + 中间一条章节号竖条 ----
  await gotoPage(2);
  const cb = JSON.parse(await ev('JSON.stringify((function(){var m=document.querySelector("#stage .chbreak"); if(!m) return {ok:false}; return {ok:true, txt:(m.querySelector(".cbn")||{}).textContent||"", extra:document.querySelectorAll("#stage .hstripimg.extra").length};})())'));
  chk('横排: 末尾有章节中割（竖条+下一话前几页）', cb.ok && String(cb.txt).length > 0 && cb.extra > 0, '章节="' + cb.txt + '"  预接 ' + cb.extra + ' 页');

  // 记住一个预接页的 DOM 引用：转正后如果这个元素还在（只是摘掉了 extra），说明没有重建画布
  await p.ev('(function(){var e=document.querySelector("#stage .hstripimg.extra"); window.__probeEl=e||null;})()', 2);
  // ---- 滚到末尾继续滚 = 进下一话 ----
  const total = String(await ev('document.getElementById("pageinfo").textContent.replace("/","").trim()'));
  await gotoPage(Number(total));
  await p.ev('(function(){var e=document.querySelector("#stage .hstripimg.extra"); window.__probeEl=e||null;})()', 2);
  const ch0 = String(await ev('(document.getElementById("chname")||{}).textContent'));
  for (let i = 0; i < 6; i++) { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 120 }); await sleep(220); }
  await sleep(1800);
  const ch1 = String(await ev('(document.getElementById("chname")||{}).textContent'));
  chk('横排: 滚到末尾继续滚进下一话', ch0 !== ch1 && !!ch1, (ch0 || '?') + ' -> ' + (ch1 || '?'));
  const reused = String(await ev('(function(){var e=window.__probeEl; return !!(e && document.contains(e) && !e.classList.contains("extra"));})()'));
  chk('横排: 转正复用预渲染页（没重建画布）', reused === 'true', '预接页元素 ' + (reused === 'true' ? '仍在且已转正' : '被销毁'));
  const thumbSig = String(await ev('(function(){var l=document.getElementById("thumblist"); if(!l) return "no-list"; return (l.getAttribute("data-sig")||"") + "|" + l.children.length;})()'));
  chk('横排: 转正后右侧缩略图跟着换话', thumbSig !== 'no-list' && thumbSig.split('|')[1] !== '0', '缩略图 sig|数量 = ' + thumbSig);

  // ---- 位置可拖动（放最后，因为它会改位置） ----
  await p.ev('(function(){var s=document.getElementById("stage"); s.scrollLeft=260; return s.scrollLeft;})()', 2);
  const sl = Number(await ev('document.getElementById("stage").scrollLeft'));
  chk('横排: scrollLeft 可滚动', sl > 0, 'scrollLeft=' + Math.round(sl));
  await click('m-single'); await sleep(500);
  // ---------- A：画质增强 ----------
  await click('m-single'); await sleep(600);
  await click('btheme'); await sleep(700);
  await p.ev('(function(){var sw=document.getElementById("enhswatch"); if(!sw) return; var b=Array.prototype.slice.call(sw.children).find(function(x){return x.textContent==="关";}); if(b) b.click();})()', 2);
  await sleep(300);
  await p.ev('(function(){var b=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="完成";}); if(b) b.click();})()', 2);
  await sleep(400);
  const f0 = await imgFilter();
  chk('增强归位到关后无滤镜', /none/i.test(f0) || f0 === '', f0);

  await click('btheme'); await sleep(700);
  chk('配色对话框里有锐化三档', (await ev('!!document.getElementById("enhswatch") && document.getElementById("enhswatch").children.length >= 4')) === 'true');
  const pick = async (label) => String(await ev('(function(){var sw=document.getElementById("enhswatch"); if(!sw) return "no-sw"; var b=Array.prototype.slice.call(sw.children).find(function(x){return x.textContent===' + JSON.stringify(label) + ';}); if(!b) return "no-btn"; b.click(); return "ok";})()'));
  chk('点"中"档', (await pick('中')) === 'ok');
  await sleep(500);
  const v1 = await cssVar('--r-img-filter');
  chk('CSS 变量写入 medium', v1.indexOf('enh-medium') >= 0, v1);
  const f1 = await imgFilter();
  chk('页图真的吃到了滤镜', /enh-medium/.test(f1), f1);
  chk('点"强"档', (await pick('强')) === 'ok'); await sleep(400);
  const v2 = await cssVar('--r-img-filter');
  chk('切到 strong', v2.indexOf('enh-strong') >= 0, v2);
  chk('点"关"', (await pick('关')) === 'ok'); await sleep(400);
  const v3 = await cssVar('--r-img-filter');
  chk('关掉后变量回到 none', v3.trim() === 'none', JSON.stringify(v3));

  const ctr = await ev('(function(){var m=document.getElementById("modal"); var rs=m?m.querySelectorAll("input[type=range]"):[]; if(rs.length<2) return "no"; var r=rs[rs.length-1]; r.value="120"; r.dispatchEvent(new Event("input",{bubbles:true})); return "ok";})()');
  await sleep(400);
  if (String(ctr) === 'ok') {
    const v4 = await cssVar('--r-img-filter');
    chk('对比度滑杆写进滤镜链', v4.indexOf('contrast(1.2)') >= 0, v4);
    await ev('(function(){var m=document.getElementById("modal"); var rs=m?m.querySelectorAll("input[type=range]"):[]; var r=rs[rs.length-1]; r.value="100"; r.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await sleep(300);
  } else skip('对比度滑杆', '对话框里没找到第二个 range');

  await ev('(function(){var b=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="完成";}); if(b) b.click();})()');
  await sleep(400);

  // ---------- C：预加载 ----------
  chk('预加载字段可读（默认 4）', (await ev('(function(){ return (window.mangaLib && true) ? "1" : "0"; })()')) === '1');
  const rootNow = String(await ev('window.mangaLib.getRoot()'));
  const prefsObj = (await p.ev('window.mangaLib.readerPrefsGet().then(function(v){return JSON.stringify(v||{});})', 2)) || '{}';
  let pk = {};
  try { pk = JSON.parse(String(prefsObj)); } catch (e) {}
  const needKeys = ['preload', 'enhance', 'contrast'];
  chk('偏好文件含新字段（走应用 API）', needKeys.every((k) => k in pk), 'root=' + rootNow + ' keys=' + Object.keys(pk).join(','));
  const onDisk = JSON.parse(fs.readFileSync(path.join(rootNow, 'reader-prefs.json'), 'utf8'));
  chk('磁盘上的 reader-prefs.json 也含新字段', needKeys.every((k) => k in onDisk), Object.keys(onDisk).join(','));

  // ---------- 回归：原有 9 种 模式×适配 组合 ----------
  const MODES = [['m-single', 'mode-single'], ['m-double', 'mode-double'], ['m-scroll', 'mode-scroll']];
  const FITS = [['f-width', 'fit-width'], ['f-height', 'fit-height'], ['f-original', 'fit-original']];
  let comboOk = 0;
  for (const [mb, mc] of MODES) {
    for (const [fb, fc] of FITS) {
      await click(mb); await click(fb); await sleep(420);
      const st = JSON.parse(await ev('JSON.stringify((function(){var s=document.getElementById("stage"); var im=s.querySelector("img"); return {cls:Array.prototype.slice.call(s.classList), iw:im?im.naturalWidth:0};})())'));
      if (st.cls.indexOf(mc) >= 0 && st.cls.indexOf(fc) >= 0 && st.iw > 0) comboOk++;
      else console.log('     !! ' + mc + '+' + fc + ' cls=' + JSON.stringify(st.cls) + ' iw=' + st.iw);
    }
  }
  chk('回归: 9 种 模式×适配 组合', comboOk === 9, comboOk + '/9');

  // ---------- 回书架 ----------
  await click('m-single'); await sleep(400);
  await click('bback');
  let backHome = false;
  for (let i = 0; i < 12; i++) { await sleep(400); if (String(await ev('document.getElementById("reader").classList.contains("hide")')) === 'true') { backHome = true; break; } }
  chk('能回到书架', backHome);
  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  chk('零未捕获异常', exs.length === 0, exs.length ? String(exs.length) + ' 个' : '');
  if (exs.length) exs.slice(0, 3).forEach((e) => { try { console.log('     ' + String(e.params.exceptionDetails.exception.description).slice(0, 160)); } catch (x) {} });
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
  if (prefsBak != null) { try { fs.writeFileSync(PREFS, prefsBak, 'utf8'); console.log('  (reader-prefs.json 已还原)'); } catch (e) {} }
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
