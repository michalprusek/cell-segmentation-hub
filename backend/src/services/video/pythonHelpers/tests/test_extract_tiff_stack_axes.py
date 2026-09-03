"""Every branch of `_load_and_resolve`'s axis chain must produce a usable T,C,H,W.

The chain is easy to break in a way no linter and no type checker will notice.
Its branches bind names inconsistently -- some unpack all four of T/C/H/W from
`arr.shape`, some bind only what they need -- and everything downstream then
RE-DERIVES `T, C, H, W = arr.shape` before use. All except `C`, which is read
earlier, to reconcile `raw_channel_labels`.

So `T`/`H`/`W` in a branch are genuinely dead, `C` is load-bearing, and the two
look identical. Removing the wrong one is a `NameError` on a real upload of that
one TIFF layout, and only that layout -- exactly the shape of bug that reaches
production because the other four branches still pass.

That is not hypothetical: it happened while clearing the `py/unused-local-variable`
alerts on 2026-08-27, and this file is what caught it. Mutation-checked -- dropping
`C = 1` from a branch turns that branch red and leaves the rest green.
"""
import sys
from pathlib import Path

import numpy as np
import pytest

tifffile = pytest.importorskip("tifffile")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extract_tiff_stack import _load_and_resolve  # noqa: E402


def _write(tmp_path: Path, name: str, arr: np.ndarray, **kw) -> Path:
    p = tmp_path / name
    tifffile.imwrite(str(p), arr, photometric="minisblack", **kw)
    return p


@pytest.mark.parametrize(
    "name,shape,meta,expected",
    [
        # explicit axes metadata
        ("tcyx.tif", (5, 2, 16, 20), {"axes": "TCYX"}, (5, 2, 16, 20)),
        ("tyx.tif", (7, 16, 20), {"axes": "TYX"}, (7, 1, 16, 20)),
        ("cyx.tif", (3, 16, 20), {"axes": "CYX"}, (1, 3, 16, 20)),
        # no metadata: leading axis > 1 and trailing axis not 3/4 -> time heuristic
        ("heuristic.tif", (6, 16, 20), None, (6, 1, 16, 20)),
        # a plain 2-D image that arrived through the stack path
        ("single.tif", (16, 20), None, (1, 1, 16, 20)),
    ],
)
def test_axis_branch_resolves_to_tcyx(tmp_path, name, shape, meta, expected):
    rng = np.random.default_rng(0)
    arr = rng.integers(0, 4096, shape, dtype=np.uint16)
    kw = {"metadata": meta} if meta else {}
    src = _write(tmp_path, name, arr, **kw)

    out, _ = _load_and_resolve(src)

    assert out.shape == expected, f"{name}: got {out.shape}, expected {expected}"
    assert out.ndim == 4, "downstream code indexes arr as (T, C, H, W)"


@pytest.mark.parametrize(
    "name,shape,meta,expected_channels",
    [
        ("tcyx.tif", (5, 2, 16, 20), {"axes": "TCYX"}, 2),
        ("cyx.tif", (3, 16, 20), {"axes": "CYX"}, 3),
        ("heuristic.tif", (6, 16, 20), None, 1),
        ("single.tif", (16, 20), None, 1),
    ],
)
def test_channel_count_survives_every_branch(
    tmp_path, name, shape, meta, expected_channels
):
    """`C` is the one name read before the re-derivation, via raw_channel_labels.

    A branch that forgets to bind it raises NameError; a branch that binds it
    wrongly silently mislabels the channels, which is worse. Assert the count
    that actually reaches the caller.
    """
    rng = np.random.default_rng(1)
    arr = rng.integers(0, 4096, shape, dtype=np.uint16)
    kw = {"metadata": meta} if meta else {}
    src = _write(tmp_path, name, arr, **kw)

    out, info = _load_and_resolve(src)

    assert out.shape[1] == expected_channels
    channels = info["channels"]
    assert len(channels) == expected_channels, (
        f"{name}: {len(channels)} channel labels for {expected_channels} channels"
    )


