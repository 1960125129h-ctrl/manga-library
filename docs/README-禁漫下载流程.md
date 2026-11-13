# 漫画书库 · 全流程手册（新会话请先读这份，不必读 .mjs 源码）

> 这份文件**自包含**：命令、路径、规则、坑、实测数据都在里面。新会话读完就能直接干活。
> 需要改代码时，再按第 12 节的脚本清单定点打开对应文件。

## 0. 一句话总览

- 书库根：<书库根>（下称 LIB）
- 漫画都在 LIB\漫画\<书名>\第NN話\*.webp；书库根与书目录里不放任何图片。
- 下载只走一条命令：node _scripts\jm\run-albums.mjs "<专辑链接>"
- **轻量版（推荐先试这个）**：在后面加 `--img` —— 跳过「点免等待 / 验证码 OCR / 表单提交 / 收 zip / 解压」整条重链路，改图片 CDN 直取（实测单话 1.7~2.9 秒，无浏览器也能跑）。原理、实测数据、踩坑见 `docs\资源获取-更优路径.md`
- 手动下的包丢进 LIB\_zips，跑 node _scripts\jm\import-zips.mjs 入库。
- 改完库跑 node _scripts\build-library.mjs --lib "LIB" 重建 书库.html。
- 当前规模：19 本 / 63 话 / 2092 页。

## 1. 目录结构（固定）

```
漫画书库\
├── 漫画\                     ← 类目目录
│   ├── <书名>\               ← 一本书
│   │   ├── 第01話\00001.webp  ← 一话一个子目录（图片只在这一层）
│   │   └── 漫画阅读器.html     ← build-library 自动生成
│   └── <另一本>\...
├── _app\        Electron 桌面版（main.js / preload.js）
├── _scripts\    lib\downloader.mjs（xmanhua 线）、add-comic.mjs、build-library.mjs、reader-core.js
│   └── jm\      18comic 工具链（见第 12 节）
├── _zips\       手动下载的 <id>.zip 丢这里（导入后自动删除）
├── 书库.html     书架+阅读器（单文件，双击即用）
├── library.json  收藏/分类/标签/备注/简介(desc)/来源(source)
├── .progress.json 阅读进度
```

扫描规则（build-library.mjs）：
- 下划线 _ 或点 . 开头的目录不参与扫描。
- 一级目录若「自己不含图、且每个子目录也不直接含图」→ 判为类目目录，里面的目录各算一本书（所以 漫画\ 能装很多本）。
- 图片只认 .jpg .jpeg .png .webp .gif；话名自然排序（支持中文数字）。

## 2. 常用命令

cd '<书库根>'

node _scripts\jm\run-albums.mjs "<专辑链接>"        # 下载+入库（已入库会自动跳过）
node _scripts\jm\import-zips.mjs                     # 手动包入库（扫 _zips）
node _scripts\jm\import-zips.mjs --dir "%USERPROFILE%\Downloads"
node _scripts\jm\import-zips.mjs --probe 1452133     # 只反查书名/话号
node _scripts\build-library.mjs --lib "<书库根>"   # 重建书库
python _scripts\jm\stitch-pages.py "<LIB>\漫画\<书名>\第01話" [--dry]  # 切页拼合+像素校验

Python：%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe（EasyOCR 1.7.2）。

## 3. 下载全流程（run-albums.mjs 内部 9 步）

1. 单开一个专用标签页（CDP Target.createTarget）→ 用完关掉。一个任务一个页面。
2. 过 Cloudflare → 抓专辑页 → 解析书名与章节（a[data-album][data-index] 去重；单话本用专辑 id 当话 id）。
3. 书名过 safeName：反斜杠 斜杠 冒号 星号 问号 引号 尖括号 竖线 → 下划线（例 Signal:Violet 不改会 mkdir ENOENT）。
4. 跳过已入库的话：漫画\<书名>\第NN話\ 已有图 → 不重复下载；整本都有只打印「已下载过」。
5. 切到 /album_download/<首话id>（表单 #album_down 只在这个页面），确认 form=true。
6. 每话顺序：点「免等待、點我直接下載」→ 关掉弹出的广告页 → 页内取验证码 → OCR → 改表单 action/album_id → 点提交。
7. 收包：Downloads 里只要出现该话包体就算成功；文件名兼容 id.zip、id (1).zip、id (2).zip。
8. 解压 → 图片拷进 漫画\<书名>\第NN話\ → 切页拼合+像素校验 → 删掉 zip。
9. 写 library.json 的 desc（简介，含各话下载链接）与 source → 重建 书库.html。

