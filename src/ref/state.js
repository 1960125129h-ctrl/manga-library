// 工作台的界面状态
//
// 只有数据, 不碰 DOM, 不依赖任何别的模块 —— 所以它永远可以被单独 import 来做判断。
// 和娱乐模式的关系: 这边的状态**完全独立**, 不进 app/state.js 的 S。
// (S 已经被 19 个模块依赖了, 再往里塞工作台的东西会把改动面放大到全项目)

export const W = {
  mode: 'shelf',      // 'shelf' | 'workbench'   当前哪个模式
  view: 'wall',       // 'wall' | 'inbox' | 'board'   工作台里的哪个视图
  boardId: '',        // 当前参考板(空 = 默认板)

  q: '',              // 搜索词(匹配 作者/作品/角色/标签/书名)
  onlyFav: false,     // 只看收藏
  onlyAlive: true,    // 隐藏悬空引用(原书已删)
  sort: 'recent',     // recent | book | author

  sel: [],            // 选中的图 id(画板/批量操作用)
  wallLoaded: 0,      // 图墙已经铺了多少张(无限滚动往里加)

  // ---- 画板 ----
  // 视口: 画板是一块无限画布, 所有图都用一个 transform 承载 "随便摆"
  btx: 0, bty: 0, bk: 1,     // translate x/y + scale
  bFlip: false,              // 整板水平镜像(查对称用)
  bGray: false,              // 整板去色(查明度关系用)
  bTop: -1,                  // 选中图的 z(置顶用)
};

export const WALL_STEP = 120;   // 每次多铺多少张

// 改了要重画的时候由界面层调(或者直接读 W) —— 这里只放最简单的订阅, 避免过度设计
const subs = [];
export function onChange(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; }
export function touch() { for (const fn of subs) { try { fn(); } catch (e) {} } }

export function setMode(m) { if (W.mode === m) return; W.mode = m; touch(); }
export function setView(v) { if (W.view === v) return; W.view = v; touch(); }
export function resetWall() { W.wallLoaded = 0; }
export function moreWall() { W.wallLoaded += WALL_STEP; touch(); }
export function toggleSel(id) {
  const i = W.sel.indexOf(id);
  if (i >= 0) W.sel.splice(i, 1); else W.sel.push(id);
  touch();
}
export function clearSel() { if (W.sel.length) { W.sel = []; touch(); } }
export const isSel = (id) => W.sel.indexOf(id) >= 0;
