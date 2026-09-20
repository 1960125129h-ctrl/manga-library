// 诊断画板单图缩放、整画布缩放、右键菜单归属、缩放手柄和原书定位。
import { startApp, waitBooted } from './appctl.mjs';
import { humanClick } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await startApp(9892);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 3));
const bad = [];
const chk = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) bad.push(name);
};
const clickTool = async (label) => ev(`(function(){
  var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tool"),x=>x.textContent===${JSON.stringify(label)});
  if(b){b.click();return true;}
  return false;
})()`);
async function humanDrag(x1, y1, x2, y2, button = 'left') {
  const buttons = button === 'right' ? 2 : 1;
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none' });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button, buttons, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await p.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x1 + (x2 - x1) * i / 6, y: y1 + (y2 - y1) * i / 6,
      button: 'none', buttons,
    });
    await sleep(35);
  }
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button, buttons: 0, clickCount: 1 });
}
async function humanRightClick(x, y) {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(120);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
}

try {
  await waitBooted(p);
  await sleep(800);
  await ev('document.getElementById("mode-workbench").click()');
  await sleep(700);
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="画板");if(b)b.click();})()');
  await sleep(1000);
  await ev(`(async function(){
    var imgs=Array.from(document.querySelectorAll("#workbench .wb-bitem img"));
    await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload=res; img.onerror=res; })));
  })()`);

  const tools = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll("#workbench .wb-tool")).map(x=>x.textContent))`));
  chk('工具栏有单图缩小', tools.includes('图缩小'), tools.join('|'));
  chk('工具栏有单图放大', tools.includes('图放大'), tools.join('|'));
  chk('工具栏有画板缩小', tools.includes('画板缩小'), tools.join('|'));
  chk('工具栏有画板放大', tools.includes('画板放大'), tools.join('|'));

  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="图墙");if(b)b.click();})()');
  await sleep(700);
  await ev(`(function(){
    var c=document.querySelector("#workbench .wb-cell"),r=c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:r.x+20,clientY:r.y+20}));
  })()`);
  await sleep(400);
  const wallMenu = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll("#ctx button")).map(x=>x.textContent))`));
  chk('图墙右键不承载画板缩放', !wallMenu.includes('图缩小') && !wallMenu.includes('画板缩小'), wallMenu.join('|'));
  await ev('document.querySelector("#ctx").classList.remove("on")');
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("#workbench .wb-tab"),x=>x.textContent==="画板");if(b)b.click();})()');
  await sleep(900);

  const itemExpr = `(function(){
    function cam(){
      var c=document.querySelector("#workbench .wb-canvas"),m=new DOMMatrix(getComputedStyle(c).transform);
      return {bk:m.a,btx:m.e,bty:m.f};
    }
    var d=document.querySelector("#workbench .wb-bitem"),r=d.getBoundingClientRect(),img=d.querySelector("img");
    return Object.assign({id:d.dataset.id,cx:r.x+r.width/2,cy:r.y+r.height/2,w:d.offsetWidth,h:d.offsetHeight,sel:d.classList.contains("sel"),src:img.getAttribute("src")},cam());
  })()`;
  const itemJson = async () => JSON.parse(await ev(`JSON.stringify(${itemExpr})`));

  await clickTool('重置视图');
  await sleep(300);
  const first = await itemJson();
  await humanClick(p, first.cx, first.cy);
  await sleep(400);
  const selected = await itemJson();
  chk('点击图片可选中', selected.sel, JSON.stringify({ id: selected.id, sel: selected.sel }));
  await clickTool('图复位');
  await sleep(400);

  const beforeItem = await itemJson();
  chk('工具栏单图放大可触发', await clickTool('图放大') === 'true');
  await sleep(500);
  const afterItem = await itemJson();
  chk('单图放大改变图片尺寸且中心不跳',
    afterItem.w > beforeItem.w * 1.1
      && Math.abs(afterItem.cx - beforeItem.cx) < 3
      && Math.abs(afterItem.cy - beforeItem.cy) < 3,
    JSON.stringify({ before: beforeItem.w, after: afterItem.w, dx: afterItem.cx - beforeItem.cx, dy: afterItem.cy - beforeItem.cy }));

  const beforePlainWheel = await itemJson();
  await ev(`(function(info){
    var d=document.querySelector('#workbench .wb-bitem'),r=d.getBoundingClientRect();
    d.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,buttons:0,deltaY:-120,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
  })()`);
  await sleep(400);
  const afterPlainWheel = await itemJson();
  chk('普通滚轮悬浮图片只缩放画板',
    Math.abs(afterPlainWheel.w - beforePlainWheel.w) < 1
      && afterPlainWheel.bk > beforePlainWheel.bk,
    JSON.stringify({ item: afterPlainWheel.w, bk: afterPlainWheel.bk }));
  await clickTool('重置视图');
  await sleep(300);

  const beforeRightWheel = await itemJson();
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeRightWheel.cx, y: beforeRightWheel.cy, button: 'none' });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: beforeRightWheel.cx, y: beforeRightWheel.cy, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(150);
  await ev(`(function(info){
    var d=document.querySelector('#workbench .wb-bitem'),r=d.getBoundingClientRect();
    d.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,buttons:2,deltaY:-120,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
  })()`);
  await sleep(400);
  const readerZoomOn = await ev('document.getElementById("stage").classList.contains("zoom")');
  const afterRightWheel = await itemJson();
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: beforeRightWheel.cx, y: beforeRightWheel.cy, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(300);
  const menuAfterWheel = await ev('document.querySelector("#ctx").classList.contains("on")');
  chk('按住右键滚轮只缩放画板图片',
    afterRightWheel.w > beforeRightWheel.w * 1.1
      && Math.abs(afterRightWheel.cx - beforeRightWheel.cx) < 3
      && Math.abs(afterRightWheel.cy - beforeRightWheel.cy) < 3
      && readerZoomOn === 'false'
      && menuAfterWheel === 'false',
    JSON.stringify({ before: beforeRightWheel.w, after: afterRightWheel.w, readerZoom: readerZoomOn, menu: menuAfterWheel }));

  await clickTool('图复位');
  await sleep(300);
  await clickTool('重置视图');
  await sleep(300);
  const centerPoint = JSON.parse(await ev(`JSON.stringify((function(){
    var host=document.querySelector("#workbench .wb-boardhost"),r=host.getBoundingClientRect();
    var c=document.querySelector("#workbench .wb-canvas"),m=new DOMMatrix(getComputedStyle(c).transform);
    return {x:(r.width/2-m.e)/m.a,y:(r.height/2-m.f)/m.a,bk:m.a};
  })())`));
  chk('工具栏画板放大可触发', await clickTool('画板放大') === 'true');
  await sleep(400);
  const centerAfter = JSON.parse(await ev(`JSON.stringify((function(){
    var host=document.querySelector("#workbench .wb-boardhost"),r=host.getBoundingClientRect();
    var c=document.querySelector("#workbench .wb-canvas"),m=new DOMMatrix(getComputedStyle(c).transform);
    return {x:(r.width/2-m.e)/m.a,y:(r.height/2-m.f)/m.a,bk:m.a};
  })())`));
  chk('画板按钮缩放以视口中心为锚点',
    centerAfter.bk > centerPoint.bk
      && Math.abs(centerAfter.x - centerPoint.x) < 1
      && Math.abs(centerAfter.y - centerPoint.y) < 1,
    JSON.stringify({ before: centerPoint, after: centerAfter }));

  await clickTool('重置视图');
  await sleep(300);
  const beforeRightDrag = await itemJson();
  await humanDrag(beforeRightDrag.cx, beforeRightDrag.cy, beforeRightDrag.cx + 170, beforeRightDrag.cy + 20, 'right');
  await sleep(400);
  const afterRightDrag = await itemJson();
  const rightMenuOpened = await ev('document.querySelector("#ctx").classList.contains("on")');
  chk('右键拖动可移动画板图片且不弹菜单',
    Math.abs(afterRightDrag.cx - beforeRightDrag.cx - 170) < 5
      && Math.abs(afterRightDrag.cy - beforeRightDrag.cy - 20) < 5
      && rightMenuOpened === 'false',
    JSON.stringify({ dx: afterRightDrag.cx - beforeRightDrag.cx, menu: rightMenuOpened }));
  await humanDrag(afterRightDrag.cx, afterRightDrag.cy, beforeRightDrag.cx, beforeRightDrag.cy, 'right');
  await sleep(300);

  await clickTool('重置视图');
  await sleep(300);
  const emptyPoint = JSON.parse(await ev(`JSON.stringify((function(){
    var host=document.querySelector("#workbench .wb-boardhost"),r=host.getBoundingClientRect();
    var pts=[[r.left+12,r.top+12],[r.right-12,r.top+12],[r.left+12,r.bottom-12],[r.right-12,r.bottom-12]];
    for(var i=0;i<pts.length;i++){
      var e=document.elementFromPoint(pts[i][0],pts[i][1]);
      if(e&&!(e.closest&&e.closest(".wb-bitem"))) return {x:pts[i][0],y:pts[i][1],className:e.className};
    }
    return null;
  })())`));
  chk('画板空白处可打开视图菜单', !!emptyPoint, JSON.stringify(emptyPoint));
  if (emptyPoint) {
    await ev(`(function(p){
      host=document.querySelector("#workbench .wb-boardhost");
      host.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y}));
    })(${JSON.stringify(emptyPoint)})`);
    await sleep(400);
    const emptyMenu = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll("#ctx button")).map(x=>x.textContent))`));
    chk('画板空白菜单包含画板缩放', emptyMenu.includes('画板缩小') && emptyMenu.includes('画板放大') && emptyMenu.includes('适应全部'), emptyMenu.join('|'));
    await ev('document.querySelector("#ctx").classList.remove("on")');
  }

  await clickTool('适应全部');
  await sleep(500);
  const beforeResize = await itemJson();
  const handle = JSON.parse(await ev(`JSON.stringify((function(){
    var d=document.querySelector("#workbench .wb-bitem"),h=d.querySelector(".wb-resize"),r=h.getBoundingClientRect();
    var x=r.x+r.width/2,y=r.y+r.height/2,e=document.elementFromPoint(x,y);
    return {x,y,target:e?e.className:""};
  })())`));
  await humanDrag(handle.x, handle.y, handle.x + 300, handle.y + 25);
  await sleep(500);
  const afterResize = await itemJson();
  chk('拖动缩放手柄可放大单图且中心不跳',
    handle.target === 'wb-resize'
      && afterResize.w > beforeResize.w * 1.1
      && Math.abs(afterResize.cx - beforeResize.cx) < 5
      && Math.abs(afterResize.cy - beforeResize.cy) < 5,
    JSON.stringify({ target: handle.target, before: beforeResize.w, after: afterResize.w, dx: afterResize.cx - beforeResize.cx }));

  const menuPoint = await itemJson();
  await humanRightClick(menuPoint.cx + 30, menuPoint.cy + 30);
  await sleep(400);
  const menu = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll("#ctx button")).map(x=>x.textContent))`));
  chk('画板右键有单图缩放', menu.includes('图缩小') && menu.includes('图放大'), menu.join('|'));
  chk('画板右键有画板缩放', menu.includes('画板缩小') && menu.includes('画板放大'), menu.join('|'));
  chk('画板右键有在原书里打开', menu.includes('在原书里打开'), menu.join('|'));

  const beforeReader = await itemJson();
  await ev(`(function(){
    var b=Array.prototype.find.call(document.querySelectorAll("#ctx button"),x=>x.textContent==="在原书里打开");
    if(b)b.click();
  })()`);
  await sleep(1500);
  const readerState = JSON.parse(await ev(`JSON.stringify((function(){
    return {
      readerVisible:!document.getElementById("reader").classList.contains("hide"),
      workbenchHidden:document.getElementById("workbench").classList.contains("hide"),
      page:document.getElementById("pageinput").value,
      title:document.getElementById("chname").textContent,
      stageImage:(function(){var i=document.querySelector("#stage img");if(!i)return null;var r=i.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,y:r.y,src:i.getAttribute("src")};})()
    };
  })())`));
  chk('原书打开后进入阅读器', readerState.readerVisible && readerState.workbenchHidden, JSON.stringify(readerState));
  chk('原书打开后目标页可见', !!readerState.stageImage && readerState.stageImage.w > 100 && readerState.stageImage.h > 100, JSON.stringify(readerState.stageImage));
  chk('原书打开后显示的就是参考图来源', !!readerState.stageImage && readerState.stageImage.src === beforeReader.src, `${readerState.stageImage && readerState.stageImage.src} vs ${beforeReader.src}`);

  const exceptions = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  chk('零未捕获异常', exceptions.length === 0, exceptions.length ? String(exceptions.length) : '');
  if (exceptions.length) exceptions.slice(0, 3).forEach((e) => console.log(String(e.params.exceptionDetails.exception.description).slice(0, 240)));
  console.log('diagnostic misses: ' + bad.length);
} catch (e) {
  console.log('  ERR ' + ((e && e.message) || e));
  bad.push('exception');
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}
process.exit(bad.length ? 1 : 0);
