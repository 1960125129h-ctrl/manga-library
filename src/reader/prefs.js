// 阅读器的「显示偏好」: 全局一份, 不跟每本书绑
//
// 以前这些值写进每本书的进度里(open.js 的 save()), 结果是换本书就回到那本书上次的样子。
// 现在统一存书库根目录的 reader-prefs.json:
//   · 桌面端(Electron) -> 主进程 IPC(reader:prefsGet / reader:prefsSave)
//   · 手机 / 浏览器     -> HTTP /api/reader-prefs(GET/POST)
// 两端读的是同一个文件, 所以"电脑上选了双页, 手机上打开也是双页"。
//
// 注意分工: 这里只存"怎么显示"; "读到第几话第几页"仍然按书写进 .progress.json。

import { S } from '../app/state.js';

const API = '/api/reader-prefs';
const LKEY = 'readerPrefs';          // 本机镜像: 启动瞬间先按它渲染, 再异步跟文件对齐
export const PREF_KEYS = ['mode', 'fit', 'dir', 'cover', 'sidebar', 'thumbs', 'wheel', 'rev', 'prevRev', 'theme', 'bright', 'scale',
                        'enhance', 'contrast', 'saturate', 'preload', 'spreadWide', 'gap', 'imgfx', 'edgefx'];
const FX_KEYS = { bright: [0, 200, 100], contrast: [0, 200, 100], saturate: [0, 200, 100],
                  warmth: [-100, 100, 0], tint: [-100, 100, 0],
                  highlights: [-100, 100, 0], shadows: [-100, 100, 0], curve: [-100, 100, 0],
                  denoise: [0, 100, 0], clarity: [0, 100, 0], fade: [0, 100, 0],
                  grain: [0, 100, 0], noise: [0, 100, 0], sharpen: [0, 100, 0] };
// 横排防剧透：左/右开关 + 清晰区宽度(%) + 模糊强度(px) + 压暗(%)
export function sanitizeEdgeFx(src) {
  const s = (src && typeof src === 'object') ? src : {};
  const num = (v, lo, hi, dv) => { const n = Number(v); return (isFinite(n) && n >= lo && n <= hi) ? Math.round(n) : dv; };
  // 旧数据没有 mode 字段：那时 left/right 是 0/1 数字，1 是默认值。
  // 迁移时把 1 当成"自动"（等价于旧的中间页行为），0 保留为"关"。
  const legacy = typeof s.mode !== 'string';
  const tri = (v) => {
    if (v === 'auto') return 'auto';
    if (v === 'off' || v === 0 || v === '0' || v === false) return 'off';
    if (v === 'on') return 'on';
    if (v === 1 || v === '1' || v === true) return legacy ? 'auto' : 'on';
    return 'auto';
  };
  return {
    mode: (s.mode === 'manual') ? 'manual' : 'auto',
    left: tri(s.left),
    right: tri(s.right),
    clear: num(s.clear, 30, 90, 50),
    blur: num(s.blur, 0, 30, 12),
    dim: num(s.dim, 0, 80, 28),
    smooth: (s.smooth === 0 || s.smooth === false) ? 0 : 1
  };
}
export function sanitizeImgFx(src) {
  const s = (src && typeof src === 'object') ? src : {};
  const o = {};
  for (const k in FX_KEYS) {
    const [lo, hi, dv] = FX_KEYS[k];
    const v = Number(s[k]);
    o[k] = (isFinite(v) && v >= lo && v <= hi) ? Math.round(v) : dv;
  }
  return o;
}
const MODES = ['single', 'double', 'scroll', 'hscroll'];
const FITS = ['width', 'height', 'page', 'original'];
const THEMES = ['dark', 'light', 'eye', 'paper'];

let current = null;
let saveTimer = 0;
let lastErr = '';

function isElectron() { try { return !!(window.mangaLib && window.mangaLib.isElectron); } catch (e) { return false; } }
function coarse() { try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } }

export function defaults() {
  return { mode: 'single', fit: 'height', dir: 'ltr', cover: false,
           sidebar: !coarse(), thumbs: false, wheel: true, rev: false, prevRev: false,
           theme: 'dark', bright: 1, scale: 1,
           enhance: 'off', contrast: 1, saturate: 1, preload: 4, spreadWide: 'auto', gap: 8,
           imgfx: sanitizeImgFx(null), edgefx: sanitizeEdgeFx(null) };
}

