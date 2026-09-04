"""The display conversion must not change a single pixel.

Reported 2026-09-04: "don't change the bit depth or the resolution — show
exactly what the user uploaded". It did change both meanings of that: measured
on a real production file (uint16, 237..3853, 3525 distinct levels) the served
image had a range of 2..12 and TWO grey levels, i.e. essentially black.

The cause was sharp/libvips destroying the data while DECODING the TIFF (it
shifts right 8), so no encoder setting could have recovered it. These tests pin
the replacement, which is the same tifffile/Pillow encoder the video frame
extractors use.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

tifffile = pytest.importorskip("tifffile")
from PIL import Image  # noqa: E402

HELPER = Path(__file__).resolve().parents[1] / "convert_for_display.py"


def _run(src: Path, dst: Path) -> dict:
    proc = subprocess.run(
        [sys.executable, str(HELPER), str(src), str(dst)],
        capture_output=True,
        text=True,
    )
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _read_png16(path: Path) -> np.ndarray:
    """Decode a PNG without Pillow.

    Pillow DOWNCASTS a 16-bit RGB PNG to 8 bits on read, so comparing through
    it would report a loss the file does not have — that mistake cost a round
    of debugging. Everything here is decoded from the chunks directly.
    """
    import struct
    import zlib

    raw = path.read_bytes()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    i, idat, hdr = 8, b"", None
    while i < len(raw):
        (length,) = struct.unpack(">I", raw[i : i + 4])
        tag = raw[i + 4 : i + 8]
        payload = raw[i + 8 : i + 8 + length]
        i += 12 + length
        if tag == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", payload)
        elif tag == b"IDAT":
            idat += payload
    width, height, depth, colour = hdr[0], hdr[1], hdr[2], hdr[3]
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[colour]
    sample = 2 if depth == 16 else 1
    bpp = channels * sample
    stride = width * bpp
    data = zlib.decompress(idat)

    # Full PNG unfiltering. Pillow chooses adaptively, so a decoder that
    # assumed filter 0 would only ever read files written by the hand-rolled
    # encoder — which is exactly the mistake this comment exists to prevent.
    out = bytearray()
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        ftype = data[pos]
        line = bytearray(data[pos + 1 : pos + 1 + stride])
        pos += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ftype == 1:
                line[x] = (line[x] + a) & 0xFF
            elif ftype == 2:
                line[x] = (line[x] + b) & 0xFF
            elif ftype == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                p_ = a + b - c
                pa, pb, pc = abs(p_ - a), abs(p_ - b), abs(p_ - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 0xFF
            elif ftype != 0:
                raise AssertionError(f"unknown PNG filter {ftype}")
        out += line
        prev = line

    arr = np.frombuffer(bytes(out), dtype=">u2" if depth == 16 else np.uint8)
    arr = arr.reshape(height, width, channels)
    return arr[..., 0] if channels == 1 else arr


@pytest.mark.parametrize(
    "array",
    [
        # The shape of the reported file: 16-bit using the bottom 6% of range.
        np.random.default_rng(1).integers(237, 3854, (64, 96), dtype=np.uint16),
        # Full-range 16-bit.
        np.random.default_rng(2).integers(0, 65536, (48, 32), dtype=np.uint16),
        # 16-bit RGB — Pillow cannot WRITE this, hence the hand-rolled encoder.
        np.random.default_rng(3).integers(0, 65536, (40, 24, 3), dtype=np.uint16),
        # 8-bit, which must also pass through untouched.
        np.random.default_rng(4).integers(0, 256, (32, 40), dtype=np.uint8),
    ],
    ids=["dim-16bit", "full-16bit", "16bit-rgb", "8bit"],
)
def test_conversion_is_bit_exact(tmp_path, array):
    src = tmp_path / "in.tiff"
    dst = tmp_path / "out.png"
    tifffile.imwrite(src, array)

    result = _run(src, dst)
    assert result["ok"], result
    assert result["lossless"] is True

    decoded = _read_png16(dst)
    assert decoded.shape == array.shape
    assert np.array_equal(decoded, array), "the conversion changed pixel values"


def test_resolution_is_never_changed(tmp_path):
    array = np.random.default_rng(5).integers(0, 4096, (123, 457), dtype=np.uint16)
    src, dst = tmp_path / "in.tiff", tmp_path / "out.png"
    tifffile.imwrite(src, array)
    result = _run(src, dst)
    assert (result["width"], result["height"]) == (457, 123)
    assert _read_png16(dst).shape == (123, 457)


def test_the_grey_levels_survive(tmp_path):
    # The regression in one number. A ramp through the bottom of the 16-bit
    # range had 3525 levels in the source and TWO after the old conversion.
    array = np.linspace(237, 3853, 64 * 96).reshape(64, 96).astype(np.uint16)
    src, dst = tmp_path / "in.tiff", tmp_path / "out.png"
    tifffile.imwrite(src, array)
    assert _run(src, dst)["ok"]
    assert len(np.unique(_read_png16(dst))) == len(np.unique(array)) > 1000


def test_a_stack_yields_its_first_plane_not_a_mangled_colour_image(tmp_path):
    # A multi-page TIFF opened as a still image shows page 0, the same one the
    # browser would have shown. It must not be reinterpreted as channels.
    stack = np.random.default_rng(6).integers(0, 4096, (5, 40, 50), dtype=np.uint16)
    src, dst = tmp_path / "in.tiff", tmp_path / "out.png"
    tifffile.imwrite(src, stack)
    assert _run(src, dst)["ok"]
    assert np.array_equal(_read_png16(dst), stack[0])


def test_a_float_source_reports_that_it_was_rescaled(tmp_path):
    # Float has no lossless integer representation, so the rescale is honest
    # and flagged rather than silently claimed as exact.
    array = np.random.default_rng(7).random((16, 16)).astype(np.float32)
    src, dst = tmp_path / "in.tiff", tmp_path / "out.png"
    tifffile.imwrite(src, array)
    result = _run(src, dst)
    assert result["ok"] and result["lossless"] is False


def test_a_broken_file_reports_instead_of_crashing(tmp_path):
    src, dst = tmp_path / "in.tiff", tmp_path / "out.png"
    src.write_bytes(b"not a tiff at all")
    result = _run(src, dst)
    assert result["ok"] is False and result["error"]
