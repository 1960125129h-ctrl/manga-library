import os, sys, hashlib
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

LIB = sys.argv[1]
W = int(sys.argv[2]) if len(sys.argv) > 2 else 200
IMGS = ('.webp', '.jpg', '.jpeg', '.png', '.gif')
outdir = os.path.join(LIB, '_thumbs')
os.makedirs(outdir, exist_ok=True)

def natkey(s):
    import re
    return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', s)]

books = []
for base in (os.path.join(LIB, '漫画'), LIB):
    if not os.path.isdir(base):
        continue
    for name in sorted(os.listdir(base)):
        p = os.path.join(base, name)
        if not os.path.isdir(p) or name.startswith('_') or name.startswith('.'):
            continue
        if base == LIB and name == '漫画':
            continue
        rel = ('漫画/' + name) if base != LIB else name
        books.append((rel, p))
books = list({rel: p for rel, p in books}.items())

new = cached = miss = 0
for rel, path in books:
    chs = sorted([d for d in os.listdir(path) if os.path.isdir(os.path.join(path, d))], key=natkey)
    src = None
    for ch in chs:
        files = sorted([f for f in os.listdir(os.path.join(path, ch)) if f.lower().endswith(IMGS)], key=natkey)
        if files:
            src = os.path.join(path, ch, files[0])
            break
    if not src:
        miss += 1
        continue
    h = hashlib.sha1(rel.encode('utf-8')).hexdigest()[:16]
    dst = os.path.join(outdir, h + '-w' + str(W) + '.webp')
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        cached += 1
        continue
    try:
        with Image.open(src) as im:
            im = im.convert('RGB')
            w, hh = im.size
            nw = min(W, w)
            nh = max(1, int(hh * nw / w))
            if nh > W * 2:
                nh = W * 2
            im = im.resize((nw, nh), Image.LANCZOS)
            im.save(dst, 'WEBP', quality=82, method=5)
        new += 1
    except Exception as e:
        miss += 1
print(f'thumbs: 新生成 {new}, 命中缓存 {cached}, 跳过 {miss}')
