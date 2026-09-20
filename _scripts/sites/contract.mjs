// 适配器契约校验
//
// 为什么要有这个文件
// ----------------
// 适配器的返回值一直是"隐式契约": 前端和下载端按字段名去取, 少一个字段不会报错,
// 而是**静默失效**。抖音作者页那次就是实例:
//   tagGalleries 没给 gid/url -> 前端拼出空的 pickStr -> 后端按 want[g.gid]||want[g.url] 筛
//   -> 筛完是空 -> 界面表现成"勾了没反应", 全程零错误信息。
//
// 校验原则
// --------
//   · 影响"能不能找到 / 能不能下载"的字段(gid, url, 图片地址)缺失 -> 抛错, 带站点+序号+字段名
//   · 只影响"显示好不好看"的字段(title, thumb)缺失 -> 补安全默认值 + 打一行警告
//   宁可吵, 不要静默。

const log = (s) => { try { console.log('[契约] ' + s); } catch (e) {} };

function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === '';
}
// 判断一个值能不能当"标识"用: 空串 / "undefined" / "null" 都不算
// (适配器里常见 String(x.id) 这种写法, x.id 缺失时会变成字符串 "undefined")
function usableKey(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return (s && s !== 'undefined' && s !== 'null') ? s : '';
}
function short(v) {
  const s = String(v === undefined ? 'undefined' : v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}
// 拼一条能直接照着修的错: 站点 / 哪个返回值 / 第几项 / 缺什么 / 缺了会怎样
function violation(site, what, index, field, why) {
  const e = new Error('[' + site + '] ' + what + ' 第 ' + (index + 1) + ' 项缺字段 "' + field + '"' + (why ? '：' + why : '') + '（适配器返回值不符合契约）');
  e.contract = true;
  return e;
}

// resolve() -> { title, author, desc, cover, ... }
export function checkMeta(meta, site) {
  const m = (meta && typeof meta === 'object') ? meta : {};
  const out = Object.assign({}, m);
  if (isEmpty(out.title)) { log(site + ' resolve() 没给 title，已用"(未命名)"占位'); out.title = '(未命名)'; }
  return out;
}

// chapters() -> [{ id, title, index, order, group? }]
export function checkChapters(list, site) {
  if (!Array.isArray(list)) {
    const e = new Error('[' + site + '] chapters() 必须返回数组，实际是 ' + typeof list + '（适配器返回值不符合契约）');
    e.contract = true;
    throw e;
  }
  return list.map((c, i) => {
    if (!c || typeof c !== 'object') throw violation(site, 'chapters()', i, '(整个对象)', '不是对象');
    const o = Object.assign({}, c);
    // 目录名要靠 title; id 用于"已下载"判定。两个都不可用就没法用
    if (!usableKey(o.title) && !usableKey(o.id)) throw violation(site, 'chapters()', i, 'title/id', '两个都空, 这一话既没法命名也没法判重');
    if (!usableKey(o.title)) { const k = usableKey(o.id); log(site + ' chapters() 第 ' + (i + 1) + ' 项没给 title，已用 id 代替（' + short(k) + '）'); o.title = k; }
    return o;
  });
}

// tagGalleries() -> [{ gid, url, title, thumb?, ... }]
// gid/url 是硬要求: 前端拼勾选串用它们, 下载端 runTagBatch 也按它们筛
export function checkGalleries(list, site) {
  if (!Array.isArray(list)) {
    const e = new Error('[' + site + '] tagGalleries() 必须返回数组，实际是 ' + typeof list + '（适配器返回值不符合契约）');
    e.contract = true;
    throw e;
  }
  return list.map((g, i) => {
    if (!g || typeof g !== 'object') throw violation(site, '作品列表', i, '(整个对象)', '不是对象');
    if (isEmpty(g.gid)) throw violation(site, '作品列表', i, 'gid', '前端按它拼勾选串, 缺了会表现成"勾了没反应"');
    if (isEmpty(g.url)) throw violation(site, '作品列表', i, 'url', '下载端按它定位作品, 缺了勾中的也筛不出来');
    const o = Object.assign({}, g);
    if (isEmpty(o.title)) { log(site + ' 作品列表第 ' + (i + 1) + ' 项没给 title，已用 gid 代替（' + short(o.gid) + '）'); o.title = String(o.gid); }
    return o;
  });
}

// images() -> [ "url" | { url, headers?, alts?, gif?, pageNum? } ]
// 空数组是合法的(这一话没图, 上层会跳过); 但"有元素却没有可用地址"一定是适配器 bug
export function checkImages(list, site, label) {
  if (!Array.isArray(list)) {
    const e = new Error('[' + site + '] images() 必须返回数组，实际是 ' + typeof list + '（适配器返回值不符合契约）');
    e.contract = true;
    throw e;
  }
  if (!list.length) return list;
  const out = [];
  const bad = [];
  list.forEach((u, i) => {
    const obj = (typeof u === 'string') ? { url: u } : (u && typeof u === 'object' ? u : null);
    if (!obj) { bad.push(i); return; }
    // 动图走 gif 字段(mp4), 但 url 仍要留着当兜底封面
    if (isEmpty(obj.url) && isEmpty(obj.gif)) { bad.push(i); return; }
    if (isEmpty(obj.url)) obj.url = obj.gif;
    out.push(u);
  });
  const where = label ? (' (' + label + ')') : '';
  if (!out.length) {
    // 一个可用的都没有 —— 这不是"站点偶尔缺一条", 是适配器取错了字段。
    // 继续走下去只会得到一个空目录, 所以直接停。
    const e = new Error('[' + site + '] images()' + where + ' 返回了 ' + list.length + ' 项, 但没有一项带可用图片地址 —— 多半是适配器取错了字段（适配器返回值不符合契约）');
    e.contract = true;
    throw e;
  }
  if (bad.length) {
    // 少数几条缺地址: 站点数据本身可能有脏项, 不该拦整话, 但要说清楚跳过了几条
    // (只跳过不拦, 是为了不把"原来能下、只是缺一张"的情况变得更糟)
    log(site + ' images()' + where + ' 有 ' + bad.length + '/' + list.length + ' 项没有可用地址, 已跳过（第 ' + bad.slice(0, 5).map((i) => i + 1).join(',') + (bad.length > 5 ? '…' : '') + ' 项）');
  }
  return out;
}
