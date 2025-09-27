# JSON Format Annotations

This directory contains annotations exported in a custom JSON format that preserves full polygon detail and metadata from SpheroSeg processing.

## File Structure

```
json/
├── annotations.json    # Main annotation file
├── metadata.json      # Export metadata and settings
└── README.md          # This file
```

## JSON Format Overview

### Main Annotations File

```json
{
  "version": "1.0",
  "format": "spheroseg_polygons",
  "export_date": "2025-08-21T12:00:00Z",
  "scale_conversion": {
    "micrometers_per_pixel": 0.5,
    "units": "µm/pixel"
  },
  "images": [
    {
      "id": "img_001",
      "file_name": "cell_image_001.jpg",
      "width": 1920,
      "height": 1080,
      "polygons": [
        {
          "id": "poly_001",
          "type": "external",
          "coordinates": [
            { "x": 100.5, "y": 200.3 },
            { "x": 150.2, "y": 180.7 },
            { "x": 160.1, "y": 220.9 }
          ],
          "metrics": {
            "area": 1250.5,
            "perimeter": 180.2,
            "circularity": 0.85,
            "centroid": { "x": 136.9, "y": 200.6 }
          },
          "processing": {
            "model": "HRNetV2",
            "confidence": 0.92,
            "threshold": 0.5,
            "processing_time": 3.1
          }
        }
      ]
    }
  ]
}
```

## Setting Up CVAT for JSON Import

### 1. Convert JSON to COCO Format

Since CVAT doesn't directly import our custom JSON format, use this conversion script:

```python
# json_to_coco_converter.py
import json
from datetime import datetime

def spheroseg_json_to_coco(input_file, output_file):
    """Convert SpheroSeg JSON format to COCO for CVAT import"""

    with open(input_file, 'r') as f:
        spheroseg_data = json.load(f)

    # Initialize COCO structure
    coco_data = {
        "info": {
            "description": f"SpheroSeg Export - {spheroseg_data.get('export_date', '')}",
            "version": spheroseg_data.get('version', '1.0'),
            "year": datetime.now().year,
            "contributor": "SpheroSeg",
            "date_created": datetime.now().isoformat()
        },
        "categories": [
            {
                "id": 1,
                "name": "cell",
                "supercategory": "biological"
            },
            {
                "id": 2,
                "name": "cell_hole",
                "supercategory": "biological"
            }
        ],
        "images": [],
        "annotations": []
    }

    annotation_id = 1

    # Process each image
    for img_idx, image_data in enumerate(spheroseg_data.get('images', [])):
        # Add image information
        image_info = {
            "id": img_idx + 1,
            "file_name": image_data['file_name'],
            "width": image_data['width'],
            "height": image_data['height']
        }
        coco_data["images"].append(image_info)

        # Process polygons
        for polygon in image_data.get('polygons', []):
            # Convert coordinates to COCO segmentation format
            segmentation = []
            for coord in polygon['coordinates']:
                segmentation.extend([coord['x'], coord['y']])

            # Determine category based on polygon type
            category_id = 1 if polygon['type'] == 'external' else 2

            # Calculate bounding box
            xs = [coord['x'] for coord in polygon['coordinates']]
            ys = [coord['y'] for coord in polygon['coordinates']]
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)
            bbox = [x_min, y_min, x_max - x_min, y_max - y_min]

            # Create annotation
            annotation = {
                "id": annotation_id,
                "image_id": img_idx + 1,
                "category_id": category_id,
                "segmentation": [segmentation],
                "area": polygon.get('metrics', {}).get('area', 0),
                "bbox": bbox,
                "iscrowd": 0,
                "attributes": {
                    "confidence": polygon.get('processing', {}).get('confidence', 1.0),
                    "model": polygon.get('processing', {}).get('model', 'unknown'),
                    "circularity": polygon.get('metrics', {}).get('circularity', 0)
                }
            }
            coco_data["annotations"].append(annotation)
            annotation_id += 1

    # Save COCO file
    with open(output_file, 'w') as f:
        json.dump(coco_data, f, indent=2)

    print(f"Converted {len(coco_data['images'])} images with {len(coco_data['annotations'])} annotations")

# Usage
if __name__ == "__main__":
    spheroseg_json_to_coco("annotations.json", "coco_for_cvat.json")
```

### 2. Create CVAT Project

1. **Project Setup**:
   - **Name**: `Cell Analysis - Full Detail`
   - **Description**: Include scale conversion info if available

2. **Advanced Label Configuration**:

