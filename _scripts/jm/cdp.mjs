
import fs from 'node:fs';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function openPage(port = Number(process.env.JM_PORT || 9333), targetId = null) {
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const target = targetId
    ? list.find(t => t.id === targetId)
    : list.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!target) throw new Error('no page target' + (targetId ? ' id=' + targetId : ''));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method) { events.push(m); if (events.length > 3000) events.splice(0, 1000); }
  };
  const send = (method, params) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  await send('Page.enable');
  await send('Runtime.enable');
  const ev = async (expr, tries = 6) => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('page-exc: ' + JSON.stringify(r.exceptionDetails.exception && (r.exceptionDetails.exception.description || r.exceptionDetails.exception.value)));
        return r.result && r.result.value;
      } catch (e) { lastErr = e; await sleep(1500); }
    }
    throw lastErr;
  };
  const goto = async (url, maxWaitMs = 60000) => {
    const t0 = Date.now();
    while (true) {
      try { await send('Page.navigate', { url }); } catch (e) {}
      while (Date.now() - t0 < maxWaitMs) {
        await sleep(1500);
        let t = '';
        try { t = String(await ev('document.title', 2) || ''); } catch (e) { continue; }
        if (t && !/Just a moment|请稍候|Checking|Attention Required/i.test(t) && String(await ev('document.readyState', 2)) === 'complete') return t;
      }
      // retry navigate once more after a challenge stall
    }
  };
  return { send, ev, goto, events, close: () => { try { ws.close(); } catch {} }, port };
}
/* ================= 页面准备: 关弹窗 / 过 18+ / 登录 ================= */
export async function humanClick(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none' });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', clickCount: 1 });
}

/* 只关弹窗/广告(每次导航后调用) */
export async function closePopups(page) {
  // 只处理已知的公告框, 绝不再乱点 .close(那会点到广告)
  try {
    const s1 = await page.ev('JSON.stringify((function(){var n=0;var ids=["billboard-modal"];for(var i=0;i<ids.length;i++){var m=document.getElementById(ids[i]);if(!m||!m.offsetWidth)continue;var b=m.querySelector("[data-dismiss=modal], button.close");if(b&&b.offsetWidth>0){b.click();n++;}}return n;})())');
    return JSON.parse(s1) || 0;
  } catch (e) { return 0; }
}
/* 等元素真正可见(拿到非零坐标), 返回中心点 */
export async function waitRect(page, sel, tries) {
  const n = tries || 20;
  for (let i = 0; i < n; i++) {
    const r = JSON.parse(await page.ev('JSON.stringify((function(){var e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;var b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height,v:(e.value||"")};})())'));
    if (r && r.w > 2 && r.h > 2) return r;
    await new Promise((s) => setTimeout(s, 400));
  }
  return null;
}
/* 进门三步: 18岁验证 -> Confirm Entry -> 公告 Close(没有就跳过); 每步都用真实鼠标点 */
export async function passEntryGate(page, log) {
  const say = log || (() => {});
  const STEPS = [
    { sel: '#chk_cover', name: '18 岁验证' },
    { sel: '#chk_guide', name: '确认进入(Confirm Entry)' },
    { sel: '#chk_cover3', name: '公告关闭(Close)', optional: true },
  ];
  const done = {};
  for (let round = 1; round <= 3; round++) {
    let acted = false;
    for (const st of STEPS) {
      if (done[st.sel]) continue;
      const r = await waitRect(page, st.sel, 4);
      if (!r) { if (st.optional) done[st.sel] = 'none'; continue; }
      await humanClick(page, r.x, r.y);
      done[st.sel] = 'clicked';
      say('[进门] 已点: ' + st.name + ' (' + st.sel + ')');
      acted = true;
      await new Promise((s2) => setTimeout(s2, 900));
      if (st.optional) {
        for (let k = 0; k < 2; k++) {   // 公告可能点一次不关, 再补两下
          const again = await waitRect(page, st.sel, 2);
          if (!again) break;
          await humanClick(page, again.x, again.y);
          await new Promise((s2) => setTimeout(s2, 700));
        }
        const still = await waitRect(page, st.sel, 2);
        if (still) {
          const hid = await page.ev('(function(){var b=document.querySelector(' + JSON.stringify(st.sel) + ');if(!b)return 0;var m=b.closest(".modal, .modal-dialog, [class*=popup], [class*=overlay]");if(m){m.style.display="none";return 1;}return 0;})()');
          say('[进门] 公告按钮仍在, ' + (hid ? '已隐藏它的弹窗容器' : '暂时忽略'));
        }
      }
    }
    if (!acted) break;
  }
  const skipped = STEPS.filter((x) => done[x.sel] === 'none').map((x) => x.name);
  if (skipped.length) say('[进门] 未检测到(直接跳过): ' + skipped.join('、'));
  return done;
}

