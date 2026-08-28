"""Pydantic models for API requests and responses"""

from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from enum import Enum

class ModelType(str, Enum):
    HRNET = "hrnet"
    CBAM_RESUNET = "cbam_resunet"
    UNET_SPHEROHQ = "unet_spherohq"
    SPHEROID_DISINTEGRATION = "spheroid_disintegration"
    SEGFORMER = "segformer"
    MAMBA_UNET = "mamba_unet"
    SPERM = "sperm"
    WOUND = "wound"
    MICROCAPSULE = "microcapsule"
    MICROTUBULE = "microtubule"
    NEURITE_SOMA = "neurite_soma"

class SegmentationRequest(BaseModel):
    model: ModelType = Field(default=ModelType.HRNET, description="Model to use for segmentation")
    # Ceiling 0.99, not 0.9. The microtubule v5H model ships a FITTED
    # foreground cut of 0.97, so a 0.9 bound rejected every request the
    # frontend made for it. Kept in step with the Node API's
    # thresholdSchema (backend/src/types/validation.ts) — the two validate
    # the same value one hop apart, and only the second one is visible to
    # the user as a queue job that silently fails.
    threshold: float = Field(default=0.5, ge=0.1, le=0.99, description="Segmentation threshold")

class Point(BaseModel):
    x: float
    y: float

class Polygon(BaseModel):
    points: List[Point]
    area: float
    confidence: float

class SegmentationResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    
    success: bool
    polygons: List[Polygon]
    model_used: str
    threshold_used: float
    processing_time: float
    image_size: Dict[str, int]

class ModelInfo(BaseModel):
    name: str
    description: str
    parameters: int
    input_size: List[int]
    available: bool

class ModelsResponse(BaseModel):
    models: List[ModelInfo]

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    models_loaded: int
    gpu_available: bool

class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    detail: Optional[str] = None