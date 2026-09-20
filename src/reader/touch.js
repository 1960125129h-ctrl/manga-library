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

  function updateLabels() {
    const rtl = S.dir === 'rtl';
    tapPrev.setAttribute('aria-label', rtl ? '下一页' : '上一页');
    tapNext.setAttribute('aria-label', rtl ? '上一页' : '下一页');
  }

  tapPrev.onclick = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    updateLabels();
    if (S.dir === 'rtl') ctx.nextPage();
    else ctx.prevPage();
  };

  tapNext.onclick = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    updateLabels();
    if (S.dir === 'rtl') ctx.prevPage();
    else ctx.nextPage();
  };

  const active = new Map();
  let single = null;
  let pinch = null;
  let edge = null;
  let lastTap = null;

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
    }

    if (active.size >= 2) {
      ev.preventDefault();
      beginPinch();
    }
  }, { passive: false });

  elStage.addEventListener('touchmove', function (ev) {
    for (const t of ev.changedTouches) {
      if (active.has(t.identifier)) active.set(t.identifier, point(t));
    }

    if (pinch && active.size >= 2) {
      ev.preventDefault();
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
    if (Math.hypot(totalX, totalY) > 9) single.moved = true;
    single.x = p.x;
    single.y = p.y;

    if (S.zoom) {
      ev.preventDefault();
      S.tx = (S.tx || 0) + dx;
      S.ty = (S.ty || 0) + dy;
      panCanvas();
      return;
    }

    if (!single.horizontal && Math.abs(totalX) > 24 && Math.abs(totalX) > Math.abs(totalY) * 1.2) {
      single.horizontal = true;
    }
  }, { passive: false });

  function handleTap(p) {
    const now = Date.now();
    if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24) {
      if (S.zoom) {
        applyZoom(1);
      } else {
        const lp = localPoint(p);
        zoomAt(2, lp.x, lp.y);
      }
      lastTap = null;
    } else {
      lastTap = { t: now, x: p.x, y: p.y };
    }
  }

  elStage.addEventListener('touchend', function (ev) {
    for (const t of ev.changedTouches) active.delete(t.identifier);

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
      if (forward) ctx.nextPage();
      else ctx.prevPage();
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

  if (edgeLeft) {
    edgeLeft.addEventListener('touchstart', function (ev) { edgeStart(ev, 'left'); }, { passive: false });
    edgeLeft.addEventListener('touchmove', edgeMove, { passive: false });
    edgeLeft.addEventListener('touchend', edgeEnd, { passive: false });
    edgeLeft.addEventListener('touchcancel', function () { edge = null; });
  }

  if (edgeRight) {
    edgeRight.addEventListener('touchstart', function (ev) { edgeStart(ev, 'right'); }, { passive: false });
    edgeRight.addEventListener('touchmove', edgeMove, { passive: false });
    edgeRight.addEventListener('touchend', edgeEnd, { passive: false });
    edgeRight.addEventListener('touchcancel', function () { edge = null; });
  }

  elStage.addEventListener('touchcancel', function () {
    active.clear();
    single = null;
    pinch = null;
  }, { passive: true });

  updateLabels();
}

function suppressSyntheticClick() {
  function onClick(ev) {
    if (ev.target.closest && ev.target.closest('#stage')) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    window.removeEventListener('click', onClick, true);
  }
  window.addEventListener('click', onClick, true);
}
