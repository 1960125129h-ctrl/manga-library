// fix-pixiv-names.mjs —— 把历史上被命名成 'pixiv <作品ID>' 的书改回真标题
//
// 背景: 作者主页批量下载时, 列表标题初始是 'pixiv <id>', 只有"补详情"成功才换成真标题;
// 补详情被限流的那批就永久落成 'pixiv 139172953' 这样的目录名。
// 这个脚本逐本调一次 pixiv 接口取真标题, 然后
//   改目录名 -> 迁移 library.json / .progress.json / .workbench.json 里的键 -> 全量重建
//
// 用法:
//   node _scripts\fix-pixiv-names.mjs --dry        只产出对照表(不改任何东西)
//   node _scripts\fix-pixiv-names.mjs              真改(默认)
//   ... --limit 20                                 先试 20 本
//
// 安全措施: 开工前把 library/.progress/.workbench/_manifest 备份到 _backup/fix-pixiv-<时间>/,
//           每改一本立刻写 rename-map.json(可回滚), 单本失败跳过不中断。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
if (process.env.JM_PROXY_READY !== '1') {   // 代理必须在进程启动时就位(NODE_USE_ENV_PROXY)
  const r0 = spawnSync(process.execPath, [SELF, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
           HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890',
           NODE_USE_ENV_PROXY: '1', JM_PROXY_READY: '1' }
  });
  process.exit(r0.status || 0);
}

const LIB = path.resolve(path.dirname(SELF), '..');
const CAT = '漫画';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : (d === undefined ? null : d); };
const DRY = argv.includes('--dry');
const LIMIT = Number(arg('limit', '0')) || 0;
const say = (s) => console.log(s);

const J = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const W = (p, v) => { const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2), 'utf8'); fs.renameSync(t, p); };
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\s.]+$/, '').slice(0, 120);

const manifestPath = path.join(LIB, '_manifest.json');
const libPath = path.join(LIB, 'library.json');
const progPath = path.join(LIB, '.progress.json');
const wbPath = path.join(LIB, '.workbench.json');

const man = J(manifestPath, null);
if (!man || !Array.isArray(man.comics)) { say('读不到 _manifest.json，先跑一次 build-library'); process.exit(1); }
const lib = J(libPath, { comics: {} });
const prog = J(progPath, {});
const wb = J(wbPath, null);

const IDRE = /^pixiv\s+(\d+)$/i;
let targets = man.comics.filter((c) => IDRE.test(String(c.name || '').trim()));
if (LIMIT) targets = targets.slice(0, LIMIT);
say('待处理: ' + targets.length + ' 本' + (DRY ? '（--dry: 只出对照表，不改任何东西）' : ''));

let stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backDir = path.join(LIB, '_backup', 'fix-pixiv-' + stamp);
if (!DRY) {
  fs.mkdirSync(backDir, { recursive: true });
  for (const f of [libPath, progPath, wbPath, manifestPath]) {
    try { fs.copyFileSync(f, path.join(backDir, path.basename(f))); } catch (e) {}
  }
  say('已备份到: ' + backDir);
}

const { pixiv } = await import('./sites/index.mjs');
const mapPath = path.join(DRY ? path.join(LIB, '_backup') : backDir, 'rename-map.json');
if (DRY) fs.mkdirSync(path.dirname(mapPath), { recursive: true });
const map = [];
const writeMap = () => { try { W(mapPath, map); } catch (e) {} };

// 现有名字集合(含本次已改的), 用来判重名
const used = new Set(man.comics.map((c) => String(c.name || '').trim()));

