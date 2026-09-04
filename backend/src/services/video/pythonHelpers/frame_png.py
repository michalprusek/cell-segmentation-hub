"""One definition of how a video frame is written to PNG.

Every helper that materialises a frame — ``extract_nd2``, ``extract_tiff_stack``,
``drift_correction`` (which rewrites them shifted) and ``add_channel_align``
(which glues a new channel on) — writes through :func:`save_frame_png`. They used
to carry four copies of ``Image.fromarray(...).save(path, format="PNG",
optimize=True)``; a change to the encoder had to be made in four places and was
never going to stay in step.

Why not ``optimize=True``
-------------------------
``optimize=True`` was the encoder setting from the first extractor and it is by
far the most expensive thing an upload does. Reading Pillow's encoder
(``src/libImaging/ZipEncode.c``) says exactly what it buys:

    compress_level = (context->optimize) ? Z_BEST_COMPRESSION : compress_level;
    compress_type  = (compress_type == -1)
                     ? (mode == ZIP_PNG ? Z_FILTERED : Z_DEFAULT_STRATEGY)
                     : compress_type;

so ``optimize`` means "zlib level 9", plus one extra candidate row filter
(``/* 3. Average ... only used with the optimize option */``). PNG already
defaults to the ``Z_FILTERED`` strategy here, so ``optimize=True`` and
``compress_level=9`` are within 1 % of each other in both time and size — the
whole cost is level 9.

Measured on 80 real production frames sampled across 43 projects (16-bit
grayscale microscopy, 1476x1924 typical), each re-encoded from its stored PNG
and verified to round-trip bit-identically:

    setting                       ms/frame   speed    total bytes   p95    max
    optimize=True (was)              839.5    1.00x        100.0%  100%   100%
    compress_level=3                  59.6   14.09x        105.4%  437%   444%
    compress_level=6                 195.2    4.30x        103.2%  109%   110%
    compress_level=6 + Z_RLE          30.3   27.73x        104.8%  115%   116%

``compress_level=3`` is the obvious cheap knob and it is a trap: on a
near-empty frame it misses the long runs the higher levels find and blows up to
4.4x the bytes. ``Z_RLE`` (zlib's run-length strategy — matches limited to
distance 1, which is what libpng recommends for filtered image rows) is both
faster and far better behaved in the tail: strictly better than level 3 on both
axes, and within 1.6 % of level 6's total size for 6.4x its speed.

So: level 6, strategy ``Z_RLE``. That is 27.7x less CPU per frame for 4.8 % more
bytes. Encoding is ~99.5 % of extraction wall-clock — an ND2 timepoint reads in
8.4 ms and encodes in 2 x 840 ms — so this is essentially the whole cost of an
upload's server-side phase.

PNG is lossless under every one of these settings; they change only how zlib
searches for matches. ``test_frame_png.py`` pins that, and pins that the
strategy actually reaches the encoder (a silently-ignored ``compress_type``
would fall back to ``Z_FILTERED`` and cost 6x the CPU with nothing to notice).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

# zlib strategy constants, as passed straight through to ``deflateInit2``.
# Pillow forwards ``compress_type`` to zlib's ``strategy`` argument; it is not
# a PNG filter selector.
Z_DEFAULT_STRATEGY = 0
Z_FILTERED = 1
Z_RLE = 3

#: zlib deflate level. 6 is zlib's own default and the knee of the size curve.
FRAME_PNG_COMPRESS_LEVEL = 6
#: zlib match strategy. See the module docstring for the measurement.
FRAME_PNG_COMPRESS_TYPE = Z_RLE

#: Exactly the kwargs handed to ``Image.save``. Exported so tests can assert the
#: call sites all use the same ones rather than re-typing them.
FRAME_PNG_SAVE_KWARGS = {
    "format": "PNG",
    "compress_level": FRAME_PNG_COMPRESS_LEVEL,
    "compress_type": FRAME_PNG_COMPRESS_TYPE,
}


def save_frame_png(arr: np.ndarray, path: Path | str) -> None:
    """Write ``arr`` to ``path`` as a lossless PNG.

    ``arr`` must already be in a dtype PNG can hold (uint8 / uint16); callers
    that decode arbitrary microscopy dtypes coerce first — see
    ``extract_nd2._to_png_dtype``.
    """
    Image.fromarray(np.asarray(arr)).save(path, **FRAME_PNG_SAVE_KWARGS)
