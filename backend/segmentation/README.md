# Cell Segmentation Microservice

Python-based AI microservice for cell segmentation using deep learning models.

## Features

- **Multiple AI Models**: HRNet, ResUNet Advanced, and ResUNet Small
- **FastAPI Framework**: Modern, async API with automatic documentation
- **Lazy Model Loading**: Models are loaded on-demand to save memory
- **Polygon Output**: Converts segmentation masks to polygon coordinates
- **Docker Support**: Ready for containerization
- **Health Monitoring**: Health check endpoints for monitoring
- **Configurable Thresholds**: Adjustable segmentation sensitivity

## Architecture

```
segmentation/
├── api/                    # FastAPI application
│   ├── main.py            # Application entry point
│   ├── models.py          # Pydantic models for API
│   └── routes.py          # API route definitions
├── models/                # Deep learning model architectures
│   ├── hrnet.py
│   ├── resunet_advanced.py
│   └── resunet_small.py
├── services/              # Core business logic
│   ├── model_loader.py    # Model management and loading
│   ├── inference.py       # Image segmentation inference
│   └── postprocessing.py  # Mask to polygon conversion
├── weights/               # Pre-trained model weights
├── utils/                 # Helper utilities
└── Dockerfile            # Container configuration
```

## Available Models

### HRNet (High-Resolution Network)
- **Parameters**: ~66M
- **Description**: High-resolution network maintaining spatial precision
- **Best for**: High-accuracy segmentation with fine details

### ResUNet Advanced
- **Parameters**: ~66M  
- **Description**: Advanced ResUNet with attention mechanisms
- **Best for**: Complex cell shapes with attention-guided segmentation

### ResUNet Small
- **Parameters**: ~60M
- **Description**: Lightweight ResUNet optimized for efficiency
- **Best for**: Fast processing with good accuracy

## API Endpoints

### Health Check
```http
GET /api/v1/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "models_loaded": 1,
  "gpu_available": true
}
```

### Available Models
```http
GET /api/v1/models
```

Response:
```json
{
  "models": [
    {
      "name": "hrnet",
      "description": "High-Resolution Network for semantic segmentation",
      "parameters": 66000000,
      "input_size": [3, 1024, 1024],
      "available": true
    }
  ]
}
```

### Segmentation
```http
POST /api/v1/segment?model=hrnet&threshold=0.5
Content-Type: multipart/form-data

file: [image_file]
```

Response:
```json
{
  "success": true,
  "polygons": [
    {
      "points": [
        {"x": 100.5, "y": 200.3},
        {"x": 150.2, "y": 180.1}
      ],
      "area": 1250.5,
      "confidence": 0.95
    }
  ],
  "model_used": "hrnet",
  "threshold_used": 0.5,
  "processing_time": 2.34,
  "image_size": {
    "width": 1024,
    "height": 1024
  }
}
```

## Installation & Setup

### Prerequisites

- Python 3.10+
- PyTorch 2.0+ (with CUDA support for GPU acceleration)
- FastAPI and dependencies (see requirements.txt)

### Local Development

1. **Install Dependencies**:
```bash
pip install -r requirements.txt
```

2. **Verify Model Weights**:
Ensure model weights are present in the `weights/` directory:
- `hrnet_best_model.pth`
- `resunet_advanced_best_model.pth` 
- `resunet_small_best_model.pth`

3. **Start Development Server**:
```bash
python api/main.py
```

The service will be available at `http://localhost:8000`

4. **View API Documentation**:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

### Docker Deployment

1. **Build Image**:
```bash
docker build -t cell-segmentation .
```

2. **Run Container**:
```bash
docker run -p 8000:8000 cell-segmentation
```

For GPU support:
```bash
docker run --gpus all -p 8000:8000 cell-segmentation
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8000 | Server port |
| `ML_SERVICE_URL` | http://localhost:8000 | Service URL for Node.js backend |

## Integration with Node.js Backend

The microservice is integrated with the Node.js backend through the `SegmentationService`:

### Node.js Service Usage

```typescript
import { SegmentationService } from './services/segmentationService';

const segmentationService = new SegmentationService(prisma, imageService);

// Request segmentation
const result = await segmentationService.requestSegmentation({
  imageId: 'uuid-here',
  model: 'hrnet',
  threshold: 0.5,
  userId: 'user-uuid'
});

// Batch processing
const batchResult = await segmentationService.batchProcess(
  ['image1', 'image2'], 
  'hrnet', 
  0.5, 
  'user-uuid'
);
```

### API Routes (Node.js)

- `POST /api/segmentation/images/:imageId/segment` - Segment single image
- `GET /api/segmentation/images/:imageId/results` - Get segmentation results
- `DELETE /api/segmentation/images/:imageId/results` - Delete results
- `POST /api/segmentation/batch` - Batch process multiple images
- `GET /api/segmentation/models` - Get available models
- `GET /api/segmentation/health` - Check service health

## Performance

### Typical Processing Times (GPU)
- **HRNet**: ~2-3 seconds per 1024x1024 image
- **ResUNet Advanced**: ~1.8-2.5 seconds per image
- **ResUNet Small**: ~1.2-1.8 seconds per image

### Memory Usage
- **Base Memory**: ~2-3 GB
- **Per Model**: ~500-800 MB when loaded
- **Peak Processing**: +1-2 GB during inference

## Error Handling

The service provides detailed error responses:

```json
{
  "success": false,
  "error": "Invalid image file. Supported formats: PNG, JPG, JPEG, TIFF, BMP",
  "detail": "File type not supported"
}
```

Common error codes:
- `400`: Invalid request parameters
- `413`: File too large (max 50MB)
- `500`: Internal processing error
- `503`: Service unavailable

## Monitoring & Health

### Health Checks

The service provides comprehensive health monitoring:

```bash
curl http://localhost:8000/api/v1/health
```

### Logging

Structured logging with levels:
- `INFO`: Normal operations
- `WARNING`: Non-critical issues
- `ERROR`: Processing failures
- `DEBUG`: Detailed debugging info

### Metrics

Key performance metrics:
- Model loading times
- Inference processing times
- Memory usage per model
- Request success/failure rates

## Development

### Adding New Models

1. Add model architecture to `models/` directory
2. Update `ModelManager` in `services/model_loader.py`
3. Add model configuration and weights path
4. Update API models in `api/models.py`

### Testing

```bash
# Install test dependencies
pip install pytest pytest-asyncio httpx

# Run tests
pytest tests/
```

### Code Quality

```bash
# Format code
black .

# Lint code
pylint api/ services/ utils/

# Type checking
mypy .
```

## Troubleshooting

### Common Issues

1. **CUDA Out of Memory**:
   - Reduce batch size or use CPU inference
   - Unload unused models

2. **Model Loading Failures**:
   - Verify model weights exist and are valid
   - Check PyTorch version compatibility

3. **Slow Inference**:
   - Ensure GPU is available and detected
   - Check image preprocessing pipeline

### Debug Mode

Enable debug logging:
```bash
export LOG_LEVEL=DEBUG
python api/main.py
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit pull request

For questions or issues, please create a GitHub issue.