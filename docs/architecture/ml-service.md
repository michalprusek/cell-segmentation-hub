# ML Service Architecture

The ML service is a Python-based microservice built with FastAPI, providing AI-powered cell segmentation using deep learning models.

## Technology Stack

- **Framework**: FastAPI (async Python web framework)
- **ML Framework**: PyTorch for deep learning models
- **Image Processing**: OpenCV, PIL, scikit-image
- **HTTP Server**: Uvicorn ASGI server
- **Models**: HRNet, ResUNet Advanced, ResUNet Small
- **Data Validation**: Pydantic models
- **Logging**: Python logging with structured output

## Project Structure

```
backend/segmentation/
├── api/                    # FastAPI application
│   ├── __init__.py
│   ├── main.py            # FastAPI app entry point
│   ├── routes.py          # API route definitions
│   └── models.py          # Pydantic response models
├── ml/                    # Machine learning core
│   ├── __init__.py
│   └── model_loader.py    # Model loading and management
├── models/                # Neural network architectures
│   ├── __init__.py
│   ├── hrnet.py           # HRNet implementation
│   ├── resunet_advanced.py # Advanced ResUNet
│   └── resunet_small.py   # Lightweight ResUNet
├── services/              # Business logic services
│   ├── __init__.py
│   ├── inference.py       # Inference pipeline
│   ├── model_loader.py    # Model management
│   └── postprocessing.py  # Result processing
├── utils/                 # Utility functions
│   ├── __init__.py
│   └── helpers.py         # Common utilities
├── weights/               # Model weight files (gitignored)
└── requirements.txt       # Python dependencies
```

## Model Architecture

### Supported Models

#### 1. HRNetV2 (High-Resolution Network)

```python
class HRNet(nn.Module):
    """
    HRNetV2 for semantic segmentation
    - Maintains high-resolution throughout the network
    - Best accuracy but slower inference (~3.1s)
    - 66M parameters
    - Input: 1024x1024, Output: 1024x1024
    """
    def __init__(self, num_classes=1):
        super().__init__()
        # High-resolution branches maintained throughout
        self.conv1 = nn.Conv2d(3, 64, 3, 2, 1, bias=False)
        self.bn1 = nn.BatchNorm2d(64)
        self.relu = nn.ReLU(inplace=True)

        # Multi-resolution parallel convolutions
        self.stage1 = self._make_layer(Bottleneck, 64, 4)
        self.transition1 = self._make_transition_layer([256], [32, 64])
        # ... additional stages

    def forward(self, x):
        # Maintain multiple resolutions in parallel
        x = self.conv1(x)
        x = self.bn1(x)
        x = self.relu(x)

        # Multi-scale feature extraction
        x_list = [x]
        for i in range(self.num_stages):
            x_list = self.stages[i](x_list)

        return self.final_layer(x_list[0])
```

#### 2. ResUNet Advanced

```python
class ResUNetAdvanced(nn.Module):
    """
    Advanced ResUNet with attention mechanisms
    - Attention-gated skip connections
    - Deep supervision
    - Balanced accuracy/speed (~18.1s)
    - Features: [64, 128, 256, 512]
    """
    def __init__(self, in_channels=3, out_channels=1, features=[64, 128, 256, 512]):
        super().__init__()

        # Encoder with residual blocks
        self.encoder = nn.ModuleList()
        for i, feat in enumerate(features):
            in_ch = in_channels if i == 0 else features[i-1]
            self.encoder.append(ResidualBlock(in_ch, feat))

        # Attention gates
        self.attention_gates = nn.ModuleList([
            AttentionGate(feat, feat) for feat in features[:-1]
        ])

        # Decoder with attention
        self.decoder = nn.ModuleList()
        for i in range(len(features)-1, 0, -1):
            self.decoder.append(
                DecoderBlock(features[i] + features[i-1], features[i-1])
            )
```

#### 3. ResUNet Small