```yaml
# Enhanced labels with attributes from JSON
- name: 'cell'
  color: '#00AA00'
  type: 'polygon'
  attributes:
    - name: 'confidence'
      type: 'number'
      min: 0.0
      max: 1.0
      step: 0.01
    - name: 'model'
      type: 'select'
      values: ['HRNetV2', 'CBAM-ResUNet', 'MA-ResUNet', 'unknown']
    - name: 'area'
      type: 'number'
      min: 0
    - name: 'circularity'
      type: 'number'
      min: 0.0
      max: 1.0
      step: 0.01
    - name: 'processing_time'
      type: 'number'
      min: 0.0
    - name: 'threshold'
      type: 'number'
      min: 0.0
      max: 1.0
      step: 0.1

- name: 'cell_hole'
  color: '#AA0000'
  type: 'polygon'
  attributes:
    - name: 'parent_cell'
      type: 'text'
```

### 3. Import Process

1. **Convert format**:

   ```bash
   python json_to_coco_converter.py
   ```

2. **Upload to CVAT**:
   - Create task with original images
   - Import `coco_for_cvat.json` as COCO 1.0 format
   - Verify attributes are preserved

### 4. Working with Rich Metadata

The JSON format preserves detailed information that can be used for:

#### Quality Analysis

- **Confidence filtering**: Hide/show polygons by ML confidence
- **Model comparison**: Compare results from different segmentation models
- **Metric validation**: Cross-check calculated metrics

#### Advanced Workflows

```python
# analyze_quality.py
import json

def analyze_annotation_quality(json_file):
    """Analyze annotation quality from SpheroSeg JSON export"""

    with open(json_file) as f:
        data = json.load(f)

    stats = {
        'total_polygons': 0,
        'avg_confidence': 0,
        'low_confidence': 0,
        'models_used': set(),
        'size_distribution': []
    }

    for image in data['images']:
        for polygon in image['polygons']:
            stats['total_polygons'] += 1

            # Confidence analysis
            conf = polygon.get('processing', {}).get('confidence', 1.0)
            stats['avg_confidence'] += conf
            if conf < 0.7:
                stats['low_confidence'] += 1

            # Model tracking
            model = polygon.get('processing', {}).get('model', 'unknown')
            stats['models_used'].add(model)

            # Size analysis
            area = polygon.get('metrics', {}).get('area', 0)
            stats['size_distribution'].append(area)

    # Calculate averages
    if stats['total_polygons'] > 0:
        stats['avg_confidence'] /= stats['total_polygons']
        stats['avg_area'] = sum(stats['size_distribution']) / len(stats['size_distribution'])

    return stats

# Usage
quality_stats = analyze_annotation_quality('annotations.json')
print(f"Quality Report:")
print(f"- Total polygons: {quality_stats['total_polygons']}")
print(f"- Average confidence: {quality_stats['avg_confidence']:.3f}")
print(f"- Low confidence (<0.7): {quality_stats['low_confidence']}")
print(f"- Models used: {list(quality_stats['models_used'])}")
```

## Export Back to JSON

To export enhanced annotations back from CVAT:

```python
# coco_to_spheroseg_json.py
import json
from datetime import datetime

def coco_to_spheroseg_json(coco_file, original_json, output_file):
    """Convert CVAT COCO export back to SpheroSeg JSON format"""

    # Load original metadata
    with open(original_json) as f:
        original_data = json.load(f)

    # Load CVAT export
    with open(coco_file) as f:
        coco_data = json.load(f)

    # Rebuild SpheroSeg format with edits
    spheroseg_data = {
        "version": original_data.get('version', '1.0'),
        "format": "spheroseg_polygons_edited",
        "export_date": datetime.now().isoformat(),
        "scale_conversion": original_data.get('scale_conversion', {}),
        "editing_history": {
            "source": "cvat_export",
            "original_polygons": count_original_polygons(original_data),
            "edited_polygons": len(coco_data['annotations'])
        },
        "images": []
    }

    # Process each image
    image_map = {img['id']: img for img in coco_data['images']}

    # Build mapping of original image data for metadata preservation
    original_image_map = {}
    for orig_img in original_data.get('images', []):
        # Map by file name for more reliable matching
        original_image_map[orig_img.get('file_name')] = orig_img

    for image_id, image_info in image_map.items():
        # Get annotations for this image
        image_annotations = [
            ann for ann in coco_data['annotations']
            if ann['image_id'] == image_id
        ]

        # Get original image metadata if it exists
        original_image_metadata = original_image_map.get(image_info['file_name'], {})

        # Build image data
        image_data = {
            "id": f"img_{image_id:03d}",
            "file_name": image_info['file_name'],
            "width": image_info['width'],
            "height": image_info['height'],
            "polygons": []
        }

        # Merge any per-image metadata from original (scale, model defaults, etc.)
        for key, value in original_image_metadata.items():
            if key not in ['id', 'file_name', 'width', 'height', 'polygons']:
                image_data[key] = value

        # Convert annotations back to polygons
        for ann in image_annotations:
            segmentation = ann['segmentation'][0]
            coordinates = []
            for i in range(0, len(segmentation), 2):
                coordinates.append({
                    "x": segmentation[i],
                    "y": segmentation[i + 1]
                })

            polygon_type = "external" if ann['category_id'] == 1 else "internal"

            polygon_data = {
                "id": f"poly_{ann['id']:03d}",
                "type": polygon_type,
                "coordinates": coordinates,
                "metrics": {
                    "area": ann.get('area', 0),
                    "bbox": ann['bbox']
                },
                "processing": ann.get('attributes', {})
            }

            image_data['polygons'].append(polygon_data)

        spheroseg_data['images'].append(image_data)

    # Save enhanced JSON
    with open(output_file, 'w') as f:
        json.dump(spheroseg_data, f, indent=2)

def count_original_polygons(data):
    """Count total polygons in original data"""
    total = 0
    for image in data.get('images', []):
        total += len(image.get('polygons', []))
    return total
```

