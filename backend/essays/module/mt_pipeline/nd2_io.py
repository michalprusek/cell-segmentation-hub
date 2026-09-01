"""Reading Nikon ND2 well recordings.

Each ND2 file is one well with several positions (fields of view) and three
channels (IRM, the 488-in-solution channel, and the TIRF 488 channel). This
module opens a file, locates channels **by name** (robust to channel-order
changes between acquisitions), reads the pixel calibration and the acquisition
timestamp, and yields one :class:`Position` per field of view.

The three channels have three distinct jobs, and conflating them was a real
defect: **IRM is what the v7 model segments**, TIRF carries the intensity that
gets measured along the resulting centerlines, and the in-solution channel gives
the well's concentration. Until 2026-08 this module never read IRM at all and
the pipeline segmented TIRF, which the model was never trained on.

Two per-position DIAGNOSTICS are measured here and nowhere else, because this is
the only place that holds the raw 16-bit frames with their channel roles already
resolved: the IRM<->TIRF offset (:func:`measure_alignment`) and the
out-of-focus verdict (:func:`judge_focus`). Neither changes a pixel, a row, or
an exit code.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, NamedTuple

import numpy as np
import nd2

_MODULE_ROOT = Path(__file__).resolve().parents[1]

# Julian Day Number of the Unix epoch (1970-01-01T00:00:00Z). ND2 stores the
# acquisition instant as a JD float, which is what makes it unambiguous.
_JD_UNIX_EPOCH = 2440587.5


#: Reported when the shared estimator could not be imported at all. A blank
#: quality would be indistinguishable from a measurement of zero.
REASON_UNAVAILABLE = "estimator_unavailable"

_UNSET = object()
_ESTIMATOR = _UNSET
#: Exception types already reported, so a systematic failure says so once per
#: run rather than never (it used to print nothing at all) or 180 times.
_REPORTED_ERRORS: set[str] = set()


@dataclass(frozen=True)
class ChannelAlignment:
    """How far TIRF sits from IRM, as MEASURED — never as applied.

    ``reason`` is the load-bearing field. On production wells the gate refuses
    about 60 % of positions (9 of the 15 sampled), and a bare ``(0, 0)``
    cannot be told
    apart from a genuine perfect alignment; that ambiguity is what let the
    2026-08 mis-registrations run unnoticed. ``quality`` is peak dominance:
    above ~1 the peak beat every rival, and same-content pairs score in the
    thousands, so a value near 1 means "no dominant peak", not "barely aligned".
    """

    #: The measured offset, or None when nothing was measured — a refusal, a
    #: crash, or an unavailable estimator. NOT 0: "no measurement" and "a
    #: measurement of zero" are exactly the pair this module exists to keep
    #: apart, and `evaluate.py` renders None as a blank cell.
    dy: int | None
    dx: int | None
    #: Peak dominance. Present on a refusal too — that is the number that says
    #: HOW badly it was refused — and None only when nothing ran at all.
    quality: float | None
    reason: str


def _load_estimator():
    """The shared ``estimate_translation_detailed``, or None if unreachable.

    Resolved once and cached. A missing estimator degrades the diagnostic, it
    does not fail the run — the intensities are what the run exists to produce.
    """
    global _ESTIMATOR
    if _ESTIMATOR is _UNSET:
        try:
            if str(_MODULE_ROOT) not in sys.path:
                sys.path.insert(0, str(_MODULE_ROOT))
            from _mt_package import ensure_registration_on_path

            ensure_registration_on_path()
            from channel_registration import estimate_translation_detailed

            _ESTIMATOR = estimate_translation_detailed
        except Exception as exc:  # noqa: BLE001 - degrade, never abort
            print(f"[warn] channel-alignment diagnostic unavailable: "
                  f"{type(exc).__name__}: {exc}", file=sys.stderr)
            _ESTIMATOR = None
    return _ESTIMATOR


def measure_alignment(reference: np.ndarray, moving: np.ndarray) -> ChannelAlignment:
    """Measure ``moving``'s offset from ``reference``. Reports; never applies.

    WHY NOTHING IS APPLIED. Measured 2026-08-30 across 180 production wells: the
    estimator recovers an injected (5, -3) from IRM-vs-shifted-IRM 15/15 times
    at quality ~7000, and from TIRF-vs-shifted-TIRF 15/15 times — but
    IRM-vs-shifted-TIRF is accepted only 6/15 times and every accepted answer is
    wrong by 1-2 px, at quality 0.5-2.9. The channels do not share edges: IRM is
    interference contrast off the surface, TIRF is fluorescence from the
    filaments, and the gradient correlation the estimator relies on has no
    common structure to lock onto. The real offset measures 0-1 px.

    Applying that would write a noise peak into the readout — the 2026-08 defect
    — and shift the measurement band against the signal it integrates. So the
    numbers are recorded and an acquisition that genuinely IS misaligned becomes
    visible (``ok`` at a quality well above 1, with a non-zero offset) without
    any run's pixels changing.

    Never raises: a diagnostic must not be able to fail a well.

    Cost, measured 2026-08-30 on production wells: **~120 ms per position** on
    a 1400x1400 well, ~7 % of that well's ~1.7 s/position. It scales with the
    transform, not flat -- at 2048x2048 one estimate is ~270 ms, ~1.9 % of that
    well's ~14 s/position. (Do not reuse the 1400 figure there: an earlier
    revision of this docstring did, and understated it by 2.3x.) Always on
    rather than behind a flag, because a diagnostic nobody enables collects no
    data -- but if a future acquisition makes this the expensive part, that is
    the trade-off to revisit.
    """
    estimator = _load_estimator()
    if estimator is None:
        return ChannelAlignment(None, None, None, REASON_UNAVAILABLE)
    try:
        est = estimator(reference, moving)
    except ValueError:
        # The one failure the shared module has a name for. Its own comment says
        # the constant "exists for callers that catch that case up-front" — this
        # is that caller. Imported here, not at module scope: the shared module
        # is only on sys.path once `_load_estimator` has succeeded above.
        from channel_registration import REASON_SHAPE_MISMATCH

        return ChannelAlignment(None, None, None, REASON_SHAPE_MISMATCH)
    except Exception as exc:  # noqa: BLE001 - a diagnostic must not fail a well
        # Said ONCE per exception type: a systematic failure (MemoryError under
        # pressure, a rename in the shared module) would otherwise produce zero
        # log output across an entire 180-well batch while every row quietly
        # reads `error:...`, and the run finishes "completed, failures: 0".
        kind = type(exc).__name__
        if kind not in _REPORTED_ERRORS:
            _REPORTED_ERRORS.add(kind)
            print(f"[warn] channel-alignment measurement failed ({kind}: {exc}); "
                  f"reported as error:{kind} for every affected position",
                  file=sys.stderr)
        return ChannelAlignment(None, None, None, f"error:{kind}")
    from channel_registration import REASON_OK

    if est.reason != REASON_OK:
        # A refused estimate has no offset to report: (0, 0) here would read as
        # a perfectly aligned pair. `quality` IS measured on a refusal and stays.
        return ChannelAlignment(None, None, float(est.quality), str(est.reason))
    return ChannelAlignment(int(est.dy), int(est.dx),
                            float(est.quality), str(est.reason))


#: Reported when ``focus_qc`` or its calibration could not be loaded at all. A
#: blank verdict with no reason would be indistinguishable from "in focus".
REASON_FOCUS_UNAVAILABLE = "detector_unavailable"
#: Reported when every channel scored above threshold, inside the calibrated
#: acquisition domain. Spelled out rather than left empty so a blank cell can
#: only ever mean "this run predates the column".
REASON_FOCUS_OK = "ok"

#: Where the thresholds come from. Overridable because recalibration is the
#: documented remedy when ``out_of_calibration`` fires (focus_qc/README.md), and
#: a batch should not need a rebuilt image to use a fresh calibration.
FOCUS_CALIBRATION_ENV = "ESSAYS_FOCUS_CALIBRATION"

_FOCUS = _UNSET
#: Kept apart from ``_REPORTED_ERRORS`` on purpose: the two diagnostics fail for
#: unrelated reasons, and sharing the set would let whichever ran first swallow
#: the other's only log line for that exception type.
_REPORTED_FOCUS_ERRORS: set[str] = set()


class _FocusDetector(NamedTuple):
    """The pieces of ``focus_qc`` this module drives, resolved once."""

    channel_spec: type
    score_frame: object
    judge_frame: object
    calibration: object
    #: Which calibration file was actually read. Reported by the image's build
    #: smoke and asserted in the tests, so a silent fallback to the wrong
    #: thresholds cannot pass for the shipped ones.
    source: Path


@dataclass(frozen=True)
class ChannelFocus:
    """One channel's focus measurement. Every number is None when nothing ran.

    ``score`` is the descriptor: the area occupied by structure standing more
    than 5 sigma above the local background, in **pixels per 10,000**. It is
    None — not 0 — when the channel could not be scored at all (constant,
    saturated, or sub-ADU noise), because a blank frame reporting 0 and a frame
    genuinely holding no structure are different claims and only one of them is
    a measurement.

    ``sharpness`` is reported ALONGSIDE the verdict and takes no part in it —
    see the note beside ``report.FOCUS_COLUMNS`` for the measurement that says
    why. It has its own None case, distinct from the one above: the descriptor
    returns NaN when a frame holds fewer than ``focus_qc.metrics``'
    ``MIN_STRUCTURE_PX = 50`` structure pixels, i.e. it declined to measure a
    frame it scored perfectly well. That is not "sharpness zero", so it must
    reach the CSV as a blank cell like every other absent number here.
    """

    name: str
    score: float | None
    flagged: bool | None
    threshold: float | None
    sharpness: float | None
    noise_sigma: float | None
    background: float | None


@dataclass(frozen=True)
class FocusQuality:
    """Per-position out-of-focus verdict, as MEASURED — never as a gate.

    Read the caveats before trusting a value here; they are not decoration.

    * **It conflates focus with field density and fails PERMISSIVE.** The score
      counts occupied area, so a dense field keeps enough pixels above 5 sigma
      even when defocused: in the method's own validation one field dropped only
      15.0x -> 11.6x under a 0.5 um defocus where the calibration fields drop by
      88 %. Bad data passes; good data is not thrown away.
    * **``out_of_calibration`` does not catch that.** It watches noise and
      background, not morphology.
    * **The published 0.959 balanced accuracy does not support cross-session
      transfer.** It is leave-one-STACK-out inside a single acquisition session,
      and it validates the threshold *value* out of fold — not the threshold
      rule, the descriptor constants, or the +-0.3 um tolerance, all of which
      were chosen while looking at those same five stacks.

    So this is a triage aid, not an acceptance test: nothing here changes a
    pixel, a row, or the process exit code. Measured 2026-08-31 on the 2048x2048
    well `WellD03_ChannelIRM_TIRF_488_Seq0000.nd2`, all three positions come out
    in focus but ``out_of_calibration`` fires on TIRF 488 on 3/3 (noise sigma
    27.8-33.1 against a fitted 5.79-5.89, background 296-347 against 110-111) —
    wiring that to a non-zero exit would have withheld the entire download.

    ``flagged`` is derived, so the OR rule cannot be contradicted by
    construction — the same reason ``focus_qc.detect.FrameVerdict`` derives it.
    """

    irm: ChannelFocus
    tirf: ChannelFocus
    reason: str

    @property
    def flagged(self) -> bool | None:
        """True if ANY scored channel is out of focus; None if nothing ran."""
        flags = [c.flagged for c in (self.irm, self.tirf)]
        if all(f is None for f in flags):
            return None
        return any(bool(f) for f in flags)


def _unmeasured(name: str) -> ChannelFocus:
    return ChannelFocus(name=name, score=None, flagged=None, threshold=None,
                        sharpness=None, noise_sigma=None, background=None)


def _finite(value) -> float | None:
    """A float, or None when the number is absent or not a number.

    ``focus_qc.score_frame`` substitutes all-NaN statistics for a channel whose
    noise floor cannot be measured. NaN in a CSV cell reads as a measurement;
    blank reads as "no measurement", which is what actually happened. The
    ``unscoreable:`` token in ``reason`` says which of the two it was.
    """
    if value is None:
        return None
    value = float(value)
    return value if np.isfinite(value) else None


def _load_focus_detector() -> "_FocusDetector | None":
    """The vendored ``focus_qc`` plus its calibration, or None if unreachable.

    Resolved once and cached, exactly like :func:`_load_estimator`. A missing
    detector degrades the diagnostic, it does not fail the run.
    """
    global _FOCUS
    if _FOCUS is _UNSET:
        try:
            if str(_MODULE_ROOT) not in sys.path:
                sys.path.insert(0, str(_MODULE_ROOT))
            # focus_qc/__init__.py is empty on purpose; import the submodules.
            from focus_qc.calibration import Calibration
            from focus_qc.detect import ChannelSpec, judge_frame, score_frame

            override = os.environ.get(FOCUS_CALIBRATION_ENV)
            path = Path(override) if override else (
                _MODULE_ROOT / "focus_qc" / "reference" / "calibration.json")
            calibration = Calibration.from_dict(json.loads(path.read_text()))
            _FOCUS = _FocusDetector(channel_spec=ChannelSpec,
                                    score_frame=score_frame,
                                    judge_frame=judge_frame,
                                    calibration=calibration, source=path)
        except Exception as exc:  # noqa: BLE001 - degrade, never abort
            print(f"[warn] out-of-focus check unavailable: "
                  f"{type(exc).__name__}: {exc}", file=sys.stderr)
            _FOCUS = None
    return _FOCUS


def _focus_reason(per_channel) -> str:
    """Why the verdict came out the way it did, as ``;``-joined tokens.

    ``per_channel`` is a list of ``(channel name, FrameVerdict)`` pairs, one per
    role, each judged under its own modality's threshold.

    ``out_of_calibration`` is listed even when nothing is flagged: it is
    advisory and never changes the verdict, so a reason of ``ok`` alone would
    hide the one signal that says the thresholds may no longer apply.
    """
    groups = (("oof", lambda v, n: v.channel_flags[n]),
              ("unscoreable", lambda v, n: n in v.unscoreable),
              ("out_of_calibration", lambda v, n: n in v.out_of_calibration))
    tokens = [f"{label}:{name}"
              for label, holds in groups
              for name, verdict in per_channel if holds(verdict, name)]
    # Deduplicated, order preserved: --irm-name and --tirf-name can resolve to
    # ONE channel (already warned about in `iter_positions`), and naming it
    # twice would read as two separate findings.
    return ";".join(dict.fromkeys(tokens)) or REASON_FOCUS_OK


def judge_focus(irm: np.ndarray, tirf: np.ndarray, *,
                irm_name: str, tirf_name: str) -> FocusQuality:
    """Score the segmented and measured channels for defocus. Reports; never gates.

    WHY THE SOLUTION CHANNEL IS NOT SCORED. It is uniform dye with no structure
    to resolve, and it measured 0.01 and 0.00 on two real positions of
    ``WellD04`` — both far below the fluorescence threshold of 0.184. Feeding it
    into the OR would flag every row of every well, which is worse than not
    checking at all.

    WHY RAW ARRAYS AND NOT THE DISPLAY PNGs. The descriptor thresholds at 5
    sigma of the frame's OWN noise, and the 8-bit percentile-clipped PNGs the
    web app stores destroy exactly that information — scores computed from them
    are meaningless, not merely noisier. ``iter_positions`` hands out raw
    ``uint16`` views straight from the ND2, which is the whole reason this call
    sits there and not in a later stage.

    Never raises: a diagnostic must not be able to fail a well.

    COST, measured 2026-08-31 in the essays image on real wells, min-of-9 back
    to back in one process, per POSITION (both channels):

    ===========================  ===========  ===========
    variant                      1400x1400    2048x2048
    ===========================  ===========  ===========
    before this change            177 ms       472 ms
    bit-identical metrics         163 ms       425 ms
    ...plus scored concurrently    95 ms       300 ms
    ===========================  ===========  ===========

    which is 10 % and 3.4 % of those wells' ~1.7 s and ~14 s per position before,
    and 5.6 % / 2.1 % after. The rewrite of ``focus_qc.metrics`` accounts for
    7-10 % and shows the same figure in CPU time; the rest is the pairing below.
    numpy releases the GIL for the selection and filtering that dominate the
    descriptor, and the two calls share nothing, so with a free core the pair
    costs about what one channel costs — on identical numbers.

    That second saving is wall clock and needs a core to be idle. Re-measured on
    the same host at load 30 on 4 cores, the threaded form was 1230 ms against
    the sequential 1014 ms at 2048x2048 — no overlap available, and a little
    worse for trying. It is still the right default: the batch loop is strictly
    sequential and spends its time on the GPU, so a second core normally is
    free, and the fallback is losing a saving rather than losing correctness.
    """
    detector = _load_focus_detector()
    if detector is None:
        return FocusQuality(_unmeasured(irm_name), _unmeasured(tirf_name),
                            REASON_FOCUS_UNAVAILABLE)
    try:
        specs = (detector.channel_spec(irm_name, "irm"),
                 detector.channel_spec(tirf_name, "fluor"))

        def judge_one(job):
            """Score and judge ONE channel, under its own modality's threshold."""
            spec, image = job
            stats = detector.score_frame({spec.name: image}, (spec,))
            verdict = detector.judge_frame(stats, (spec,), detector.calibration)
            return spec, stats[spec.name], verdict

        # Per channel rather than one two-channel call, for two reasons. It lets
        # the two run side by side (numpy releases the GIL for the work that
        # dominates the descriptor) -- and `score_frame`/`judge_frame` key their
        # dicts by channel NAME, so when --irm-name and --tirf-name resolve to
        # the SAME channel (warned about in `iter_positions`, not refused) a
        # single call collapses them: whichever modality was scored last would
        # win, and its fluorescence-polarity count would be published in the IRM
        # column and compared against the IRM threshold. Measured on a real
        # frame: 142.67 (positive tail) reported where the negative tail belongs.
        with ThreadPoolExecutor(max_workers=2,
                                thread_name_prefix="focus-qc") as pool:
            judged = list(pool.map(judge_one, zip(specs, (irm, tirf))))

        def channel(spec, stats, verdict) -> ChannelFocus:
            return ChannelFocus(
                name=spec.name,
                score=_finite(stats.score),
                flagged=bool(verdict.channel_flags[spec.name]),
                threshold=float(detector.calibration.thresholds[spec.modality]),
                # Advisory, and NEVER read by anything that decides. `_finite`
                # matters more here than for its neighbours: sharpness is
                # legitimately NaN on a frame that scored fine but holds fewer
                # than MIN_STRUCTURE_PX = 50 structure pixels.
                sharpness=_finite(stats.sharpness),
                noise_sigma=_finite(stats.noise_sigma),
                background=_finite(stats.background),
            )

        # The OR over channels lives in `FocusQuality.flagged`, derived exactly
        # as `focus_qc.detect.FrameVerdict.flagged` derives it. Every per-channel
        # decision -- the `not (score >= threshold)` that makes a NaN flag, the
        # domain check, the unscoreable list -- still comes from `judge_frame`.
        #
        # Assembled INSIDE the try so the guarantee covers the whole
        # measurement, not just its first half. No reachable input is known to
        # need that today -- `judge_frame` already refuses a calibration that
        # does not cover a channel's modality -- so this is deliberately
        # unfalsifiable insurance, kept because "never raises" is the contract
        # `iter_positions` relies on and should not depend on that staying true.
        return FocusQuality(channel(*judged[0]), channel(*judged[1]),
                            _focus_reason([(s.name, v) for s, _st, v in judged]))
    except Exception as exc:  # noqa: BLE001 - a diagnostic must not fail a well
        # Said ONCE per exception type, for the same reason `measure_alignment`
        # does it: a systematic failure would otherwise leave a 180-well batch
        # with no log line at all and every row quietly reading `error:...`.
        kind = type(exc).__name__
        if kind not in _REPORTED_FOCUS_ERRORS:
            _REPORTED_FOCUS_ERRORS.add(kind)
            print(f"[warn] out-of-focus check failed ({kind}: {exc}); reported "
                  f"as error:{kind} for every affected position", file=sys.stderr)
        return FocusQuality(_unmeasured(irm_name), _unmeasured(tirf_name),
                            f"error:{kind}")


