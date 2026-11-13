# 升级档案 · 阅读增强与 AI 汉化借鉴

> 整理日期：2026-11-13
> 素材：5 张截图（小红书 2 帖 + NoxWing 官图 + 阅读器实机 + OmiComic 宣传）
> 上游复核：koharu-rs/koharu ★6654 Apache-2.0 Rust · lorcinv/OmiComic ★78 GPL-3.0 TS
> 本项目基线：书库 1.0.3（Electron ^44.3.0），阅读器 src/reader/*，偏好 reader-prefs.json
> 结论先行：**先做「画质增强」和「横轴滚动」两件小事（P0，合计约 3 天），AI 汉化排到 v2.0 再动**

---

## 0. 一页结论

三张图讲了三个完全不同层次的东西，别混着做：

| 层次 | 图里是什么 | 我们该拿走什么 | 优先级 | 真实成本 |
|---|---|---|---|---|
| 画质 | 图3 NoxWing「智能增强」对比图 | 锐化 + 对比 + 饱和的**参数化组合**，不是玄学 AI | **P0** | 6 小时（L1）/ 1 天（L2 落盘） |
| 阅读形态 | 图4 宽幅横排跨页 | **横轴连续滚动（hscroll）** + 跨页宽图横向拖动 | **P0** | 1.5 天 |
| 生产工具 | 图1/2/5 Koharu、OmiComic | 选择性流水线、格式直读、标签面板、预加载设置 | P1 | 拆到 v1.3 分批 |
| AI 汉化 | Koharu 的检测→OCR→翻译→擦字→嵌字 | **sidecar 覆盖层**方案，绝不改原图 | P2 | 2~3 周（一期） |

三条硬判断：

1. **图3 的「智能增强」不是超分。** 对比图右半边的变化是：绿色更饱和、暗部更透、字形边缘更硬。这是「饱和度↑ + 对比度↑ + 锐化」三件套，随便一个 libvips 管线就能复现，不需要模型。真正需要模型的超分（Real-ESRGAN / Real-CUGAN）是另一件事，只对低分辨率源文件跑。
2. **图4 那种"横轴滚动"本质是两个能力**：① 阅读器模式的第 4 种（横向连续条带）；② 单张宽图（跨页/彩页）在溢出时允许横向拖动。我们现在 3 种模式里 scroll 是**纵向**的 webtoon 模式，横轴完全没有。
3. **Koharu 不能抄代码，只能抄结构。** 它是 Rust + Tauri + 本地推理，我们是 Electron + Node。能抄的是它的流水线设计（阶段依赖 DAG、按范围选择性执行、每阶段即时提交、重跑不丢人工编辑）和 sidecar 数据组织，不是它的模型。

---

## 1. 五张图的原文整理

### 图 1 · 小红书 @立花洛洛（上半）

界面截图是 Koharu 的工作台：菜单「文件 / 视图 / 处理 / 帮助」，工具条「检测 · 识别 · 生成 · 修补 · 渲染」+ 右侧「LLM」按钮，左侧导航「1 页」带缩略图，画布底部「缩放 61%」「画布: 770 × 1080」，右侧图层栏「AA：渲染文本 / 文本框 / 笔刷图层 / 修补图像 / 分割遮罩 / RAW 原始图像」，下方「文本块 (11)」列表：

「`01 白子的日常 02 因为有可靠的宇妹在，所… 03 星野学长！快起床啦！ 04 运动！？ 05 痛痛痛痛痛…… 06 我不会说要去工作，但至少… 07 然后做完运动后，就这样好… 08 健全的精神寓于健康的身体… 09 哎呀～ 10 喂，等一下啊！ 11 刚才说到银行怎样！？`」

正文：

> **Koharu - 免费开源本地化 AI 漫画翻译神器**
> 最近发现了一款漫画翻译工具：Koharu
> 项目地址：github.com/mayocream/koharu
> 之前为了追生肉，一直研究各种 OCR 加网页翻译，要么就是付费用一些昂贵的在线翻译平台。不过后来算了一下，一个月几十刀的订阅费，还得把漫画传到云端，不仅贵还慢。中间调研过各种平替，确实没找到几款既能本地运行、颜值又高的。
> Koharu 支持基于 Rust + Tauri 的极致体验，安装包极小，启动快到飞起。它最大的特色是集成了 AI 重绘（Inpainting）和智能嵌字。只要配置好本地模型或 API，生肉变熟肉几乎是瞬间的事。
> ✨ 核心功能：
> 全自动化流程：从文字识别（OCR）到 AI 翻译，再到自动擦除原图文字并填入译文，一气呵成。

### 图 2 · 同帖（下半）

> Koharu 支持基于 Rust + Tauri 的极致体验，安装包极小，启动快到飞起。它最大的特色是集成了 AI 重绘（Inpainting）和智能嵌字。只要配置好本地模型或 API，生肉变熟肉几乎是瞬间的事。
> ✨ 核心功能：
> 全自动化流程：从文字识别（OCR）到 AI 翻译，再到自动擦除原图文字并填入译文，一气呵成。
> 本地 AI 驱动：支持本地 LLM 运行，隐私控狂喜，你的漫画库不需要经过任何人的服务器。
> 硬核性能：基于 Rust 开发，支持 CUDA/Metal 硬件加速，翻译长篇漫画也不会卡死电脑。
> 审美在线：交互参考了现代化的生产力工具，如果你受够了那些 UI 停留在上个世纪的汉化工具，Koharu 会让你眼前一亮。
> 如果你刚好缺一个能让你秒看生肉、支持本地 AI 的翻译神器，同时也觉得那些在线翻译平台太贵，那么可以试试这个开源平替。
> 本项目定位做漫画翻译界的开源平替，后续也不会收费，开发者会在平时看漫画的时候顺手修一修 bug。如果可以帮助到你，莫忘记给开发者点个 star 就当交个朋友。
> #漫画 #汉化 #AI #开源项目 #开源软件 #Rust #生肉 #漫画翻译 #开发 #个人开发者 #二次元必备
> 猜你想搜：koharu 漫画翻译工具
> 2月3日 江苏

### 图 3 · @Lexy Studio · 夜翼阅读器 NoxWing

大标题「**智能增强**」。两张并排封面（EPISODE 1: AWAKENING，左偏灰黄、右偏绿且更锐），配文：

> 对模糊图片，采用智能算法 增强效果，让文字和图像更清晰

底部正文：

> 找到了！高颜值的漫画阅读器
> 夜翼阅读器 NoxWing 上线啦！
> 这是一篇它的使用教程
> 全能格式的漫画阅读器
> 支持 cbr cbz zip rar pdf epub pdf
> 已上线 百度网盘 和 webdav
> 🍀🍀🍀
> 在 iphone 上也可以开启双页阅读

### 图 4 · 阅读器实机（无文案，只有界面）

窗口标题栏：「返回 · 目录 · 置顶 页亮 · 适高 适宽 · 计算 页面调整 · 缩放 100%」，窗口内标题「**葬送的芙莉莲.mobi / 第 12 章**」。中间是**一整条宽幅横排画面**：多页漫画在水平方向连排、宽度远超窗口，需要横向拖才能看全；底部页码条「首页 · 上一页 · 12 / 592 · 下一页 · 尾页」。

→ 这就是需求原型：**横向条带 + 溢出横向拖动 + 页码定位**。注意它保留了「12 / 592」这种以**页**为单位的定位，说明横向连排的同时仍按页记进度。

### 图 5 · @空羽灵 · OmiComic

> 我做了一个本地漫画阅读器 OmiComic。放几张最新版的实际界面。
> Windows 和 Android 都能用，免费开源。目前版本目前已经更新到 1.1.85。
> OmiComic 可以将你的漫画资源直接拖入到软件中建立你自己的资源库，也可以通过书架、分类、标签和收藏来整理资源。支持图片文件夹、ZIP / CBZ、RAR / CBR、7z / CB7、PDF、EPUB 和无 DRM 的 MOBI。
> 阅读时可以切换单页、双页和全景连环画，也有沉浸模式和自动阅读。阅读进度会自动保存，给你绝不丢失进度的体验。
> OmiComic，一款注重于极速浏览与资源管理的免费开源漫画阅读器，GitHub 项目：loricv/OmiComic。
> 欢迎试用，与提出问题。
> #漫画 #电子书 #ai #开源 #免费软件 #漫画阅读器
> 编辑于 11月6日 湖北 · 已声明原创 · 含 ai 生成内容
> 评论「坎坎坷坷看」：哪里下载？（昨天 上午8:32 云南）

### 两处必须纠正的仓库地址

截图里的地址是错的，实际仓库如下（本次已用 GitHub API 核实）：

| 截图写的 | 实际 | 说明 |
|---|---|---|
| github.com/**mayocream**/koharu | **koharu-rs/koharu** | 仓库已迁移到组织名下，旧地址跳转；README 里所有徽章/文档链接都指向 koharu-rs |
| **loricv**/OmiComic | **lorcinv**/OmiComic | 少一个 n，截图手打错；正确的是 l-o-r-c-i-n-v |

