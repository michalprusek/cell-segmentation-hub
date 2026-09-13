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
#
# The stub is in `sys.modules` only while THIS module's tests run. It used to be
# installed at import, and pytest imports every test module of a run before it
# runs any test, so for the whole run `models` was an empty package with no
# path and `models.neurite_metrics` this stub: a real `models.*` import in any
# other suite would have failed. Where the real `models` was already imported,
# `setdefault` handed back THAT package and the next line emptied its
# `__path__`.
import contextlib  # noqa: E402
import types  # noqa: E402

_stub = types.ModuleType('models.neurite_metrics')
_stub.analyse_frame = analyse_mod.analyse_frame
_stub.NeuriteMetricsResult = analyse_mod.NeuriteMetricsResult


@contextlib.contextmanager
def _models_stub_installed():
    """Resolve `models.neurite_metrics` to `_stub`; undo it all on exit."""
    with pytest.MonkeyPatch.context() as mp:
        if 'models' not in sys.modules:
            package = types.ModuleType('models')
            package.__path__ = []  # a package, so the submodule import resolves
            mp.setitem(sys.modules, 'models', package)
        mp.setitem(sys.modules, 'models.neurite_metrics', _stub)
        mp.setattr(sys.modules['models'], 'neurite_metrics', _stub, raising=False)
        yield


@pytest.fixture(autouse=True, scope='module')
def _models_stub():
    with _models_stub_installed():
        yield


def test_the_models_stub_is_withdrawn_after_use():
    with pytest.MonkeyPatch.context() as mp:
        # Start from a run that has no `models` at all, as CI's does; the outer
        # context puts back whatever the autouse fixture had installed.
        mp.delitem(sys.modules, 'models.neurite_metrics', raising=False)
        mp.delitem(sys.modules, 'models', raising=False)
        with _models_stub_installed():
            assert sys.modules['models.neurite_metrics'] is _stub
        assert 'models.neurite_metrics' not in sys.modules
        assert 'models' not in sys.modules


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


# ---------------------------------------------------------------------------
#  Which soma owns each DRAWN polygon
# ---------------------------------------------------------------------------


