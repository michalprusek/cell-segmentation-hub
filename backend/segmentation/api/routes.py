"""API routes for segmentation microservice"""

import time
import logging
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Form
import torch

from ._errors import internal_error
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

# Serialises EVERY inference in this worker, across every route that runs one.
#
# One lock, not one per model, and it is now an ACTIVE guard rather than the
# insurance the two per-model locks used to be. What changed: the inference
# dispatch moved off the event loop (see `_INFERENCE_EXECUTOR`), so the loop is
# no longer what serialises it.
#
# It has to be loader-wide because the three inference paths do not share a
# thread. `/segment` and `/batch-segment` are `async def` and now hop to the
# executor; `/frap/targets` is a plain `def`, so Starlette hands it to its
# 40-slot threadpool and it has ALWAYS been able to run beside the event loop —
# which is why the old microtubule lock was shared with it. Without a single
# lock spanning all three, a frap request and a queued /segment would overlap
# and their GPU peaks would SUM rather than max, on a card shared with the
# essays worker and Maptimize. That is the OOM the per-model locks existed to
# prevent, and it is why this is not simply `max_workers=1`.
#
# The two locks it replaces carried these measurements, which still hold:
#
#  * microtubule — introduced for v7 (DINOv3-L + DPT), ~7 GB of activations per
#    1024^2 pass, where four concurrent queue batches fragmented the allocator
#    and tripped OOM with >15 GB free. v5H is far lighter (0.73 GiB peak, flat
#    across 1024^2 and 2048^2 because it tiles at 512^2) so the OOM argument no
#    longer applies to it, but the lock also bounds CPU contention: the
#    instancer is single-threaded numpy/networkx and is the larger half of the
#    ~4 s budget on a dense frame (65 MTs).
#
#  * neurite/soma — the heaviest interactive model on the card. Three ResEnc-M
#    folds stay resident (1.70 GiB reserved) and each call adds a working set
#    sized by the FRAME rather than the tile. It is also the longest: 108
#    forward passes of 512^2 for a 1024^2 frame, ~2 min for a native one, and
#    22 min for the 498 Mpx frame that prompted this change.
_inference_lock = threading.Lock()

# One slot, so hopping off the event loop does not become real concurrency.
#
# `/segment` is `async def`, so a blocking predict used to stall the whole
# worker — including GET /health — for the inference's entire duration. That was
# tolerable while the worst case was 150 s on a 6657x6664 frame (measured
# 2026-08-28, A5000). It stopped being tolerable when #535 made a 498 Mpx frame
# complete instead of running out of memory: 22 minutes of a dead event loop,
# during which the docker healthcheck (30 s x 3) marks the container unhealthy
# and every other request gets a 503. Measured on production 2026-09-10: 359
# and 335 `Exceeded concurrency limit` in single minutes, while one frame ran.
#
# The executor frees the loop; `_inference_lock` above is what keeps the work
# serialised. Both are needed — see that comment for why the lock cannot be
# replaced by this executor's single slot.
_INFERENCE_EXECUTOR = ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="inference"
)

from fastapi import Request

def get_model_loader(request: Request):
    """Dependency to get the global model loader"""
    if not hasattr(request.app.state, 'model_loader'):
        raise HTTPException(status_code=503, detail="Model loader not initialized")
    return request.app.state.model_loader

def validate_image(file: UploadFile) -> bool:
    """Validate if the uploaded file is a valid image"""
    valid_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'}
    if not file.filename:
        return False

    # Extract file extension more safely
    filename_parts = file.filename.split('.')
    if len(filename_parts) < 2:
        return False

    ext = '.' + filename_parts[-1].lower()
    return ext in valid_extensions

@router.get("/health")
async def health_check(request: Request):
    """Health check endpoint"""
    try:
        device_info = {
            "gpu_available": torch.cuda.is_available(),
            "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
            "device_name": torch.cuda.get_device_name() if torch.cuda.is_available() else "CPU"
        }

        # Surface models that failed to pre-load so deploy monitoring can detect
        # missing or unreadable weights without reading log files.
        models_failed = getattr(request.app.state, "models_failed", [])

        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "service": "cell-segmentation",
            "version": "1.0.0",
            "device": device_info,
            "models_failed": models_failed,
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
        raise HTTPException(status_code=503, detail="Failed to get service status")


