// 应用级共享状态
//
// 从 core.js 的 IIFE 闭包里搬出来的。能直接搬的原因: 这些变量**只在声明时赋值一次**,
// 之后只改属性(S.xxx = ...)。ES 模块的绑定是实时的, 所以用它们的代码一行都不用改。
//
// 注意: 有"整体重新赋值"的变量不能这么搬(不能给 import 进来的绑定赋值),
// 那些要么在模块内提供 setter, 要么留在 core 里。

// 阅读器 + 书架的界面状态(S.ci 当前话 / S.pi 当前页 / S.filter 分类筛 ...)
export const S = { ci: 0, pi: 0, mode: "single", fit: "height", dir: "ltr", cover: true, sidebar: true, wheel: true, zoom: false, zscale: 1, scale: 1, tx: 0, ty: 0, thumbs: false, sort: "recent", groups: [], q: "", filter: "all", authors: [], plats: [], ratings: [], plat: "", author: "", rating: "", theme: "dark", bright: 1, authOpen: false, platOpen: false, album: "" };

// library.json 的内容(整库元数据)。它是**异步填进来的**(DISK.getAll), 所以不能"按值注入"给别的模块
// —— 那样注入的会是 null 快照。放在这里用实时绑定, 谁用谁拿到最新的。
export let LIBRARY = null;
export function setLIBRARY(v) { LIBRARY = v; }

// 书架网格容器(很多地方要用它的 scrollTop)
export const elGrid = document.getElementById("grid");
// 书库根目录(桌面版启动时从主进程的配置里拿)。它和 LIBRARY 一样是**异步填进来的**,
// 所以也不能按值注入给别的模块 —— 那样拿到的是空串, "在文件夹中显示"会拼出 "ook" 这种路径。
export let LIBROOT = "";
export function setLIBROOT(v) { LIBROOT = v; }