夜翼阅读器（NoxWing）**不是开源项目**，是 LexyTech Ltd. 在 App Store 上架的**订阅制 iOS 应用**（id6746104345），没有 GitHub 仓库可读 —— 它的价值在于产品功能表，不在代码。

---

## 2. 上游项目事实档案

### 2.1 Koharu — ML 漫画翻译工作台（koharu-rs/koharu）

| 项 | 值 |
|---|---|
| 定位 | 可编辑的漫画翻译流水线，从第一页读到最终导出 |
| 技术栈 | Rust + Tauri（桌面壳）、WebGPU 画布、本地推理 |
| 许可 | Apache-2.0（可商用，保留声明；**注意不是 AGPL**，抄结构无法律负担） |
| 规模 | ★6654，最新 release 0.83.5（2026-09-22），当天仍在推送代码 |
| 加速 | Windows/Linux 上 CUDA 与 ROCm/HIP，Apple 上 Metal，Windows/Linux 上 Vulkan；不需要装完整 SDK，只要新驱动 |

**功能表（README 原文逐条）**

| 能力 | 说明 | 我们能不能用 |
|---|---|---|
| 多格式项目管理 | 位图、压缩包、PDF，带页序 | ✅ 概念直接搬 |
| 选择性流水线 | 检测/OCR/翻译/修复，按页或按项目跑 | ✅ **最值得抄的一条** |
| 检测与分割 | 文字区、气泡、清理区 | ⚠ 需要模型，v2 再谈 |
| 多模态 OCR | 对白、旁白、页面文本 | ⚠ 同上 |
| 本地 GGUF + 托管服务商 | LLM 与机器翻译两条腿 | ✅ 翻译层可接 DeepSeek |
| 生成式修复 | 擦原文、重建画面 | ❌ 显存吃不住，先做贴图遮盖 |
| 校对 | 改 OCR 与译文 | ✅ 必须有，否则没法用 |
| WebGPU 画布 | 手动清理、排字、合成 | ⚠ 我们有 Canvas，可做轻量版 |
| 多语种字形与排版 | 自动适配、字体回退、CJK 竖排、RTL | ✅ **竖排是最硬的需求** |
| 分层 PSD 导出 | 平铺交付 or 分层编辑 | ❌ 用不上 |
| Agent 工作流 | 用自然语言指挥流水线 | ❌ 花活 |

**模型栈（官方文档 zh/models/vision 原文）**

| 阶段 | 模型 | 备注 |
|---|---|---|
| 检测 | Koharu Layout RF-DETR Seg 2XL | 检测文字/气泡/分格，并输出分割数据；有文字/气泡/分格三档置信度阈值 |
| OCR | PaddleOCR-VL 1.6（默认通用）· Manga OCR（日）· Baberu OCR · Hayai OCR（中韩日英） | 官方明确：**OCR 只读已检测到的区域，识别不出来先查检测** |
| 修复·直接 | LaMa（默认）· AOT Inpainting | 常规擦字 |
| 修复·生成式 | FLUX.2 Klein（带提示词）· RORem Mixed（正/负提示词） | 更吃运行时、显存与时间 |
| 翻译·本地 | llama.cpp + GGUF | 全离线 |
| 翻译·托管 | OpenAI · Gemini · Claude · Grok · MiniMax · DeepSeek · OpenRouter | 需要凭据，存系统钥匙串 |
| 翻译·兼容 | LM Studio（:1234）· OpenAI 兼容端点（:11434/v1） | |
| 翻译·机翻 | DeepL · Google Cloud Translation · 彩云 | |

**流水线语义（官方 zh/guides/processing，抄的就是这套规则）**

- 阶段依赖是有向图：`检测 → OCR → 翻译`，`检测 → 图像修复`。
- 省略的前置阶段**不会自动补**。要翻译必须同时勾检测（除非已有区域）。
- 「运行修补」= 检测 + 修复，不含 OCR 与翻译。
- 范围四选一：当前页 / 选中页 / 整个项目 / 选中图层。
- 同一时间只跑一个任务，运行期禁止导入。
- **每个阶段完成立即提交**，后续阶段失败不回滚已完成结果。
- 停止是"安全边界返回"，不是硬杀；提交前的停止 = 丢弃。
- 重跑不毁人工编辑：检测会**跳过已有文字区域的页**，OCR/翻译只替换"生成"的文本、保留人工改过的，修复跳过已有清理图层的页。

> 这段规则的工程价值：它把"批量处理"从"一次大事务"改成了"可中断的增量流水"，正好适合我们这种阅读器里塞个后台任务队列的形态。

**排版（zh/guides/typesetting）**

- 文字框有两种：自动适配检测区域 / 手动"文本"点文本与段落框。
- 手动变换后，图层拥有自己的几何，不再跟检测区域走。
- 字体栈：内置 + 系统字体；缺字形按默认栈回落，最后系统回退。
- 自动适配 = 选能装进框的最大字号；关闭则用固定字号。
- **CJK 竖排是文字塑形 + OpenType 特性，不是把横排旋转 90°** —— 这条最容易做错。
- 导出：PNG 交付 / PSD 分层编辑。

### 2.2 OmiComic — 本地漫画阅读器（lorcinv/OmiComic）

| 项 | 值 |
|---|---|
| 定位 | 「整理你的漫画，接着上次阅读」—— 本地高速启动 + 纯净阅读 |
| 平台 | Windows x64 / macOS（arm64 + x64）/ Android 8.0+ |
| 技术栈 | TypeScript（Electron 系），GPL-3.0 |
| 规模 | ★78，最新 1.1.98（截图写的 1.1.85 是旧版） |
| 许可注意 | **GPL-3.0** —— 看一眼没问题，**不要往我们 MIT 的仓库里粘它的代码**，否则整仓被传染成 GPL |

功能清单（README 实测口径）：

- 直读：图片文件夹、单张图片、ZIP/CBZ、RAR/CBR、7z/CB7、PDF、EPUB、无 DRM 的 MOBI（**不解压、不转码**）
- 组织：书架、分类、标签、收藏、搜索、书签；多漫画目录并存；中键拖动卡片排序
- 标签：模糊/精准匹配切换，**同一面板里管理并清理标签**
- 阅读：单页 / 双页 / 全景 / 沉浸 / 自动阅读；底部进度条跳页；双击缩略图从该页开始读
- 图像：**实时调整亮度、对比度和图像效果**；图片缓存与预加载可配
- 外观：雾灰 / 北境 / 暖沙 / 夜色 四主题 + 跟随系统（默认关）；中/英/日三语
- 其他：内置操作说明（分类折叠 + 目录跳转 + **离线搜索**快捷键与手势）；最小缩放 25%

