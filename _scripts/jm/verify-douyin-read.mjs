import vm from 'node:vm';
import { READ } from '../sites/douyin.mjs';

const aweme = (id, time) => ({
  aweme_id: id,
  desc: '正文 #tag' + id,
  create_time: time,
  author: { sec_uid: 'sec', nickname: '作者' },
  images: [{ url_list: ['https://example/u1', 'https://example/u2'] }]
});
const doc = {
  documentElement: { scrollHeight: 1200, clientHeight: 800, scrollTop: 0 },
  body: { scrollHeight: 1200, clientHeight: 800, scrollTop: 0, innerText: '' },
  querySelectorAll: () => [],
  getElementById: () => null
};
const windowObj = {
  innerWidth: 1200,
  innerHeight: 800,
  scrollY: 0,
  __cap: [
    {
      u: 'https://www.douyin.com/aweme/v1/web/aweme/post/?cursor=0',
      j: { status_code: 0, has_more: 1, max_cursor: 10, aweme_list: [aweme('101', 10), aweme('102', 20)] }
    },
    {
      u: 'https://www.douyin.com/aweme/v1/web/aweme/post/?cursor=10',
      j: { status_code: 0, has_more: 0, max_cursor: 20, aweme_list: [aweme('103', 30)] }
    }
  ]
};
const context = {
  window: windowObj,
  document: doc,
  location: { href: 'https://www.douyin.com/user/sec' },
  JSON,
  decodeURIComponent,
  Math
};
vm.createContext(context);
const out = JSON.parse(vm.runInContext(READ, context));
let bad = 0;
const chk = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) bad++;
};
chk('读取三页图文', out.items.length === 3, String(out.items.length));
chk('识别两页 post 接口响应', out.pages.length === 2, String(out.pages.length));
chk('最新响应表示没有更多', out.page && out.page.hasMore === 0, JSON.stringify(out.page));
chk('图文按发布时间倒序', out.items.map((x) => x.id).join(',') === '103,102,101', out.items.map((x) => x.id).join(','));
chk('图片候选地址保留', out.items[0].imgs[0].u.length === 2);
process.exit(bad ? 1 : 0);
