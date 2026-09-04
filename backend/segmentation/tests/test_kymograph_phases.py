"""Motion/pause segmentation of a kymograph trajectory.

Requested 2026-09-04: export each trajectory cut at its motion<->pause
transitions, one row per segment, so a pause is a row in its own right and a
processive run is a row in its own right.

The rule already existed inside ``_segment_runs``, but only its DIRECTED output
was kept and the pauses between runs were dropped. ``segment_phases`` is now the
one rule and ``_segment_runs`` filters it, so the exported segments and the
shipped processive totals cannot disagree about where a run starts.
"""
import numpy as np
import pytest

from api.kymograph_velocity import (
    MIN_RUN_FRAMES,
    _segment_runs,
    segment_phases,
)


def _trajectory(spans):
    """Build a trajectory from (n_frames, velocity) spans."""
    x = [0.0]
    for n, v in spans:
        for _ in range(n):
            x.append(x[-1] + v)
    return np.arange(len(x), dtype=float), np.asarray(x, dtype=float)


class TestSegmentPhases:
    def test_cuts_at_every_motion_pause_transition(self):
        t, x = _trajectory([(30, 0.8), (30, 0.0), (35, -0.6), (25, 0.0)])
        phases = segment_phases(t, x, 0.1)

        assert [p["direction"] for p in phases] == [1, 0, -1, 0]
        # The fitted velocities recover the truth; the smoothing (sigma 2.5)
        # bleeds a little across each transition, which is why this is not exact.
        assert phases[0]["v_pxframe"] == pytest.approx(0.8, abs=0.1)
        assert phases[2]["v_pxframe"] == pytest.approx(-0.6, abs=0.1)
        assert phases[1]["v_pxframe"] == pytest.approx(0.0, abs=0.05)

    def test_the_phases_tile_the_trajectory(self):
        # Every frame belongs to exactly one phase: no gaps, no overlaps, and
        # the first and last frame of the trajectory are covered. Without this
        # a pause could silently vanish from the export, which is the very
        # thing the old run-only output did.
        t, x = _trajectory([(20, 0.7), (15, 0.0), (25, 0.5), (10, 0.0)])
        phases = segment_phases(t, x, 0.1)

        assert phases[0]["t0"] == int(t[0])
        assert phases[-1]["t1"] == int(t[-1])
        for prev, nxt in zip(phases, phases[1:]):
            assert nxt["t0"] == prev["t1"] + 1

    def test_a_reversal_ends_a_phase(self):
        # Direction reverses without pausing. That is a change of motion, so it
        # must be two phases and not one averaged to nearly zero.
        t, x = _trajectory([(25, 0.8), (25, -0.8)])
        phases = segment_phases(t, x, 0.1)

        directed = [p for p in phases if p["direction"] != 0]
        assert len(directed) == 2
        assert directed[0]["v_pxframe"] > 0
        assert directed[1]["v_pxframe"] < 0

    def test_a_single_frame_flicker_is_absorbed_into_the_pause(self):
        # A directed stretch shorter than MIN_RUN_FRAMES is not motion. The old
        # code dropped it, which left a hole in the timeline; it is now absorbed
        # into the surrounding pause, so the tiling stays complete.
        #
        # "Shorter" is measured on the SMOOTHED velocity, not on the raw
        # displacement, and the smoother has sigma 2.5 frames — so it widens a
        # step considerably. Measured: a 2-frame jump of 0.9 px/frame comes out
        # as SEVEN frames above threshold and is therefore a legitimate run,
        # while a 1-frame jump stays under the limit at every amplitude tried
        # (0.2, 0.4, 0.9). Do not "strengthen" this to a longer flicker
        # expecting it to be absorbed; it will not be.
        for amplitude in (0.2, 0.4, 0.9):
            t, x = _trajectory([(30, 0.0), (1, amplitude), (30, 0.0)])
            phases = segment_phases(t, x, 0.1)

            assert [p["direction"] for p in phases] == [0], amplitude
            assert phases[0]["t0"] == int(t[0])
            assert phases[0]["t1"] == int(t[-1])

    def test_displacement_is_the_distance_covered_in_the_phase(self):
        t, x = _trajectory([(40, 0.5)])
        phase = segment_phases(t, x, 0.1)[0]
        assert phase["displacement_px"] == pytest.approx(
            abs(phase["v_pxframe"]) * (phase["t1"] - phase["t0"])
        )
        assert phase["displacement_px"] == pytest.approx(20.0, abs=2.0)


class TestRunsStayTheDirectedSubset:
    """`_segment_runs` feeds a shipped metric, so it must not have moved."""

    @pytest.mark.parametrize("seed", range(25))
    def test_runs_are_exactly_the_directed_phases(self, seed):
        rng = np.random.default_rng(seed)
        n = int(rng.integers(40, 300))
        t = np.arange(n, dtype=float)
        x = np.zeros(n)
        v = 0.0
        for k in range(1, n):
            if rng.random() < 0.06:
                v = float(rng.choice([0.0, 0.0, rng.uniform(-1.2, 1.2)]))
            x[k] = x[k - 1] + v + rng.normal(0, 0.25)
        thresh = float(rng.uniform(0.02, 0.4))

        runs = _segment_runs(t, x, thresh)
        directed = [
            p for p in segment_phases(t, x, thresh) if p["direction"] != 0
        ]
        assert [(r["t0"], r["t1"]) for r in runs] == [
            (p["t0"], p["t1"]) for p in directed
        ]
        for r, p in zip(runs, directed):
            assert r["v_pxframe"] == pytest.approx(p["v_pxframe"])