```python
class ResUNetSmall(nn.Module):
    """
    Lightweight ResUNet for fast inference
    - Optimized for speed (~6.9s)
    - Reduced parameters while maintaining quality
    - Features: [48, 96, 192, 384, 512]
    """
    def __init__(self, in_channels=3, out_channels=1):
        super().__init__()
        features = [48, 96, 192, 384, 512]

        # Lightweight encoder
        self.encoder = self._build_encoder(in_channels, features)
        self.bottleneck = self._build_bottleneck(features[-1])
        self.decoder = self._build_decoder(features)

    def _build_encoder(self, in_channels, features):
        layers = []
        for i, feat in enumerate(features):
            in_ch = in_channels if i == 0 else features[i-1]
            layers.append(LightweightResBlock(in_ch, feat))
        return nn.ModuleList(layers)
```

## Inference Pipeline

### Model Loading System

```python
class ModelLoader:
    """Manages loading and caching of segmentation models"""

    def __init__(self):
        self.models = {}
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self._load_lock = asyncio.Lock()  # Async lock for thread-safe model loading
        logger.info(f"Using device: {self.device}")

    async def load_model(self, model_name: str):
        """Load model into memory with caching - thread-safe with async lock"""
        # Check cache first without lock for performance
        if model_name in self.models:
            return self.models[model_name]

        # Acquire lock to prevent race conditions during model loading
        async with self._load_lock:
            # Double-check pattern: another coroutine might have loaded it while waiting
            if model_name in self.models:
                return self.models[model_name]

            logger.info(f"Loading model: {model_name}")

            if model_name == "hrnet":
                model = HRNet(num_classes=1)
                weight_path = "weights/hrnet_w32_cell_segmentation.pth"

            elif model_name == "resunet_advanced":
                model = ResUNetAdvanced(features=[64, 128, 256, 512])
                weight_path = "weights/resunet_advanced_cell_segmentation.pth"

            elif model_name == "resunet_small":
                model = ResUNetSmall()
                weight_path = "weights/resunet_small_cell_segmentation.pth"

            else:
                raise ValueError(f"Unknown model: {model_name}")

            # Load pretrained weights
            if os.path.exists(weight_path):
                state_dict = torch.load(weight_path, map_location=self.device)
                model.load_state_dict(state_dict)
                logger.info(f"Loaded weights from {weight_path}")
            else:
                logger.warning(f"No pretrained weights found at {weight_path}")

            model.to(self.device)
            model.eval()

            # Cache the model
            self.models[model_name] = model
            logger.info(f"Model {model_name} loaded successfully")

            return model
```

### Image Preprocessing

```python
class ImagePreprocessor:
    """Handles image preprocessing for inference"""

    @staticmethod
    def preprocess_image(image: np.ndarray, target_size: tuple = (1024, 1024)):
        """Preprocess image for model inference"""

        # Convert BGR to RGB if needed
        if len(image.shape) == 3 and image.shape[2] == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Resize image
        original_size = image.shape[:2]
        image_resized = cv2.resize(image, target_size, interpolation=cv2.INTER_LINEAR)

        # Normalize to [0, 1]
        image_normalized = image_resized.astype(np.float32) / 255.0

        # Convert to tensor and add batch dimension
        image_tensor = torch.from_numpy(image_normalized).permute(2, 0, 1).unsqueeze(0)

        return image_tensor, original_size

    @staticmethod
    def postprocess_mask(mask: torch.Tensor, original_size: tuple, threshold: float = 0.5):
        """Convert model output to binary mask"""

        # Apply sigmoid and threshold
        mask_prob = torch.sigmoid(mask).squeeze().cpu().numpy()
        mask_binary = (mask_prob > threshold).astype(np.uint8)

        # Resize back to original size
        mask_resized = cv2.resize(mask_binary, original_size[::-1], interpolation=cv2.INTER_NEAREST)

        return mask_resized, mask_prob
```

### Segmentation Service

