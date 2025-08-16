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

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from api.routes import router
from api.models import ErrorResponse, HealthResponse
from api.metrics_endpoint import router as metrics_router
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
        
        # Pre-load HRNet model for faster first response
        try:
            model_loader_instance.load_model("hrnet")
            logger.info("HRNet model pre-loaded successfully")
        except Exception as e:
            logger.warning(f"Could not pre-load HRNet model: {e}")
        
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

# Configure CORS for backend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Include routes
app.include_router(router, prefix="/api/v1")
app.include_router(metrics_router)

# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Re-raise HTTPException and RequestValidationError to preserve status codes
    if isinstance(exc, (HTTPException, RequestValidationError)):
        raise exc
    
    logger.exception(f"Unhandled exception: {exc}")
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
        
        return HealthResponse(
            status="healthy",
            timestamp=datetime.now().isoformat(),
            models_loaded=len([name for name in app.state.model_loader.loaded_models.keys() if app.state.model_loader.loaded_models[name] is not None]) if hasattr(app.state, 'model_loader') and hasattr(app.state.model_loader, 'loaded_models') else 0,
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