class TestPolygonOwnership:
    """The mapping the editor colours by.

    The pipeline assigns per skeleton BRANCH, and a branch is not a polygon:
    one drawn component hosts several primary neurites, and a neurite bridging
    two cells has branches owned by both. There is no exact per-polygon answer,
    so this reports the majority owner and says when it is a simplification.

    Every fixture below is ASYMMETRIC on purpose. A symmetric two-soma bridge
    cannot tell "majority owner" from "first owner seen", and a fixture with no
    gap and no orphan cannot tell the guards from their absence — five
    mutations survived the first version of this class for exactly those
    reasons.
    """

    @staticmethod
    def _frame():
        """Two somas, a short private stub on each, and an OFF-CENTRE bridge.

        The bridge polygon runs 60..140 but soma A sits at 10..30 and soma B at
        170..190, so the cut lands nearer B and soma A owns the larger share.
        That asymmetry is what makes "majority" a different answer from "the
        first one encountered".
        """
        semantic = np.zeros((80, 240), np.uint8)
        soma_inst = np.zeros((80, 240), np.int32)
        neurite_labels = np.zeros((80, 240), np.int32)

        soma_inst[30:50, 10:30] = 1
        soma_inst[30:50, 210:230] = 2
        semantic[soma_inst > 0] = 2

        neurite_labels[38:42, 30:50] = 1       # A's own process
        neurite_labels[38:42, 190:210] = 2     # B's own process
        neurite_labels[38:42, 50:190] = 3      # the bridge
        semantic[neurite_labels > 0] = 1
        return semantic, soma_inst, neurite_labels

    @staticmethod
    def _run(semantic, soma_inst, neurite_labels):
        return analyse_mod.analyse_frame(
            semantic,
            0.18,
            classify=False,
            soma_instances=soma_inst,
            neurite_labels=neurite_labels,
        )

    def test_a_private_process_is_owned_outright(self):
        res = self._run(*self._frame())
        owner = res.polygon_owner
        assert owner[1]['soma_id'] == 1
        assert owner[1]['shared'] is False
        assert owner[1]['owned_fraction'] == 1.0
        assert owner[2]['soma_id'] == 2
        assert owner[2]['shared'] is False

    def test_a_private_process_is_credited_its_real_length(self):
        # An actual number, not just a fraction. Handing every polygon a
        # branch's FULL length instead of its share scales the fractions
        # identically and is invisible to any ratio assertion.
        res = self._run(*self._frame())
        # 20 px of drawn stub at 0.18 um/px, plus the skeleton reaching the
        # soma rim. Bounded rather than pinned: skeletonisation decides the
        # exact endpoint, but it cannot double the length.
        assert 2.0 < res.polygon_owner[1]['length_um'] < 8.0

    def test_the_bridge_is_shared_and_goes_to_the_MAJORITY_owner(self):
        # The bridge is cut at the arc-length midpoint between the two somas,
        # and the somas are not equidistant from its ends — so one side really
        # does own more of it, and "whichever was seen first" is a different
        # answer.
        semantic, soma_inst, neurite_labels = self._frame()
        res = self._run(semantic, soma_inst, neurite_labels)
        bridge = res.polygon_owner[3]

        assert bridge['shared'] is True
        assert 0.5 <= bridge['owned_fraction'] < 1.0, (
            'the reported owner does not hold a majority of the polygon, so it '
            'was picked by encounter order rather than by length'
        )
        by_soma_lengths = bridge['length_um']
        assert by_soma_lengths > 0

    def test_an_orphan_polygon_is_absent_rather_than_owned(self):
        # A process no soma reaches. Its branches have owner None, and letting
        # them through would either crash or invent an owner; either way the
        # editor would colour a polygon no assignment backs.
        semantic, soma_inst, neurite_labels = self._frame()
        neurite_labels[8:12, 60:120] = 9   # a full bar, well clear of both somas
        semantic[8:12, 60:120] = 1
        res = self._run(semantic, soma_inst, neurite_labels)
        assert 9 not in res.polygon_owner

    def test_a_branch_covering_no_labelled_polygon_credits_nobody(self):
        """A branch whose whole path lies outside every labelled polygon.

        `semantic` and `neurite_labels` are independent arguments, so a caller
        can hand in a mask carrying neurite the labelling does not cover — the
        route does not do that today, but a bridge edge spanning a gap is the
        same shape of input and the guard is what stops `length / 0`.

        Reachable and tested rather than assumed: the fixture below labels only
        the LEFT stub, so the right one is neurite in the mask and nothing in
        the labelling.
        """
        semantic, soma_inst, neurite_labels = self._frame()
        # A second process on soma A, running DOWNWARD so it touches no other
        # labelled polygon — present in the mask, absent from the labelling.
        # Clearing an ADJACENT polygon's label is not enough: its branch path
        # still reaches into the neighbour and `hit` comes back non-empty.
        semantic[50:75, 18:22] = 1

        res = self._run(semantic, soma_inst, neurite_labels)

        # No crash from `length / 0`, the unlabelled process is credited to
        # nobody, and the labelled polygons are still attributed normally.
        assert set(res.polygon_owner) == {1, 2, 3}
        assert res.polygon_owner[1]['soma_id'] == 1

    def test_ownership_is_absent_unless_labels_are_supplied(self):
        # Sampling every branch path costs real time on a 44 Mpx frame, and an
        # export that only wants the tables should not pay for it.
        semantic, soma_inst, _ = self._frame()
        res = analyse_mod.analyse_frame(
            semantic, 0.18, classify=False, soma_instances=soma_inst
        )
        assert res.polygon_owner == {}

    def test_the_route_maps_ownership_back_to_polygon_ids(self):
        # The route rasterises neurites WITH labels for this alone; filling
        # them binary again leaves every branch in polygon 1 and the editor
        # colours the whole frame as one cell.
        req = Request(
            frame='f',
            width=240,
            height=80,
            um_per_px=0.18,
            soma_polygons=[
                Poly(polygon_id='soma_left', points=[[10, 30], [30, 30], [30, 50], [10, 50]]),
                Poly(polygon_id='soma_right', points=[[210, 30], [230, 30], [230, 50], [210, 50]]),
            ],
            neurite_polygons=[
                Poly(polygon_id='stub_left', points=[[30, 38], [50, 38], [50, 42], [30, 42]]),
                Poly(polygon_id='stub_right', points=[[190, 38], [210, 38], [210, 42], [190, 42]]),
            ],
            classify=False,
        )
        resp = route._compute(req)

        # BOTH, unconditionally. Guarding the comparison on
        # `len(...) == 2` made it vacuous: an unlabelled raster puts every
        # neurite pixel in label 1, so only ONE polygon id comes back and the
        # guard skipped the very assertion that would have caught it.
        assert set(resp.neurite_owners) == {'stub_left', 'stub_right'}, (
            'a neurite polygon lost its identity — the raster is not labelled '
            'per polygon, so every branch reports as the first one'
        )
        assert (
            resp.neurite_owners['stub_left']['soma_polygon_id']
            != resp.neurite_owners['stub_right']['soma_polygon_id']
        )


