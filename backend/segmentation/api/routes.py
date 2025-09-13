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

# Import new inference exception types
try:
    from ml.inference_executor import InferenceTimeoutError, InferenceError
except ImportError:
    # Fallback for backward compatibility
    InferenceTimeoutError = TimeoutError
    InferenceError = Exception

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
        
        # Perform segmentation with timing
        inference_start = time.time()
        result = loader.predict(image, model, threshold, detect_holes)
        inference_time = time.time() - inference_start
        
        processing_time = time.time() - start_time
        
        # Add detailed timing and performance metrics
        result["processing_time"] = processing_time
        result["inference_time"] = inference_time
        result["preprocessing_time"] = processing_time - inference_time
        result["device"] = str(loader.device)
        result["gpu_enabled"] = torch.cuda.is_available()
        result["batch_size_used"] = getattr(loader, 'last_batch_size', 1)
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
    except (InferenceTimeoutError, TimeoutError) as e:
        # Handle timeout errors with detailed information
        processing_time = time.time() - start_time
        logger.error(f"Segmentation timeout after {processing_time:.2f}s for model {model}: {e}")
        
        # Extract details from InferenceTimeoutError if available
        if isinstance(e, InferenceTimeoutError):
            error_detail = {
                "error": "Model inference timeout",
                "message": str(e),
                "model": e.model_name,
                "timeout": e.timeout,
                "image_size": e.image_size,
                "suggestion": f"Model '{e.model_name}' timed out after {e.timeout}s. Try: 1) Use 'hrnet' model instead, 2) Reduce image size, 3) Increase ML_INFERENCE_TIMEOUT environment variable",
                "processing_time": processing_time
            }
        else:
            # Legacy TimeoutError
            error_detail = {
                "error": "Model inference timeout",
                "message": str(e),
                "model": model,
                "suggestion": "Try using a simpler model (hrnet) or reducing image size",
                "processing_time": processing_time
            }
        
        raise HTTPException(status_code=504, detail=error_detail)
        
    except InferenceError as e:
        # Handle inference errors with context
        processing_time = time.time() - start_time
        logger.error(f"Inference error after {processing_time:.2f}s: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Inference failed",
                "message": str(e),
                "model": model,
                "processing_time": processing_time
            }
        )
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
    """Batch segmentation endpoint for processing multiple images using optimized batch processing"""
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
        
        # Read all images into memory first
        images = []
        filenames = []
        for i, file in enumerate(files):
            try:
                image_data = await file.read()
                image = Image.open(io.BytesIO(image_data))
                images.append(image)
                filenames.append(file.filename)
            except Exception as e:
                logger.error(f"Failed to read image {file.filename}: {e}")
                # Add placeholder for failed image to maintain index alignment
                images.append(None)
                filenames.append(file.filename)
        
        # Filter out None values but keep track of indices
        valid_images = []
        valid_indices = []
        for i, img in enumerate(images):
            if img is not None:
                valid_images.append(img)
                valid_indices.append(i)
        
        if not valid_images:
            raise HTTPException(
                status_code=400,
                detail="No valid images could be processed"
            )
        
        logger.info(f"Processing batch of {len(valid_images)} images using predict_batch, Model: {model}, Threshold: {threshold}, Detect holes: {detect_holes}")
        
        # Use the optimized batch processing method
        try:
            # Get optimal batch size for the model
            optimal_batch_size = loader.get_batch_limit(model)
            
            # Process all valid images using predict_batch
            batch_results = loader.predict_batch(
                valid_images, 
                model, 
                batch_size=optimal_batch_size,
                threshold=threshold,
                detect_holes=detect_holes
            )
            
            # Create results array with proper index alignment
            results = []
            result_index = 0
            
            for i in range(len(files)):
                if i in valid_indices:
                    # This image was processed
                    batch_result = batch_results[result_index] if result_index < len(batch_results) else None
                    result_index += 1
                    
                    if batch_result:
                        # Add file information to result
                        batch_result["filename"] = filenames[i]
                        batch_result["batch_index"] = i
                        batch_result["success"] = True
                        results.append(batch_result)
                        logger.info(f"Batch image {i+1} completed, found {len(batch_result.get('polygons', []))} polygons")
                    else:
                        # No result for this image
                        results.append({
                            "filename": filenames[i],
                            "batch_index": i,
                            "success": False,
                            "error": "No result from batch processing",
                            "polygons": [],
                            "model_used": model,
                            "threshold_used": threshold
                        })
                else:
                    # This image failed to load
                    results.append({
                        "filename": filenames[i],
                        "batch_index": i,
                        "success": False,
                        "error": "Failed to load image",
                        "polygons": [],
                        "model_used": model,
                        "threshold_used": threshold
                    })
            
            logger.info(f"Batch processing completed using predict_batch, processed {len(valid_images)} images")
            
        except (InferenceTimeoutError, TimeoutError) as e:
            logger.error(f"Timeout processing batch: {e}")
            
            # Extract timeout details
            if isinstance(e, InferenceTimeoutError):
                error_msg = f"Batch timeout after {e.timeout}s for model '{e.model_name}'"
                error_detail = {
                    "type": "timeout",
                    "message": str(e),
                    "model": e.model_name,
                    "timeout": e.timeout,
                    "image_size": e.image_size
                }
            else:
                error_msg = "Batch inference timeout"
                error_detail = str(e)
            
            # Return error for all images in batch
            results = []
            for i, filename in enumerate(filenames):
                results.append({
                    "filename": filename,
                    "batch_index": i,
                    "success": False,
                    "error": error_msg,
                    "error_detail": error_detail,
                    "polygons": [],
                    "model_used": model,
                    "threshold_used": threshold
                })
                
        except InferenceError as e:
            logger.error(f"Inference error processing batch: {e}")
            
            # Return error for all images in batch
            results = []
            for i, filename in enumerate(filenames):
                results.append({
                    "filename": filename,
                    "batch_index": i,
                    "success": False,
                    "error": "Batch inference failed",
                    "error_detail": str(e),
                    "polygons": [],
                    "model_used": model,
                    "threshold_used": threshold
                })
        except Exception as e:
            logger.error(f"Failed to process batch: {e}")
            
            # Return error for all images in batch  
            results = []
            for i, filename in enumerate(filenames):
                results.append({
                    "filename": filename,
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