(function () {
  // 让 App 以为你按了 F9(它的全局按键处理里听的 keydown)
  var ev = new KeyboardEvent("keydown", { key: "F9", bubbles: true });
  try { document.dispatchEvent(ev); } catch (e) {}
  try { window.dispatchEvent(new KeyboardEvent("keydown", { key: "F9", bubbles: true })); } catch (e) {}
  return JSON.stringify({ 状态: "已按下 F9, 等 3 秒采样", 提示: "verify 重试时会等到结果" });
})()