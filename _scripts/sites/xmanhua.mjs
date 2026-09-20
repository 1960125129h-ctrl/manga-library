// xmanhua 适配器: 包装 _scripts/lib/downloader.mjs
import * as D from '../lib/downloader.mjs';
export const id = 'xmanhua';
export const label = 'xmanhua（漫画站）';
export function match(url) { return /xmanhua\.(net|com)/i.test(String(url || '')); }
export function slug(url) {
  const seg = String(url).replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').filter(Boolean);
  return seg[seg.length - 1] || '';
}
export async function resolve(url) {
  const m = await D.resolveMeta(slug(url));
  return { title: m.title, desc: m.desc, cover: m.cover };
}
export async function chapters(url, opts) {
  const list = await D.listChapters('/' + slug(url) + '/', opts && opts.signal);
  list.reverse();   // 站点把最新话排最前, 反转成"第1话(最老)排最前", 下载/阅读顺序从老到新
  return list.map((c, i) => ({ index: i + 1, id: c.url, title: c.raw || ('第' + (i + 1) + '话'), url: 'https://www.xmanhua.net' + c.url, preview: !!c.isPreview }));
}
export const home = D.SITE + '/';
export async function images(chapter) {
  const u = String(chapter && (chapter.url || chapter.id) || '');
  const p = u.replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '') + '/';
  const info = await D.chapterImages({ url: p }, { comic: p, apiConcurrency: 6 });
  return info.urls.filter(Boolean);
}
export async function download(o) {
  return await D.downloadComic({
    comic: '/' + slug(o.url) + '/',
    out: o.out,
    from: o.from || 1,
    to: o.to || 99999,
    concurrency: o.concurrency || 8,
    apiConcurrency: o.apiConcurrency || 6,
    cbz: o.cbz === true,
    signal: o.signal,
  }, o.onEvent);
}