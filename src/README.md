# 渲染层结构（src/）

> 2026-09-20 起，前端不再是「构建生成的一坨内联 HTML」。
> 改这里的代码**不需要构建**，重启窗口即生效。

## 以前

```
_scripts/reader-core.js  (单体 290KB, 251 个定义挤在一个闭包里)
        ↓ build-library.mjs 整段内联
     书库.html  (1MB 单文件: CSS + JS + 全部书库数据)
```

改任何一行前端代码都要重跑构建；书库数据被煮进 HTML，数据一变又得重建。

## 现在

```
src/
├── index.html          入口页(手写, 不再由构建生成)
├── main.js             装配: 取数据 -> 注入全局 -> 载入界面核心
├── lib/
│   ├── ipc.js          主进程能力封装(调不到就明确抛错, 不静默失败)
│   └── manifest.js     书库数据的取得
├── shared/             纯逻辑(无状态、不碰 DOM)
│   ├── text.js         enc / normName / capFirst / titleNorm
│   ├── format.js       fmtBytes / fmtTime
│   ├── chapter.js      nOf / chLabel / pageList / imgFile
│   ├── storage.js      localStorage 小状态(专辑/书签/背景历史/手动排序/浏览状态) + VIEW_KEY
│   ├── url.js          hostOf
│   ├── color.js        hsv2rgb
│   ├── ui.js           模态框 / 提示条(showModal/closeModal/hint/askConfirm/askText)
│   ├── ctx-menu.js     通用右键菜单 #ctx(fillCtx/hideCtx/showCtx) —— 书架和阅读器共用
│   └── domcheck.js     id 撞车检测(findDuplicateIds / watchDuplicateIds)
├── app/
│   ├── state.js        应用级共享状态(S / elGrid / LIBRARY / LIBROOT)
│   ├── actions.js      跨域小动作(下载日志/预览队列关闭/重建书库/转后台/章节选择器/下载按钮)
│   └── boot.js         启动收尾(afterBoot: 数据到齐、骨架画完之后要做的事)
├── shelf/
│   ├── state.js        书架状态(SEL / SEARCH_HAY / CARD_CACHE / cardSeq …)
│   ├── render.js       书架渲染(renderShelf / card / 分类标签 / 各种筛选下拉)
│   ├── filter-row.js   书架筛选行(三行的展开收起 + 浏览状态持久化)
│   ├── select.js       多选 / 专辑 / 批量删除
│   ├── util.js         卡片标签折叠 / 网格几何 / 滚动辅助 / 拖拽收尾 / 筛选角标 / 封面取色
│   ├── book-actions.js 对这一本书做的事(备注/自动标签/收藏/分级/重命名/合并/删除/查重/分类管理)
│   ├── history.js      阅读历史与书签面板
│   ├── authors.js      作者名规范化与合并 / 按作者自动打标签
│   ├── sites.js        站点目录 / 跨站搜索 / 检查更新 / 快速下载
│   ├── info-editor.js  简介与来源 / 分类标签编辑器
│   └── drag.js         拖拽: 边缘自动滚屏 / 分组落点高亮 / 卡片拖动排序
├── reader/
│   ├── state.js        阅读器状态(comic / io / elCanvas / 缩放平移 / 翻页冷却 …)
│   ├── render.js       三模式渲染 + 适配 + 缩略图侧栏 + 页码信息
│   ├── view.js         页面切分 / 图片懒建 / 预取 / 侧栏把手 / 主题与默认值
│   ├── open.js         打开/关闭/飞入飞出/书签跳转/详情与删除(含 vtWrap 视图过渡)
│   ├── zoom.js         缩放与滚轮(右键滚轮缩放 / 拖动平移 / 居中 / 适宽高重算)
│   ├── nav.js          上下页 / 上下话 / 阅读主题对话框 / 背景视差 + cur/pages/clamp
│   └── panel.js        阅读器侧栏(章节列表 / 书签 / 右键菜单 / 图片管理器)
├── library/
│   └── store.js        书库存取层(条目/元数据/进度/落盘 + 排序键; 全文件的"胶水")
├── settings/
│   └── panel.js        设置面板(SET/SET_DEFAULT/applySettings/openSettings)
├── download/
│   └── panel.js        下载面板(通用链接 / 禁漫 / 浏览器标签 / 预览选页)
├── shell/              窗口外壳层(新写的, 不是从旧代码抽的)
│   ├── titlebar.js     自绘标题栏: 最小化/最大化/关闭 + 最大化态图标
│   └── menu.js         原生菜单 -> 界面按钮的桥(菜单项不重复实现业务)
├── styles/             **按域拆**(2026-09-20)。link 顺序 = 层叠顺序, 不要动
│   ├── 01-tokens.css      变量 / 主题 / 背景图覆盖 —— 必须最前(其它全靠这里的变量)
│   ├── 02-shelf.css       书架全部: 顶栏/搜索/筛选/网格/卡片/分类标签/专辑/分组/历史/缩略图栏
│   ├── 03-reader.css      阅读器全部: 侧栏/工具栏/画布/三模式/缩放/把手/配色
│   ├── 04-panels.css      各类面板 + 右键菜单 + 模态框 + 表单 + 下载进度
│   ├── shell.css          窗口 chrome: 标题栏 + 布局
│   └── desktop.css        去网页味: 禁选中/禁回弹/禁图拖/焦点圈/Tap 高亮
└── legacy/
    └── core.js         **汇编文件**: 57 个状态声明 + ~90 条事件接线 + 启动流程
                       —— 0 个函数。域逻辑全部搬到了上面的模块里。
```

