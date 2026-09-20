import fs from "node:fs";
const P = "D:/gong zuo qu/漫画书库/";
function look(file, label) {
  let t;
  try { t = fs.readFileSync(file, "utf8").split(String.fromCharCode(13)).join(""); } catch (e) { console.log(label + ": 读不到"); return; }
  const i = t.indexOf("browsertabs:pending");
  console.log("=== " + label + " ===");
  console.log("  browsertabs:pending 出现次数: " + (t.split("browsertabs:pending").length - 1));
  console.log("  含 tabsPending().then: " + (t.indexOf("tabsPending().then") >= 0));
  console.log("  含 setTimeout(function () { show(\"browser\"): " + (t.indexOf("setTimeout(function () { show(\"browser\"") >= 0));
  console.log("  含 show(\"browser\", \"browsertabs:pending\"): " + (t.indexOf("show(\"browser\", \"browsertabs:pending\"") >= 0));
  console.log("  行数: " + t.split(String.fromCharCode(10)).length + "  字节: " + fs.statSync(file).size);
}
look(P + "_scripts/reader-core.js", "当前 _scripts/reader-core.js");
look(P + "_backup_20260919-152136/reader-core.js", "存档 152136");
look(P + "_backup_20260919-130448/reader-core.js", "存档 130448");
look(P + "_backup_20260919-053204/reader-core.js", "存档 053204");