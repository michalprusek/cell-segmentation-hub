"""Unit tests for ``frame_png.py`` — the one encoder every frame PNG goes through.

What these pin, and why each one exists:

  - **Lossless.** The stored frames are the measurement surface (``mt_measure``
    reads raw 16-bit ADU off them), so a compression setting that altered a
    single pixel would corrupt every downstream number silently. Checked on
    uint8 and uint16, including the value extremes.
  - **The strategy actually reaches zlib.** ``compress_type`` is forwarded by
    Pillow to ``deflateInit2``'s ``strategy`` and is not part of the documented
    PNG keyword set. If a future Pillow stopped forwarding it, the encoder would
    quietly fall back to ``Z_FILTERED`` and cost ~6x the CPU with nothing to
    see. Comparing the bytes against an explicit ``Z_FILTERED`` encode of the
    same array catches that deterministically, without timing anything.
  - **There is only one encoder.** Four helpers used to carry their own copy of
    the ``Image.save`` call and drifted. Asserting that none of them names
    ``optimize=True`` or ``format="PNG"`` on its own is what stops a fifth copy
    reappearing.

Pure numpy + PIL — no pytest — so it runs in the backend container with a plain
interpreter:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_frame_png.py

It is also pytest-collectable (``test_*`` functions).
"""
from __future__ import annotations

import io
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from frame_png import (  # noqa: E402
    FRAME_PNG_COMPRESS_LEVEL,
    FRAME_PNG_COMPRESS_TYPE,
    FRAME_PNG_SAVE_KWARGS,
    Z_FILTERED,
    Z_RLE,
    save_frame_png,
)


def _frame(dtype=np.uint16, seed: int = 0) -> np.ndarray:
    """A frame shaped like a real one: a noisy background with bright
    filament-like ridges. Structure matters — a pure-noise array is
    incompressible under every strategy, so it could not tell them apart."""
    rng = np.random.RandomState(seed)
    hi = np.iinfo(dtype).max
    arr = (rng.rand(96, 128) * (hi // 8)).astype(dtype)
    for k in range(6):
        arr[10 + k * 12 : 12 + k * 12, :] = dtype(hi - k * 3)
        arr[:, 5 + k * 19 : 6 + k * 19] = dtype(hi // 2)
    return arr


def test_roundtrip_is_lossless_for_both_depths() -> None:
    for dtype in (np.uint8, np.uint16):
        arr = _frame(dtype)
        # Pin the extremes explicitly: a clipping bug would hide in the middle
        # of a random range.
        arr[0, 0] = 0
        arr[0, 1] = np.iinfo(dtype).max
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "f.png"
            save_frame_png(arr, p)
            back = np.array(Image.open(p))
        assert back.dtype == arr.dtype, (dtype, back.dtype)
        assert np.array_equal(back, arr), f"{dtype} round-trip is not lossless"


def test_accepts_a_str_path() -> None:
    """``add_channel_align`` passes a str, the extractors pass a Path."""
    arr = _frame()
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "f.png")
        save_frame_png(arr, p)
        assert np.array_equal(np.array(Image.open(p)), arr)


def test_compress_type_actually_reaches_the_encoder() -> None:
    """The configured zlib strategy must change the bytes.

    If Pillow ever stopped forwarding ``compress_type``, this file's encode
    would become byte-identical to the ``Z_FILTERED`` default at the same
    level — 6x slower for the same output, and completely invisible. Compare
    against BOTH the default-strategy encode and an explicit ``Z_FILTERED``
    one so the assertion cannot pass by accident.
    """
    assert FRAME_PNG_COMPRESS_TYPE == Z_RLE
    assert FRAME_PNG_COMPRESS_TYPE != Z_FILTERED
    arr = _frame()

    def encode(**kw) -> bytes:
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, format="PNG", **kw)
        return buf.getvalue()

    ours = encode(
        compress_level=FRAME_PNG_COMPRESS_LEVEL,
        compress_type=FRAME_PNG_COMPRESS_TYPE,
    )
    filtered = encode(
        compress_level=FRAME_PNG_COMPRESS_LEVEL, compress_type=Z_FILTERED
    )
    default_strategy = encode(compress_level=FRAME_PNG_COMPRESS_LEVEL)
    assert ours != filtered, (
        "compress_type is being ignored — the encode is identical to Z_FILTERED"
    )
    assert ours != default_strategy, (
        "compress_type is being ignored — the encode is identical to the default"
    )
    # ...and the strategy must not have cost us the compression: PNG's whole
    # point here is that these frames stay small on disk.
    raw = arr.size * arr.dtype.itemsize
    assert len(ours) < raw, "output is larger than the raw array"


def test_save_kwargs_are_what_save_frame_png_uses() -> None:
    """``FRAME_PNG_SAVE_KWARGS`` is exported for tests and callers to reason
    about; it must describe the real call, not drift from it."""
    arr = _frame()
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "via_helper.png"
        save_frame_png(arr, p)
        direct = io.BytesIO()
        Image.fromarray(arr).save(direct, **FRAME_PNG_SAVE_KWARGS)
        assert p.read_bytes() == direct.getvalue()


def test_no_helper_encodes_a_frame_png_on_its_own() -> None:
    """SSOT guard.

    The four writers (`extract_nd2`, `extract_tiff_stack`, `drift_correction`,
    `add_channel_align`) held four copies of the same ``Image.save`` call, so a
    change to the encoder reached one of them at a time. Every frame PNG now
    goes through ``save_frame_png``; a new local copy has to fail here rather
    than be noticed months later by a byte diff.
    """
    writers = [
        "extract_nd2.py",
        "extract_tiff_stack.py",
        "drift_correction.py",
        "add_channel_align.py",
    ]
    for name in writers:
        src = Path(HELPERS_DIR, name).read_text()
        assert "save_frame_png" in src, f"{name} does not use the shared encoder"
        # `frame_png.py` itself names these; the writers must not.
        assert "optimize=True" not in src, (
            f"{name} still encodes a PNG with its own optimize=True"
        )
        assert 'format="PNG"' not in src, (
            f"{name} still names its own PNG encoder arguments"
        )


def test_rewritten_frame_matches_a_freshly_written_one() -> None:
    """A drift-corrected frame and a freshly extracted one must be byte-
    comparable, because `drift_correction` rewrites in place and the tests that
    check "this frame was left alone" compare bytes."""
    arr = _frame(seed=4)
    with tempfile.TemporaryDirectory() as td:
        a, b = Path(td) / "a.png", Path(td) / "b.png"
        save_frame_png(arr, a)
        # round-trip through disk, exactly as the drift rewrite does
        save_frame_png(np.array(Image.open(a)), b)
        assert a.read_bytes() == b.read_bytes()


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 - report all, exit non-zero
                failures += 1
                print(f"FAIL {name}: {exc}")
    print(f"\n{'OK' if failures == 0 else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)
