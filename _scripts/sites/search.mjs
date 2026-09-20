// 跨站搜索: node _scripts\sites\search.mjs --keyword "琉璃龙龙" [--sites zaimanhua,komiic] [--lib "D:\\gong zuo qu\\漫画书库"]
// 输出 @@RESULT@@{...}: 按"同一个作品"聚合, 每组列出各站结果; 顺带标记是否已在库中
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTables, matchWT, loadAliasCache } from '../tags.mjs';
import { ADAPTERS } from './index.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : (d || ''); };
const KEY = String(arg('keyword')).trim();
const LIB = arg('lib') ? path.resolve(arg('lib')) : path.resolve(HERE, '..', '..');
const only = String(arg('sites')).split(/[,，\s]+/).filter(Boolean);
if (!KEY) { console.log('用法: node search.mjs --keyword "关键词" [--sites zaimanhua,komiic]'); process.exit(1); }

const T2S = { '龍': '龙', '龍': '龙', '樂': '乐', '國': '国', '學': '学', '會': '会', '體': '体', '實': '实', '員': '员', '話': '话', '書': '书', '網': '网', '電': '电', '視': '视', '覺': '觉', '點': '点', '裝': '装', '樣': '样', '關': '关', '無': '无', '與': '与', '為': '为', '東': '东', '銀': '银', '魂': '魂', '傳': '传', '戰': '战', '記': '记', '頭': '头', '條': '条', '經': '经', '過': '过', '開': '开', '閉': '闭', '間': '间', '陽': '阳', '陰': '阴', '風': '风', '雲': '云', '飛': '飞', '馬': '马', '鳥': '鸟', '魚': '鱼', '黑': '黑', '紅': '红', '綠': '绿', '藍': '蓝', '黃': '黄', '髮': '发', '女': '女', '男': '男' };
function s2s(t) { let o = ''; for (const c of String(t || '')) o += (T2S[c] || c); return o; }
function norm(t) {
  return s2s(String(t || '').toLowerCase())
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/[\s\-_·・:：!！?？'"“”‘’,，.。/、|+]+/g, '')
    .replace(/第\d+[话話卷]/g, '');
}
function grams(t) { const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
function sim(a, b) {
  const A = grams(norm(a)), B = grams(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}
const tables = loadTables(LIB);
const alias = loadAliasCache(path.resolve(HERE, '..'));
// 别名扩展: 关键词能对上表里的作品/角色时, 把它的别名一起搜(中/日/英文都能命中)
function expand(kw) {
  const out = [kw];
  const hit = matchWT(kw, tables, alias);
  const names = [];
  for (const w of tables.作品) if (w.名 === hit.work) { names.push(w.名); (w.别名 || []).forEach((x) => names.push(x)); (alias[w.名] || []).forEach((x) => names.push(x)); }
  for (const c of tables.角色) if (c.名 === hit.char) { names.push(c.名); (c.别名 || []).forEach((x) => names.push(x)); }
  for (const n of names) if (n && out.indexOf(n) < 0 && n.length >= 2) out.push(n);
  return out.slice(0, 4);
}
const KEYS = expand(KEY);

const sites = ADAPTERS.filter((a) => typeof a.search === 'function' && (!only.length || only.indexOf(a.id) >= 0));
const errors = [], items = [];
await Promise.all(sites.map(async (a) => {
  for (const kw of KEYS) {
    try {
      const r = await Promise.race([
        a.search(kw, 1),
        new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 8000)),
      ]);
      for (const it of (r || [])) {
        const t = String(it.title || '');
        const rel = Math.max(sim(KEY, t), s2s(norm(t)).indexOf(s2s(norm(KEY))) >= 0 ? 0.9 : 0);
        if (rel >= 0.2 || t.indexOf(KEY) >= 0) items.push(Object.assign({ site: a.id, label: a.label, kw: kw, rel: Math.round(rel * 100) / 100 }, it));   // 站点的搜索很糊, 本地按相关度筛一道
      }
      if (r && r.length) break;   // 这个关键词有结果就不用再试别名
    } catch (e) { errors.push(a.label + '(「' + kw + '」): ' + String(e.message).slice(0, 60)); }
  }
}));

// 已在库中?
const libNames = [];
try { const j = JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')); for (const k of Object.keys(j.comics || {})) libNames.push(k.replace(/^漫画\//, '')); } catch (e) {}
function inLib(title) {
  const a = norm(title);
  if (!a) return false;
  for (const n of libNames) {
    const b = norm(n);
    if (!b) continue;
    if (b === a) return true;
    if (a.length >= 6 && b.indexOf(a) >= 0) return true;
    if (b.length >= 6 && a.indexOf(b) >= 0) return true;
    if (sim(name0(n), name0(title)) >= 0.8) return true;   // 繁简/顺序差异兜底
  }
  return false;
}
function name0(x) { return s2s(String(x || '')); }

// 聚合: 先按规范作品名, 再按标题相似度
const groups = [];
for (const it of items) {
  const wk = matchWT(it.title, tables, alias).work || '';
  let g = null;
  for (const gg of groups) {
    if (wk && gg.work && gg.work === wk) { g = gg; break; }
    if (wk && gg.work === wk) { g = gg; break; }
    if (!wk && !gg.work && sim(gg.items[0].title, it.title) >= 0.6) { g = gg; break; }
  }
  if (!g) { g = { work: wk, items: [] }; groups.push(g); }
  if (!g.work && wk) g.work = wk;
  it.inLib = inLib(it.title);
  if (!g.items.some((x) => x.url === it.url)) g.items.push(it);
}
groups.sort((a, b) => (b.items.length - a.items.length) || String(a.items[0].title).localeCompare(String(b.items[0].title), 'zh'));
const out = {
  ok: true, keyword: KEY, used: KEYS, sites: sites.map((a) => a.id), labels: sites.map((a) => a.label),
  total: items.length, groups: groups.slice(0, 40), errors: errors.slice(0, 6),
};
for (const g of out.groups) g.name = g.work || g.items[0].title;
console.log('搜「' + KEY + '」(实际用: ' + KEYS.join(' / ') + ') → ' + items.length + ' 条, 归成 ' + groups.length + ' 组');
if (errors.length) console.log('  有站点报错: ' + errors.join(' ; '));
console.log('@@RESULT@@' + JSON.stringify(out));
