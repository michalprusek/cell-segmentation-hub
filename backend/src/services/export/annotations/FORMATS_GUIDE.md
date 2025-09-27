# Annotation Export Formats Guide

This comprehensive guide covers all annotation export formats supported by SpheroSeg: COCO, YOLO, and JSON.

## Quick Format Comparison

| Format   | Best For                       | File Structure        | Tool Support                            |
| -------- | ------------------------------ | --------------------- | --------------------------------------- |
| **COCO** | Instance segmentation research | Single JSON file      | CVAT, Detectron2, MMDetection           |
| **YOLO** | Real-time detection training   | Multiple text files   | YOLOv8, CVAT (with conversion)          |
| **JSON** | Custom workflows, full detail  | Custom JSON structure | Custom tools, LabelMe (with conversion) |

## Scale Conversion

**Important**: Polygon coordinates remain in pixel units for COCO/YOLO formats (YOLO coordinates are normalized to [0,1] range). The pixel-to-micrometer scale is applied ONLY to computed measurements/metrics and the JSON metrics fields.

When pixel-to-micrometer scale is provided:

- **Polygon coordinates**: Remain in pixel units (COCO) or normalized [0,1] (YOLO)
- **Area measurements**: Converted from px² to µm² in metrics only
- **Linear measurements**: Converted from px to µm in metrics only
- **Dimensionless ratios**: Unchanged (circularity, solidity, etc.)

When no scale is provided, all values remain in pixels.

**Precision and Rounding**:

- Linear measurements (µm): 3 decimal places
- Area measurements (µm²): 4 decimal places
- Rounding mode: Round-half-up (0.5 rounds up)

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

### Required Fields

**Images array** (each image object):

- `id` (integer): Unique image identifier
- `file_name` (string): Image filename
- `width` (integer): Image width in pixels
- `height` (integer): Image height in pixels

**Annotations array** (each annotation object):

- `id` (integer): Unique annotation identifier
- `image_id` (integer): Reference to image.id
- `category_id` (integer): Reference to category.id (1=cell, 2=cell_hole)
- `segmentation` (array): Polygon coordinates as [[x1,y1,x2,y2,...]] - exported as polygon lists, NOT RLE
- `area` (float): Polygon area in pixels²
- `bbox` (array): Bounding box [x,y,width,height]
- `iscrowd` (integer): Always 0 for instance segmentation

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
  "scale_conversion": {
    "micrometers_per_pixel": 0.5
  },
  "images": [
    {
      "image_id": "img_001",
      "file_name": "sample.jpg",
      "width": 1920,
      "height": 1080,
      "polygons": [
        {
          "type": "external",
          "coordinates": [
            [100, 200],
            [150, 250],
            [120, 280]
          ],
          "area": 4250.5, // µm² if scale provided, px² otherwise
          "perimeter": 185.3, // µm if scale provided, px otherwise
          "circularity": 0.85, // dimensionless
          "solidity": 0.92, // dimensionless
          "metrics": {
            "centroid": { "x": 123.5, "y": 243.3 }, // pixels
            "bbox": { "x": 100, "y": 200, "width": 50, "height": 80 } // pixels
          },
          "processing": {
            "model": "HRNetV2",
            "timestamp": "2024-01-15T10:30:00Z"
          }
        },
        {
          "type": "internal", // hole within external polygon
          "coordinates": [
            [110, 210],
            [130, 215],
            [125, 225]
          ],
          "area": 325.8, // µm² if scale provided
          "perimeter": 42.1 // µm if scale provided
        }
      ]
    }
  ]
}
```

**Note**: Areas of internal polygons are subtracted from their corresponding external polygon metrics to compute final region metrics.

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
