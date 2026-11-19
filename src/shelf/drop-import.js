// 把文件夹拖进窗口 = 登记成「外部目录」（只引用，不复制文件）
//
// 流程：拖入 → 主进程识别（文件夹本身是一本 / 里面每个子文件夹各是一本）
//      → 弹框确认书名 → 写 外部目录.json → 静默重建书库
//
// 为什么需要 preload 的 getDroppedPaths：Electron 32 起 File.path 已移除，
// 渲染进程自己拿不到真实路径，只能让 preload 用 webUtils.getPathForFile 换回来。

import { hint, showModal, closeModal } from '../shared/ui.js';

let bound = false;

function desk() {
  const d = window.mangaLib;
  return (d && d.isElectron) ? d : null;
}

function hasFiles(dt) {
  try {
    const t = dt && dt.types;
    if (!t) return false;
    for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
  } catch (e) {}
  return false;
}

function showConfirm(items, cb) {
  showModal(function (box) {
    const h = document.createElement('h3');
    h.textContent = '登记外部图包';
    box.appendChild(h);
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = '这些文件夹里的图片不会被复制，只按路径引用。书名可以改，重名会自动加后缀。';
    box.appendChild(sub);

    const rows = [];
    items.forEach(function (it) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:10px 0 2px';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = true; chk.style.width = 'auto';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = it.name; inp.style.flex = '1';
      inp.onkeydown = function (ev) { ev.stopPropagation(); };
      row.appendChild(chk); row.appendChild(inp);
      box.appendChild(row);

      const p = document.createElement('div');
      p.className = 'sub';
      p.style.cssText = 'margin:0 0 8px 26px;font-size:11px;opacity:.62;word-break:break-all';
      p.textContent = it.path;
      box.appendChild(p);

      rows.push({ chk: chk, inp: inp, it: it });
    });

    const foot = document.createElement('div');
    foot.id = 'mfoot';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost'; cancel.textContent = '取消'; cancel.onclick = closeModal;
    const ok = document.createElement('button');
    ok.className = 'btn'; ok.textContent = '登记';
    ok.onclick = function () {
      const chosen = [];
      rows.forEach(function (r) {
        if (!r.chk.checked) return;
        const nm = String(r.inp.value || '').trim();
        if (nm) chosen.push({ name: nm, path: r.it.path });
      });
      closeModal();
      cb(chosen);
    };
    foot.appendChild(cancel); foot.appendChild(ok);
    box.appendChild(foot);
  });
}

async function handlePaths(paths) {
  const D = desk();
  if (!D || !D.extInspect) { hint('拖入登记需要桌面版'); return; }
  let r = null;
  try { r = await D.extInspect(paths); } catch (e) { r = null; }
  const items = (r && r.items) || [];
  if (!items.length) { hint('没找到可登记的图包（文件夹里要有图片）'); return; }

  showConfirm(items, function (chosen) {
    if (!chosen.length) return;
    Promise.resolve(D.extAdd(chosen)).then(function (ar) {
      if (!ar || !ar.ok) { hint('登记失败：' + ((ar && ar.msg) || '未知错误')); return; }
      hint('已登记 ' + ar.added + ' 个外部图包，正在重建书库…');
      // 只重扫外部目录：其它书从旧 manifest 沿用，不用把整库 1800 多本扫一遍
      try { D.rescan({ quiet: true, extOnly: true }); } catch (e) {}
    }).catch(function (e) { hint('登记失败：' + String(e)); });
  });
}

export function initDropImport() {
  if (bound) return;
  bound = true;

  // 只在拖的是"文件/文件夹"时接管。书架内部的卡片拖拽带的是 text/plain，不受影响。
  document.addEventListener('dragover', function (ev) {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch (e) {}
  }, true);

  document.addEventListener('dragleave', function (ev) {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
  }, true);

  document.addEventListener('drop', function (ev) {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const D = desk();
    if (!D || !D.getDroppedPath) { hint('拖入登记需要桌面版'); return; }
    // 逐个取：FileList 整体过不了 contextBridge（不是可克隆类型），
    // 一定要一个 File 一个 File 地递进去。
    const files = ev.dataTransfer.files || [];
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      try { const p = D.getDroppedPath(files[i]); if (p) paths.push(p); } catch (e) {}
    }
    if (!paths.length) { hint('没读到拖入的路径'); return; }
    handlePaths(paths);
  }, true);
}
