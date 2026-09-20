// 用 Electron 自己把任意 HTML 截成 PNG —— 不需要调试端口、不需要 CDP。
// 用法: electron shot-main.cjs --html <文件> | --url <地址> --out <png> [--w 1400] [--h 900] [--wait 2500] [--js <要跑的js文件>] [--show]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : def;
}
const html = arg('html', '');
const url = arg('url', '');
const out = arg('out', path.join(process.cwd(), 'shot.png'));
const W = parseInt(arg('w', '1400'), 10);
const H = parseInt(arg('h', '900'), 10);
const wait = parseInt(arg('wait', '2000'), 10);
const jsFile = arg('js', '');
const show = process.argv.includes('--show');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H,
    show: !!show,
    x: show ? 60 : -4000, y: show ? 60 : 0,   // 不显示时挪到屏幕外, 但照常渲染
    backgroundColor: '#111214',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false }
  });
  const target = html ? ('file:///' + html.replace(/\\/g, '/')) : url;
  try { await win.loadURL(target); } catch (e) { console.log('LOAD-ERR ' + (e && e.message || e)); }
  await new Promise((r) => setTimeout(r, wait));
  if (jsFile && fs.existsSync(jsFile)) {
    try {
      const res = await win.webContents.executeJavaScript(fs.readFileSync(jsFile, 'utf8'), true);
      console.log('JS-RESULT ' + String(res).slice(0, 1500));
    } catch (e) { console.log('JS-ERR ' + (e && e.message || e)); }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    const img = await win.webContents.capturePage();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, img.toPNG());
    const sz = img.getSize();
    console.log('OK ' + out + '  ' + sz.width + 'x' + sz.height + '  ' + Math.round(fs.statSync(out).size / 1024) + 'KB');
  } catch (e) { console.log('CAPTURE-ERR ' + (e && e.message || e)); }
  app.quit();
});