// 只认列出来的键, 并且逐个校验类型/取值 —— 文件坏了或手改错了也不会把界面搞崩
export function sanitize(src) {
  const d = defaults(), o = {};
  const s = (src && typeof src === 'object') ? src : {};
  o.mode = MODES.indexOf(s.mode) >= 0 ? s.mode : d.mode;
  o.fit = FITS.indexOf(s.fit) >= 0 ? s.fit : d.fit;
  o.dir = s.dir === 'rtl' ? 'rtl' : 'ltr';
  o.cover = !!s.cover;
  o.sidebar = typeof s.sidebar === 'boolean' ? s.sidebar : d.sidebar;
  o.thumbs = typeof s.thumbs === 'boolean' ? s.thumbs : d.thumbs;
  o.wheel = typeof s.wheel === 'boolean' ? s.wheel : d.wheel;
  o.rev = !!s.rev;
  o.prevRev = !!s.prevRev;
  o.theme = THEMES.indexOf(s.theme) >= 0 ? s.theme : d.theme;
  o.bright = (typeof s.bright === 'number' && s.bright >= 0 && s.bright <= 1) ? s.bright : d.bright;
  // 长条模式的整本缩放比例：40%~160%，越界夹住
  var sc = Number(s.scale);
  o.scale = (isFinite(sc) && sc >= 0.1 && sc <= 1.6) ? Math.round(sc * 100) / 100 : d.scale;
  // 2.0 施工项 A：画质增强（三档锐化 + 对比）与预加载页数
  o.enhance = ['off', 'soft', 'medium', 'strong', 'line'].indexOf(s.enhance) >= 0 ? s.enhance : d.enhance;
  var ct = Number(s.contrast);
  o.contrast = (isFinite(ct) && ct >= 0.8 && ct <= 1.4) ? Math.round(ct * 100) / 100 : d.contrast;
  var st2 = Number(s.saturate);
  o.saturate = (isFinite(st2) && st2 >= 0.5 && st2 <= 1.8) ? Math.round(st2 * 100) / 100 : d.saturate;
  var pl = Number(s.preload);
  o.preload = (isFinite(pl) && pl >= 1 && pl <= 8) ? Math.round(pl) : d.preload;
  // 2.0 施工项 B：横向条带的跨页判定与页间距
  o.imgfx = sanitizeImgFx(s.imgfx);
  o.edgefx = sanitizeEdgeFx(s.edgefx);
  o.spreadWide = ['auto', 'on', 'off'].indexOf(s.spreadWide) >= 0 ? s.spreadWide : d.spreadWide;
  var gp = Number(s.gap);
  o.gap = (isFinite(gp) && gp >= 0 && gp <= 48) ? Math.round(gp) : d.gap;
  return o;
}

// 当前状态 -> 偏好对象(只取 PREF_KEYS 里的)
export function snapshot() {
  const o = {};
  for (let i = 0; i < PREF_KEYS.length; i++) { const k = PREF_KEYS[i]; o[k] = S[k]; }
  return sanitize(o);
}

// 偏好 -> 状态(合法化后写回 S), 返回合法化后的对象
export function applyToState(p) {
  const v = sanitize(p);
  current = v;
  S.mode = v.mode; S.fit = v.fit; S.dir = v.dir; S.cover = v.cover;
  S.sidebar = v.sidebar; S.thumbs = v.thumbs; S.wheel = v.wheel;
  S.rev = v.rev; S.prevRev = v.prevRev;
  S.theme = v.theme; S.bright = v.bright;
  S.scale = v.scale;
  S.enhance = v.enhance; S.contrast = v.contrast; S.saturate = v.saturate; S.preload = v.preload;
  S.imgfx = v.imgfx; S.edgefx = v.edgefx;
  S.spreadWide = v.spreadWide; S.gap = v.gap;
  try { document.documentElement.style.setProperty('--hgap', String(v.gap) + 'px'); } catch (err) {}
  // 立刻把比例写到 CSS 变量和工具栏文字上：
  // 打开书时 render() 可能早于 prefs 异步回来，只靠 render 会显示成 100%
  try {
    document.documentElement.style.setProperty("--scroll-scale", String(v.scale));
    var st = document.getElementById("bscaletxt");
    if (st) st.textContent = Math.round(v.scale * 100) + "%";
  } catch (err) {}
  return v;
}

export function prefs() { if (!current) current = sanitize(null); return current; }
export const lastError = () => lastErr;

function mirror(v) { try { localStorage.setItem(LKEY, JSON.stringify(v)); } catch (e) {} }

async function readFile() {
  if (isElectron()) {
    if (!window.mangaLib.readerPrefsGet) return null;
    return await window.mangaLib.readerPrefsGet();
  }
  const r = await fetch(API, { cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j) return null;
  return j.prefs || j;
}

async function writeFile(v) {
  if (isElectron()) {
    if (!window.mangaLib.readerPrefsSave) return false;
    const r = await window.mangaLib.readerPrefsSave(v);
    return !!(r && r.ok !== false);
  }
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
  return r.ok;
}

// 启动时调用一次: 先按本机镜像把界面立起来(同步), 再跟文件对齐(异步)
export async function loadPrefs() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch (e) {}
  if (m) applyToState(m);
  try {
    const remote = await readFile();
    if (remote && typeof remote === 'object') {
      const v = applyToState(remote);
      mirror(v);
      return v;
    }
    // 文件还不存在(第一次用): 以当前状态初始化一份, 顺手把这个初值写进去
    const v = applyToState(current || snapshot());
    mirror(v);
    await writeFile(v);
    return v;
  } catch (e) { lastErr = String((e && e.message) || e); }
  return prefs();
}

// 改了偏好就调它(默认防抖 250ms; now=true 立刻写)
export function savePrefs(now) {
  const v = snapshot();
  current = v;
  mirror(v);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
  const fire = function () {
    writeFile(v).catch(function (e) { lastErr = String((e && e.message) || e); });
  };
  if (now) { fire(); return; }
  saveTimer = setTimeout(function () { saveTimer = 0; fire(); }, 250);
}