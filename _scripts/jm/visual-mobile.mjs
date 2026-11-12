import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireBrowser } from '../lib/browser.mjs';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WORK, '..', '..');
const OUT = path.join(ROOT, '_visual-check');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-mobile-'));
const HTTP_PORT = 9581;
const CDP_PORT = 9591;
const CHROME = requireBrowser('chrome', '手机端截图');
const W = Number(process.env.MOBILE_W || 390);
const H = Number(process.env.MOBILE_H || 844);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let serverProcess;
let chromeProcess;
const errors = [];

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [path.join(WORK, 'serve-mobile.mjs')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(HTTP_PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProcess.stdout.on('data', (d) => { if (String(d).includes('手机端预览')) resolve(); });
    serverProcess.stderr.on('data', (d) => reject(new Error(String(d))));
    setTimeout(resolve, 1000);
  });
}

function connectCDP(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); }
    });
    ws.onerror = () => reject(new Error('CDP websocket error'));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails; errors.push([d.text, d.exception && d.exception.description].filter(Boolean).join(' '));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(msg.params.args.map((a) => a.value || a.description || 'console error').join(' '));
      }
      if (msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      }
    };
  });
}

async function waitFor(cdp, expression, timeout = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.result.value) return r.result.value;
    await sleep(150);
  }
  const diagExpression = 'JSON.stringify({href:location.href,ready:document.readyState,html:document.documentElement.outerHTML.slice(0,1200)})';
  const diag = await cdp.send('Runtime.evaluate', { expression: diagExpression, returnByValue: true });
  throw new Error('wait timeout: ' + expression + ' ' + JSON.stringify(diag.result));
}

async function evalValue(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  return r.result.value;
}

async function evalAsync(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result.value;
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}

async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}

async function touchSwipe(cdp, x0, y0, x1, y1) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 6; i++) {
    await sleep(30);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6 }]
    });
  }
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
}

async function touchPinch(cdp, cx, cy, r0, r1) {
  const points = (r) => [{ x: cx - r, y: cy }, { x: cx + r, y: cy }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(r0) });
  for (let i = 1; i <= 8; i++) {
    await sleep(35);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(r0 + (r1 - r0) * i / 8)
    });
  }
  await sleep(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
}

function cleanup() {
  try { chromeProcess && process.kill(chromeProcess.pid); } catch {}
  try { serverProcess && process.kill(serverProcess.pid); } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

await startServer();
chromeProcess = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + TMP,
  '--window-size=' + W + ',' + H,
  'about:blank'
], { stdio: 'ignore' });

let version;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
    version = await r.json();
    break;
  } catch {}
  await sleep(150);
}
if (!version) throw new Error('Chrome CDP not ready');
const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
const pageTarget = list.find((t) => t.type === 'page') || list[0];
const cdp = await connectCDP(pageTarget.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: 2,
  mobile: true
});
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/' });
await waitFor(cdp, 'window.mlBooted === true');
await sleep(800);
await shot(cdp, 'mobile-shelf.png');

await evalValue(cdp, 'document.getElementById("btn-settings").click()');
await sleep(900);
await shot(cdp, 'mobile-settings.png');
const settingsOpen = await evalValue(cdp, 'document.getElementById("modal").classList.contains("on")');
await evalValue(cdp, 'var mboxSettings = document.getElementById("mbox"); mboxSettings.scrollTop = mboxSettings.scrollHeight; true');
await sleep(250);
await shot(cdp, 'mobile-settings-bottom.png');
const settingsFooter = await evalValue(cdp, `(function(){var r=document.querySelector('#mfoot button').getBoundingClientRect();return r.top >= 0 && r.bottom <= innerHeight;})()`);
await evalValue(cdp, 'mboxSettings.scrollTop = 0; true');
await evalValue(cdp, 'document.getElementById("modal").classList.remove("on")');
await sleep(400);

const downloadHidden = await evalValue(cdp, 'document.getElementById("btn-download").classList.contains("hide")');
await sleep(100);

await evalValue(cdp, 'document.getElementById("btn-sites").click()');
await sleep(900);
await shot(cdp, 'mobile-sites.png');
const sitesOpen = await evalValue(cdp, 'document.getElementById("modal").classList.contains("on")');
await evalValue(cdp, 'document.getElementById("modal").classList.remove("on")');
await sleep(400);

await evalValue(cdp, 'document.getElementById("btn-history").click()');
await sleep(800);
await shot(cdp, 'mobile-history.png');
const historyOpen = await evalValue(cdp, '!document.getElementById("history").classList.contains("hide")');
await evalValue(cdp, 'document.getElementById("hback").click()');
await sleep(600);
const historyClosed = await evalValue(cdp, 'document.getElementById("history").classList.contains("hide")');

const cardRect = await evalValue(cdp, `(function(){
  var c=document.querySelector('#grid .card').getBoundingClientRect();
  return {x:c.x+c.width/2,y:c.y+c.height/2};
})()`);
await touchTap(cdp, cardRect.x, cardRect.y);
await waitFor(cdp, '!document.getElementById("reader").classList.contains("hide")');
await sleep(900);
await shot(cdp, 'mobile-reader-page1.png');
const page1 = await evalValue(cdp, 'document.getElementById("pageinput").value');

