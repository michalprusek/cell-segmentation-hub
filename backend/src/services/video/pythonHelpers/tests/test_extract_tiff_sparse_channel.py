"""End-to-end: a stack whose reference channel is only refreshed every 3rd frame.

``test_plane_coverage.py`` pins the detector; this pins the WIRING — that the
extractor actually calls it, that the flags reach the result JSON the TypeScript
side parses, and, just as importantly, that NOTHING ELSE CHANGED on disk.

That last point is the whole design. The propagation is virtual: the gap frames
keep their own (blank) PNGs exactly where they always were, and only the read
path redirects. If this test ever finds a gap PNG that is no longer blank, the
fill has started duplicating pixels — which would double the storage of every
sparse upload and make the "is this frame real data?" question unanswerable from
disk.

Runs the helper as a subprocess, the way `pythonExtractor.ts` does, so the
stdout protocol (PROGRESS lines then one JSON object) is exercised too.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

tifffile = pytest.importorskip("tifffile")
pytest.importorskip("PIL")

HELPERS_DIR = Path(__file__).resolve().parents[1]
SCRIPT = HELPERS_DIR / "extract_tiff_stack.py"

T, C, Y, X = 9, 2, 24, 32
REFRESH_EVERY = 3


def _sparse_stack() -> np.ndarray:
    """(T, C, Y, X): channel 0 real every 3rd frame, channel 1 real throughout."""
    rng = np.random.default_rng(7)
    arr = np.zeros((T, C, Y, X), dtype=np.uint16)
    for t in range(T):
        # The fluorescence channel is imaged at every timepoint.
        arr[t, 1] = rng.integers(400, 600, (Y, X), dtype=np.uint16)
        # The reference channel only on every REFRESH_EVERY-th; the rest stay
        # zero, which is literally what the production ND2s and TIFFs contain.
        if t % REFRESH_EVERY == 0:
            arr[t, 0] = rng.integers(2000, 4000, (Y, X), dtype=np.uint16)
    return arr


def _run(src: Path, dest: Path) -> dict:
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), str(dest)],
        capture_output=True,
        text=True,
        check=True,
    )
    # The result is the last stdout line; everything before it is PROGRESS.
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    return json.loads(lines[-1])


@pytest.fixture(scope="module")
def extracted(tmp_path_factory) -> tuple[dict, Path]:
    root = tmp_path_factory.mktemp("sparse_tiff")
    src = root / "sparse.tif"
    tifffile.imwrite(
        str(src),
        _sparse_stack(),
        photometric="minisblack",
        metadata={"axes": "TCYX"},
    )
    dest = root / "out"
    return _run(src, dest), dest


def test_sparse_channel_reports_its_gaps(extracted):
    result, _ = extracted
    ch0 = result["channels"][0]
    assert ch0["fillFrames"] == {
        "1": 0,
        "2": 0,
        "4": 3,
        "5": 3,
        "7": 6,
        "8": 6,
    }


def test_dense_channel_reports_nothing(extracted):
    """A channel imaged at every timepoint must come back exactly as before —
    this is what keeps every existing upload unaffected."""
    result, _ = extracted
    assert "fillFrames" not in result["channels"][1]


def test_frame_count_and_geometry_unchanged(extracted):
    result, _ = extracted
    assert result["frameCount"] == T
    assert (result["width"], result["height"]) == (X, Y)


def test_every_frame_still_has_a_png_for_every_channel(extracted):
    """The on-disk layout is untouched: one PNG per (frame, channel), gaps
    included. Anything that walks the frames tree keeps working."""
    result, dest = extracted
    names = [c["name"] for c in result["channels"]]
    for t in range(T):
        for name in names:
            png = dest / "frames" / f"{t:04d}" / f"{name}.png"
            assert png.is_file(), f"missing {png}"


def test_gap_pngs_are_still_blank_on_disk(extracted):
    """The propagation is VIRTUAL. A gap frame's PNG must remain the blank plane
    the acquisition wrote — the redirect happens when it is READ. If this fails,
    someone started copying pixels."""
    from PIL import Image

    result, dest = extracted
    ref_name = result["channels"][0]["name"]
    for t in (1, 2, 4, 5, 7, 8):
        arr = np.asarray(
            Image.open(dest / "frames" / f"{t:04d}" / f"{ref_name}.png")
        )
        assert arr.min() == arr.max() == 0, f"frame {t} is no longer blank"

    for t in (0, 3, 6):
        arr = np.asarray(
            Image.open(dest / "frames" / f"{t:04d}" / f"{ref_name}.png")
        )
        assert arr.min() != arr.max(), f"frame {t} should carry real data"


def test_dense_stack_emits_no_coverage_at_all(tmp_path):
    """The regression guard for every video that already exists."""
    rng = np.random.default_rng(11)
    arr = rng.integers(100, 900, (5, 2, Y, X), dtype=np.uint16)
    src = tmp_path / "dense.tif"
    tifffile.imwrite(
        str(src), arr, photometric="minisblack", metadata={"axes": "TCYX"}
    )

    result = _run(src, tmp_path / "out")

    for ch in result["channels"]:
        assert "fillFrames" not in ch


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