**CSS 的顺序仍然不能改。** 早先那 8 个 `0N-*.css` 是从 `app.css` **按原顺序连续切**出来的，
所以域是散的（书架在 02 和 05、阅读器在 03 和 06、`04-misc` 是跨域的）。

2026-09-20 做了一次**按域重排**：合出 `01-tokens / 02-shelf / 03-reader / 04-panels` 四个域文件。
重排本来是危险的（文件里到处是"后面的规则故意覆盖前面的"：`#shelf` 2 次、`.thumb` 2 次、`:root` 2 次），
所以先做了两件事：

1. **列出所有跨文件冲突**（同一选择器 + 同一属性出现在 2 个以上文件）—— 实测只有 **14 处**；
   逐条确认重排后相对顺序不变。
2. **证明等价**，而不是"看起来一样"：`_scripts\jm\css-snapshot.mjs` 在 10 个界面态下
   抓取 **每个元素的每个计算样式属性**，改前改后逐字段比对。

> 结果是 **313,774 个 (元素,属性) 对，0 差异**。这些属性只取 CSS 里真正出现过的那些 ——
> 没被任何规则设置的属性, 其计算值与层叠顺序无关。

**这个快照工具本身调了三轮才可信**（都记在经验库里）：

| 症状 | 根因 |
|---|---|
| 同一份代码抓两次，几十处差异 | `.progress.json` + `localStorage` 把上次的侧栏/缩略图栏开关带进来了 → 每次抓前重置 |
| 同上，卡片内容/右键菜单位置飘 | 卡片颜色是异步提取的、`cmeta` 是懒建的 → 加"等界面停止变化"(元素数+高度+DOM长度连续 3 次不变) |
| 只剩 `input#dl-url` 边框色差 1~2 个色阶 | 抓到 CSS **过渡途中的中间值**；`getAnimations()` 有竞态兜不住 → 抓拍前注入 `transition:none!important;animation:none!important` |

**先确认噪声本底为 0，再拿它做裁决。** 否则看到的"差异"分不清是改坏了还是工具在抖 ——
我中途就差点把一次"原始 vs 原始"的空比对当成通过。

