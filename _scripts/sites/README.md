# 站点适配器（_scripts/sites）规则备忘

## 必须遵守
1. **X（twitter/x.com）：保存的必须是原图，不能是缩略图。**
   - `cdn.syndication.twimg.com/tweet-result` 返回的 `media_url_https` 是**不带参数**的裸地址，默认给的是小图；
   - 一律用 `origUrl()` 处理：地址里已有 `name=xxx` 就替换成 `name=orig`，没有就补上 `?name=orig`；
   - 实测同一张图：`name=small` 79.6 KB / `medium` 267.6 KB / `large` 844.5 KB / **`orig` 2882.7 KB**；
   - 只取图片（`type === 'photo'`），视频推文跳过。
2. **一个人 = 一本书**：给主页/媒体页地址就扒这个人的全部图片（转推别人的不算），给单条推文地址也归到这个人的图包，不另开新书。
3. 每个适配器实现 `id / label / home / match(url) / resolve(url) / chapters(url) / images(chapter)`，并注册到 `index.mjs` 的 `ADAPTERS`。
4. `images()` 可以返回字符串，也可以返回 `{url, headers}`（例如 Komiic 要 `X-Image-Ticket`、X 要 `Referer: https://x.com/`）。

## 常用命令
- 下载/续下：`node _scripts\sites\fetch-book.mjs --url <地址> [--dir 书名] [--from N --to M]`
- 重下覆盖（换成更清晰的版本）：加 `--force`
- 全部图片合并到一个文件夹：加 `--merge`（已经下好的书可在书库页右键「📦 合并成一个文件夹」）
- 只枚举不下载（数一下多少话）：`--from 99999 --to 99999`
- 登录/取 cookie：`node _scripts\jm\site-login.mjs <域名>`（写进 `_scripts\sites\cookies\<域名>.txt`）
