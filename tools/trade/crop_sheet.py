# 참고 시트(밝은 단색 배경)에서 그림을 하나씩 잘라 투명 PNG로 저장
# python3 crop_sheet.py 시트.png 출력폴더 이름1,이름2,... [가로폭] [임계값]
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
width = int(sys.argv[4]) if len(sys.argv) > 4 else 128
thr = float(sys.argv[5]) if len(sys.argv) > 5 else 30
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
h, w, _ = im.shape
border = np.concatenate([im[:6].reshape(-1, 3), im[-6:].reshape(-1, 3), im[:, :6].reshape(-1, 3), im[:, -6:].reshape(-1, 3)])
bg = np.median(border, axis=0)
d = np.sqrt(((im - bg) ** 2).sum(axis=2))
mask = d > thr
mask = ndi.binary_closing(mask, iterations=3)
mask = ndi.binary_fill_holes(mask)
mask = ndi.binary_opening(mask, iterations=2)
lab, n = ndi.label(mask)
objs = []
for i, sl in enumerate(ndi.find_objects(lab), 1):
    area = (lab[sl] == i).sum()
    if area < 3000: continue
    objs.append((sl, i))
# 행 → 열 순서
objs.sort(key=lambda o: (round(((o[0][0].start + o[0][0].stop) / 2) / (h / 6)), o[0][1].start))
rows = {}
for sl, i in objs:
    rows.setdefault(round(((sl[0].start + sl[0].stop) / 2) / (h / 4)), []).append((sl, i))
ordered = [o for k in sorted(rows) for o in sorted(rows[k], key=lambda o: o[0][1].start)]
print('found', len(ordered), 'objects; names', len(names))
os.makedirs(out, exist_ok=True)
for (sl, i), name in zip(ordered, names):
    if not name: continue
    m = (lab[sl] == i)
    m = ndi.binary_erosion(m, iterations=1)
    rgb = im[sl].astype(np.uint8)
    a = (m * 255).astype(np.uint8)
    # 가장자리 배경색 번짐 줄이기: 배경과 가까운 테두리 픽셀은 반투명
    edge = m & ~ndi.binary_erosion(m, iterations=2)
    a[edge & (d[sl] < thr * 2.2)] = 110
    img = Image.fromarray(np.dstack([rgb, a]), 'RGBA')
    nh = round(img.height * width / img.width)
    img = img.resize((width, nh), Image.LANCZOS)
    img.save(os.path.join(out, name + '.png'))
    print(name, img.size)
