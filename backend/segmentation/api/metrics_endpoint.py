import logging
from typing import List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Import characteristic_functions from utils package
from utils.characteristic_functions import calculate_all
from api._errors import internal_error
from api import disintegration_metrics as dm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["metrics"])


class DisintegrationRequest(BaseModel):
    """Request body for DI computation from STORED POLYGONS.

    This is the fallback path. The authoritative read-out is computed from the
    model's raster argmax mask at inference time (``predict_disintegration`` ->
    ``image_metrics``) and persisted with the segmentation; this endpoint is used
    only when that raster read-out is absent (segmented before it existed) or no
    longer describes the polygons (the user edited them).

    `mask_polygons` (plural, preferred) is the list of every external polygon
    forming the total cell-covered area; they are rasterised into a single
    binary mask via union (cv2.fillPoly applied per polygon to the same
    canvas). `mask_polygon` (singular) is kept for backward compatibility —
    same as passing a one-element list. `core_polygons` is the list of dense
    core fragments; `core_polygon` (singular) is the legacy variant. The two
    are composed into a 3-class mask (1 = foreground, 2 = core, core wins) and
    scored by exactly the paper's algorithm (``api.disintegration_metrics``).
    Holes are not represented: the disintegration model's polygons keep only
    the outer contour of each region, which is one of the reasons this path
    differs from the raster read-out.
    `pixel_size_um` (optional) only feeds the input-scale warning.
    """
    mask_polygon: Optional[List[List[float]]] = None
    mask_polygons: Optional[List[List[List[float]]]] = None
    core_polygon: Optional[List[List[float]]] = None
    core_polygons: Optional[List[List[List[float]]]] = None
    image_width: int
    image_height: int
    pixel_size_um: Optional[float] = None


class DisintegrationResponse(BaseModel):
    """The paper's per-image read-out (compute_di.py field names), plus context.

    ``di``/``w1`` are 0.0 N/A sentinels whenever ``reference != 'core'``;
    callers must render them as N/A. Every other metric is None then.
    """
    di: float
    w1: float
    # 'core' | 'no_core' | 'core_too_small' | 'none'
    reference: str
    n_pixels: int  # foreground pixels (corona + core) of the rasterised mask
    source: str = "polygons"
    algorithm: str = dm.ALGORITHM_SOURCE
    algorithm_sha256: str = dm.ALGORITHM_SOURCE_SHA256
    note: str = ""
    # Index B (Lim et al.): outside-core fraction of the foreground. The paper's primary
    # read-out; DI is the secondary, distance-weighted one.
    index_b: Optional[float] = None
    # 90th percentile of core-normalised foreground distances (in core radii).
    reach_p90: Optional[float] = None
    # Raw 4-connected corona components (no closing, no size floor).
    n_fragments: Optional[int] = None
    largest_fragment_frac: Optional[float] = None
    # Foreground pixels / convex-hull pixels (skimage.convex_hull_image).
    solidity: Optional[float] = None
    area_core_px: Optional[int] = None
    area_corona_px: Optional[int] = None
    area_total_px: Optional[int] = None
    # Core-anchor diagnostics (8-connected core components).
    n_core_components: Optional[int] = None
    largest_core_component_frac: Optional[float] = None
    core_centroid_shift: Optional[float] = None
    core_fragmented: Optional[int] = None
    # Regime flags, as compute_di.py writes them (0/1).
    unvalidated_regime: Optional[int] = None
    below_validated_regime: Optional[int] = None
    warnings: List[str] = []


class Point(BaseModel):
    x: float
    y: float

class MetricsRequest(BaseModel):
    contour: List[List[float]]  # [[x1, y1], [x2, y2], ...]
    holes: List[List[List[float]]] = []  # Optional holes/internal polygons

