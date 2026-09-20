import sys, re, json, collections
import cv2, numpy as np
import easyocr

reader = easyocr.Reader(['ch_sim'], gpu=False, verbose=False, download_enabled=False)
ALLOW = '0123456789+-x*×÷='

def variants(data):
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if arr is None or arr.size == 0:
        return []
    out = [('raw', data)]
    for fx in (3, 4):
        big = cv2.resize(arr, None, fx=fx, fy=fx, interpolation=cv2.INTER_CUBIC)
        _, th = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        ok, enc = cv2.imencode('.png', th)
        if ok:
            out.append((f'otsu{fx}', enc.tobytes()))
        blur = cv2.GaussianBlur(big, (3, 3), 0)
        _, th2 = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        ok, enc2 = cv2.imencode('.png', th2)
        if ok:
            out.append((f'otsu{fx}b', enc2.tobytes()))
    return out

def parse(text):
    s = text.replace('\u00d7', '*').replace('x', '*').replace('X', '*').replace('\u00f7', '/')
    s = s.replace('=', '').replace('?', '').replace(' ', '')
    s = re.sub(r'[^0-9+\-*/]', '', s)
    m = re.search(r'(\d{1,3})\s*([+\-*/])\s*(\d{1,3})', s)
    if not m:
        return None
    a, op, b = int(m.group(1)), m.group(2), int(m.group(3))
    if op == '+': return a + b
    if op == '-': return a - b
    if op == '*': return a * b
    if op == '/' and b: return a // b
    return None

def solve(data):
    scores = collections.defaultdict(float)
    detail = []
    seen = []
    for tag, img in variants(data):
        try:
            res = reader.readtext(img, allowlist=ALLOW, detail=1, paragraph=False)
        except Exception as e:
            detail.append([tag, 'ERR', 0, None])
            continue
        items = sorted([(float(b[0][1]), float(b[0][0]), t, float(c)) for b, t, c in res])
        text = ''.join(i[2] for i in items)
        conf = sum(i[3] for i in items) / len(items) if items else 0.0
        ans = parse(text)
        detail.append([tag, text, round(conf, 2), ans])
        if ans is not None and 0 <= ans <= 999:
            scores[ans] += 1 + conf
            seen.append(ans)
            # 提前收敛: 有两个变体给出同一答案就直接返回, 省掉剩下变体
            if seen.count(ans) >= 3:   # 3 个变体一致才敢收工, 2 个容易一起错
                ranked = [a for a, _ in sorted(scores.items(), key=lambda kv: -kv[1])]
                return ranked, detail
    ranked = [a for a, _ in sorted(scores.items(), key=lambda kv: -kv[1])]
    return ranked, detail

print('READY', flush=True)
for line in sys.stdin:
    path = line.strip()
    if not path:
        continue
    try:
        with open(path, 'rb') as f:
            data = f.read()
        ranked, detail = solve(data)
        print('RESULT ' + json.dumps({'cands': ranked[:4], 'detail': detail}, ensure_ascii=False), flush=True)
    except Exception as e:
        print('RESULT ' + json.dumps({'cands': [], 'detail': [['EXC', str(e)[:120], 0, None]]}, ensure_ascii=False), flush=True)
