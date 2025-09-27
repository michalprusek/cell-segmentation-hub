from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
import numpy as np
import cv2
import sys
import os

# Import characteristic_functions from utils package
from utils.characteristic_functions import calculate_all

router = APIRouter(prefix="/api", tags=["metrics"])

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