@dataclass
class Position:
    well_id: str
    position: int           # 0-based field-of-view index
    irm: np.ndarray         # (Y, X) raw intensities — SEGMENTATION input
    tirf: np.ndarray        # (Y, X) raw intensities — intensity READOUT
    solution: np.ndarray    # (Y, X) raw intensities — 488 in-solution channel
    px_um: float | None     # micron / pixel (None if unavailable)
    acquired_at: str | None = None  # ISO-8601 UTC, or the raw ND2 date string
    #: MEASURED IRM->TIRF offset, for the report. Never applied to the arrays
    #: above — see :func:`measure_alignment`.
    alignment: "ChannelAlignment | None" = None
    #: MEASURED out-of-focus verdict for the IRM and TIRF frames above. Never
    #: gates anything — see :func:`judge_focus`.
    focus: "FocusQuality | None" = None


def parse_well_id(path: Path) -> str:
    """Extract e.g. ``WellD04`` -> ``D04`` from the file name.

    Falls back to the bare stem if the name does not match the expected
    ``Well<letter><number>`` pattern.
    """
    m = re.search(r"Well\s*([A-Za-z]\d+)", path.name)
    return m.group(1) if m else path.stem


def _find_channel(names: list[str], *substrings: str) -> int:
    """Index of the first channel whose name contains any of ``substrings``
    (case-insensitive)."""
    low = [n.lower() for n in names]
    for sub in substrings:
        s = sub.lower()
        for i, n in enumerate(low):
            if s in n:
                return i
    raise KeyError(f"no channel matching {substrings!r} in {names!r}")


