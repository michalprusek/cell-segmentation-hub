"""API routes for segmentation microservice"""

import time
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Query, Form
from fastapi.responses import JSONResponse
import torch

from .models import (
    SegmentationResponse, ModelsResponse, HealthResponse, 
    ErrorResponse, ModelType, ModelInfo
)
from PIL import Image
import io

logger = logging.getLogger(__name__)

# Initialize router
router = APIRouter()

from fastapi import Request

def get_model_loader(request: Request):
    """Dependency to get the global model loader"""
    if not hasattr(request.app.state, 'model_loader'):
        raise HTTPException(status_code=503, detail="Model loader not initialized")
    return request.app.state.model_loader

def validate_image(file: UploadFile) -> bool:
    """Validate if the uploaded file is a valid image"""
    valid_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.bmp'}
    if not file.filename:
        return False
    
    # Extract file extension more safely
    filename_parts = file.filename.split('.')
    if len(filename_parts) < 2:
        return False
    
    ext = '.' + filename_parts[-1].lower()
    return ext in valid_extensions

@router.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        device_info = {
            "gpu_available": torch.cuda.is_available(),
            "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
            "device_name": torch.cuda.get_device_name() if torch.cuda.is_available() else "CPU"
        }
        
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "service": "cell-segmentation",
            "version": "1.0.0",
            "device": device_info
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail="Health check failed")

@router.get("/models")
async def get_models(loader = Depends(get_model_loader)):
    """Get available models information"""
    try:
        models_info = loader.get_model_info()
        return {"models": models_info}
        
    except Exception as e:
        logger.error(f"Failed to get models info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get models information")

@router.get("/status")
async def get_status(loader = Depends(get_model_loader)):
    """Get current service status including processing state"""
    try:
        # Check if any model is currently processing
        is_processing = hasattr(loader, 'is_processing') and loader.is_processing
        current_model = getattr(loader, 'current_model', None)
        queue_length = getattr(loader, 'queue_length', 0)
        
        return {
            "status": "processing" if is_processing else "idle",
            "is_processing": is_processing,
            "current_model": current_model,
            "queue_length": queue_length,
            "available": not is_processing,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get status: {e}")
        return {
            "status": "error",
            "is_processing": False,
            "current_model": None,
            "queue_length": 0,
            "available": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

@router.post("/segment")
async def segment_image(
    file: UploadFile = File(...),
    model: str = Form("hrnet", description="Model to use for segmentation"),
    threshold: float = Form(0.5, ge=0.1, le=0.9, description="Segmentation threshold"),
    loader = Depends(get_model_loader)
):
    """Main segmentation endpoint"""
    start_time = time.time()
    
    try:
        # Validate uploaded file
        if not validate_image(file):
            raise HTTPException(
                status_code=400, 
                detail="Invalid image file. Supported formats: PNG, JPG, JPEG, TIFF, BMP"
            )
        
        # Read image data and convert to PIL Image
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        
        logger.info(f"Processing image: {file.filename}, Model: {model}, Threshold: {threshold}")
        
        # Perform segmentation
        result = loader.predict(image, model, threshold)
        
        processing_time = time.time() - start_time
        
        # Add processing time to result
        result["processing_time"] = processing_time
        result["success"] = True
        
        logger.info(f"Segmentation completed in {processing_time:.2f}s, found {len(result['polygons'])} polygons")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Segmentation failed after {processing_time:.2f}s: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Segmentation failed: {str(e)}"
        )

@router.post("/batch-segment")
async def batch_segment_images(
    files: list[UploadFile] = File(..., description="List of images to segment"),
    model: str = Form("hrnet", description="Model to use for segmentation"),
    threshold: float = Form(0.5, ge=0.1, le=0.9, description="Segmentation threshold"),
    loader = Depends(get_model_loader)
):
    """Batch segmentation endpoint for processing multiple images"""
    start_time = time.time()
    
    try:
        # Get batch size limits from loader configuration
        max_batch_size = loader.get_batch_limit(model)
        if len(files) > max_batch_size:
            raise HTTPException(
                status_code=400,
                detail=f"Batch size for {model} model cannot exceed {max_batch_size} images"
            )
        
        # Validate all files
        for file in files:
            if not validate_image(file):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid image file: {file.filename}. Supported formats: PNG, JPG, JPEG, TIFF, BMP"
                )
        
        results = []
        
        # Process each image in the batch
        for i, file in enumerate(files):
            try:
                # Read image data and convert to PIL Image
                image_data = await file.read()
                image = Image.open(io.BytesIO(image_data))
                
                logger.info(f"Processing batch image {i+1}/{len(files)}: {file.filename}, Model: {model}, Threshold: {threshold}")
                
                # Perform segmentation
                result = loader.predict(image, model, threshold)
                
                # Add file information to result
                result["filename"] = file.filename
                result["batch_index"] = i
                result["success"] = True
                
                results.append(result)
                
                logger.info(f"Batch image {i+1} completed, found {len(result['polygons'])} polygons")
                
            except Exception as e:
                logger.error(f"Failed to process batch image {i+1}: {file.filename}: {e}")
                
                # Add error result
                results.append({
                    "filename": file.filename,
                    "batch_index": i,
                    "success": False,
                    "error": str(e),
                    "polygons": [],
                    "model_used": model,
                    "threshold_used": threshold
                })
        
        processing_time = time.time() - start_time
        
        # Calculate batch statistics
        successful_count = sum(1 for r in results if r["success"])
        total_polygons = sum(len(r["polygons"]) for r in results if r["success"])
        
        batch_result = {
            "success": True,
            "batch_size": len(files),
            "successful_count": successful_count,
            "failed_count": len(files) - successful_count,
            "total_polygons": total_polygons,
            "model_used": model,
            "threshold_used": threshold,
            "processing_time": processing_time,
            "results": results
        }
        
        logger.info(f"Batch segmentation completed in {processing_time:.2f}s, {successful_count}/{len(files)} successful")
        
        return batch_result
        
    except HTTPException:
        raise
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Batch segmentation failed after {processing_time:.2f}s: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Batch segmentation failed: {str(e)}"
        )

@router.get("/segment/{task_id}")
async def get_segmentation_status(task_id: str):
    """Get status of async segmentation task (placeholder for future async implementation)"""
    # For now, return not implemented since we're using sync processing
    raise HTTPException(
        status_code=501, 
        detail="Async processing not implemented yet. Use /segment endpoint for synchronous processing."
    )