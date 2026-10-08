"""Mean intensity of the soma and neurite classes of one frame, per channel.

The measured regions are the polygons the user sees and may have edited, not
a model's mask: this module is handed rings and never runs a segmentation.

Beside the ``models`` package's heavy members for the same reason as
``mt_measure.py``, whose statistics it reuses -- measuring pixels needs no
torch, and one implementation of "mean / median of a region" is what keeps
this table and the microtubule export from drifting apart the way the essays
module and the project export once did.

WHAT IS MEASURED
----------------
* ``soma`` and ``neurite`` are the UNION of every polygon of that class in the
  frame, holes subtracted. Soma wins where the two overlap, the same rule the
  neurite metrics use: a pixel drawn as both is a cell body with a process
  starting on it.
* ``background`` is everything farther than ``BACKGROUND_MARGIN_PX`` from any
  polygon. Its MEDIAN is the background level, not its mean: what is left
  outside the masks still holds unsegmented debris and the faint neurites the
  model missed, and a median is not moved by a bright minority.
* ``mean_minus_background`` is the class mean less that median -- the same
  readout as the microtubule export's ``signal_minus_background``. It removes
  the camera offset, which on the frames this was built for is ~100 counts
  under a signal of ~20, so the raw mean alone says almost nothing. It does
  NOT remove the scale (dye, exposure, gain): two channels are still not
  comparable in absolute numbers.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import sys
from pathlib import Path

import cv2
import numpy as np

# Top-level, off this directory -- the spelling `api/mt_metrics.py` and the
# essays batch use for the same file, and for the same reason: going through
# the `models` package would import torch to compute a mean.
_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.append(_HERE)
import mt_measure  # noqa: E402

#: Pixels within this distance of a polygon are neither signal nor background:
#: the blur of a structure extends past its outline.
BACKGROUND_MARGIN_PX = 5

CLASSES: Tuple[str, ...] = ("soma", "neurite")

Ring = Sequence[Sequence[float]]


def _as_points(ring: Ring) -> Optional[np.ndarray]:
    if len(ring) < 3:
        return None
    return np.array([[int(round(x)), int(round(y))] for x, y in ring], np.int32)


def rasterise(
    polygons: Sequence[Mapping[str, Any]], shape: Tuple[int, int]
) -> np.ndarray:
    """Union of ``polygons`` as a uint8 0/1 mask.

    Each polygon is ``{"points": ring, "holes": [ring, ...]}``. A hole removes
    its STRICT interior only. That is the OpenCV convention these rings come
    from -- ``cv2.findContours`` traces a hole along the FOREGROUND pixels that
    border it -- so filling the hole ring with zero would erode the region by
    one pixel all the way round every hole. On a neurite loop a few pixels wide
    that is a large fraction of the object.
    """
    out = np.zeros(shape, np.uint8)
    for poly in polygons:
        outer = _as_points(poly["points"])
        if outer is None:
            continue
        holes = [h for h in (_as_points(r) for r in poly.get("holes") or []) if h is not None]
        if not holes:
            cv2.fillPoly(out, [outer], 1)
            continue
        # Composed on its own canvas: punching a hole straight into `out`
        # would also erase a NEIGHBOURING polygon that lies inside this hole
        # (a soma inside a neurite loop is exactly that).
        one = np.zeros(shape, np.uint8)
        cv2.fillPoly(one, [outer], 1)
        for hole in holes:
            interior = np.zeros(shape, np.uint8)
            cv2.fillPoly(interior, [hole], 1)
            cv2.polylines(interior, [hole], True, 0)
            one[interior > 0] = 0
        out |= one
    return out


def class_masks(
    soma_polygons: Sequence[Mapping[str, Any]],
    neurite_polygons: Sequence[Mapping[str, Any]],
    shape: Tuple[int, int],
) -> Dict[str, np.ndarray]:
    """``soma``, ``neurite`` and ``background`` masks for one frame."""
    soma = rasterise(soma_polygons, shape)
    neurite = rasterise(neurite_polygons, shape)
    neurite[soma > 0] = 0
    near = mt_measure.dilate(soma | neurite, BACKGROUND_MARGIN_PX)
    return {"soma": soma, "neurite": neurite, "background": (near == 0).astype(np.uint8)}


def measure(
    channels: Sequence[Tuple[str, np.ndarray]], masks: Mapping[str, np.ndarray]
) -> List[Dict[str, Any]]:
    """One row per (channel, class).

    A class with no pixels still gets a row, with ``area_px`` 0 and null
    statistics: "no soma was segmented on this frame" is a result the reader
    needs to see, and a zero would read as a measured intensity of zero.
    """
    rows: List[Dict[str, Any]] = []
    for name, image in channels:
        if image.shape != masks["background"].shape:
            raise ValueError(
                f"channel {name!r} is {image.shape[1]}x{image.shape[0]} but the "
                f"polygons were drawn on {masks['background'].shape[1]}x"
                f"{masks['background'].shape[0]}"
            )
        background = mt_measure.region_stats(image, masks["background"])
        bg_median = background.median if background.n else None
        for cls in CLASSES:
            stats = mt_measure.region_stats(image, masks[cls])
            measured = stats.n > 0
            rows.append(
                {
                    "channel": name,
                    "class": cls,
                    "area_px": stats.n,
                    "mean_intensity": stats.mean if measured else None,
                    "median_intensity": stats.median if measured else None,
                    "std_intensity": stats.std if measured else None,
                    "sum_intensity": stats.sum if measured else None,
                    "background_median": bg_median,
                    "background_area_px": background.n,
                    "mean_minus_background": (
                        stats.mean - bg_median
                        if measured and bg_median is not None
                        else None
                    ),
                }
            )
    return rows
