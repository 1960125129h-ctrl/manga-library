// Web 模式下的后端 API 封装
//
// 当完整桌面版在手机浏览器里通过 Electron 的 HTTP 服务(web-server.js)访问时,
// window.mangaLib 不存在, 磁盘文件操作走不了 IPC, 需要走这里的 HTTP 端点。
//
// 目前只封装了删除; 后续如果重命名 / 合并等也要在手机端用, 按同样模式加。

import { isElectron } from '../lib/ipc.js';

export function isWebMode() {
  return !isElectron() && location.protocol.startsWith('http');
}

// 从当前页面 URL 提取会话 token(如果用户用 ?t= 方式登录, fetch 不会自动带)
function sessionQuery() {
  try {
    var t = new URL(location.href).searchParams.get('t');
    return t ? '?t=' + encodeURIComponent(t) : '';
  } catch (e) { return ''; }
}

// 删除单本(含磁盘文件 + library.json 条目; 服务端会异步触发书库重建)
// 对应 web-server.js 里的 POST /api/delete
export async function webDeleteBook(dir) {
  var r = await fetch('/api/delete' + sessionQuery(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: dir })
  });
  if (!r.ok) {
    var text = '';
    try { text = await r.text(); } catch (e) {}
    throw new Error('HTTP ' + r.status + (text ? ': ' + text : ''));
  }
  var data;
  try { data = await r.json(); } catch (e) { data = {}; }
  if (!data.ok) throw new Error(data.msg || '删除失败');
  return true;
}