/* 兼容旧名字 */
export async function passAgeGate(page, log) { return await passEntryGate(page, log); }
/* 登录: 点入口 -> 真实鼠标点用户名框(触发浏览器已保存账号自动填充) -> 提交 */
export async function ensureLogin(page, log) {
  const say = log || (() => {});
  const logged = async () => { try { return await page.ev('/(?:退出|登出)/.test(document.body.innerText)'); } catch (e) { return false; } };
  if (await logged()) return 'already';
  let opened = 'no-entry';
  for (let i = 0; i < 12; i++) {   // 页面可能还没渲染完, 最多找 12 秒
    opened = await page.ev('(function(){var as=document.querySelectorAll("a");for(var i=0;i<as.length;i++){if(as[i].getAttribute("href")==="#login-modal"){as[i].click();return "opened";}}return "no-entry";})()');
    if (opened === 'opened') break;
    await new Promise((s2) => setTimeout(s2, 1000));
  }
  if (opened !== 'opened') return 'no-entry(页面上没找到登录入口)';
  await new Promise((s) => setTimeout(s, 1200));
  const box = await waitRect(page, '#login_username_');
  if (!box) return 'no-form(登录框没显示出来)';
  if (!box.u || !box.p) {
    await humanClick(page, box.x, box.y);
    await new Promise((s) => setTimeout(s, 1500));
    const v = JSON.parse(await page.ev('JSON.stringify((function(){return {u:((document.getElementById("login_username_")||{}).value||""),p:((document.getElementById("login_password")||{}).value||"")};})())'));
    if (!v.u || !v.p) {
      try {
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 40, key: 'ArrowDown', code: 'ArrowDown' });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 40, key: 'ArrowDown', code: 'ArrowDown' });
        await new Promise((s2) => setTimeout(s2, 300));
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
        await new Promise((s2) => setTimeout(s2, 1200));
      } catch (e) {}
      const v2 = JSON.parse(await page.ev('JSON.stringify((function(){return {u:((document.getElementById("login_username_")||{}).value||""),p:((document.getElementById("login_password")||{}).value||"")};})())'));
      if (!v2.u || !v2.p) return 'need-manual';   // 交给你在窗口里手填
    }
  }
  const btn = await waitRect(page, '#login-modal button.login_submit');
  if (!btn) return 'no-submit(找不到登录按钮)';
  await humanClick(page, btn.x, btn.y);
  for (let i = 0; i < 12; i++) { await new Promise((s) => setTimeout(s, 1000)); if (await logged()) return 'ok'; }
  return 'failed';
}

/* 一次做完: 关弹窗 -> 过 18+ -> (可选)登录 */
export async function preparePage(page, opts) {
  const o = opts || {};
  const say = o.log || (() => {});
  const k = await closePopups(page);
  if (k) say('[页面] 关闭弹窗 ' + k + ' 个');
  const age = await passEntryGate(page, say);
  if (o.login === false) return { popups: k, age: age };
  const st = await ensureLogin(page, say);
  say('[页面] 登录状态: ' + st);
  return { popups: k, age: age, login: st };
}