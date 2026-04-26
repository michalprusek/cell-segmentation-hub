import logging
import os
import sys
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy.stats import wasserstein_distance

# Import characteristic_functions from utils package
from utils.characteristic_functions import calculate_all

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


class DisintegrationResponse(BaseModel):
    di: float
    w1: float
    reference: str  # 'core' | 'r_eff' | 'r_eff_fallback' | 'none'
    n_pixels: int

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
        raise HTTPException(status_code=500, detail=f"Failed to calculate metrics: {str(e)}")

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
    """Compute the per-image Disintegration Index (DI).

    Reduces the binary mask polygon to a 1-D radial distribution of pixel
    distances from the centroid, normalises by R_ref (derived from core
    area if provided, else from mask area), and measures the
    1-Wasserstein distance to the analytical CDF of a uniform disk
    `F_ref(d̃) = d̃²`. The raw W1 is squashed via `tanh` into `[0, 1)`.
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

        # Step 1: rasterise the optional core polygon(s). The core's centroid,
        # when available, is the *anchor* for both d_mask and d_core — that
        # way the metric measures "how far did mass spread from where the
        # dense core sits", not the smeared mass centroid that drifts toward
        # the invasion zone.
        ref_label = "r_eff"
        r_ref: Optional[float] = None
        d_core: Optional[np.ndarray] = None
        candidate_cores: List[List[List[float]]] = []
        if request.core_polygons:
            candidate_cores = request.core_polygons
        elif request.core_polygon is not None:
            candidate_cores = [request.core_polygon]

        ys_c: Optional[np.ndarray] = None
        xs_c: Optional[np.ndarray] = None
        if candidate_cores:
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
            if valid_count > 0 and n_core > 0:
                ys_c, xs_c = np.nonzero(core_mask)
                r_ref = float(np.sqrt(n_core / np.pi))
                ref_label = "core"
            else:
                ref_label = "r_eff_fallback"

        # Step 2: choose the centroid. Prefer the core's centroid (improvement A
        # over the original mass-weighted mask centroid); fall back to the mask
        # centroid only when no core is available.
        if xs_c is not None and ys_c is not None and xs_c.size > 0:
            cx = float(xs_c.mean())
            cy = float(ys_c.mean())
            d_core = np.hypot(xs_c - cx, ys_c - cy)
        else:
            cx = float(xs.mean())
            cy = float(ys.mean())
        d_mask = np.hypot(xs - cx, ys - cy)

        if r_ref is None:
            r_ref = float(np.sqrt(n / np.pi))
        if r_ref <= 0:
            return DisintegrationResponse(
                di=0.0, w1=0.0, reference=ref_label, n_pixels=n
            )

        if d_core is not None and d_core.size > 0:
            # Empirical-CDF reference: compare the radial distance distribution
            # of mask pixels against the same distribution of core pixels —
            # both anchored on the core's centroid. Normalised by R_core to
            # keep the metric scale-invariant.
            w1_px = float(wasserstein_distance(d_mask, d_core))
            w1 = w1_px / r_ref
        else:
            # No core: fall back to the equivalent-disk reference CDF
            # F_ref(d̃) = d̃² in the d̃ = d / R_eff space.
            d_tilde = np.sort(d_mask / r_ref)
            u = (np.arange(n, dtype=np.float64) + 0.5) / n
            w1 = float(np.mean(np.abs(d_tilde - np.sqrt(u))))
        di = float(np.tanh(w1))

        return DisintegrationResponse(
            di=di, w1=w1, reference=ref_label, n_pixels=n
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
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute disintegration index: {exc}",
        ) from exc


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