失败自动重试：每话最多 5 轮，每轮重新取验证码重新提交；失败时打印页面回显（能区分「驗證代碼無效」与「没给包」）。

## 4. 每话的硬约束（改了就会坏）

4.1 必须先点「免等待、點我直接下載」（.triggerpop）
- 不点 → 页面停在倒计时「將在 53 秒後開始下載」，干等 50~90 秒还可能拿不到包。
- 点 → 立刻露出验证码表单；会弹一个广告页，代码自动关掉那个新标签页。
- 实测：同一本单话，点之前 81.6 秒，点之后 6.9 秒。

4.2 验证码是会话级的
- /captcha/ 每请求一次就换一张，整个浏览器会话只有一张有效 → 取码→识别→提交必须串行。
- 页面出现「× 驗證代碼無效！」= 识别答错了，不是被限流。

4.3 提交必须走真实表单提交，不能用页内 fetch POST
- fetch() POST 会被 Cloudflare 挡回 403 Just a moment（Sec-Fetch-Mode: cors 不像导航）。
- 做法：改表单 action 与隐藏字段 album_id，再 #download_submit.click()；响应是附件，浏览器留在原页并直接写盘。
- 页内 fetch 只能用来取验证码图（GET 不受影响）。

4.4 收包判定：看到包体就算成功
- 只要 <id>.zip / <id> (N).zip 出现且 > 20KB（站点自己写「下載只有10多kb代表下載失敗」）。
- 不判断 .crdownload、不等大小稳定——那套判断会导致误判失败并重复下载。

4.5 断点续跑：_zips 里有现成的包就直接入库（存在、>20KB、tar -tf 可读 → 不重新下载）。

## 5. 验证码 OCR（ocr_server.py）

- 常驻进程：stdin 读图片路径，stdout 打 RESULT {"cands":[...],"detail":[...]}；模型只加载一次（省掉每次 20 秒）。
- 模型：本机 EasyOCR，%USERPROFILE%\.EasyOCR\model\（craft_mlt_25k.pth + zh_sim_g2.pth）。只有中文模型，别用 en（会报缺文件）。
- 7 个预处理变体：原图、3×/4× 放大+Otsu、放大+高斯+Otsu、反相二值化。
- 每个变体 allowlist 0123456789+-x×*÷= → 正则解析数字±数字 → ≥3 个变体一致才收工（2 个容易一起错）→ 按命中次数+置信度排序出候选。
- 中文路径会让 cv2.imread 返回 None，所以要读字节再喂给 EasyOCR。

## 6. 切页拼合与像素校验（stitch-pages.py）

- 有的专辑把高过 3200px 的页按高度切开，zip 里就是「满高块+短尾巴」成对（例 3000x3200 + 3000x972）。491045 那本 90 个文件其实只有 46 页。
- 规则：同宽 + 组内最后一块=本章最大高度 + 下一块<阈值一半 → 拼成一页；三重条件避免误拼（对正常书 dry-run 恒为「合并 0 处」）。
- 同时输出校验：文件数→页数、页高 min/中位/max、异常页（偏离中位过多）——这就是「像素是否一致/区别是否过大」的检查。
- WebP 上限 16383px，拼出来的页（约 4172px）安全。

## 7. 手动下载包导入（import-zips.mjs）

- 书名不用填：zip 名就是 <photo_id>.zip，脚本打开 18comic.vip/photo/<id> 读 h1 拿书名，再用 var series_id + 专辑页 data-index 判断第几话/共几话。全程只读网页，不触发下载、不碰验证码，因此不受风控影响。
- 入库路径 漫画\<safeName(书名)>\第<NN>話\；解压→拷贝→校验→删 zip→重建书库。
- 已是库里那一话 → 打印「已下载过(跳过)」并保留 zip。
- 解压不出图片 → 判定不是漫画包，跳过并原样保留 zip。
- 文件名必须是纯数字 <id>.zip；改名就反查不到。

## 8. 书库程序（Electron 桌面版 + 单文件 HTML）