# ---------------------------------------------------------------------------
# Soma attachment: the vendored `attach_somas`, VENDOR EDIT (5 of 5).
#
# These four tests are here rather than in the research package because the
# edit is ours. They are the reason it exists and the guard on it: the first
# two pin the bug and its fix, the last two pin the price of the fix.
# ---------------------------------------------------------------------------

sg_mod = _load('_neurite_skeleton_graph', _VENDOR / 'skeleton_graph.py')
assign_mod = _load('_neurite_assign', _VENDOR / 'assign.py')

UM_PER_PX = 0.65  # production scale; `attach_radius` 1.5 um is 2.31 px here


def _disc(mask_shape, cy, cx, r):
    yy, xx = np.mgrid[0:mask_shape[0], 0:mask_shape[1]]
    return (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


def _capsule(mask_shape, p0, direction, length, half):
    """A rod with hemispherical ends, so the skeleton endpoint and its local
    half-width are the same for EVERY direction — which is what lets the
    direction test below vary the angle and nothing else."""
    yy, xx = np.mgrid[0:mask_shape[0], 0:mask_shape[1]]
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    v = np.stack([yy - p0[0], xx - p0[1]], -1)
    t = np.clip((v @ d) / length, 0.0, 1.0)
    foot = np.stack([p0[0] + t * d[0] * length, p0[1] + t * d[1] * length], -1)
    return ((np.stack([yy, xx], -1) - foot) ** 2).sum(-1) <= half * half


class TestSomaAttachment:
    """`attach_radius` was measured from the wrong place."""

    def _thick_neurite_beside_a_soma(self):
        """A soma and an 8-px-thick neurite drawn ONE pixel apart.

        That one pixel is not a drawing mistake and cannot be drawn away: the
        semantic mask gives soma priority on overlap, so the two masks are
        never adjacent. The skeleton is the medial axis, so its endpoint sits
        ~4 px inside the neurite — nine-ish pixels from the soma, against a
        2.31 px budget.
        """
        shape = (120, 200)
        soma = np.zeros(shape, np.int32)
        soma[40:80, 20:80] = 1
        neurite = np.zeros(shape, bool)
        neurite[56:64, 82:170] = True          # x=81 is background: the seam
        return soma, neurite

    def test_a_neurite_drawn_against_a_soma_attaches(self):
        # `D_gap=0` switches the gap-bridging rule OFF, so this isolates the
        # CONTACT rule. Without that the test is vacuous: at this thickness the
        # uncorrected distance still lands inside D_gap, so gap-bridging
        # rescues the attachment and the test passes with the inset correction
        # deleted. Measured — the mutation survived until this line was added.
        soma, neurite = self._thick_neurite_beside_a_soma()
        g, _ = sg_mod.build(neurite, UM_PER_PX)
        att = assign_mod.attach_somas(
            g, soma, assign_mod.Params(D_gap=0.0), neurite_mask=neurite
        )
        assert att, (
            'a neurite touching its cell was not attached — `attach_radius` is '
            'being measured from the skeleton, which the medial axis places one '
            'local half-width inside the filament'
        )
        assert set(att.values()) == {1}

    def test_without_a_mask_the_original_radius_rule_is_unchanged(self):
        """The other half of the same fixture, and the reason it discriminates.

        Omitting `neurite_mask` must reproduce the pre-2026-09-09 behaviour
        exactly — including failing on the frame above. A test that only
        asserted the fix would pass just as well against a version that
        attached everything to everything.
        """
        soma, neurite = self._thick_neurite_beside_a_soma()
        g, _ = sg_mod.build(neurite, UM_PER_PX)
        att = assign_mod.attach_somas(g, soma, assign_mod.Params(D_gap=0.0))
        assert att == {}, (
            'the mask-less path is meant to be the original rule verbatim; it '
            'now attaches something the original could not reach'
        )

    def test_the_rasterisation_seam_is_allowed_for(self):
        """The +1 px the two masks can never close.

        `semantic` gives soma priority where the polygons overlap, so a neurite
        drawn ONTO its cell still comes back as two masks with at least one
        pixel of background between them. That pixel is not a real distance and
        the contact rule adds it back.

        This fixture is a knife edge on purpose — it is the only shape of test
        that can pin a one-pixel term. The neurite sits so its skeleton
        endpoint is 6 px from the soma with a 3 px half-width, i.e.
        `d - inset` is exactly 3.00, which is above `attach_radius` (2.31 px
        here) and below it plus the seam (3.31). Nothing here is floating-point
        marginal: every number is an exact integer distance on a synthetic
        raster. Drop the seam term and this is the test that goes red.
        """
        shape = (120, 200)
        soma = np.zeros(shape, np.int32)
        soma[40:80, 20:80] = 1
        neurite = np.zeros(shape, bool)
        neurite[56:64, 83:170] = True
        g, _ = sg_mod.build(neurite, UM_PER_PX)
        att = assign_mod.attach_somas(
            g, soma, assign_mod.Params(D_gap=0.0), neurite_mask=neurite
        )
        assert att, (
            'the one-pixel rasterisation seam is being charged as real '
            'distance, so a neurite drawn onto its cell falls just outside '
            'attach_radius'
        )

    def test_a_gap_is_crossed_only_when_the_neurite_points_at_the_soma(self):
        """Same distance, same thickness — only the direction differs.

        The capsule's end cap is a disc centred on a fixed point, so the
        skeleton endpoint and its local half-width are identical for both
        arms; the ONLY thing that changes is the outward tangent. Without this
        gate a thick neurite merely passing a foreign cell would be adopted by
        it.
        """
        shape = (400, 400)
        centre, radius, half = (200.0, 200.0), 40.0, 3.0
        soma = _disc(shape, *centre, radius).astype(np.int32)
        end = np.array([centre[0], centre[1] + radius + 4.0 + half])
        results = {}
        for name, theta in (('towards', 20.0), ('across', 80.0)):
            rad = np.deg2rad(theta)
            outward = np.array([0.0, 1.0])       # +x, i.e. away from the soma
            rot = np.array([[np.cos(rad), -np.sin(rad)],
                            [np.sin(rad), np.cos(rad)]])
            body = _capsule(shape, end, rot @ outward, 80.0, half)
            neurite = body & (soma == 0)
            g, _ = sg_mod.build(neurite, UM_PER_PX)
            results[name] = assign_mod.attach_somas(
                g, soma, assign_mod.Params(), neurite_mask=neurite
            )
        assert results['towards'], 'a neurite aimed at the cell was refused'
        assert not results['across'], (
            'a neurite running PAST the cell was adopted by it — the direction '
            'gate is not firing, so `theta_gap` is decorative'
        )

    def test_a_gap_wider_than_D_gap_is_refused_even_pointing_straight_at_it(self):
        """Direction is necessary, not sufficient. `D_gap` (3 um) still bounds
        how much missing segmentation may be bridged, exactly as it bounds a
        neurite-to-neurite gap in `add_bridges`."""
        shape = (400, 400)
        centre, radius, half = (200.0, 200.0), 40.0, 3.0
        soma = _disc(shape, *centre, radius).astype(np.int32)
        # 7 px, not 12: at 12 the soma falls outside the search window
        # altogether and the WINDOW refuses it, not the bound — deleting the
        # bound then changes nothing and the test is vacuous. Measured; the
        # mutation survived at 12. At 7 the soma is inside the window (reach
        # ~10.9 px, distance 10) and only `D_gap` stands between them.
        far = np.array([centre[0], centre[1] + radius + 7.0 + half])
        body = _capsule(shape, far, np.array([0.0, 1.0]), 80.0, half)
        neurite = body & (soma == 0)
        g, _ = sg_mod.build(neurite, UM_PER_PX)
        att = assign_mod.attach_somas(
            g, soma, assign_mod.Params(), neurite_mask=neurite
        )
        assert att == {}, (
            'a 7 px break was bridged; D_gap is 3 um = 4.6 px at this scale, '
            'so the distance bound has stopped working'
        )


# ═══════════════════════════════════════════════════════════════════════════
# add_bridges: the fast path must be BIT-IDENTICAL to the loops it replaced
# ═══════════════════════════════════════════════════════════════════════════
#
# `add_bridges` was the single biggest cost in `pipeline.analyse` (49 % of it,
# measured 2026-09-11 at 16 Mpx) and it grew super-linearly: two all-pairs loops
# over every leaf, plus a full-frame `(soma_inst == lab).sum()` per soma. On a
# 16 Mpx field that is 1 400 301 leaf pairs of which 530 are within `D_gap`, and
# 169 whole-frame scans.
#
# Speeding that up is only allowed if the ANSWER does not move: which endpoints
# get bridged decides which neurite belongs to which cell, and a bridge that
# appears or vanishes moves length between two cells' rows in the export. So the
# reference implementation lives here, and the test asserts equality of the
# bridges AND of the QC counters — not "close", equal.


def _add_bridges_reference(g, soma_inst, att, p, image=None):
    """The pre-2026-09-11 implementation, verbatim apart from the import path.

    Kept as a test fixture rather than deleted, exactly as `rasterize_band`'s
    scalar form is: the vectorised code is harder to read, and the only way to
    keep it honest is to be able to run the thing it replaced.
    """
    np_ = np
    A = assign_mod
    qc = dict(bridge_end_to_end=0, bridge_pass_over=0, attachments_removed=0)
    leaves = [n for n in g.nodes if g.degree(n) == 1]
    cos_gap = np_.cos(np_.deg2rad(p.theta_gap))
    cos_pass = np_.cos(np_.deg2rad(p.theta_pass))
    maxd = p.D_gap / g.um_per_px

    def tan_of(n):
        return A.tangent(g, n, g.incident[n][0], p.tangent_fit_len)

    cand = []
    by_soma: dict[int, list[int]] = {}
    for n in leaves:
        if n in att:
            by_soma.setdefault(att[n], []).append(n)
    for lab, ns in by_soma.items():
        area = float((soma_inst == lab).sum())
        diam = 2.0 * np_.sqrt(area / np_.pi)
        for i, a in enumerate(ns):
            ta = tan_of(a)
            for b in ns[i + 1:]:
                d = g.nodes[b] - g.nodes[a]
                L = float(np_.linalg.norm(d))
                if L < 1e-6 or L > 1.2 * diam:
                    continue
                u = d / L
                tb = tan_of(b)
                if not (np_.dot(-ta, u) > cos_pass and np_.dot(-tb, -u) > cos_pass):
                    continue
                if A._straightness(ta, tb) < cos_pass:
                    continue
                cand.append((-A._straightness(ta, tb), L, a, b, 'pass'))

    for i, a in enumerate(leaves):
        ta, ca = tan_of(a), g.nodes[a]
        for b in leaves[i + 1:]:
            if att.get(a) is not None and att.get(a) == att.get(b):
                continue
            d = g.nodes[b] - ca
            L = float(np_.linalg.norm(d))
            if L < 1e-6 or L > maxd:
                continue
            u = d / L
            tb = tan_of(b)
            if not (np_.dot(-ta, u) > cos_gap and np_.dot(-tb, -u) > cos_gap):
                continue
            if att.get(a) is not None and att.get(b) is not None:
                continue
            cand.append((L / maxd, L, a, b, 'gap'))
    return cand


def _synth_field(side: int, seed: int):
    """Somas with radiating processes, broken by gaps the bridger should close."""
    rng = np.random.default_rng(seed)
    sem = np.zeros((side, side), np.uint8)
    step = 110
    for cy in range(step // 2, side - 10, step):
        for cx in range(step // 2, side - 10, step):
            yy, xx = np.ogrid[:side, :side]
            r = 12
            sem[(yy - cy) ** 2 + (xx - cx) ** 2 <= r * r] = 2
            for k in range(4):
                ang = 2 * np.pi * k / 4 + rng.random()
                gap_at = rng.integers(20, 40)
                for t in range(r, r + 55):
                    # a real break in the mask, which is what a bridge spans
                    if gap_at <= t < gap_at + 4:
                        continue
                    y = int(cy + t * np.sin(ang))
                    x = int(cx + t * np.cos(ang))
                    if 0 <= y < side - 1 and 0 <= x < side - 1:
                        sem[y:y + 2, x:x + 2] = np.maximum(sem[y:y + 2, x:x + 2], 1)
    return sem


@pytest.mark.parametrize('side,seed', [(240, s) for s in range(12)] + [(360, s) for s in range(8)] + [(420, s) for s in range(5)] + [(150, s) for s in range(5)])
def test_add_bridges_matches_the_reference_exactly(side, seed):
    si_mod = _load('_neurite_soma_instances', _VENDOR / 'soma_instances.py')
    sem = _synth_field(side, seed)
    inst = si_mod.s1_dt_hmaxima(sem == 2, 0.18, 3.0)
    g, _ = sg_mod.build(sem == 1, 0.18)
    p = assign_mod.Params()
    att = assign_mod.attach_somas(g, inst, p)

    # The reference only builds the candidate list; comparing THAT is stricter
    # than comparing the chosen bridges, because selection is a deterministic
    # `sort()` over it — an equal list cannot select differently.
    import copy
    ref = _add_bridges_reference(copy.deepcopy(g), inst, dict(att), p)

    g2 = copy.deepcopy(g)
    before = set(g2.branches)
    assign_mod.add_bridges(g2, inst, dict(att), p)
    made = [g2.branches[b] for b in g2.branches if b not in before]

    # Replay the reference's own selection so the two are compared like for like.
    ref.sort()
    used: set[int] = set()
    expected = []
    for _, L, a, b, kind in ref:
        if a in used or b in used:
            continue
        used.update((a, b))
        expected.append((a, b, round(L * g.um_per_px, 9)))

    assert [(br.u, br.v, round(br.length_um, 9)) for br in made] == expected


def _pass_over_field():
    """TWO somas, the larger one with a process running straight across it.

    The type-3 "passing over" case, which 30 randomised fields never produced —
    so the soma-area bincount, which gates only that branch, was undefended.

    Two somas, not one, and the small one FIRST. The gate is one-sided
    (`L > 1.2 * diam` only rejects), so reading the wrong label's area can only
    be caught when the wrong area is SMALLER. With a single soma the mutation
    reaches `_areas[0]`, the background — 65 479 px, a diameter of 289 px, and
    the gate still passes. Here soma 1 is 1 009 px against soma 2's 2 121, so
    the mutated gate is 1.2 x 35.8 = 43.0 px against a 52 px chord and the
    pass-over vanishes.
    """
    side = 260
    sem = np.zeros((side, side), np.uint8)
    yy, xx = np.ogrid[:side, :side]
    # r = 18 is the smallest disc that survives S1 instancing here as its own
    # label; 10 and 14 are both swallowed (measured).
    sem[(yy - 45) ** 2 + (xx - 45) ** 2 <= 18 * 18] = 2
    cy, cx, r = 160, 150, 26
    sem[(yy - cy) ** 2 + (xx - cx) ** 2 <= r * r] = 2
    for x in range(60, side - 15):
        if abs(x - cx) <= r:
            continue                      # the process is broken by the soma
        sem[cy - 1:cy + 1, x:x + 1] = 1
    return sem


def _near_radius_field():
    """Two collinear tips separated by very nearly D_gap, so a radius shrunk by
    one pixel changes the answer."""
    side = 160
    sem = np.zeros((side, side), np.uint8)
    y = side // 2
    # D_gap 3.0 um / 0.18 um/px = 16.667 px. The skeleton tips end up 16.000 px
    # apart here, which is inside (maxd - 1, maxd] — the only band where a
    # search radius short by one pixel changes the answer. Measured, not
    # guessed: 14 px of hole gives 15.000 and 16 px gives 17.000, and neither
    # would have killed that mutation.
    sem[y - 1:y + 1, 20:70] = 1
    sem[y - 1:y + 1, 85:135] = 1
    return sem


@pytest.mark.parametrize('field', ['pass_over', 'near_radius'])
def test_add_bridges_matches_the_reference_on_hand_built_geometry(field):
    si_mod = _load('_neurite_soma_instances', _VENDOR / 'soma_instances.py')
    sem = _pass_over_field() if field == 'pass_over' else _near_radius_field()
    inst = si_mod.s1_dt_hmaxima(sem == 2, 0.18, 3.0)
    g, _ = sg_mod.build(sem == 1, 0.18)
    p = assign_mod.Params()
    att = assign_mod.attach_somas(g, inst, p)

    import copy
    ref = _add_bridges_reference(copy.deepcopy(g), inst, dict(att), p)
    ref.sort()

    g2 = copy.deepcopy(g)
    before = set(g2.branches)
    assign_mod.add_bridges(g2, inst, dict(att), p)
    made = [g2.branches[b] for b in g2.branches if b not in before]

    used: set[int] = set()
    expected = []
    for _, L, a, b, kind in ref:
        if a in used or b in used:
            continue
        used.update((a, b))
        expected.append((a, b, round(L * g.um_per_px, 9)))

    # The fixture must actually REACH the branch it defends, or it defends
    # nothing — the whole reason these two exist.
    assert expected, f'{field}: fixture produced no bridge at all'
    assert [(br.u, br.v, round(br.length_um, 9)) for br in made] == expected