**注意** `index.html` 里有 `<base href="../">`：入口在 src/ 下，而书库数据里的路径
（`漫画/书名/...`）是相对项目根的，靠 base 让它们正确解析。改这里时别删。

## 数据怎么流

```
_scripts/build-library.mjs   扫描 漫画/ + 识别(标签/作者/角色/分级)
        ↓ 落盘
    _manifest.json            纯数据文件
        ↓ 主进程 ipcMain.handle('lib:manifest')
    src/lib/manifest.js
        ↓ globalThis.__MANIFEST__
    legacy/core.js 读它(和以前一样)
```

构建只算数据，不生成界面。

## 开发方式

```powershell
cd 'D:\gong zuo qu\漫画书库重构v0'

# 改 src/ 里的界面代码 -> 重启窗口即可, 不用构建
node _scripts\jm\app-start.mjs --restart

# 改了书库数据(加书/删书/改标签) -> 重算数据
node _scripts\build-library.mjs --lib "D:\gong zuo qu\漫画书库重构v0"
```

## 抽取方法（每抽一块都照这个走）

从 `legacy/core.js` 往外抽函数**不能凭感觉挑**，按下面四步：

1. **先查唯一性**——目标名字在全文里 `function 名` 只能出现 1 次，
   且没有 `var/let/const 名` 或把它当参数的绑定（否则抽取会造成遮蔽，行为变掉）。
2. **大括号配平取精确源码**，不要按行号截（函数里有多层大括号和字符串）。
3. **从 core.js 移除原文** + 在文件头部加 `import`。
   core 是个 IIFE，模块作用域在它外面，所以导入的名字在闭包里能直接看到。
4. **回归**（见下），通过了才继续下一块。

## 回归方式

**一键跑全套（改完必须跑这个）**

```powershell
cd 'D:\gong zuo qu\漫画书库重构v0'
node _scripts\jm\verify-all.mjs
```

它自己造/删测试书，不需要手工准备。11 个工具 / 167 项检查：

| 工具 | 项数 | 覆盖 |
|---|---|---|
| verify-contract | 19 | 适配器契约校验器本身 |
| verify-injections | 23 | **静态**：模块用到的 core 顶层名是否都注入了 + 用到别的模块的名字是否都 import 了 |
| verify-reader-side | 25 | 章节列表 / 书签 / 章节与缩略图右键菜单 / 图片管理器（真界面点进去） |
| verify-shell | 16 | 标题栏行为 + 桌面化规则 |
| verify-dom | 10 | 各界面 id 撞车 + 标题去重不误伤 |
| verify-shelf | 18 | 多选(Ctrl/Shift/Ctrl+A/Esc) / 右键菜单 / 搜索 / 分类标签 |
| verify-reader | 19 | 3 模式 × 3 适配 = 9 组合 / 方向 / 侧栏 / 缩放 / 切话 |
| verify-settings | 14 | 设置面板页签 / 改设置真生效 / 还原不留污染 |
| verify-functional | 8 | 书架 -> 阅读器 -> 章节 -> 图片真解码 |
| verify-download | 9 | 真下 2 页 + 事件字段契约 |
| verify-import | 6 | .cbz 导入(含嵌套压平与页序) |
| (verify-packaged) | 8 | 打包产物; 需先重新打包, 不是每次都跑 |

**写测试的四个坑**（都踩过）:
1. **数卡片要数"可见的"**：书架过滤是"用 CSS 隐藏"而不是移除 DOM，数 `#grid > *` 会得到错的数。
2. **别只盯几个 CSS 变量**：改设置时如果只比对自己列的变量，会误判（有设置映射到没列进去的变量）。要么挑映射确定的项，要么快照全部自定义属性。
3. **测试之间会通过磁盘上的状态互相干扰**：阅读位置存在书库目录的 `.progress.json`。
   上一次跑把某本书停在"第 2 话"，下一次 `verify-reader` 就会挂在"下一话能切"上
   （它假定从第 1 话开始）。`make-fixture.mjs` 现在造书时一并清掉测试书的进度 ——
   别把这条删了，删了故障会以"看起来像重构改坏了"的形式复现。
