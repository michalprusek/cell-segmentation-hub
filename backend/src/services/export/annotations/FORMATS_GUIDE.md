# Annotation Export Formats Guide

This comprehensive guide covers all annotation export formats supported by SpheroSeg: COCO, YOLO, and JSON.

## Quick Format Comparison

| Format | Best For | File Structure | Tool Support |
|--------|----------|----------------|--------------|
| **COCO** | Instance segmentation research | Single JSON file | CVAT, Detectron2, MMDetection |
| **YOLO** | Real-time detection training | Multiple text files | YOLOv8, CVAT (with conversion) |
| **JSON** | Custom workflows, full detail | Custom JSON structure | Custom tools, LabelMe (with conversion) |

## Scale Conversion

When pixel-to-micrometer scale is provided:
- **Area measurements**: Converted from px² to µm²
- **Linear measurements**: Converted from px to µm  
- **Dimensionless ratios**: Unchanged (circularity, solidity, etc.)

## COCO Format

### Structure
```json
{
  "info": {...},
  "categories": [
    {"id": 1, "name": "cell"},
    {"id": 2, "name": "cell_hole"}
  ],
  "images": [...],
  "annotations": [...]
}
```

### CVAT Import
1. Create project with polygon labels
2. Upload images
3. Import `annotations.json` as COCO 1.0
4. Verify polygon boundaries

### Usage
- Widely supported by ML frameworks
- Best for segmentation tasks
- Preserves polygon detail

## YOLO Format

### Structure
```
yolo/
├── classes.txt       # Class names
├── data.yaml        # Dataset config
└── labels/          # One file per image
    └── image1.txt   # Normalized coordinates
```

### Training with YOLOv8
```python
from ultralytics import YOLO
model = YOLO('yolov8n-seg.pt')
model.train(data='data.yaml', epochs=100)
```

### Conversion Required
YOLO format requires conversion for CVAT import. Use provided conversion scripts.

## JSON Format

### Structure
```json
{
  "version": "1.0",
  "scale_conversion": {...},
  "images": [{
    "polygons": [{
      "coordinates": [...],
      "metrics": {...},
      "processing": {...}
    }]
  }]
}
```

### Features
- Full metric preservation
- Processing metadata
- Scale conversion info
- Custom attributes

### Conversion Tools
Convert to other formats using provided Python scripts in the format directories.

## Best Practices

### Before Export
1. Verify segmentation quality
2. Set appropriate scale if using microscopy
3. Select relevant formats for your workflow

### During Annotation
1. Use polygon mode for cell boundaries
2. Maintain consistent labeling
3. Save work frequently

### After Export
1. Validate file integrity
2. Test import in target tool
3. Keep original exports as backup

## Tool-Specific Instructions

### CVAT Setup
- Configure labels before import
- Use COCO format for best compatibility
- Enable polygon attributes for metadata

### YOLOv8 Training
- Prepare train/val/test splits
- Adjust hyperparameters for cell data
- Monitor mAP metrics during training

### Custom Workflows
- Use JSON format for maximum flexibility
- Parse with standard JSON libraries
- Preserve scale conversion metadata

## Troubleshooting

### Common Issues
- **Import fails**: Check label names match exactly
- **Missing polygons**: Verify coordinate normalization
- **Scale errors**: Confirm pixel/µm ratio is correct

### Support
For format-specific issues, consult the individual README files in each format directory.