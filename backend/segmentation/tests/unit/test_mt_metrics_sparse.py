"""Regression tests for sparse-channel handling in /api/v1/mt-metrics.

A microscope does not have to image every channel on every timepoint: a common
microtubule setup refreshes the label-free IRM reference every N-th frame while
recording fluorescence continuously, and NIS-Elements/Metamorph write the
un-acquired planes as a constant fill (see
``backend/src/services/video/pythonHelpers/plane_coverage.py``). PR #377 taught
the READ path to forward-fill those frames; it did NOT touch the original file,
which this endpoint samples. So without the ``sparse_fill`` map the export
measures the fill.

Measured on the real production container
``20260526_Well7_002_DIV4_WT_x2512-100x.tif`` (29 frames x 3 channels, 1024^2;
``Channel_1``/``Channel_2`` exposed only on frame 0, ``Channel_3`` on all 29),
which is exactly the fixture built below in miniature:

* before — the gap frames reported mean 0.00, median 0, background 0 and
  ``signal_minus_background`` 0 for ``Channel_1``: not a repeat, a blank;
* the channel total's mean read 420.77 against a true 12202.42, because the 28
  empty planes went into the divisor;
* after — the gap frames carry frame 0's numbers with ``source_frame_index=0``,
  the total covers the one exposed plane, and ``Channel_3`` is untouched
  throughout.

pytest is not installed in the ML runtime container; the module-level
``importorskip`` makes this a no-op there and runnable in the GPU one-off image.
"""
import asyncio

import numpy as np
import pytest

# Skips the whole file if the ML web deps (fastapi/pydantic) are unavailable.
mt = pytest.importorskip("api.mt_metrics")
tifffile = pytest.importorskip("tifffile")

# One straight line, thick enough that band and vicinity ring are both non-empty.
LINE = [[8.0, 20.0], [56.0, 20.0]]
FRAMES = 4
HEIGHT = WIDTH = 64
#: ``Channel_1`` is exposed on frame 0 only; every later frame is the fill.
SPARSE_GAPS = {"1": 0, "2": 0, "3": 0}


@pytest.fixture
def sparse_tiff(tmp_path, monkeypatch):
    """A 2-channel stack shaped like a real sparse acquisition.

    Channel 0 carries structure on frame 0 and an EXACT constant afterwards —
    the criterion ``plane_coverage.is_blank_plane`` uses, and the thing a real
    file does. Channel 1 carries a different, frame-varying exposure throughout.
    """
    rng = np.random.default_rng(7)
    vol = np.zeros((FRAMES, 2, HEIGHT, WIDTH), dtype=np.uint16)
    vol[0, 0] = rng.integers(4000, 6000, (HEIGHT, WIDTH), dtype=np.uint16)
    for t in range(FRAMES):
        vol[t, 1] = rng.integers(100 + 10 * t, 140 + 10 * t,
                                 (HEIGHT, WIDTH), dtype=np.uint16)
    # Frames 1..3 of channel 0 stay all-zero: the constant fill.
    assert vol[1, 0].min() == vol[1, 0].max()

    path = tmp_path / "original.tif"
    # ``metadata={"axes": ...}`` is what makes tifffile report TCYX; without it
    # the series axes come back as 'QQYX' and `_normalize_axes_tiff` rejects the
    # file, so the fixture would never reach the code under test.
    tifffile.imwrite(str(path), vol, metadata={"axes": "TCYX"})
    # ``_safe_path`` gates every read on the storage root, which is resolved at
    # import time from UPLOAD_DIR.
    monkeypatch.setattr(mt, "_UPLOAD_ROOT", tmp_path.resolve())
    return path


def _request(path, sparse_fill=None):
    body = {
        "original_path": str(path),
        "file_kind": "tiff",
        "channel_indices": [0, 1],
        "channel_names": ["IRM", "TIRF"],
        "frames": [
            {
                "image_id": f"frame-{t}",
                "frame_index": t,
                "polylines": [
                    {
                        "image_id": f"frame-{t}",
                        "instance_id": "mt_0",
                        "track_id": "track_0",
                        "points": LINE,
                    }
                ],
            }
            for t in range(FRAMES)
        ],
        "thickness_px": 5,
        "margin_multiplier": 2.0,
    }
    if sparse_fill is not None:
        body["sparse_fill"] = sparse_fill
    return mt.MTMetricsRequest(**body)


def _run(req):
    return asyncio.run(mt.mt_metrics(req))


def _by(resp, channel):
    return {r.frame_index: r for r in resp.rows if r.channel == channel}


def _summary(resp, channel):
    return next(s for s in resp.channel_summaries if s.channel == channel)


