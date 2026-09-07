"""``POST /api/v1/neurite-metrics`` -- per-cell neuron biology from polygons.

Turns the editor's neurite and soma polygons into two tables: one row per
primary neurite and one per soma, with a developmental stage for every neuronal
soma. The maths lives in ``models.neurite_metrics``; this module is the wire
boundary -- rasterise, call, serialise.

WHY THE POLYGONS AND NOT THE MODEL'S OWN MASK
---------------------------------------------
The research pipeline consumes a semantic mask straight from the segmenter.
This endpoint rasterises the STORED polygons instead, so a user's corrections
are what gets measured. That is not free, and the cost was measured rather than
assumed -- on the packaged sample frame (6 664 x 6 657, 0.180 um/px), pushing
the model's own mask through the app's polygonisation and back:

    class     pixel IoU    components
    neurite      0.9898       391 -> 342
    soma         0.9995       166 -> 148

and, through the whole pipeline, 287 -> 275 neurites (-4.2 %) with cable length
down 0.81 %. Nearly all of that loss was `PostprocessingService.min_area = 50`
discarding small components: at 0.180 um/px a 2.5 px wide process needs to be
3.6 um long to clear 50 px, and the staging rules count a neurite from 2 um. At
min_area <= 20 the same comparison gives 285 neurites (-0.7 %) -- the knee sits
between 20 and 50, and 4 / 10 / 20 all produce identical output.

SOMA POLYGONS ARE THE INSTANCES
-------------------------------
The research chain instances somas itself (S1: distance transform + h-maxima),
because connected components fuse 17.1 % of them. Here each soma POLYGON is one
instance, and the instancing runs earlier -- at segmentation time -- so the
split it proposes lands in the editor as separate, editable polygons.

That inversion is the whole point of doing this in an app rather than a script:
an instancer that fuses two cells is a mistake the user can now fix by drawing,
instead of a number they have to distrust. It also means this endpoint is
deterministic given the polygons, so re-running an export cannot silently move
a cell into a different soma.
"""

from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

router = APIRouter()

# One slot, for the same reason `/mt-metrics` has one: this is CPU-and-GPU work
# on a `--workers 1` uvicorn. A plain `def` route would be handed to Starlette's
# 40-slot threadpool, and forty concurrent frames each holding a 6 664 x 6 657
# mask plus a ResNet-18 ensemble is an OOM, not parallelism.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="neurite-metrics")

_UPLOAD_ROOT = Path(os.getenv("UPLOAD_DIR", "/app/uploads")).resolve()

#: Largest frame this endpoint will rasterise, in pixels. The packaged sample is
#: 44.4 Mpx and takes ~38 s; the cap is ~1.5x that so a plausible larger frame
#: still runs while a malformed request cannot ask for a terabyte of mask.
_MAX_PIXELS = 64_000_000


def _safe_path(p: Path, label: str) -> Path:
    """Resolve *p* and refuse anything outside the storage root."""
    try:
        resolved = p.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid path for {label}")
    if (
        not str(resolved).startswith(str(_UPLOAD_ROOT) + os.sep)
        and resolved != _UPLOAD_ROOT
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Path for {label} is outside the allowed storage root",
        )
    return resolved


class NeuritePolygonInput(BaseModel):
    """One polygon in (x, y) pixel coordinates.

    ``polygon_id`` round-trips into the response so Node can join a row back to
    the record the user edited.
    """

    model_config = ConfigDict(extra="forbid")

    polygon_id: str
    points: List[List[float]]
    #: Interior rings, subtracted after the outer ring is filled.
    holes: Optional[List[List[List[float]]]] = None


class NeuriteMetricsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame: str
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    um_per_px: float = Field(..., gt=0)
    soma_polygons: List[NeuritePolygonInput]
    neurite_polygons: List[NeuritePolygonInput]
    #: Absolute path to the raw frame on the ML container. Required whenever
    #: `classify` is true: the soma classifier reads pixel crops, not the mask.
    image_path: Optional[str] = None
    #: Optional with a None default ON PURPOSE -- this model is `extra="forbid"`,
    #: so a field an older Node has not learned to send would 422 the whole
    #: export. Absent means "use the default", which is to classify.
    classify: Optional[bool] = None


