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

# Julian Day Number of the Unix epoch (1970-01-01T00:00:00Z). ND2 stores the
# acquisition instant as a JD float, which is what makes it unambiguous.
_JD_UNIX_EPOCH = 2440587.5


@dataclass
class Position:
    well_id: str
    position: int           # 0-based field-of-view index
    irm: np.ndarray         # (Y, X) raw intensities — SEGMENTATION input
    tirf: np.ndarray        # (Y, X) raw intensities — intensity READOUT
    solution: np.ndarray    # (Y, X) raw intensities — 488 in-solution channel
    px_um: float | None     # micron / pixel (None if unavailable)
    acquired_at: str | None = None  # ISO-8601 UTC, or the raw ND2 date string


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
            yield Position(
                well_id=well_id,
                position=p,
                irm=np.asarray(arr[p, ci_irm]),
                tirf=np.asarray(arr[p, ci_tirf]),
                solution=np.asarray(arr[p, ci_sol]),
                px_um=px_um,
                acquired_at=acquired_at,
            )


def find_nd2_files(data_path: Path) -> list[Path]:
    """Return the ND2 files to process: a single file, or all ``*.nd2`` under a
    directory (recursively), sorted by name."""
    data_path = Path(data_path)
    if data_path.is_file():
        return [data_path]
    files = sorted(data_path.rglob("*.nd2"))
    return [f for f in files if not f.name.startswith("._")]  # skip macOS AppleDouble
