(function () {
  // 自足: 不在阅读器就自己点开第一本(这样场景单独跑也有意义)
  var rd = document.getElementById("reader");
  if (!rd || rd.classList.contains("hide")) {
    var c = document.querySelector("#grid .card");
    if (c) c.click();
    return JSON.stringify({ 状态: "刚点开一本, 等 2.5 秒再跑我就有数据了", 提示: "verify 会重试" });
  }
  var s = document.getElementById("stage");
  var im = document.querySelector("#stage img");
  var r = im ? im.getBoundingClientRect() : null;
  return JSON.stringify({
    适配: String(s.className).replace("stage ", ""),
    可用区: s.clientWidth + "x" + s.clientHeight,
    变量: (s.style.getPropertyValue("--sw") || "?") + " / " + (s.style.getPropertyValue("--sh") || "?"),
    图: r ? Math.round(r.width) + "x" + Math.round(r.height) : "(无图)",
    原图: im ? (im.naturalWidth + "x" + im.naturalHeight) : "-",
    可滚动: s.scrollHeight > s.clientHeight + 2
  }, null, 1);
})()