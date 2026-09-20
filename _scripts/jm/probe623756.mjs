const fs = await import('node:fs');
const PORT = parseInt(fs.readFileSync('D:/gong zuo qu/漫画书库/_scripts/jm/.port', 'utf8').trim(), 10);
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const t = list.find((x) => x.type === 'page' && /%E4%B9%A6%E5%BA%93\.html/.test(x.url));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const w = new Map();
const send = (m, p) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
ws.onmessage = (e) => { let m; try { m = JSON.parse(String(e.data)); } catch (x) { return; } if (m.id && w.has(m.id)) { const r = w.get(m.id); w.delete(m.id); r(m.result || m.error); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable');
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: c, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; };
// 加一本小画廊(21 页)做测试, 避免 119 页太久
const U = 'https://e-hentai.org/g/4198373/35016f9e17/';
await ev('window.mangaLib.tabsPendingAdd({title:"小画廊测试",url:"' + U + '",id:"4198373"})');
await ev('(function(){location.reload();return 1;})()');
await sleep(3500);
await ev('(function(){document.getElementById("btn-download").click();return 1;})()');
await sleep(600);
await ev('(function(){var bs=document.querySelectorAll("#dltabs .tab");for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf("浏览器标签")>=0){bs[i].click();return 1;}}return 0;})()');
await sleep(4500);
// 找到"小画廊测试"那张卡片并勾上
console.log('勾选小画廊: ' + String(await ev('(function(){var cards=document.querySelectorAll("#dlpane div");var hit=null;for(var i=0;i<cards.length;i++){if((cards[i].innerText||"").indexOf("小画廊测试")>=0 && cards[i].querySelector("button")){hit=cards[i];break;}}if(!hit)return "没找到卡片";hit.click();var pane=document.getElementById("dlpane");var m=(pane.innerText||"").match(/已选 (\\d+) 本/);return m?m[0]:"已点";})()')));
await sleep(400);
// 点"下载整本"(这条路最简单, 排除页级勾选干扰)
console.log('点下载整本: ' + String(await ev('(function(){var cards=document.querySelectorAll("#dlpane div");var hit=null;for(var i=0;i<cards.length;i++){if((cards[i].innerText||"").indexOf("小画廊测试")>=0 && cards[i].querySelector("button")){hit=cards[i];break;}}if(!hit)return "没找到";var bs=hit.querySelectorAll("button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()==="下载整本"){bs[i].click();return "已点下载整本";}}return "卡片里没有下载整本";})()')));
for (const sec of [10, 25, 45, 70]) {
  await sleep(sec * 1000 - (sec === 10 ? 0 : 0));
  const info = await ev('(function(){var pane=document.getElementById("dlpane");var s=(pane?pane.innerText:"").split(String.fromCharCode(10)).filter(function(x){return x.trim();});return s.slice(-4).join(" | ");})()');
  console.log('约 ' + sec + 's: ' + String(info));
}
ws.close();
