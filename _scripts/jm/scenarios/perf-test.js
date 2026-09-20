(function () {
  return new Promise(function (resolve) {
    var out = {
      有mangaLib: !!(window.mangaLib),
      有perfLog: typeof (window.mangaLib && window.mangaLib.perfLog),
      直接调IPC: "未试"
    };
    try {
      if (window.mangaLib && window.mangaLib.perfLog) {
        window.mangaLib.perfLog("[PERF-TEST] 直接调 IPC 落盘测试").then(function (r) { out.直接调IPC = "成功 " + JSON.stringify(r); }).catch(function (e) { out.直接调IPC = "失败 " + String(e); });
      } else out.直接调IPC = "没有 perfLog 方法";
    } catch (e) { out.直接调IPC = "抛错 " + String(e); }
    // 再试按键: 看页面上会不会出现"性能采样中"
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F9", bubbles: true })); } catch (e) {}
    try { window.dispatchEvent(new KeyboardEvent("keydown", { key: "F9", bubbles: true })); } catch (e) {}
    setTimeout(function () {
      var t = document.body.innerText || "";
      out.页面出现性能采样提示 = /性能采样/.test(t);
      resolve(JSON.stringify(out, null, 1));
    }, 700);
  });
})()