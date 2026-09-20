// 字符串处理: 编码 / 规范化 / 标题清洗
// 从 legacy/core.js 抽出的纯函数(无状态、不碰 DOM)

export function enc(p) {
  var s = encodeURI(p).split("#").join("%23").split("?").join("%3F");
  // 中文等非 ASCII 也要编码: 外部引用的书是绝对 file:// 地址, 不编码会加载不出来
  return s.replace(/[^\x00-\x7F]/g, function (c) { return encodeURIComponent(c); });
}

export function normName(s) {
  try { return String(s == null ? "" : s).normalize("NFKC").replace(/\s+/g, " ").trim(); }
  catch (e) { return String(s == null ? "" : s).trim(); }
}

export function capFirst(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

export function titleNorm(dir) {
  var s = String(dir || '');
  s = s.split('/').pop() || s;
  s = s.replace(/^\s*\[[^\]]*\]\s*/g, '');                                   // 去开头汉化组/作者方括号前缀
  s = s.replace(/[(\[][^)\]]*(Chinese|English|Japanese|中文|汉化|漢化|中国翻译|中国語|日本語|英語)[^)\]]*[)\]]/gi, ' ');  // 语言标签
  s = s.replace(/AI\s*[Gg]enerated?/g, ' ');                                  // AI 标记
  return s;
}