def read_acquisition_time(f: "nd2.ND2File") -> str | None:
    """When the recording was acquired, as an ISO-8601 UTC string.

    Two sources, deliberately in this order:

    1. ``frame_metadata(0).channels[0].time.absoluteJulianDayNumber`` — a float
       Julian Day, i.e. an absolute instant with no timezone or locale in it.
       This is the one to trust.
    2. ``text_info['date']`` — the acquisition PC's *local wall clock* rendered
       in that PC's locale (``5/19/2026  23:48:04``). Month/day order is not
       recoverable from the string alone, so it is never parsed, only passed
       through verbatim as a last resort.

    Returns ``None`` when the file carries neither, which is not an error — the
    column is simply left blank.
    """
    try:
        jd = f.frame_metadata(0).channels[0].time.absoluteJulianDayNumber
        if jd:
            ts = (float(jd) - _JD_UNIX_EPOCH) * 86400.0
            return (datetime.datetime
                    .fromtimestamp(ts, datetime.timezone.utc)
                    .replace(microsecond=0)
                    .isoformat()
                    .replace("+00:00", "Z"))
    except Exception:
        # acquired_at is optional metadata: ND2 files from different NIS-Elements
        # versions expose it in different places, or not at all. Each reader is
        # tried in turn and the caller gets None if none of them work -- a well
        # without a timestamp is still a well worth measuring.
        pass
    try:
        raw = (f.text_info or {}).get("date")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    except Exception:
        # acquired_at is optional metadata: ND2 files from different NIS-Elements
        # versions expose it in different places, or not at all. Each reader is
        # tried in turn and the caller gets None if none of them work -- a well
        # without a timestamp is still a well worth measuring.
        pass
    return None


