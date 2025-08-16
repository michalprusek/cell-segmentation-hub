"""Postprocessing service for converting masks to polygons"""

import logging
import cv2
import numpy as np
from typing import List, Dict, Any, Tuple
from skimage import measure
from scipy import ndimage

logger = logging.getLogger(__name__)

class PostprocessingService:
    """Service for postprocessing segmentation masks"""
    
    def __init__(self):
        self.min_area = 100  # Minimum polygon area in pixels
        self.simplification_tolerance = 0.1  # Douglas-Peucker tolerance - reduced for higher precision
    
    def mask_to_polygons(self, mask: np.ndarray, threshold: float = 0.5) -> List[Dict[str, Any]]:
        """
        Convert segmentation mask to polygons
        
        Args:
            mask: Numpy array of shape (H, W) with values 0-1
            threshold: Threshold for binarizing the mask
            
        Returns:
            List of polygon dictionaries with points, area, and confidence
        """
        try:
            # Ensure mask is 2D - handle common shapes
            if mask.ndim > 2:
                mask = np.squeeze(mask)
                # If still multi-channel after squeeze, take first channel or aggregate
                if mask.ndim > 2:
                    mask = mask[..., 0] if mask.shape[-1] <= mask.shape[0] else mask[0]
            
            # Convert to binary mask
            binary_mask = (mask > threshold).astype(np.uint8)
            
            # Clean up the mask
            binary_mask = self._clean_mask(binary_mask)
            
            # Find connected components
            labeled_mask = measure.label(binary_mask, connectivity=2)
            regions = measure.regionprops(labeled_mask)
            
            polygons = []
            
            for region in regions:
                # Filter by area
                if region.area < self.min_area:
                    continue
                
                # Get region mask
                region_mask = (labeled_mask == region.label).astype(np.uint8)
                
                # Convert region to polygon
                polygon_data = self._region_to_polygon(region_mask, mask, region)
                
                if polygon_data:
                    polygons.append(polygon_data)
            
            logger.info(f"Converted mask to {len(polygons)} polygons")
            return polygons
            
        except Exception as e:
            logger.error(f"Failed to convert mask to polygons: {e}")
            return []
    
    def _clean_mask(self, binary_mask: np.ndarray) -> np.ndarray:
        """Clean up binary mask by removing noise and filling holes"""
        # Remove small noise
        binary_mask = cv2.medianBlur(binary_mask, 3)
        
        # Morphological operations to clean up
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        
        # Close small gaps
        binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel, iterations=1)
        
        # Remove small objects
        binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        
        # Fill holes
        binary_mask = ndimage.binary_fill_holes(binary_mask).astype(np.uint8)
        
        return binary_mask
    
    def _region_to_polygon(self, region_mask: np.ndarray, original_mask: np.ndarray, 
                          region: Any) -> Dict[str, Any]:
        """Convert a single region to polygon format"""
        try:
            # Find contours - use CHAIN_APPROX_SIMPLE to compress segments
            contours, _ = cv2.findContours(
                region_mask.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            
            if not contours:
                return None
            
            # Get the largest contour (main object boundary)
            main_contour = max(contours, key=cv2.contourArea)
            
            # Use original contour without simplification to preserve all vertices
            # Only apply minimal simplification if contour is extremely large (>5000 points)
            if len(main_contour) > 5000:
                epsilon = self.simplification_tolerance
                simplified_contour = cv2.approxPolyDP(main_contour, epsilon, True)
                logger.info(f"Large contour simplified from {len(main_contour)} to {len(simplified_contour)} points")
            else:
                simplified_contour = main_contour
                logger.info(f"Contour preserved with {len(main_contour)} points")
            
            # Convert to points format
            points = []
            for point in simplified_contour:
                x, y = point[0]
                points.append({"x": float(x), "y": float(y)})
            
            # Need at least 3 points for a polygon
            if len(points) < 3:
                return None
            
            # Calculate confidence as average mask value in the region
            region_coords = np.where(region_mask > 0)
            if len(region_coords[0]) > 0:
                confidence = float(np.mean(original_mask[region_coords]))
            else:
                confidence = 0.5
            
            # Calculate area
            area = float(region.area)
            
            return {
                "points": points,
                "area": area,
                "confidence": confidence
            }
            
        except Exception as e:
            logger.error(f"Failed to convert region to polygon: {e}")
            return None
    
    def filter_polygons(self, polygons: List[Dict[str, Any]], 
                       min_area: int = None, min_confidence: float = None) -> List[Dict[str, Any]]:
        """Filter polygons based on area and confidence"""
        filtered = []
        
        for polygon in polygons:
            # Area filter
            if min_area is not None and polygon["area"] < min_area:
                continue
                
            # Confidence filter
            if min_confidence is not None and polygon["confidence"] < min_confidence:
                continue
                
            filtered.append(polygon)
        
        logger.info(f"Filtered from {len(polygons)} to {len(filtered)} polygons")
        return filtered
    
    def optimize_polygons(self, polygons: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Optimize polygons for better representation"""
        optimized = []
        
        for polygon in polygons:
            try:
                points = polygon["points"]
                
                # Remove duplicate consecutive points
                cleaned_points = []
                for i, point in enumerate(points):
                    if i == 0 or point != points[i-1]:
                        cleaned_points.append(point)
                
                # Ensure polygon is closed (first point == last point)
                if len(cleaned_points) > 2 and cleaned_points[0] != cleaned_points[-1]:
                    cleaned_points.append(cleaned_points[0])
                
                if len(cleaned_points) >= 4:  # At least 3 unique points + closing point
                    polygon["points"] = cleaned_points
                    optimized.append(polygon)
                    
            except Exception as e:
                logger.warning(f"Failed to optimize polygon: {e}")
                # Keep original if optimization fails
                optimized.append(polygon)
        
        return optimized
    
    def polygons_to_coco_format(self, polygons: List[Dict[str, Any]], 
                               image_size: Tuple[int, int]) -> List[Dict[str, Any]]:
        """Convert polygons to COCO format for compatibility"""
        coco_annotations = []
        
        for i, polygon in enumerate(polygons):
            try:
                # Flatten points for COCO format
                segmentation = []
                for point in polygon["points"]:
                    segmentation.extend([point["x"], point["y"]])
                
                # Calculate bounding box
                x_coords = [p["x"] for p in polygon["points"]]
                y_coords = [p["y"] for p in polygon["points"]]
                
                x_min, x_max = min(x_coords), max(x_coords)
                y_min, y_max = min(y_coords), max(y_coords)
                
                bbox = [x_min, y_min, x_max - x_min, y_max - y_min]
                
                coco_annotation = {
                    "id": i + 1,
                    "category_id": 1,  # Single category for cells
                    "segmentation": [segmentation],
                    "area": polygon["area"],
                    "bbox": bbox,
                    "iscrowd": 0,
                    "score": polygon["confidence"]
                }
                
                coco_annotations.append(coco_annotation)
                
            except Exception as e:
                logger.warning(f"Failed to convert polygon {i} to COCO format: {e}")
        
        return coco_annotations