## Advanced Use Cases

### 1. Quality Control Pipeline

```python
import json

# Automated quality checking
def quality_control_check(json_file):
    """Run automated quality control on annotations"""
    issues = []

    with open(json_file) as f:
        data = json.load(f)

    for image in data['images']:
        for polygon in image['polygons']:
            # Check minimum confidence
            conf = polygon.get('processing', {}).get('confidence', 1.0)
            if conf < 0.5:
                issues.append(f"Low confidence polygon {polygon['id']}: {conf}")

            # Check polygon validity
            if len(polygon['coordinates']) < 3:
                issues.append(f"Invalid polygon {polygon['id']}: <3 points")

            # Check size reasonableness
            area = polygon.get('metrics', {}).get('area', 0)
            if area < 10 or area > 100000:
                issues.append(f"Unusual size polygon {polygon['id']}: {area}")

    return issues
```

### 2. Batch Processing

```python
from pathlib import Path

# Process multiple JSON exports
def batch_convert_to_cvat(input_dir, output_dir):
    """Convert multiple SpheroSeg JSON exports for CVAT import"""

    for json_file in Path(input_dir).glob("*.json"):
        if json_file.name == "metadata.json":
            continue

        output_coco = output_dir / f"cvat_{json_file.stem}.json"
        spheroseg_json_to_coco(str(json_file), str(output_coco))
        print(f"Converted {json_file.name} → {output_coco.name}")
```

## Integration with Analysis Tools

### LabelMe Integration

```python
import json
from pathlib import Path

# Convert to LabelMe format
def to_labelme_format(spheroseg_json, output_dir):
    """Convert to LabelMe individual JSON files"""

    with open(spheroseg_json) as f:
        data = json.load(f)

    for image in data['images']:
        labelme_data = {
            "version": "5.0.1",
            "flags": {},
            "shapes": [],
            "imagePath": image['file_name'],
            "imageData": None,
            "imageHeight": image['height'],
            "imageWidth": image['width']
        }

        for polygon in image['polygons']:
            shape = {
                "label": polygon['type'],
                "points": [[c['x'], c['y']] for c in polygon['coordinates']],
                "group_id": None,
                "shape_type": "polygon",
                "flags": {}
            }
            labelme_data['shapes'].append(shape)

        # Save individual JSON file
        output_file = output_dir / f"{Path(image['file_name']).stem}.json"
        with open(output_file, 'w') as f:
            json.dump(labelme_data, f, indent=2)
```

## Best Practices

### Data Preservation

- ✅ **Keep original JSON** as master reference
- ✅ **Version control** annotation changes
- ✅ **Backup before editing** in external tools
- ✅ **Document modifications** in metadata

### Quality Assurance

- 🔍 **Validate coordinates** are within image bounds
- 📊 **Check metric consistency** after edits
- 🎯 **Verify polygon closure** (first = last point)
- ⚡ **Test round-trip conversion** (JSON → COCO → JSON)

### Performance Tips

- Use streaming JSON parsers for large files
- Batch process multiple images together
- Cache converted files to avoid re-processing

## Related Resources

- [JSON Schema Validation](https://json-schema.org/)
- [LabelMe Documentation](https://github.com/wkentaro/labelme)
- [SpheroSeg Export Overview](../../README.md)