# ─────────────────────────────────────────────────────────────────────
# Channel identity comes from metadata only, never from a file name
# (2026-09-03). These go through `_load_and_resolve` — i.e. through the
# real tifffile round-trip — because the guard's second signal is the
# SOURCE FILE'S OWN STEM, and a unit test that calls the resolver with a
# hand-written `source_stem=` proves the helper works while proving
# nothing about whether anything passes it.
# ─────────────────────────────────────────────────────────────────────


def _channel_names(meta: dict) -> list[str]:
    return [c["displayName"] for c in meta["channels"]]


def test_labels_repeating_the_files_own_name_do_not_become_channel_names(
    tmp_path,
):
    """An ImageJ-registered stack whose per-slice labels are the file's own
    name with a per-channel suffix. They are distinct, so the last-resort
    branch accepts them — and then `IRM` in the file name types channel 1
    `irm` and `561` gives channel 2 an emission wavelength, both invented
    out of a string the user typed into a Save dialog.

    Mutation check: drop `source_stem=Path(src).stem` from the
    `_resolve_channel_names` call in `_load_and_resolve` and both names
    come back as the file name."""
    stem = "20260803_Ch1_IRM_taxol_561"
    src = _write(
        tmp_path,
        f"{stem}.tif",
        np.zeros((2, 2, 8, 8), dtype=np.uint16),
        imagej=True,
        metadata={
            "axes": "TCYX",
            "Labels": [
                f"{stem}_w1",
                f"{stem}_w2",
                f"{stem}_w1",
                f"{stem}_w2",
            ],
        },
    )
    _arr, meta = _load_and_resolve(src)
    assert _channel_names(meta) == ["Channel 1", "Channel 2"]
    assert [c["wavelengthNm"] for c in meta["channels"]] == [None, None]


def test_a_genuine_per_channel_label_still_names_the_channel(tmp_path):
    """The other direction, on the same path: real metadata names survive
    and still carry their wavelength. Without this the test above is also
    satisfied by a guard that throws every label away."""
    src = _write(
        tmp_path,
        "IRM_488_stack.tif",
        np.zeros((2, 2, 8, 8), dtype=np.uint16),
        imagej=True,
        metadata={
            "axes": "TCYX",
            "Labels": ["WD_LED_IRM", "TIRF_491", "WD_LED_IRM", "TIRF_491"],
        },
    )
    _arr, meta = _load_and_resolve(src)
    assert _channel_names(meta) == ["WD_LED_IRM", "TIRF_491"]
    assert [c["wavelengthNm"] for c in meta["channels"]] == [None, 491]


def test_bioformats_export_of_another_file_never_names_a_channel(tmp_path):
    """The production case: the embedded name belongs to a DIFFERENT file —
    the ND2 this TIFF was exported from — so comparing against the file
    being read cannot catch it. The acquisition extension is what does.

    Mutation check: remove `.nd2` from `_ACQUISITION_EXT_RE` and channel 1
    is named after the ND2 and typed `irm`."""
    src = _write(
        tmp_path,
        "export.tif",
        np.zeros((2, 2, 8, 8), dtype=np.uint16),
        imagej=True,
        metadata={
            "axes": "TCYX",
            "Labels": [
                "c:1/2 t:1/2 - 20260522_Ch3_HMDS_IRM_60x_GDP-MTs.nd2 (series 1)",
                "c:2/2 t:1/2 - 20260522_Ch3_HMDS_IRM_60x_GDP-MTs.nd2 (series 2)",
                "c:1/2 t:2/2 - 20260522_Ch3_HMDS_IRM_60x_GDP-MTs.nd2 (series 1)",
                "c:2/2 t:2/2 - 20260522_Ch3_HMDS_IRM_60x_GDP-MTs.nd2 (series 2)",
            ],
        },
    )
    _arr, meta = _load_and_resolve(src)
    assert _channel_names(meta) == ["c1", "c2"]
    assert [c["wavelengthNm"] for c in meta["channels"]] == [None, None]