- 书库.html：单文件书架+阅读器，双击即用；桌面版只是给它加了文件读写能力。
- library.json 每本字段：favorite、categories、tags、note(备注)、desc(简介)、source{site,url}、lastRead。键名是相对路径（如 漫画/书名）。
- .progress.json：键同样是 漫画/书名，存 ci/pi/mode/fit/dir/cover/sidebar/wheel。
- 阅读器功能：单页/双页/长条三模式、适宽/适高/原始、日漫右→左、封面独立、滚轮翻页、键盘中括号切换话、进度记忆、收藏、分类标签筛选、搜索、右键「删除本书（含文件）…」、「设置」面板。
- 右键删除：删磁盘目录 + library.json 条目 + 阅读进度，然后自动重建并刷新。链路 reader-core.js → preload.js 的 deleteComic → _app\main.js 的 lib:delete（带路径越界保护）。只在桌面版可用，浏览器打开会提示「需要桌面版」。
- 设置面板（书架右上，更新书库旁边）：缩略图宽度、最宽时每行本数（上限）、卡片间距、网格内边距、文字缩放系数、卡片圆角、滚动条宽度、封面填充方式（完整显示/裁切）、星标/进度/来源/标签/吸顶/回到顶部开关。全部走 CSS 变量（--card-w --cols --gap --pad --t-scale --radius --fit --sbw），实时生效、存 localStorage、可一键恢复默认。
- 布局要点：#grid 用 repeat(auto-fill, var(--card-w)) + grid-auto-rows:max-content + align-items:start + overflow-y:auto → 窗口变窄列数自动减少、卡片不变形、纵向滚动条出现。不要改成 1fr 或去掉 max-content（会压扁缩略图且永远没有滚动条）。

## 9. 桌面版已修的三个坑（改回去就复现）

1. 「更新书库」按钮没反应 → execFile(process.execPath, ...) 在 Electron 里必须带 env: { ELECTRON_RUN_AS_NODE: '1' }，否则子进程不退出、回调永不触发。已加 timeout: 120000 兜底。
2. 窗口显示旧页面 → main.js 现在用 fs.watch 监听 书库.html，一重建就自动 reload()；切换书库目录会重新挂监听。
3. 下载落到书库根 → 桌面版下载输出目录已改成 漫画\（main.js 的 dl:start）。

## 10. 反爬与登录态（为什么必须用真实浏览器）

- node/curl 一律过不了 Cloudflare：带齐 cf_clearance + 浏览器 UA 仍然 403 Just a moment，卡在 TLS/JA3 指纹。
- 专辑需要登录：未登录访问 /album/<id> 返回 error/album_missing（看着像本子不存在，其实是登录墙）。
- 调试实例：Chrome 独立 user-data-dir + --remote-debugging-port=9333 + --proxy-server=http://127.0.0.1:7890；启动脚本 _scripts\jm\open-chrome.mjs。登录态存在 _scripts\jm\chrome-profile（删了要重新登录）。
- Edge 不要用：Edge 136+ 在默认用户数据目录下会静默忽略 --remote-debugging-port（端口不监听）；Edge 运行中 Cookies 文件被独占锁，复制 profile 报 EBUSY。
- 代理：Clash Verge（mihomo）127.0.0.1:7890；出口 IP 决定能否过 CF，机房 IP 可能被整体封。

## 11. 实测性能与成本基线

- 单话本（点免等后）：本话 6.9~8.9 秒，整本流程 15~21 秒。
- 单话本（不点免等、等倒计时）：81.6 秒。
- 固定开销：开页+解析约 5~12 秒（含过 CF）。
- 多专辑并行：受会话级验证码限制，收益有限；串行更稳。
- 成本（来自 ~/.dsh/sessions/<会话>/session.jsonl.zstd 的 assistant/chunk.usage）：一轮下载约 ¥0.13~0.5（A 档：缓存命中 ¥0.2/M、未命中 ¥2/M、输出 ¥3/M）；B 档 ¥0.33~1.29。
- 成本 95% 以上在缓存命中的输入：每次工具调用都要重发整段上下文 → 成本约等于 调用次数 × 上下文长度。长任务丢后台、批量脚本一次做完更省。

## 12. 脚本清单（新会话按需定点查看，不必通读）