class NeuriteRow(BaseModel):
    """One primary neurite, credited to one soma.

    A primary neurite is a process leaving a soma, not a polygon: one connected
    mask component can host several of them, and a neurite bridging two cells is
    reported TWICE -- once per soma, each holding half the length and the same
    `connection_id`. Pair on `(frame, connection_id)`, never on the id alone.
    """

    model_config = ConfigDict(extra="allow")

    frame: str
    soma_id: int
    neurite_id: str
    length_um: Optional[float] = None
    extent_um: Optional[float] = None
    staging_length_um: Optional[float] = None
    is_bridge: Optional[bool] = None


class SomaRow(BaseModel):
    model_config = ConfigDict(extra="allow")

    frame: str
    soma_id: int
    stage: Optional[str] = None
    stage_reason: Optional[str] = None


class NeuriteMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    neurites: List[Dict[str, Any]]
    somas: List[Dict[str, Any]]
    qc: Dict[str, Any]
    #: soma_id -> the caller's polygon_id it was rasterised from. The pipeline
    #: numbers somas 1..N in label order; this is what turns those back into
    #: records the editor can highlight.
    soma_polygon_ids: Dict[int, str]
    #: neurite polygon_id -> which soma polygon owns it, for colouring the
    #: editor. `shared` says the polygon carries cable from more than one cell,
    #: which is a real state (a neurite bridging two somas) and not an error --
    #: the colour is then the MAJORITY owner and `owned_fraction` says how much
    #: of a simplification that is.
    neurite_owners: Dict[str, Dict[str, Any]]


def _rasterise(
    polygons: List[NeuritePolygonInput],
    shape: tuple[int, int],
    *,
    label_each: bool,
) -> np.ndarray:
    """Fill *polygons* into an array.

    ``label_each`` gives every polygon its own 1-based label (soma instances);
    otherwise everything is filled with 1 (the neurite class, where instance
    identity comes from the skeleton graph, not from the drawing).
    """
    import cv2

    out = np.zeros(shape, np.int32 if label_each else np.uint8)
    for i, poly in enumerate(polygons, start=1):
        if len(poly.points) < 3:
            # Not a fillable ring. Skipped rather than rejected: a degenerate
            # polygon is a drawing artefact, and failing the whole export over
            # one is worse than measuring the other few hundred.
            continue
        pts = np.array(
            [[int(round(x)), int(round(y))] for x, y in poly.points], np.int32
        )
        cv2.fillPoly(out, [pts], i if label_each else 1)
        for hole in poly.holes or []:
            if len(hole) < 3:
                continue
            hp = np.array(
                [[int(round(x)), int(round(y))] for x, y in hole], np.int32
            )
            cv2.fillPoly(out, [hp], 0)
    return out


