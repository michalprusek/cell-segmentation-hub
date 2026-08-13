"""Unit tests for ``normalize_to_tcyx`` in ``extract_nd2.py``.

The ND2 frame extractor used to handle only ``TCYX/CYX/YX/TYX``. A position
(``P``) axis from well-plate / multipoint acquisitions made the array 5-D and
crashed the transpose, so the upload failed with ``extraction_failed`` and an
orphaned container (this hit a real user's WellE03-E07 / WellD05 uploads).
``normalize_to_tcyx`` now squeezes singleton loop axes (a length-1 ``P`` from
per-field NIS exports), max-projects ``Z``, inserts a missing ``T``/``C``, and
*rejects* a genuine multi-position file (``P`` > 1) with a user-facing message
instead of silently exporting only one position.

These cases pin that contract: a refactor of the squeeze / insert / transpose
order would otherwise silently corrupt frame extraction for whole classes of
ND2 files with no compile-time signal.

Pure function over numpy arrays — ``nd2`` is lazy-imported inside ``main()`` so
it is not needed here, and there is no pytest dependency, so this runs in the
backend container with a plain interpreter:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_extract_nd2_normalize.py

It is also collectable by pytest (``python3 -m pytest .../tests/``) where the
``test_*`` functions are discovered normally.
"""
from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from extract_nd2 import (  # noqa: E402
    _extract_workers,
    _position_interval_ms,
    _write_frames,
    normalize_to_tcyx,
    position_axis,
    select_position,
    UnsupportedND2,
)


def _mk(shape):
    return np.arange(int(np.prod(shape)), dtype=np.uint16).reshape(shape)


def _expect_unsupported(axes, shape):
    try:
        normalize_to_tcyx(_mk(shape), axes)
    except UnsupportedND2:
        return
    raise AssertionError(
        f"expected UnsupportedND2 for axes={axes!r} shape={shape}"
    )


def test_canonical_passthrough():
    assert normalize_to_tcyx(_mk((2, 2, 4, 5)), "TCYX").shape == (2, 2, 4, 5)


def test_singleton_position_squeezed():
    # The regression: per-field NIS exports carry a length-1 P axis.
    assert normalize_to_tcyx(_mk((1, 2, 3, 4, 5)), "PTCYX").shape == (2, 3, 4, 5)
    assert normalize_to_tcyx(_mk((2, 1, 2, 4, 5)), "TPCYX").shape == (2, 2, 4, 5)
    assert normalize_to_tcyx(_mk((1, 3, 4, 5)), "PCYX").shape == (1, 3, 4, 5)


def test_missing_dims_inserted():
    assert normalize_to_tcyx(_mk((3, 4, 5)), "CYX").shape == (1, 3, 4, 5)
    assert normalize_to_tcyx(_mk((4, 5)), "YX").shape == (1, 1, 4, 5)
    assert normalize_to_tcyx(_mk((2, 4, 5)), "TYX").shape == (2, 1, 4, 5)


def test_z_is_max_projected_not_first_slice():
    # TZCYX, Z=3; the brightest pixel is only on the last Z slice.
    arr = np.zeros((1, 3, 1, 2, 2), dtype=np.uint16)
    arr[0, 2, 0] = 9
    out = normalize_to_tcyx(arr, "TZCYX")
    assert out.shape == (1, 1, 2, 2)
    assert out.max() == 9  # max projection, not arr[:, 0]


def test_singleton_z_squeezed():
    assert normalize_to_tcyx(_mk((2, 1, 2, 4, 5)), "TZCYX").shape == (2, 2, 4, 5)


def test_multiposition_rejected_by_normalize():
    # normalize_to_tcyx is the single-position normalizer; an unsplit P>1
    # array is a programming error and must still be rejected (callers split
    # with select_position first).
    _expect_unsupported("PTCYX", (3, 2, 4, 5))
    _expect_unsupported("PCYX", (4, 3, 4, 5))


def test_position_axis_detection():
    assert position_axis("PTCYX") == "P"
    assert position_axis("TCYX") is None
    assert position_axis("SCYX") == "S"  # series/scene fallback
    assert position_axis("TPCYX") == "P"  # P preferred over a later axis


