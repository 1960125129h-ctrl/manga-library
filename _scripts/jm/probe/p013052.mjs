const fs = await import('node:fs');
const PORT = parseInt(fs.readFileSync('<书库根>/_scripts/jm/.port', 'utf8').trim(), 10);
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
const snap = async () => String(await ev('(function(){function g(i){var e=document.getElementById(i);if(!e)return i+":无";return i+":["+(e.offsetParent!==null?"显":"隐")+"]"+String(e.innerText||"").replace(/[\\r\\n]+/g," ").slice(0,90);}var bar=document.getElementById("dlbar");return [g("dlinfo"),g("dlsteps"),g("dlbar"),(bar?"条宽="+String(bar.style.width||"?"):"")].join(" || ");})()'));
// 用 21 页的小画廊, 从"通用链接"直接下(不经过待挑列表, 排除干扰)
const U = 'https://e-hentai.org/g/4198373/35016f9e17/';
await ev('(function(){location.reload();return 1;})()');
await sleep(3500);
await ev('(function(){document.getElementById("btn-download").click();return 1;})()');
await sleep(1000);
await ev('(function(){var i=document.getElementById("dl-url");if(i){i.value="' + U + '";i.dispatchEvent(new Event("input",{bubbles:true}));}return 1;})()');
await sleep(300);
console.log('开始前: ' + await snap());
await ev('(function(){var bs=document.querySelectorAll("#dlpane .btn,#dlpane button");for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()==="开始下载"){bs[i].click();return 1;}}return 0;})()');
for (const s of [6, 12, 20, 30, 45]) {
  await sleep(s * 1000 - (s === 6 ? 0 : 0));
  console.log(s + 's: ' + await snap());
}
ws.close();