- jm\run-albums.mjs —— 主力：给若干专辑链接，全自动下载+入库（单开页面、点免等关广告、OCR、重试、切页校验、写简介、重建）。
- jm\run-album.mjs —— 单专辑版（老版本，保留）。
- jm\import-zips.mjs —— 手动下载的 <id>.zip 入库（--dir / --probe）。
- jm\ocr_server.py —— 常驻验证码 OCR（7 变体，至少 3 个一致才收工）。
- jm\stitch-pages.py —— 切页拼合 + 像素校验（--dry 只报结论）。
- jm\cdp.mjs —— CDP 连接封装（openPage(port, targetId) 返回 ev/goto/send/close，自带挑战页等待与重试）。
- jm\open-chrome.mjs —— 以 9333 调试端口 + 代理启动 Chrome（独立 profile）。
- jm\grab.mjs / grab2.mjs —— 用浏览器打开 URL 并存渲染后 HTML。
- jm\parse-ids2.mjs —— 从专辑页 HTML 解析书名 + 各话 photo_id。
- jm\open-target.mjs —— 新开标签页并返回 targetId。
- jm\check-dims.py / check-stitch.py —— 批量看图片尺寸 / 看接缝连续性。
- build-library.mjs —— 扫描书库生成 书库.html 与每本的 漫画阅读器.html。
- reader-core.js —— 书架/阅读器前端逻辑（设置面板、右键删除、删除确认框）。
- lib\downloader.mjs / xmanhua-dl.mjs —— 老的一条线：xmanhua 专用下载器（保留，入口不再走它）。
- **sites\thumbs.mjs** —— 缩略图 worker（常驻，带代理环境）：主进程把 `{"url","referer"}` 一行行喂进来，它拉图写 `_thumbs\preview\<sha1>.<ext>`（网页的每页预览、EH/Pixiv 那种防盗链图都走它）。
- **jm\verify-preview.mjs** —— 功能 5「下载前预览」验收：真 link 跑一遍（页面缩略图网格 / 箭头展开 / Ctrl·Shift 多选 / 只下勾选的页），输出逐项 PASS/FAIL。前置：App 要用 `--remote-debugging-port=9445` 启动（9333 被禁漫调试 Chrome 占着）。
- **add-comic.mjs** —— 「下载新漫画.cmd」背后的自动化脚本：**通用**入口，解析地址 → 下载 → 写简介/作者/来源 → 重建书库；支持哪些站点由 `_scripts\sites\index.mjs` 决定（再漫画 / xmanhua），与 App 的「下载漫画 → 通用链接」和 `sites\fetch-book.mjs` 同一条链路。参数：`--url --name --from --to --dry`。

## 13. 踩坑清单（含我自己犯过的错）

1. 变量遮蔽导致「成功却判失败」：const cands = r.cands, sz = r.sz; 遮蔽了外层 let sz，外层恒为 0 → 每话都误判失败 → 重试 → 同一话下载 3 份。修法：赋值给外层变量，别用 const 重声明。
2. 网格行高被压扁 → 永远没有滚动条：#grid 只有 auto 行 + 固定高度时，行被压到 113px、缩略图被裁一半、scrollHeight 等于 clientHeight。修法：grid-auto-rows:max-content; align-items:start;（缩略图再加 flex:0 0 auto）。
3. 误判成「站点限流」：连续失败其实是上面第 1 条 bug + 验证码偶尔答错。页面上出现「驗證代碼無效」就说明是答错了，不是被封。
4. fetch POST 提交被 CF 403：见 4.3。
5. 中文路径：cv2.imread 返回 None；PowerShell -Filter 不支持多值；Get-ChildItem 遇方括号路径要用 -LiteralPath。
6. 跨盘移动：renameSync 从 C: 到 D: 会 EXDEV，要 copyFile + unlink 兜底。
7. Chrome 重名：同名包第二份会变 <id> (1).zip，收包匹配要带括号后缀。
8. 长任务丢后台：前台 run_code 会被新消息打断（abort），后台任务不受影响。
9. 别手滑删原件：导入器只在确认解出图片后才删 zip；空包/非漫画包一律保留。
10. 改完必重建：图片/文件夹变了要跑 build-library.mjs；桌面版有自动刷新，浏览器里打开的要手动 F5。

## 14. 换到其它资源站时怎么复用

1. 先用真实浏览器确认能否访问、要不要登录；
2. 优先找站方自带的打包下载（比逐图抓省事，包里的图通常没打乱）；
3. 有验证码就上 OCR（多预处理+投票+候选逐个提交），验证码若绑会话就串行；
4. 落盘后先做一次「要不要还原/解密」的检测（本项目用逐行差分测接缝）；
5. 入库统一走：漫画\<书名>\第NN話\ + 校验 + 删包 + 写 desc/source + 重建书库。

---

## 十五、本轮新增（阅读器增强 / 多站点适配 / 检查更新 / 技术债）

