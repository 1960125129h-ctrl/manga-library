// IPC 访问层
// 统一封装主进程能力, 让上层代码不必到处判空。
// 桌面版(Electron)下 window.mangaLib 由 preload 注入; 浏览器直开时不存在。

export function isElectron() {
  return !!(window.mangaLib && window.mangaLib.isElectron);
}

export function api() {
  return window.mangaLib || null;
}

// 调用主进程能力。没有桌面环境时抛出明确错误, 而不是静默返回 undefined
// (历史上多次因为 "静默失败" 变成界面毫无反应, 所以这里一律显式抛错)
export async function call(name, ...args) {
  const m = api();
  if (!m || typeof m[name] !== 'function') {
    throw new Error('需要桌面版: 主进程能力 ' + name + ' 不可用');
  }
  return await m[name](...args);
}
