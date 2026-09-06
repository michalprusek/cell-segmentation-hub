"""Neurite metrics: the parts that do NOT need a GPU.

This directory sits BESIDE `backend/segmentation/`, not inside it, because that
tree's `conftest.py` imports torch and `api.main` at module scope -- pytest
loads a parent conftest before any test in it, so a CPU-only suite nested there
could never be collected.

`backend/segmentation/tests` cannot run in CI at all -- collecting it imports
`models/__init__`, which reaches mamba_ssm -> Triton and raises "0 active
drivers" on a machine with no CUDA. Everything here is deliberately reachable
without that: the route module's own imports are light, `_compute` pulls the
pipeline lazily, and the vendored modules need only numpy / scipy / skimage,
all of which `backend/requirements-pytest-ci.txt` already installs for the
other suites.

So this file covers the code THIS repo wrote -- rasterisation, the polygon-id
mapping, the request guards -- plus the one contract that binds it to the
vendored pipeline. The pipeline's own 52 tests live in the research package and
are not duplicated here.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

_SEG = Path(__file__).resolve().parents[1] / 'segmentation'
_VENDOR = _SEG / 'models' / 'neurite_metrics'


def _load(name: str, path: Path):
    """Import a module by path, bypassing the heavy package __init__."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


sys.path.insert(0, str(_SEG))
analyse_mod = _load('_neurite_analyse', _VENDOR / 'analyse.py')

# `_compute` does `from models.neurite_metrics import analyse_frame` lazily. The
# real package would drag in `models/__init__`, which imports the torch model
# zoo (mamba_ssm -> Triton) and raises "0 active drivers" without a CUDA driver
# -- so a stub stands in, pointing at the module that was just loaded by path.
# Tests get the REAL pipeline by default (it needs no torch when classify is
# off) and monkeypatch this one attribute when they want a spy instead.
import types  # noqa: E402

_models_pkg = sys.modules.setdefault('models', types.ModuleType('models'))
_models_pkg.__path__ = []  # mark it a package so the submodule import resolves
_stub = types.ModuleType('models.neurite_metrics')
_stub.analyse_frame = analyse_mod.analyse_frame
_stub.NeuriteMetricsResult = analyse_mod.NeuriteMetricsResult
sys.modules['models.neurite_metrics'] = _stub
_models_pkg.neurite_metrics = _stub

route = _load('_neurite_route', _SEG / 'api' / 'neurite_metrics.py')

Poly = route.NeuritePolygonInput
Request = route.NeuriteMetricsRequest


def square(x0: int, y0: int, size: int) -> list[list[float]]:
    return [
        [x0, y0],
        [x0 + size, y0],
        [x0 + size, y0 + size],
        [x0, y0 + size],
    ]


# ---------------------------------------------------------------------------
#  Rasterisation
# ---------------------------------------------------------------------------


class TestRasterise:
    def test_labels_each_soma_separately(self):
        # One label per polygon is what makes a soma row joinable back to the
        # record the user edited.
        polys = [
            Poly(polygon_id='a', points=square(1, 1, 4)),
            Poly(polygon_id='b', points=square(10, 10, 4)),
        ]
        out = route._rasterise(polys, (20, 20), label_each=True)
        assert sorted(int(v) for v in np.unique(out)) == [0, 1, 2]
        assert out[3, 3] == 1
        assert out[12, 12] == 2

    def test_neurites_are_one_class_not_instances(self):
        # A neurite's identity comes from the skeleton graph, not the drawing:
        # one drawn component can host several primary neurites, and one
        # neurite can span two of them. Labelling per polygon would invent an
        # identity the pipeline then has to ignore.
        polys = [
            Poly(polygon_id='a', points=square(1, 1, 4)),
            Poly(polygon_id='b', points=square(10, 10, 4)),
        ]
        out = route._rasterise(polys, (20, 20), label_each=False)
        assert sorted(int(v) for v in np.unique(out)) == [0, 1]

    def test_holes_are_subtracted(self):
        poly = Poly(
            polygon_id='ring',
            points=square(2, 2, 12),
            holes=[square(6, 6, 4)],
        )
        out = route._rasterise([poly], (20, 20), label_each=True)
        assert out[3, 3] == 1
        assert out[8, 8] == 0

    def test_a_degenerate_polygon_is_skipped_not_fatal(self):
        # A two-point "polygon" is a drawing artefact. Failing the whole export
        # over one is worse than measuring the other few hundred.
        polys = [
            Poly(polygon_id='ok', points=square(1, 1, 4)),
            Poly(polygon_id='degenerate', points=[[0, 0], [1, 1]]),
        ]
        out = route._rasterise(polys, (20, 20), label_each=True)
        assert sorted(int(v) for v in np.unique(out)) == [0, 1]


# ---------------------------------------------------------------------------
#  soma_id -> polygon_id
# ---------------------------------------------------------------------------