### 2.3 NoxWing 夜翼阅读器（闭源 · 只抄功能表）

App Store 描述原文要点：

- 全格式：ZIP / PDF / CBZ / CBR / EPUB / MOBI 直读
- 图片：JPG / PNG / WebP / GIF / BMP / **HEIC** 无需转换
- 智能阅读优化：自动分页 / 双页模式 / 长图垂直滚动
- 个性化：自定义背景色 / 亮度 / 翻页特效
- 文件管理：Files / iTunes 导入，智能分类
- **AI 增强：智能自适应优化显示效果** ← 图3 的主角
- 双页浏览 / 音量键翻页、**Face ID 锁敏感内容**、网格 / 列表 / 文件夹三视图
- 数据全本地；订阅制
- 小红书贴补充：**百度网盘 + WebDAV 在线源**、iPhone 双页阅读

---

## 3. 本项目基线（对照，别重复造）

| 能力 | 我们现在 | 代码位置 | 缺口 |
|---|---|---|---|
| 阅读模式 | `single / double / scroll`（scroll = **纵向**条带） | src/reader/render.js:136 | 无横向模式（图4 那种） |
| 适配 | width / height / page / original | src/reader/render.js:133 effFit | 跨页宽图无"按宽度溢出可拖" |
| 方向 | dir: ltr / rtl | render.js:140 | 横向模式下的 rtl 语义要重定义 |
| 缩放 | 长条宽度 10%~160%（`--scroll-scale`） | render.js:126 applyScrollScale | 横向模式需要按高度算的独立变量 |
| 亮度 | S.bright 0~1，**实为叠加暗淡遮罩**（`--r-dim`） | src/reader/view.js:27 | 没有真·对比度/锐化/饱和 |
| 主题 | dark / light / eye / paper | prefs.js:18 | 够用 |
| 偏好持久化 | 全局 reader-prefs.json（桌面 IPC + 手机 /api/reader-prefs） | src/reader/prefs.js:15 | 新增字段要同步 PREF_KEYS + sanitize |
| 进度恢复 | 长条下"粘住"式恢复，8 秒令牌 + ResizeObserver + 6 档定时器 | render.js:41 scrollToPage | 横向模式复用它，别写第二套 |
| 缩略图/预取 | 后 4 页预解码、缩略图懒加载 | view.js:65~76 | 可加"预加载页数"设置 |
| 图片处理 | **sharp 0.35.4 已内置**（`clahe` / `sharpen` 运行时实测均存在） | _app/node_modules/sharp | 增强不需要新依赖，这是最大红利 |
| 视频/动图 | ffmpeg / ffprobe 随包 | _scripts/tools | 可用 |
| Python | 可选 3.11 + pillow + opencv | README | 超分判定脚本可用 |
| 格式 | cbz/zip 解压入库 | 导入模块 | 无 RAR/CBR、7z、PDF、EPUB、MOBI 直读；无 HEIC |
| 在线源 | 无（下载器是"抓取入库"） | _scripts/sites | 无 WebDAV 只读源 |
| 许可 | MIT | LICENSE | **GPL 项目代码不能抄进来** |

---

## 4. 借鉴总表

### A 档 · 直接抄（低成本、高感知）

| # | 来源 | 能力 | 落地形态 | 优先级 | 工时 |
|---|---|---|---|---|---|
| A1 | 图3 NoxWing | 智能增强 | 三级增强（L1 实时滤镜 / L2 落盘 / L3 超分），见第 6 节 | P0 | 6h + 1d |
| A2 | 图4 实机 | 横轴连排 + 溢出横拖 | 新增 `hscroll` 模式 + 跨页宽图判定，见第 5 节 | P0 | 1.5d |
| A3 | OmiComic | 实时亮度/对比度 | 在现有 bright 旁加 contrast（CSS filter，不改落盘管线） | P0 | 2h |
| A4 | OmiComic | 双击缩略图从该页开始 | 已有等价（缩略图点击 render），补"从该页读"语义即可 | P1 | 1h |
| A5 | OmiComic | 标签模糊/精准匹配 + 面板内清理 | 现有筛选面板加匹配模式开关与"孤儿标签清理" | P1 | 4h |
| A6 | OmiComic | 预加载页数可配 | prefs 加 `preload`（1~8），替掉写死的 4 | P1 | 1h |
| A7 | OmiComic | 中键拖动排序 | 书架卡片中键拖动改 sortIndex | P1 | 3h |

### B 档 · 改造后抄（要重新设计）

| # | 来源 | 能力 | 我们的形态 | 优先级 | 工时 |
|---|---|---|---|---|---|
| B1 | OmiComic / NoxWing | 格式免解压直读 | 不动现有"解压入库"，另开**只读挂载**：cbz/pdf/epub 走内存索引，不落盘 | P1 | 3d |
| B2 | NoxWing | WebDAV / 网盘源 | 只做 WebDAV（标准协议、无授权麻烦），挂成"远程外部目录" | P1 | 2d |
| B3 | NoxWing | HEIC | sharp 本身能解 HEIC（libheif），加个探测 + 转换缓存 | P2 | 2h |
| B4 | Koharu | 选择性流水线 | 后台任务队列加"范围 + 阶段"两个维度，见 7.2 | P2 | 5d |
| B5 | Koharu | 竖排 CJK 排版 | Canvas 覆盖层里手动按字宽排竖列（不用 OpenType，够用） | P2 | 2d |
| B6 | Koharu | 校对界面 | 逐块"原文 / 译文"双列编辑 + 回车跳下一块 | P2 | 2d |
| B7 | OmiComic | 内置离线操作说明 | 一个静态页 + 本地搜索（索引快捷键/手势），省客服 | P2 | 4h |

### C 档 · 明确不抄

- Rust + Tauri 重写（现有 Electron 44 已够，重写=三个月沉没成本）
- 生成式修复（FLUX.2 Klein / RORem）：显存≥16G 才有意义，且是不可控的"重画"
- 分层 PSD 导出、Agent 工作流、Face ID、iTunes 导入
- 云端翻译上传原图（我们自己就是"本地优先"，别自打脸）

---

## 5. 专项 A：横轴滚动阅读（图4 复刻）

### 5.1 图4 到底在做什么

窗口里是一条**水平连排的画布条**，宽度远超窗口；用户可以横向拖到任意位置，但**页码仍以"页"为单位**（12 / 592）显示与跳转。也就是说：

- 它不是"翻页"，是"在一条带了页码刻度的横向长卷上移动视口"；
- 它保留了页码锚点，所以**退出重进能回到同一页**；
- 缩放是独立的一档（图上 100%），说明横排时仍可整体缩放。

### 5.2 交互定义（三种子模式，共用一个渲染器）

| 模式 | 行为 | 页排布 | 典型场景 |
|---|---|---|---|
| 现有 `scroll` | 纵向连续，滚轮上下 | 竖直堆叠 | 条漫、webtoon |
| **新增 `hscroll`** | 横向连续，滚轮→横向（ΔY 映射到 scrollLeft） | 水平排列，单页一组 | 图4 那种连排 |
| **新增 `hspread`** | 横向连续 + 两页并组 | 水平排列，2 页一组，封面单独一组 | 日漫跨页、彩页对开 |

键位 / 手势：