### 15.1 多站点适配器（`_scripts\sites\`）
- `index.mjs`：注册表，`pick(url)` 按链接自动选站点。
- `xmanhua.mjs`：包装 `_scripts\lib\downloader.mjs`（xmanhua 站）。
- `zaimanhua.mjs`：再漫画 `manhua.zaimanhua.com`，**纯 HTTP 接口**（不用浏览器）：
  - 详情 `GET /api/v1/comic2/comic/detail?channel=pc&app_name=zmh&version=1.0.0&timestamp=<ms>&uid=0&id=<comicId>`；
  - 章节图 `GET /api/v1/comic2/chapter/detail?...&comic_id=<id>&chapter_id=<chid>`；
  - 章节链接形如 `/view/<拼音>/<comicId>/<chapterId>`；书名/作者/状态在 `data.comicInfo`。
- `fetch-book.mjs`：**通用抓书**，`node _scripts\sites\fetch-book.mjs --url <来源链接> [--dir <书名>] [--from N] [--to M]`；自动跳过已入库的话、写 `library.json`（作者/简介/来源）、重建书库。
- **加新站点 = 写一个适配器 + 在 index 注册**，其余流程全部复用。
- 坑：xmanhua / 再漫画**必须走代理**（直连不通、代理 200）。两个脚本都会在启动时自带代理环境（`NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY`）**重新启动自己**；注意标志位 `JM_PROXY_READY` 必须一起传，否则会无限自我重启。
- 坑：Electron 自带 Node 22 **不支持** `NODE_USE_ENV_PROXY`，所以 App 里跑这两个脚本必须用**真实 Node 24**（`main.js` 里的 `NODE_BIN = 'node'`）。

### 15.2 右键「 检查是否有更新」+ 一键更新
- 书架右键任意书 → 检查 → 有更新时弹「发现 N 个新话」→「现在更新」自动补话（已入库自动跳过），日志走下载窗口实时滚动。
- 链路：`reader-core.js` → `preload.js`(`jmCheckUpdate`/`jmFetchBook`) → `main.js`(`jm:checkUpdate`/`jm:fetchBook`) → 适配器脚本或 `jm-auto.mjs`。
- 18comic（禁漫）单话链接直接下即可，不做专门的更新检查。

### 15.3 阅读器增强
- **书签**：阅读时点「☆ 书签」给当前页加书签；书架分类栏新增 ** 书签** 页，卡片缩略图就是那一页，点进去**直接定位到该页**并且可以前后翻；右键卡片删书签。
- **阅读历史页**：书架栏「 历史」→ 独立页面，按最近阅读时间倒序（封面 + 书名 + 进度 + 时间 + 继续阅读）。
- **右侧预览侧栏**：阅读器「预览」按钮（双击画面也可切放大），右侧列出当前话所有页缩略图，当前页高亮、点击跳转、自动滚动定位。
- **单页放大 / 平移**：**按住右键 + 滚轮** = 以光标位置为锚点**每次 ±10%** 缩放（从 100% 起，范围 20%~800%）；**按住右键拖动** = 上下左右平移；工具栏「放大」按钮 = 每次 +25%（100% → 125% → … → 400% → 100%），不再一跳 200%。
- **工具栏三个缩放键**：**＋ / －** 每次 ±25%（**以画面中心为锚点**，画面不会甩），**⟲** 重置画面大小（回到 100%、退出缩放）。滚轮才是**以光标为锚点**。
- **边拖边缩放不会弹回**：拖动是增量累加，按住右键拖动途中滚轮缩放，位置完全跟手（旧写法用按下时的基准，会被滚轮改过的位置冲掉 → 画面弹回原处）。
- **缩放状态下的滚轮**：一旦放大/缩小了，普通滚轮**也用来缩放**（以光标为锚点），**不会翻页**——以前在放大状态下滚轮会翻页，画面整页跳一下，看着就像"偏移"。此时翻页请用左右方向键 / 底部页码 / 预览侧栏，或先缩回 100%。
- **放大后可真正拖动**：三种模式（单页/双页/长条）× 三种适宽，放大后用**画布层 + translate** 平移（不再靠滚动条），图片按真实像素重排所以清晰。
- **不吸附左上角、整屏随便拖**：进缩放不跳（用当前页图片的左上角当画布原点）；**左键或右键按住直接拖**（左键超过 4px 才算拖）把画面摆到任意位置；拖动是**增量累加**，边拖边滚轮缩放也不会弹回。
- **跨页对齐**：双页模式下**默认封面单独一页**，之后严格成对（工具箱「封面独立」按钮可改）。
- **左侧栏 = 目录，右侧栏 = 预览**：各带一个**伸缩把手**（内边缘 22px 竖条，只有一个箭头；展开时朝「收进去」、收起时朝「拉出来」，悬停有提示）；收起后缩成 **26px 竖条**、内容隐藏，状态存 localStorage。工具栏里原来的「目录」「预览」按钮已删除，快捷键 **S / P** 保留。
- **顶栏动作顺序**：下载漫画 → 更新书库 → 历史 → 设置。两个下载入口已合并成一个「下载漫画」弹窗，里面两个页签：**【通用链接】**（任意适配站点目录页）与**【禁漫天堂】**（原禁漫一键下载：过 CF、过验证码、逐话下载、切页校验、入库、实时日志、再下一本）。

