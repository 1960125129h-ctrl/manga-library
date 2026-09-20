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
const stepSnap = async () => String(await ev('(function(){var e=document.getElementById("dlsteps");if(!e)return "无步骤条";var out=[];for(var i=0;i<e.children.length;i++){var c=e.children[i];var cn=c.className||"";out.push(String(c.textContent).slice(0,4)+":"+(cn==="now"?"进行中":cn==="ok"?"完成":"待"));}var info=document.getElementById("dlinfo");return out.join("  ") + "   | " + String(info?info.innerText:"").replace(/[\\r\\n]+/g," ").slice(0,50);})()'));
// 用一本没入库的小画廊; 先确认它不在库里
const U = 'https://e-hentai.org/g/4198392/d8ec85e7ff/';
await ev('(function(){location.reload();return 1;})()');
await sleep(3200);
await ev('(function(){document.getElementById("btn-download").click();return 1;})()');
await sleep(900);
await ev('(function(){var i=document.getElementById("dl-url");if(i)i.value="' + U + '";return 1;})()');
await ev('(function(){var bs=document.querySelectorAll("#dlpane button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()==="开始下载"){bs[i].click();return 1;}}return 0;})()');
for (let i = 0; i < 8; i++) {
  await sleep(3000);
  console.log((i+1)*3 + 's: ' + await stepSnap());
}
ws.close();
