export const SITES = [
  { g: '免费中文（汉化）在线站', list: [
    { n: '拷贝漫画 CopyManga', u: 'https://copymanga.tv/', alt: 'copymanga.org / mangacopy.com / copy20.com（镜像轮换）', note: '简体，日漫汉化最全之一，有 v3 JSON API' },
    { n: '漫画柜 manhuagui', u: 'https://www.manhuagui.com/', note: '老牌汉化站' },
    { n: '再漫画 zaimanhua', u: 'https://manhua.zaimanhua.com/', note: '纯 HTTP API；支持站内搜索', done: true, search: true },
    { n: 'X漫画 xmanhua', u: 'https://www.xmanhua.net/', note: '静态站；下载已适配（贴目录页链接即可，例如 /35231xm/）。站内搜索是前端 JS 拼的，暂未适配', done: true },
    { n: '包子漫画 baozimh', u: 'https://baozimh.org/', alt: 'cn.bzmgcn.com / baozimh.com', note: '韩漫+日漫汉化，量大' },
    { n: '动漫屋 / 极速漫画 dm5', u: 'https://www.dm5.com/', note: '本机可直连' },
    { n: '扑飞漫画 1kkk', u: 'https://www.1kkk.com/', note: '本机可直连' }
  ] },
  { g: '有 API 的站', list: [
    { n: 'Komiic（中文站 komiic.cc）', u: 'https://komiic.cc/', alt: 'komiic.com（同一个后端）', note: 'GraphQL API + 图片票据；匿名每天 300 张，登录后按账号配额；支持站内搜索', done: true, search: true }
  ] },
  { g: '大平台（图包）', list: [
    { n: 'X (twitter)', u: 'https://x.com/', note: '主页/媒体页 = 一个人的图包，单条推文也并进这个人的图包；图片取 ?name=orig 原图；枚举要用调试浏览器且已登录 X', done: true },
    { n: '微博 weibo', u: 'https://weibo.com/', note: '一个人 = 一个图包；桌面版接口 + cookie，纯 HTTP，不用浏览器；动图原样存 GIF', done: true },
    { n: '抖音 douyin', u: 'https://www.douyin.com/', note: '只收图文作品（视频不下），动图用 ffmpeg 转 GIF；枚举要走调试浏览器', done: true }
  ] },
  { g: '同人 / 其它', list: [
    { n: '禁漫天堂 18comic', u: 'https://18comic.vip/', alt: '镜像轮换：18comic.org / 18comic.club / 18comic.one / jmcomic1.me（换域名也认 JM 编号）', note: '中文 R-18 同人志为主；打开时若出现 Cloudflare「Just a moment」稍等一下会自动过。整本下载走「下载漫画 → 禁漫天堂」页签（图片直取，不用浏览器）', done: true },
    { n: 'nhentai', u: 'https://nhentai.net/', note: '英文同人志站，v2 API + 图片直链；直连会被 CF 403，先跑 site-login 抓 cookie', done: true },
    { n: 'E-Hentai', u: 'https://e-hentai.org/', alt: 'https://exhentai.org/（要论坛登录的 igneous cookie）', note: '画廊 = 一本书；纯 HTTP 走 cookie，不用浏览器。看图片额度：登录后打开 https://e-hentai.org/home.php 的 Image Limits 一段', done: true },
    { n: 'Pixiv', u: 'https://www.pixiv.net/', alt: '作品页 /artworks/<id> 或作者主页 /users/<uid>', note: '两个都能下：作品=一话(多页自动展开)，作者主页=一本书', done: true }
  ] },
  { g: '整本 / 合集 / 下载站', list: [
    { n: '漫客栈系 mangabz', u: 'https://www.mangabz.com/', note: '下载/合集站' },
    { n: 'Kmoe（原 mox.moe / vol.moe）', u: 'https://mox.moe/', note: '台版/汉化单行本 epub→mobi，一卷一文件，不用逐页拼图' }
  ] },
  { g: '需要账号的站', list: [
    { n: '漫画补档 manhuabudang', u: 'https://www.manhuabudang.com/', note: '要登录' },
    { n: '萌享 moeshare', u: 'https://www.moeshare.cc/', note: '要登录' }
  ] }
];

export const SS_SITES = [
  { id: 'zaimanhua', n: '再漫画' },
  { id: 'komiic', n: 'Komiic' },
  { id: 'nhentai', n: 'nhentai' },
  { id: 'ehentai', n: 'E-Hentai' },
  { id: 'pixiv', n: 'Pixiv' }
];