### 15.5 批量操作 / 阅读配色 / 下载队列 / 禁漫编号

### 15.7 章节分组与真实标题(再漫画那类站点)

### 15.8 新站点适配 + 通用登录态
**加一个站点**：在 `_scripts\sites\` 下写一个模块（照抄 `zaimanhua.mjs` 最省事），实现这几样就完事——
- `id` / `label` / `match(url)`（可选 `home` 作为图片 Referer）
- `resolve(url)` → `{ title, desc, cover, author }`
- `chapters(url)` → `[{ id, title, index, order, group? }]`（`group` 有值就自动按组分书）
- `images(chapter)` → 图片数组；**字符串**就是普通图片，**`{url, headers}`** 可以给每张图带专属请求头（如 Komiic 的 `X-Image-Ticket`）
写完在 `_scripts\sites\index.mjs` 的 `ADAPTERS` 里加一行即可，App、`下载新漫画.cmd`、`fetch-book.mjs --probe` 全都自动支持。

**要登录的站点**：不用在代码里存账号密码——用调试浏览器登录一次，把 cookie 抓下来即可：
```
node _scripts\jm\site-login.mjs manhuagui.com            # 直接抓(先在浏览器里登录好)
node _scripts\jm\site-login.mjs manhuagui.com --wait     # 没登录就先打开页面, 等你登录(最多 5 分钟)
node _scripts\jm\site-login.mjs komiic.cc --edge         # 用 Edge(9334)
```
cookie 存到 `_scripts\sites\cookies\<域名>.txt`（本机文件，不外传）；适配器里用 `import { cookieHeader } from './cookies.mjs'` 带上即可，登录过期就重跑一次。
最先用到它的是 **Komiic**：匿名每天只能取 300 张图（`Daily image quota exceeded`），登录后配额按账号算，续下就不用等第二天了。
站点把章节分成 `连载 / 单行本 / 番外篇 / 其他系列` 时（再漫画 API 的 `chapterList[].title` 就是组名），以前会被拍平成一条列表、且话名统一写成 `第NN話` —— 于是 `插图3` 变成 `第43話`、`第01卷` 混在正篇里。现在的规则：
- **按组分书**：组内话数最多的那组当主书（`书名`），其余各组各自成一本 `书名 · 组名`（如 `琉璃龙龙 · 单行本`）。
- **默认跳过「单行本」**（它是正篇的合订、内容重复）；要单独下：`--group 单行本`；也可 `--skip-group 番外篇`。
- **命名**：标题本来就是 `第N话 / 第N話 / 第N卷` 的 → 目录名沿用 `第NN話`（已下载的书不受影响、不会重下）；`插图3 / 番外4 / 卷4附录 / 动画决定` 这类 → 直接用真名，前面加两位序号保顺序（`36 插图2`）。
- 已下载的书可用 `node _scripts\renumber-chapters.mjs --dir "漫画/书名" [--dry]` 就地改名 + 拆组（**只动目录名和 library.json 条目，图片不动**）；执行前会校验磁盘话数与章表条数是否一致，对不上就拒绝执行。
- 坑：改名必须**两阶段**（先全部挪到 `__tmp_N`，再挪到目标名），否则「甲的新名字 = 乙的旧名字」时会互相占位、改名被静默跳过。
- **书架多选批量操作**：**Ctrl + 点卡片**加/减选、**Shift + 点**范围选、**Ctrl+A** 全选当前视图、**Esc** 取消；选中后底部浮出操作条：**加标签 / 移动分类 / 删除 / 取消**。删除逐本走 lib:delete（一次确认、删完只 rescan 一次）；移动分类**只改书库里的归属**（磁盘目录不动）；加标签默认追加（可切「覆盖」）。有选择时点空白处/普通点卡片只会先清掉选择，不会误开书。
- **阅读配色**：阅读器工具栏「配色」→ **纯黑 / 深灰 / 米白纸 / 护眼绿** 四套预设，**整套换肤**（画面 + 侧栏 + 工具栏 + 按钮），四套都带纹理（米白纸是纸纤维纹，其余是细噪点）；**亮度滑杆只压画面那一层**（`#stage::after` 遮罩），工具栏/侧栏始终清晰。设置记在 `localStorage['readerTheme']`，书架不受影响。
- **浏览界面状态持久化**：分类标签（filter）、排序、搜索词、作者筛选、**列表滚动位置**全部存在 `localStorage['shelfView']`（滚动节流 350ms 写、关窗前立即写），App/页面重开回到原处；分类被删掉时自动退回「全部」。阅读器右侧「预览」侧栏的开合也随书记住（写进每本的阅读进度）。
- **下载队列**：下载弹窗（禁漫页签）里「加入队列」→ 逐本排队、**并发 1**、**失败自动重试 3 次**；「暂停队列 / 清空已完成 / 重试 / ✕ 移除」齐全。队列存在 `_scripts\jm\queue.json`，**关掉 App 也不丢**；如果上次是在跑的时候被关掉，**下次启动 3 秒后自动接着跑**（断点续传靠「已入库的话自动跳过」实现）。未完成时会显示在「 下载漫画 (N)」角标上，启动时也会提示一句。
- **认禁漫编号**：禁漫页签里可以直接填 **`JM1452133`**、**`jm1452133`**、**`JM-1452133`**、**纯数字 `1452133`**、专辑链接、单话链接（`/photo/<id>` 会当「第 1 话」下）、无协议的 `18comic.vip/album/1452133`；多个混着粘会自动归一化 + 去重 + 跳过已入库。**只写编号就与镜像域名无关**（.vip/.org 换了也能下）。归一化在 `_scripts\jm\target.mjs`，主程序、`jm-auto.mjs`、`run-albums.mjs` 共用。

