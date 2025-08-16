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
        
        # Calculate metrics for main contour
        metrics = calculate_all(contour)
        
        # If there are holes, subtract their areas
        if request.holes:
            total_hole_area = 0
            for hole in request.holes:
                hole_contour = np.array(hole, dtype=np.float32)
                if len(hole_contour.shape) == 2:
                    hole_contour = hole_contour.reshape((-1, 1, 2))
                hole_area = cv2.contourArea(hole_contour)
                total_hole_area += hole_area
            
            # Adjust area by subtracting hole areas
            metrics["Area"] -= total_hole_area
            
            # Recalculate metrics that depend on area
            if metrics["Area"] > 0:
                metrics["EquivalentDiameter"] = np.sqrt(4 * metrics["Area"] / np.pi)
                metrics["Circularity"] = (4 * np.pi * metrics["Area"]) / (metrics["Perimeter"] ** 2) if metrics["Perimeter"] > 0 else 0
                metrics["Sphericity"] = np.pi * np.sqrt(4 * metrics["Area"] / np.pi) / metrics["Perimeter"] if metrics["Perimeter"] > 0 else 0
            else:
                # Set safe values when area is non-positive
                metrics["EquivalentDiameter"] = 0
                metrics["Circularity"] = 0
                metrics["Sphericity"] = 0
        
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
                Sphericity=0
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
            "Perimeter": "Total length of the polygon boundary in pixels",
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