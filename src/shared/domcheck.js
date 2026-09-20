// DOM id 撞车检测
//
// 为什么要有它
// ----------
// 界面里新建组件时复用了一个已经存在的 id, 浏览器不会报错 —— 它只会让
// querySelector / getElementById 拿到"先出现的那个", 于是新组件的样式和事件
// 全都作用到了旧元素上。表现出来就是"属性栏跑到别的地方去了""按钮点了没反应"。
// 工程记录里就中过这个: 三处新建的按钮栏复用了 id="mfoot"。
//
// 这类错误光看代码很难发现(要记住全项目所有 id), 所以用运行时检测兜住。

// 扫描重复 id。返回 [{ id, count, where }]
export function findDuplicateIds(root) {
  const scope = root || document;
  const map = new Map();
  let els = [];
  try { els = scope.querySelectorAll('[id]'); } catch (e) { return []; }
  for (const el of els) {
    const id = el.id;
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(el);
  }
  const dups = [];
  map.forEach((list, id) => {
    if (list.length > 1) {
      dups.push({
        id: id,
        count: list.length,
        where: list.slice(0, 3).map((e) => {
          const cls = String(e.className || '').trim().split(/\s+/).slice(0, 2).join('.');
          return e.tagName.toLowerCase() + (cls ? '.' + cls : '');
        }).join(' / ')
      });
    }
  });
  return dups;
}

// 自动巡检: 界面变动后(节流)扫一次, 发现重复 id 就警告。
// 只在真出问题时才输出, 平时静默(不然控制台会被刷满)。
// warn 去重: 同一个 id 反复出现只报一次, 免得滚动/翻页时刷屏。
export function watchDuplicateIds(opts) {
  const o = opts || {};
  const gap = o.debounce || 1500;
  const seen = new Set();
  let t = null;
  const run = () => {
    t = null;
    let dups = [];
    try { dups = findDuplicateIds(document); } catch (e) { return; }
    dups.forEach((d) => {
      const key = d.id;
      if (seen.has(key)) return;
      seen.add(key);
      console.warn('[id 撞车] "' + d.id + '" 出现了 ' + d.count + ' 次（' + d.where + '）'
        + ' —— getElementById/querySelector 只会拿到第一个, 新组件的样式与事件会作用到旧元素上。'
        + ' 给新组件换个 id, 或改用 class。');
    });
  };
  try {
    const mo = new MutationObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(run, gap);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(run, 800);   // 首次渲染后先扫一遍
    return () => { try { mo.disconnect(); } catch (e) {} if (t) clearTimeout(t); };
  } catch (e) { return () => {}; }
}