```python
class SegmentationService:
    """Main segmentation inference service"""

    def __init__(self, model_loader: ModelLoader):
        self.model_loader = model_loader

    async def segment_image(
        self,
        image_data: bytes,
        model_name: str = "hrnet",
        threshold: float = 0.5
    ) -> SegmentationResult:
        """Perform segmentation on uploaded image"""

        start_time = time.time()

        try:
            # Load and preprocess image
            image_array = np.frombuffer(image_data, dtype=np.uint8)
            image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

            if image is None:
                raise ValueError("Could not decode image")

            # Preprocess for model
            image_tensor, original_size = ImagePreprocessor.preprocess_image(image)

            # Load model
            model = await self.model_loader.load_model(model_name)

            # Run inference
            with torch.no_grad():
                device = next(model.parameters()).device
                image_tensor = image_tensor.to(device)

                output = model(image_tensor)

            # Postprocess results
            mask, confidence_map = ImagePreprocessor.postprocess_mask(
                output, original_size, threshold
            )

            # Extract polygons from mask
            polygons = self.extract_polygons(mask)

            # Calculate metrics
            processing_time = time.time() - start_time
            confidence = float(np.mean(confidence_map))

            logger.info(f"Segmentation completed: {len(polygons)} polygons, "
                       f"time: {processing_time:.2f}s, confidence: {confidence:.3f}")

            return SegmentationResult(
                polygons=polygons,
                confidence=confidence,
                processing_time=processing_time * 1000,  # Convert to milliseconds
                model_used=model_name,
                threshold_used=threshold
            )

        except Exception as e:
            logger.error(f"Segmentation failed: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
```

### Polygon Extraction

```python
def extract_polygons(self, mask: np.ndarray, min_area: int = 100) -> List[Polygon]:
    """Extract polygon contours from binary mask"""

    polygons = []

    # Find contours
    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    for i, contour in enumerate(contours):
        # Filter by area
        area = cv2.contourArea(contour)
        if area < min_area:
            continue

        # Approximate contour to polygon
        epsilon = 0.02 * cv2.arcLength(contour, True)
        approx_contour = cv2.approxPolyDP(contour, epsilon, True)

        # Convert to list of points
        points = [
            Point(x=float(point[0][0]), y=float(point[0][1]))
            for point in approx_contour
        ]

        # Ensure minimum 3 points for valid polygon
        if len(points) >= 3:
            polygons.append(Polygon(
                id=f"polygon_{i}",
                points=points,
                area=float(area),
                confidence=self._calculate_polygon_confidence(contour, mask)
            ))

    return polygons

def _calculate_polygon_confidence(self, contour: np.ndarray, confidence_map: np.ndarray) -> float:
    """Calculate average confidence within polygon region"""

    # Create mask for this polygon
    mask = np.zeros(confidence_map.shape, dtype=np.uint8)
    cv2.fillPoly(mask, [contour], 255)

    # Calculate mean confidence in polygon region
    polygon_confidence = np.mean(confidence_map[mask == 255])

    return float(polygon_confidence)
```

## API Endpoints

### FastAPI Route Definitions

```python
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

@router.post("/segment", response_model=SegmentationResponse)
async def segment_image(
    file: UploadFile = File(..., description="Image file for segmentation"),
    model: str = Form(default="hrnet", description="Model to use for segmentation"),
    threshold: float = Form(default=0.5, description="Segmentation threshold")
):
    """
    Perform cell segmentation on uploaded image

    - **file**: Image file (PNG, JPG, JPEG supported)
    - **model**: Model name (hrnet, resunet_advanced, resunet_small)
    - **threshold**: Confidence threshold for segmentation (0.0-1.0)
    """

    # Validate file type
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Validate file size (max 50MB for security and performance)
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
    if file.size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
        )

    # Validate model name
    if model not in ["hrnet", "resunet_advanced", "resunet_small"]:
        raise HTTPException(status_code=400, detail="Invalid model name")

    # Validate threshold
    if not 0.0 <= threshold <= 1.0:
        raise HTTPException(status_code=400, detail="Threshold must be between 0.0 and 1.0")

    try:
        # Read image data
        image_data = await file.read()

        # Additional file size validation after reading
        if len(image_data) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File content too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
            )

        # Perform segmentation
        result = await segmentation_service.segment_image(image_data, model, threshold)

        return SegmentationResponse(
            success=True,
            message="Segmentation completed successfully",
            data=result
        )

    except Exception as e:
        logger.error(f"Segmentation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/models")
async def list_available_models():
    """List all available segmentation models"""

    models = {
        "hrnet": {
            "name": "HRNetV2",
            "description": "High-Resolution Network for semantic segmentation",
            "inference_time": "~3.1s",
            "accuracy": "Highest",
            "parameters": "66M"
        },
        "resunet_advanced": {
            "name": "ResUNet Advanced",
            "description": "Advanced ResUNet with attention mechanisms",
            "inference_time": "~18.1s",
            "accuracy": "High",
            "parameters": "45M"
        },
        "resunet_small": {
            "name": "ResUNet Small",
            "description": "Lightweight ResUNet for fast inference",
            "inference_time": "~6.9s",
            "accuracy": "Good",
            "parameters": "15M"
        }
    }

    return {"models": models}

@router.get("/health")
async def health_check():
    """Service health check endpoint"""

    try:
        # Test model loading
        await model_loader.load_model("hrnet")

        return {
            "status": "healthy",
            "service": "Cell Segmentation ML Service",
            "version": "1.0.0",
            "models_available": len(model_loader.models),
            "device": str(model_loader.device)
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")
```

