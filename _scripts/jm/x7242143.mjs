const fs = await import('node:fs');
const PORT = parseInt(fs.readFileSync('D:/gong zuo qu/漫画书库/_scripts/jm/.port', 'utf8').trim(), 10);
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const t = list.find((x) => x.type === 'page' && /%E4%B9%A6%E5%BA%93\.html/.test(x.url));
if (!t) { console.log('【没有书库页面】'); process.exit(1); }
console.log('【App 活着, 端口 ' + PORT + '】');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const w = new Map();
const send = (m, p) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
ws.onmessage = (e) => { let m; try { m = JSON.parse(String(e.data)); } catch (x) { return; } if (m.id && w.has(m.id)) { const r = w.get(m.id); w.delete(m.id); r(m.result || m.error); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable');
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: c, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; };
const U = 'https://e-hentai.org/g/4198361/3ce404d3df/';
await ev('window.mangaLib.tabsPendingClear()');
await ev('window.mangaLib.tabsPendingAdd({title:"实盘测试",url:"' + U + '",id:"4198361"})');
await ev('(function(){location.reload();return 1;})()');
await sleep(3200);
await ev('(function(){document.getElementById("btn-download").click();return 1;})()');
await sleep(1000);
await ev('(function(){var bs=document.querySelectorAll("#dltabs .tab");for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf("浏览器标签")>=0){bs[i].click();return 1;}}return 0;})()');
for (let i = 0; i < 8; i++) { await sleep(2000); var n = await ev('Array.prototype.filter.call(document.querySelectorAll("button"), function(b){return b.textContent.trim()==="下载整本";}).length'); if (Number(n) > 0) break; }
await ev('(function(){var b=Array.prototype.filter.call(document.querySelectorAll("button"), function(x){return x.textContent.trim()==="下载整本";});var card=b[0].closest("div[style*=padding]")||b[0].parentNode.parentNode.parentNode;card.click();return 1;})()');
await sleep(400);
console.log('点下载选中: ' + String(await ev('(function(){var bs=document.querySelectorAll("#dlpane button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()==="下载选中"){bs[i].click();return "已点";}}return "没找到";})()')));
console.log('四步条(每 5 秒):');
for (let i = 1; i <= 9; i++) {
  await sleep(5000);
  console.log('  ' + i*5 + 's ' + String(await ev('(function(){var e=document.getElementById("dlsteps");var o=[];if(e){for(var i=0;i<e.children.length;i++){var c=e.children[i];o.push(String(c.textContent).slice(0,3)+":"+(c.className||"-"));}}var b2=document.getElementById("dlbar");var f=document.getElementById("dlinfo");return "[" + o.join(" ") + "] 条=" + String(b2?b2.style.width:"?") + " " + String(f?f.innerText:"").replace(/[\\r\\n]+/g," ").slice(0,38);})()')));
}
ws.close();
