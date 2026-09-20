import fs from 'node:fs';
import path from 'node:path';
import { startApp, waitBooted } from './appctl.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = path.resolve('_visual-check');
fs.mkdirSync(outDir, { recursive: true });
const app = await startApp(9889);
const { p } = app;
const ev = async (js) => String(await p.ev(js, 3));
async function shot(file) {
  const r = await p.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, file), Buffer.from(r.data, 'base64'));
}

try {
  await waitBooted(p);
  await sleep(800);
  await ev('document.getElementById("mode-shelf").click()');
  await sleep(1200);
  const cardCount = Number(await ev(`(function(){
    var card = document.querySelector('#grid .card');
    var thumb = card && card.querySelector('.thumb');
    if (!thumb) return 0;
    var b = document.createElement('button');
    b.className = 'star visual-star';
    b.textContent = '☆';
    b.title = '收藏 / 取消收藏';
    thumb.appendChild(b);
    return document.querySelectorAll('#grid .card').length;
  })()`));
  if (!cardCount) throw new Error('书架卡片不足，无法截图文字收藏按钮');
  await shot('shelf-favorite-off.png');

  await ev(`(function(){
    var b = document.querySelector('.visual-star');
    b.textContent = '★';
    b.classList.add('on');
  })()`);
  await sleep(300);
  await shot('shelf-favorite-on.png');

  await ev(`(function(){
    document.getElementById('shelf').classList.add('hide');
    var reader=document.getElementById('reader');
    reader.classList.remove('hide');
    reader.style.position='fixed'; reader.style.top='34px'; reader.style.left='0'; reader.style.right='0'; reader.style.bottom='0';
    var bar = document.getElementById('bar');
    bar.style.position='fixed'; bar.style.top='34px'; bar.style.left='0'; bar.style.right='0'; bar.style.transform='none'; bar.style.zIndex='60';
    document.body.classList.remove('bar-autohide');
    var b = document.getElementById('bbm');
    b.textContent = '书签';
    b.classList.remove('on');
  })()`);
  await sleep(300);
  await shot('reader-bookmark-text.png');

  await ev(`(function(){
    var b = document.getElementById('bbm');
    b.textContent = '已书签';
    b.classList.add('on');
  })()`);
  await sleep(300);
  await shot('reader-bookmark-set.png');
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}