def _dispatch_inference(loader, model, image, threshold, detect_holes):
    """Run one inference, holding the loader-wide lock.

    Split out of `segment_image` so the async route can hand it to
    `_INFERENCE_EXECUTOR` instead of running it on the event loop. The branch
    bodies are unchanged; only their residence is.
    """
    with _inference_lock:
        if model == 'sperm':
            # Sperm model uses its own mask_threshold (0.3) and score_threshold (0.95)
            # Don't override with the user's segmentation threshold — it's calibrated differently
            result = loader.predict_sperm(image)
        elif model == 'wound':
            # Wound model expects grayscale 512×512 — custom preprocessing lives in WoundModel
            result = loader.predict_wound(image, threshold, detect_holes)
        elif model == 'microtubule':
            # Microtubule v5H uses its OWN fitted foreground cut (0.97, from
            # params_v5h.json), not the user's threshold — the same reason
            # sperm ignores it above: it is calibrated differently.
            #
            # This is not merely a preference. `threshold` is declared
            # `le=0.9`, so 0.97 is not even expressible on this endpoint:
            # forwarding the user's value would silently cut this model's
            # (very confident) foreground at 0.5 and flood the instancer with
            # noise, and "fixing" that by sending 0.97 would 422. The cut
            # belongs to the fitted parameter vector, so it travels with it.
            #
            # detect_holes is not meaningful for polylines.
            #
            # Serialisation is `_inference_lock`, taken once by
            # `_dispatch_inference` around this whole block — NOT here. A second
            # acquisition would deadlock: `threading.Lock` is not reentrant.
            #
            # (The note that used to sit here claimed a sync route only blocks a
            # worker thread. That was wrong for this path: `segment_image` is
            # `async def`, so before the executor hop it blocked the event loop.
            # It is right about `/frap/targets`, which is a plain `def` and takes
            # the same lock from Starlette's threadpool.)
            result = loader.predict_microtubule(image)
        elif model == 'microcapsule':
            # Microcapsule distilled U-Net — the user threshold is forwarded as
            # the foreground cutoff. detect_holes is not meaningful: each capsule
            # is a single closed instance polygon. The model is light (~14.5 MB),
            # so it runs in parallel like hrnet/sperm/wound (no inference lock).
            result = loader.predict_microcapsule(image, threshold)
        elif model == 'neurite_soma':
            # Neurite/soma (nnU-Net ResEnc-M, 3 folds, 3 classes). Does its own
            # two-stage normalisation (1-99.5 percentile stretch, then z-score)
            # and emits per-class polygons, so it cannot flow through the generic
            # ImageNet-normalised single-channel path — that path would silently
            # produce garbage rather than fail.
            #
            # `threshold` is forwarded only so the response echoes what the
            # caller sent; the 3-class decision is an argmax, with no probability
            # cut to move.
            #
            # This branch is the reason the whole dispatch moved off the event
            # loop, so the history is worth keeping.
            #
            # It used to run blocking ON the loop, like every other branch, and
            # that was a considered choice: a blocking predict stalls the whole
            # worker — GET /health included — for its duration, which was up to
            # 4 s at 1024x1024, 15 s at 2048x2048 and 150 s on the 6657x6664
            # frames this model was trained on (measured 2026-08-28, A5000, two
            # runs at different card load), against a docker healthcheck that
            # gives up after 30 s x 3. Tolerable. Then #535 made a 498 Mpx frame
            # COMPLETE rather than run out of memory, and the worst case became
            # 22 minutes — a container marked unhealthy and 503s for everyone
            # else while one frame ran.
            #
            # Hopping only THIS branch would have been worse than leaving it:
            # the loop was what serialised inference across models, and the
            # queue worker dispatches up to FOUR concurrent /segment calls
            # (queueService.getMultipleBatches — the SERIAL_DISPATCH_MODELS cap
            # only applies when a serial model is picked FIRST). Real
            # concurrency would sum GPU peaks instead of maxing them, on a card
            # shared with the essays worker and Maptimize, and would let two
            # threads race `loader.is_processing` / `current_model` so
            # GET /api/v1/status reported idle mid-inference.
            #
            # So the whole dispatch hops together, under one loader-wide
            # `_inference_lock` — which is exactly the fix the old note here
            # prescribed and deferred. Do not re-acquire that lock in this
            # branch: `_dispatch_inference` already holds it and it is not
            # reentrant.
            result = loader.predict_neurite_soma(image, threshold, detect_holes)
        elif model == 'spheroid_disintegration':
            # Spheroid-disintegration model (UNet++/EffB5, 3-class). Uses its own
            # CLAHE preprocessing and emits foreground + core polygons directly,
            # so it can't flow through the generic single-channel predict path.
            result = loader.predict_disintegration(image, threshold, detect_holes)
        else:
            result = loader.predict(image, model, threshold, detect_holes)
    return result


