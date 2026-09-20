// 书库数据(manifest)的取得
//
// 以前: build-library.mjs 在构建时把整份书库数据内联进 书库.html
//       -> 改任何前端代码都要重新构建
// 现在: 构建只把数据写成 _manifest.json, 渲染层运行时向主进程要
//       -> 修改 UI 代码不再需要构建

import { call, isElectron } from './ipc.js';

export async function loadManifest() {
  if (!isElectron()) {
    const response = await fetch('../_manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('浏览器读取书库数据失败: HTTP ' + response.status);
    const data = await response.json();
    return Array.isArray(data.comics) ? data.comics : [];
  }
  const r = await call('readManifest');
  if (!r || !r.ok) throw new Error((r && r.msg) || '主进程读取书库数据失败');
  return Array.isArray(r.comics) ? r.comics : [];
}
