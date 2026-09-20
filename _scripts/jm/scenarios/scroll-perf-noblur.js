(function () {
  return new Promise(function (resolve) {
    // 注入"关掉所有 backdrop-filter", 然后照 scroll-perf 的方式滚 3 秒
    var st = document.createElement("style");
    st.id = "no-blur-test";
    st.textContent = "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}";
    document.head.appendChild(st);
    var grid = document.getElementById("grid");
    if (!grid) { resolve(JSON.stringify({ 错误: "没有 #grid" })); return; }
    setTimeout(function () {
      var frames = [], long = [];
      try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { long.push(Math.round(e.duration)); }); }).observe({ type: "longtask", buffered: false }); } catch (e) {}
      var last = performance.now(), stop = false;
      function tick(now) { frames.push(now - last); last = now; if (!stop) requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
      var y = 0, n = 0, maxY = Math.max(1, grid.scrollHeight - grid.clientHeight);
      var iv = setInterval(function () {
        y += 140; n++;
        try { grid.dispatchEvent(new WheelEvent("wheel", { deltaY: 140, bubbles: true, cancelable: true })); } catch (e) {}
        grid.scrollTop = y % maxY;
      }, 16);
      setTimeout(function () {
        clearInterval(iv); stop = true;
        var bd = 0, all = document.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) { var s = getComputedStyle(all[i]); if (s.backdropFilter && s.backdropFilter !== "none") { var r = all[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) bd++; } }
        var a = frames.slice(3).sort(function (x, z) { return x - z; });
        var sum = 0; a.forEach(function (x) { sum += x; });
        try { st.remove(); } catch (e) {}
        resolve(JSON.stringify({
          组: "关掉磨砂",
          剩余可见磨砂元素: bd,
          帧数: a.length,
          平均帧间隔: Math.round(sum / a.length * 100) / 100,
          中位: Math.round(a[Math.floor(a.length / 2)] * 100) / 100,
          p95: Math.round(a[Math.floor(a.length * 0.95)] * 100) / 100,
          最差: Math.round(a[a.length - 1] * 100) / 100,
          超过8ms的帧: a.filter(function (x) { return x > 8; }).length,
          长任务: long.slice(0, 5)
        }, null, 1));
      }, 3000);
    }, 800);
  });
})()