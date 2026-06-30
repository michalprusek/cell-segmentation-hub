"""Reading Nikon ND2 well recordings.

Each ND2 file is one well with several positions (fields of view) and three
channels (IRM, the 488-in-solution channel, and the TIRF 488 channel). This
module opens a file, locates channels **by name** (robust to channel-order
changes between acquisitions), reads the pixel calibration, and yields one
:class:`Position` per field of view.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np
import nd2


@dataclass
class Position:
    well_id: str
    position: int           # 0-based field-of-view index
    tirf: np.ndarray        # (Y, X) raw intensities — microtubule channel
    solution: np.ndarray    # (Y, X) raw intensities — 488 in-solution channel
    px_um: float | None     # micron / pixel (None if unavailable)


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


def iter_positions(path: Path, *, tirf_match=("tirf",),
                   solution_match=("insol", "in sol", "solution")) -> Iterator[Position]:
    """Yield one :class:`Position` per field of view in ``path``.

    Channels are resolved by name so the pipeline does not depend on the
    physical channel order inside the ND2.
    """
    path = Path(path)
    well_id = parse_well_id(path)
    with nd2.ND2File(str(path)) as f:
        names = [c.channel.name for c in f.metadata.channels]
        ci_tirf = _find_channel(names, *tirf_match)
        ci_sol = _find_channel(names, *solution_match)

        try:
            vox = f.voxel_size()
            px_um = float(vox.x)
        except Exception:
            px_um = None

        arr = np.asarray(f.asarray())          # (P, C, Y, X) or (C, Y, X)
        if arr.ndim == 3:                       # single position -> add P axis
            arr = arr[None]
        n_pos = arr.shape[0]
        for p in range(n_pos):
            yield Position(
                well_id=well_id,
                position=p,
                tirf=np.asarray(arr[p, ci_tirf]),
                solution=np.asarray(arr[p, ci_sol]),
                px_um=px_um,
            )


def find_nd2_files(data_path: Path) -> list[Path]:
    """Return the ND2 files to process: a single file, or all ``*.nd2`` under a
    directory (recursively), sorted by name."""
    data_path = Path(data_path)
    if data_path.is_file():
        return [data_path]
    files = sorted(data_path.rglob("*.nd2"))
    return [f for f in files if not f.name.startswith("._")]  # skip macOS AppleDouble
