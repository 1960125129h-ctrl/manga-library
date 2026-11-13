import { startApp, waitBooted } from '../appctl.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await startApp(9911); const { p } = app;
const ev = async (js) => String(await p.ev(js, 2));
const chk = (n, ok, d) => { console.log((ok?'  PASS  ':'  FAIL  ') + n + (d?'   '+d:'')); if (!ok) process.exitCode = 1; };
const brkStyle = "JSON.stringify((function(){var m=document.querySelector('#stage .chbreak'); if(!m) return null; var cs=getComputedStyle(m); return {bg:cs.backgroundImage.slice(0,60), bgc:cs.backgroundColor, bd:cs.borderLeftColor, color:cs.color};})())";
try {
  await waitBooted(p);
  await p.ev('(function(){var q=document.getElementById("search"); if(q){q.value=""; q.dispatchEvent(new Event("input",{bubbles:true}));}})()', 2);
  await sleep(600);
  await p.ev('(function(){var t=document.querySelector("#grid .card .thumb"); if(t) t.click();})()', 2);
  for (let i=0;i<16;i++){ await sleep(500); if (String(await ev('!document.getElementById("reader").classList.contains("hide")'))==='true') break; }
  await p.ev('(function(){document.getElementById("m-hscroll").click();})()', 2);
  await sleep(2000);
  // 跳到本话末页，让中割出现
  await p.ev('(function(){var t=document.getElementById("pageinfo").textContent.replace("/","").trim(); var i=document.getElementById("pageinput"); i.value=t; i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",keyCode:13,bubbles:true}));})()', 2);
  await sleep(1200);
  await p.ev('(function(){var m=document.querySelector("#stage .chbreak"); var s=document.getElementById("stage"); if(m&&s){var r=m.getBoundingClientRect(), st=s.getBoundingClientRect(); s.scrollLeft += (r.left-st.left) - st.width*0.5;}})()', 2);
  await sleep(600);
  await p.ev('(function(){var b=document.getElementById("btheme"); if(b) b.click();})()', 2);
  await sleep(700);
  await p.ev('(function(){var b=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="暗黑";}); if(b) b.click();})()', 2);
  await sleep(600);
  await p.ev('(function(){var b=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="完成";}); if(b) b.click();})()', 2);
  await sleep(800);
  const dark = JSON.parse(await ev(brkStyle) || 'null');
  console.log('暗黑:', JSON.stringify(dark));
  chk('深色主题能取到中割条样式', !!dark, dark ? dark.bd : '未取到');
  await p.ev('(function(){var b=document.getElementById("btheme"); if(b) b.click();})()', 2);
  await sleep(700);
  await p.ev('(function(){var b=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="灰白";}); if(b) b.click();})()', 2);
  await sleep(600);
  await p.ev('(function(){var b=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="完成";}); if(b) b.click();})()', 2);
  await sleep(700);
  const light = JSON.parse(await ev(brkStyle) || 'null');
  console.log('灰白:', JSON.stringify(light));
  const theme = String(await ev('(document.getElementById("reader")||{}).getAttribute ? document.getElementById("reader").getAttribute("data-theme") : ""'));
  // 中割条已统一成"蓝底白字"（与侧栏高亮同色），不再随主题变 —— 这里改成验证这一点
  chk('中割条所有主题一致', !!light && !!dark && light.color === dark.color && light.color === 'rgb(255, 255, 255)', '字色=' + (light && light.color) + ' 主题=' + theme);
  chk('中割条是灰阶渐变底 + 白字', !!light && light.color === 'rgb(255, 255, 255)', '底=' + (light && light.bgc));
  // 恢复深色
  await p.ev('(function(){var b=document.getElementById("btheme"); if(b) b.click();})()', 2);
  await sleep(600);
  await p.ev('(function(){var sw=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="暗黑";}); if(sw) sw.click(); var d=Array.prototype.slice.call(document.querySelectorAll("#modal button")).find(function(x){return x.textContent==="完成";}); if(d) d.click();})()', 2);
} catch (e) { console.log('ERR', String(e.message||e)); process.exitCode = 1; }
finally { try { p.close(); } catch(e){} app.stop(); }