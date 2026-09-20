(function () {
  return new Promise(function (resolve) {
    var rd = document.getElementById("reader");
    if (!rd || rd.classList.contains("hide")) {
      var c = document.querySelector("#grid .card");
      if (c) c.click();
      resolve(JSON.stringify({ 状态: "刚点开一本, 再跑一次" }));
      return;
    }
    var s = document.getElementById("stage");
    if (String(s.className).indexOf("mode-scroll") < 0) {
      var b = document.getElementById("m-scroll");
      if (b) { b.click(); resolve(JSON.stringify({ 状态: "已切长条, 再跑一次" })); return; }
    }
    var frames = [], long = [];
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { long.push(Math.round(e.duration)); }); }).observe({ type: "longtask", buffered: false }); } catch (e) {}
    var last = performance.now(), stop = false, decodes = 0;
    function tick(now) { frames.push(now - last); last = now; if (!stop) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
    var startTop = s.scrollTop, step = Math.round(s.clientHeight * 0.9), n = 0;
    var maxY = s.scrollHeight - s.clientHeight;
    var iv = setInterval(function () {
      n++;
      s.scrollTop = Math.min(maxY, startTop + n * step);
      if (s.scrollTop >= maxY) { clearInterval(iv); }
    }, 250);
    setTimeout(function () {
      clearInterval(iv); stop = true;
      var ims = document.querySelectorAll("#stage img"), loaded = 0;
      for (var i = 0; i < ims.length; i++) if (ims[i].complete && ims[i].naturalWidth > 0) loaded++;
      var a = frames.slice(3).sort(function (x, z) { return x - z; });
      var sum = 0; a.forEach(function (x) { sum += x; });
      resolve(JSON.stringify({
        页面总数: ims.length,
        已解码: loaded,
        滚动步数: n,
        滚到: Math.round(s.scrollTop) + "/" + Math.round(maxY),
        帧数: a.length,
        平均帧间隔: Math.round(sum / a.length * 100) / 100,
        中位: Math.round(a[Math.floor(a.length / 2)] * 100) / 100,
        p95: Math.round(a[Math.floor(a.length * 0.95)] * 100) / 100,
        最差: Math.round(a[a.length - 1] * 100) / 100,
        超过8ms的帧: a.filter(function (x) { return x > 8; }).length,
        超过30ms的帧: a.filter(function (x) { return x > 30; }).length,
        长任务: long.slice(0, 8)
      }, null, 1));
    }, 5200);
  });
})()