def _dispatch_batch_inference(
    loader, images, model, batch_size, threshold, detect_holes
):
    """`predict_batch`, holding the loader-wide lock.

    The counterpart to `_dispatch_inference` for `/batch-segment`; both hand
    their work to the same single-slot executor, so a batch and a single frame
    can never be in flight together.
    """
    with _inference_lock:
        return loader.predict_batch(
            images,
            model,
            batch_size=batch_size,
            threshold=threshold,
            detect_holes=detect_holes,
        )

@router.post("/segment")
async def segment_image(
    file: UploadFile = File(...),
    model: str = Form("hrnet", description="Model to use for segmentation"),
    threshold: float = Form(
        0.5,
        ge=0.1,
        le=0.99,  # v5H's fitted cut is 0.97 — see api/models.py
        description="Segmentation threshold",
    ),
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
                detail="Invalid image file. Supported formats: PNG, JPG, JPEG, TIFF, TIF, BMP"
            )
        
        # Read image data and convert to PIL Image
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        
        logger.info(f"Processing image: {file.filename}, Model: {model}, Threshold: {threshold}, Detect holes: {detect_holes}")
        
        # Perform segmentation with timing
        inference_start = time.time()
        # Off the event loop, and serialised — see `_inference_lock`.
        result = await asyncio.get_running_loop().run_in_executor(
            _INFERENCE_EXECUTOR,
            _dispatch_inference,
            loader,
            model,
            image,
            threshold,
            detect_holes,
        )
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
        
        # Add warning metadata if no detections found (check both polygons and polylines)
        polygon_count = len(result.get('polygons', []))
        polyline_count = len(result.get('polylines', []))
        total_detected = polygon_count + polyline_count
        if total_detected == 0:
            result["warning"] = "No polygons or polylines detected - image may not contain detectable structures or threshold may need adjustment"
            logger.warning(f"Segmentation completed in {processing_time:.2f}s, but found 0 detections - potential detection issue")
        else:
            logger.info(f"Segmentation completed in {processing_time:.2f}s, found {polygon_count} polygons, {polyline_count} polylines")
        
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
        raise internal_error(
            logger, f"Segmentation failed after {processing_time:.2f}s", e
        )

@router.post("/batch-segment")
async def batch_segment_images(
    files: list[UploadFile] = File(..., description="List of images to segment"),
    model: str = Form("hrnet", description="Model to use for segmentation"),
    threshold: float = Form(
        0.5,
        ge=0.1,
        le=0.99,  # v5H's fitted cut is 0.97 — see api/models.py
        description="Segmentation threshold",
    ),
    detect_holes: bool = Form(True, description="Whether to detect holes in segmentation"),
    loader = Depends(get_model_loader)
):
    """Batch segmentation endpoint for processing multiple images using optimized batch processing"""
    start_time = time.time()

    # Debug logging for request details (limit to first 10 files to avoid log spam)
    logger.info(f"Batch segment request received: {len(files)} files, model={model}, threshold={threshold}")
    for i, f in enumerate(files[:10]):
        logger.debug(f"  File {i}: {f.filename}, content_type={f.content_type}")
    if len(files) > 10:
        logger.debug(f"  ... and {len(files) - 10} more files")

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
                    detail=f"Invalid image file: {file.filename}. Supported formats: PNG, JPG, JPEG, TIFF, TIF, BMP"
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
            
            # Same treatment as `/segment`: off the event loop, and under the
            # loader-wide lock. Leaving this one behind would have reopened the
            # hole the lock exists to close — a batch running on the loop while
            # the executor runs a single frame is two concurrent inferences,
            # and their GPU peaks sum.
            batch_results = await asyncio.get_running_loop().run_in_executor(
                _INFERENCE_EXECUTOR,
                _dispatch_batch_inference,
                loader,
                valid_images,
                model,
                optimal_batch_size,
                threshold,
                detect_holes,
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
            # Log the full exception details (including the message that
            # may reference internal paths) but return only a generic
            # error to the API caller to avoid leaking stack trace / path
            # information (CodeQL py/stack-trace-exposure).
            logger.error(f"Inference error processing batch: {e}", exc_info=True)

            results = []
            for i, filename in enumerate(filenames):
                results.append({
                    "filename": filename,
                    "batch_index": i,
                    "success": False,
                    "error": "Batch inference failed",
                    "error_detail": "Inference error — see server logs",
                    "polygons": [],
                    "model_used": model,
                    "threshold_used": threshold
                })
        except Exception as e:
            logger.error(f"Failed to process batch: {e}", exc_info=True)

            # Same rationale as above — do not echo str(e) back to the
            # external caller.
            results = []
            for i, filename in enumerate(filenames):
                results.append({
                    "filename": filename,
                    "batch_index": i,
                    "success": False,
                    "error": "Batch processing failed — see server logs",
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
            detail="Batch segmentation failed. Please try again later or contact support if the issue persists."
        )
