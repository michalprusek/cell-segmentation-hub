#!/usr/bin/env python3
"""Convert an image the browser cannot render into a PNG, LOSSLESSLY.

Why this exists rather than sharp/libvips, which the Node side already has:
sharp destroys the data while DECODING a high-bit-depth TIFF, not while
encoding it. Measured on a real production file (uint16, values 237..3853,
3525 distinct levels), sharp reads it as 8-bit by shifting right 8 — max 15 —
so asking it for a 16-bit output afterwards only widens the container around
data that is already gone. What reached the browser was a 2-grey-level,
essentially black image. Four sharp configurations were tried; none preserves
it, because the loss is upstream of the encoder.

tifffile + Pillow round-trips the same file bit-exactly, and it is the encoder
the video frame extractors already use, so a still image and a video frame now
go through the same one.

Emits one JSON object on stdout: {"ok": true, "width", "height", "mode",
"lossless"}. ``lossless`` is False only for the float sources noted below,
where a rescale is unavoidable.
"""
import json
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def _to_saveable(arr: np.ndarray) -> "tuple[np.ndarray, bool]":
    """Return (array Pillow can write, whether it is lossless).

    Mirrors `extract_tiff_stack._normalise_frame`: uint8/uint16 pass through,
    int16 is offset into uint16 reversibly, anything else is rescaled. Kept
    deliberately in step with that function -- a still image and a video frame
    from the same microscope must not come out different.
    """
    if arr.dtype in (np.uint8, np.uint16):
        return arr, True
    if arr.dtype == np.int16:
        return (arr.astype(np.int32) + 32768).astype(np.uint16), True
    if arr.dtype == np.bool_:
        return (arr.astype(np.uint8) * 255), True
    if np.issubdtype(arr.dtype, np.integer):
        info = np.iinfo(arr.dtype)
        if info.min >= 0 and info.max <= 65535:
            return arr.astype(np.uint16), True
    finite = arr[np.isfinite(arr)] if arr.size else arr
    if finite.size == 0:
        return np.zeros(arr.shape, dtype=np.uint16), False
    lo, hi = float(finite.min()), float(finite.max())
    if hi <= lo:
        return np.zeros(arr.shape, dtype=np.uint16), False
    out = (arr.astype(np.float64) - lo) / (hi - lo) * 65535.0
    return np.clip(out, 0.0, 65535.0).astype(np.uint16), False


def _write_png16(path: str, arr: np.ndarray) -> str:
    """Write a 16-bit PNG that Pillow cannot: multi-channel at 16 bits.

    Pillow's PNG writer handles 16 bits only for single-channel ('I;16'), so a
    genuine 16-bit RGB TIFF -- which production does contain -- raises
    "Cannot handle this data type". PNG itself supports it (colour type 2 or 6
    at bit depth 16), so the file is assembled here rather than losing half the
    bits. Big-endian samples and filter type 0 per row, which is what the
    format requires; zlib level 6 to match the rest of the pipeline.
    """
    import struct
    import zlib

    height, width = arr.shape[0], arr.shape[1]
    channels = 1 if arr.ndim == 2 else arr.shape[2]
    colour = {1: 0, 2: 4, 3: 2, 4: 6}[channels]
    be = np.ascontiguousarray(arr.astype(">u2"))
    rows = be.reshape(height, -1).view(np.uint8)
    # One filter byte (0 = None) in front of every row.
    raw = np.hstack(
        [np.zeros((height, 1), dtype=np.uint8), rows]
    ).tobytes()

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 16, colour, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", ihdr))
        fh.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        fh.write(chunk(b"IEND", b""))
    return {0: "I;16", 2: "RGB;16", 4: "LA;16", 6: "RGBA;16"}[colour]


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: convert_for_display.py SRC DST"}))
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    try:
        try:
            import tifffile

            arr = tifffile.imread(src)
        except Exception:
            # Not a TIFF, or tifffile cannot read it: let Pillow try. This is
            # the path for the odd formats (JPEG 2000 and friends) that are
            # equally not browser-renderable.
            arr = np.asarray(Image.open(src))

        # A stack is a still image here: show the first plane, the same one the
        # browser would have shown.
        #
        # Disambiguating a 3-D array is the fiddly part, and getting it wrong
        # is silent: an earlier version treated the LAST axis as channels
        # whenever it was not 3 or 4, so a (5, 40, 50) page stack came out as
        # the first COLUMN of each row -- a 5x40 smear that still looked like
        # an image. Only a trailing 3 or 4 on an array whose leading axis is
        # too big to be a page count is genuinely RGB/RGBA; everything else is
        # pages or channel-first, and takes plane 0.
        while arr.ndim > 3:
            arr = arr[0]
        if arr.ndim == 3 and not (arr.shape[-1] in (3, 4) and arr.shape[0] > 4):
            arr = arr[0]

        saveable, lossless = _to_saveable(np.ascontiguousarray(arr))
        height, width = saveable.shape[0], saveable.shape[1]
        if saveable.dtype == np.uint16 and saveable.ndim == 3:
            mode = _write_png16(dst, saveable)
        else:
            img = Image.fromarray(saveable)
            # compress_level 6 matches the frame encoder; `optimize` is NOT
            # used (measured 28x slower for ~5% of bytes -- see frame_png.py).
            img.save(dst, format="PNG", compress_level=6)
            mode = img.mode
        print(
            json.dumps(
                {
                    "ok": True,
                    "width": int(width),
                    "height": int(height),
                    "mode": mode,
                    "lossless": bool(lossless),
                }
            )
        )
        return 0
    except Exception as exc:  # noqa: BLE001 - report, never crash the request
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
