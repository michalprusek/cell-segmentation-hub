"""POST /api/v1/neurite-intensity -- per-class mean intensity of one frame.

Given the soma and neurite polygons of a frame and the file of each of its
channels, returns one row per (channel, class). The geometry and statistics
live in ``models/neurite_intensity.py``; this module only reads files and
guards the request.

Channels are read from the per-frame files the app already serves (a 16-bit
PNG per channel for a multi-channel container, the uploaded file itself for a
still), at their native bit depth. A multi-channel file is refused rather than
averaged: which of its channels the caller meant is exactly the thing that
must not be guessed.
"""

from __future__ import annotations

import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .neurite_metrics import _MAX_PIXELS, NeuritePolygonInput, _safe_path

# Imported off the models DIRECTORY, not as `models.neurite_intensity` -- see
# the note above the same lines in `mt_metrics.py`.
_MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
if str(_MODELS_DIR) not in sys.path:
    sys.path.append(str(_MODELS_DIR))
import neurite_intensity  # noqa: E402

router = APIRouter()

# One slot, for the reason `/neurite-metrics` and `/kymograph` have one: this
# is CPU work on a `--workers 1` server. `async def` would block `/health` for
# its duration, and a plain `def` would hand it to Starlette's 40-slot
# threadpool, forty decoded frames at a time.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="neurite-intensity")

_MAX_CHANNELS = 16


class IntensityChannel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Echoed into every row; the caller's own label for the channel.
    name: str = Field(..., min_length=1, max_length=128)
    #: Absolute path, on the ML container, of this channel's image of the frame.
    path: str


class NeuriteIntensityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame: str
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    soma_polygons: List[NeuritePolygonInput]
    neurite_polygons: List[NeuritePolygonInput]
    channels: List[IntensityChannel] = Field(..., min_length=1, max_length=_MAX_CHANNELS)


class NeuriteIntensityResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame: str
    rows: List[Dict[str, Any]]


def _read_channel(channel: IntensityChannel, shape: tuple[int, int]) -> np.ndarray:
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    path = _safe_path(Path(channel.path), f"channel {channel.name!r}")
    if not path.is_file():
        raise HTTPException(
            status_code=404, detail=f"Channel file not found: {channel.name}"
        )
    pixels = np.asarray(Image.open(path))
    if pixels.ndim == 3:
        # A colour render of one grey channel is measurable; a real colour
        # image is three channels and nobody said which.
        planes = pixels[..., :3]
        if not (
            np.array_equal(planes[..., 0], planes[..., 1])
            and np.array_equal(planes[..., 0], planes[..., 2])
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Channel {channel.name!r} is a colour image. Intensity is "
                    "measured per channel; upload the channels as a multi-page "
                    "TIFF or ND2 so each one is stored on its own."
                ),
            )
        pixels = planes[..., 0]
    if pixels.shape != shape:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Channel {channel.name!r} is {pixels.shape[1]}x{pixels.shape[0]} "
                f"but the polygons were drawn on {shape[1]}x{shape[0]}"
            ),
        )
    return pixels


def _polygons(items: List[NeuritePolygonInput]) -> List[Dict[str, Any]]:
    return [{"points": p.points, "holes": p.holes or []} for p in items]


def _compute(req: NeuriteIntensityRequest) -> NeuriteIntensityResponse:
    shape = (req.height, req.width)
    masks = neurite_intensity.class_masks(
        _polygons(req.soma_polygons), _polygons(req.neurite_polygons), shape
    )
    channels = [(c.name, _read_channel(c, shape)) for c in req.channels]
    return NeuriteIntensityResponse(
        frame=req.frame, rows=neurite_intensity.measure(channels, masks)
    )


@router.post("/neurite-intensity", response_model=NeuriteIntensityResponse)
async def neurite_intensity_route(
    request: NeuriteIntensityRequest,
) -> NeuriteIntensityResponse:
    """Per-class intensity of one frame, one row per (channel, class)."""
    if request.width * request.height > _MAX_PIXELS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Frame is {request.width}x{request.height}, over the "
                f"{_MAX_PIXELS} px limit for this endpoint"
            ),
        )
    return await asyncio.get_running_loop().run_in_executor(
        _EXECUTOR, _compute, request
    )
