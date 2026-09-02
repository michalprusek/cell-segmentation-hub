"""Three non-overlapping fields out of the 6657-px neurite sample frame.

Deterministic: windows are ranked by standard deviation, because neurites are
texture and bare coverslip is flat, then taken greedily with a no-overlap rule.
Re-running picks the same three.
"""
import os

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

SRC = '/repo/neurite-soma-seg/sample/r5_ctrl_0001.png'
OUT = '/work/infer'
SIDE = 1400

frame = Image.open(SRC)
a = np.asarray(frame).astype(np.float32)
h, w = a.shape[:2]

windows = []
for y in range(0, h - SIDE, SIDE // 2):
    for x in range(0, w - SIDE, SIDE // 2):
        windows.append((float(a[y:y + SIDE, x:x + SIDE].std()), x, y))
windows.sort(reverse=True)

os.makedirs(OUT, exist_ok=True)
taken = []
for score, x, y in windows:
    if any(abs(x - px) < SIDE and abs(y - py) < SIDE for px, py in taken):
        continue
    frame.crop((x, y, x + SIDE, y + SIDE)).save(
        os.path.join(OUT, 'neurite_%d.png' % len(taken)))
    print('neurite_%d.png from (%d,%d), std=%.1f' % (len(taken), x, y, score))
    taken.append((x, y))
    if len(taken) == 3:
        break
