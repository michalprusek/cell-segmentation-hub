"""Pydantic models for API requests and responses"""

from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from enum import Enum

class ModelType(str, Enum):
    HRNET = "hrnet"
    RESUNET_ADVANCED = "resunet_advanced" 
    RESUNET_SMALL = "resunet_small"

class SegmentationRequest(BaseModel):
    model: ModelType = Field(default=ModelType.HRNET, description="Model to use for segmentation")
    threshold: float = Field(default=0.5, ge=0.1, le=0.9, description="Segmentation threshold")

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