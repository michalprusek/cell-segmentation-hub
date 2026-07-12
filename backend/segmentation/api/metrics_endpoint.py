import logging
import os
import sys
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Import characteristic_functions from utils package
from utils.characteristic_functions import calculate_all
from api._errors import internal_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["metrics"])


class DisintegrationRequest(BaseModel):
    """Request body for DI computation.

    `mask_polygons` (plural, preferred) is the list of every external polygon
    forming the total cell-covered area; they are rasterised into a single
    binary mask via union (cv2.fillPoly applied per polygon to the same
    canvas). DI is then computed from that union.
    `mask_polygon` (singular) is kept for backward compatibility — same as
    passing a one-element list.
    `core_polygons` is the list of dense core fragments; their combined
    rasterised area defines R_core. `core_polygon` (singular) is the legacy
    single-polygon variant.
    """
    mask_polygon: Optional[List[List[float]]] = None
    mask_polygons: Optional[List[List[List[float]]]] = None
    core_polygon: Optional[List[List[float]]] = None
    core_polygons: Optional[List[List[List[float]]]] = None
    image_width: int
    image_height: int


# Speckle guard for the fragmentation/porosity panel metrics. Exposed in the
# response so results are reproducible; keep in sync with the metrics guide.
_DI_CLOSING_RADIUS_PX = 2
_DI_MIN_FRAGMENT_PX = 30
_DI_MIN_HOLE_PX = 30