class TestSomaPolygonIds:
    """The join that turns a table row back into something the editor can show.

    This is the mapping that was silently WRONG in the first version: the route
    built one label per polygon and then let `analyse_frame` re-derive its own
    with S1, so 149 polygons went in and rows keyed 1..168 came out. Both
    numberings looked well-formed and nothing failed.
    """

    def test_ids_follow_the_input_order(self, monkeypatch):
        captured = {}

        def fake_analyse(semantic, um_per_px, **kw):
            captured['inst'] = kw['soma_instances']
            return analyse_mod.NeuriteMetricsResult(neurites=[], somas=[], qc={})

        monkeypatch.setattr(_stub, 'analyse_frame', fake_analyse)
        req = Request(
            frame='f',
            width=30,
            height=30,
            um_per_px=0.18,
            soma_polygons=[
                Poly(polygon_id='soma_a', points=square(1, 1, 4)),
                Poly(polygon_id='soma_b', points=square(10, 10, 4)),
            ],
            neurite_polygons=[],
            classify=False,
        )
        resp = route._compute(req)
        assert resp.soma_polygon_ids == {1: 'soma_a', 2: 'soma_b'}
        # And the labelling really was handed to the pipeline, not re-derived.
        assert captured['inst'] is not None
        assert sorted(int(v) for v in np.unique(captured['inst'])) == [0, 1, 2]

    def test_a_skipped_polygon_does_not_shift_the_ids_after_it(self, monkeypatch):
        # `_rasterise` skips a degenerate ring, so its label never appears in
        # the array. Building the map from the request list alone would then
        # name every following soma one polygon too early.
        monkeypatch.setattr(
            _stub,
            'analyse_frame',
            lambda *a, **k: analyse_mod.NeuriteMetricsResult(
                neurites=[], somas=[], qc={}
            ),
        )
        req = Request(
            frame='f',
            width=30,
            height=30,
            um_per_px=0.18,
            soma_polygons=[
                Poly(polygon_id='first', points=square(1, 1, 4)),
                Poly(polygon_id='degenerate', points=[[0, 0], [1, 1]]),
                Poly(polygon_id='third', points=square(10, 10, 4)),
            ],
            neurite_polygons=[],
            classify=False,
        )
        resp = route._compute(req)
        assert resp.soma_polygon_ids == {1: 'first', 3: 'third'}
        assert 2 not in resp.soma_polygon_ids


# ---------------------------------------------------------------------------
#  Request guards
# ---------------------------------------------------------------------------


class TestGuards:
    def test_soma_wins_where_the_two_classes_overlap(self, monkeypatch):
        # A pixel drawn as both is a cell body with a process starting on it.
        # Counting it as neurite grows a skeleton spur into the soma.
        seen = {}

        def fake(semantic, um_per_px, **kw):
            seen['semantic'] = semantic
            return analyse_mod.NeuriteMetricsResult(neurites=[], somas=[], qc={})

        monkeypatch.setattr(_stub, 'analyse_frame', fake)
        req = Request(
            frame='f',
            width=20,
            height=20,
            um_per_px=0.18,
            soma_polygons=[Poly(polygon_id='s', points=square(2, 2, 8))],
            neurite_polygons=[Poly(polygon_id='n', points=square(2, 2, 8))],
            classify=False,
        )
        route._compute(req)
        assert seen['semantic'][5, 5] == 2

    def test_classify_without_an_image_is_refused(self):
        from fastapi import HTTPException

        req = Request(
            frame='f',
            width=20,
            height=20,
            um_per_px=0.18,
            soma_polygons=[Poly(polygon_id='s', points=square(2, 2, 8))],
            neurite_polygons=[],
            classify=True,
        )
        with pytest.raises(HTTPException) as exc:
            route._compute(req)
        assert exc.value.status_code == 400
        assert 'image_path' in exc.value.detail

    def test_a_path_outside_the_storage_root_is_refused(self):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            route._safe_path(Path('/etc/passwd'), 'image_path')
        assert exc.value.status_code == 400

    @pytest.mark.parametrize('um', [0, -1])
    def test_a_non_positive_pixel_size_is_refused(self, um):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            Request(
                frame='f',
                width=20,
                height=20,
                um_per_px=um,
                soma_polygons=[],
                neurite_polygons=[],
            )


# ---------------------------------------------------------------------------
#  analyse_frame's caller-labelling contract
# ---------------------------------------------------------------------------


class TestCallerLabelling:
    def test_a_supplied_labelling_is_used_verbatim(self):
        # Two touching squares: connected components (and S1) see the pair very
        # differently from a caller who has drawn them as two cells. The point
        # of the parameter is that the caller wins.
        semantic = np.zeros((40, 40), np.uint8)
        semantic[5:15, 5:25] = 2
        inst = np.zeros((40, 40), np.int32)
        inst[5:15, 5:15] = 1
        inst[5:15, 15:25] = 2

        res = analyse_mod.analyse_frame(
            semantic, 0.18, classify=False, soma_instances=inst
        )
        assert res.qc['soma_instancing'] == 'caller'
        assert res.qc['n_soma_instances'] == 2
        assert {r['soma_id'] for r in res.somas} == {1, 2}

    def test_without_one_it_falls_back_to_s1(self):
        semantic = np.zeros((40, 40), np.uint8)
        semantic[5:15, 5:25] = 2

        res = analyse_mod.analyse_frame(semantic, 0.18, classify=False)
        assert res.qc['soma_instancing'] == 's1'

    def test_a_mismatched_labelling_is_rejected(self):
        semantic = np.zeros((40, 40), np.uint8)
        with pytest.raises(ValueError, match='does not match'):
            analyse_mod.analyse_frame(
                semantic,
                0.18,
                classify=False,
                soma_instances=np.zeros((10, 10), np.int32),
            )

    def test_classify_without_an_image_is_rejected(self):
        with pytest.raises(ValueError, match='image is required'):
            analyse_mod.analyse_frame(
                np.zeros((10, 10), np.uint8), 0.18, classify=True
            )