4. **不要点"删除"类菜单项**：`delImage` / `delChapter` **没有二次确认框**，
   点了就真删文件。测菜单内容就好，别点它。

```powershell
# 造一本极小的测试书(2 话 5 页), 借正式库的图
node _scripts\jm\make-fixture.mjs

# 功能级回归(书架->阅读器->章节->图片解码)
node _scripts\jm\verify-functional.mjs

# 外壳层回归(标题栏行为 + 桌面化规则; 不需要书)
node _scripts\jm\verify-shell.mjs

# 契约层单元测试(故意喂错数据, 确认拦得住)
node _scripts\jm\verify-contract.mjs

# 界面结构(挨个打开书架/下载弹窗/设置/历史, 扫重复 id)
node _scripts\jm\verify-dom.mjs

# 文件关联导入(造个带子目录的 .cbz, 带参数启动, 看是否导入并写进书库数据)
node _scripts\jm\verify-import.mjs

# 打包产物(需先打包; 验"从用户选的书库目录加载界面")
node _scripts\jm\verify-packaged.mjs

# 下载链路端到端(通过 App 真下 2 页, 完后自动清掉)
node _scripts\jm\verify-download.mjs

# 测完删掉
node _scripts\jm\make-fixture.mjs --remove
```

`verify-functional.mjs` 检查 8 项：核心启动 / 书架有书 / 进入阅读器 / 章节列表 /
渲染页面元素 / **图片真的解码**(`naturalWidth > 0`) / 零未捕获异常 / 零控制台错误。

**只跑 `verify.mjs boot` 不够**——空库时它只报"卡片数 0"，阅读器整条链路都没被碰过。
实测就是这样漏过一个真 bug：入口搬到 src/ 后图片路径解析错位，boot 照样过。

## 契约层（_scripts/sites/contract.mjs）

**为什么要有它**：适配器的返回值一直是"隐式契约"——前端和下载端按字段名去取，
少一个字段**不报错，而是静默失效**。抖音作者页那次就是这么坏的：
`tagGalleries` 没给 `gid`/`url` → 前端拼出空的勾选串 → 后端筛完为空 →
界面表现成"勾了没反应"，全程零错误信息。

**校验原则**

| 情况 | 处理 |
|---|---|
| 影响"找不到 / 下不到"的字段（`gid`、`url`、图片地址）缺 | **抛错**，带站点 + 第几项 + 字段名 + 缺了会怎样 |
| 只影响"显示好不好看"的字段（`title`、`thumb`）缺 | 补安全默认值 + 一行警告 |
| 图片**全部**没地址 | 抛错（这是适配器取错字段，不是脏数据） |
| 图片**少数**没地址 | 跳过并报数（站点脏数据，不该拦整话） |

**接入点**（都在 `_scripts/sites/fetch-book.mjs`）

- `resolve()` → `checkMeta`
- `chapters()` → `checkChapters`（探针 + 正常流程两处）
- `tagGalleries()` 的 `onBatch` → `checkGalleries`（首批 + 翻页两处）；错误会被现有 catch 转成**界面可见的报错**
- `downloadImagesToDir()` → `checkImages`（**所有下载路径的唯一漏斗**，一处覆盖全部）

### 第二层：界面 id 撞车（`src/shared/domcheck.js`）

新组件复用已有 `id` 时浏览器**不报错**，但 `getElementById` 只拿到先出现的那个，
于是新组件的样式和事件全作用到旧元素上——表现就是"属性栏跑到别处去了"。

