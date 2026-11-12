#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
jm-img.py —— 禁漫图片直取（完全不依赖 Cloudflare / 浏览器 / 验证码 / zip 包）

原理（已实测）：
  图片 CDN（cdn-msp*.jmapinodeudzn.net）**不挂 Cloudflare 挑战**，直接 GET 就 200；
  文件名是 5 位定宽序号 + 原扩展名，URL 形如
      https://cdn-msp.jmapinodeudzn.net/media/photos/<photo_id>/00001.webp
  所以只要知道 photo_id，就能把整话图片并发拉下来 —— 不需要点「免等待」、不需要识别验证码、
  不需要等网页把 zip 打包，也不需要浏览器保持打开。

用法：
  python _scripts\jm\jm-img.py 1452133 1452134 1452135 --book "尼古喵喵"
  python _scripts\jm\jm-img.py 1452133 --book "书名" --start 7 --workers 16
  python _scripts\jm\jm-img.py 1452133 --lib "D:\gong zuo qu\漫画书库" --book "x" --stitch

输出：<lib>\漫画\<book>\第NN話\00001.webp …；末尾一行 __JSON__{...}
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

IMG_EXTS = (".webp", ".jpg", ".jpeg", ".png", ".gif")
DEFAULT_LIB = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DOMAINS = [
    "cdn-msp.jmapinodeudzn.net",
    "cdn-msp3.jmapinodeudzn.net",
    "cdn-msp.jmapiproxy1.cc",
    "cdn-msp2.jmapiproxy2.cc",
    "cdn-msp.jmapiproxy2.cc",
    "cdn-msp3.jmapiproxy2.cc",
]


_CLIENT = None


def log(m):
    print(m, flush=True)


def jm_client():
    """只在需要 scramble_id 时初始化一次（会打一次 /chapter_view_template）。"""
    global _CLIENT
    if _CLIENT is None:
        from jmcomic import JmOption
        _CLIENT = JmOption.default().new_jm_client()
    return _CLIENT


def get_scramble_id(pid):
    """禁漫每张图按 scramble_id 做行分段重排；拿不到就别下，下了也是乱序。"""
    try:
        return jm_client().get_scramble_id(str(pid))
    except Exception as e:
        log("  [scramble] 取不到解码参数: %s" % str(e)[:120])
        return None


def safe_name(s, limit=120):
    s = re.sub(r'[\\/:*?"<>|]', "_", str(s or "").strip())
    s = re.sub(r"[\s.]+$", "", s)
    return (s[:limit] or "未命名")


def lev(a, b):
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if not la:
        return lb
    if not lb:
        return la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def resolve_book_name(base, title):
    want = safe_name(title)
    if os.path.isdir(os.path.join(base, want)):
        return want
    try:
        cands = [d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))]
    except Exception:
        return want
    best, bd = None, 999
    for d in cands:
        if abs(len(d) - len(want)) > 2:
            continue
        dist = lev(d, want)
        if dist < bd:
            best, bd = d, dist
    if best and bd <= 2:
        log("[匹配] 沿用库里已有的目录: %s" % best)
        return best
    return want


def pick_ids(texts):
    """URL 要优先按 /album|photo/<id> 取，否则 18comic 里的 "18" 会被拼进 ID。"""
    out = []
    for t in texts:
        s = str(t)
        m = re.search(r"/(?:album|photo)/(\d+)", s, re.I)
        aid = m.group(1) if m else "".join(re.findall(r"\d+", s))
        if aid and aid not in out:
            out.append(aid)
    return out


