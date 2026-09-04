"""``mt_measure.region_stats`` measures the SAME pixels after it stopped
gathering over the whole frame.

Every caller of ``region_stats`` hands it a FULL-FRAME mask that describes a
sliver of the frame: on production container 4972cad8 frame 0 (1476x1924) the
59 real microtubule bands occupy 0.05 % of the pixels the gather visited, and
``frap_select._spot_snr`` — which measures a ~30 px window through this
function, once per candidate — has the same shape and worse. Since 2026-09-04
the gather is windowed to the mask's bounding box.

That is an identity, not an approximation: boolean indexing yields the set
pixels in row-major order, and cropping to a box that contains all of them
yields the SAME 1-D array — same values, same order, same length — so numpy's
pairwise summation blocks identically and none of ``sum``/``mean``/``median``/
``std`` can move. These tests hold it to that against a verbatim transcription
of the pre-change body, on the shapes where a windowing bug would show:
nothing set, single pixels on every edge and corner, everything set, two
far-apart blobs, and a random sparse mask over a textured image.

WHY THIS FILE LIVES HERE. ``mt_measure`` is shared by three callers and its
natural test home is ``backend/segmentation/tests/unit/test_mt_metrics_band.py``
— which CI cannot collect, because that suite's package imports mamba_ssm and
therefore Triton, which raises without a CUDA driver. This directory IS in
``make ci`` (step 7), for exactly the reason ``test_metrics_match_export.py``
records: an assertion about the one shared metric implementation is worth
little if nothing automated ever runs it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

# The same resolver `mt_pipeline.measure` uses, called directly: this file is
# about the shared module, not about the essays adapter, so there is no reason
# to drag the ND2 pipeline in to reach it.
from _mt_package import ensure_on_path  # noqa: E402

ensure_on_path()
import mt_measure  # noqa: E402  (needs the path set above)


def _region_stats_reference(image, mask):
    """The pre-2026-09-04 body, verbatim: one gather over the WHOLE frame."""
    pixels = image[mask.astype(bool)] if mask.dtype != bool else image[mask]
    n = int(pixels.size)
    if n == 0:
        return mt_measure.RegionStats(0, 0.0, 0.0, 0.0, 0.0)
    return mt_measure.RegionStats(
        n=n,
        sum=float(pixels.sum()),
        mean=float(pixels.mean()),
        median=mt_measure.imagej_median(pixels),
        std=float(pixels.std(ddof=1)) if n > 1 else 0.0,
    )


def _fields(stats):
    return (stats.n, stats.sum, stats.mean, stats.median, stats.std)


@pytest.fixture
def image():
    """Textured, non-constant, and NOT symmetric in x and y.

    A constant image would make every windowing bug — including one that read a
    different set of pixels entirely — report the same numbers, which is the
    failure this file exists to catch. Distinct x and y gradients mean a
    transposed or off-by-one box lands on different values.
    """
    h, w = 37, 53
    yy, xx = np.mgrid[0:h, 0:w]
    return (1000.0 + 7.0 * yy + 0.5 * xx + (yy * xx) % 13).astype(np.float64)


def _edge_case_masks(h, w, dtype):
    masks = {
        "empty": np.zeros((h, w), dtype),
        "full": np.ones((h, w), dtype),
    }
    for y in (0, 1, h // 2, h - 2, h - 1):
        for x in (0, 1, w // 2, w - 2, w - 1):
            m = np.zeros((h, w), dtype)
            m[y, x] = 1
            masks["px_%d_%d" % (y, x)] = m
    two = np.zeros((h, w), dtype)
    two[1, 1] = two[h - 2, w - 2] = 1
    masks["two_blobs"] = two
    row = np.zeros((h, w), dtype)
    row[h // 3, :] = 1
    masks["full_row"] = row
    col = np.zeros((h, w), dtype)
    col[:, w // 3] = 1
    masks["full_col"] = col
    return masks


@pytest.mark.parametrize("dtype", [bool, np.uint8])
def test_windowed_gather_matches_the_full_frame_one_on_edge_case_masks(image, dtype):
    h, w = image.shape
    masks = _edge_case_masks(h, w, dtype)
    for name, mask in masks.items():
        got = mt_measure.region_stats(image, mask)
        want = _region_stats_reference(image, mask)
        assert _fields(got) == _fields(want), name
    # 2 degenerate + 25 single-pixel + two_blobs + full_row + full_col.
    assert len(masks) == 30


@pytest.mark.parametrize("density", [0.001, 0.02, 0.5])
def test_windowed_gather_matches_on_random_sparse_masks(image, density):
    """Random masks so the box is not a shape someone drew on purpose.

    Exact equality, not ``approx``: a windowed gather that visits the same
    pixels in the same order cannot round differently, so anything but ``==``
    here would be hiding a real difference.
    """
    h, w = image.shape
    rng = np.random.default_rng(20260904)
    for _ in range(40):
        mask = rng.random((h, w)) < density
        assert _fields(mt_measure.region_stats(image, mask)) == _fields(
            _region_stats_reference(image, mask)
        )


def test_mask_bbox_is_the_box_np_nonzero_would_give(image):
    """``mask_bbox`` is the reduction ``vicinity_mask`` has used since
    2026-09-01, hoisted out so ``region_stats`` shares it. It must agree with
    ``np.nonzero`` — including the ``None`` for an empty mask, where ``argmax``
    on an all-False row reduction returns 0 and would otherwise read as a box at
    the origin."""
    h, w = image.shape
    for dtype in (bool, np.uint8):
        for name, mask in _edge_case_masks(h, w, dtype).items():
            ys, xs = np.nonzero(mask)
            want = (
                None
                if ys.size == 0
                else (int(ys.min()), int(ys.max()) + 1,
                      int(xs.min()), int(xs.max()) + 1)
            )
            assert mt_measure.mask_bbox(mask) == want, "%s (%s)" % (name, dtype)


def test_mask_bbox_refuses_a_non_2d_mask():
    """``region_stats`` falls back to the whole-frame gather for anything that
    is not a 2-D mask matching the image, so a shape mismatch still raises where
    it always did instead of silently measuring a crop."""
    with pytest.raises(ValueError):
        mt_measure.mask_bbox(np.ones(9, dtype=bool))


def test_shape_mismatch_still_raises_rather_than_measuring_a_crop():
    image = np.zeros((10, 10), dtype=np.float64)
    with pytest.raises(IndexError):
        mt_measure.region_stats(image, np.ones((12, 12), dtype=bool))


@pytest.mark.parametrize("shape", [(0, 8), (8, 0), (0, 0)])
def test_degenerate_shapes_answer_nothing_set_rather_than_raising(shape):
    """A zero-HEIGHT mask makes the row reduction empty, and ``argmax`` on an
    empty sequence raises. Both callers used to answer "nothing set" for it —
    ``region_stats`` with n=0, ``vicinity_mask`` with an empty ring — so the
    shared helper has to keep answering that."""
    mask = np.zeros(shape, dtype=bool)
    image = np.zeros(shape, dtype=np.float64)
    assert mt_measure.mask_bbox(mask) is None
    assert _fields(mt_measure.region_stats(image, mask)) == _fields(
        _region_stats_reference(image, mask)
    )
    assert mt_measure.region_stats(image, mask).n == 0
    # And the ring builder, which is the other caller of the same reduction.
    ring = mt_measure.vicinity_mask(
        np.zeros(shape, dtype=np.uint8), np.ones(shape, dtype=bool), 3
    )
    assert ring.shape == shape and not ring.any()
