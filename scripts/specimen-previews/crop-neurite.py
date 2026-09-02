"""Three non-overlapping fields out of the 6657-px neurite sample frame.

PREREQUISITE: `neurite-soma-seg/` is gitignored, so a fresh clone does not have
`SRC` and this step cannot run until that model checkout is restored. It is the
only source of neurite frames on this deployment — there is no neurite project
in the database at all.

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

# A partial set would be cached as complete by `infer-missing.sh`'s
# `ls .../neurite_*.png` guard and then fail one step later naming the wrong
# cause ("missing frame").
if len(taken) != 3:
    raise SystemExit(
        'only %d non-overlapping %d-px windows fit in this frame; the sample '
        'is smaller than the crop plan assumes' % (len(taken), SIDE)
    )
