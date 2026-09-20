import { startApp, waitBooted } from './appctl.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await startApp(9887);
const { p } = app;
try {
  await waitBooted(p); await sleep(1000);
  await p.ev('document.getElementById("mode-workbench").click()', 3); await sleep(600);
  await p.ev(`(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="画板");if(b)b.click();})()`, 3); await sleep(900);
  const r = await p.ev(`JSON.stringify((function(){
    var host=document.querySelector("#workbench .wb-boardhost"),canvas=document.querySelector("#workbench .wb-canvas"),
      d=document.querySelector("#workbench .wb-bitem"),img=d&&d.querySelector("img");
    return {
      hostClass:host.className,hostDisplay:getComputedStyle(host).display,
      canvasClass:canvas.className,canvasInline:canvas.getAttribute("style"),canvasTransform:getComputedStyle(canvas).transform,
      itemInline:d.getAttribute("style"),itemRect:(function(){var x=d.getBoundingClientRect();return{w:x.width,h:x.height}})(),
      imgWidth:getComputedStyle(img).width,imgRect:(function(){var x=img.getBoundingClientRect();return{w:x.width,h:x.height}})()
    };
  })())`, 3);
  console.log(r);
} finally { try{p.close()}catch(e){} app.stop(); }