- `findDuplicateIds()` —— 扫描重复 id，返回 id / 个数 / 元素
- `watchDuplicateIds()` —— 界面变动后节流扫描，撞了就 `console.warn`（同一个 id 只报一次）
- 入口 `src/main.js` 启动时挂上；`verify-dom.mjs` 会把各界面挨个打开再扫一遍

### 第三层：`dl:event` 字段契约（`_app/main.js`）

子进程用 `@@XXX@@` 标记行打事件，主进程 `s.slice(indexOf(...) + 长度)` 抠 JSON。
**少一个字段不会报错**，界面只会"什么都不显示"或"步骤条卡在第一步"（两者都真实发生过）。
现在 `sendDl()` 里按类型校验必备字段（所有下载事件都经过它），缺了写进应用日志的 `[契约]` 行。
注意 `prog` 的 `stage` 是必需的——它缺失就会让四步进度条永远停在第一步。

## 原生集成进度

| 项 | 状态 |
|---|---|
| frameless 窗口 + 自绘标题栏 |  已验证(最大化/还原真点过) |
| 原生菜单(快捷键 + 标题栏菜单按钮) |  菜单项桥到已有按钮 |
| 去网页味(选中/回弹/图拖/焦点圈) |  读计算样式验证 |
| 托盘图标 |  已验证 |
| 任务栏下载进度 |  输入事件已验证(prog 事件带 got/total 流过) |
| 文件关联(.cbz 导入) |  已验证(含嵌套目录压平与页序) |
| 打包发布 |  安装包 + 便携版均已产出并验证可启动 |

## 打包

```powershell
cd 'D:\gong zuo qu\漫画书库重构v0\_app'
.\node_modules\.bin\electron-builder --win
```

产物在 `..\_dist\`：`漫画书库重构v0-<版本>-setup.exe`(NSIS 安装包) 与 `-portable.exe`(便携版)，
各约 145 MB。

**打包版和开发版的关键差别**：书库根目录由用户在首次启动时选，
界面源码 `src/` 会在那时被拷进那个目录（所以 `rendererPath()` 仍然指向 `LIB/src`）。
不拷 `src/` 的话装完打开就是白屏——`verify-packaged.mjs` 专门守这条。

打包时排除了这些（省约 110 MB 且功能不受影响）：
`ffplay.exe`（代码只用 ffmpeg/ffprobe）、ffmpeg 的 doc/、浏览器 profile、日志、历史验收脚本。

## 从 core.js 抽模块的方法

###  先纠正一个曾经的错误判据（2026-09-20）

文档早先写过"按**传递闭包**量, 闭包>50 的 77 个函数共约 180 KB 搬不动"。**这个判据是错的**,
它把"连通性"当成了"抽取成本"。真正决定成本的只有一件事:

> **这个函数自己要注入多少个 core 名字(fn + 状态)。**

传递闭包只说明"搬 A 会牵出 B", 但被牵出的 B 只要**注入**就行, 不需要一起搬。
实测(2026-09-20, core 剩 140 个函数时):

```
注入  0 个: 31 个函数 / 13.6 K
注入 1-3 个: 78 个 / 61.3 K
注入 4-8 个: 28 个 / 29.9 K      <- 合计 137/140 个都 <= 8
注入 9-15 :  2 个 /  3.2 K
注入16-25 :  1 个 /  1.4 K      <- 最高是 showCtx(16)
```

也就是说**没有任何一个函数需要"重写"才能搬**。连通分量显示的"106 个函数粘成一坨"
是传递性吓出来的幻觉。按注入数分批搬, 106 那坨会自己碎掉 —— 搬完 `library/store.js`
之后它已经变成 76 个 / 70.8 K。

> **教训**: 换一个指标之前先问"这个数量到底在度量什么"。闭包度量的是"依赖有多深",
> 而搬代码的成本取决于"表面的依赖有多宽"。

**仍然成立的部分**: 顶层事件接线(约 290 行)确实是函数与接线交织的, 但**它不是搬不动的理由** ——
它只是需要单独一步(收进 `initReader()`), 而且不影响其余函数的可搬性。

### 抽取工具（2026-09-20 加的，批量抽取靠它们）

抽到后面一批就 5~20 个模块，手写探针不划算了，所以固化了两个脚本：

```powershell
# 1) 量: 列出剩余函数按"注入数"升序; 或分析一个候选集合能不能作为一个批次搬
node _scripts\jm\batch-plan.mjs
node _scripts\jm\batch-plan.mjs render applyThumbs syncButtons ...

