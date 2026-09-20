// 数值与时间格式化
// 从 legacy/core.js 抽出的纯函数

export function fmtBytes(b) {
  if (!b) return "0 B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

export function fmtTime(ms) {
  if (!ms) return '';
  var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
