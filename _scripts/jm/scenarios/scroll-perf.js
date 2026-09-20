(function () {
  return new Promise(function (resolve) {
    var grid = document.getElementById("grid");
    if (!grid) { resolve(JSON.stringify({ 错误: "没有 #grid" })); return; }
    var frames = [], long = [], cls = {}, n = 0;
    try {
      var lt = new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { long.push(Math.round(e.duration)); }); });
      lt.observe({ type: "longtask", buffered: false });
    } catch (e) {}
    var last = performance.now(), stop = false;
    function tick(now) {
      frames.push(now - last); last = now;
      var c = grid.className || "(无class)";
      cls[c] = (cls[c] || 0) + 1;
      if (!stop) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    var y = 0, maxY = 0;
    var iv = setInterval(function () {
      y += 140; maxY = Math.max(1, grid.scrollHeight - grid.clientHeight);
      try { grid.dispatchEvent(new WheelEvent("wheel", { deltaY: 140, bubbles: true, cancelable: true })); } catch (e) {}
      grid.scrollTop = y % maxY; n++;
    }, 16);
    setTimeout(function () {
      clearInterval(iv); stop = true;
      var a = frames.slice(3).sort(function (x, z) { return x - z; });
      var sum = 0; a.forEach(function (x) { sum += x; });
      var bd = 0, all = document.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        var s = getComputedStyle(all[i]);
        if (s.backdropFilter && s.backdropFilter !== "none") { var r = all[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) bd++; }
      }
      resolve(JSON.stringify({
        滚动次数: n,
        帧数: a.length,
        平均帧间隔: Math.round(sum / a.length * 100) / 100,
        中位: Math.round(a[Math.floor(a.length / 2)] * 100) / 100,
        p95: Math.round(a[Math.floor(a.length * 0.95)] * 100) / 100,
        最差: Math.round(a[a.length - 1] * 100) / 100,
        超过8ms的帧: a.filter(function (x) { return x > 8; }).length,
        长任务: long.slice(0, 8),
        grid的class分布: cls,
        可见磨砂元素: bd
      }, null, 1));
    }, 3000);
  });
})()