def _compute(req: NeuriteMetricsRequest) -> NeuriteMetricsResponse:
    from models.neurite_metrics import analyse_frame

    shape = (req.height, req.width)
    soma_inst = _rasterise(req.soma_polygons, shape, label_each=True)
    # Labelled, not binary: the pipeline assigns per skeleton branch, and
    # mapping that back to the polygon the user drew needs to know WHICH
    # polygon each pixel came from. The semantic mask below still collapses it
    # to one class -- a neurite's identity comes from the graph, not the
    # drawing.
    neurite_labels = _rasterise(req.neurite_polygons, shape, label_each=True)

    classify = True if req.classify is None else req.classify
    image = None
    if classify:
        if not req.image_path:
            raise HTTPException(
                status_code=400,
                detail="image_path is required when classify is true: the soma "
                "classifier reads pixel crops, not the mask",
            )
        from PIL import Image

        Image.MAX_IMAGE_PIXELS = None
        path = _safe_path(Path(req.image_path), "image_path")
        if not path.is_file():
            raise HTTPException(
                status_code=404, detail=f"Frame not found: {req.image_path}"
            )
        image = np.array(Image.open(path))
        if image.shape[:2] != shape:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Frame is {image.shape[1]}x{image.shape[0]} but the polygons "
                    f"were drawn on {req.width}x{req.height}. The classifier crops "
                    "from the frame, so a mismatch would score the wrong pixels."
                ),
            )

    # `analyse_frame` wants the 3-class mask. Soma wins where the two overlap:
    # a pixel the user drew as both is a cell body with a process starting on
    # it, and counting it as neurite would grow a spur into the soma.
    semantic = np.where(soma_inst > 0, 2, (neurite_labels > 0).astype(np.uint8))

    # The labelling is handed IN. Without it `analyse_frame` re-derives its own
    # with S1 and the ids in the returned rows have nothing to do with the
    # polygons that were sent: measured on the packaged sample, 149 polygons in,
    # 168 S1 instances out, and `soma_polygon_ids` below was quietly joining two
    # unrelated numberings while looking entirely well-formed.
    result = analyse_frame(
        semantic,
        req.um_per_px,
        image=image,
        frame=req.frame,
        classify=classify,
        soma_instances=soma_inst,
        neurite_labels=neurite_labels,
    )

    # The pipeline re-derives its own soma labels from the mask, but because we
    # handed it one label per polygon they are the same integers -- so the map
    # back is the input order. Built from the labels PRESENT in the rasterised
    # array rather than from the request list, because a degenerate polygon was
    # skipped above and would otherwise shift every id after it.
    present = {int(v) for v in np.unique(soma_inst) if v}
    soma_polygon_ids = {
        i: poly.polygon_id
        for i, poly in enumerate(req.soma_polygons, start=1)
        if i in present
    }

    # Ownership comes back keyed by LABEL; the editor needs polygon ids. Built
    # from the labels present in the rasterised array for the same reason as
    # the soma map: a degenerate ring was skipped and would otherwise shift
    # every id after it.
    neurite_present = {int(v) for v in np.unique(neurite_labels) if v}
    neurite_ids = {
        i: poly.polygon_id
        for i, poly in enumerate(req.neurite_polygons, start=1)
        if i in neurite_present
    }
    neurite_owners: Dict[str, Dict[str, Any]] = {}
    for label, info in result.polygon_owner.items():
        polygon_id = neurite_ids.get(label)
        if polygon_id is None:
            continue
        soma_polygon = soma_polygon_ids.get(int(info['soma_id']))
        if soma_polygon is None:
            continue
        neurite_owners[polygon_id] = {
            'soma_polygon_id': soma_polygon,
            'shared': bool(info['shared']),
            'owned_fraction': info['owned_fraction'],
        }

    return NeuriteMetricsResponse(
        neurites=result.neurites,
        somas=result.somas,
        qc=result.qc,
        soma_polygon_ids=soma_polygon_ids,
        neurite_owners=neurite_owners,
    )


@router.post("/neurite-metrics", response_model=NeuriteMetricsResponse)
async def neurite_metrics(request: NeuriteMetricsRequest) -> NeuriteMetricsResponse:
    """Per-neurite and per-soma tables for one frame."""
    if request.width * request.height > _MAX_PIXELS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Frame is {request.width}x{request.height} = "
                f"{request.width * request.height} px, over the "
                f"{_MAX_PIXELS} px limit for this endpoint"
            ),
        )
    if not request.soma_polygons:
        # Every table row is keyed by a soma, so without one there is nothing to
        # compute. Answered as an empty result rather than an error: a frame
        # where the model found no cell bodies is a measurement.
        return NeuriteMetricsResponse(
            neurites=[],
            somas=[],
            qc={"n_soma_instances": 0, "n_soma_accepted": 0},
            soma_polygon_ids={},
            neurite_owners={},
        )
    return await asyncio.get_running_loop().run_in_executor(
        _EXECUTOR, _compute, request
    )