class MetricsResponse(BaseModel):
    Area: float
    Perimeter: float
    PerimeterWithHoles: float
    EquivalentDiameter: float
    Circularity: float
    FeretDiameterMax: float
    FeretDiameterMaxOrthogonalDistance: float
    FeretDiameterMin: float
    FeretAspectRatio: float
    LengthMajorDiameterThroughCentroid: float
    LengthMinorDiameterThroughCentroid: float
    Compactness: float
    Convexity: float
    Solidity: float
    Sphericity: float
    Extent: float
    BoundingBoxWidth: float
    BoundingBoxHeight: float

@router.post("/calculate-metrics", response_model=MetricsResponse)
# NOTE: these routes are declared `def`, NOT `async def`, ON PURPOSE.
# They are pure CPU (OpenCV/NumPy over full frames) with nothing to await.
# An `async def` handler runs ON the event loop, and this service runs
# `--workers 1`, so one of these would block /segment, /track, /kymograph and
# the compose healthcheck's GET /health for its whole duration — measured at
# 9.84 s on /health before the same fix was applied to /mt-metrics (#480).
# A plain `def` hands the work to Starlette's threadpool instead.
#
# /mt-metrics needed a ONE-SLOT executor rather than the threadpool because
# its `_load_volume` holds 3.4 GB and 40 concurrent slots would OOM. That does
# not apply here: DI holds two H x W uint8 masks (~8 MB at 2048 squared).
def calculate_metrics(request: MetricsRequest):
    """
    Calculate comprehensive metrics for a polygon contour.
    Optionally accounts for holes (internal polygons) by subtracting their areas.
    """
    try:
        # Convert contour to numpy array
        contour = np.array(request.contour, dtype=np.float32)

        if len(contour.shape) == 2:
            contour = contour.reshape((-1, 1, 2))

        # Process hole contours if provided
        hole_contours = []
        if request.holes:
            for hole in request.holes:
                hole_contour = np.array(hole, dtype=np.float32)
                if len(hole_contour.shape) == 2:
                    hole_contour = hole_contour.reshape((-1, 1, 2))
                hole_contours.append(hole_contour)

        # Calculate all metrics with hole support
        metrics = calculate_all(contour, hole_contours if hole_contours else None)

        # If there are holes, adjust the area
        if hole_contours:
            total_hole_area = sum(cv2.contourArea(hole) for hole in hole_contours)
            metrics["Area"] = max(0, metrics["Area"] - total_hole_area)

            # Recalculate area-dependent metrics with adjusted area
            if metrics["Area"] > 0:
                metrics["EquivalentDiameter"] = np.sqrt(4 * metrics["Area"] / np.pi)
                # Circularity and compactness use perimeter WITH holes
                perimeter_with_holes = metrics["PerimeterWithHoles"]
                metrics["Circularity"] = min(1.0, (4 * np.pi * metrics["Area"]) / (perimeter_with_holes ** 2)) if perimeter_with_holes > 0 else 0
                metrics["Compactness"] = (perimeter_with_holes ** 2) / (4 * np.pi * metrics["Area"]) if metrics["Area"] > 0 else 0
                metrics["Sphericity"] = np.pi * np.sqrt(4 * metrics["Area"] / np.pi) / perimeter_with_holes if perimeter_with_holes > 0 else 0
                # Solidity needs recalculation with adjusted area
                hull = cv2.convexHull(contour)
                hull_area = cv2.contourArea(hull)
                metrics["Solidity"] = metrics["Area"] / hull_area if hull_area > 0 else 0
                # Extent needs recalculation
                bbox_area = metrics["BoundingBoxWidth"] * metrics["BoundingBoxHeight"]
                metrics["Extent"] = metrics["Area"] / bbox_area if bbox_area > 0 else 0
            else:
                # Set safe values when area is non-positive
                metrics["EquivalentDiameter"] = 0
                metrics["Circularity"] = 0
                metrics["Compactness"] = 0
                metrics["Sphericity"] = 0
                metrics["Solidity"] = 0
                metrics["Extent"] = 0
        
        return MetricsResponse(**metrics)
        
    except Exception as e:
        raise internal_error(logger, "Failed to calculate metrics", e)