await evalValue(cdp, 'document.getElementById("bfull").click()');
await sleep(800);
await shot(cdp, 'mobile-reader-fullscreen.png');
const fullscreenOn = await evalValue(cdp, `(function(){
  var bar=document.getElementById('bar');
  var exitBtn=document.getElementById('exit-fullscreen');
  var r=exitBtn.getBoundingClientRect();
  return document.body.classList.contains('reader-immersive')
    && getComputedStyle(bar).display === 'none'
    && r.width > 20 && r.top >= 0 && r.right <= innerWidth;
})()`);
await evalValue(cdp, 'document.getElementById("exit-fullscreen").click()');
await sleep(600);
const fullscreenOff = await evalValue(cdp, `!document.body.classList.contains('reader-immersive') && getComputedStyle(document.getElementById('bar')).display !== 'none'`);

await touchTap(cdp, 55, 500);
await sleep(500);
await shot(cdp, 'mobile-reader-tap-next.png');
const pageAfterTap = await evalValue(cdp, 'document.getElementById("pageinput").value');

await touchSwipe(cdp, 190, 500, 340, 500);
await shot(cdp, 'mobile-reader-swipe-next.png');
const pageAfterSwipe = await evalValue(cdp, 'document.getElementById("pageinput").value');

const pinchAnchorBase = await evalValue(cdp, `(function(){
  var stage=document.getElementById('stage');
  var im=stage.querySelector('img.pageimg');
  var sr=stage.getBoundingClientRect();
  var ir=im.getBoundingClientRect();
  var ax=195-sr.left, ay=500-sr.top;
  var tx0=ir.left-sr.left, ty0=ir.top-sr.top;
  return {ax:ax, ay:ay, tx0:tx0, ty0:ty0, expectedX:ax-(ax-tx0)*2, expectedY:ay-(ay-ty0)*2};
})()`);
await touchPinch(cdp, 195, 500, 35, 70);
await shot(cdp, 'mobile-reader-pinch.png');
const zoomAfterPinch = await evalValue(cdp, 'document.getElementById("stage").classList.contains("zoom")');
const scaleAfterPinch = await evalValue(cdp, 'parseFloat(document.getElementById("stage").style.getPropertyValue("--zscale") || getComputedStyle(document.getElementById("stage")).getPropertyValue("--zscale"))');
const pinchAnchorActual = await evalValue(cdp, `(function(){
  var tr=getComputedStyle(document.getElementById('canvas')).transform;
  if(!tr || tr === 'none') return {x:0,y:0};
  var m=tr.match(/matrix(?:3d)?\(([^)]+)\)/)[1].split(',').map(Number);
  return m.length >= 16 ? {x:m[12], y:m[13]} : {x:m[4], y:m[5]};
})()`);
const pinchAnchorOk = Math.abs(pinchAnchorActual.x - pinchAnchorBase.expectedX) <= 6
  && Math.abs(pinchAnchorActual.y - pinchAnchorBase.expectedY) <= 6;
const transformBeforePan = await evalValue(cdp, 'document.getElementById("canvas").style.transform');
await touchSwipe(cdp, 170, 500, 235, 500);
await shot(cdp, 'mobile-reader-pan.png');
const transformAfterPan = await evalValue(cdp, 'document.getElementById("canvas").style.transform');

await touchPinch(cdp, 195, 500, 35, 15);
const zoomAfterPinchBack = await evalValue(cdp, 'document.getElementById("stage").classList.contains("zoom")');

await evalValue(cdp, 'document.getElementById("m-scroll").click()');
await sleep(1000);
await shot(cdp, 'mobile-reader-scroll.png');
const modeAfterClick = await evalValue(cdp, 'document.getElementById("reader").dataset.mode');

const readerOpenBeforeEdge = await evalValue(cdp, '!document.getElementById("reader").classList.contains("hide")');
await touchSwipe(cdp, 5, 500, 95, 500);
await sleep(500);
await shot(cdp, 'mobile-shelf-after-edge.png');
const shelfAfterEdge = await evalValue(cdp, `!document.getElementById('reader').classList.contains('hide') === false
  && !document.getElementById('shelf').classList.contains('hide')`);
const readerOpen = false;
const manifestOk = await evalAsync(cdp, `fetch('/manifest.webmanifest').then(r=>r.ok)`);
await cdp.send('Page.reload', { ignoreCache: true });
await waitFor(cdp, 'window.mlBooted === true');
await sleep(500);
const swState = await evalAsync(cdp, `navigator.serviceWorker.getRegistration('/service-worker.js').then(r=>!!r)`);

const checks = [
  ['手机书架打开', true],
  ['设置面板适配打开', settingsOpen === true],
  ['设置底部按钮可达', settingsFooter === true],
  ['桌面下载入口手机端隐藏', downloadHidden === true],
  ['网站面板适配打开', sitesOpen === true],
  ['历史界面打开', historyOpen === true],
  ['历史界面返回', historyClosed === true],
  ['阅读器打开', readerOpenBeforeEdge],
  ['全屏模式进入', fullscreenOn === true],
  ['全屏模式退出', fullscreenOff === true],
  ['点击区域翻页', Number(pageAfterTap) === Number(page1) + 1],
  ['滑动翻页', Number(pageAfterSwipe) === Number(pageAfterTap) + 1],
  ['双指放大', zoomAfterPinch === true && Number(scaleAfterPinch) > 1.5],
  ['双指锚点不偏移', pinchAnchorOk === true],
  ['放大后单指拖动', transformBeforePan !== transformAfterPan],
  ['双指收回复位', zoomAfterPinchBack === false],
  ['长条模式切换', modeAfterClick === 'scroll'],
  ['边缘滑动返回书架', shelfAfterEdge === true],
  ['PWA manifest 可读', manifestOk === true],
  ['Service worker 已注册', swState === true],
  ['无未捕获异常', errors.length === 0]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failed++;
}
if (errors.length) console.log(errors.join('\n'));
cdp.close();
cleanup();
process.exit(failed ? 1 : 0);
