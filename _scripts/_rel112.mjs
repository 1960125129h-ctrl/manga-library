
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const raw = execSync('git credential fill', { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
const tok = (raw.match(/password=(.+)/) || [])[1];
const H = { Authorization: "token " + tok, "User-Agent": "shuku", Accept: "application/vnd.github+json" };
const repo = "1960125129h-ctrl/manga-library";
const body = fs.readFileSync("_dist/RELEASE-1.1.2.md", "utf8");
const r = await fetch("https://api.github.com/repos/" + repo + "/releases", {
  method: "POST",
  headers: { ...H, "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ tag_name: "v1.1.2", name: "书库 v1.1.2", body, draft: false, prerelease: false })
});
const j = await r.json();
if (!r.ok) { console.log("FAIL", r.status, JSON.stringify(j).slice(0, 250)); process.exit(1); }
console.log("RELEASE_ID=" + j.id);
console.log("URL=" + j.html_url);
fs.writeFileSync("_dist/.rid112", String(j.id));
const files = fs.readdirSync("_dist").filter(f => /1\.1\.2.*\.exe$/i.test(f));
for (const f of files) {
  const name = f.includes("setup") ? "shuku-1.1.2-setup.exe" : "shuku-1.1.2-portable.exe";
  const buf = fs.readFileSync(path.join("_dist", f));
  const res = await fetch("https://uploads.github.com/repos/" + repo + "/releases/" + j.id + "/assets?name=" + encodeURIComponent(name), {
    method: "POST", headers: { ...H, "Content-Type": "application/octet-stream" }, body: buf
  });
  const aj = await res.json();
  console.log(res.ok ? ("UPLOADED " + aj.name + " " + Math.round(aj.size/1024/1024) + "MB") : ("FAIL " + res.status + " " + JSON.stringify(aj).slice(0,150)));
}
