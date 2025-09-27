# YOLO Format Annotations

This directory contains annotations exported in YOLO (You Only Look Once) format, optimized for object detection and segmentation training.

## File Structure

```
yolo/
├── classes.txt         # Class names mapping
├── data.yaml          # Dataset configuration
├── labels/            # Individual annotation files (.txt)
│   ├── image1.txt
│   ├── image2.txt
│   └── ...
└── README.md          # This file
```

## YOLO Format Overview

### Segmentation Format

Each `.txt` file contains polygon annotations in normalized coordinates:

```
# Format: class_id x1 y1 x2 y2 x3 y3 ... xn yn
0 0.1 0.2 0.15 0.3 0.2 0.25 0.12 0.18
0 0.6 0.7 0.65 0.8 0.7 0.75 0.62 0.68
```

### Classes Configuration

```yaml
# classes.txt
cell
cell_hole
```

### Dataset Configuration

```yaml
# data.yaml
path: /path/to/dataset
train: images/train
val: images/val
test: images/test

nc: 2 # number of classes
names: ['cell', 'cell_hole']
```

## Setting Up CVAT for YOLO Import

### 1. Create CVAT Project

1. **Login to CVAT** and create new project
2. **Project Configuration**:
   - **Name**: `Cell Detection - YOLO`
   - **Labels**: Configure for YOLO compatibility

### 2. Label Setup for YOLO

Configure labels to match YOLO classes:

```yaml
# Label 1: Primary cell detection
- name: 'cell'
  color: '#00FF00'
  type: 'polygon' # For segmentation
  # OR type: "rectangle" for detection only
  attributes:
    - name: 'cell_id'
      type: 'text'
    - name: 'quality'
      type: 'select'
      values: ['good', 'fair', 'poor']

# Label 2: Cell holes/internal structures
- name: 'cell_hole'
  color: '#FF0000'
  type: 'polygon'
  attributes:
    - name: 'parent_cell'
      type: 'text'
```

### 3. Convert YOLO to COCO for CVAT Import

Since CVAT doesn't directly import YOLO segmentation format, convert first:

```python
# convert_yolo_to_coco.py
import json
import os
from pathlib import Path

def yolo_to_coco(yolo_dir, image_dir, output_file):
    """Convert YOLO segmentation to COCO format for CVAT import"""

    coco_data = {
        "info": {
            "description": "Cell Segmentation - YOLO converted",
            "version": "1.0",
            "year": 2025,
            "contributor": "SpheroSeg"
        },
        "categories": [
            {"id": 1, "name": "cell", "supercategory": "biological"},
            {"id": 2, "name": "cell_hole", "supercategory": "biological"}
        ],
        "images": [],
        "annotations": []
    }

    # Load class names
    with open(f"{yolo_dir}/classes.txt") as f:
        classes = [line.strip() for line in f]

    image_id = 1
    annotation_id = 1

    # Process each image
    for img_file in Path(image_dir).glob("*.jpg"):
        # Add image info
        img_info = {
            "id": image_id,
            "file_name": img_file.name,
            "width": 1920,  # Update with actual dimensions
            "height": 1080
        }
        coco_data["images"].append(img_info)

        # Process annotations
        label_file = f"{yolo_dir}/labels/{img_file.stem}.txt"
        if os.path.exists(label_file):
            with open(label_file) as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) < 6:  # Skip invalid lines
                        continue

                    class_id = int(parts[0]) + 1  # COCO uses 1-based IDs
                    coords = list(map(float, parts[1:]))

                    # Convert normalized to absolute coordinates
                    segmentation = []
                    for i in range(0, len(coords), 2):
                        x = coords[i] * img_info["width"]
                        y = coords[i+1] * img_info["height"]
                        segmentation.extend([x, y])

                    annotation = {
                        "id": annotation_id,
                        "image_id": image_id,
                        "category_id": class_id,
                        "segmentation": [segmentation],
                        "area": calculate_polygon_area(segmentation),
                        "bbox": calculate_bbox(segmentation),
                        "iscrowd": 0
                    }
                    coco_data["annotations"].append(annotation)
                    annotation_id += 1

        image_id += 1

    # Save COCO file
    with open(output_file, 'w') as f:
        json.dump(coco_data, f, indent=2)

def calculate_polygon_area(coords):
    """Calculate polygon area using shoelace formula"""
    n = len(coords) // 2
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += coords[i*2] * coords[j*2 + 1]
        area -= coords[j*2] * coords[i*2 + 1]
    return abs(area) / 2

def calculate_bbox(coords):
    """Calculate bounding box from polygon coordinates"""
    xs = [coords[i] for i in range(0, len(coords), 2)]
    ys = [coords[i] for i in range(1, len(coords), 2)]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return [x_min, y_min, x_max - x_min, y_max - y_min]

# Usage
if __name__ == "__main__":
    yolo_to_coco("./yolo", "./images", "annotations_from_yolo.json")
```

