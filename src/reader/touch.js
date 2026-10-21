import { S } from '../app/state.js';
import { zoomAt, applyZoom } from '../reader/zoom.js';
import { panCanvas } from '../reader/view.js';

let elStage;

export function initReaderTouch(ctx) {
  elStage = ctx.elStage;
  const tapPrev = document.getElementById('tap-prev');
  const tapNext = document.getElementById('tap-next');
  const edgeLeft = document.getElementById('edge-left');
  const edgeRight = document.getElementById('edge-right');
  if (!elStage || !tapPrev || !tapNext) return;
  const closeReader = ctx.closeReader || function () {
    const bback = document.getElementById('bback');
    if (bback) bback.click();
  };

  let lastTouchEnd = 0;       // 触摸结束时间戳, 用于拦截合成 click
  let flipLock = 0;           // 翻页防抖: 300ms 内只翻一次
  document.addEventListener('touchend', function () { lastTouchEnd = Date.now(); }, { passive: true });

  function updateLabels() {
    const rtl = S.dir === 'rtl';
    tapPrev.setAttribute('aria-label', rtl ? '下一页' : '上一页');
    tapNext.setAttribute('aria-label', rtl ? '上一页' : '下一页');
  }

  function doFlip(forward) {
    const now = Date.now();
    if (now - flipLock < 80) return;    // 防抖: 80ms 内重复翻页直接忽略 (不挡双击撤销)
    flipLock = now;
    if (forward) ctx.nextPage(); else ctx.prevPage();
  }

  tapPrev.onclick = function (ev) {
    if (Date.now() - lastTouchEnd < 600) return;
    ev.preventDefault();
    ev.stopPropagation();
    updateLabels();
    doFlip(S.dir === 'rtl');
  };

  tapNext.onclick = function (ev) {
    if (Date.now() - lastTouchEnd < 600) return;
    ev.preventDefault();
    ev.stopPropagation();
    updateLabels();
    doFlip(S.dir !== 'rtl');
  };

  // 触屏设备: 直接禁用 tap-zone 的指针事件, 彻底避免合成 click 双翻
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    tapPrev.style.pointerEvents = 'none';
    tapNext.style.pointerEvents = 'none';
  }

  const active = new Map();
  let single = null;
  let pinch = null;
  let edge = null;
  let lastTap = null;
  let longTimer = null;
  let suppressNativeCtx = false;
  document.addEventListener('contextmenu', function (ev) {
    if (suppressNativeCtx && !ev.syntheticLongPress) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);

  function clearLongPress() {
    if (longTimer) {
      clearTimeout(longTimer);
      longTimer = null;
    }
  }

  function fireLongPress(x, y) {
    suppressNativeCtx = true;
    setTimeout(function () { suppressNativeCtx = false; }, 900);
    const target = document.elementFromPoint(x, y) || elStage;
    try {
      const holder = target.closest ? target.closest('[oncontextmenu], .pageimg, #canvas') : null;
      if (holder && typeof holder.oncontextmenu === 'function') {
        holder.oncontextmenu({ clientX: x, clientY: y, preventDefault: function () {}, stopPropagation: function () {} });
      }
    } catch (e) {}
  }

  function point(touch) {
    return { x: touch.clientX, y: touch.clientY };
  }

  function distance(a, b) {
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function localPoint(p) {
    const r = elStage.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }

  function beginPinch() {
    const vals = [...active.values()];
    const a = vals[0];
    const b = vals[1];
    const m = midpoint(a, b);
    if (!S.zoom) {
      const canvas = elStage.querySelector('#canvas') || elStage;
      const im = canvas.querySelector('img.pageimg');
      const r = (im && im.getBoundingClientRect().width > 2)
        ? im.getBoundingClientRect()
        : (canvas.querySelector('.pagewrap') || canvas).getBoundingClientRect();
      const sr = elStage.getBoundingClientRect();
      S.tx = r.left - sr.left;
      S.ty = r.top - sr.top;
    }
    single = null;
    const lm = localPoint(m);
    pinch = {
      d0: distance(a, b),
      z0: S.zscale || 1,
      tx0: S.tx || 0,
      ty0: S.ty || 0,
      mx0: lm.x,
      my0: lm.y
    };
  }

  elStage.addEventListener('touchstart', function (ev) {
    for (const t of ev.changedTouches) active.set(t.identifier, point(t));

    if (active.size === 1 && ev.changedTouches.length === 1) {
      const t = ev.changedTouches[0];
      const p = point(t);
      single = {
        id: t.identifier,
        x: p.x,
        y: p.y,
        sx: p.x,
        sy: p.y,
        moved: false,
        horizontal: false
      };
      clearLongPress();
      longTimer = setTimeout(function () {
        if (single && !single.moved && active.size === 1) {
          single.moved = true;
          fireLongPress(single.sx, single.sy);
        }
      }, 450);
    }

    if (active.size >= 2) {
      ev.preventDefault();
      clearLongPress();
      beginPinch();
    }
  }, { passive: false });

  elStage.addEventListener('touchmove', function (ev) {
    for (const t of ev.changedTouches) {
      if (active.has(t.identifier)) active.set(t.identifier, point(t));
    }

    if (pinch && active.size >= 2) {
      ev.preventDefault();
      clearLongPress();
      const vals = [...active.values()];
      const a = vals[0];
      const b = vals[1];
      const m = midpoint(a, b);
      const lp = localPoint(m);
      let z = pinch.z0 * distance(a, b) / pinch.d0;
      z = Math.max(0.2, Math.min(8, z));
      const k = z / pinch.z0;
      S.tx = lp.x - (pinch.mx0 - pinch.tx0) * k;
      S.ty = lp.y - (pinch.my0 - pinch.ty0) * k;
      applyZoom(z);
      return;
    }

    if (!single) return;
    const t = [...ev.changedTouches].find((item) => item.identifier === single.id);
    if (!t) return;
    const p = point(t);
    const dx = p.x - single.x;
    const dy = p.y - single.y;
    const totalX = p.x - single.sx;
    const totalY = p.y - single.sy;
    if (Math.hypot(totalX, totalY) > 9) { single.moved = true; clearLongPress(); }
    single.x = p.x;
    single.y = p.y;

    if (S.zoom) {
      ev.preventDefault();
      S.tx = (S.tx || 0) + dx;
      S.ty = (S.ty || 0) + dy;
      panCanvas();
      return;
    }

    if (!single.horizontal && Math.abs(totalX) > 18 && Math.abs(totalX) > Math.abs(totalY) * 1.1) {
      single.horizontal = true;
    }
    if (single.horizontal) ev.preventDefault();   // 横滑一旦判定就锁住, 不让浏览器/外壳当成后退或滚动
  }, { passive: false });

  const isMobileUI = () => !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
  const barHidden = () => document.body.classList.contains('m-bar-hidden');
  function toggleBar() {
    document.body.classList.toggle('m-bar-hidden');
    try { localStorage.setItem('readerBarHidden', barHidden() ? '1' : '0'); } catch (e) {}
  }
  try { if (localStorage.getItem('readerBarHidden') === '1') document.body.classList.add('m-bar-hidden'); } catch (e) {}

  function handleTap(p) {
    // 点下立即翻页 (无延迟); 缩放靠双指捏合
    const w = window.innerWidth;
    if (isMobileUI()) {
      // 手机: 三分区 —— 右 1/3 下一页, 左 1/3 上一页, 中间 1/3 显隐顶栏(右手单手也能全摸到)
      const third = w / 3;
      const zone = p.x < third ? 'prev' : (p.x > w - third ? 'next' : 'mid');
      if (zone === 'mid') { toggleBar(); suppressSyntheticClick(); return; }
      const forward = S.dir === 'rtl' ? zone === 'prev' : zone === 'next';
      doFlip(forward);
      suppressSyntheticClick();   // 拦截触摸合成的 click, 防止双翻
      return;
    }
    const forward = S.dir === 'rtl' ? p.x < w * 0.5 : p.x > w * 0.5;
    doFlip(forward);
    suppressSyntheticClick();   // 拦截触摸合成的 click, 防止双翻
  }

  elStage.addEventListener('touchend', function (ev) {
    for (const t of ev.changedTouches) active.delete(t.identifier);
    clearLongPress();

    if (pinch && active.size < 2) {
      const z = S.zscale || 1;
      pinch = null;
      if (z <= 1.05) applyZoom(1);
      if (active.size === 1 && S.zoom) {
        const [id, p] = [...active][0];
        single = { id, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: true, horizontal: false };
      }
    }

    if (!single) return;
    const t = [...ev.changedTouches].find((item) => item.identifier === single.id);
    if (!t) return;
    const p = point(t);
    const dx = p.x - single.sx;
    const horizontal = single.horizontal;
    const wasMoved = single.moved;
    single = null;

    if (S.zoom) return;
    if (horizontal && Math.abs(dx) > 50) {
      const forward = S.dir === 'rtl' ? dx > 0 : dx < 0;
      doFlip(forward);
      suppressSyntheticClick();
    } else if (!wasMoved) {
      handleTap(p);
    }
  }, { passive: false });

  function edgeStart(ev, side) {
    if (ev.touches.length !== 1 || ev.changedTouches.length !== 1) return;
    ev.preventDefault();
    ev.stopPropagation();
    const t = ev.changedTouches[0];
    const p = point(t);
    edge = { id: t.identifier, side, x: p.x, y: p.y, done: false, cancelled: false };
  }

  function edgeMove(ev) {
    if (!edge) return;
    const t = [...ev.changedTouches].find((item) => item.identifier === edge.id);
    if (!t) return;
    ev.preventDefault();
    ev.stopPropagation();
    const p = point(t);
    const dx = p.x - edge.x;
    const dy = p.y - edge.y;
    const inward = edge.side === 'left' ? dx : -dx;
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(inward)) edge.cancelled = true;
    if (!edge.cancelled && !edge.done && inward > 70 && Math.abs(inward) > Math.abs(dy) * 1.15) {
      edge.done = true;
      closeReader();
    }
  }

  function edgeEnd(ev) {
    if (!edge) return;
    const t = [...ev.changedTouches].find((item) => item.identifier === edge.id);
    if (!t) return;
    ev.preventDefault();
    ev.stopPropagation();
    edge = null;
  }

  // 触屏设备上不挂自己那套边缘内滑: 系统(小米/Chrome)的边缘返回手势永远优先,
  // 留着只会在某些机型上两边抢手势; 退出统一走「系统返回 / 右下角按钮 / 顶栏书架」。
  const coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (coarsePointer) {
    if (edgeLeft) edgeLeft.style.pointerEvents = 'none';
    if (edgeRight) edgeRight.style.pointerEvents = 'none';
  }
  if (edgeLeft && !coarsePointer) {
    edgeLeft.addEventListener('touchstart', function (ev) { edgeStart(ev, 'left'); }, { passive: false });
    edgeLeft.addEventListener('touchmove', edgeMove, { passive: false });
    edgeLeft.addEventListener('touchend', edgeEnd, { passive: false });
    edgeLeft.addEventListener('touchcancel', function () { edge = null; });
  }

  if (edgeRight && !coarsePointer) {
    edgeRight.addEventListener('touchstart', function (ev) { edgeStart(ev, 'right'); }, { passive: false });
    edgeRight.addEventListener('touchmove', edgeMove, { passive: false });
    edgeRight.addEventListener('touchend', edgeEnd, { passive: false });
    edgeRight.addEventListener('touchcancel', function () { edge = null; });
  }

  elStage.addEventListener('touchcancel', function () {
    active.clear();
    single = null;
    pinch = null;
    clearLongPress();
  }, { passive: true });

  initMobileNavButtons();
  initMobileBackFab(closeReader);
  updateLabels();
}

