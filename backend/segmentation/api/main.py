"""FastAPI application for segmentation microservice"""

import logging
import sys
import os
from pathlib import Path
from datetime import datetime
import torch

# Add the current directory to path first
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Configure GPU memory limit and priority BEFORE any CUDA operations
# This is a HARD limit that prevents PyTorch from allocating more GPU memory
# SpheroSeg has HIGH priority - other apps (maptimize) should wait
if torch.cuda.is_available():
    _gpu_memory_limit_gb = float(os.getenv("ML_MEMORY_LIMIT_GB", "8"))
    _total_gpu_memory_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    _memory_fraction = min(_gpu_memory_limit_gb / _total_gpu_memory_gb, 1.0)
    torch.cuda.set_per_process_memory_fraction(_memory_fraction, device=0)

    # GPU Priority settings for SpheroSeg
    _gpu_priority = os.getenv("ML_GPU_PRIORITY", "high")
    if _gpu_priority == "high":
        # Enable aggressive memory cleanup for high priority
        torch.cuda.empty_cache()
        # Set CUDA allocator for better memory reuse
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "max_split_size_mb:512,garbage_collection_threshold:0.6")

    print(f"GPU memory limit set: {_gpu_memory_limit_gb:.1f}GB / {_total_gpu_memory_gb:.1f}GB ({_memory_fraction:.1%})")
    print(f"GPU priority: {_gpu_priority}")

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from api.routes import router
from api.models import ErrorResponse, HealthResponse
from api.metrics_endpoint import router as metrics_router
from api.monitoring import router as monitoring_router
from ml.model_loader import ModelLoader

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan"""
    # Startup
    logger.info("Starting segmentation microservice...")
    try:
        model_loader_instance = ModelLoader()
        app.state.model_loader = model_loader_instance
        logger.info("Model loader initialized")
        
        # Pre-load all models for faster first response
        models_to_load = ["hrnet", "cbam_resunet", "unet_spherohq"]
        loaded_count = 0
        
        for model_name in models_to_load:
            try:
                model_loader_instance.load_model(model_name)
                logger.info(f"{model_name.upper()} model pre-loaded successfully")
                loaded_count += 1
            except Exception as e:
                logger.warning(f"Could not pre-load {model_name} model: {e}")
        
        logger.info(f"Pre-loaded {loaded_count}/{len(models_to_load)} models")
        
        logger.info("Segmentation microservice started successfully")
    except Exception as e:
        logger.error(f"Failed to start microservice: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("Shutting down segmentation microservice...")
    if hasattr(app.state, "model_loader"):
        delattr(app.state, "model_loader")
    logger.info("Segmentation microservice shut down")

# Create FastAPI app
app = FastAPI(
    title="Cell Segmentation Microservice",
    description="AI-powered cell segmentation using deep learning models",
    version="1.0.0",
    lifespan=lifespan
)

# Global OPTIONS handler for CORS preflight (must be before routers)
@app.options("/{path:path}")
async def options_handler(path: str):
    """Handle all OPTIONS requests for CORS preflight"""
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "600"
        }
    )

# Simple approach - allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Debug middleware to log all requests BEFORE they reach routes
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests for debugging"""
    content_type = request.headers.get("content-type", "")
    content_length = request.headers.get("content-length", "0")

    if "batch-segment" in str(request.url.path):
        logger.info(f"BATCH REQUEST: {request.method} {request.url.path} Content-Type: {content_type[:50]}... Content-Length: {content_length}")

    try:
        response = await call_next(request)
        if "batch-segment" in str(request.url.path) and response.status_code == 400:
            logger.error(f"BATCH 400 ERROR: {request.method} {request.url.path} - Response status: {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"BATCH EXCEPTION: {request.method} {request.url.path} - {type(e).__name__}: {e}")
        raise

# Include routes
app.include_router(router, prefix="/api/v1")
app.include_router(metrics_router)
app.include_router(monitoring_router, prefix="/api/v1")

# Request validation error handler - logs 422 errors with details
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"Validation error on {request.url.path}: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()}
    )

# HTTP exception handler - logs 400 errors with details
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 400:
        logger.error(f"HTTP 400 on {request.url.path}: {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )

# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error="Internal server error",
            detail=str(exc)
        ).model_dump()
    )

# Root endpoint
@app.get("/")
async def root():
    return {
        "service": "Cell Segmentation Microservice",
        "version": "1.0.0",
        "status": "running"
    }

# Health endpoint at root level for Docker health checks
@app.get("/health", response_model=HealthResponse)
async def health():
    """Root level health check endpoint"""
    try:
        # Detect CUDA
        cuda_available = torch.cuda.is_available()
        
        # Detect MPS (Apple Silicon)
        mps_available = torch.backends.mps.is_available() if hasattr(torch.backends, 'mps') else False
        
        # Determine device info
        gpu_available = cuda_available or mps_available
        
        if cuda_available:
            device_count = torch.cuda.device_count()
            try:
                device_name = torch.cuda.get_device_name(0)
            except Exception:
                device_name = "CUDA (unknown)"
        elif mps_available:
            device_count = 1
            device_name = "Apple MPS"
        else:
            device_count = 0
            device_name = "CPU"
        
        # Count loaded models
        models_loaded = 0
        if hasattr(app.state, 'model_loader') and hasattr(app.state.model_loader, 'loaded_models'):
            loaded_models = app.state.model_loader.loaded_models
            models_loaded = sum(1 for model in loaded_models.values() if model is not None)

        return HealthResponse(
            status="healthy",
            timestamp=datetime.now().isoformat(),
            models_loaded=models_loaded,
            gpu_available=gpu_available
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    
    # Get port from environment or default to 8000
    port = int(os.getenv("PORT", 8000))
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        reload=False,  # Set to True for development
        log_level="info"
    )