// 禁漫目标归一化: JM1452133 / jm1452133 / 纯数字 / 专辑链接 / 单话链接 / 无协议域名 -> 标准 URL
// 只认编号的好处: 站点换镜像域名(.vip/.org/...)也照样能下
export const JM_BASE = (process.env.JM_BASE || 'https://18comic.vip').replace(/\/+$/, '');
export function normTarget(a) {
  const s = String(a == null ? '' : a).trim().replace(/^["'<>()\[\],、;；]+|["'<>()\[\],、;；]+$/g, '');
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  let m;
  if ((m = s.match(/^(?:jm[\s_-]*)?(\d{4,})$/i))) return JM_BASE + '/album/' + m[1] + '/';
  if ((m = s.match(/(?:^|\/)(album|photo)\/(\d+)/i))) return JM_BASE + '/' + m[1].toLowerCase() + '/' + m[2];
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(s)) return 'https://' + s;
  return null;
}
export function normTargets(arr) {
  const out = [], seen = new Set();
  for (const a of (arr || [])) {
    const u = normTarget(a);
    if (!u || seen.has(u)) continue;
    seen.add(u); out.push(u);
  }
  return out;
}
