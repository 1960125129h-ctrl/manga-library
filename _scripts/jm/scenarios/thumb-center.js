(function () {
  var rd = document.getElementById("reader");
  if (!rd || rd.classList.contains("hide")) {
    var c = document.querySelector("#grid .card");
    if (c) c.click();
    return JSON.stringify({ 状态: "刚点开一本, 等一会儿再跑" });
  }
  var s = document.getElementById("stage");
  // 长条模式最能体现"居中跟随": 自动切过去并滚到 45%
  if (s && String(s.className).indexOf("mode-scroll") < 0) {
    var b = document.getElementById("m-scroll");
    if (b) { b.click(); return JSON.stringify({ 状态: "已切到长条, 再跑一次就有数据" }); }
  }
  var l = document.getElementById("thumblist");
  if (!l) return JSON.stringify({ 错误: "没有侧栏" });
  var on = l.querySelector(".titem.on");
  var lr = l.getBoundingClientRect();
  var o = { 模式: String(s.className).replace("stage ", ""), 缩略图数: l.children.length, 容器高: Math.round(lr.height), 滚动: Math.round(l.scrollTop) };
  if (on) { var r = on.getBoundingClientRect(); o.当前页 = on.getAttribute("data-pi"); o.高亮中心位置 = Math.round((r.top + r.height / 2 - lr.top) / lr.height * 100) + "%"; o.蓝框色 = getComputedStyle(on).borderTopColor; }
  return JSON.stringify(o, null, 1);
})()