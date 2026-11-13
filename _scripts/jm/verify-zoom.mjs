import { startApp, waitBooted } from './appctl.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await startApp(9910); const { p } = app;
const ev = async (js) => String(await p.ev(js, 2));
const chk = (n, ok, d) => { console.log((ok?'  PASS  ':'  FAIL  ') + n + (d?'   '+d:'')); if (!ok) process.exitCode = 1; };
const shownExpr = "JSON.stringify((function(){var im=document.querySelector('#stage img.pageimg'); if(!im) return null; var b=im.getBoundingClientRect(); var nw=im.naturalWidth, nh=im.naturalHeight; var sc=Math.min(b.width/nw, b.height/nh); return {rect:Math.round(b.width), shown:Math.round(nw*sc), nw:nw, styleW:im.style.width||''};})())";
try {
  await waitBooted(p);
  await p.ev('(function(){var q=document.getElementById("search"); if(q){q.value=""; q.dispatchEvent(new Event("input",{bubbles:true}));}})()', 2);
  await sleep(600);
  await p.ev('(function(){var t=document.querySelector("#grid .card .thumb"); if(t) t.click();})()', 2);
  for (let i=0;i<16;i++){ await sleep(500); if (String(await ev('!document.getElementById("reader").classList.contains("hide")'))==='true') break; }
  await p.ev('(function(){document.getElementById("m-single").click();})()', 2);
  await sleep(500);
  await p.ev('(function(){document.getElementById("f-page").click();})()', 2);
  await sleep(900);
  const before = JSON.parse(await ev(shownExpr));
  console.log('整页模式 之前:', JSON.stringify(before));
  chk('整页模式: 图片显示宽 < 容器宽（确实是缩放显示）', before.shown > 0 && before.shown < before.rect, 'shown=' + before.shown + ' rect=' + before.rect);
  const box = JSON.parse(await ev('JSON.stringify((function(){var r=document.getElementById("stage").getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})())'));
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'right', buttons: 2, clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -120, buttons: 2 });
  await sleep(500);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(700);
  const after = JSON.parse(await ev(shownExpr));
  console.log('整页模式 之后:', JSON.stringify(after));
  const ratio = after.shown / before.shown;
  chk('整页模式: 放大一次 ≈ 110%（不是跳到原图大小）', ratio > 1.02 && ratio < 1.25, before.shown + ' → ' + after.shown + '  (' + Math.round(ratio*100) + '%)');
  await p.ev('(function(){document.getElementById("bzoomreset").click();})()', 2);
  await sleep(600);
  const reset = JSON.parse(await ev(shownExpr));
  chk('重置后回到原来的显示大小', Math.abs(reset.shown - before.shown) <= 3, reset.shown + ' vs ' + before.shown);

  // 回归：适高模式本来就正常，改完不能反而坏掉
  await p.ev('(function(){document.getElementById("f-height").click();})()', 2);
  await sleep(900);
  const h0 = JSON.parse(await ev(shownExpr));
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'right', buttons: 2, clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -120, buttons: 2 });
  await sleep(500);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(700);
  const h1 = JSON.parse(await ev(shownExpr));
  const hRatio = h1.shown / h0.shown;
  chk('适高模式: 放大一次仍是 110%（回归）', hRatio > 1.02 && hRatio < 1.25, h0.shown + ' → ' + h1.shown + '  (' + Math.round(hRatio*100) + '%)');
  await p.ev('(function(){document.getElementById("bzoomreset").click();})()', 2);
  await sleep(400);
} catch (e) { console.log('ERR', String(e.message||e)); process.exitCode = 1; }
finally { try { p.close(); } catch(e){} app.stop(); }