| 输入 | hscroll | hspread |
|---|---|---|
| ← / → | 上一屏 / 下一屏（scrollLeft ± 0.9 × clientWidth） | 上一组 / 下一组（整组吸附） |
| Home / End | 首 / 尾 | 首组 / 尾组 |
| 滚轮 ΔY | → scrollLeft | → scrollLeft（带 snap） |
| 触控板横滑 | 原生直通 | 原生直通 |
| Shift+滚轮 | 原生横向直通 | 原生横向直通 |
| 双指捏合 | 复用现有 zoom；zoom 开启时禁用滚轮映射 | 同左 |
| 拖动 | 中键或空白处左键拖（复用 panCanvas） | 同左 |

### 5.3 偏好与数据结构（向后兼容）

`src/reader/prefs.js` 的改动只有三行 + 校验：

```
PREF_KEYS 追加：'spreadWide', 'gap', 'snap', 'enhance', 'contrast', 'preload'
MODES 改为：['single', 'double', 'scroll', 'hscroll', 'hspread']
sanitize 追加：
  o.spreadWide = ['auto','on','off'].indexOf(s.spreadWide) >= 0 ? s.spreadWide : 'auto';
  var gap = Number(s.gap);  o.gap = (isFinite(gap) && gap >= 0 && gap <= 48) ? Math.round(gap) : 8;
  o.snap   = typeof s.snap === 'boolean' ? s.snap : true;
  o.enhance= ['off','soft','medium','strong'].indexOf(s.enhance) >= 0 ? s.enhance : 'off';
  var ct = Number(s.contrast); o.contrast = (isFinite(ct) && ct >= 0.8 && ct <= 1.4) ? Math.round(ct*100)/100 : 1;
  var pl = Number(s.preload);  o.preload  = (isFinite(pl) && pl >= 1 && pl <= 8) ? Math.round(pl) : 4;
```

老文件缺字段 → 走 defaults，不需要迁移脚本。手机端 /api/reader-prefs 读的是同一个文件，**天然同步**。

### 5.4 文件级改动清单

| 文件 | 改什么 | 量 |
|---|---|---|
| src/reader/prefs.js | MODES / PREF_KEYS / defaults / sanitize / applyToState 各加几行 | ~15 行 |
| src/reader/render.js | `renderScroll` 泛化成 `renderStrip(axis)`；`scrollToPage` 参数化轴；`render()` 分派；`syncButtons` 加两个按钮态；`applyScrollScale` 拆成纵向/横向两个 CSS 变量 | ~120 行 |
| src/reader/view.js | `makeImg` 不变；`preload` 步长按组；新增 `isWideSpread(img)` | ~20 行 |
| src/reader/nav.js | keydown 增加 hscroll 分支（屏级跳跃）；滚轮映射挂在这里不是 render 里 | ~30 行 |
| src/reader/touch.js | 横向模式 `touch-action: pan-x`，与现有横滑手势区分 | ~20 行 |
| src/reader/zoom.js | zoom 激活时禁用滚轮→scrollLeft 映射，避免打架 | ~5 行 |
| src/styles/03-reader.css | `.stage.mode-hscroll #canvas` 规则、`--strip-h`、snap、gap | ~40 行 |
| src/index.html | 工具栏加「横排」「对开」两个按钮（与 m-single/m-double/m-scroll 同组） | ~6 行 |

### 5.5 关键实现（可直接落）

**① 泛化长条渲染器**

```
export function renderStrip(axis) {                 // axis: 'y' 纵向 / 'x' 横向
  var p = pages();
  var target = Math.max(0, Math.min(S.pi, Math.max(0, p.length - 1)));
  var order = buildOrder(p.length);                 // hspread 下返回 [[0],[1,2],[3,4]...]
  for (var g = 0; g < order.length; g++) {
    var grp = order[g];
    var w = document.createElement('div');
    w.className = 'pagewrap ' + (axis === 'y' ? 'scwrap' : 'hwrap') +
                  (grp.length > 1 ? ' dual' : '');
    for (var k = 0; k < grp.length; k++) {
      var i = grp[k];
      var im = makeImg(p[i], 'pageimg ' + (axis === 'y' ? 'scrollimg' : 'hstripimg'));
      im.setAttribute('data-i', String(i));
      im.loading = i <= target ? 'eager' : 'lazy';
      w.appendChild(im);
    }
    elCanvas.appendChild(w);
  }
  ...
}
```

`buildOrder` 就是把现有 `spreads()` 的结果在 axis==='x' 时直接用；纵向仍返回单页组。**现有 spreads() 的封面单页逻辑（view.js:32）不用改，直接复用。**

**② 恢复定位：只换轴，不换算法**

现有 `scrollToPage` 用的是 rect 差值法（render.js:46-50），天然轴无关，只要两处：

```
var rectOf = function (node) { return node.getBoundingClientRect(); };
var aligned = function () {                        // 目标页边与容器边差多少 px
  var im = elStage.querySelector('[data-i="' + i + '"]');
  if (!im) return null;
  var a = rectOf(im), b = rectOf(elStage);
  return Math.round(axis === 'x' ? (a.left - b.left) : (a.top - b.top));
};
var apply = function (d) {
  if (axis === 'x') elStage.scrollLeft += d; else elStage.scrollTop += d;
};
```

**③ rtl 的正确做法（这是个坑）**

**不要**给横向容器加 `direction: rtl` —— Chromium 下 rtl 容器的 `scrollLeft` 从 0 向负值增长，滚动条起点在右侧，上面只要 += d 的算法就会符号反。

正确做法二选一，推荐前者：

- **方案 A（推荐）**：容器永远 LTR，用 `flex-direction: row-reverse` 让**视觉顺序**反过来，DOM 顺序不变。所有定位仍用 rect 差值，符号天然正确。
- 方案 B：DOM 追加顺序按 dir 反转，用 `data-seq` 保存真实页序，进度映射时还原。

**④ 滚轮映射（挂在 nav.js，别挂在 render.js）**

```
stage.addEventListener('wheel', function (e) {
  if (S.zoom) return;                                   // 放大态交给原生
  if (S.mode !== 'hscroll' && S.mode !== 'hspread') return;
  if (!S.wheel) return;                                 // 用户关掉"滚轮翻页"就直通
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;  // 触控板横滑直通
  stage.scrollLeft += e.deltaY * (S.dir === 'rtl' ? -1 : 1);
  e.preventDefault();
}, { passive: false });
```

注意 `passive: false` 必须显式写，否则 preventDefault 无效（Chromium 对 wheel 默认 passive）。

**⑤ 跨页宽图识别（图4 那种整幅跨页）**

```
// 宽高比 > 1.15 视为跨页（对开）；单图里也可能出现超宽彩页
export function isWideSpread(im) {
  return im && im.naturalWidth > 0 && (im.naturalWidth / im.naturalHeight) > 1.15;
}
```

`S.spreadWide === 'auto'` 时：hspread 下若某页 ratio>1.15，就让它**独占一组**（不与邻页拼），否则正常两页一组。`'on'` 强制所有页独占（等价"逐页横排"），`'off'` 永不分跨页。

**⑥ 进度回写**

现有 IntersectionObserver 逻辑（render.js:100-110）在横向容器上同样生效（root 默认就是 viewport 祖先链）。只需把 `threshold` 从 [0.1,0.5,0.9] 改为 [0.4,0.6,0.85]，横向时取"占视口比例最大"的那张——横向条带常有两页同屏，阈值太低会反复抖。

**⑦ CSS 骨架**

