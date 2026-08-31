"""Turn an annotated z-stack into labelled per-plane examples.

The sharp plane is eyeballed by the microscopist, and at a 0.1 um step that
judgement is worth about one plane.  Training a threshold on planes right at the
in-focus/out-of-focus boundary would therefore fit annotation noise, so a guard
band around the boundary is excluded from both classes.
"""
from __future__ import annotations

from typing import Iterator, Mapping, Sequence

import numpy as np

from .detect import ChannelSpec, score_frame
from .metrics import FrameStats

#: Axis names that denote a genuine focus series. A multipoint axis (P) has the
#: same array shape but its frames are unrelated stage positions, so scoring it
#: as a defocus series would return plausible, meaningless numbers.
FRAME_AXES = ("Z", "T")

IN_FOCUS = 1
OUT_OF_FOCUS = 0
EXCLUDED = -1


def defocus_um(n_planes: int, sharp_plane: int, z_step_um: float) -> np.ndarray:
    """Absolute distance from the annotated focal plane, in micrometres.

    ``sharp_plane`` is 1-based, matching how the annotation was written down.
    """
    if not 1 <= sharp_plane <= n_planes:
        raise ValueError(f"sharp_plane {sharp_plane} is outside a stack of {n_planes} planes")
    return np.abs(np.arange(1, n_planes + 1) - sharp_plane) * z_step_um


def label_planes(
    n_planes: int,
    sharp_plane: int,
    z_step_um: float,
    tolerance_um: float,
    guard_um: float,
) -> np.ndarray:
    """Label every plane ``IN_FOCUS``, ``OUT_OF_FOCUS`` or ``EXCLUDED``.

    Distances are compared in whole planes rather than micrometres so that a
    plane exactly at the tolerance is not lost to floating-point round-off.
    """
    if not 1 <= sharp_plane <= n_planes:
        raise ValueError(f"sharp_plane {sharp_plane} is outside a stack of {n_planes} planes")
    distance = np.abs(np.arange(1, n_planes + 1) - sharp_plane)
    n_tolerance = int(round(tolerance_um / z_step_um))
    n_guard = int(round(guard_um / z_step_um))

    labels = np.full(n_planes, OUT_OF_FOCUS, dtype=int)
    labels[distance <= n_tolerance] = IN_FOCUS
    if n_guard > 0:
        boundary = (distance > n_tolerance) & (distance <= n_tolerance + n_guard)
        labels[boundary] = EXCLUDED
    return labels


def frame_axis(sizes: Mapping[str, int]) -> str:
    """Name of the axis to iterate frames over, for an ND2 laid out (frame, C, Y, X).

    Validates both the layout and the frame-axis *name*: only Z and T are focus
    series. A multipoint (P) or series (S) file has the identical array shape but
    holds unrelated stage positions, so a layout-only check would score it as a
    defocus series and return plausible, meaningless numbers.
    """
    layout = "".join(sizes)
    axes = list(sizes)
    if axes[-2:] != ["Y", "X"]:
        raise ValueError(f"expected the last two axes to be Y, X; file is laid out {layout}")
    leading = axes[:-2]
    if "C" not in leading:
        raise ValueError(f"no channel axis found; file is laid out {layout}")
    frame_axes = [a for a in leading if a != "C"]
    unknown = [a for a in frame_axes if a not in FRAME_AXES]
    if unknown:
        raise ValueError(
            f"axis {' and '.join(unknown)} is not a focus series (laid out {layout}); "
            f"focus_qc iterates {' or '.join(FRAME_AXES)} -- a multipoint (P) or series (S) "
            "axis holds unrelated positions and must not be scored as defocus"
        )
    if not frame_axes:
        raise ValueError(
            f"file holds a single frame (laid out {layout}); "
            "focus_qc iterates frames, so pass a z-stack or a timelapse"
        )
    if len(frame_axes) > 1:
        raise ValueError(
            f"file has both {' and '.join(frame_axes)} axes (laid out {layout}); "
            "focus_qc handles one frame axis at a time -- split it first"
        )
    if leading != [frame_axes[0], "C"]:
        raise ValueError(f"expected the layout (frame, C, Y, X); file is laid out {layout}")
    return frame_axes[0]


def planes_from_array(
    array: np.ndarray,
    sizes: Mapping[str, int],
    channel_names: Sequence[str],
    specs: Sequence[ChannelSpec],
) -> Iterator[dict[str, np.ndarray]]:
    """Yield one ``channel name -> plane image`` dict per frame of a loaded ND2 array.

    Separated from the file reading so the layout and channel guards can be
    tested without an ND2 fixture.
    """
    frame_axis(sizes)                      # refuses a layout this indexing would misread
    if array.shape[0] == 0:
        raise ValueError(f"file holds no frames (laid out {''.join(sizes)}, frame axis length 0)")
    missing = [s.name for s in specs if s.name not in channel_names]
    if missing:
        raise KeyError(f"declared channel(s) {missing} not among file channels {list(channel_names)}")
    index = {s.name: list(channel_names).index(s.name) for s in specs}
    for frame in range(array.shape[0]):
        yield {name: array[frame, channel] for name, channel in index.items()}


def iter_stack_planes(path: str, specs: Sequence[ChannelSpec]) -> Iterator[dict[str, np.ndarray]]:
    """Yield one dict of ``channel name -> plane image`` per frame of an ND2 file."""
    import nd2

    with nd2.ND2File(path) as handle:
        names = [c.channel.name for c in handle.metadata.channels]
        sizes = dict(handle.sizes)
        try:
            array = handle.asarray()       # (frame, C, Y, X)
        except MemoryError:
            # A capacity limit, not a corrupt file -- do not let the user go hunting
            # for a bad ND2 that is perfectly fine.
            raise MemoryError(
                f"{path}: not enough memory to load the whole stack at once"
            ) from None
        except (OSError, ValueError, KeyError, RuntimeError) as exc:
            raise ValueError(f"{path}: could not read image data ({exc})") from exc
    try:
        yield from planes_from_array(array, sizes, names, specs)
    except (ValueError, KeyError) as exc:
        raise type(exc)(f"{path}: {exc}") from exc


def score_stack(path: str, specs: Sequence[ChannelSpec]) -> dict[str, list[FrameStats]]:
    """Focus statistics for every plane and channel of one stack."""
    per_channel: dict[str, list[FrameStats]] = {s.name: [] for s in specs}
    for plane in iter_stack_planes(path, specs):
        for name, stats in score_frame(plane, specs).items():
            per_channel[name].append(stats)
    return per_channel


def pooled(scores: np.ndarray, labels: np.ndarray, wanted: int) -> np.ndarray:
    """Scores restricted to planes carrying the ``wanted`` label."""
    return np.asarray(scores, float)[np.asarray(labels, int) == wanted]
