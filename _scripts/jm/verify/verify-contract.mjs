// verify-contract.mjs —— 适配器契约校验的单元测试
//
// 这个测试故意"喂错数据"，确认校验器能拦住并且报清楚原因。
// 契约层要是自己失效了，那比没有还糟(会给人虚假的安全感)，所以它必须有测试。
//
//   node _scripts\jm\verify\verify-contract.mjs     退出码 0 = 全过

import { checkMeta, checkChapters, checkGalleries, checkImages } from '../../sites/contract.mjs';

const R = [];
function ok(name, fn, expectMsg) {
  try {
    const r = fn();
    if (expectMsg) { R.push(false); console.log('  FAIL  ' + name + '  期望抛错, 实际通过了'); return; }
    R.push(true); console.log('  PASS  ' + name + (r !== undefined && typeof r === 'string' ? '   ' + r : ''));
  } catch (e) {
    if (!expectMsg) { R.push(false); console.log('  FAIL  ' + name + '  不该抛错: ' + e.message); return; }
    const hit = e.message.indexOf(expectMsg) >= 0;
    R.push(hit);
    console.log((hit ? '  PASS  ' : '  FAIL  ') + name + (hit ? '   拦住: ' + e.message.slice(0, 110) : '   报错内容不含 "' + expectMsg + '": ' + e.message));
  }
}

console.log('--- checkMeta ---');
ok('title 缺失 -> 用占位补上, 不抛错', () => { const m = checkMeta({}, 'test'); return m.title === '(未命名)' ? 'title=' + m.title : null; });

console.log('--- checkChapters ---');
ok('正常章节通过', () => checkChapters([{ id: '1', title: '第01話' }], 'test'));
ok('title 缺失 -> 用 id 补, 不抛错', () => { const c = checkChapters([{ id: 'abc' }], 'test'); return c[0].title === 'abc' ? 'title=abc' : null; });
ok('title 和 id 都缺 -> 抛错并点名', () => checkChapters([{ index: 1 }], 'test'), 'title/id');
ok('不是数组 -> 抛错', () => checkChapters({}, 'test'), '必须返回数组');

console.log('--- checkGalleries (抖音那次踩的就是这个) ---');
ok('正常作品项通过', () => checkGalleries([{ gid: '1', url: 'http://x/1', title: 't' }], 'test'));
ok('缺 gid -> 抛错并说明后果', () => checkGalleries([{ url: 'http://x/1', title: 't' }], 'test'), 'gid');
ok('缺 url -> 抛错并说明后果', () => checkGalleries([{ gid: '1', title: 't' }], 'test'), 'url');
ok('缺 title -> 用 gid 补, 不抛错', () => { const g = checkGalleries([{ gid: '77', url: 'http://x' }], 'test'); return g[0].title === '77' ? 'title=77' : null; });
ok('报错能指出是第几项', () => checkGalleries([{ gid: '1', url: 'u' }, { url: 'u2' }], 'test'), '第 2 项');

console.log('--- checkImages (所有下载路径的唯一漏斗) ---');
ok('空数组合法(这一话没图)', () => checkImages([], 'test'));
ok('字符串地址通过', () => checkImages(['http://a/1.jpg'], 'test'));
ok('对象地址通过', () => checkImages([{ url: 'http://a/1.jpg', headers: {} }], 'test'));
ok('动图只有 gif 也通过(url 用 gif 补)', () => { const r = checkImages([{ gif: 'http://a/1.mp4' }], 'test'); return r[0].url === 'http://a/1.mp4' ? 'url=gif' : null; });
ok('只有一项且没地址 -> 抛错(不是"跳过", 是整体没用)', () => checkImages([{ headers: {} }], 'test'), '没有一项带可用图片地址');
ok('空字符串地址 -> 抛错', () => checkImages(['   '], 'test'), '没有一项带可用图片地址');
ok('部分缺地址 -> 不拦整话, 跳过并报数', () => { const r = checkImages(['http://a/1.jpg', { headers: {} }, 'http://a/3.jpg'], 'test'); return r.length === 2 ? '保住了 2/3' : null; });
ok('全都没地址 -> 抛错(适配器取错字段)', () => checkImages([{ headers: {} }, { headers: {} }], 'test'), '多半是适配器取错了字段');
ok('报错带 label 便于定位是哪一话', () => checkImages([''], 'test', '第03話'), '第03話');

console.log('');
const failed = R.filter((x) => !x).length;
console.log(failed ? ('结果: ' + failed + ' / ' + R.length + ' 项失败') : ('结果: ' + R.length + ' / ' + R.length + ' 项全过'));
process.exit(failed ? 1 : 0);
