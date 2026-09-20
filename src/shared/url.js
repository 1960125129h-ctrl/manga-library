// URL 处理

// 取主机名(不带协议、不带路径)
export function hostOf(u) {
  var s = String(u || "");
  var i = s.indexOf("://");
  if (i < 0) return "";
  var rest = s.slice(i + 3);
  var j = rest.indexOf("/");
  return j < 0 ? rest : rest.slice(0, j);
}