def main(session_factory):
    ap = argparse.ArgumentParser()
    ap.add_argument("photos", nargs="+", help="photo_id 或 /photo/<id> 链接，按顺序当作第 1,2,3… 話")
    ap.add_argument("--book", required=True, help="书名（决定落盘目录）")
    ap.add_argument("--lib", default=DEFAULT_LIB)
    ap.add_argument("--cat", default="漫画")
    ap.add_argument("--start", type=int, default=1, help="第一话的序号，默认 1")
    ap.add_argument("--workers", type=int, default=12, help="图片并发数")
    ap.add_argument("--max-pages", type=int, default=160, help="单话最多试到第几张")
    ap.add_argument("--stitch", action="store_true", help="下完调用 stitch-pages.py 拼合/校验")
    ap.add_argument("--force", action="store_true", help="忽略已存在的图片，全部重下")
    ap.add_argument("--no-match", action="store_true", help="不按简繁近似匹配已有目录，严格用 --book 当目录名")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    book = safe_name(args.book)
    if not args.no_match:
        book = resolve_book_name(os.path.join(os.path.abspath(args.lib), args.cat), book)
    book_dir = os.path.join(os.path.abspath(args.lib), args.cat, book)
    ids = pick_ids(args.photos)
    log("[目标] %d 话 -> %s" % (len(ids), book_dir))
    log("[并发] %d | 图片域名池: %s" % (args.workers, ", ".join(DOMAINS[:3])))

    sess = session_factory()
    state = {"dom": DOMAINS[0]}

    def url_for(dom, pid, n, ext):
        return "https://%s/media/photos/%s/%05d%s" % (dom, pid, n, ext)

    # 502/503 是禁漫 CDN 表示"这张不存在"的方式（实测：页数越界返回 502），不要拿去轮换域名重试
    ABSENT = (404, 410, 502, 503)

    def fetch(pid, n, ext=".webp"):
        """返回 (url, bytes) 或 None。只有连接级故障才换域名。"""
        doms = [state["dom"]] + [d for d in DOMAINS if d != state["dom"]]
        for dom in doms:
            u = url_for(dom, pid, n, ext)
            try:
                r = sess.get(u, timeout=20, headers={"Referer": "https://18comic.vip/"})
                if r.status_code == 200 and len(r.content) > 800:
                    state["dom"] = dom
                    return u, r.content
                if r.status_code in ABSENT:
                    return None
            except Exception:
                pass
        return None

    result = {"lib": os.path.abspath(args.lib), "cat": args.cat, "book": book, "chapters": []}
    from jmcomic import JmImageTool   # 解码靠它，别自己实现乱序还原

    for k, pid in enumerate(ids):
        idx = args.start + k
        ch_dir = os.path.join(book_dir, "第%02d話" % idx)
        os.makedirs(ch_dir, exist_ok=True)
        t0 = time.time()

        # 解码参数：拿不到就整话跳过，绝不下乱序图
        scramble_id = get_scramble_id(pid)
        if scramble_id is None:
            log("  第%02d話 [跳过] %s 取不到 scramble_id，不下乱序图" % (idx, pid))
            result["chapters"].append({"index": idx, "id": pid, "dir": ch_dir, "images": 0, "error": "no_scramble_id"})
            continue
        mark_file = os.path.join(ch_dir, ".jm-decoded")
        if not args.force and os.path.exists(mark_file):
            try:
                mk = json.loads(open(mark_file, encoding="utf-8").read())
                if str(mk.get("scramble")) == str(scramble_id) and mk.get("images"):
                    log("  第%02d話 已解码 %d 张，跳过（要重下加 --force）" % (idx, mk["images"]))
                    result["chapters"].append({"index": idx, "id": pid, "dir": ch_dir, "images": mk["images"], "cached": True})
                    continue
            except Exception:
                pass

        # 探测扩展名（第一张能下就定下来）
        ext = ".webp"
        first = None
        for e in IMG_EXTS:
            got = fetch(pid, 1, e)
            if got:
                ext, first = e, got
                break
        if not first:
            log("  第%02d話 [空] photo_id=%s 取不到第一张" % (idx, pid))
            result["chapters"].append({"index": idx, "id": pid, "dir": ch_dir, "images": 0})
            continue

        # 断点续传：目录里已有连续编号的图，就从下一张接着探测
        if args.force and os.path.isdir(ch_dir):
            for f in os.listdir(ch_dir):
                if f.lower().endswith(IMG_EXTS) or f == ".jm-decoded":
                    try:
                        os.remove(os.path.join(ch_dir, f))
                    except Exception:
                        pass
        existing = sorted(f for f in os.listdir(ch_dir) if f.lower().endswith(IMG_EXTS)) if os.path.isdir(ch_dir) else []
        if existing and not args.force:
            nums_ex = [int(f[:5]) for f in existing if f[:5].isdigit()]
            if nums_ex and len(nums_ex) == max(nums_ex):
                ext = os.path.splitext(existing[0])[1].lower()
                n = max(nums_ex) + 1
                saved = len(nums_ex)
                log("  第%02d話 已有 %d 张，从第 %d 张续下" % (idx, saved, n))
            else:
                n, saved = 1, 0
        else:
            n, saved = 1, 0
        miss_streak = 0
        batch = 20
        while n <= args.max_pages and miss_streak < 3:
            nums = list(range(n, min(n + batch, args.max_pages + 1)))
            with ThreadPoolExecutor(max_workers=args.workers) as ex:
                got = list(ex.map(lambda x: (x, first[1] if x == 1 else None) if x == 1 else (x, fetch(pid, x, ext)), nums))
            for num, item in got:
                if num == 1:
                    item = first
                if item:
                    u, data = item
                    dst = os.path.join(ch_dir, "%05d%s" % (num, ext))
                    try:
                        # 禁漫的图是行分段打乱的，必须按 scramble_id 还原后再存
                        seg = JmImageTool.get_num_by_url(scramble_id, u)
                        JmImageTool.decode_and_save(seg, JmImageTool.open_image(data), dst)
                    except Exception as ex:
                        log("    [解码失败] %s: %s" % (os.path.basename(dst), str(ex)[:90]))
                        with open(dst, "wb") as f:
                            f.write(data)
                    saved += 1
                    miss_streak = 0
                else:
                    miss_streak += 1
                    if miss_streak >= 3:
                        break
            n += len(nums)
            batch = 16

        try:
            with open(mark_file, "w", encoding="utf-8") as f:
                json.dump({"scramble": str(scramble_id), "images": saved, "at": int(time.time())}, f)
        except Exception:
            pass
        secs = time.time() - t0
        size = sum(os.path.getsize(os.path.join(ch_dir, f)) for f in os.listdir(ch_dir) if f.lower().endswith(IMG_EXTS)) / 1048576 if saved else 0
        log("  第%02d話 %s 共 %d 张 %.1fMB %.1fs" % (idx, pid, saved, size, secs))
        result["chapters"].append({"index": idx, "id": pid, "dir": ch_dir, "images": saved, "secs": round(secs, 1)})

    if args.stitch:
        import subprocess
        sp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stitch-pages.py")
        for c in result["chapters"]:
            if c["images"] > 0:
                r = subprocess.run([sys.executable, sp, c["dir"]], capture_output=True, text=True, encoding="utf-8")
                log("  [拼合] 第%02d話 %s" % (c["index"], (r.stdout or "").strip().splitlines()[-1:]))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    log("__JSON__" + json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    def _factory():
        from curl_cffi import requests as cr
        return cr.Session(impersonate="chrome")

    sys.exit(main(_factory))
