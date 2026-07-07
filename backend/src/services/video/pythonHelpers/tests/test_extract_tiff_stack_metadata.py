"""Regression tests for the TIFF metadata parsers in
``extract_tiff_stack.py``. These exercise pure helpers — no tifffile,
no PIL, no real TIFF on disk — by stubbing the ``tf`` object's
``ome_metadata`` / ``imagej_metadata`` attributes.

The 4-stage priority chain (OME Plane → OME TimeIncrement → ImageJ
Labels → ImageJ finterval/fps) is order-sensitive: a future refactor
that flips two branches would silently change every downstream
``frameIntervalMs`` value. The unit-normalisation maps are an equally
common drift target (the repo has shipped 1000× errors before by
flipping nm/µm — see memory ``project_video_bit_depth_preservation``).
These tests pin both invariants.

Run from repo root:
  python3 -m pytest backend/src/services/video/pythonHelpers/tests/ -v
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# Allow direct import without depending on backend/segmentation's heavy
# conftest (which pulls in torch / fastapi).
HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

# Stub tifffile so importing the module doesn't require it on the host.
sys.modules.setdefault("tifffile", MagicMock())

from extract_tiff_stack import (  # noqa: E402
    _all_distinct,
    _detect_frame_interval_ms,
    _imagej_label_to_seconds,
    _median_interval_ms,
    _metamorph_wave_names,
    _resolve_channel_names,
    _split_shared_label,
    _wavelength_from_name,
)


# ─────────────────────────────────────────────────────────────────────
# _imagej_label_to_seconds
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "label, expected",
    [
        ("t=0.5s", 0.5),
        ("T=2.0s", 2.0),
        ("t = 0.5", 0.5),
        ("Time=10", 10.0),
        ("time = 5 s", 5.0),
        ("0.5", 0.5),
        ("0.500", 0.5),
        ("1.0 m", 60.0),
        ("1 h", 3600.0),
        # Rejections — must return None so a misshaped Labels list
        # can't poison the median.
        ("Channel: DAPI", None),
        ("DAPI", None),
        ("z=2", None),
        ("", None),
        (None, None),
        (12345, None),  # non-string
    ],
)
def test_imagej_label_to_seconds(label, expected):
    assert _imagej_label_to_seconds(label) == expected


# ─────────────────────────────────────────────────────────────────────
# _median_interval_ms (the shared core)
# ─────────────────────────────────────────────────────────────────────


def test_median_interval_one_dropped_frame():
    # Five timestamps with one dropped → deltas 1, 1, 2.5, 1 → median 1 s.
    assert _median_interval_ms([0.0, 1.0, 2.0, 4.5, 5.5]) == pytest.approx(1000.0)


def test_median_interval_dedupes_multichannel_duplicates():
    # Three timepoints × two channels share DeltaT per T. With tifffile
    # float noise the duplicates serialise as near-equal values.
    timestamps = [0.0, 0.0 + 1e-9, 1.0, 1.0 + 2e-9, 2.0, 2.0 - 3e-9]
    assert _median_interval_ms(timestamps) == pytest.approx(1000.0)


def test_median_interval_returns_none_below_two_samples():
    assert _median_interval_ms([]) is None
    assert _median_interval_ms([1.0]) is None


def test_median_interval_handles_out_of_order():
    # Caller may pass any iteration order; helper must sort before diff.
    assert _median_interval_ms([2.0, 0.0, 1.0]) == pytest.approx(1000.0)


# ─────────────────────────────────────────────────────────────────────
# _detect_frame_interval_ms — 4-stage priority chain
# ─────────────────────────────────────────────────────────────────────


def _tf(ome: str | None = None, ij: dict | None = None):
    """Stub tifffile.TiffFile exposing only the metadata attrs used."""
    return SimpleNamespace(ome_metadata=ome, imagej_metadata=ij)


def test_ome_plane_delta_t_seconds_median():
    ome = """<OME>