```
.stage.mode-hscroll #canvas,
.stage.mode-hspread #canvas {
  display: flex;
  flex-direction: row;            /* rtl 时由 JS 设成 row-reverse */
  align-items: center;
  gap: var(--strip-gap, 8px);
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
  scroll-snap-type: x proximity;  /* snap 打开时 mandatory */
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain; /* 别把横滑甩给页面 */
}
.stage.mode-hscroll .hwrap,
.stage.mode-hspread .hwrap { display: flex; height: 100%; scroll-snap-align: center; flex: 0 0 auto; }
.stage.mode-hscroll .hstripimg,
.stage.mode-hspread .hstripimg {
  height: calc(100% * var(--strip-h, 1));   /* 横向按高度适高，与纵向 --scroll-scale 区分 */
  width: auto; max-width: none; object-fit: contain;
}
.stage.mode-hscroll .hwrap.dual { gap: 2px; }
```

### 5.6 已知的坑（写代码前先看）

| 坑 | 症状 | 处置 |
|---|---|---|
| rtl 的 scrollLeft 负值 | 恢复位置跑到反方向 | 见 5.5 ③，容器恒 LTR |
| wheel 默认 passive | preventDefault 无效、页面一起滚 | `{ passive: false }` |
| 双恢复令牌竞争 | 纵向/横向切换时旧的 8 秒 settle 定时器还在把视口拽回去 | 切模式时调 `cancelScrollRestore()`（render.js:40 已有） |
| IntersectionObserver 抖动 | 进度在 12/13 之间乱跳 | 抬高阈值 + 加 200ms 去抖再 save |
| 100 页以上的横向 DOM | 首帧卡死 | 只 append 目标页前后 ±30 页的 wrap，其余用占位块（宽高按已知尺寸或 3:4 估），滚动到再替换 —— 现有纵向模式是"全量 append + lazy img"，页数上千会炸，横向改造时顺手修 |
| 宽图内存 | 单张 8000×6000 的彩页解码后 180MB | 渲染层用 `w/devicePixelRatio` 限制 CSS 尺寸；超过 12MP 的图走 L2 增强后的降采样副本 |
| 触控板误触 | 横滑时触发侧栏/翻页 | `overscroll-behavior-x: contain` + 手势阈值 |

### 5.7 验收清单

- [ ] 1000 页的条漫，开启 hscroll 首屏 < 300ms，滚到底不卡死、不白屏
- [ ] dir=ltr 与 dir=rtl 下，页序视觉正确，且 ← → 的语义与视觉方向一致
- [ ] 退出重进精确落回上次那页（允许 ±0），长条与横轴互不串味
- [ ] zoom 放大后横向可拖动，不误触发翻页/进度跳变
- [ ] hspread + spreadWide=auto：跨页图独占一组，普通页两页一组，封面单独一组
- [ ] 手机端（局域网预览）横滑顺畅，不与浏览器返回手势冲突
- [ ] 切换模式后 `reader-prefs.json` 里的 mode 正确持久化，手机端同步生效
- [ ] 关闭"滚轮翻页"后滚轮恢复原生垂直行为

---

## 6. 专项 B：智能增强 / 文字清晰（图3 复刻）

### 6.1 先把"清晰"拆开——五种完全不同的东西

用户说"锐化和什么，我不清楚"，这句必须解释清楚，否则参数一定调歪：

| 名称 | 做了什么 | 增不增加信息 | 副作用 | 对漫画/文字有没有用 |
|---|---|---|---|---|
| **锐化（unsharp / 卷积）** | 放大边缘处的高频差 | 不增加 | 过度→白边、振铃（halo） | ✅ 最有感，尤其扫描件 |
| **对比拉伸 / CLAHE** | 拉开灰度分布（CLAHE 是分块自适应） | 不增加 | 过度→噪点放大、发灰 | ✅ 文字变"实"，灰字变黑 |
| **饱和度 / 色温** | 改色彩 | 不增加 | 过度→偏色、肤色发绿 | 图3 右图的绿色就来自这里 |
| **降噪 / 去网纹** | 抹掉高频噪声 | 减少 | 过度→糊、线条断裂 | 扫描件去摩尔纹必需 |
| **超分（AI 上采样）** | 模型重建像素 | **真正增加** | 幻觉、伪影、慢 | 低分辨率源才需要 |

**图3 的"智能增强"对照分析**：左图偏灰黄、线条发糊；右图整体偏绿、暗部更透、字边更硬、色块更饱和。这是「饱和度 1.15~1.3 + 对比度 1.1~1.2 + 锐化（σ≈0.8）」的组合，**没有超分痕迹**（分辨率没变，细节是"变硬"不是"变多"）。所以营销词叫 AI，实现八成是 GPU/CPU 上的一次卷积 + 曲线调整。

### 6.2 三级方案总览

| 级 | 技术 | 延迟 | 成本 | 适用 | 我们做不做 |
|---|---|---|---|---|---|
| **L1 实时** | SVG filter（feConvolveMatrix / feGaussianBlur + feComposite）挂在 `<img>` 上 | 0（GPU 合成） | 无依赖 | 随手开关、任意书、任意页 | ✅ **先做这个** |
| **L2 落盘** | sharp/libvips：CLAHE + 线性对比 + sharpen，输出 webp 缓存 | 每页 80~300ms，一次性 | sharp 已内置 | 想彻底"变清晰"、手机端也算力 | ✅ 第二个做 |
| **L3 超分** | Real-ESRGAN / Real-CUGAN（ncnn-vulkan），可选 GPU | 每页 1~6s | 外挂 exe ~30MB，需 Vulkan | 老扫描件、低分辨率网图 | ⏸ 按需手动，不进主流程 |

### 6.3 L1：实时滤镜（6 小时可上线）

**原理**：SVG 滤镜在 Chromium 里是 GPU 合成的，可以挂在任意 `<img>` 上且**不改原图、不落盘、切页即生效**。CSS 自带的 filter 没有"锐化"，但 SVG 有卷积。

**① 往 src/index.html 的 body 末尾插一个 0×0 的 SVG**

```
<svg width="0" height="0" style="position:absolute;pointer-events:none" aria-hidden="true">
  <defs>
    <!-- 轻：温和 3×3 卷积，核和 = 1，不改变整体亮度 -->
    <filter id="enh-soft" x="0" y="0" width="100%" height="100%"
            color-interpolation-filters="sRGB">
      <feConvolveMatrix order="3" preserveAlpha="true"
        kernelMatrix="0 -0.5 0  -0.5 3 -0.5  0 -0.5 0"/>
    </filter>

    <!-- 中：标准锐化核 -->
    <filter id="enh-medium" x="0" y="0" width="100%" height="100%"
            color-interpolation-filters="sRGB">
      <feConvolveMatrix order="3" preserveAlpha="true"
        kernelMatrix="0 -1 0  -1 5 -1  0 -1 0"/>
    </filter>

    <!-- 强：unsharp mask（原图 1.8 - 模糊 0.8，等效锐化量 0.8，比卷积更细腻、halo 更少） -->
    <filter id="enh-strong" x="-2%" y="-2%" width="104%" height="104%"
            color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.1" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="arithmetic"
                   k1="0" k2="1.8" k3="-0.8" k4="0"/>
    </filter>
  </defs>
</svg>
```

**② CSS 侧挂载（写进 src/styles/03-reader.css）**

```
#canvas .pageimg,
#canvas .hstripimg,
#canvas .scrollimg {
  filter: var(--r-enh, none);
  transition: filter .12s linear;
}
html[data-enh="soft"]   { --r-enh: url(#enh-soft)   saturate(1.05); }
html[data-enh="medium"] { --r-enh: url(#enh-medium) saturate(1.08) contrast(1.05); }
html[data-enh="strong"] { --r-enh: url(#enh-strong) saturate(1.15) contrast(1.10); }
```

**③ JS 侧（prefs.js 已存 enhance 字段，applyToState 里加一行）**