### 4. Import to CVAT

1. **Run conversion**:

   ```bash
   python convert_yolo_to_coco.py
   ```

2. **Upload to CVAT**:
   - Create task with your images
   - Import `annotations_from_yolo.json` as COCO format

### 5. Export from CVAT to YOLO

After editing in CVAT:

1. **Export dataset**: Choose "YOLO 1.1" format
2. **Download**: Gets YOLO-formatted annotations
3. **File structure**:
   ```
   dataset/
   ├── images/
   ├── labels/
   ├── data.yaml
   └── classes.txt
   ```

## Training with YOLOv8

### Setup Training

```python
# train_cell_detection.py
from ultralytics import YOLO

# Load pre-trained model
model = YOLO('yolov8n-seg.pt')  # nano model for segmentation

# Train model
results = model.train(
    data='data.yaml',
    epochs=100,
    imgsz=640,
    batch=16,
    name='cell_segmentation',
    patience=10,
    save_period=10
)

# Validate
metrics = model.val()
print(f"mAP50: {metrics.box.map50:.3f}")
print(f"mAP50-95: {metrics.box.map:.3f}")
```

### Configuration File

```yaml
# data.yaml for training
path: /path/to/cell_dataset
train: images/train
val: images/val
test: images/test

nc: 2
names: ['cell', 'cell_hole']

# Training hyperparameters
lr0: 0.01
lrf: 0.01
momentum: 0.937
weight_decay: 0.0005
warmup_epochs: 3
warmup_momentum: 0.8
warmup_bias_lr: 0.1
```

## Label Mapping

| SpheroSeg Export | YOLO Class ID | Class Name |
| ---------------- | ------------- | ---------- |
| External polygon | 0             | cell       |
| Internal polygon | 1             | cell_hole  |

## Best Practices

### Data Preparation

- ✅ **Normalize coordinates** (0.0 to 1.0 range)
- ✅ **Consistent image sizes** for better training
- ✅ **Balanced dataset** with various cell types
- ✅ **Train/Val/Test split** (70/20/10 ratio)

### Training Tips

- 🎯 **Start with pre-trained weights** (YOLOv8n-seg.pt)
- 📊 **Monitor validation metrics** during training
- 🔄 **Use data augmentation** for robustness
- ⚡ **Adjust batch size** based on GPU memory

### Quality Assurance

- 👀 **Visual inspection** of predictions
- 📈 **Confusion matrix** analysis
- 🎲 **Cross-validation** on different datasets
- 🔍 **Error analysis** for improvement

## Integration Examples

### Real-time Detection

```python
from ultralytics import YOLO

# Load trained model
model = YOLO('runs/segment/cell_segmentation/weights/best.pt')

# Run inference
results = model('path/to/cell_image.jpg')

# Process results
for r in results:
    # Get polygon masks
    masks = r.masks.xy  # List of polygon coordinates
    boxes = r.boxes.xyxy  # Bounding boxes
    scores = r.boxes.conf  # Confidence scores
```

### Batch Processing

```python
# Process entire directory
results = model('path/to/images/*.jpg', save=True, save_txt=True)
```

## Troubleshooting

### Common Issues

- **"Invalid coordinates"**: Check normalization (0.0-1.0 range)
- **"Class ID out of range"**: Verify classes.txt matches data.yaml
- **"Empty annotations"**: Ensure polygon has minimum 3 points

### Performance Tips

- Use appropriate image size (640x640 for YOLOv8)
- Balance precision vs speed with model size (n/s/m/l/x)
- Monitor GPU utilization during training

## Related Resources

- [YOLOv8 Documentation](https://docs.ultralytics.com/)
- [CVAT YOLO Export Guide](https://opencv.github.io/cvat/docs/)
- [Cell Detection Best Practices](../../README.md)
