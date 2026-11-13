// verify-import.mjs —— 文件关联(.cbz)导入验收
//
// 造一个压缩包(故意把两张图放进子目录, 顺便验压平逻辑) -> 带参数启动应用 -> 看是否导入成功 -> 清理。
// 这条链路以前完全没被验过, 而它是"双击漫画包就能看"的全部实现。
//
//   node _scripts\jm\verify-import.mjs     退出码 0 = 全过

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, waitBooted, LIB } from './appctl.mjs';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };

const BOOK = '_导入验收';
const TMP = path.join(LIB, '_tmp_cbz');
const STAGE = path.join(TMP, 'src');
const ZIP = path.join(TMP, BOOK + '.zip');
const CBZ = path.join(TMP, BOOK + '.cbz');
const BOOKDIR = path.join(LIB, '漫画', BOOK);
const SRC_LIB = '<书库根>/漫画';

function cleanup() {
  for (const d of [TMP, BOOKDIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
}

let app = null;
try {
  cleanup();
  // 借正式库的图当素材
  const picks = [];
  const walk = (d) => {
    if (picks.length >= 4 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (picks.length >= 4) return;
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (/\.(webp|jpg|png)$/i.test(e.name)) { try { const s = fs.statSync(q); if (s.size > 3000 && s.size < 120000) picks.push(q); } catch (x) {} }
    }
  };
  walk(SRC_LIB);
  chk('找到测试素材图', picks.length >= 4, picks.length + ' 张');
  if (picks.length < 4) throw new Error('素材不足');

  fs.mkdirSync(path.join(STAGE, '子目录'), { recursive: true });
  fs.copyFileSync(picks[0], path.join(STAGE, '001.jpg'));
  fs.copyFileSync(picks[1], path.join(STAGE, '002.jpg'));
  fs.copyFileSync(picks[2], path.join(STAGE, '子目录', 'a.jpg'));   // 嵌套: 要能被提上来
  fs.copyFileSync(picks[3], path.join(STAGE, '子目录', 'b.jpg'));

  const z = spawnSync('powershell', ['-NoProfile', '-Command',
    'Compress-Archive -Path "' + STAGE + '\\*" -DestinationPath "' + ZIP + '" -Force'], { encoding: 'utf8' });
  chk('压缩包已造出', fs.existsSync(ZIP), fs.existsSync(ZIP) ? Math.round(fs.statSync(ZIP).size / 1024) + ' KB' : (z.stderr || '').slice(0, 120));
  fs.renameSync(ZIP, CBZ);

  app = await startApp(9840, [CBZ]);
  await waitBooted(app.p);
  // 导入 + 重建要一会儿
  let imported = false, logTail = '';
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const f = fs.readdirSync(path.join(BOOKDIR, '全本'));
      if (f.filter((x) => /\.(jpg|jpeg|png|webp|gif)$/i.test(x)).length >= 4) { imported = true; break; }
    } catch (e) {}
  }
  chk('压缩包被导入书库', imported);

  let files = [];
  try { files = fs.readdirSync(path.join(BOOKDIR, '全本')).filter((x) => /\.(jpg|jpeg|png|webp|gif)$/i.test(x)).sort(); } catch (e) {}
  chk('4 张图都在话目录里', files.length === 4, files.join(', '));
  chk('嵌套的图被提到同一层(压平生效)', files.every((f) => !f.includes('子目录')) && files.length === 4, files.join(', '));

  // 书库数据要跟着更新, 否则书架上看不到
  let inManifest = false;
  try {
    const mf = JSON.parse(fs.readFileSync(path.join(LIB, '_manifest.json'), 'utf8'));
    inManifest = (mf.comics || []).some((c) => String(c.dir || '').indexOf(BOOK) >= 0);
  } catch (e) {}
  chk('已写进书库数据(书架上能看到)', inManifest);
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  if (app) { try { app.p.close(); } catch (e) {} app.stop(); }
  cleanup();
  // 清掉导入记录, 免得它在书库数据里留下痕迹
  try {
    const mf = path.join(LIB, '_manifest.json');
    const j = JSON.parse(fs.readFileSync(mf, 'utf8'));
    j.comics = (j.comics || []).filter((c) => String(c.dir || '').indexOf(BOOK) < 0);
    j.count = j.comics.length;
    fs.writeFileSync(mf, JSON.stringify(j), 'utf8');
  } catch (e) {}
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
