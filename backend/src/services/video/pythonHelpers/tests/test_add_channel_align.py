"""Unit tests for ``add_channel_align.py``.

The "Add channel" alignment driver: for each ``{moving, reference, out}`` job it
phase-correlates the added channel's frame onto the target frame's segmentation
source and writes the losslessly-shifted result. These tests pin the contract a
refactor could silently break:

  - the recovered shift is the exact inverse of a known translation,
  - the written output is lossless (16-bit preserved, overlap identical),
  - a shape mismatch degrades to an unshifted copy rather than aborting,
  - a single-image source (one job) round-trips.

Pure numpy + PIL + subprocess — no pytest/scipy/skimage — so it runs in the
backend container with a plain interpreter:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_add_channel_align.py

It is also pytest-collectable (``test_*`` functions).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from channel_registration import shift_frame  # noqa: E402

SCRIPT = os.path.join(HELPERS_DIR, "add_channel_align.py")


def _reference(seed: int = 0) -> np.ndarray:
    """A 128x160 16-bit frame with a bright blob — enough edges for phase
    correlation to lock onto, like a real microtubule frame."""
    rng = np.random.RandomState(seed)
    ref = (rng.rand(128, 160) * 4000).astype(np.uint16)
    ref[40:70, 50:90] += 30000
    return np.clip(ref, 0, 65535).astype(np.uint16)


def _run(jobs: list[dict]) -> dict:
    """Invoke the helper with a manifest of jobs; return its parsed result."""
    d = tempfile.mkdtemp()
    manifest = os.path.join(d, "manifest.json")
    Path(manifest).write_text(json.dumps({"jobs": jobs}))
    res = subprocess.run(
        [sys.executable, SCRIPT, manifest],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": HELPERS_DIR},
    )
    assert res.returncode == 0, f"helper failed: {res.stderr[-400:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_recovers_and_corrects_known_shift():
    d = tempfile.mkdtemp()
    ref = _reference()
    dy, dx = 5, -3
    mov = shift_frame(ref, dy, dx).astype(np.uint16)
    ref_p = os.path.join(d, "ref.png")
    mov_p = os.path.join(d, "mov.png")
    out_p = os.path.join(d, "out.png")
    Image.fromarray(ref).save(ref_p)
    Image.fromarray(mov).save(mov_p)

    report = _run([{"moving": mov_p, "reference": ref_p, "out": out_p}])
    # The estimate is the inverse translation that puts moving back on reference.
    assert report["aligned"] == 1
    est_dy, est_dx, conf = report["shifts"][0]
    assert (est_dy, est_dx) == (-dy, -dx), report["shifts"]
    assert conf > 1.0

    # Lossless: 16-bit dtype preserved and the overlap region matches exactly.
    out = np.asarray(Image.open(out_p))
    assert out.dtype == np.uint16
    overlap = slice(10, 120), slice(10, 150)
    assert np.array_equal(out[overlap], ref[overlap])


def test_shape_mismatch_writes_unshifted_copy():
    d = tempfile.mkdtemp()
    ref = _reference()
    mov = (np.random.RandomState(1).rand(64, 64) * 65535).astype(np.uint16)
    ref_p = os.path.join(d, "ref.png")
    mov_p = os.path.join(d, "mov.png")
    out_p = os.path.join(d, "out.png")
    Image.fromarray(ref).save(ref_p)
    Image.fromarray(mov).save(mov_p)

    report = _run([{"moving": mov_p, "reference": ref_p, "out": out_p}])
    # Mismatched shapes → no shift estimated, moving copied verbatim.
    assert report["shifts"][0] == [0, 0, 0.0]
    out = np.asarray(Image.open(out_p))
    assert np.array_equal(out, mov)


def test_single_image_zero_shift_roundtrip():
    d = tempfile.mkdtemp()
    ref = _reference(seed=2)
    # Moving already aligned to reference → estimate should be a no-op.
    mov_p = os.path.join(d, "mov.png")
    ref_p = os.path.join(d, "ref.png")
    out_p = os.path.join(d, "out.png")
    Image.fromarray(ref).save(ref_p)
    Image.fromarray(ref).save(mov_p)

    report = _run([{"moving": mov_p, "reference": ref_p, "out": out_p}])
    assert report["shifts"][0][:2] == [0, 0]
    out = np.asarray(Image.open(out_p))
    assert np.array_equal(out, ref)


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