def test_without_the_map_a_gap_frame_measures_the_constant_fill(sparse_tiff):
    """The bug, pinned: today's request shape reports the fill as signal."""
    irm = _by(_run(_request(sparse_tiff)), "IRM")
    assert irm[0].mean_intensity > 1000
    for t in (1, 2, 3):
        assert irm[t].mean_intensity == 0.0
        assert irm[t].sum_intensity == 0.0
        # And every row claims to be its own frame's observation.
        assert irm[t].source_frame_index == t


def test_gap_frames_read_the_anchor_plane_and_say_so(sparse_tiff):
    irm = _by(_run(_request(sparse_tiff, {"IRM": SPARSE_GAPS})), "IRM")
    anchor = irm[0]
    assert anchor.source_frame_index == 0
    for t in (1, 2, 3):
        assert irm[t].source_frame_index == 0
        # The numbers ARE the anchor's — same plane, same geometry.
        assert irm[t].mean_intensity == anchor.mean_intensity
        assert irm[t].median_intensity == anchor.median_intensity
        assert irm[t].sum_intensity == anchor.sum_intensity
        assert irm[t].median_background == anchor.median_background
        # Geometry is the frame's own and never propagated.
        assert irm[t].length_px == anchor.length_px


def test_the_dense_channel_beside_it_is_untouched(sparse_tiff):
    """The regression that would matter most: a channel that is not sparse must
    come out of the sparse-aware path byte-for-byte as it does today."""
    before = _run(_request(sparse_tiff))
    after = _run(_request(sparse_tiff, {"IRM": SPARSE_GAPS}))
    b, a = _by(before, "TIRF"), _by(after, "TIRF")
    for t in range(FRAMES):
        assert a[t].model_dump() == b[t].model_dump()
        assert a[t].source_frame_index == t
    assert _summary(after, "TIRF") == _summary(before, "TIRF")


def test_a_dense_container_is_a_no_op(sparse_tiff):
    """An empty map must not change a single number, in either channel."""
    plain = _run(_request(sparse_tiff))
    empty = _run(_request(sparse_tiff, {}))
    assert empty.model_dump() == plain.model_dump()


def test_channel_totals_exclude_the_un_acquired_planes(sparse_tiff):
    without = _summary(_run(_request(sparse_tiff)), "IRM")
    with_map = _summary(
        _run(_request(sparse_tiff, {"IRM": SPARSE_GAPS})), "IRM"
    )
    # The fill contributes no signal, so the sum is unchanged...
    assert with_map.total_intensity == without.total_intensity
    # ...but it does contribute pixels, which is what wrecked the mean.
    assert without.frames == FRAMES
    assert with_map.frames == 1
    assert with_map.pixel_count == HEIGHT * WIDTH
    assert with_map.mean_intensity == pytest.approx(
        without.mean_intensity * FRAMES
    )


@pytest.mark.parametrize(
    "bad_map",
    [
        {"IRM": {"1": 99}},          # anchor past the end of the file
        {"IRM": {"99": 0}},          # gap past the end of the file
        {"IRM": {"1": -1}},          # negative anchor
        {"IRM": {"nope": 0}},        # non-integer key
        {"OTHER": {"1": 0}},         # a channel that is not being sampled
    ],
)
def test_unusable_entries_fall_back_to_the_frames_own_plane(sparse_tiff, bad_map):
    """Reading SOME OTHER frame would be wrong and look like data. Reading the
    frame's own plane is wrong and visible, which is the safer failure."""
    irm = _by(_run(_request(sparse_tiff, bad_map)), "IRM")
    for t in range(FRAMES):
        assert irm[t].source_frame_index == t


def test_an_anchor_that_is_itself_a_gap_is_refused(sparse_tiff):
    """A chained map would have frame 2 measure frame 1's constant fill and
    stamp it ``source_frame_index=1`` — a blank presented as a genuine
    measurement of another frame, the one outcome worse than measuring the
    blank in place. The extractor cannot emit this, but this is the last
    validator between a stored ``channels`` JSON and a published number."""
    resp = _run(_request(sparse_tiff, {"IRM": {"2": 1, "1": 0}}))
    irm = _by(resp, "IRM")
    assert irm[1].source_frame_index == 0  # the usable link survives
    assert irm[2].source_frame_index == 2  # the chained one falls back
    # ...and the totals still see a plane, rather than dividing by zero.
    assert _summary(resp, "IRM").frames == FRAMES - 1


def test_a_frame_standing_in_for_itself_is_not_a_gap(sparse_tiff):
    irm = _by(_run(_request(sparse_tiff, {"IRM": {"2": 2}})), "IRM")
    assert irm[2].source_frame_index == 2
    assert _summary(_run(_request(sparse_tiff, {"IRM": {"2": 2}})),
                    "IRM").frames == FRAMES