def test_select_position_slices_p_axis():
    # PTCYX, P=3 → each selection drops P and yields a TCYX single position.
    arr = _mk((3, 2, 4, 5, 6))  # P T C Y X
    sub, sub_axes = select_position(arr, "PTCYX", 1)
    assert sub_axes == "TCYX"
    assert sub.shape == (2, 4, 5, 6)
    # The slice must equal direct numpy indexing on the P axis.
    assert np.array_equal(sub, arr[1])
    # And normalizing the slice gives canonical TCYX unchanged.
    assert normalize_to_tcyx(sub, sub_axes).shape == (2, 4, 5, 6)


def test_select_position_snapshot_no_time_axis():
    # WellD03 shape: PCYX (no T) → each position is a single multi-channel
    # frame; normalize then inserts the missing T as length-1.
    arr = _mk((3, 2, 8, 8))  # P C Y X
    sub, sub_axes = select_position(arr, "PCYX", 2)
    assert sub_axes == "CYX"
    assert sub.shape == (2, 8, 8)
    assert normalize_to_tcyx(sub, sub_axes).shape == (1, 2, 8, 8)


def test_select_position_p_in_middle():
    # TPCYX (T outer, P inner is a common NIS layout) — P is axis 1.
    arr = _mk((4, 3, 2, 5, 6))  # T P C Y X
    sub, sub_axes = select_position(arr, "TPCYX", 0)
    assert sub_axes == "TCYX"
    assert sub.shape == (4, 2, 5, 6)
    assert np.array_equal(sub, arr[:, 0])


def test_select_position_out_of_range_rejected():
    arr = _mk((3, 2, 4, 5))  # PCYX, P=3
    for bad in (-1, 3, 99):
        try:
            select_position(arr, "PCYX", bad)
        except UnsupportedND2:
            continue
        raise AssertionError(f"expected UnsupportedND2 for position {bad}")


def test_select_position_no_position_axis_rejected():
    arr = _mk((2, 3, 4, 5))  # TCYX — nothing to select
    try:
        select_position(arr, "TCYX", 0)
    except UnsupportedND2:
        return
    raise AssertionError("expected UnsupportedND2 when no P/S axis present")


def test_position_interval_t_outer_vs_p_outer():
    # T=3, P=2. A position's frame interval must be recovered from ITS OWN
    # timestamps, picked out of the flat T*P event list by loop-nesting order.
    # A transposed index formula would silently mis-assign intervals.
    #
    # T-outer (time loop outermost): flat order t*P+p →
    #   [t0p0, t0p1, t1p0, t1p1, t2p0, t2p1]
    ts_t_outer = [0.0, 100.0, 1.0, 101.0, 2.0, 102.0]
    # position 0 frames at indices 0,2,4 → values 0,1,2 → 1000 ms median Δ
    assert _position_interval_ms(ts_t_outer, 0, 3, 2, True) == 1000.0
    # position 1 frames at indices 1,3,5 → values 100,101,102 → 1000 ms
    assert _position_interval_ms(ts_t_outer, 1, 3, 2, True) == 1000.0

    # P-outer (position loop outermost): flat order p*T+t →
    #   [p0t0, p0t1, p0t2, p1t0, p1t1, p1t2]
    ts_p_outer = [0.0, 1.0, 2.0, 50.0, 51.0, 52.0]
    assert _position_interval_ms(ts_p_outer, 0, 3, 2, False) == 1000.0
    assert _position_interval_ms(ts_p_outer, 1, 3, 2, False) == 1000.0


def test_position_interval_guards_return_none():
    # t_count < 2 → no interval to compute.
    assert _position_interval_ms([0.0, 1.0], 0, 1, 2, True) is None
    # time_outer unknown → refuse to guess the nesting.
    assert _position_interval_ms([0.0, 1.0], 0, 3, 2, None) is None
    # event count != T*P → partial/unexpected list, don't guess.
    assert _position_interval_ms([0.0, 1.0, 2.0], 0, 3, 2, True) is None


def test_missing_yx_rejected():
    _expect_unsupported("TC", (2, 3))


def test_axes_ndim_mismatch_rejected():
    # 3-D array described by a 4-char axes string.
    _expect_unsupported("TCYX", (2, 4, 5))


# ── streaming + parallel _write_frames (perf optimisation) ─────────────────
# The extractor streams frames one chunk at a time and encodes PNGs across a
# thread pool. These pin the load-bearing invariant: the optimisation must not
# change a single output byte vs a naive sequential write.

import hashlib  # noqa: E402
import tempfile  # noqa: E402
from pathlib import Path  # noqa: E402


