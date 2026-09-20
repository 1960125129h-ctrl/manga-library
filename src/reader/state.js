// 阅读器的运行时状态
//
// 从 core.js 的 IIFE 闭包里搬出来的。共同点: **会被整体重新赋值**
// (comic = c / io = null / lastThumbSync = now / wheelAcc += ...)。
// 这类变量不能按值注入给别的模块 —— 那样注入的只是快照; 也不能在别的模块里
// 给 import 进来的绑定赋值 —— 那是 TypeError。所以由本模块持有, 改走 setter,
// 读直接读(ES 模块的绑定是实时的)。
//
// 只赋值一次的(elReader / elStage / S ...)不在这里, 它们按值注入或留在 core 即可。

// ---- 当前打开的书 ----
// comic 是"阅读器开着没有"的总开关, 全库 50 多处读它, 只有 openComic/closeComic 写它。
export let comic = null;

// ---- 滚动模式的懒加载观察器 ----
export let io = null;

// ---- 缩放画布层 ----
// 用一个 translate 承载"随便拖", 不靠滚动条; 每次 render 重建。
export let elCanvas = null;

// ---- 鼠标侧键"前进"历史 ----
// 后退(3)=返回书架, 前进(4)=回到刚才那本书; 顺便屏蔽浏览器历史后退。
// 只动 length/push/pop(属性操作), 所以不需要 setter。
export let NAVFWD = [];

// ---- 翻页预取 ----
// 预取后面两页, 翻页时不等网络。只做键读写, 不需要 setter。
export let preloaded = {};

// ---- 侧栏缩略图 ----
export let lastThumbSync = 0;   // 上次同步"当前页"高亮的时间(节流用)
export let thumbRaf = 0;        // 滚到正中的 rAF id(要能取消上一次动画)

// ---- 右键滚轮缩放 / 右键拖动平移 ----
export let rightDown = false;
export let zoomRetryN = 0;      // 图没解码时的重试计数(防止无限重试)
export let zoomRetryT = 0;      // 重试定时器

// ---- 普通滚轮翻页 ----
export let wheelAcc = 0;        // 累积量: 行滚动的浏览器换算成像素后再判方向
export let wheelLock = 0;       // 翻页冷却时间戳(连滚更跟手)

export function setComic(v) { comic = v; }
export function setIo(v) { io = v; }
export function setElCanvas(v) { elCanvas = v; }
export function setLastThumbSync(v) { lastThumbSync = v; }
export function setThumbRaf(v) { thumbRaf = v; }
export function setRightDown(v) { rightDown = v; }
export function setZoomRetryN(v) { zoomRetryN = v; }
export function setZoomRetryT(v) { zoomRetryT = v; }
export function setWheelAcc(v) { wheelAcc = v; }
export function setWheelLock(v) { wheelLock = v; }
