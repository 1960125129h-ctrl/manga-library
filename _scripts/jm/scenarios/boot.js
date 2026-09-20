(function () {
  var out = { FCP: 0, 卡片数: 0, 首屏图已解码: 0, 页面错误: [] };
  try { var e = performance.getEntriesByName("first-contentful-paint")[0]; if (e) out.FCP = Math.round(e.startTime); } catch (err) {}
  out.卡片数 = document.querySelectorAll("#grid .card").length;
  var im = document.querySelectorAll("#grid .card img"), done = 0;
  for (var i = 0; i < im.length; i++) if (im[i].complete && im[i].naturalWidth > 0) done++;
  out.首屏图已解码 = done + "/" + im.length;
  out.页面错误 = (window.__errs || []).slice(0, 3);
  return JSON.stringify(out);
})()