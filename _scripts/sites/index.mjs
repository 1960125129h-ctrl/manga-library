// 站点适配器注册表: 每个站点一个模块, 实现 match/resolve/chapters/download
import * as xmanhua from './xmanhua.mjs';
import * as zaimanhua from './zaimanhua.mjs';
import * as komiic from './komiic.mjs';
import * as pixiv from './pixiv.mjs';
import * as nhentai from './nhentai.mjs';
import * as x from './x.mjs';
import * as douyin from './douyin.mjs';
import * as weibo from './weibo.mjs';
import * as ehentai from './ehentai.mjs';
export const ADAPTERS = [xmanhua, zaimanhua, komiic, pixiv, nhentai, x, douyin, weibo, ehentai];
export { pixiv };
export function pick(url) {
  const u = String(url || '');
  for (const a of ADAPTERS) { try { if (a.match(u)) return a; } catch (e) {} }
  return null;
}
export function ids() { return ADAPTERS.map(function (a) { return a.id; }).join(', '); }