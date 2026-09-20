// 工作台的唯一入口 —— core.js 只认这一个函数
//
// 对现有代码的改动加起来只有三处:
//   · core.js    一行 import + 一行 initWorkbench({...})
//   · index.html 一个空的 <div id="workbench" class="view hide">
//   · styles/    一个新 css 文件(05-workbench.css)
// 其余全在这个目录里。删掉这个目录 + 撤掉那三处, 就回到没有工作台的状态。

import { initRefStore, loadWorkbench, saveNow } from './store.js';
import { W } from './state.js';
import { initView, switchMode, refresh as initViewRefresh } from './view.js';
import { openByDir } from '../reader/open.js';

let booted = false;

export function initWorkbench(ctx) {
  if (booted) return;
  booted = true;
  const c = ctx || {};

  initRefStore({ DISK: c.DISK, COMICS: c.COMICS });

  // 数据自己取: core 那边就不用管"工作台的数据什么时候到"。
  // ctx.workbench 是给测试用的入口(测试可以直接灌一份进来, 不用起主进程)。
  if (c.workbench) loadWorkbench(c.workbench);
  else if (c.DISK && c.DISK.getWorkbench) {
    c.DISK.getWorkbench().then((wb) => { loadWorkbench(wb); initViewRefresh(); })
      .catch((e) => console.warn('[工作台] 读取失败: ' + ((e && e.message) || e)));
  }

  const root = document.getElementById('workbench');
  if (!root) { console.warn('[工作台] 找不到 #workbench 容器, 跳过'); return; }

  initView(root, {
    comics: c.COMICS,
    hint: c.hint,
    onOpenInReader: openInReader,
  });

  switchMode(W.mode === 'workbench' ? 'workbench' : 'shelf');

  // 关窗前把没落盘的写掉(store 里是 400ms 防抖)
  window.addEventListener('beforeunload', () => { try { saveNow(); } catch (e) {} });
}

// 从工作台跳回娱乐模式看上下文 —— 这就是"两个模式能串"那一条。
// 走的是 reader/open.js 的公开接口, 不反向依赖它内部。
function openInReader(img) {
  if (!img || !img.ref) return;
  switchMode('shelf');
  try { openByDir(img.ref.book, img.ref.ci, img.ref.pi); }
  catch (e) { console.warn('[工作台] 跳回阅读器失败: ' + ((e && e.message) || e)); }
}
