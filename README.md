# 漫画书库重构 v0

一个纯本地的漫画书库：**下载 → 入库 → 管理 → 阅读**，全部在一台机器上跑，不依赖任何在线服务。

当前数据：约 1160 本 / 2300 话 / 12 万页。

---

## 根目录结构

### 数据（路径写死，不要移动）

| 路径 | 说明 |
|---|---|
| `漫画/` | 所有漫画。结构：`漫画/<书名>/第NN話/00001.webp` |
| `library.json` | 收藏、分类、标签、备注、来源（**80 处引用，动它会全线崩**） |
| `_manifest.json` | 书库索引。构建产物，但渲染层直接读它，必须留 |
| `.progress.json` | 阅读进度 |
| `reader-prefs.json` | 阅读器偏好 |
| `角色作品表.json` | 作品/角色识别用的词表 |
| `外部目录.json` | 引用外部图包（不复制文件） |

### 程序

| 路径 | 说明 |
|---|---|
| `src/` | 渲染层。**桌面版和手机端预览用的都是它**（运行时装配） |
| `_app/` | Electron 外壳 |
| `_scripts/` | 所有脚本。`sites/` 是站点适配器，`jm/` 是禁漫与通用工具 |

### 产物与缓存（可以删，会自动重建）

| 路径 | 说明 |
|---|---|
| `书库.html` | 给"浏览器直接双击打开"用的单文件（3.2 MB）。桌面版不读它 |
| `_thumbs/` | 缩略图缓存 |
| `_cache/` | 调试浏览器 profile（含登录态） |
| `_visual-check/` | 截图产物 |
| `_backup/` | 备份 |
| `_archive/` | 历史归档 |

### 入口（双击运行）

`启动书库.cmd` / `更新书库.cmd` / `下载新漫画.cmd` / `禁漫下载.cmd` / `手机端预览.cmd` / `自动收录手动包.cmd` / `清理浏览器缓存.cmd`

### 文档

- `docs/README-禁漫下载流程.md` —— 全流程手册（命令、路径、坑）
- `docs/资源获取-更优路径.md` —— 各站点取数方案与实测数据

---

## 最小可运行集

只保留这些就能跑：

```
漫画/  src/  _app/  _scripts/  icons/
library.json  _manifest.json  reader-prefs.json  角色作品表.json  外部目录.json
启动书库.cmd
```

其余（`书库.html`、`_thumbs`、`_cache`、`_visual-check`、`_backup`、`_archive`）都是可再生的。

---

## 不进版本库的东西

见 `.gitignore`。重点两条：

- `_scripts/sites/cookies/` —— **各站登录凭据，绝不能提交**
- `漫画/` / `library.json` / `.progress.json` —— 内容和个人阅读记录

---

## 运行环境

- Windows（桌面版是 Electron）
- Node 24（`NODE_USE_ENV_PROXY` 需要真实 Node，Electron 自带的 22 不支持）
- Python 3.11（禁漫下载、切页拼合、验证码 OCR）
- 代理：`127.0.0.1:7890`（Clash），部分站点必须走