@router.post("/batch-calculate-metrics")
def batch_calculate_metrics(polygons: List[MetricsRequest]) -> List[MetricsResponse]:
    """
    Calculate metrics for multiple polygons in batch.
    """
    results = []
    for polygon_request in polygons:
        try:
            metrics = calculate_metrics(polygon_request)
            results.append(metrics)
        except Exception as e:
            # Returning zeros keeps one bad polygon from failing the whole batch,
            # but doing it silently meant a caller could not tell "area is 0"
            # from "this one blew up". Log which, and why.
            logger.warning(
                "Metrics failed for one polygon in batch; returning zeros: %s", e
            )
            results.append(MetricsResponse(
                Area=0,
                Perimeter=0,
                PerimeterWithHoles=0,
                EquivalentDiameter=0,
                Circularity=0,
                FeretDiameterMax=0,
                FeretDiameterMaxOrthogonalDistance=0,
                FeretDiameterMin=0,
                FeretAspectRatio=0,
                LengthMajorDiameterThroughCentroid=0,
                LengthMinorDiameterThroughCentroid=0,
                Compactness=0,
                Convexity=0,
                Solidity=0,
                Sphericity=0,
                Extent=0,
                BoundingBoxWidth=0,
                BoundingBoxHeight=0
            ))
    
    return results

@router.post("/disintegration-index", response_model=DisintegrationResponse)
def disintegration_index(request: DisintegrationRequest):
    """Core-anchored Disintegration Index (DI) + panel from stored polygons.

    The polygons are composed into a 3-class mask — every external polygon
    filled with 1, every core polygon filled with 2 on top — and scored by
    ``api.disintegration_metrics.disintegration_index``, a verbatim port of the
    paper's ``compute_di.py``::

        R_C = sqrt(N_C / pi);  d~ = |p - c_C| / R_C  (every foreground pixel)
        W1  = mean_u |d~_(u) - sqrt(u)|,  u = (i + 0.5) / N
        DI  = tanh(W1)  in [0, 1)

    with Index B, reach_p90, raw corona fragments, solidity, the core-anchor
    diagnostics and both regime flags defined exactly as the paper defines them.

    DI is undefined without a usable core: no core polygon (or one that
    rasterises to nothing) gives ``reference='no_core'``; a core below
    ``MIN_CORE_PX`` gives ``reference='core_too_small'``; no foreground gives
    ``'none'``. In each case ``di``/``w1`` are 0.0 N/A sentinels and every other
    metric is None — callers must render N/A, never a computed zero.

    This is the FALLBACK path: polygons have passed a minimum-area filter and
    lost their holes, so for an unedited segmentation the raster read-out stored
    at inference time is the authoritative one (``source`` says which was used).
    """
    try:
        H = int(request.image_height)
        W = int(request.image_width)
        if H <= 0 or W <= 0:
            raise HTTPException(
                status_code=400, detail="image_width/image_height must be positive"
            )

        mask_polys: List[List[List[float]]] = []
        if request.mask_polygons:
            mask_polys = request.mask_polygons
        elif request.mask_polygon is not None:
            mask_polys = [request.mask_polygon]
        if not mask_polys:
            raise HTTPException(
                status_code=400,
                detail="At least one of mask_polygons / mask_polygon is required",
            )

        candidate_cores: List[List[List[float]]] = []
        if request.core_polygons:
            candidate_cores = request.core_polygons
        elif request.core_polygon is not None:
            candidate_cores = [request.core_polygon]

        mask3 = np.zeros((H, W), dtype=np.uint8)
        _fill_valid(mask3, mask_polys, 1)
        n_core_valid = _fill_valid(mask3, candidate_cores, 2)

        r = dm.raster_metrics(mask3, W, H, request.pixel_size_um)
        n_fg = int(r["area_total_px"] or 0)
        if r["reference"] != "core":
            if r["reference"] == "no_core":
                # DI requires a core. A malformed/off-canvas/collinear core (or
                # no core at all) yields an explicit N/A, not a fabricated value.
                logger.warning(
                    "DI requires a valid core polygon; none usable "
                    "(provided=%d valid_shape=%d image=%dx%d) -> reference='no_core'",
                    len(candidate_cores), n_core_valid, W, H,
                )
            return DisintegrationResponse(
                di=0.0, w1=0.0, reference=r["reference"], n_pixels=n_fg,
                note=r["note"], warnings=r["warnings"],
                area_core_px=r["area_core_px"] if n_fg else None,
                area_corona_px=r["area_corona_px"] if n_fg else None,
                area_total_px=r["area_total_px"] if n_fg else None,
                n_core_components=r["n_core_components"] if n_fg else None,
                largest_core_component_frac=r["largest_core_component_frac"],
                core_centroid_shift=r["core_centroid_shift"],
            )

        return DisintegrationResponse(
            di=r["DI"], w1=r["W1"], reference="core", n_pixels=n_fg,
            note=r["note"], warnings=r["warnings"],
            index_b=r["index_B"], reach_p90=r["reach_p90"],
            n_fragments=r["n_fragments"],
            largest_fragment_frac=r["largest_fragment_frac"],
            solidity=r["solidity"],
            area_core_px=r["area_core_px"], area_corona_px=r["area_corona_px"],
            area_total_px=r["area_total_px"],
            n_core_components=r["n_core_components"],
            largest_core_component_frac=r["largest_core_component_frac"],
            core_centroid_shift=r["core_centroid_shift"],
            core_fragmented=r["core_fragmented"],
            unvalidated_regime=r["unvalidated_regime"],
            below_validated_regime=r["below_validated_regime"],
        )
    except HTTPException:
        raise
    except (ValueError, cv2.error, MemoryError) as exc:
        logger.exception(
            "DI computation failed: H=%d W=%d n_mask=%d n_core=%d",
            H, W,
            len(request.mask_polygons or [request.mask_polygon])
            if (request.mask_polygons or request.mask_polygon) else 0,
            len(request.core_polygons or [request.core_polygon])
            if (request.core_polygons or request.core_polygon) else 0,
        )
        raise internal_error(
            logger, "Failed to compute disintegration index", exc
        ) from exc


