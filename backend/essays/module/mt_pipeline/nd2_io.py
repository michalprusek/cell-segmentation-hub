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
"""
from __future__ import annotations

import datetime
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

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
            )


def find_nd2_files(data_path: Path) -> list[Path]:
    """Return the ND2 files to process: a single file, or all ``*.nd2`` under a
    directory (recursively), sorted by name."""
    data_path = Path(data_path)
    if data_path.is_file():
        return [data_path]
    files = sorted(data_path.rglob("*.nd2"))
    return [f for f in files if not f.name.startswith("._")]  # skip macOS AppleDouble