// 右下角常驻「返回书架」: 右手单手时拇指天然位置, 不依赖系统手势也不依赖左上角
function initMobileBackFab(closeReader) {
  if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
  if (document.getElementById('mback-fab')) return;
  const host = document.getElementById('reader') || document.body;
  const b = document.createElement('button');
  b.id = 'mback-fab';
  b.type = 'button';
  b.title = '返回书架';
  b.setAttribute('aria-label', '返回书架');
  b.textContent = '‹ 书架';
  b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); closeReader(); });
  b.addEventListener('touchstart', function (ev) { ev.stopPropagation(); }, { passive: true });
  host.appendChild(b);
}

function initMobileNavButtons() {
  if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
  if (document.getElementById('mnav-chapters')) return;
  const bar = document.getElementById('bar');
  if (!bar) return;
  const groups = bar.querySelectorAll('.grp');
  const modeGroup = groups[2] || null;   // 0 书架, 1 上下话, 2 单页/双页/长条
  const grp = document.createElement('div');
  grp.className = 'grp mnav-grp';

  const b1 = document.createElement('button');
  b1.className = 'b mnav-btn';
  b1.id = 'mnav-chapters';
  b1.type = 'button';
  b1.textContent = '目录';
  b1.title = '章节目录';
  b1.addEventListener('click', function () {
    const t = document.getElementById('sidetoggle');
    if (t) t.click();
  });

  const b2 = document.createElement('button');
  b2.className = 'b mnav-btn';
  b2.id = 'mnav-thumbs';
  b2.type = 'button';
  b2.textContent = '预览';
  b2.title = '缩略图预览';
  b2.addEventListener('click', function () {
    const t = document.getElementById('thumbtoggle');
    if (t) t.click();
  });

  const b3 = document.createElement('button');
  b3.className = 'b mnav-btn more';
  b3.id = 'mnav-more';
  b3.type = 'button';
  b3.textContent = '更多';
  b3.title = '展开/收起全部阅读设置';
  b3.addEventListener('click', function () {
    const expanded = bar.classList.toggle('m-more');
    b3.textContent = expanded ? '收起' : '更多';
    try { localStorage.setItem('readerMoreExpanded', expanded ? '1' : '0'); } catch (e) {}
  });
  // 恢复上次的展开状态
  try {
    if (localStorage.getItem('readerMoreExpanded') === '1') {
      bar.classList.add('m-more');
      b3.textContent = '收起';
    }
  } catch (e) {}

  grp.appendChild(b1);
  grp.appendChild(b2);
  grp.appendChild(b3);
  if (modeGroup) bar.insertBefore(grp, modeGroup);
  else bar.appendChild(grp);
}

function suppressSyntheticClick() {
  function onClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    window.removeEventListener('click', onClick, true);
  }
  window.addEventListener('click', onClick, true);
}