def _seq_write(arr_tcyx, root, names):
    """Reference sequential writer matching the pre-optimisation behaviour."""
    from PIL import Image

    from extract_nd2 import _to_png_dtype

    T, C = arr_tcyx.shape[0], arr_tcyx.shape[1]
    for t in range(T):
        fd = root / f"{t:04d}"
        fd.mkdir(parents=True, exist_ok=True)
        for c in range(C):
            Image.fromarray(_to_png_dtype(np.asarray(arr_tcyx[t, c]))).save(
                fd / f"{names[c]}.png", format="PNG", optimize=True
            )


def _digest(root):
    h = hashlib.md5()
    for p in sorted(Path(root).rglob("*.png")):
        h.update(p.read_bytes())
    return h.hexdigest()


def test_write_frames_byte_identical_to_sequential():
    rng = np.random.RandomState(3)
    arr = (rng.rand(11, 2, 24, 32) * 4000 + 100).astype(np.uint16)  # T=11,C=2
    names = ["chA", "chB"]
    par = Path(tempfile.mkdtemp())
    seq = Path(tempfile.mkdtemp())
    _write_frames(arr, par, names)
    _seq_write(arr, seq, names)
    assert sorted(p.name for p in par.rglob("*.png")) == sorted(
        p.name for p in seq.rglob("*.png")
    )
    assert _digest(par) == _digest(seq), "parallel write changed the PNG bytes"


def test_write_frames_streams_dask_input_identically():
    # The single-position path now hands _write_frames a LAZY dask array; it must
    # produce the same bytes as the equivalent numpy array. Skip if dask absent.
    try:
        import dask.array as da
    except ImportError:
        return
    rng = np.random.RandomState(5)
    arr = (rng.rand(9, 1, 20, 20) * 5000).astype(np.uint16)
    darr = da.from_array(arr, chunks=(1, 1, 20, 20))
    a = Path(tempfile.mkdtemp())
    b = Path(tempfile.mkdtemp())
    _write_frames(darr, a, ["c0"])  # dask (streamed)
    _write_frames(arr, b, ["c0"])  # numpy
    assert _digest(a) == _digest(b)


def test_write_frames_single_frame_and_workers():
    # T=1 (the single-frame IRM case) must not divide-by-zero on worker sizing.
    arr = np.full((1, 1, 16, 16), 300, np.uint16)
    d = Path(tempfile.mkdtemp())
    _write_frames(arr, d, ["IRM"])
    assert (d / "0000" / "IRM.png").exists()
    assert _extract_workers() >= 1


def test_write_frames_registers_channels_to_first():
    # register=True aligns each channel to channel 0. Build a 2-channel frame
    # where channel 1 is channel 0 shifted by a known amount; registration must
    # undo it, report the offset, and still write both PNGs.
    from channel_registration import shift_frame

    rng = np.random.RandomState(0)
    ref = (rng.rand(96, 96) * 400).astype(np.uint16)
    for k in range(5):  # bright streaks give phase correlation edges to lock on
        ref[10 + k * 16, 8:88] = 9000
    ch1 = shift_frame(ref, 5, -3)
    arr = np.stack([np.stack([ref, ch1])])  # (T=1, C=2, Y, X)
    d = Path(tempfile.mkdtemp())
    offsets = _write_frames(arr, d, ["c0", "c1"], register=True)
    assert offsets[0][0] == [0, 0]  # reference never moves
    assert offsets[0][1] == [-5, 3]  # inverse of the injected shift
    assert (d / "0000" / "c0.png").exists()
    assert (d / "0000" / "c1.png").exists()


def test_write_frames_register_off_is_untouched():
    # register=False (default) must leave frames byte-for-byte raw — the
    # feature is strictly opt-in, no accidental shift for existing uploads.
    from PIL import Image

    ref = np.full((32, 32), 500, np.uint16)
    ref[10, 5:25] = 9000
    ch1 = np.full((32, 32), 500, np.uint16)
    ch1[10, 8:28] = 9000
    arr = np.stack([np.stack([ref, ch1])])
    d = Path(tempfile.mkdtemp())
    offsets = _write_frames(arr, d, ["c0", "c1"], register=False)
    assert offsets[0] == [[0, 0], [0, 0]]
    got = np.asarray(Image.open(d / "0000" / "c1.png"))
    assert np.array_equal(got, ch1)  # written unchanged


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