<Plane DeltaT="0.0" DeltaTUnit="s"/>
<Plane DeltaT="1.0" DeltaTUnit="s"/>
<Plane DeltaT="2.0" DeltaTUnit="s"/>
<Plane DeltaT="4.5" DeltaTUnit="s"/>
<Plane DeltaT="5.5" DeltaTUnit="s"/>
</OME>"""
    # Deltas 1, 1, 2.5, 1 → median 1 s → 1000 ms.
    assert _detect_frame_interval_ms(_tf(ome=ome)) == pytest.approx(1000.0)


def test_ome_plane_unit_ms():
    ome = '<OME><Plane DeltaT="100" DeltaTUnit="ms"/><Plane DeltaT="200" DeltaTUnit="ms"/></OME>'
    # Two timestamps in ms → 0.1 s and 0.2 s → Δ 0.1 s → 100 ms.
    assert _detect_frame_interval_ms(_tf(ome=ome)) == pytest.approx(100.0)


def test_ome_plane_unit_minutes():
    ome = '<OME><Plane DeltaT="1" DeltaTUnit="min"/><Plane DeltaT="2" DeltaTUnit="min"/></OME>'
    assert _detect_frame_interval_ms(_tf(ome=ome)) == pytest.approx(60_000.0)


def test_ome_plane_unit_missing_defaults_to_seconds():
    ome = '<OME><Plane DeltaT="0.0"/><Plane DeltaT="0.5"/></OME>'
    assert _detect_frame_interval_ms(_tf(ome=ome)) == pytest.approx(500.0)


def test_ome_plane_unit_unknown_returns_none(capsys):
    # Explicit but unrecognised unit must NOT default to seconds —
    # consistent with pixel-size policy (unknown unit → return None).
    ome = '<OME><Plane DeltaT="0.5" DeltaTUnit="fortnights"/><Plane DeltaT="1.0" DeltaTUnit="fortnights"/></OME>'
    assert _detect_frame_interval_ms(_tf(ome=ome)) is None
    # Should at least leave a stderr trace so ops can spot the regression.
    captured = capsys.readouterr()
    assert "fortnights" in captured.err


def test_ome_time_increment_fallback_when_no_plane_delta_t():
    ome = '<OME><Image><Pixels TimeIncrement="0.5" TimeIncrementUnit="s"/></Image></OME>'
    assert _detect_frame_interval_ms(_tf(ome=ome)) == pytest.approx(500.0)


def test_ome_plane_priority_over_time_increment():
    # Both present — Plane DeltaT must win.
    ome = """<OME><Image><Pixels TimeIncrement="0.5" TimeIncrementUnit="s">
