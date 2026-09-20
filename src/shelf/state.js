// 书架的状态
//
// 这几个的共同点: **会被整体重新赋值**(比如 SEL = [] 清空选择),
// 所以不能用 "let X = ctx.X" 注入 —— 那只会拿到快照, core 之后改了就不同步。
// 由本模块持有, core 那边要用就 setter 改。
//
// 只赋值一次的(COMICS / GROUP_DIM_* / SORT_ITEMS / el* 那些)不在这里,
// 它们在 core 里按值注入即可。

export let SEL = [];                 // 多选: 已选中的 dir 列表
export let SEARCH_HAY = null;         // 搜索用的预拼接字符串缓存
export let BOOKTIMES = {};            // dir -> 目录修改时间(桌面版提供)
export let justDraggedUntil = 0;      // 拖拽刚结束的一小段时间内忽略 click
export let CARD_CACHE = {};           // dir -> DOM 卡片(筛选时复用, 不重建)
export let cardSeq = 0;
export let dragCat = null;            // 正在拖的分类名

export function setSel(v) { SEL = v; }
export function setSearchHay(v) { SEARCH_HAY = v; }
export function setBookTimes(v) { BOOKTIMES = v; }
export function setJustDraggedUntil(v) { justDraggedUntil = v; }
export function setCardCache(v) { CARD_CACHE = v; }
export function setCardSeq(v) { cardSeq = v; }
// 原来写的是 cardSeq++(自增也是赋值, 导入的绑定不能这么写), 这里保留后置语义: 返回旧值
export function incCardSeq() { const v = cardSeq; cardSeq = cardSeq + 1; return v; }
export function setDragCat(v) { dragCat = v; }
