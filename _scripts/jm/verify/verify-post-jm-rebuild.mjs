import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..', '..');
const sleep = ms => new Promise(res => setTimeout(res, ms));
const runNode = args => spawnSync(process.execPath, args, { cwd: LIB, stdio: 'ignore' });

function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}
function cdp(ws, onEvent) {
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method && onEvent) onEvent(msg);
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.exceptionDetails) item.reject(new Error(JSON.stringify(msg.exceptionDetails)));
      else item.resolve(msg.result);
    }
  };
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression, contextId = 0) {
      const params = { expression, awaitPromise: true };
      if (contextId) params.contextId = contextId;
      const r = await this.send('Runtime.evaluate', params);
      return r.result.value;
    }
  };
}
async function findPage() {
  const list = await (await fetch('http://127.0.0.1:9546/json/list')).json();
  return list.find(x => x.type === 'page' && decodeURIComponent(x.url).includes('漫画书库重构v0') && x.url.includes('index.html'));
}

let state = null;
let reloaded = false;
try {
  runNode([path.join(LIB, '_scripts/jm/probe/make-fixture.mjs')]);
  await sleep(3000);
  let page = await findPage();
  if (!page) throw new Error('no app page');
  let ws = await connect(page);
  let navAfterStart = false;
  let client = cdp(ws, msg => {
    if (msg.method === 'Page.frameNavigated' && msg.params.frame && !msg.params.frame.parentId) navAfterStart = true;
  });
  await client.send('Page.enable');
  await client.evaluate(`window.__postJmStart = window.mangaLib.jmStart('__invalid_target__', 'chrome')`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (navAfterStart) {
      reloaded = true;
      break;
    }
  }
  ws.close();
  await sleep(1000);

  page = await findPage();
  if (!page) throw new Error('no reloaded app page');
  ws = await connect(page);
  const contexts = [];
  client = cdp(ws, msg => {
    if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
  });
  await client.send('Runtime.enable');
  await sleep(500);
  const main = contexts.find(c => c.auxData && c.auxData.isDefault);
  if (!main) throw new Error('default execution context not found');
  state = JSON.parse(await client.evaluate(`JSON.stringify({
    grid: document.getElementById('grid').children.length,
    shelfVisible: !document.getElementById('shelf').classList.contains('hide'),
    readerHidden: document.getElementById('reader').classList.contains('hide')
  })`, main.id));
  ws.close();
} finally {
  runNode([path.join(LIB, '_scripts/jm/probe/make-fixture.mjs'), '--remove']);
}
const result = { reloaded, ...state };
console.log(JSON.stringify(result));
if (!reloaded || !state || state.grid < 3 || !state.shelfVisible || !state.readerHidden) process.exitCode = 1;