let ok = 0, skipped = 0, failed = 0;
for (let i = 0; i < targets.length; i++) {
  const c = targets[i];
  const oldName = String(c.name || '').trim();
  const id = (oldName.match(IDRE) || [])[1];
  const oldDir = String(c.dir);
  const tag = '[' + (i + 1) + '/' + targets.length + '] ' + oldName;
  try {
    let meta = null;
    for (let k = 0; k < 3 && !meta; k++) {
      try { meta = await pixiv.resolve('https://www.pixiv.net/artworks/' + id); }
      catch (e) { await new Promise((r) => setTimeout(r, 2500)); }
    }
    const title = safe((meta && meta.title) || '');
    if (!title) { say(tag + ' -> 跳过(取不到标题)'); failed++; map.push({ id, oldName, newName: '', status: 'no-title' }); writeMap(); continue; }
    let newName = title;
    if (!DRY && used.has(newName) && newName !== oldName) newName = safe(title + ' (' + id + ')');   // 重名才加 ID 后缀
    if (DRY && newName !== oldName) { /* 只记录 */ }
    if (newName === oldName) { say(tag + ' -> 跳过(名字已经是真标题)'); skipped++; map.push({ id, oldName, newName, status: 'same' }); writeMap(); continue; }
    say(tag + ' -> ' + newName);
    if (DRY) { map.push({ id, oldName, newName, status: 'dry' }); writeMap(); ok++;
      await new Promise((r) => setTimeout(r, 450)); continue; }

    const oldAbs = path.join(LIB, oldDir);
    const newDir = CAT + '/' + newName;
    const newAbs = path.join(LIB, newDir);
    if (!fs.existsSync(oldAbs)) { say('  跳过(目录不存在): ' + oldDir); skipped++; map.push({ id, oldName, newName, status: 'no-dir' }); writeMap(); continue; }
    if (fs.existsSync(newAbs)) newName = safe(title + ' (' + id + ')');
    const finalDir = CAT + '/' + newName, finalAbs = path.join(LIB, finalDir);
    if (fs.existsSync(finalAbs)) { say('  跳过(目标已存在): ' + finalDir); skipped++; map.push({ id, oldName, newName: finalDir, status: 'exists' }); writeMap(); continue; }
    fs.renameSync(oldAbs, finalAbs);
    // library.json / .progress.json: 键就是 dir
    if (lib.comics && lib.comics[oldDir]) {
      if (lib.comics[finalDir]) { delete lib.comics[oldDir]; } else { lib.comics[finalDir] = lib.comics[oldDir]; delete lib.comics[oldDir]; }
      W(libPath, lib);
    }
    if (prog && prog[oldDir]) { if (!prog[finalDir]) prog[finalDir] = prog[oldDir]; delete prog[oldDir]; W(progPath, prog); }
    // 工作台虚拟引用
    if (wb && wb.images) {
      let touched = 0;
      for (const k2 of Object.keys(wb.images)) {
        const im = wb.images[k2];
        if (im && im.ref && im.ref.book === oldDir) { im.ref.book = finalDir; touched++; }
      }
      if (touched) { W(wbPath, wb); say('  工作台引用改了 ' + touched + ' 张'); }
    }
    used.delete(oldName); used.add(newName);
    ok++;
    map.push({ id, oldName, newName: finalDir, title, status: 'renamed' });
    writeMap();
  } catch (e) {
    failed++;
    say(tag + ' -> 失败: ' + String((e && e.message) || e).slice(0, 120));
    map.push({ id, oldName, newName: '', status: 'error', err: String((e && e.message) || e).slice(0, 200) });
    writeMap();
  }
  await new Promise((r) => setTimeout(r, 450));   // 限流保护
}

writeMap();
say('');
say('完成: 改了 ' + ok + ' 本, 跳过 ' + skipped + ' 本, 失败 ' + failed + ' 本');
say('对照表/回滚表: ' + mapPath);

if (!DRY && ok) {
  say('正在全量重建书库数据…');
  const br = spawnSync(process.execPath, [path.join(LIB, '_scripts', 'build-library.mjs'), '--lib', LIB, '--offline'], { cwd: LIB, stdio: 'ignore' });
  say('重建退出码: ' + (br.status == null ? -1 : br.status));
}
