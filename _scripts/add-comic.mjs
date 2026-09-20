#!/usr/bin/env node
/**
 * 新建漫画(通用): 解析地址 -> 下载 -> 写简介/作者/来源 -> 重建书库
 * 支持的站点由 _scripts\sites\index.mjs 决定(再漫画 zaimanhua / xmanhua 等), 与 App 里「下载漫画 → 通用链接」同一条链路。
 * 用法: node add-comic.mjs --url "https://manhua.zaimanhua.com/details/65391" [--name "书名"] [--lib "..."] [--from 1] [--to 5] [--dry]
 * 备注: 目标书库固定为仓库根目录(脚本自身位置推导), --lib 仅用于打印目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);

const RAW_URL = String(arg('url') || '').trim();
const LIB = arg('lib') || path.resolve(HERE, '..');
if (!RAW_URL) { console.error('缺少 --url'); process.exit(1); }

const BOOK = path.join(HERE, 'sites', 'fetch-book.mjs');
if (!fs.existsSync(BOOK)) { console.error('找不到通用抓书脚本: ' + BOOK); process.exit(1); }

// 1) 解析: 交给适配器(它自己会把代理环境准备好, 必须独立进程)
const probe = spawnSync(process.execPath, [BOOK, '--probe', '--url', RAW_URL], { encoding: 'utf8' });
const out = String(probe.stdout || '') + String(probe.stderr || '');
const line = out.split('\n').filter((l) => l.indexOf('@@RESULT@@') >= 0).pop();
if (!line) {
  console.error('  解析失败: ' + (out.trim().split('\n').slice(-3).join(' / ') || '没有输出'));
  console.error('  提示: 地址要填「漫画目录页」(' + RAW_URL + ')');
  process.exit(1);
}
let meta = {};
try { meta = JSON.parse(line.replace('@@RESULT@@', '').trim()); } catch (e) { console.error('  解析结果解析不了: ' + line); process.exit(1); }
if (!meta.ok) { console.error('  解析失败: ' + (meta.msg || '该站点暂不支持')); process.exit(1); }

const name = String(arg('name') || meta.title || '').trim();
if (!name) { console.error('  没识别出书名, 用 --name 指定一个'); process.exit(1); }
console.log('  站点   : ' + meta.site);
console.log('  书名   : ' + name + (meta.author ? '   (作者 ' + meta.author + ')' : ''));
console.log('  话数   : ' + meta.chapters + (arg('from') || arg('to') ? '  (本次范围 ' + (arg('from') || '1') + '~' + (arg('to') || '全部') + ')' : ''));
console.log('  目录   : ' + path.join(LIB, '漫画', name));
if (meta.desc) console.log('  简介   : ' + String(meta.desc).replace(/\s+/g, ' ').slice(0, 60) + (meta.desc.length > 60 ? '…' : ''));
if (fs.existsSync(path.join(LIB, '漫画', name))) console.log('  提示   : 目录已存在, 已下过的话会自动跳过(可断点续传)');
if (has('dry')) { console.log('\n  (--dry 预览模式, 未开始下载)'); process.exit(0); }

// 2) 下载: 整段交给适配器 CLI(带代理 + 跳过已入库 + 写 library.json + 自己重建书库)
console.log('\n  ---- 开始下载 ----\n');
const args = [BOOK, '--url', RAW_URL, '--dir', name];
if (arg('from')) args.push('--from', String(arg('from')));
if (arg('to')) args.push('--to', String(arg('to')));
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: LIB });
if (r.status !== 0) { console.error('\n  下载失败 (退出码 ' + r.status + ')'); process.exit(r.status || 1); }
console.log('\n  完成! 书库已自动重建.');