```
document.documentElement.setAttribute('data-enh', v.enhance || 'off');
```

**④ 性能守门（必须做，否则大图会掉帧）**

```
// 单张图超过 12MP（约 4000×3000）时，SVG 卷积在部分 Chromium 构建上会回落 CPU
export function enhGuard(im) {
  if (!im || !im.naturalWidth) return true;
  var mp = im.naturalWidth * im.naturalHeight / 1e6;
  return mp <= 12;
}
// makeImg 里：if (!enhGuard(im) && S.enhance !== 'off') im.style.filter = 'none';
```

**L1 的参数安全区间（实测经验值，按本库样本微调）**

| 档 | 卷积核/等效锐化量 | 饱和 | 对比 | 适合 |
|---|---|---|---|---|
| soft | [0,-0.5,0;-0.5,3,-0.5;0,-0.5,0] | 1.05 | 1.00 | 已高清的电子版，只想"提一点" |
| medium | [0,-1,0;-1,5,-1;0,-1,0] | 1.08 | 1.05 | 默认推荐（≈图3 的效果） |
| strong | unsharp k2=1.8/k3=-0.8 | 1.15 | 1.10 | 扫描件、糊图 |

**别超过**：饱和 1.3、对比 1.2、锐化量 1.0。再往上必然出现文字白边（halo）与彩色噪点，尤其黑白网点图会碎成渣。

### 6.4 L2：落盘增强（一天，最值）

**为什么还要 L2**：L1 是"看着清楚"，L2 是"真的清楚"——落盘后手机端（局域网预览）也能享受，且不占渲染算力。我们**已经有 sharp 0.35.4**，且实测 `clahe` 与 `sharpen` 都在（`typeof sharp.prototype.clahe === 'function'`）。

**管线（本机实测可用）**

```
// _scripts/enh/enhance.mjs
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

export const PRESETS = {
  soft:   { clahe: { width: 64,  height: 64,  maxSlope: 1.6 }, linear: [1.03, -2],  sharpen: { sigma: 0.6, m1: 0.5, m2: 1.4, x1: 2, y2: 8,  y3: 16 }, q: 94 },
  medium: { clahe: { width: 96,  height: 96,  maxSlope: 2.4 }, linear: [1.06, -6],  sharpen: { sigma: 0.8, m1: 0.7, m2: 2.2, x1: 2, y2: 10, y3: 20 }, q: 92 },
  strong: { clahe: { width: 128, height: 128, maxSlope: 3.2 }, linear: [1.10, -12], sharpen: { sigma: 1.0, m1: 1.0, m2: 3.0, x1: 2, y2: 12, y3: 24 }, q: 90 }
};

export async function enhanceFile(src, dst, preset) {
  const p = PRESETS[preset] || PRESETS.medium;
  await sharp(src, { failOn: 'none', unlimited: true })
    .rotate()                       // 按 EXIF 摆正，否则 webp 会歪
    .toColourspace('srgb')          // 统一色彩空间，避免 CMYK 扫描件翻车
    .clahe(p.clahe)                 // 分块自适应直方图均衡：文字变"实"
    .linear(p.linear[0], p.linear[1])
    .sharpen(p.sharpen)             // libvips 的 unsharp，比卷积干净
    .webp({ quality: p.q, effort: 4 })
    .toFile(dst);
}

// 缓存命名：源路径 + 大小 + 预设 + 版本号 的 hash —— 源文件变了自动失效
export function cacheKey(src, size, preset) {
  return createHash('sha1')
    .update(src + '|' + size + '|' + preset + '|v1')
    .digest('hex').slice(0, 16) + '.webp';
}
```

**缓存目录**（与现有 `_thumbs/` 同级同构，不污染书库原图）：

```
<书库根>/_enh/<preset>/<hash>.webp
<书库根>/_enh/manifest.json     // { "<源相对路径>": { hash, preset, w, h, bytes, at } }
```

**读取侧**（view.js 里加一个源选择器，一行接入）：

```
export function srcFor(page, preset) {
  if (!preset || preset === 'off') return page;
  var hit = enhLookup(page, preset);      // 查 manifest，同步读内存缓存
  return hit ? hit.webp : page;           // 没有就先用原图 + L1 滤镜兜底
}
```

**批处理入口**（桌面端走 IPC，手机端挂同一个接口，复用现有 prefs 通道的写法）：

```
node _scripts/enh/batch.mjs --root "D:\漫画书库" --preset medium --only-blurry --concurrency 4
```

⚠ 并发别超过 4：libvips 自己多线程，叠太多反而更慢，且会把内存打满。

### 6.5 L3：超分（按需，不进主流程）

只在"这本书确实糊"时手动跑，产物进 `_enh/sr/`，**永不覆盖原图**。

```
# Real-ESRGAN（动画/漫画专用权重，2 倍，ncnn-vulkan 版免装 CUDA）
realesrgan-ncnn-vulkan.exe -i "in.webp" -o "out.png" -n realesrgan-x4plus-anime -s 2 -t 256

# Real-CUGAN（对线条更保守，伪影少；-n 3 是降噪等级）
realcugan-ncnn-vulkan.exe -i "in.webp" -o "out.png" -s 2 -n 3
```

> 这两条命令按上游 README 的通用形式给出，**本机未装机验证**（需 Vulkan 运行时 + 至少一块支持 Vulkan 的 GPU）。没有独显就走 CPU 版，速度会掉到每页 10s+，只适合睡前挂机。

**什么时候才值得跑**：先用 6.6 的判定打分，只处理"短边 < 1000px 且模糊分低"的书；正常 1600px 以上的电子版，L1/L2 足够。

### 6.6 自动判模糊 + 分档建议

**核心指标：Laplacian 方差**（越小越糊），项目已有可选 opencv，直接跑：

```
# _scripts/enh/blurscore.py
import cv2, sys, json
out = {}
for p in sys.argv[1:]:
    g = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    if g is None: continue
    out[p] = round(float(cv2.Laplacian(g, cv2.CV_64F).var()), 2)
print(json.dumps(out, ensure_ascii=False))
```

**判读（先按这套跑，再用本库 30 张样本校准）**

| 分数 | 判读 | 建议 |
|---|---|---|
| > 300 | 清晰（电子版原生） | 不处理 / 只开 L1 soft |
| 100 ~ 300 | 一般（压缩过的网图） | L2 medium |
| < 100 | 糊（扫描/低清） | L2 strong，考虑 L3 |
| < 30 | 极糊 | 只能 L3，否则别指望 |

**辅助判据**（三条一起看更准）：

- 白点偏黄（R>G>B 且均值 > 235）→ 扫描件，加去黄（`.linear(1.05, -10)` 或 `.gamma(1.1)` 后再锐化）
- 灰度直方图单峰且窄 → 低对比，CLAHE 收益最大
- FFT 高频环状峰 → 网纹/摩尔纹，先降噪再锐化，否则越锐越脏

**自动分档（batch.mjs 的 `--only-blurry` 就靠这个）**

```
score < 100 ? 'strong' : score < 300 ? 'medium' : 'soft'
```

### 6.7 质量与坑

