import fs from 'node:fs';
import path from 'node:path';
import { startApp, waitBooted } from './appctl.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = path.resolve('_visual-check');
fs.mkdirSync(outDir, { recursive: true });
const app = await startApp(9888);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 3));
const clickTool = async (label) => ev(`(function(){
  var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tool"),x=>x.textContent===${JSON.stringify(label)});
  if(b){b.click();return true;}
  return false;
})()`);
async function shot(file) {
  const r = await p.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, file), Buffer.from(r.data, 'base64'));
}
const firstCenter = async () => JSON.parse(await ev(`JSON.stringify((function(){
  var d=document.querySelector("#workbench .wb-bitem"),r=d.getBoundingClientRect();
  return {x:r.x+r.width/2,y:r.y+r.height/2};
})())`));
async function drag(x1, y1, x2, y2, button = 'left') {
  const buttons = button === 'right' ? 2 : 1;
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none' });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button, buttons, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await p.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x1 + (x2 - x1) * i / 6,
      y: y1 + (y2 - y1) * i / 6,
      button: 'none', buttons,
    });
    await sleep(35);
  }
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button, buttons: 0, clickCount: 1 });
}
async function rightClick(x, y) {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(120);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
}
async function rightWheelAt(x, y) {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(150);
  await ev(`(function(p){
    var d=document.querySelector("#workbench .wb-bitem");
    d.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,buttons:2,deltaY:-120,clientX:p.x,clientY:p.y}));
  })(${JSON.stringify({x,y})})`);
  await sleep(300);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
}

try {
  await waitBooted(p); await sleep(1000);
  await ev('document.getElementById("mode-workbench").click()'); await sleep(700);
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="图墙");if(b)b.click();})()');
  await sleep(1200);
  await shot('wall-current.png');

  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="画板");if(b)b.click();})()');
  await sleep(900);
  await clickTool('适应全部'); await sleep(600);
  const c0 = await firstCenter();
  await drag(c0.x, c0.y, c0.x, c0.y, 'left'); await sleep(300);
  await clickTool('图复位'); await sleep(400);
  await clickTool('重置视图'); await sleep(500);
  await shot('board-initial.png');

  const c1 = await firstCenter();
  await drag(c1.x, c1.y, c1.x + 180, c1.y + 20, 'right');
  await sleep(400);
  await shot('board-right-drag.png');
  const c2 = await firstCenter();
  await drag(c2.x, c2.y, c1.x, c1.y, 'right');
  await sleep(400);

  const c3 = await firstCenter();
  await rightWheelAt(c3.x, c3.y); await sleep(300);
  await shot('board-item-zoom.png');
  await clickTool('图复位'); await sleep(400);

  await clickTool('重置视图'); await sleep(350);
  await clickTool('画板缩小'); await sleep(300);
  await clickTool('画板缩小'); await sleep(500);
  await shot('board-canvas-zoom-out.png');
  await clickTool('重置视图'); await sleep(400);

  const c4 = await firstCenter();
  await rightClick(c4.x + 30, c4.y + 30);
  await sleep(500);
  await shot('board-context-menu.png');

  await ev(`(function(){
    var b=Array.prototype.find.call(document.querySelectorAll("#ctx button"),x=>x.textContent==="在原书里打开");
    if(b)b.click();
  })()`);
  await sleep(1500);
  await shot('reader-from-board.png');
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}