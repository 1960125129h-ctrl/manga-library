import fs from 'node:fs';
import path from 'node:path';
import { startApp, waitBooted } from './appctl.mjs';
import { humanClick } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = path.resolve('_visual-check');
fs.mkdirSync(outDir, { recursive: true });
const app = await startApp(9886);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 3));
async function shot(name) {
  const r = await p.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64'));
}

try {
  await waitBooted(p); await sleep(1000);
  await ev('document.getElementById("mode-workbench").click()'); await sleep(700);
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="图墙");if(b)b.click();})()'); await sleep(900);

  const rect = JSON.parse(await ev(`(function(){
    var el=document.querySelector("#workbench .wb-cell");
    var r=el.getBoundingClientRect();
    return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});
  })()`));
  await shot('wall-before-click.png');
  await humanClick(p, rect.x + rect.w / 2, rect.y + rect.h / 2); await sleep(900);
  const afterClick = await ev(`JSON.stringify({
    wbHidden:document.getElementById("workbench").classList.contains("hide"),
    shelfHidden:document.getElementById("shelf").classList.contains("hide"),
    readerHidden:document.getElementById("reader").classList.contains("hide"),
    activeTab:document.querySelector("#workbench .wb-tab.on")?.textContent||""
  })`);
  console.log('afterClick=' + afterClick);

  await ev('document.getElementById("mode-workbench").click()'); await sleep(500);
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="图墙");if(b)b.click();})()'); await sleep(500);
  await ev(`(function(){
    var cell=document.querySelector("#workbench .wb-cell");
    cell.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:120,clientY:120}));
    var b=Array.prototype.find.call(document.querySelectorAll("#ctx button"),x=>x.textContent.indexOf("加入参考板")>=0);
    if(b)b.click();
  })()`); await sleep(1500);
  const boardState = await ev(`JSON.stringify({
    activeTab:document.querySelector("#workbench .wb-tab.on")?.textContent||"",
    host:(function(){var r=document.querySelector("#workbench .wb-boardhost").getBoundingClientRect();return{w:r.width,h:r.height}})(),
    canvas:(function(){var r=document.querySelector("#workbench .wb-canvas").getBoundingClientRect();return{w:r.width,h:r.height}})(),
    items:Array.from(document.querySelectorAll("#workbench .wb-bitem")).map(function(d){
      var img=d.querySelector("img"),r=d.getBoundingClientRect(),cs=getComputedStyle(d);
      return {complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,
        rect:{w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)},
        display:cs.display,visibility:cs.visibility,src:img.getAttribute("src")};
    })
  })`);
  console.log('boardState=' + boardState);
  await shot('board-after-add.png');
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}