### 15.4 书架：按作者分组 + 拖拽排序
- 排序下拉新增「 按作者分组」：多本作者独占整行；**单本作者并排**（1~9 个/行，见设置「按作者分组时, 每行放几个作者」），相邻之间有竖直分割线（`grid-auto-flow: dense` 自动填洞）。
- **作者名规范化与合并**：站点给的 author 字段混了「社团名 / 作者名 / 社团 (作者)」三种，现在按规则统一：**括号里是作者就取括号里的**（`毎日健康生活 (ヘルシーマン)` → `ヘルシーマン`，实测两组并成 12 本）、`Fantia` 这类平台词判为「未标注」、全半角与大小写先归一化。**别名表** 存在 `_scripts\author-alias.json`（UI 里合并会写它，重建后依然生效），别名优先于自动规则。
- **合并入口**：① 「按作者分组」视图里**右键作者标题** → 合并到其他作者 / 改名 / 标为未标注 / 撤销这一组的自动合并；② 设置面板底部「**作者名合并**」列出所有作者（含每种原始写法、本数），可逐个合并或手动写「原始写法 → 正式名」。合并后按钮角标/下拉筛选/分组/搜索全部按正式名走，卡片上悬停能看到原始写法。
- 顺带：`书库.html` 的 manifest 现在**带上 author / tags / categories / source / desc**（以前只有书名和章节），所以**在浏览器里直接双击打开**也能看到作者、标签、来源，不再是非桌面版就一片空白。
- **组内拖拽排序**：分组视图里直接拖卡片即可调顺序，**持久化**在 `localStorage['shelfOrder']`；右键「清除手动排序」恢复默认。
- 设置面板所有数字项支持**鼠标滚轮直接调**（自动夹在上下限内），作者列数上限 **9**。

### 15.5 其他