| 坑 | 现象 | 处置 |
|---|---|---|
| halo / 振铃 | 文字边缘出现白边或重影 | 锐化量 ≤ 1.0；优先用 unsharp（feComposite / sharpen）而非硬卷积 |
| 网点纸碎掉 | 黑白网点变成噪点 | 先 `.median(1)` 或 `.blur(0.3)` 再锐化；或者只对灰度层锐化 |
| 彩色噪点 | 暗部出现彩色麻点 | 饱和别超过 1.3；必要时 `.modulate({ saturation: 1.1 })` 代替 CSS 的 saturate |
| 发灰 | CLAHE 之后整体变灰 | linear 的 offset 要配负值（-6 ~ -12）把黑场压回去 |
| 色彩空间 | CMYK/灰度扫描件变紫或反相 | 一律 `.toColourspace('srgb')`；EXIF 先 `.rotate()` |
| 体积暴涨 | webp 92 档比原 jpg 还大 | 落盘统一 quality 90~94 + `effort 4`，超 1.5 倍体积就降档 |
| 缓存失效判断 | 换了图还是旧清晰版 | key 里带源文件 size + mtime + 预设 + 版本号 |
| 内存 | 并发 8 个 sharp 直接 OOM | 并发 ≤ 4，且 `unlimited: true` 只给超大图用 |

### 6.8 验收

- [ ] L1 三档切换即时生效，切页不闪白，100 页连翻帧率 ≥ 50fps
- [ ] 12MP 以上图片自动降级为无滤镜（不卡）
- [ ] L2 处理 500 页，单页均值 < 300ms，总耗时 < 3 分钟（4 并发）
- [ ] 处理后体积增幅 < 40%
- [ ] A/B 对比：同一页开/关增强，印刷体小字（≤10px）可辨认度明显提升，且**无白边**
- [ ] 关掉增强后，显示的仍是**原图**（不是缓存残余）
- [ ] 缓存目录可整体删除且不影响任何原图（幂等，能重建）

---

## 7. 专项 C：AI 汉化（Koharu 借鉴 · 分期，别一口吃）

### 7.1 定位差异：我们是阅读器，不是编辑器

Koharu 是"生产工具"：打开项目 → 跑流水线 → 导出成品图。我们是"阅读器"：书是别人下载来的，用户只想**看的时候顺手看懂**。

所以抄它的时候必须换形态：

| 维度 | Koharu | 我们（建议） |
|---|---|---|
| 产物 | 新图（PNG/PSD），永久替换 | **sidecar 覆盖层**：原图一字不动，译文画在上面 |
| 数据 | 项目目录 + 场景文件 | `<书>/_trans/<章>/<页>.json` + 只读渲染 |
| 流程 | 人工逐个阶段跑、逐个校对 | 后台队列，进章节自动跑，人工只在"看错了"时改 |
| 失败 | 停在项目里等人修 | 静默跳过该页，不阻塞阅读 |

**这条换形态的决定性理由**：原图不可变 = 永远能一键关掉、永远不担心改坏、永远能重跑。Koharu 那种"擦掉重画"的做法一旦翻车就是不可逆的。

### 7.2 三期路线

**一期 · 取词（1 周）**：检测 + OCR，只把文字块和识别结果落成 json，界面上"点一下看到原文"。
**二期 · 翻译（1 周）**：接 DeepSeek（或本地 GGUF），译文写回同一个 json，覆盖层显示。
**三期 · 擦字 + 嵌字（2 周）**：先做 OpenCV 修补兜底，再做竖排排版。**这是最难的一段，也是唯一需要真正"修图"的一段。**

### 7.3 选型表（Windows + Electron 现实约束）

| 阶段 | 候选 | 依赖/显存 | 接入方式 | 建议 |
|---|---|---|---|---|
| 文字检测 | **comic-text-detector**（YOLO 系，有 onnx） | onnxruntime，CPU 可跑 | Node onnxruntime-node 或 Python 子进程 | ✅ 首选 |
| 文字检测 | Koharu Layout RF-DETR Seg 2XL | 需 GPU 比较舒服 | 只作参考，不重训 | ⏸ |
| OCR·中英 | **PaddleOCR**（det+rec，onnx 版） | CPU 可跑 | Python 子进程 / onnx | ✅ 首选 |
| OCR·日文 | **manga-ocr**（专门训过漫画竖排） | PyTorch，≈1.5G | Python 子进程 | ✅ 日漫必上 |
| OCR·多语 | Hayai OCR / Baberu OCR | 参考 Koharu | — | 后置 |
| 翻译 | **DeepSeek V3 / R1**（API） | 无 | fetch | ✅ 默认（已有 key 生态） |
| 翻译 | 本地 GGUF（llama.cpp，Qwen2.5-7B-Instruct） | 8G 显存或 16G 内存 | llama-server HTTP | 可选，隐私档 |
| 翻译 | 彩云小译（机翻） | 无 | HTTP | 兜底，快但硬 |
| 擦字 | **OpenCV inpaint（TELEA）** | 无 | Python/opencv 已有 | ✅ 一期兜底 |
| 擦字 | LaMa（simple-lama-inpainting / lama-cleaner） | 2~4G | Python 子进程 | 二期 |
| 擦字 | FLUX.2 Klein / RORem | ≥16G | 不接 | ❌ |
| 嵌字 | Canvas 2D 覆盖层 + 系统字体 | 无 | 渲染层直接画 | ✅ 自己做 |
| 竖排 | 手动按字宽逐字排列（不用 OpenType） | 无 | 同上 | ✅ 够用 |

### 7.4 sidecar 数据契约

```
<书>/_trans/<章>/<页序号>.json
{
  "v": 1,
  "page": 12,
  "w": 1200, "h": 1700,
  "lang": "ja", "target": "zh",
  "blocks": [
    {
      "id": "b1",
      "rect": [812, 240, 180, 420],        // x, y, w, h（原图像素坐标）
      "kind": "bubble",                    // bubble | caption | sfx
      "src": "星野先輩！起きてください！",
      "dst": "星野学长！快起床啦！",
      "conf": 0.93,
      "manual": false                      // 人工改过就置 true，重跑不覆盖
    }
  ],
  "pipeline": { "det": "ctd-v1", "ocr": "manga-ocr", "tr": "deepseek-v3", "clean": "opencv-telea" },
  "at": "2026-11-13T10:00:00+08:00"
}
```

**三条铁律**（直接来自 Koharu 的"重跑不毁人工编辑"）：

1. `manual: true` 的块，重跑只补缺失字段，**绝不覆盖** `src/dst`。
2. 新增阶段写进 `pipeline`，方便下次判断"这页是不是旧版本跑的"。
3. 文件损坏 / 缺字段 → 当这页没翻译过，**不抛错、不阻塞翻页**。

### 7.5 与阅读器的集成点

| 位置 | 改什么 |
|---|---|
| src/reader/view.js `makeImg` | 给每个页 wrap 追加一个绝对定位的 `<canvas class="translayer">`，尺寸 = 图片显示尺寸，`pointer-events: none` |
| src/reader/render.js | 页图 load 后调 `paintTrans(pageIdx, canvas, json)`；模式切换时重绘（因为缩放变了） |
| src/reader/nav.js | 快捷键 T 切换译文显隐（原图/译文/并排三态） |
| src/app/queue | 新增 `trans` 任务类型，优先级低于下载，同一时间只跑 1 个 |
| _scripts/trans/ | 检测、OCR、翻译、修补的独立脚本，全部吃 json、吐 json，可单跑可串联 |

**渲染细节**（决定"像不像汉化组"）：

- 气泡内的文字：按 `rect` 内缩 8%，字号 = 贪心二分找"装得下"的最大值
- 竖排：每列宽 = 字号 × 1.1，从右往左排（CJK 习惯），标点做行首禁则（。，、）」等不出现在列首）
- 描边：白字黑边 `strokeText`（lineWidth = fontSize/10），这是汉化组的标志性做法，遮住原字残影
- 修图前先铺白底（`fillRect` + 90% 不透明度），比擦字更稳且不可逆风险为零；擦字（inpaint）作为"更干净但要跑模型"的可选档

### 7.6 现实风险（诚实评估）