class DisintegrationResponse(BaseModel):
    di: float
    w1: float
    reference: str  # 'core' | 'no_core' | 'none'
    n_pixels: int

    # --- disintegration metric panel (populated only when reference == 'core';
    # every field stays None for no_core / none so callers render N/A) ---
    # Axis A (radial dispersal): 95th percentile of core-normalised distances.
    radial_reach_q95: Optional[float] = None
    # Axis B (mass partition): fraction of FG mass outside the core.
    dispersed_mass_fraction: Optional[float] = None
    # Axis C (fragmentation): connected components of FG after a speckle guard.
    fragment_count: Optional[int] = None
    largest_fragment_fraction: Optional[float] = None
    # Axis D (porosity): FG solidity + enclosed-hole count (Betti-1).
    solidity: Optional[float] = None
    hole_count: Optional[int] = None
    # Rasterised region sizes (px) — FG = C ∪ K, so n_fg_px = n_core_px + n_corona_px.
    n_core_px: Optional[int] = None
    n_corona_px: Optional[int] = None
    n_fg_px: Optional[int] = None
    # Axis E (absolute size): equivalent diameters 2*sqrt(N/pi) in pixels.
    core_equiv_diameter_px: Optional[float] = None
    whole_equiv_diameter_px: Optional[float] = None
    # Echoed speckle-guard settings for reproducibility.
    closing_radius_px: Optional[int] = None
    min_fragment_px: Optional[int] = None

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
async def calculate_metrics(request: MetricsRequest):
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
async def batch_calculate_metrics(polygons: List[MetricsRequest]) -> List[MetricsResponse]:
    """
    Calculate metrics for multiple polygons in batch.
    """
    results = []
    for polygon_request in polygons:
        try:
            metrics = await calculate_metrics(polygon_request)
            results.append(metrics)
        except Exception as e:
            # Return default values on error
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
async def disintegration_index(request: DisintegrationRequest):
    """Compute the per-image core-anchored Disintegration Index (DI).

    Implements the paper's core-anchored DI. Radial distances of every
    foreground pixel are measured from the **core centroid** and normalised by
    the core's effective radius ``R_C = sqrt(N_core / pi)`` to give
    ``d̃ = d / R_C``. The empirical CDF of ``{d̃}`` is compared, via the
    1-Wasserstein distance in inverse-cumulative (quantile) form, to the
    analytical CDF of a uniform filled disk ``F_ref(d̃) = min(d̃², 1)`` whose
    inverse is ``F_ref⁻¹(u) = sqrt(u)``::

        W1 = ∫₀¹ |d̃(u) − sqrt(u)| du ≈ (1/N) Σ_i |d̃₍ᵢ₎ − sqrt((i + 0.5) / N)|
        DI = tanh(W1)  ∈ [0, 1)

    An intact spheroid (foreground ≈ core) gives ``d̃ ≤ 1`` distributed as a
    filled disk and ``DI ≈ 0``; as mass disperses to ``d̃ ≫ 1``, ``DI → 1``.

    A valid core is **required** — the DI is undefined without one. When no
    usable core polygon is supplied (or it rasterises to zero pixels) the
    endpoint returns ``reference='no_core'`` with ``di=0.0`` as an N/A
    sentinel; callers must render it as N/A, never as a computed zero. There
    is deliberately no equivalent-disk (``r_eff``) fallback.
    """
    try:
        H = int(request.image_height)
        W = int(request.image_width)
        if H <= 0 or W <= 0:
            raise HTTPException(
                status_code=400, detail="image_width/image_height must be positive"
            )

        # Build a UNION mask from every supplied external polygon.
        # `mask_polygons` (plural) is the preferred input — represents the full
        # ASPP segmentation (all spheroids in one canvas). `mask_polygon`
        # (singular) is a legacy alias for a single-element list.
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

        mask = np.zeros((H, W), dtype=np.uint8)
        valid_masks = 0
        for poly in mask_polys:
            pts = np.asarray(poly, dtype=np.float32)
            if pts.ndim == 2 and pts.shape[1] == 2 and pts.shape[0] >= 3:
                cv2.fillPoly(mask, [pts.astype(np.int32)], 1)
                valid_masks += 1
        if valid_masks == 0:
            return DisintegrationResponse(
                di=0.0, w1=0.0, reference="none", n_pixels=0
            )
        ys, xs = np.nonzero(mask)
        n = int(xs.size)
        if n == 0:
            return DisintegrationResponse(
                di=0.0, w1=0.0, reference="none", n_pixels=0
            )

        # Step 1: rasterise the REQUIRED core polygon(s). The core defines both
        # the anchor (its centroid) and the normalising radius R_C; without a
        # valid core the metric is undefined.
        candidate_cores: List[List[List[float]]] = []
        if request.core_polygons:
            candidate_cores = request.core_polygons
        elif request.core_polygon is not None:
            candidate_cores = [request.core_polygon]

        core_mask = np.zeros((H, W), dtype=np.uint8)
        valid_count = 0
        for poly in candidate_cores:
            core_pts_arr = np.asarray(poly, dtype=np.float32)
            if (
                core_pts_arr.ndim == 2
                and core_pts_arr.shape[1] == 2
                and core_pts_arr.shape[0] >= 3
            ):
                cv2.fillPoly(core_mask, [core_pts_arr.astype(np.int32)], 1)
                valid_count += 1
        n_core = int(core_mask.sum())
        if valid_count == 0 or n_core == 0:
            # DI requires a core. A malformed/off-canvas/collinear core (or no
            # core at all) yields an explicit N/A instead of a fabricated value.
            logger.warning(
                "DI requires a valid core polygon; none usable "
                "(provided=%d valid_shape=%d rasterised_pixels=%d image=%dx%d) "
                "-> reference='no_core'",
                len(candidate_cores), valid_count, n_core, W, H,
            )
            return DisintegrationResponse(
                di=0.0, w1=0.0, reference="no_core", n_pixels=n
            )

        r_ref = float(np.sqrt(n_core / np.pi))  # R_C
        if r_ref <= 0:
            return DisintegrationResponse(
                di=0.0, w1=0.0, reference="no_core", n_pixels=n
            )

        # Step 2: anchor radial distances on the CORE centroid — the metric
        # measures how far mass spread from where the dense core sits, not the
        # smeared mask centroid that drifts toward the invasion zone.
        ys_c, xs_c = np.nonzero(core_mask)
        cx = float(xs_c.mean())
        cy = float(ys_c.mean())
        d_mask = np.hypot(xs - cx, ys - cy)

        # Step 3: 1-Wasserstein distance between the core-normalised foreground
        # distances and the analytical uniform-disk reference F_ref(d̃)=min(d̃²,1)
        # (inverse sqrt(u)), in inverse-cumulative form. This is exactly eq. (1).
        d_tilde = np.sort(d_mask / r_ref)
        u = (np.arange(n, dtype=np.float64) + 0.5) / n
        w1 = float(np.mean(np.abs(d_tilde - np.sqrt(u))))
        di = float(np.tanh(w1))

        # Step 4: companion panel metrics spanning the other disintegration axes,
        # all derived from the same rasterised masks. FG = C ∪ K (union of the
        # foreground mask and the core) so the core is always inside FG even if
        # its polygon slightly overhangs the mask.
        panel = _compute_panel_metrics(mask | core_mask, cx, cy, r_ref, n_core)

        return DisintegrationResponse(
            di=di, w1=w1, reference="core", n_pixels=n, **panel
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


def _compute_panel_metrics(
    fg_mask: np.ndarray, cx: float, cy: float, r_ref: float, n_core: int
) -> Dict[str, Any]:
    """Companion disintegration metrics from the rasterised foreground mask.

    Spans the axes DI does not: radial reach (A), fragmentation (C) and porosity
    (D), plus rasterised region sizes (E). All are size/resolution comparable or
    reported with their pixel context. ``fg_mask`` is the binary FG = C ∪ K.
    """
    ys_fg, xs_fg = np.nonzero(fg_mask)
    n_fg = int(xs_fg.size)
    n_corona = max(0, n_fg - int(n_core))

    # Axis A companion — 95th percentile of core-normalised FG distances (reach
    # of the leading edge, in core radii).
    d_fg = np.hypot(xs_fg - cx, ys_fg - cy) / r_ref
    radial_reach_q95 = float(np.percentile(d_fg, 95)) if n_fg > 0 else 0.0

    # Axis C — fragmentation. Close small gaps, drop speckle, count components.
    ksz = 2 * _DI_CLOSING_RADIUS_PX + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksz, ksz))
    closed = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)
    num_labels, _labels, stats, _cent = cv2.connectedComponentsWithStats(
        closed, connectivity=8
    )
    if num_labels > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]  # skip background label 0
        kept = areas[areas >= _DI_MIN_FRAGMENT_PX]
    else:
        kept = np.empty(0, dtype=np.int64)
    fragment_count = int(kept.size)
    # Fraction of the de-speckled mass in the single largest piece. Denominator
    # is the kept-component total (not raw n_fg) so closing can't push it past 1.
    kept_total = int(kept.sum())
    largest_fragment_fraction = (
        float(int(kept.max()) / kept_total) if kept_total > 0 else 0.0
    )

    # Axis D — porosity. Solidity = FG area / convex-hull area; hole count is the
    # number of enclosed background regions (Betti-1) above the speckle floor.
    solidity = 0.0
    if n_fg >= 3:
        hull = cv2.convexHull(np.column_stack([xs_fg, ys_fg]).astype(np.int32))
        hull_area = float(cv2.contourArea(hull))
        if hull_area > 0:
            # Clamp to 1.0: pixel-count / hull-polygon-area can drift slightly
            # above 1 for convex shapes due to rasterisation.
            solidity = min(1.0, float(n_fg / hull_area))

    hole_count = 0
    contours, hierarchy = cv2.findContours(
        (fg_mask > 0).astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )
    if hierarchy is not None:
        for idx, node in enumerate(hierarchy[0]):
            # node = [next, prev, first_child, parent]; a parent means this is a
            # hole contour nested inside a foreground component.
            if node[3] != -1 and cv2.contourArea(contours[idx]) >= _DI_MIN_HOLE_PX:
                hole_count += 1

    # Axis B — dispersed-mass fraction f_disp = N_K / N_FG (share of mass outside
    # the dense core). Axis E — equivalent diameters 2*sqrt(N/pi) in pixels.
    dispersed_mass_fraction = float(n_corona / n_fg) if n_fg > 0 else 0.0
    core_equiv_diameter_px = float(2.0 * np.sqrt(int(n_core) / np.pi))
    whole_equiv_diameter_px = float(2.0 * np.sqrt(n_fg / np.pi)) if n_fg > 0 else 0.0

    return {
        "radial_reach_q95": radial_reach_q95,
        "dispersed_mass_fraction": dispersed_mass_fraction,
        "fragment_count": fragment_count,
        "largest_fragment_fraction": largest_fragment_fraction,
        "solidity": solidity,
        "hole_count": hole_count,
        "n_core_px": int(n_core),
        "n_corona_px": n_corona,
        "n_fg_px": n_fg,
        "core_equiv_diameter_px": core_equiv_diameter_px,
        "whole_equiv_diameter_px": whole_equiv_diameter_px,
        "closing_radius_px": _DI_CLOSING_RADIUS_PX,
        "min_fragment_px": _DI_MIN_FRAGMENT_PX,
    }


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