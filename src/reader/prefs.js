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
                        'enhance', 'contrast', 'saturate', 'preload', 'spreadWide', 'gap'];
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
           enhance: 'off', contrast: 1, saturate: 1, preload: 4, spreadWide: 'auto', gap: 8 };
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