| 风险 | 影响 | 缓解 |
|---|---|---|
| Python 依赖重（torch + paddle） | 打包体积 +2~3G，用户装不上 | 做成**可选组件**，首次用才提示装，装不上就只保留"复制原文" |
| 日漫竖排 OCR 准确率 | manga-ocr 好，但也吃图像质量 | **先上 L2 增强再 OCR**，这两件事天然配套 |
| 拟声词/SFX | 检测模型常漏，且不该翻译 | 只做"气泡 + 旁白"两类，SFX 直接跳过 |
| 翻译质量 | 名词不一致（同一角色三种译名） | 每本书维护 `glossary.json` + 塞进 system prompt |
| 显存 | 本地 LLM 和 inpaint 抢显存 | 串行执行，跑完即卸 |
| 版权 | 汉化产物不能分发 | 产物只落本地 `_trans/`，设置页明确"仅本机阅读" |

### 7.7 验收（一期）

- [ ] 单页：检测召回 ≥ 90%（气泡类），OCR 中日文准确率目测可用
- [ ] 整章 30 页跑完 < 90s（不含翻译）
- [ ] 产物是纯 json，删掉 json 后阅读器表现与从未跑过一致
- [ ] 原图 mtime 与 hash 不变（写成断言，防止误写）
- [ ] 中文/日文/英文三种源语言不崩

---

## 8. 其余可抄清单（P1/P2，一句话一条）

1. **WebDAV 只读源**（NoxWing）：把远程目录挂成"外部目录"的第二形态，只做 GET + PROPFIND，不碰网盘 SDK。
2. **格式免解压直读**（OmiComic）：cbz 只需读中央目录拿条目偏移，PDF 用 pdf.js 渲前几页做缩略图。
3. **HEIC**（NoxWing）：sharp 自带 libheif，探测到就直接转 webp 落 `_cache/`。
4. **预加载页数可配**（OmiComic）：把 view.js 写死的 4 变成 prefs。
5. **标签面板内清理**（OmiComic）：当前筛选面板加"仅显示孤儿标签 + 一键清"。
6. **书架中键拖动排序**（OmiComic）：比现在右键"上移/下移"快十倍。
7. **内置离线操作说明**（OmiComic）：一个 html + 本地全文搜索，省掉"这功能在哪"的重复解释。
8. **首页快速续读卡**（OmiComic）：封面 + 页码 + 进度条 + 悬停出"继续阅读"，双击直接进。
9. **主题跟随系统**（OmiComic）：现在四套主题够用，加个 `prefers-color-scheme` 监听即可。
10. **敏感内容锁**（NoxWing 的 Face ID）：Windows 上等价物是"启动时要求输入 PIN"，本地文件加密可留到以后。

---

## 9. 路线图与排期

| 版本 | 主题 | 内容 | 预估 | 验收 |
|---|---|---|---|---|
| **v1.1.0** | 看得清 | L1 实时增强（三档）+ contrast 滑杆 + prefs 字段 | 1 天 | 6.8 前 4 条 |
| **v1.1.1** | 看得清·落盘 | L2 sharp 管线 + `_enh/` 缓存 + 批量入口 + 模糊打分 | 1.5 天 | 6.8 后 3 条 |
| **v1.2.0** | 横着看 | hscroll + hspread + 跨页判定 + 滚轮/手势 + 进度恢复 | 1.5 天 | 5.7 全部 |
| **v1.2.1** | 横着看·打磨 | 千页虚拟化、snap 吸附、手机端手势 | 1 天 | 5.7 第 1、6 条 |
| **v1.3.0** | 装得下 | 预加载设置、标签清理、中键排序、离线说明、续读卡 | 2 天 | 逐项手测 |
| **v1.3.1** | 接得上 | cbz 只读挂载、WebDAV 源 | 4 天 | 各 3 个真实源联调 |
| **v2.0.0** | 看得懂（一期） | 检测 + OCR + 原文查看器 + json 契约 | 5 天 | 7.7 |
| **v2.1.0** | 看得懂（二期） | 翻译 + 覆盖层 + 校对界面 | 5 天 | 中文可读性抽检 20 页 |
| **v2.2.0** | 看得懂（三期） | 白底遮盖 + 竖排嵌字 + OpenCV 修补 | 8 天 | 与汉化组成品并排比对 |

**回滚策略**：每个版本都不动原图、不改 library.json 结构（只加字段），所以回滚 = 装回旧 exe，数据零损失。唯一要小心的是 prefs 新增字段——旧版本遇到未知键会在 `sanitize` 里丢掉，正好无害。

---

## 10. 明确不做（省下的时间比做的事更值）

| 不做 | 原因 |
|---|---|
| Rust + Tauri 重写 | 现有 Electron 44 冷启动 ~1.5s，不构成瓶颈；重写三个月换 300ms，不划算 |
| 生成式修复（FLUX / RORem） | 显存门槛 ≥16G，且是"重画"不是"擦除"，漫画线条会被编造 |
| 分层 PSD 导出 | 我们不是生产工具 |
| 云端翻译上传原图 | 与"全本地"定位冲突 |
| 追随 NoxWing 的订阅制 | 我们是 MIT，靠这个差异化 |
| 超分进默认流程 | 每页秒级，全库跑一遍是几小时，只在"糊"的书上手动开 |

---

## 附录 A · 参考链接

- Koharu 仓库：https://github.com/koharu-rs/koharu （旧地址 mayocream/koharu 已跳转）
- Koharu 文档：https://koharu.rs/zh · 视觉模型 https://koharu.rs/zh/models/vision · 流水线 https://koharu.rs/zh/guides/processing · 排版 https://koharu.rs/zh/guides/typesetting · 服务商 https://koharu.rs/zh/models/providers
- OmiComic：https://github.com/lorcinv/OmiComic （GPL-3.0，**只读不抄码**）
- NoxWing App Store：https://apps.apple.com/cn/app/id6746104345 （闭源订阅制）
- sharp API（本机 0.35.4 实测可用）：`clahe()` `sharpen()` `linear()` `modulate()` `median()` `toColourspace()`
- SVG 滤镜参考：`feConvolveMatrix`（卷积锐化）、`feGaussianBlur` + `feComposite operator="arithmetic"`（unsharp mask）

## 附录 B · 本次核对的硬事实

| 事实 | 核对方式 |
|---|---|
| koharu 仓库已迁移到 koharu-rs，★6654，Apache-2.0，最新 0.83.5 | GitHub REST API |
| OmiComic 实际拼写 lorcinv（截图写成 loricv），★78，GPL-3.0，最新 1.1.98 | GitHub REST API |
| 本项目 sharp 0.35.4，`clahe` 与 `sharpen` 运行时均为 function | node 实测 require + typeof |
| 本项目当前版本 1.0.3，Electron ^44.3.0 | _app/package.json |
| 阅读器现有模式仅 single/double/scroll（纵向） | src/reader/prefs.js:16、render.js:149 |
| 现有"亮度"是遮罩（`--r-dim`）而非滤镜 | src/reader/view.js:27-29 |
| Real-ESRGAN / Real-CUGAN 命令 | 上游通用形式，**本机未验证**（无 Vulkan 环境） |

## 附录 C · 术语表

- **unsharp mask**：模糊图与锐化图做加权差，"锐化量"可控，比卷积干净，halo 更少
- **CLAHE**：限制对比度的自适应直方图均衡，分块做，专治"局部发灰"
- **halo / 振铃**：锐化过度在边缘产生的亮/暗光晕
- **超分（super-resolution）**：模型重建像素，真正增加信息，慢
- **糊度（Laplacian 方差）**：二阶微分响应方差，越小越糊，是最廉价的清晰度指标
- **sidecar**：把译文/元数据存成与内容并列的独立文件，主文件不变