### 15.6 备注 / 自动标签 / 重复检测 / 日志落盘
- **备注**：书架右键任意一本 → **「备注…」**（保存后显示在卡片底部，鼠标悬停看全文）；备注**能被搜索框搜到**；设置里「显示备注」可关。
- **按书名自动打标签**：右键一本 →「按书名自动打标签」；设置面板 →「**全库自动打标签**」（扫全部书，只追加不改已有标签）。规则：`[XX汉化组]`→`汉化:XX`、`(C108)`→`C108`、`無修正/无修正`、`中国翻訳`、`DL版`、`全彩/フルカラー`、`短篇`、`合同`、`自购`。
- **点标签/分类芯片直接筛选**：卡片上的 `#标签` 点一下=按该标签搜索，分类芯片点一下=切到该分类；顶栏分类栏的「漫画」这类标签也就此联动。
- **重复书目检测**：设置 →「检查重复书目」→ 按「书名去掉配方括号后是否相同 / 互为前缀且页数差 <30%」列组，勾选要删的 →「删除勾选的」（走 lib:delete，删完自动重建）。
- **下载/更新日志落盘**：`_scripts\jm\logs\YYYY-MM-DD.log`（禁漫任务、队列每一本、通用下载、作者别名修改都有时间戳），只追加不轮转；下载弹窗里有「**日志文件夹**」按钮直接打开。日志文件是 UTF-8，用记事本/VS Code 看正常，PowerShell 里 `Get-Content` 需加 `-Encoding UTF8`。
- **下载前预览（功能 5，开关控制）**：设置里勾「下载前预览缩略图」才启用（默认关，存 `shelfSettings.dlPreview`）。开着时：**单链接**（nhentai 单本 / **pixiv 单作品**）解析完直接铺一屏**每页缩略图**；**容器链接**（EH tag / **pixiv 作者主页**）先出作品列表，每本一个 **▼** 展开这本的页缩略图、**▲** 收起。两级都**默认不勾**，保留 全选/全不选/反选，支持点选 / Ctrl / Shift；点「下载选中」只下勾到的页（文件名按真实页号 `00003.webp`，空档不顶位）。
- **缩略图来源与性能（实测 2026-09-19）**：nhentai 用 v2 `pages` 的 200px 图（零额外请求）；EH 用画廊页里现成的 sprite（**每 20 页一张 4000×300**，主进程用 **sharp** 按矩形真裁，注意偏移要**按每张 sprite 内重新计数**，否则只会出前 20 页）；pixiv 用 `/ajax/illust/<id>/pages` 的 `small`(540px)。提速三件套：sprite 字节**内存 LRU + 磁盘缓存**（`_thumbs\preview\`，233 张约 7.6MB）、**解码一次后内存切片**（20 页 605ms→101ms）、输出 **WebP**（单张 117KB→12KB）；渲染端并发 4→8。冷启前 10 张 ≈7s（其中 4s 是解析网页），重开同一本**网格一出图就位**。
- **pixiv 特别说明**：作者作品列表接口（`/profile/all`）**不带封面**，封面靠 `dl:pick-details` 逐本查（每本 260ms 限流）→ **滚到才拉**（并发 3）+ 本地缓存；**取不到**（R-18 / 需登录 / 限流）时**弹全局提示并中断预览**，提示去跑 `node _scripts\jm\site-login.mjs pixiv.net` 续期。
- **还没做**：EH 单画廊上限约 2000 页没做分段折叠；容器批量下载未接持久队列（`queue.json`）。
- **封面缩略图**：`make-thumbs.py` 生成 200px 缩略图到 `_thumbs\`（build-library 自动增量更新）；卡片用缩略图 + `loading=lazy` + 首屏 8 张 `fetchpriority=high` + `content-visibility:auto`；阅读时仍是原图。全库封面流量 5.3MB → 381KB。
- **进门三步**（每次导航后自动跑）：`#chk_cover`（18 岁）→ `#chk_guide`（Confirm Entry）→ `#chk_cover3`（公告 Close，可缺）；用 CDP 真实鼠标点，公告点不掉就隐藏它的容器。**不再乱点 `.close`**（会点到广告）。
- **App 端「 禁漫下载」弹窗**：顶部浏览器下拉（默认 Chrome，可切 Edge）+「打开浏览器」按钮（启动或前置，停在禁漫首页）；点弹窗外空白即关闭，**任务在后台继续**，日志留在内存，再打开还在。
- **登录**：自动点开登录框并用**真实鼠标点击**触发浏览器已保存账号的自动填充（+`ArrowDown`/`Enter` 兜底）；填不上就提示手动登录（`need-manual`）。
- **全库体检**：`check-library.py` → 输出 `体检报告.md`（缺简介/来源/作者、半截图、空目录、重复书、体积排行）。
- **`--from/--to`**：`run-albums.mjs` 支持只下指定话范围。
- **清理**：删掉 113 个一次性探针脚本（7.0 MB）；保留生产脚本 + `verify-page.mjs`（书库页面自检，16 项）。
