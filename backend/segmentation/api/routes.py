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

# Import ML exceptions
from services.inference import InferenceTimeoutError, InferenceError

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

@router.get("/health/inference")
async def inference_health_check(loader = Depends(get_model_loader)):
    """Test inference capability with a small test image"""
    try:
        # Create a small test image (32x32 RGB)
        import numpy as np
        test_array = np.random.randint(0, 255, (32, 32, 3), dtype=np.uint8)
        test_image = Image.fromarray(test_array)
        
        start_time = time.time()
        
        # Try a quick inference with the loaded model (hrnet by default)
        # This will detect if inference is hanging
        result = loader.predict(test_image, "hrnet", 0.5, False)
        
        inference_time = time.time() - start_time
        
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "inference_test": {
                "success": True,
                "duration_seconds": round(inference_time, 3),
                "polygons_found": len(result.get("polygons", [])),
                "test_image_size": "32x32"
            },
            "current_state": {
                "is_processing": getattr(loader, 'is_processing', False),
                "current_model": getattr(loader, 'current_model', None)
            }
        }
        
    except Exception as e:
        logger.error(f"Inference health check failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "unhealthy",
                "timestamp": datetime.now().isoformat(),
                "error": str(e),
                "inference_test": {
                    "success": False,
                    "error_type": type(e).__name__
                }
            }
        )

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
    detect_holes: bool = Form(True, description="Whether to detect holes in segmentation"),
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
        
        logger.info(f"Processing image: {file.filename}, Model: {model}, Threshold: {threshold}, Detect holes: {detect_holes}")
        
        # Perform segmentation
        result = loader.predict(image, model, threshold, detect_holes)
        
        processing_time = time.time() - start_time
        
        # Add processing time to result
        result["processing_time"] = processing_time
        result["success"] = True
        
        # Add warning metadata if no polygons detected
        polygon_count = len(result.get('polygons', []))
        if polygon_count == 0:
            result["warning"] = "No polygons detected - image may not contain detectable cells or threshold may need adjustment"
            logger.warning(f"Segmentation completed in {processing_time:.2f}s, but found 0 polygons - potential detection issue")
        else:
            logger.info(f"Segmentation completed in {processing_time:.2f}s, found {polygon_count} polygons")
        
        return result
        
    except HTTPException:
        raise
    except TimeoutError as e:
        # Handle timeout errors with detailed information
        processing_time = time.time() - start_time
        logger.error(f"Segmentation timeout after {processing_time:.2f}s for model {model}: {e}")
        
        error_detail = {
            "error": "Model inference timeout",
            "message": str(e),
            "model": model,
            "suggestion": "Try using a simpler model (hrnet) or reducing image size",
            "processing_time": processing_time
        }
        
        raise HTTPException(status_code=504, detail=error_detail)
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
    detect_holes: bool = Form(True, description="Whether to detect holes in segmentation"),
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
                
                logger.info(f"Processing batch image {i+1}/{len(files)}: {file.filename}, Model: {model}, Threshold: {threshold}, Detect holes: {detect_holes}")
                
                # Perform segmentation
                result = loader.predict(image, model, threshold, detect_holes)
                
                # Add file information to result
                result["filename"] = file.filename
                result["batch_index"] = i
                result["success"] = True
                
                results.append(result)
                
                logger.info(f"Batch image {i+1} completed, found {len(result['polygons'])} polygons")
                
            except (InferenceTimeoutError, TimeoutError) as e:
                logger.error(f"Timeout processing batch image {i+1}: {file.filename}: {e}")
                
                # Extract timeout details
                if isinstance(e, InferenceTimeoutError):
                    error_msg = f"Timeout after {e.timeout}s for model '{e.model_name}'"
                    error_detail = {
                        "type": "timeout",
                        "message": str(e),
                        "model": e.model_name,
                        "timeout": e.timeout,
                        "image_size": e.image_size
                    }
                else:
                    error_msg = "Inference timeout"
                    error_detail = str(e)
                
                # Add timeout error result
                results.append({
                    "filename": file.filename,
                    "batch_index": i,
                    "success": False,
                    "error": error_msg,
                    "error_detail": error_detail,
                    "polygons": [],
                    "model_used": model,
                    "threshold_used": threshold
                })
                
            except InferenceError as e:
                logger.error(f"Inference error processing batch image {i+1}: {file.filename}: {e}")
                
                # Add inference error result
                results.append({
                    "filename": file.filename,
                    "batch_index": i,
                    "success": False,
                    "error": "Inference failed",
                    "error_detail": str(e),
                    "polygons": [],
                    "model_used": model,
                    "threshold_used": threshold
                })
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