import os, sys, shutil, statistics
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

d = sys.argv[1]
dry = '--dry' in sys.argv
fs = sorted(f for f in os.listdir(d) if f.lower().endswith(('.webp', '.jpg', '.jpeg', '.png')))
if not fs:
    print('无图片'); sys.exit(1)

sizes = []
for f in fs:
    with Image.open(os.path.join(d, f)) as im:
        sizes.append((f, im.size, im.format))

chunk = max(h for _, (w, h), _ in sizes)
# 分页: 同宽且前一张高度达到上限 -> 属于同一页(被站点按高度切块)
groups, i = [], 0
while i < len(sizes):
    g = [sizes[i]]
    # 继续拼接的条件: 组内最后一块仍是满高(说明这页还没完)
    # 只拼「满高块 + 短尾巴」且同宽: 站点把超过 chunk 的页切开, 尾巴一定明显短
    while (i + 1 < len(sizes) and sizes[i + 1][1][0] == g[0][1][0]
           and g[-1][1][1] == chunk and sizes[i + 1][1][1] < chunk * 0.5):
        i += 1
        g.append(sizes[i])
    groups.append(g)
    i += 1

merged = sum(1 for g in groups if len(g) > 1)
print(f'文件 {len(fs)} 张 -> 页面 {len(groups)} 页 (合并 {merged} 处, 切割高度上限 {chunk}px)')
heights = []
for idx, g in enumerate(groups, 1):
    w = g[0][1][0]
    h = sum(x[1][1] for x in g)
    heights.append(h)
med = statistics.median(heights)
odd = [(i + 1, heights[i]) for i in range(len(heights)) if heights[i] < med * 0.5 or heights[i] > med * 2.2]
print('页高 min/中位/max = ' + f'{min(heights)}/{int(med)}/{max(heights)}')
print('异常页(偏离中位过多) = ' + (str(odd) if odd else '无'))
if dry:
    sys.exit(0)

tmp = d + '.__stitch'
shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
pad = max(3, len(str(len(groups))))
for idx, g in enumerate(groups, 1):
    out = os.path.join(tmp, str(idx).zfill(pad) + '.webp')
    if len(g) == 1:
        shutil.copy2(os.path.join(d, g[0][0]), out)
    else:
        w = g[0][1][0]; h = sum(x[1][1] for x in g)
        canvas = Image.new('RGB', (w, h), 'white')
        y = 0
        for f, (gw, gh), _ in g:
            with Image.open(os.path.join(d, f)) as im:
                canvas.paste(im.convert('RGB'), (0, y)); y += gh
        canvas.save(out, 'WEBP', quality=95, method=6)
for f in fs:
    os.remove(os.path.join(d, f))
for f in sorted(os.listdir(tmp)):
    shutil.move(os.path.join(tmp, f), os.path.join(d, f))
os.rmdir(tmp)
tot = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
print(f'完成: {len(groups)} 页, 共 {tot/1048576:.1f}MB')
