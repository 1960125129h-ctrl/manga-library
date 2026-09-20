// 章节(chapter)辅助
// 从 legacy/core.js 抽出的纯函数

export function nOf(ch) { return ch.files ? ch.files.length : ch.n; }

export function chLabel(ch) { return ch.label || ch.name || ""; }


// 页地址构造(纯函数: 只看传进来的 chapter 元数据)

export function pageList(c, ch) {
  if (ch.files) { var a = []; for (var i = 0; i < ch.files.length; i++) a.push(c.prefix + ch.files[i]); return a; }
  var out = [];
  var dp = ch.path !== undefined ? ch.path : (ch.name || "");
  var base = c.prefix + (dp ? dp + "/" : "");
  for (var k = 1; k <= ch.n; k++) { var s = String(k); while (s.length < ch.pad) s = "0" + s; out.push(base + s + ch.ext); }
  return out;
}

export function imgFile(ch, idx) {                 // 第 idx 页在书里的相对路径
  if (!ch) return "";
  if (ch.files) return ch.files[idx] === undefined ? "" : ch.files[idx];
  var dp = ch.path !== undefined ? ch.path : (ch.name || "");
  var s = String(idx + 1); while (s.length < ch.pad) s = "0" + s;
  return (dp ? dp + "/" : "") + s + ch.ext;
}