# 2) 切: 按 spec 把一批函数从 core 搬到新模块(带全套自检)
node --experimental-vm-modules _scripts\jm\extract-batch.mjs _batch.json
```

`extract-batch.mjs` 把这一路踩过的坑都固化进去了：
- 取函数体**要求目标行确实是函数声明**（不然 `var` 声明会被当函数去配平，范围一路跑到文件尾）
- 加 export 认 `async`/生成器前缀
- **全部 export**：有些名字在 core 里是"被当值传出去"而不是被调用，少导一个就是运行时 `undefined`
- spec 里的每个行号都带 `contains` 断言，删之前先核对
- 支持 `rewriteLines`（`var A = 0, B = 0;` 里只拿走 B 时改写这一行）
- import 用**自动扫描** `src/` 得到，不手写映射表
- 生成后做 `vm.SourceTextModule` 语法检查（ESM 也能查）
- core 侧做完残留扫描：这批函数不该再在 core 里被定义

###  两个"会自己烂掉的断言"（同一天连踩两次）

守卫里写过的健全性断言，两次都因为重构本身而失效：

| 断言 | 怎么烂的 |
|---|---|
| `topFns.size > 100` | core 抽到 99 个函数时撞翻 |
| `[...topFns].some(n => core 里有 async function n)` | 7 个 async 函数全搬走之后没得可查 |
| `['afterBoot','showCtx','render','openComic'].every(...)` | `render` 被搬走之后撞翻 |

**教训**：断言不要依赖"被重构对象当前的样子"。要么拿**合成样本**测解析器本身
（`FNRE.exec('  async function foo() {}')?.[1] === 'foo'`），要么做**自洽校验**
（解析结果必须与文件里的函数声明行一一对应）。这两种永远成立。

###  按逗号切声明要按"顶层逗号"（同一天第三个同类坑）

`export const S = { ci: 0, pi: 0, mode: "single", ... }` 直接 `split(',')`，
对象键 `ci`/`pi`/`mode`/`dir`/`q` 全被当成了"导出名"——生成器据此把一个模块的
局部变量 `q`/`dir` 当成 `app/state.js` 的导出去 import。

规则：解析任何声明/参数列表都用**括号深度感知**的切分（core 那边的多变量声明同理）。

### 抽一个"域"的做法（以设置面板为例，已做完）

设置面板是第一个按域抽的。它的直接依赖其实很少（**9 个函数 + 3 个状态**；
闭包 131 是传递依赖，不代表要一起搬）。

关键手法是 **"工厂 + 上下文" + 同名模块级 `let`**：

```js
// src/settings/panel.js
let DISK = null, renderShelf, renderCatTabs, /* ... */;
export function initSettings(c) {   // core 启动时注入
  DISK = c.DISK; renderShelf = c.renderShelf; /* ... */
}
// 搬过来的代码**逐字不变** —— 裸标识符照样解析到上面这些 let
export function openSettings() { /* 原样 */ }
```

```js
// core.js
import { SET, applySettings, openSettings, initSettings } from '../settings/panel.js';
initSettings({ DISK, renderShelf, renderCatTabs, /* ... */ });
```

**好处**：搬过去的 18.8 KB 代码一个字都不用改，不用把 `renderShelf()` 改成 `ctx.renderShelf()`。
**漏传依赖会立刻 ReferenceError**（响亮地失败），不会静默错行为。

`SET` 用 `export let`：重置按钮会整体替换它，core 那边靠 ES 实时绑定始终看到最新对象。

###  抽一个域时，依赖要查**四类**（①②③ 下载面板踩的，④ 阅读器踩的）

只查"core 顶层名"是不够的，会漏三类，而且都是运行时才炸：

| 类别 | 漏了会怎样 | 实例 |
|---|---|---|
| ① core 顶层名 | 好查——脚本能算出来 | 下载面板 10 个函数 + 5 个状态 |
| ② **已搬到别的模块的名字** | `ReferenceError` | `SET`（在 settings/panel.js 里）——漏了 |
| ③ **搬走之后 core 还在调的名字** | `ReferenceError` | `openDownload` / `onDlEvent`——漏了 |
| ④ **`async function` 声明的顶层名字** | `ReferenceError`（只在冷分支上炸） | `delImage` / `delChapter` / `doRebuild`——漏了，见下 |

②靠"拿本模块文本去比对所有已抽模块的导出名"来查；
③靠"拿被搬走的名字去 core 剩余文本里搜一遍"来查。

###  第④类：`async function` 会被朴素正则漏掉（阅读器那一轮踩的）

扫 core 顶层声明的正则是 `^\s*function\s+(\w+)`。**它匹配不到 `async function delImage()`** ——
于是 `delImage` / `delChapter` 既不在"core 顶层名"里，也就没被算成待注入依赖。
后果：`showImgCtx` 搬进 `reader/panel.js` 后，点"删除这张图"直接
`ReferenceError: delImage is not defined`。`doRebuild`（下载面板的"非增量重建"那条路）同理。

两个教训：

1. 解析顶层声明要写成 `^\s*(?:async\s+)?function\s*\*?\s*(\w+)`（还要认识生成器）；
2. **别只靠动态测试**。上面两处，155 项动态用例一项都没碰到 —— 没有哪项会真的去
   删除图片、也没有哪项走"非增量重建"。这类"某个分支引用了漏注入的名字"是纯静态问题，
   所以加了 `verify-injections.mjs`：对每个模块算出自由标识符，减去自己声明的 /
   import 进来的 / `init*` 注入的，剩下还命中 core 顶层名的就是漏项。**不需要启动 App**，
   秒级跑完，已并入 `verify-all`。

###  这个守卫自己也漏报过一次（2026-09-20，同一天内）

第一版守卫把"**已经搬到别的模块的名字**"一律当放行(`MOVED.has(x) -> continue`)，理由是
"它们不再是 core 的事了"。结果 `library/store.js` 的 `cur()` 用了 `comic`(已搬到
`reader/state.js`)却没 import，守卫一声不吭，直到运行时 `ReferenceError: comic is not defined`。

修法是把检查改成**双向**：

| 自由标识符命中 | 结论 |
|---|---|
| core 顶层名 | 忘了**注入** |
| 别的模块 export 的名字 | 忘了 **import** |

改完之后它立刻抓出三个真 bug（都不是新的，是前几块留下的）：
`download/panel.js` 用了 `LIBRARY` 没 import、`reader/panel.js` 的删图路径用了 `renderShelf`/
`invalidateCard` 没接、`library/store.js` 的 `buildSearchHay` 用了 `SEARCH_HAY` 没接。

**两个实现坑**（都调过一轮才收敛）：
1. 收集名字时**只收 `export` 出去的**。第一版把所有顶层声明都收进来，各模块内部同名的小局部
   变量(s/d/g/list…)全成了"API"，18/22 项误报。收窄到 export 面后误报降到 3 项，且都是真 bug。
2. `local`(本模块声明)必须收全：行内声明(`for (var i = 0, d = x)`)、多声明符、箭头参数都要覆盖，
   漏收就会把局部变量当成漏 import。

###  "按值注入"有四个坑（书架渲染这一块全踩了一遍）

`let X = ctx.X` 只是**注入那一刻的快照**。所以：

1. **会被重新赋值的** → 之后 core 改了，模块里还是旧值（**静默错行为**）。
   要么由模块自己持有（`export let` + 给 core setter），要么注入 getter（`SEL` / `SEARCH_HAY` / `LIBRARY`）
2. **注入点之后才被赋值的** → 注入进去是 `undefined`。
   书架那轮就栽在这：`SORT_ITEMS` 声明在注入点之后 1586 行、`PVQ`/`PV_TILE_W` 晚 350 行，
   `LIBRARY` 更是**异步填进来的**（`DISK.getAll`）。
   **对策**：注入调用放在所有声明之后；异步来的数据一律用实时绑定/ getter，不要按值注入
3. **复合赋值也算赋值**：`x++` / `x--` / `x+=` 都不能用在 import 进来的绑定上
   （漏了会 `TypeError: Assignment to constant variable`）。搜的时候别只搜 `=`
4. **多变量声明会躲过朴素的正则**：`var A = null, B = null, C = 0;` ——
   `var\s+(\w+)` 只抓到 A。依赖分析漏掉 `LIBRARY` 就是这个原因。
   解析声明要按顶层逗号拆

**抽完之后必须做三种赋值扫描**（`=` / `+=` 等复合 / `++`）。

**搬一个"单元"的步骤**(以模态框那簇为例):
1. 算这个单元的传递闭包 + 它需要的外部名字(状态/其它函数)
2. 大括号配平取精确源码, 去掉 2 空格缩进, 加 `export`
3. 需要的状态: 只赋值一次的可以直接 `export const`(ES 模块绑定是实时的);
   有"整体重新赋值"的要么提供 setter, 要么留在 core
4. 从 core 移除原文 + 加 import
5. **跑全套验收**

**已验证抽出的**: 40 个模块（见开头那棵树）。2026-09-20 这一天把 core 从 2914 行抽到 718 行。

## 迁移状态

| 部分 | 状态 |
|---|---|
| 入口 / 装配 / 数据加载 |  已模块化 |
| shared/ |  9 个模块（含 ctx-menu） |
| app/ |  state + actions + boot |
| shelf/ |  11 个模块 |
| reader/ |  7 个模块 |
| library/store.js |  书库存取层 |
| settings/ · download/ |  |
| **legacy/core.js** |  **已抽空**：2914 行 → **718 行 / 0 个函数** |
| core.js 的接线整理 |  见下（这是**重写**，不是搬代码） |
| styles/ |  已外链，仍是单文件，待按域拆 |

### core.js 现在是什么

```
718 行 = 32 行 import + 57 行状态声明 + ~90 条事件接线 + 启动流程
        0 个函数
```

它现在是一个**汇编文件**：声明共享状态、按顺序接线、跑启动。这是合理的终态 ——
很多桌面应用的主文件就是这个样子，700 行一屏能读完。

### 剩下的那块为什么不能继续"搬"

接线语句和状态声明是**逐行交织**的（`var elStage = ...` 夹在 `document.addEventListener` 之间），
而且接线的执行顺序就是它的语义：声明必须在读到它的接线之前跑完。整块剪切会打乱这个顺序。

要把它们分成 `initReader()` / `initShelf()`，只能**重写**成显式的初始化函数，
顺便把每个接线语句用到的 DOM 引用变成参数或模块 import —— 那是另一种工作
（设计 + 重写 + 逐条核对），不是机械抽取。当前 718 行的规模下，收益也不大。

### 下一步(按性价比)

1. **styles/ 按域拆** —— 唯一的"按域"遗留项； 层叠顺序，见开头那节
2. 接线整理（上面那条，属于重写）
3. 若继续拆模块：`download/panel.js`（75.9 KB）和 `shelf/render.js`（35.6 KB）
   是现在最大的两个文件，可以按页签/按渲染部件再分
