// 禁漫「老方式」下载入口 —— 只给开发版用
//
// 老方式 = 浏览器过 Cloudflare → 点「免等待、點我直接下載」→ 关广告页 → 识别验证码
//        → 表单提交 → 等 zip 落盘 → 解压 → 切页拼合（单话约 7~9 秒）
//
// 为什么单独一个文件:
//   它依赖 _scripts/jm/ocr_server.py（EasyOCR 验证码识别）。打包版不带这个组件，
//   也不允许出现相关文案，所以整个界面模块在打包时被排除（见 _app/package.json 的 ../src 过滤器）。
//   运行期由主进程的能力查询决定要不要动态加载：有 ocr_server.py 才 import 这个文件。

export function mountLegacy(ctx) {
  var box = ctx.box, anchor = ctx.anchor;

  /* ---------- 模式条 ---------- */
  var bar = document.createElement("div"); bar.className = "stat";
  bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.045);margin:2px 0 6px";
  var txt = document.createElement("span"); txt.style.flex = "1";
  var btn = document.createElement("button"); btn.className = "tab";
  bar.appendChild(txt); bar.appendChild(btn);

  function refresh() {
    var img = ctx.getMode();
    txt.textContent = img
      ? "当前：图片直取 · 快（无验证码 / 无 zip / 无广告页）"
      : "当前：老方式 · 慢（过 CF + 点免等待 + 验证码 OCR + 收 zip）";
    btn.textContent = img ? "切到老方式" : "切回图片直取";
    btn.title = "老方式保留作兜底：禁漫图床如果改了图片命名规律，直取会失效，这时用老方式";
  }
  btn.onclick = function () { ctx.setMode(!ctx.getMode()); refresh(); };
  refresh();

  /* ---------- 老方式说明 + 按钮 ---------- */
  var tip = document.createElement("div"); tip.className = "stat";
  tip.style.cssText = "display:block;padding:8px 0 4px;color:#8f96a0";
  tip.textContent = "老方式流程：过 CF → 点「免等待、點我直接下載」→ 关广告页 → 识别验证码 → 表单提交 → 等 zip 落盘 → 解压 → 切页拼合。单话约 7~9 秒，必须保证浏览器开着。";

  var zipGo = document.createElement("button"); zipGo.className = "btn ghost"; zipGo.textContent = "用老方式下载这一批";
  zipGo.style.margin = "4px 0 12px";
  zipGo.onclick = function () { ctx.setMode(false); refresh(); ctx.startRun(false); };

  var wrap = document.createElement("div");
  wrap.appendChild(bar); wrap.appendChild(tip); wrap.appendChild(zipGo);
  box.insertBefore(wrap, anchor);
  return wrap;
}