### Pydantic Models

```python
from pydantic import BaseModel, Field
from typing import List, Optional

class Point(BaseModel):
    x: float = Field(..., description="X coordinate")
    y: float = Field(..., description="Y coordinate")

class Polygon(BaseModel):
    id: str = Field(..., description="Unique polygon identifier")
    points: List[Point] = Field(..., description="Polygon vertices")
    area: float = Field(..., description="Polygon area in pixels")
    confidence: float = Field(..., description="Average confidence score")

class SegmentationResult(BaseModel):
    polygons: List[Polygon] = Field(..., description="Detected cell polygons")
    confidence: float = Field(..., description="Overall confidence score")
    processing_time: float = Field(..., description="Processing time in milliseconds")
    model_used: str = Field(..., description="Model name used for segmentation")
    threshold_used: float = Field(..., description="Threshold value used")

class SegmentationResponse(BaseModel):
    success: bool = Field(..., description="Success status")
    message: str = Field(..., description="Response message")
    data: SegmentationResult = Field(..., description="Segmentation results")

class ErrorResponse(BaseModel):
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Error details")
```

## Performance Optimizations

### Model Caching

```python
# Pre-load frequently used models
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global model_loader
    model_loader = ModelLoader()

    # Pre-load HRNet for faster first response
    try:
        await model_loader.load_model("hrnet")
        logger.info("HRNet model pre-loaded successfully")
    except Exception as e:
        logger.warning(f"Could not pre-load HRNet model: {e}")

    yield

    # Shutdown cleanup
    logger.info("Shutting down ML service...")
```

### Memory Management

```python
# Efficient tensor operations
with torch.no_grad():  # Disable gradient computation
    output = model(input_tensor)

# Clean up GPU memory
if torch.cuda.is_available():
    torch.cuda.empty_cache()
```

### Batch Processing Support

```python
async def segment_batch(
    self,
    images: List[bytes],
    model_name: str = "hrnet"
) -> List[SegmentationResult]:
    """Process multiple images in batch for efficiency"""

    model = await self.model_loader.load_model(model_name)

    # Preprocess all images
    batch_tensors = []
    original_sizes = []

    for image_data in images:
        tensor, size = ImagePreprocessor.preprocess_image(
            self._decode_image(image_data)
        )
        batch_tensors.append(tensor)
        original_sizes.append(size)

    # Stack into batch
    batch_tensor = torch.cat(batch_tensors, dim=0)

    # Single forward pass for efficiency
    with torch.no_grad():
        batch_output = model(batch_tensor)

    # Process results
    results = []
    for i, (output, original_size) in enumerate(zip(batch_output, original_sizes)):
        mask, confidence_map = ImagePreprocessor.postprocess_mask(
            output.unsqueeze(0), original_size
        )
        polygons = self.extract_polygons(mask)
        # ... create SegmentationResult
        results.append(result)

    return results
```

## Docker Integration

### Dockerfile

```dockerfile
FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Create weights directory
RUN mkdir -p weights

EXPOSE 8000

CMD ["python", "api/main.py"]
```

The ML service architecture provides a robust, scalable foundation for AI-powered cell segmentation with support for multiple models, efficient processing, and comprehensive monitoring.
