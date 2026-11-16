# 项目约定（AGENTS.md）

> 本文件是给 AI 助手和各路协作者看的项目规矩。
> 有新规矩就加到这儿，别只写在聊天记录里。

---

## 一、这个项目是什么

Windows 桌面漫画书库（Electron）。本地跑，不依赖在线服务。

- 主进程：`_app/`（打包进 app.asar）
- 渲染层：`src/`（纯 ES 模块，无构建步骤，改动重启窗口即生效）
- 脚本与适配器：`_scripts/`（`sites/` 是站点适配器，`jm/` 是下载器与工具）
- 构建产物：`_dist/`（不进 git）

---

## 二、热更新边界（最重要）

**改完之后，是 push 就行，还是必须发版？**

| 改了什么 | 怎么发 |
|---|---|
| `src/**` | push 即可。用户端同步后点「界面已更新，点此刷新」生效 |
| `_scripts/sites/*.mjs` | push 即可。下一次下载自动用新版 |
| `_app/**`（主进程、preload、hotupdate、web-server） | **必须发版**（在 asar 里） |
| `_scripts/jm/**`、`build-library.mjs` 等脚本 | **必须发版** |
| 图标、安装器配置、`package.json` | **必须发版** |

判断依据在 `_app/hotupdate.js` 的 `listTree()`：

```js
if (p.indexOf('_scripts/sites/') === 0) return /\.mjs$/i.test(p);
if (p.indexOf('src/') === 0) return /\.(js|mjs|css|html|json)$/i.test(p);
return false;
```

**`_app/hotupdate.js` 本身永远不能热更新** —— 它是热更新的执行者，自己坏掉就没法通过热更新救回来。

---

## 三、发版流程（九步，照做）

### 1. 写更新日志

**只改 `src/data/changelog.js` 这一处。** 不要手写 `_dist/RELEASE-*.md`。

格式：

```js
{
  v: '1.1.9', d: '2026-11-17', tag: '一句话概括，最多两个分号',
  items: [
    { t: '新增', x: '...' },
    { t: '改进', x: '...' },
    { t: '修复', x: '...' }
  ]
}
```

- `t` 只能是 `新增` / `改进` / `修复` / `其他`
- 措辞要严谨，写清「现象 / 原因 / 处理」，不要口语
- **不要写本地文件结构、文件数量、磁盘占用这类隐私信息**
- 新增版本插在数组最前面（新→旧排序）

### 2. 生成发布说明

```powershell
node _scripts/release/gen-notes.mjs 1.1.9 | Set-Content '_dist\RELEASE-1.1.9.md' -Encoding UTF8
```

脚本从 `changelog.js` 读数据，按「新增 / 改进 / 修复 / 其他」分组输出。**和应用内显示的日志同源，不会不一致。**

### 3. 改两处版本号

```
_app/package.json        "version": "1.1.9"
service-worker.js        const CACHE_VERSION = "manga-library-v2-<YYYYMMDD><字母>"
```

- 版本号必须是合法 semver：`1.1.10` 可以，`1.1.9.1` 不行
- `CACHE_VERSION` 只改版本标识，格式沿用现有的

### 4. 提交

```powershell
git add -A
git commit -m "release: 1.1.9（一句话概括）"
```

### 5. 打包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '_dist\build.ps1'
```

**必须用这个脚本，不要直接调 electron-builder。** 脚本里设置了：

```powershell
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
```

不设这些会 `ETIMEDOUT 20.6.7.17:443`。

打包约 4~5 分钟。产物：

```
_dist/书库-1.1.9-setup.exe
_dist/书库-1.1.9-portable.exe
```

### 6. 验收

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
node _scripts/jm/verify/verify-packaged.mjs
```

**必须 33 项全过**。不通过就不要发。

### 7. 打标签

```powershell
git tag -a v1.1.9 -m "书库 1.1.9：一句话概括"
git push origin master
git push origin v1.1.9
```

### 8. 创建 Release