def iter_positions(path: Path, *, irm_match=("irm",), tirf_match=("tirf",),
                   solution_match=("insol", "in sol", "solution")) -> Iterator[Position]:
    """Yield one :class:`Position` per field of view in ``path``.

    Channels are resolved by name so the pipeline does not depend on the
    physical channel order inside the ND2. A file with no IRM channel raises
    :class:`KeyError` rather than quietly segmenting something else — the caller
    counts that as a failed well and says so.
    """
    path = Path(path)
    well_id = parse_well_id(path)
    with nd2.ND2File(str(path)) as f:
        names = [c.channel.name for c in f.metadata.channels]
        ci_irm = _find_channel(names, *irm_match)
        ci_tirf = _find_channel(names, *tirf_match)
        ci_sol = _find_channel(names, *solution_match)
        if ci_irm == ci_tirf:
            # Segmenting and measuring the same channel is exactly the defect
            # this signature exists to prevent. It stays legal (someone may
            # genuinely have one channel and know it), but never silent.
            print(f"[warn] {path.name}: --irm-name and --tirf-name both resolve "
                  f"to channel {names[ci_irm]!r}; segmentation and readout will "
                  "use the same image", file=sys.stderr)

        try:
            vox = f.voxel_size()
            px_um = float(vox.x)
        except Exception:
            px_um = None
        # Per file, not per position: positions within one well are seconds
        # apart, and what identifies a run is when the well was recorded.
        acquired_at = read_acquisition_time(f)

        arr = np.asarray(f.asarray())          # (P, C, Y, X) or (C, Y, X)
        if arr.ndim == 3:                       # single position -> add P axis
            arr = arr[None]
        n_pos = arr.shape[0]
        for p in range(n_pos):
            irm = np.asarray(arr[p, ci_irm])
            tirf = np.asarray(arr[p, ci_tirf])
            yield Position(
                well_id=well_id,
                position=p,
                irm=irm,
                tirf=tirf,
                solution=np.asarray(arr[p, ci_sol]),
                px_um=px_um,
                acquired_at=acquired_at,
                # Measured here, where the channel roles are resolved, so the
                # diagnostic cannot describe a different pair than the one the
                # run segments and measures. The arrays are handed on unchanged.
                alignment=measure_alignment(irm, tirf),
                # Same place, same reason, plus one of its own: these are the
                # RAW 16-bit frames. The focus descriptor thresholds at 5 sigma
                # of the frame's own noise, which the 8-bit display PNGs do not
                # preserve, so there is no later stage where this could be done.
                focus=judge_focus(irm, tirf, irm_name=names[ci_irm],
                                  tirf_name=names[ci_tirf]),
            )


def find_nd2_files(data_path: Path) -> list[Path]:
    """Return the ND2 files to process: a single file, or all ``*.nd2`` under a
    directory (recursively), sorted by name."""
    data_path = Path(data_path)
    if data_path.is_file():
        return [data_path]
    files = sorted(data_path.rglob("*.nd2"))
    return [f for f in files if not f.name.startswith("._")]  # skip macOS AppleDouble