<Plane DeltaT="0.0" DeltaTUnit="s"/>
<Plane DeltaT="2.0" DeltaTUnit="s"/>
</Pixels></Image></OME>"""
    assert _detect_frame_interval_ms(_tf(ome=ome)) == pytest.approx(2000.0)


def test_imagej_labels_median():
    labels = ["t=0.0s", "t=0.5s", "t=1.0s", "t=1.5s"]
    assert _detect_frame_interval_ms(_tf(ij={"Labels": labels})) == pytest.approx(500.0)


def test_imagej_labels_interleaved_with_channels_is_rejected(capsys):
    # `["DAPI", "0.5", "GFP", "1.0"]` parses 2 timestamps with
    # density 0.5 — below 0.75 threshold; result is None, NOT a
    # confidently-wrong "0.5 s × channel_count" guess.
    labels = ["DAPI", "0.5", "GFP", "1.0"]
    assert _detect_frame_interval_ms(_tf(ij={"Labels": labels})) is None
    captured = capsys.readouterr()
    assert "density" in captured.err


def test_imagej_labels_non_monotonic_is_rejected():
    # All parse as time but not strictly increasing — refuse.
    labels = ["t=1.0s", "t=0.5s", "t=2.0s"]
    assert _detect_frame_interval_ms(_tf(ij={"Labels": labels})) is None


def test_imagej_finterval_seconds_per_frame():
    assert _detect_frame_interval_ms(_tf(ij={"finterval": 0.25})) == pytest.approx(250.0)


def test_imagej_fps_alternate_form():
    assert _detect_frame_interval_ms(_tf(ij={"fps": 10})) == pytest.approx(100.0)


def test_imagej_finterval_wins_over_fps():
    # finterval is the direct expression — prefer it when both are
    # carried, otherwise rounding 1/fps could clash.
    assert (
        _detect_frame_interval_ms(_tf(ij={"finterval": 0.5, "fps": 10}))
        == pytest.approx(500.0)
    )


def test_imagej_labels_priority_over_finterval():
    # Per-slice timestamps are stronger evidence than the declared
    # interval — prefer them when both are present.
    assert (
        _detect_frame_interval_ms(
            _tf(ij={"Labels": ["t=0s", "t=1s", "t=2s"], "finterval": 99.0})
        )
        == pytest.approx(1000.0)
    )


def test_ome_priority_over_imagej():
    # The full 4-stage chain: OME Plane > OME TimeIncrement > ImageJ.
    ome = '<OME><Plane DeltaT="0" DeltaTUnit="s"/><Plane DeltaT="3" DeltaTUnit="s"/></OME>'
    ij = {"Labels": ["t=0s", "t=99s"]}
    assert _detect_frame_interval_ms(_tf(ome=ome, ij=ij)) == pytest.approx(3000.0)


def test_malformed_ome_does_not_raise(capsys):
    # Garbage in must not crash — the function must return None and log.
    ome = '<OME><Plane DeltaT="not-a-number" DeltaTUnit="s"/></OME>'
    assert _detect_frame_interval_ms(_tf(ome=ome)) is None


def test_empty_metadata_returns_none():
    assert _detect_frame_interval_ms(_tf()) is None
    assert _detect_frame_interval_ms(_tf(ij={})) is None


# ─────────────────────────────────────────────────────────────────────
# Channel-name resolution — _wavelength_from_name / _split_shared_label /
# _metamorph_wave_names / _all_distinct / _resolve_channel_names.
# These feed wavelengthNm → isIrmChannel (channel typing + segmentation
# source). A regression silently reverts the "every channel looks the
# same" fix. See memory project_tiff_channel_naming_bug. Order-sensitive:
# _resolve_channel_names tries WaveNameN → shared-label split → distinct
# Labels → all-None; the priority test below pins that contract.
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name, expected",
    [
        ("TIRF_491", 491),
        ("w2-561", 561),
        ("GFP488", 488),
        ("Cy5_670", 670),
        ("491nm", 491),
        ("WD_LED_IRM", None),  # label-free, no wavelength token
        ("DAPI", None),
        ("IRM_500ms", None),  # exposure time — not an emission wavelength
        ("channel_1200", None),  # out of the 350–900 nm band
        ("ch_12", None),  # too few digits
        (None, None),
        (123, None),  # non-string
    ],
)
def test_wavelength_from_name(name, expected):
    assert _wavelength_from_name(name) == expected


@pytest.mark.parametrize(
    "names, expected",
    [
        (["a", "b"], True),
        (["a", "a"], False),  # duplicate
        (["a", None], False),  # None present
        (["a", ""], False),  # empty
        (["a", "  "], False),  # whitespace-only
        ([], False),
        (["only"], True),
    ],
)
def test_all_distinct(names, expected):
    assert _all_distinct(names) is expected


def test_split_shared_label_metamorph():
    labels = [
        "c:1/2 t:1/61 - WD_LED_IRM/TIRF_491",
        "c:2/2 t:1/61 - WD_LED_IRM/TIRF_491",
    ]
    assert _split_shared_label(labels, 2) == ["WD_LED_IRM", "TIRF_491"]


@pytest.mark.parametrize(
    "labels, count",
    [
        (["no dash separator here"], 1),  # no " - "
        (["a - one/two/three"], 2),  # wrong token count
        (["a - dup/dup"], 2),  # non-distinct tokens
        ([None], 1),  # not a string
        ([], 1),  # empty
    ],
)
def test_split_shared_label_rejects(labels, count):
    assert _split_shared_label(labels, count) is None


def test_metamorph_wave_names():
    info = 'WaveName1 = "WD_LED_IRM"\nWaveName2 = "TIRF_491"\n'
    assert _metamorph_wave_names(info, 2) == ["WD_LED_IRM", "TIRF_491"]


@pytest.mark.parametrize(
    "info, count",
    [
        ("", 2),  # empty
        ('WaveName1 = "A"\n', 2),  # missing WaveName2
        ('WaveName1 = "same"\nWaveName2 = "same"\n', 2),  # not distinct
    ],
)
def test_metamorph_wave_names_rejects(info, count):
    assert _metamorph_wave_names(info, count) is None


def test_resolve_channel_names_prefers_wavename_over_label():
    # Both a MetaMorph Info block AND a shared label are present; WaveNameN
    # must win (more reliable per-wavelength source). Pins the docstring's
    # "Order matters" contract — the thing a refactor is most likely to flip.
    tf = _tf(
        ij={
            "Info": 'WaveName1 = "IRM_A"\nWaveName2 = "FLUOR_B"\n',
            "Labels": [
                "c:1/2 - WD_LED_IRM/TIRF_491",
                "c:2/2 - WD_LED_IRM/TIRF_491",
            ],
        }
    )
    assert _resolve_channel_names(tf, 2) == ["IRM_A", "FLUOR_B"]


def test_resolve_channel_names_splits_shared_label():
    tf = _tf(
        ij={
            "Labels": [
                "c:1/2 t:1/61 - WD_LED_IRM/TIRF_491",
                "c:2/2 t:1/61 - WD_LED_IRM/TIRF_491",
            ]
        }
    )
    assert _resolve_channel_names(tf, 2) == ["WD_LED_IRM", "TIRF_491"]


def test_resolve_channel_names_identical_labels_fall_back_to_none():
    # ImageJ-registered stack: the only label is the filename, repeated per
    # channel → no distinct source → all-None so the caller uses "Channel N".
    tf = _tf(ij={"Labels": ["stack.tif", "stack.tif"]})
    assert _resolve_channel_names(tf, 2) == [None, None]


def test_resolve_channel_names_no_metadata():
    assert _resolve_channel_names(_tf(), 2) == [None, None]
