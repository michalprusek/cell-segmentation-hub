"""The web app's Disintegration Index equals the paper's, to 1e-9.

`backend/segmentation/api/disintegration_metrics.py` is a verbatim port of the
paper's released `spheroid_seg/compute_di.py`. The fixtures in
`fixtures/di_parity/` were produced by running THAT file (in the paper
repository, see the README there) on five synthetic 3-class masks; this suite
recomputes every field with the hub's port and requires agreement to 1e-9.

It lives here, beside `backend/segmentation/`, and not in
`backend/segmentation/tests/unit`, because that tree's conftest imports torch
and `api.main` at module scope and so runs in no CI job; this directory is
collected by `make test-py` (and CI). The module under test needs only
numpy / scipy / scikit-image, which `backend/requirements-pytest-ci.txt`
already installs.
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

_SEG = Path(__file__).resolve().parents[1] / "segmentation"
_FIX = Path(__file__).resolve().parent / "fixtures" / "di_parity"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


dm = _load("_hub_disintegration_metrics", _SEG / "api" / "disintegration_metrics.py")
EXPECTED = json.loads((_FIX / "expected.json").read_text())
MASKS = dict(np.load(_FIX / "masks.npz"))
TOL = EXPECTED["tolerance"]


def _close(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, float) and math.isnan(a):
        return isinstance(b, float) and math.isnan(b)
    return abs(float(a) - float(b)) <= TOL


def test_port_was_copied_from_the_file_the_fixtures_came_from():
    # A re-copied port with stale fixtures (or the reverse) must fail here,
    # not pass by comparing against numbers from another version.
    assert dm.ALGORITHM_SOURCE_SHA256 == EXPECTED["source_sha256"]


def test_fixture_covers_defined_undefined_and_every_flag():
    defined = [k for k, v in EXPECTED["expected"].items() if v["metrics"] is not None]
    undefined = [k for k, v in EXPECTED["expected"].items() if v["metrics"] is None]
    assert len(defined) >= 3 and len(undefined) >= 2
    flags = {f: {EXPECTED["expected"][k]["metrics"][f] for k in defined}
             for f in ("core_fragmented", "unvalidated_regime", "below_validated_regime")}
    # each flag is exercised both ways, so a flag stuck at 0 or 1 cannot pass
    assert all(v == {0, 1} for v in flags.values()), flags


@pytest.mark.parametrize("name", sorted(EXPECTED["expected"]))
def test_disintegration_index_matches_compute_di(name):
    exp = EXPECTED["expected"][name]
    got = dm.disintegration_index(MASKS[name])
    assert dm.undefined_reason(MASKS[name]) == exp["undefined_reason"]
    if exp["metrics"] is None:
        assert got is None
        return
    assert got is not None
    assert set(exp["metrics"]) <= set(got)
    bad = {k: (got[k], v) for k, v in exp["metrics"].items() if not _close(got[k], v)}
    assert not bad, bad


@pytest.mark.parametrize("name", sorted(EXPECTED["expected"]))
def test_raster_metrics_wrapper_preserves_every_value(name):
    """The JSON wrapper the app stores must not round or re-derive anything."""
    exp = EXPECTED["expected"][name]
    m = MASKS[name]
    r = dm.raster_metrics(m)
    assert r["algorithm_sha256"] == EXPECTED["source_sha256"]
    assert r["area_total_px"] == exp["area_total_px"]
    assert r["area_core_px"] == exp["area_core_px"]
    assert r["n_core_components"] == exp["core_components"][0]
    assert _close(r["largest_core_component_frac"], exp["core_components"][1])
    assert _close(r["core_centroid_shift"], exp["core_components"][2])
    if exp["metrics"] is None:
        assert r["reference"] in ("none", "no_core", "core_too_small")
        assert r["note"] == exp["undefined_reason"]
        assert r["DI"] is None and r["index_B"] is None and r["reach_p90"] is None
        return
    assert r["reference"] == "core"
    for k, v in exp["metrics"].items():
        assert _close(r[k], v), (k, r[k], v)
    # JSON-serialisable exactly as stored (no NaN tokens)
    json.dumps(r, allow_nan=False)


def test_undefined_reference_names():
    assert dm.raster_metrics(MASKS["no_core"])["reference"] == "no_core"
    assert dm.raster_metrics(MASKS["core_too_small"])["reference"] == "core_too_small"
    assert dm.raster_metrics(np.zeros((64, 64), np.uint8))["reference"] == "none"


# ---- the documented reading of W1 --------------------------------------------

# docs/reference/metrics.md and the export README read W1 as the mean
# core-normalised distance less 2/3, "up to pixel discretisation". With a corona
# every quantile lies above the disk's and the absolute value never acts; on an
# intact spheroid the mask is the core and d~ straddles sqrt(u) at pixel scale.
_W1_MEAN_FORM_TOL = {"dispersed": 1e-6, "fragmented_core": 1e-6, "intact": 1e-3}


def test_w1_reading_is_checked_on_every_defined_fixture():
    defined = {k for k, v in EXPECTED["expected"].items() if v["metrics"] is not None}
    assert set(_W1_MEAN_FORM_TOL) == defined


@pytest.mark.parametrize("name", sorted(_W1_MEAN_FORM_TOL))
def test_w1_is_the_mean_distance_less_two_thirds(name):
    m = MASKS[name]
    cy, cx = np.nonzero(m == 2)
    fy, fx = np.nonzero(m > 0)
    d = np.hypot(fx - cx.mean(), fy - cy.mean()) / np.sqrt((m == 2).sum() / np.pi)
    w1 = dm.disintegration_index(m)["W1"]
    assert abs(w1 - (d.mean() - 2 / 3)) <= _W1_MEAN_FORM_TOL[name]


# ---- input-scale warning -----------------------------------------------------

def test_validated_frame_and_scale_give_no_warning():
    assert dm.input_scale_warnings(2048, 2048, 1.28) == []
    assert dm.input_scale_warnings(2048, 2048, None) == []
    assert dm.input_scale_warnings(2048, 2048, 1.28 * 1.09) == []


def test_other_frame_size_warns():
    w = dm.input_scale_warnings(1024, 1024, None)
    assert len(w) == 1 and "1024x1024" in w[0] and "2048x2048" in w[0]


def test_other_pixel_size_warns():
    w = dm.input_scale_warnings(2048, 2048, 0.65)
    assert len(w) == 1 and "0.65" in w[0]


def test_both_depart_gives_two_warnings():
    assert len(dm.input_scale_warnings(1600, 1200, 2.56)) == 2


def test_raster_metrics_carries_the_frame_warning():
    r = dm.raster_metrics(MASKS["intact"])   # a 640 x 640 fixture
    assert len(r["warnings"]) == 1 and "640x640" in r["warnings"][0]
