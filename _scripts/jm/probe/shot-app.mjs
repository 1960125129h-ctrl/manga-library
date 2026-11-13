import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, sleep } from '../cdp.mjs';

const WORK = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(WORK, '..', '..', '..');
const APP = path.join(LIB, '_app');
const ELECTRON = path.join(APP, 'node_modules/electron/dist/electron.exe');
const out = process.argv[2] || path.join(LIB, '_visual-check', 'app.png');
const W = parseInt(process.argv[3] || '1400', 10);
const H = parseInt(process.argv[4] || '900', 10);

function portFree(p) { return new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.once('listening', () => s.close(() => res(true))); s.listen(p, '127.0.0.1'); }); }
let port = 0;
for (let p = 9800; p < 9840; p++) { if (await portFree(p)) { port = p; break; } }
const child = spawn(ELECTRON, ['.', '--remote-debugging-port=' + port], { cwd: APP, detached: true, stdio: 'ignore' });
child.unref();
const done = (c) => { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} process.exit(c); };

let page = null;
for (let i = 0; i < 70; i++) { await sleep(500); try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); page = l.find((x) => x.type === 'page'); if (page) break; } catch (e) {} }
if (!page) { console.log('NO PAGE'); done(1); }
const p = await openPage(port, page.id);
for (let i = 0; i < 40; i++) { await sleep(400); try { if (await p.ev('!!window.mlBooted', 2)) break; } catch (e) {} }
await sleep(1500);
await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(800);
const r = await p.send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
console.log('截图: ' + out + '  (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
p.close();
done(0);
