// 调试浏览器（CDP 9333/9334）的标签复用工具 —— 各站点适配器共用。
//
// 背景：以前每个适配器都是 openPage() 随便挑一个 page 再 Page.navigate。
// 挑到的可能正是你看着的那一页，也可能是 chrome://newtab，
// 表现出来就是「我看的那页被顶掉 / 同一个页面又在别处开一遍」。
//
// 现在统一走这里：按 URL 找已经开着的那一页 → 就地用；确实没有才借一个空白标签，
// 而且只关「自己临时开出来的」那一个，你的标签一个都不动。

export const PORT = Number(process.env.JM_PORT || 9333);
const BLANK = /^(about:blank|chrome:\/\/newtab|edge:\/\/newtab|chrome:\/\/startup|edge:\/\/startup)/i;

/* 比 URL 用的归一化：去掉 hash、query、尾斜杠，统一小写。
   query 一律不算 —— 同一个页面带不带 ?p=2 都是同一个页面。 */
export function normUrl(s) {
  return String(s || '').replace(/#.*$/, '').replace(/\?.*$/, '').replace(/\/+$/, '').toLowerCase();
}

/* extra：额外的"算不算同一页"判定（比如 /note/<id> 与 /video/<id> 视为同一页） */
export function sameTab(a, b, extra) {
  const x = normUrl(a), y = normUrl(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (typeof extra === 'function') { try { return !!extra(x, y); } catch (e) { return false; } }
  return false;
}

export async function listPages() {
  try {
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    return (list || []).filter((t) => t.type === 'page');
  } catch (e) { return []; }
}

export async function findOpenTab(url, extra) {
  const pages = await listPages();
  return pages.find((t) => sameTab(t.url, url, extra)) || null;
}

export async function newTab() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
  return await r.json();
}

export async function closeTab(id) {
  if (!id) return;
  try { await fetch('http://127.0.0.1:' + PORT + '/json/close/' + encodeURIComponent(id)); } catch (e) {}
}

/* 这次该用哪个标签：
     tabId    给 openPage(PORT, tabId) 用
     reused   true = 就是你开着的那一页，别再 navigate（大概率也读得到现成数据）
     created  非空 = 我们自己临时开的，用完必须关
   一个都不剩（连空白页都没有且开不出新标签）时 tabId 为空，调用方退回 openPage() 默认行为。 */
export async function pickTarget(url, extra) {
  const opened = await findOpenTab(url, extra);
  if (opened) return { tabId: opened.id, reused: true, created: '' };
  const blank = (await listPages()).find((t) => BLANK.test(String(t.url || '')));
  if (blank) return { tabId: blank.id, reused: false, created: '' };
  try { const t = await newTab(); return { tabId: t.id, reused: false, created: t.id }; }
  catch (e) { return { tabId: '', reused: false, created: '' }; }
}