用 GitHub API（token 从 `git credential fill` 取）：

```js
POST https://api.github.com/repos/1960125129h-ctrl/manga-library/releases
{
  tag_name: "v1.1.9",
  name: "书库 v1.1.9",          // 中文标题，用 \u 转义避免乱码
  body: <RELEASE-1.1.9.md 内容>,
  draft: false, prerelease: false
}
```

### 9. 上传资产

```js
POST https://uploads.github.com/repos/.../releases/{id}/assets?name=<文件名>
```

**文件名必须是 ASCII**：

```
shuku-1.1.9-setup.exe
shuku-1.1.9-portable.exe
```

用中文名会变成 `-1.1.9-setup.exe`（中文部分丢失）。

---

## 四、硬规矩

1. **没说提交就不准提交。** 用户明确说了才 `git commit` / `git push`。
2. **`docs/` 永远不进仓库。** 已在 `.gitignore` 排除。那里放施工档案、站点维护笔记等内部资料。
3. **打包必须走代理**，用 `_dist\build.ps1`。
4. **更新日志只维护 `changelog.js` 一份**，发布页正文用它生成。
5. **发版前跑 `verify-packaged.mjs`**，33 项全过才算完。
6. **不要为了「显得严谨」反复问已经能从代码/文档查到的东西。**

---

## 五、踩过的坑

### 行尾符不统一（会毁掉整个 diff）

这个项目里 **LF 和 CRLF 混用**：

| 风格 | 文件 |
|---|---|
| **LF** | `_app/main.js`、`src/shelf/book-actions.js`、`filter-row.js`、`info-editor.js`、`util.js`、`src/styles/02-shelf.css`、`src/data/changelog.js` |
| **CRLF** | `_app/preload.js`、`_app/web-server.js`、`_scripts/build-library.mjs`、`src/app/boot.js`、`src/shared/ctx-menu.js`、`src/shelf/authors.js`、`src/shelf/render.js`、`src/legacy/core.js` |

用工具批量写文件时如果不保持原风格，git 会把整个文件算作改动（曾差点把 13 个文件整个重写）。

**改文件前先确认**：

```powershell
git show HEAD:<path> | Out-Null   # 或用 node 读，看含不含 \r
```

### 打包产物里不能有开发脚本

`_app/package.json` 的 `extraResources.filter` 里排除了：

```
!**/jm/probe/**  !**/jm/verify/**  !**/jm/scenarios/**  !**/release/**
```

往 `_scripts/` 下加新目录时记得同步排除，否则会被打进安装包。

### 版本号

`1.1.1.1` 不是合法 semver。递增补丁位：`1.1.9` → `1.1.10`。

### 中文资产名会丢字

GitHub 上传时中文文件名会变成 `-1.1.9-setup.exe`。**一律用 ASCII**。

### Release 标题乱码

创建 Release 时 `name` 字段用中文字面量会变乱码，改用 `\u4e66\u5e93` 这种转义。

---

## 六、常用命令速查

```powershell
# 热更新推送（改完 src/ 或 _scripts/sites/ 之后）
git add -A; git commit -m "..."; git push origin master

# 本地跑起来调试
cd _app; .\node_modules\.bin\electron.cmd .

# 生成发布说明
node _scripts/release/gen-notes.mjs <版本> | Set-Content "_dist\RELEASE-<版本>.md" -Encoding UTF8

# 打包（走代理）
powershell -NoProfile -ExecutionPolicy Bypass -File '_dist\build.ps1'

# 验收
node _scripts/jm/verify/verify-packaged.mjs

# 看当前所有 Release
# GET https://api.github.com/repos/1960125129h-ctrl/manga-library/releases
```

---

## 七、相关文档

- `推送热更新.md` —— 热更新的三步操作、改了什么怎么发、出问题怎么办
- `README.md` —— 面向用户的功能介绍
- `src/README.md` —— 渲染层模块结构
- `src/改动索引.md` —— 「想改什么 → 动哪个文件」的速查表
