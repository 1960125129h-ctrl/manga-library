// 登录态公共能力: 每个站点的 cookie 存一个文件, 适配器按域名取用
// 文件位置: _scripts/sites/cookies/<host>.txt   (由 node _scripts\jm\site-login.mjs <站点> 抓取)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'cookies');
export function hostOf(url) {
  try { return new URL(String(url)).host.replace(/^www\./, ''); } catch (e) { return String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''); }
}
export function cookieFile(host) { return path.join(DIR, host + '.txt'); }
export function cookiesFor(host) {
  try { return fs.readFileSync(cookieFile(host), 'utf8').trim(); } catch (e) { return ''; }
}
export function cookieHeader(host) {
  const ck = cookiesFor(host);
  return ck ? { Cookie: ck } : {};
}
export function saveCookies(host, str) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(cookieFile(host), String(str || ''), 'utf8');
  return cookieFile(host);
}
export function hasLogin(host) {   // 粗略判断: 有 token/session 之类的 cookie 就算登录了
  const ck = cookiesFor(host);
  return /(token|session|auth|passport|remember|login|member|user|uid|key)/i.test(ck);
}
export function cookieNames(host) {
  return cookiesFor(host).split(/;\s*/).map((c) => c.split('=')[0]).filter(Boolean);
}