def _fill_valid(canvas: np.ndarray, polys: List[List[List[float]]], value: int) -> int:
    """fillPoly every well-formed polygon (>= 3 [x, y] vertices) with ``value``.

    Returns how many polygons were well-formed. Vertices are truncated to int,
    as the previous endpoint did, so a polygon a caller already sent keeps
    covering the same pixels.
    """
    n = 0
    for poly in polys:
        pts = np.asarray(poly, dtype=np.float32)
        if pts.ndim == 2 and pts.shape[1] == 2 and pts.shape[0] >= 3:
            cv2.fillPoly(canvas, [pts.astype(np.int32)], int(value))
            n += 1
    return n


@router.get("/metrics-info")
async def get_metrics_info():
    """
    Get information about available metrics and their descriptions.
    """
    return {
        "metrics": {
            "Area": "Total area of the polygon in pixels² (with holes subtracted)",
            "Perimeter": "Length of the external polygon boundary in pixels (excluding holes)",
            "EquivalentDiameter": "Diameter of a circle with the same area",
            "Circularity": "Measure of how circular the shape is (0-1, where 1 is a perfect circle)",
            "FeretDiameterMax": "Maximum distance between any two points on the boundary",
            "FeretDiameterMin": "Minimum distance between parallel tangents",
            "FeretAspectRatio": "Ratio of maximum to minimum Feret diameter",
            "Compactness": "Ratio of area to the area of minimum bounding circle",
            "Convexity": "Ratio of convex hull perimeter to actual perimeter",
            "Solidity": "Ratio of area to convex hull area",
            "Sphericity": "Measure of how spherical the shape is"
        },
        "units": "pixels for distances and areas, dimensionless for ratios",
        "version": "1.0.0"
    }