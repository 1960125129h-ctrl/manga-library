// 工作台的筛选 —— 纯函数, 不碰 DOM, 不碰全局状态
//
// 单独一个文件是为了能直接单测: verify-ref.mjs 里喂数据进来断言结果,
// 不需要起 App。筛选是最容易写错的一块(边界、大小写、空值), 值得单独隔离。

// 一张图能不能过当前筛选
export function matchImage(img, q, opts) {
  const o = opts || {};
  if (o.onlyFav && !img.fav) return false;
  if (!q) return true;
  const hay = [
    img.author, img.work, img.char, img.note,
    (img.tags || []).join(' '),
    (img.label || ''),
  ].join(' ').toLowerCase();
  // 空格分词, 全部命中才算(和书架搜索的手感一致)
  const parts = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  for (const p of parts) if (hay.indexOf(p) < 0) return false;
  return true;
}

const cmpRecent = (a, b) => (b.addedAt || 0) - (a.addedAt || 0);
const cmpBook = (a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'zh');
const cmpAuthor = (a, b) => String(a.author || '~').localeCompare(String(b.author || '~'), 'zh') || cmpRecent(a, b);

// 筛选 + 排序。alive 由调用方注入(它需要查书库, 不是纯逻辑)
export function applyFilter(images, q, opts) {
  const o = opts || {};
  const out = [];
  for (const img of images) {
    if (o.onlyAlive && o.isAlive && !o.isAlive(img)) continue;
    if (!matchImage(img, q, o)) continue;
    out.push(img);
  }
  const by = o.sort || 'recent';
  out.sort(by === 'book' ? cmpBook : by === 'author' ? cmpAuthor : cmpRecent);
  return out;
}

// 统计各维度都有哪些值(给筛选下拉用), 按出现次数降序
export function facets(images) {
  const f = { author: {}, work: {}, char: {}, tag: {} };
  const bump = (bucket, k) => { if (!k) return; f[bucket][k] = (f[bucket][k] || 0) + 1; };
  for (const im of images) {
    bump('author', im.author); bump('work', im.work); bump('char', im.char);
    for (const t of (im.tags || [])) bump('tag', t);
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));
  return { author: top(f.author), work: top(f.work), char: top(f.char), tag: top(f.tag) };
}
