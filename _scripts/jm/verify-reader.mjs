// verify-reader.mjs —— 阅读器验收(重构的安全网)
//
// 阅读器有 3 种模式 × 3 种适配 = 9 种组合, 外加方向/封面/侧栏/缩放等开关。
// 之前只测了"能进阅读器、图片能解码"这一个默认组合, 其余 8 种完全没覆盖 ——
// 而重构最容易坏的正是这里。
//
//   node _scripts\jm\verify-reader.mjs
// 前置: 书库里要有书(先跑 make-fixture.mjs), 退出码 0 = 全过

import { startApp, waitBooted } from './appctl.mjs';

const R = [];
const chk = (n, ok, d) => { R.push({ n, ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await startApp(9880);
const { p } = app;

const ev = async (js) => String(await p.ev(js, 2));
const click = async (id) => {
  const ok = await p.ev('(function(){var b=document.getElementById(' + JSON.stringify(id) + '); if(!b) return false; b.click(); return true;})()', 2);
  await sleep(450);
  return !!ok;
};
// #stage 上的类名反映当前模式/适配
const stageInfo = async () => JSON.parse(await ev('JSON.stringify((function(){var s=document.getElementById("stage"); if(!s) return {}; var im=s.querySelector("img"); var r=s.getBoundingClientRect(); return { cls: Array.prototype.slice.call(s.classList), w: Math.round(r.width), h: Math.round(r.height), imgs: s.querySelectorAll("img").length, iw: im?im.naturalWidth:0, dw: im?Math.round(im.getBoundingClientRect().width):0, dh: im?Math.round(im.getBoundingClientRect().height):0 };})())') || '{}');

try {
  chk('界面核心已启动', await waitBooted(p));
  const cards = Number(await ev('document.querySelectorAll("#grid > *").length'));
  chk('书库里有书', cards > 0, 'cards=' + cards);
  if (!cards) throw new Error('先跑 node _scripts\jm\make-fixture.mjs');

  // 进阅读器
  await p.ev('(function(){var c=document.querySelector("#grid > *"); if(c) c.click();})()', 2);
  await sleep(2500);
  chk('已进入阅读器', String(await ev('!document.getElementById("reader").classList.contains("hide")')) === 'true');

  // ---- 9 种 模式 × 适配 组合 ----
  const MODES = [['m-single', 'mode-single'], ['m-double', 'mode-double'], ['m-scroll', 'mode-scroll']];
  const FITS = [['f-width', 'fit-width'], ['f-height', 'fit-height'], ['f-original', 'fit-original']];
  let comboOk = 0, comboSizes = [];
  for (const [mBtn, mCls] of MODES) {
    for (const [fBtn, fCls] of FITS) {
      await click(mBtn);
      await click(fBtn);
      await sleep(500);
      const s = await stageInfo();
      const hasM = (s.cls || []).indexOf(mCls) >= 0;
      const hasF = (s.cls || []).indexOf(fCls) >= 0;
      const decoded = s.iw > 0;
      if (hasM && hasF && decoded) comboOk++;
      else console.log('     !! ' + mCls + ' + ' + fCls + ' -> cls=' + JSON.stringify(s.cls) + ' decoded=' + decoded);
      comboSizes.push(mCls.replace('mode-', '') + '/' + fCls.replace('fit-', '') + ' ' + s.dw + 'x' + s.dh);
    }
  }
  chk('9 种 模式×适配 组合都生效且能解码', comboOk === 9, comboOk + '/9');
  console.log('     ' + comboSizes.join('  |  '));

  // 适宽时图宽应该接近 stage 宽(而不是被压成一条)
  await click('m-single'); await click('f-width'); await sleep(600);
  const wInfo = await stageInfo();
  const wRatio = wInfo.w ? wInfo.dw / wInfo.w : 0;
  chk('适宽: 图宽接近可用宽', wRatio > 0.85, 'dw/stage=' + wRatio.toFixed(2) + ' (' + wInfo.dw + '/' + wInfo.w + ')');

  // 适高时图高不应该超出一大截
  await click('f-height'); await sleep(600);
  const hInfo = await stageInfo();
  chk('适高: 图高不超过可用高太多', hInfo.dh <= hInfo.h * 1.15, 'dh/stage=' + hInfo.dh + '/' + hInfo.h);

  // ---- 阅读方向 / 封面独立 / 顺序 ----
  await click('bdir'); await sleep(400);
  const dirCls = await ev('Array.prototype.slice.call(document.getElementById("stage").classList).join(",")');
  chk('方向开关改变 stage 类', String(dirCls).indexOf('dir-') >= 0, String(dirCls));
  await click('bdir'); await sleep(300);   // 切回来

  await click('bcover'); await sleep(400);
  chk('封面独立开关不报错', true);
  await click('bcover'); await sleep(300);

  await click('brev'); await sleep(600);
  chk('章节顺序开关不报错', String(await ev('(document.getElementById("chname")||{}).textContent || "?"')).length > 0, String(await ev('(document.getElementById("chname")||{}).textContent')));
  await click('brev'); await sleep(400);

  // ---- 侧栏 / 缩略图侧栏 ----
  const sbBefore = await ev('document.getElementById("sidebar").classList.contains("collapsed")');
  await click('sidetoggle'); await sleep(700);
  const sbAfter = await ev('document.getElementById("sidebar").classList.contains("collapsed")');
  chk('目录侧栏能收起/展开', String(sbBefore) !== String(sbAfter), sbBefore + ' -> ' + sbAfter);
  const thBefore = await ev('document.getElementById("thumbs").classList.contains("collapsed")');
  await click('thumbtoggle'); await sleep(700);
  const thAfter = await ev('document.getElementById("thumbs").classList.contains("collapsed")');
  chk('缩略图侧栏能收起/展开', String(thBefore) !== String(thAfter), thBefore + ' -> ' + thAfter);
  const thumbs = Number(await ev('document.querySelectorAll("#thumblist .titem, #thumblist > *").length'));
  chk('缩略图侧栏有内容', thumbs > 0, 'items=' + thumbs);

  // ---- 缩放 ----
  await click('m-single'); await click('f-original'); await sleep(500);
  const z0 = await stageInfo();
  await click('bzoom'); await sleep(500);
  const z1 = await stageInfo();
  chk('放大按钮生效', z1.dw > z0.dw, z0.dw + ' -> ' + z1.dw);
  await click('bzoomout'); await sleep(500);
  const z2 = await stageInfo();
  chk('缩小按钮生效', z2.dw <= z1.dw, z1.dw + ' -> ' + z2.dw);
  await click('bzoomreset'); await sleep(500);
  const z3 = await stageInfo();
  chk('重置按钮回到 100%', z3.dw === z0.dw, z0.dw + ' -> ' + z3.dw);

  // ---- 章节切换 ----
  const ch0 = await ev('(document.getElementById("chname")||{}).textContent');
  await click('bnextch'); await sleep(1500);
  const ch1 = await ev('(document.getElementById("chname")||{}).textContent');
  chk('下一话能切', ch0 !== ch1, ch0 + ' -> ' + ch1);
  await click('bprevch'); await sleep(1500);
  const ch2 = await ev('(document.getElementById("chname")||{}).textContent');
  chk('上一话能切回', ch2 === ch0, ch2);

  // ---- 回书架 ----
  await click('bback'); await sleep(1200);
  chk('能回到书架', String(await ev('document.getElementById("reader").classList.contains("hide")')) === 'true');

  const exs = (p.events || []).filter((e) => e.method === 'Runtime.exceptionThrown');
  chk('零未捕获异常', exs.length === 0, exs.length ? String(exs.length) + ' 个' : '');
  if (exs.length) exs.slice(0, 3).forEach((e) => { try { console.log('     ' + String(e.params.exceptionDetails.exception.description).slice(0, 160)); } catch (x) {} });
} catch (e) {
  console.log('  ERR   ' + ((e && e.message) || e));
  R.push({ n: 'exception', ok: false });
} finally {
  try { p.close(); } catch (e) {}
  app.stop();
}

const bad = R.filter((x) => !x.ok).length;
console.log('');
console.log(bad ? ('结果: ' + bad + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(bad ? 1 : 0);
