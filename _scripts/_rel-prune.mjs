// 发行附件滚动清理：只留最近 N 个版本的 setup，非最新版的 portable 一律删
// 用法: node _scripts/_rel-prune.mjs [--keep 2] [--dry-run]
// 为什么安全: 更新器只读 /releases/latest (见 _app/updater.js:41,104)，旧版资产没人再取
import { execSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const KEEP = parseInt(arg("--keep", "2"), 10) || 2;
const DRY = argv.includes("--dry-run");

const raw = execSync("git credential fill", { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
const tok = (raw.match(/password=(.+)/) || [])[1];
if (!tok) { console.error("拿不到 GitHub 凭据 (git credential fill)"); process.exit(1); }
const H = { Authorization: "token " + tok.trim(), "User-Agent": "shuku", Accept: "application/vnd.github+json" };
const base = "https://api.github.com/repos/1960125129h-ctrl/manga-library";

const cmpVer = (a, b) => {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};

const res = await fetch(base + "/releases?per_page=100", { headers: H });
const releases = (await res.json()).slice().sort((x, y) => cmpVer(y.tag_name, x.tag_name));
const newest = releases[0] ? releases[0].tag_name : null;
const keepSetup = new Set(releases.slice(0, KEEP).map(r => r.tag_name));
console.log("最新版: " + newest + "  保留 setup 的版本: " + [...keepSetup].join(", "));
console.log(DRY ? "模式: DRY-RUN(只列不删)" : "模式: 实删");

const del = [];
for (const r of releases) {
  for (const a of r.assets || []) {
    const isSetup = /setup\.exe$/i.test(a.name);
    const isPortable = /portable\.exe$/i.test(a.name);
    let drop = false;
    if (isSetup) drop = !keepSetup.has(r.tag_name);
    else if (isPortable) drop = r.tag_name !== newest;
    if (drop) del.push({ tag: r.tag_name, id: a.id, name: a.name, mb: a.size / 1048576 });
  }
}

let freed = 0;
for (const d of del) {
  if (DRY) { console.log("would delete " + d.tag + "  " + d.name + "  " + d.mb.toFixed(1) + " MB"); freed += d.mb; continue; }
  const r = await fetch(base + "/releases/assets/" + d.id, { method: "DELETE", headers: H });
  console.log((r.status === 204 ? "deleted " : "FAIL " + r.status + " ") + d.tag + "  " + d.name + "  " + d.mb.toFixed(1) + " MB");
  if (r.status === 204) freed += d.mb;
}

const after = await (await fetch(base + "/releases?per_page=100", { headers: H })).json();
let left = 0, n = 0;
for (const r of after) for (const a of r.assets || []) { left += a.size / 1048576; n++; }
console.log("---");
console.log("释放 " + freed.toFixed(1) + " MB；剩余 " + n + " 个附件 / " + left.toFixed(1) + " MB (" + (left / 1024).toFixed(2) + " GB)");