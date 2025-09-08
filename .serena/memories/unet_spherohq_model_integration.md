# UNet (SpheroHQ) Model Integration

## Overview

Successfully integrated UNet model optimized for SpheroHQ dataset into the Cell Segmentation Hub application as a third ML model option alongside HRNet and CBAM-ResUNet.

## Implementation Date

2025-09-07

## Model Details

- **Model Name**: unet_spherohq
- **Display Name**: UNet (SpheroHQ Best)
- **Architecture**: Standard U-Net with 5 encoder/decoder levels
- **Features**: [64, 128, 256, 512, 1024]
- **Parameters**: 45.20M
- **Weight File**: `/app/weights/unet_spherohq_best.pth` (429MB)
- **Original Location**: `/home/cvat/cell-segmentation-hub/best_model.pth`

## Performance Metrics

### CPU Performance (Current)

- **Inference Time**: ~3.6s per 512x512 image
- **Throughput**: 0.3 images/sec
- **Optimal Batch Size**: 1
- **Max Safe Batch Size**: 2
- **P95 Latency**: 3500ms

### Expected GPU Performance

- **Inference Time**: ~0.25s per image
- **Throughput**: 10 images/sec
- **Optimal Batch Size**: 4
- **Max Safe Batch Size**: 6
- **P95 Latency**: 400ms

## Integration Points

### 1. ML Service (Python/FastAPI)

- **Model Definition**: `/backend/segmentation/models/unet.py`
- **Model Registry**: `/backend/segmentation/ml/model_loader.py`
- **API Types**: `/backend/segmentation/api/models.py`
- **Batch Config**: `/backend/segmentation/config/batch_sizes.json`

### 2. Backend Service (Node.js/Express)

- **TypeScript Types**: `/backend/src/types/validation.ts`
- **Service Interface**: `/backend/src/services/segmentationService.ts`
- **API Routes**: `/backend/src/api/routes/mlRoutes.ts`

### 3. Frontend (React/TypeScript)

- **Model Types**: `/src/contexts/ModelContext.types.ts`
- **Model Utils**: `/src/lib/modelUtils.ts`
- **Translations**: `/src/translations/*.ts` (all 6 languages)

## Key Implementation Details

### Model Registration Pattern

```python
AVAILABLE_MODELS = {
    'unet_spherohq': {
        'class': UNet,
        'pretrained_path': 'weights/unet_spherohq_best.pth',
        'finetuned_path': 'weights/unet_spherohq_best.pth',
        'config_path': None
    }
}
```

### Model Initialization

```python
elif model_name == 'unet_spherohq':
    model = UNet(in_channels=3, out_channels=1,
                 features=[64, 128, 256, 512, 1024],
                 use_instance_norm=True, dropout_rate=0.0,
                 use_deep_supervision=False)
```

### TypeScript Type Extension

```typescript
export type ModelType = 'hrnet' | 'cbam_resunet' | 'unet_spherohq';
```

## Translation Keys

Added to all 6 languages (EN, CS, ES, DE, FR, ZH):

- `settings.modelSelection.models.unet_spherohq.name`
- `settings.modelSelection.models.unet_spherohq.description`
- `settings.modelDescription.unet_spherohq`
- `docs.modelSelection.models.unet_spherohq.*`

## Testing Results

- ✅ Model loads successfully
- ✅ Inference produces correct output shape
- ✅ API endpoints recognize the model
- ✅ Frontend displays model option
- ✅ Translations complete for all languages
- ⚠️ Performance limited on CPU (0.3 img/s vs expected 10 img/s on GPU)

## Important Notes

1. **Weight File Format**: The model weights are saved with argparse.Namespace which causes a warning but loads successfully with `weights_only=False`

2. **CPU vs GPU Performance**: Current deployment runs on CPU with significantly reduced performance. With GPU (NVIDIA RTX A5000), expect 10-30x speedup.

3. **Model Description**: Marketed as "SpheroHQ Best" - optimized specifically for the SpheroHQ spheroid dataset

4. **Batch Size Adjustment**: Due to CPU limitations, batch sizes were adjusted down from optimal GPU values

## Future Optimizations

1. **GPU Deployment**: Deploy on GPU-enabled infrastructure for production performance
2. **Model Quantization**: Consider INT8 quantization for faster CPU inference
3. **ONNX Export**: Export to ONNX for optimized inference runtime
4. **Weight File Cleanup**: Re-save weights without argparse.Namespace to eliminate warning

## Verification Commands

```bash
# Check model availability
curl http://localhost:8000/api/v1/models | jq .

# Test model loading
docker exec spheroseg-ml python -c "
from ml.model_loader import ModelLoader
loader = ModelLoader('.')
model = loader.load_model('unet_spherohq')
print(f'Model loaded: {type(model).__name__}')
"

# Check translations
npm run i18n:validate
```

## Related Files Modified

- 18 files modified across ML service, backend, and frontend
- All changes maintain backward compatibility
- No breaking changes to existing models
