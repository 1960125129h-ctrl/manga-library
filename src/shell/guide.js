// 首次使用引导
//
// 打包版装完、选完书库目录，第一眼看到的是空书架 —— 没有任何说明，
// 用户不知道"书从哪来"。这个模块补的就是这一步。
//
// 触发: app/boot.js 的 afterBoot() 里调 maybeShowGuide()
//       只看 localStorage 的 guideSeen_v1，没看过就弹一次。
// 重看: 设置面板里的「使用引导」按钮 -> showGuide(true)
//
// 样式全部内联，不改 styles/，也不依赖新 CSS 类。
// 结构: 标题 + 可滚动正文 + 固定在底部的「开始使用」(不随正文滚走)

import { showModal, closeModal } from '../shared/ui.js';

const FLAG = 'guideSeen_v1';

function row(parent, title, lines) {
  const d = document.createElement('div');
  d.style.cssText = 'margin:0 0 14px';
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'font-weight:600;font-size:14px;margin:0 0 4px;color:var(--fg,#e8e8e8)';
  d.appendChild(h);
  lines.forEach(function (t) {
    const p = document.createElement('div');
    p.textContent = t;
    p.style.cssText = 'font-size:12.5px;line-height:1.7;color:var(--fg2,#9aa3ad);white-space:pre-wrap';
    d.appendChild(p);
  });
  parent.appendChild(d);
}

function code(parent, text) {
  const p = document.createElement('div');
  p.textContent = text;
  p.style.cssText = 'font-size:12px;line-height:1.6;color:#b9c4cf;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px 9px;margin:4px 0 6px;white-space:pre-wrap;font-family:Consolas,monospace';
  parent.appendChild(p);
}

export function showGuide(force) {
  showModal(function (box) {
    box.style.cssText = 'width:min(660px,92vw);max-height:80vh;display:flex;flex-direction:column;padding:18px 20px 12px';

    const head = document.createElement('div');
    head.style.cssText = 'flex-shrink:0';
    const h = document.createElement('h3');
    h.textContent = force ? '使用说明' : '欢迎使用「书库」';
    h.style.cssText = 'margin:0 0 4px;font-size:17px';
    head.appendChild(h);
    const sub = document.createElement('div');
    sub.textContent = '书架现在是空的没关系 —— 下面这几种方式都能把书放进来。';
    sub.style.cssText = 'font-size:12.5px;color:var(--fg2,#9aa3ad);margin:0 0 12px';
    head.appendChild(sub);
    box.appendChild(head);

    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow:auto;flex:1;min-height:0;padding-right:6px';
    box.appendChild(scroll);

    row(scroll, '① 直接下载（最省事）', [
      '点顶部的 ⬇ 下载按钮：',
      '· 禁漫天堂：填 JM 编号（JM1452133）、纯数字、专辑链接或单话链接，一行一个',
      '· 通用链接：贴其它漫画站的目录页地址（再漫画 / X漫画 等）',
      '下载会自动过 CF、逐话取图、切页拼合、入库并重建书架。'
    ]);
    row(scroll, '② 拖压缩包进来', ['把 .cbz / .zip 拖到窗口上（或双击压缩包，本应用已关联 .cbz），会解压成一本并入库。']);
    row(scroll, '③ 手动放文件夹', ['按这个层级把图放进去，然后在顶部点「更新书库」或等它自动刷新：']);
    code(scroll, '<书库根目录>\\漫画\\<书名>\\第01話\\00001.webp');
    row(scroll, '④ 引用现有图包（不复制文件）', ['书库根目录下的 外部目录.json 里填已有图包的绝对路径，刷新后直接出现在书架上。']);
    row(scroll, '书架怎么用', [
      '· 左键点卡片 = 打开阅读器；右键 = 分类 / 标签 / 封面 / 重命名 / 删除',
      '· 搜索框按 / 快速聚焦；Ctrl+点击、Shift+点击可多选，Ctrl+A 全选',
      '· 顶部「筛选」可按分组、作者、平台、分级筛选'
    ]);
    row(scroll, '阅读器', [
      '· ← / → 翻页，空格下一页，F 全屏，Esc 退出',
      '· 三种模式 × 三种适配（适应宽度 / 高度 / 整页）在顶栏切',
      '· 右键图片可加书签、管理图片；退出会记住阅读位置'
    ]);
    row(scroll, '手机上看', ['设置 → 手机端预览：开启后同一 WiFi 下用手机浏览器打开显示的地址即可。']);

    const tip = document.createElement('div');
    tip.textContent = '这份说明随时可以在「设置」里重新打开。';
    tip.style.cssText = 'font-size:12px;color:var(--fg2,#9aa3ad);margin:2px 0 8px';
    scroll.appendChild(tip);

    const foot = document.createElement('div');
    foot.id = 'mfoot';
    foot.style.cssText = 'flex-shrink:0;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)';
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--fg2,#9aa3ad);margin-right:auto';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    const lb = document.createElement('span');
    lb.textContent = '以后不再自动弹出';
    wrap.appendChild(cb); wrap.appendChild(lb);
    const go = document.createElement('button');
    go.className = 'btn';
    go.textContent = '开始使用';
    go.onclick = function () {
      try { if (cb.checked) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch (e) {}
      closeModal();
    };
    foot.appendChild(wrap); foot.appendChild(go);
    box.appendChild(foot);
  });
}

export function maybeShowGuide() {
  try { if (localStorage.getItem(FLAG) === '1') return; } catch (e) {}
  // 让书架先画出来, 别和首帧抢主线程
  setTimeout(function () { try { showGuide(false); } catch (e) {} }, 900);
}
