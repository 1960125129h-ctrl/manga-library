// 从已登录的调试浏览器里一键刷新 cookie(不用重新登录)
// 用法: node _scripts\jm\grab-cookies.mjs e-hentai.org [更多域名...]
const { openPage } = await import('./cdp.mjs');
const { saveCookies } = await import('../sites/cookies.mjs');
const hosts = process.argv.slice(2).filter((s) => s && s.charAt(0) !== '-');
if (!hosts.length) { console.log('用法: node _scripts\\jm\\grab-cookies.mjs <域名> [更多域名]'); console.log('例:   node _scripts\\jm\\grab-cookies.mjs e-hentai.org exhentai.org'); process.exit(1); }
const p = await openPage(Number(process.env.JM_PORT || 9333));
await p.send('Network.enable').catch(() => {});
const ck = await p.send('Network.getCookies', { urls: hosts.map((h) => 'https://' + h + '/') });
const list = (ck && ck.cookies) || [];
for (const h of hosts) {
  const bare = h.replace(/^www\./, '');
  const got = list.filter((c) => String(c.domain).indexOf(bare) >= 0);
  if (!got.length) { console.log(h + ' → 浏览器里没有这个站的 cookie（先在调试浏览器里登录一次）'); continue; }
  const str = got.map((c) => c.name + '=' + c.value).join('; ');
  console.log(h + ' → ' + got.length + ' 条 (' + got.map((c) => c.name).join(',') + ')');
  console.log('   已写入 ' + saveCookies(bare, str));
}
p.close();
