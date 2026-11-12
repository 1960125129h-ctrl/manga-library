#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
jmcomic_dl.py —— 用 jmcomic 官方 Python API 直取禁漫图片

替代老链路：Chrome 调试端口 + 过 CF + 点「免等待」+ 关广告页 + 会话级验证码 OCR
         + 表单提交 + 收 <id>.zip + tar 解压。
新链路：curl_cffi(TLS 指纹) + 禁漫 APP/网页接口 + 图片直取 + 内置乱序解码 + 章节/图片多线程。

用法:
  python _scripts\jm\jmcomic_dl.py JM1452133
  python _scripts\jm\jmcomic_dl.py 1452133 427413 "https://18comic.vip/album/123456"
  python _scripts\jm\jmcomic_dl.py 1452133 --from 1 --to 20 --photo-workers 4 --image-workers 16
  python _scripts\jm\jmcomic_dl.py 1452133 --dry          # 只看章节表，不下载

输出:
  漫画\<书名>\第NN話\*.jpg|webp ，外加一行 __JSON__{...} 结果清单（给 Node 侧收尾）。
"""
import argparse
import json
import os
import re
import socket
import sys
import threading
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

IMG_EXTS = (".webp", ".jpg", ".jpeg", ".png", ".gif")
DEFAULT_LIB = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PROXY_PORTS = (7890, 7891, 7897, 7892, 1080, 10808, 20171)


def log(msg):
    print(msg, flush=True)


def port_open(port, host="127.0.0.1", timeout=0.25):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def find_proxy():
    for p in PROXY_PORTS:
        if port_open(p):
            return "http://127.0.0.1:%d" % p
    return None


def safe_name(s, limit=120):
    s = re.sub(r'[\\/:*?"<>|]', "_", str(s or "").strip())
    s = re.sub(r"[\s.]+$", "", s)
    return (s[:limit] or "未命名")


def lev(a, b):
    """编辑距离：用来把简/繁、全/半角造成的目录名差异认成同一本。"""
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


_BOOK_CACHE = {}


def resolve_book_name(base, title):
    """库里有同名（含简繁差异）目录就沿用，避免同一本被拆成两个目录。"""
    want = safe_name(title)
    key = (base, want)
    if key in _BOOK_CACHE:
        return _BOOK_CACHE[key]
    if os.path.isdir(os.path.join(base, want)):
        _BOOK_CACHE[key] = want
        return want
    try:
        cands = [d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))]
    except Exception:
        _BOOK_CACHE[key] = want
        return want
    best, bd = None, 999
    for d in cands:
        if abs(len(d) - len(want)) > 2:
            continue
        dist = lev(d, want)
        if dist < bd:
            best, bd = d, dist
    if best and bd <= 2:
        log("[匹配] 沿用库里已有的目录: %s（新解析名: %s）" % (best, want))
        _BOOK_CACHE[key] = best
        return best
    _BOOK_CACHE[key] = want
    return want


def pick_ids(texts):
    """从任意文本里抠出 ID：JM1452133 / jm-1452133 / 纯数字 / album|photo 链接。
    注意：URL 里 18comic 的 "18" 也会被 \d+ 抓到，所以链接必须优先按 /album/<id> 取。"""
    out = []
    for t in texts:
        s = str(t)
        m = re.search(r"/(?:album|photo)/(\d+)", s, re.I)
        aid = m.group(1) if m else "".join(re.findall(r"\d+", s))
        if not aid:
            log("[跳过] 抓不到数字: %s" % s)
            continue
        if aid not in out:
            out.append(aid)
    return out


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("ids", nargs="+", help="专辑/单话 ID 或链接，可多个")
    ap.add_argument("--lib", default=DEFAULT_LIB)
    ap.add_argument("--cat", default="漫画")
    ap.add_argument("--from", dest="start", type=int, default=0)
    ap.add_argument("--to", dest="end", type=int, default=0)
    ap.add_argument("--photo-workers", type=int, default=4)
    ap.add_argument("--image-workers", type=int, default=16)
    ap.add_argument("--impl", default="api", choices=["api", "html"])
    ap.add_argument("--proxy", default="")
    ap.add_argument("--no-proxy", action="store_true")
    ap.add_argument("--suffix", default="", help="图片格式转换，如 .webp；留空=保留原格式")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--verbose", action="store_true", help="打开 jmcomic 自身日志（排查图片下载失败用）")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    from jmcomic import (
        JmOption, JmModuleConfig, JmDownloader,
        MissingAlbumPhotoException, JmcomicException,
    )

    base_dir = os.path.join(os.path.abspath(args.lib), args.cat)
    os.makedirs(base_dir, exist_ok=True)

    proxy = "" if args.no_proxy else (args.proxy or find_proxy())
    proxies = {"http": proxy, "https": proxy} if proxy else None

    # ---- 目录规则: 200 行就能对齐现有库结构 漫画\<书名>\第NN話\ ----
    JmModuleConfig.AFIELD_ADVICE["folder"] = lambda album: resolve_book_name(base_dir, album.name)
    JmModuleConfig.PFIELD_ADVICE["folder"] = lambda photo: "第%02d話" % max(1, photo.album_index or 1)

    option_dict = {
        "log": bool(args.verbose),
        "dir_rule": {"rule": "Bd/Afolder/Pfolder", "base_dir": base_dir},
        "client": {
            "impl": args.impl,
            "retry_times": 5,
            "domain": [],
            "postman": {
                "type": "curl_cffi",
                "meta_data": {
                    "impersonate": "chrome",
                    "headers": None,
                    "proxies": proxies,
                    # 代理(Clash 之类)会做 TLS 中间人，curl_cffi 的 chrome 指纹 + 代理证书链
                    # 经常对不上，报 "curl: (77) error adding CA certificates"。关掉校验绕开。
                    "verify": False,
                },
            },
        },
        "download": {
            "cache": True,
            "image": {"decode": True, "suffix": (args.suffix or None)},
            "threading": {"image": max(1, args.image_workers), "photo": max(1, args.photo_workers)},
        },
    }
    option = JmOption.construct(option_dict)
    log("[配置] 库=%s | 客户端=%s | 代理=%s | 章节并发=%d 图片并发=%d"
        % (base_dir, args.impl, proxy or "直连", args.photo_workers, args.image_workers))

    def photo_dir(album, idx):
        """自己按目录规则算话目录，不依赖 jmcomic 内部 save_path 状态。
        书名走 resolve_book_name，保证与 dir_rule 写盘的位置一致（含简繁匹配）。"""
        return os.path.join(base_dir, resolve_book_name(base_dir, album.name), "第%02d話" % max(1, int(idx or 1)))

    def count_images(d):
        if not d or not os.path.isdir(d):
            return 0
        return len([f for f in os.listdir(d) if f.lower().endswith(IMG_EXTS)])

    class RangeDownloader(JmDownloader):
        """区间过滤：在 album 层裁掉不下载的话（不在 photo 层逐个发请求）。"""

        def before_album(self, album):
            if args.start or args.end:
                keep = []
                for e in getattr(album, "episode_list", []) or []:
                    try:
                        idx = int(e[1])
                    except Exception:
                        idx = 0
                    if args.start and idx < args.start:
                        continue
                    if args.end and idx > args.end:
                        continue
                    keep.append(e)
                album.episode_list = keep
                log("  [区间] 只下 %s..%s，共 %d 话" % (args.start or 1, args.end or "末", len(keep)))

        def before_photo(self, photo):
            idx = max(1, photo.album_index or 1)
            # 进话之前先看目录里已经有几张：已有全部就明说"跳过"，
            # 别像以前那样一声不吭让 jmcomic 的 cache 静默过一遍（用户会以为卡死）
            try:
                al = getattr(photo, "from_album", None) or album_ref[0]
                have = count_images(photo_dir(al, idx))
            except Exception:
                have = 0
            try:
                total = int(getattr(photo, "page_count", 0) or 0)
            except Exception:
                total = 0
            if total and have >= total:
                log("  ==  第%02d話 已存在 %d/%d 张，跳过" % (idx, have, total))
            else:
                log("  -> 第%02d話 开始（已有 %d 张%s）" % (idx, have, ("，共 %d 页" % total) if total else ""))

        def after_photo(self, photo):
            idx = max(1, photo.album_index or 1)
            try:
                al = getattr(photo, "from_album", None) or album_ref[0]
                n = count_images(photo_dir(al, idx))
            except Exception:
                n = -1
            log("  <- 第%02d話 完成 %s 张" % (idx, n if n >= 0 else "?"))

    album_ref = [None]   # 供 after_photo 取书名（单话下载时 photo.from_album 可能为空）
    result = {"lib": os.path.abspath(args.lib), "cat": args.cat, "proxy": proxy or "", "albums": [], "failed": {}}

    for aid in pick_ids(args.ids):
        log("")
        log("[专辑] JM%s" % aid)
        # 解析心跳：解析一本要 60~130 秒，期间原来一个字都不打，界面上跟死了一样
        _hb_stop = threading.Event()
        def _heartbeat(_t0=time.time()):
            while not _hb_stop.wait(15):
                log("    …解析中（已 %.0f 秒）" % (time.time() - _t0))
        _hb = threading.Thread(target=_heartbeat, daemon=True)
        _hb.start()
        try:
            # 解析重试：代理抖动时 /setting 一次失败就整本报废太脆，多试两次
            client = None
            for _try in range(3):
                try:
                    client = option.new_jm_client()
                    break
                except Exception as _e0:
                    if _try < 2:
                        log("  [解析重试 %d/3] %s" % (_try + 1, str(_e0)[:100]))
                        time.sleep(1.2)
            if client is None:
                client = option.new_jm_client()
            if args.dry:
                album = client.get_album_detail(aid)
                log("  书名: %s" % album.name)
                log("  作者: %s" % (", ".join(album.authors) if album.authors else "未标注"))
                log("  页数: %s | 章节: %d" % (getattr(album, "page_count", "?"), len(album)))
                for p in album:
                    log("    第%02d話  %s" % (max(1, p.album_index or 1), p.title))
                result["albums"].append({
                    "id": aid, "title": album.name,
                    "author": " / ".join(album.authors) if album.authors else "",
                    "chapters": [{"index": max(1, p.album_index or 1), "title": p.title, "id": p.photo_id} for p in album],
                    "dry": True,
                })
                continue

            album = None
            last_err = None
            for attempt in range(1, 4):
                try:
                    album_ref[0] = None
                    downloader = RangeDownloader(option)
                    album = downloader.download_album(aid)
                    album_ref[0] = album
                    last_err = None
                    _hb_stop.set()
                    break
                except JmcomicException as e:
                    last_err = e
                    log("  [重试 %d/3] %s" % (attempt, str(e)[:120].replace("\n", " ")))
                    time.sleep(2 * attempt)
            _hb_stop.set()   # 不管成没成，都停掉解析心跳
            if album is None:
                raise last_err if last_err else RuntimeError("下载失败")
            if downloader.download_failed_photo:
                log("  [警告] 失败的话: %s" % downloader.download_failed_photo)
            chapters = []
            for p in album:
                idx = max(1, p.album_index or 1)
                d = photo_dir(album, idx)
                chapters.append({
                    "index": idx,
                    "title": p.title or "",
                    "id": p.photo_id,
                    "dir": d,
                    "images": count_images(d),
                })
            book_dir = os.path.join(base_dir, resolve_book_name(base_dir, album.name))
            result["albums"].append({
                "id": aid,
                "title": album.name,
                "dir": book_dir,
                "author": " / ".join(album.authors) if album.authors else "",
                "tags": list(getattr(album, "tags", []) or []),
                "page_count": getattr(album, "page_count", 0),
                "chapters": chapters,
            })
            log("[完成] %s -> %s (%d 话, %d 话有图)"
                % (album.name, book_dir, len(chapters), sum(1 for c in chapters if c["images"] > 0)))
        except MissingAlbumPhotoException as e:
            log("[失败] JM%s 不存在: %s" % (aid, e))
            result["failed"][aid] = "missing"
        except JmcomicException as e:
            log("[失败] JM%s: %s" % (aid, str(e)[:200]))
            result["failed"][aid] = str(e)[:200]
        except Exception as e:
            log("[失败] JM%s 未预期异常: %r" % (aid, e))
            result["failed"][aid] = repr(e)[:200]

    line = "__JSON__" + json.dumps(result, ensure_ascii=False)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(json.dumps(result, ensure_ascii=False, indent=2))
    log(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
