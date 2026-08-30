"""Unit tests for ``add_channel_align.py``.

The "Add channel" alignment driver: for each ``{moving, reference, out}`` job it
phase-correlates the added channel's frame onto the target frame's segmentation
source and writes the losslessly-shifted result. These tests pin the contract a
refactor could silently break:

  - the recovered shift is the exact inverse of a known translation,
  - the written output is lossless (16-bit preserved, overlap identical),
  - a shape mismatch degrades to an unshifted copy rather than aborting,
  - a single-image source (one job) round-trips,
  - every per-frame ``reason`` the helper can emit is REACHED by a real image
    pair, not merely by unit-testing the classifier on hand-written tuples: a
    correctable shift and an already-aligned pair (``ok``), a structureless
    pair (``low_confidence``), a pair whose true offset exceeds the
    plausibility cap (``implausible_shift`` — and with a HIGH confidence, which
    is exactly the outcome a zero shift alone cannot be told apart from a
    success), and a shape mismatch (``shape_mismatch``).

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

from channel_registration import (  # noqa: E402
    _MAX_SHIFT_PX,
    _MIN_CONFIDENCE,
    shift_frame,
)

SCRIPT = os.path.join(HELPERS_DIR, "add_channel_align.py")


def _reference(seed: int = 0) -> np.ndarray:
    """A 128x160 16-bit frame with a bright blob — enough edges for phase
    correlation to lock onto, like a real microtubule frame."""
    rng = np.random.RandomState(seed)
    ref = (rng.rand(128, 160) * 4000).astype(np.uint16)
    ref[40:70, 50:90] += 30000
    return np.clip(ref, 0, 65535).astype(np.uint16)


def _one(ref: np.ndarray, mov: np.ndarray) -> list:
    """Write a (reference, moving) pair to a temp dir, run the helper on it and
    return the single shift row ``[dy, dx, conf, reason, peak_dy, peak_dx]``."""
    d = tempfile.mkdtemp()
    ref_p = os.path.join(d, "ref.png")
    mov_p = os.path.join(d, "mov.png")
    out_p = os.path.join(d, "out.png")
    Image.fromarray(ref).save(ref_p)
    Image.fromarray(mov).save(mov_p)
    return _run([{"moving": mov_p, "reference": ref_p, "out": out_p}])["shifts"][0]


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
    est_dy, est_dx, conf, reason, peak_dy, peak_dx = report["shifts"][0]
    assert (est_dy, est_dx) == (-dy, -dx), report["shifts"]
    assert conf > 1.0
    assert reason == "ok", report["shifts"]
    # On an accepted estimate the raw peak IS the applied shift.
    assert (peak_dy, peak_dx) == (est_dy, est_dx)

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
    # Mismatched shapes → no shift estimated, moving copied verbatim. No
    # correlation ran, so there is no candidate peak either.
    assert report["shifts"][0] == [0, 0, 0.0, "shape_mismatch", 0, 0]
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


# ---------------------------------------------------------------------------
# Reason vocabulary. Each test builds an image pair that actually DRIVES the
# helper down the branch under test — the point is to prove the pipeline can
# reach every reason, which asserting on hand-made tuples would not.
# ---------------------------------------------------------------------------


def test_reason_ok_on_a_correctable_shift():
    ref = _reference(seed=7)
    row = _one(ref, shift_frame(ref, 6, -4).astype(np.uint16))
    assert row[3] == "ok", row
    assert (row[0], row[1]) == (-6, 4), row
    assert row[2] >= _MIN_CONFIDENCE, row


def test_reason_ok_on_an_already_aligned_pair():
    # A genuine zero shift: nothing to correct, and it must NOT be confused
    # with a rejection. This is the success half of the old ambiguity.
    ref = _reference(seed=8)
    row = _one(ref, ref.copy())
    assert row[:2] == [0, 0], row
    assert row[3] == "ok", row
    assert row[2] >= _MIN_CONFIDENCE, row


def test_reason_low_confidence_on_a_pair_with_no_shared_structure():
    # A flat, featureless moving frame: the correlation surface has no peak to
    # speak of, so the estimate is discarded as untrustworthy.
    ref = _reference(seed=9)
    flat = np.full(ref.shape, 200, dtype=np.uint16)
    row = _one(ref, flat)
    assert row[:2] == [0, 0], row
    assert row[3] == "low_confidence", row
    assert row[2] < _MIN_CONFIDENCE, row


def test_reason_implausible_shift_keeps_a_high_confidence():
    # A REAL, cleanly correlatable offset that is simply larger than the
    # plausibility cap (10% of 128 rows = 12.8 px). The peak is found and is
    # sharp — the confidence stays high — but the shift is discarded.
    #
    # This is precisely the row that used to be indistinguishable from
    # "already aligned": zero shift, good confidence. Asserting the high
    # confidence here is deliberate — without it the fixture could silently
    # decay into just another low-confidence pair and this branch would go
    # untested.
    ref = _reference(seed=10)
    true_dy = _MAX_SHIFT_PX + 25  # 41 px, way over the 16 px budget
    row = _one(ref, shift_frame(ref, true_dy, 0).astype(np.uint16))
    assert row[:2] == [0, 0], row  # nothing applied
    assert row[3] == "implausible_shift", row
    assert row[2] >= _MIN_CONFIDENCE, row  # ...yet the peak was trusted-sharp
    # The discarded candidate is reported, so the log can say WHAT was refused.
    assert (row[4], row[5]) == (-true_dy, 0), row


def test_reason_shape_mismatch_is_labelled():
    ref = _reference(seed=11)
    row = _one(ref, _reference(seed=12)[:64, :64])
    assert row == [0, 0, 0.0, "shape_mismatch", 0, 0], row


def test_row_is_the_legacy_triple_plus_a_tail():
    # Wire compatibility, from the helper's side: the first three entries are
    # exactly the historical [dy, dx, confidence] row and keep their meaning,
    # with the reason appended. A backend that destructures three elements
    # reads these rows unchanged.
    ref = _reference(seed=13)
    row = _one(ref, shift_frame(ref, 3, 2).astype(np.uint16))
    assert len(row) == 6, row
    dy, dx, conf = row[:3]
    assert isinstance(dy, int) and isinstance(dx, int)
    assert isinstance(conf, float)
    assert isinstance(row[3], str)


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


def test_alignment_budget_covers_a_de_drifted_container():
    """An added channel must still align to a container that was de-drifted.

    Since 2026-08-29 the stored frames of a microtubule container may have been
    moved by up to `DRIFT_MAX_SHIFT_PX`, so the shift needed to land on frame N
    is the chromatic offset PLUS that frame's accumulated drift. Under the
    default 16 px window that worked to ~frame 60 of a 90-frame stack drifting
    0.22 px/frame and then silently stopped — writing unshifted copies while
    the earlier frames looked perfect, which is the worst shape of failure.
    """
    from channel_registration import _MAX_SHIFT_PX, estimate_translation_detailed
    from drift_correction import DRIFT_MAX_SHIFT_PX

    assert DRIFT_MAX_SHIFT_PX > _MAX_SHIFT_PX

    ref = _synthetic_frame(21, 512) if "_synthetic_frame" in dir() else None
    if ref is None:  # local fixture name differs; build one inline
        rng = np.random.RandomState(21)
        ref = rng.rand(512, 512) * 400
        for k in range(10):
            y = 40 + k * 46
            for x in range(20, 492):
                yy = y + (x - 256) // 8
                if 0 <= yy < 512:
                    ref[yy, x] += 6000

    drift = 20  # beyond the 16 px channel window, inside the 96 px drift one
    moving = shift_frame(ref, 0, drift)
    assert estimate_translation_detailed(ref, moving).reason != "ok", (
        "fixture must exceed the default window, or this proves nothing"
    )
    est = estimate_translation_detailed(
        ref, moving, max_shift_px=DRIFT_MAX_SHIFT_PX
    )
    assert est.reason == "ok", est
    assert (est.dy, est.dx) == (0, -drift), est
