# COCO Format Annotations

This directory contains annotations exported in Microsoft COCO (Common Objects in Context) format, optimized for cell segmentation annotation workflows.

## File Structure

```
coco/
├── annotations.json    # Main COCO annotation file
├── README.md          # This file
└── images/            # (Optional) Image references
```

## COCO Format Overview

The exported `annotations.json` follows the COCO format specification:

```json
{
  "info": {
    "description": "Cell Segmentation Export",
    "version": "1.0",
    "year": 2025,
    "contributor": "SpheroSeg",
    "date_created": "2025-08-21T12:00:00Z"
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
  "images": [...],
  "annotations": [...]
}
```

## Setting Up CVAT for Cell Segmentation

### 1. Create New Project in CVAT

1. **Login to CVAT** and click "Create new project"
2. **Project Settings**:
   - **Name**: `Cell Segmentation - [Project Name]`
   - **Labels**: Configure as follows:

### 2. Label Configuration

Create these labels in CVAT:

```yaml
# Primary cell label
- name: 'cell'
  color: '#FF0000'
  type: 'polygon'
  attributes:
    - name: 'cell_type'
      type: 'select'
      values: ['unknown', 'healthy', 'damaged', 'dividing']
    - name: 'confidence'
      type: 'number'
      min: 0.0
      max: 1.0
      step: 0.1
    - name: 'area_pixels'
      type: 'number'
      min: 0
```

### 3. Upload Images to CVAT

1. **Create Task**:
   - **Task name**: Use descriptive name with timestamp
   - **Project**: Select your cell segmentation project
   - **Source**: Upload your original images
   - **Image quality**: 95% (for high detail preservation)

2. **Advanced Settings**:
   - **Overlap**: 0 (no overlap needed for cell segmentation)
   - **Segment size**: 1 (one image per job for easier management)
   - **Start frame**: 0

### 4. Import COCO Annotations

1. **Open the task** and go to "Actions" → "Upload annotations"
2. **Select format**: "COCO 1.0"
3. **Upload file**: Select the exported `annotations.json`
4. **Import settings**:
   - ✅ **Update existing annotations**
   - ✅ **Create new labels if not exist**
   - ❌ **Delete old annotations** (only if starting fresh)

### 5. Annotation Workflow

After import, you can:

#### View and Verify Annotations

- **Polygon mode**: See imported cell boundaries
- **Attributes panel**: Check cell_type, confidence values
- **Navigation**: Use arrow keys to browse images

#### Edit and Refine

- **Add vertices**: Click on polygon edge
- **Move vertices**: Drag polygon points
- **Split cells**: Use polygon tools to separate merged cells
- **Merge cells**: Delete boundaries and redraw

#### Quality Control

- **Review mode**: Enable to check annotation quality
- **Comments**: Add notes for problematic areas
- **Statistics**: View annotation counts and coverage

### 6. Export from CVAT

When ready to export back from CVAT:

1. **Go to task** → "Actions" → "Export task dataset"
2. **Select format**: "COCO 1.0"
3. **Download**: Gets updated annotations with your edits

## Label Mapping

| SpheroSeg Export | CVAT Label | Category ID |
| ---------------- | ---------- | ----------- |
| External polygon | cell       | 1           |
| Internal polygon | cell_hole  | 2           |

## Best Practices

### Before Import

- ✅ Verify image file names match between export and CVAT upload
- ✅ Check image dimensions are preserved
- ✅ Ensure consistent naming convention

### During Annotation

- 🎯 **Use polygon mode** for accurate cell boundaries
- 🔍 **Zoom in closely** for precise vertex placement
- 📝 **Fill attributes** for each cell (type, confidence)
- ⚡ **Save frequently** to prevent data loss

### Quality Assurance

- 👀 **Review annotations** in different zoom levels
- 🔄 **Cross-check** with original segmentation results
- 📊 **Use statistics** to identify outliers or missing annotations

## Troubleshooting

### Import Issues

- **"No annotations imported"**: Check label names match exactly
- **"Invalid polygon"**: Verify polygon coordinates are valid
- **"Image not found"**: Ensure image filenames match annotation references

### Common Fixes

```bash
# Check COCO file validity
python -c "import json; print('Valid JSON') if json.load(open('annotations.json')) else print('Invalid')"

# Verify image references
grep -o '"file_name":"[^"]*"' annotations.json | sort | uniq
```

## Integration with ML Pipelines

The COCO format is widely supported by:

- **Detectron2** (Facebook AI Research)
- **MMDetection** (OpenMMLab)
- **YOLOv8** (Ultralytics)
- **Mask R-CNN** implementations

## Related Documentation

- [COCO Format Specification](https://cocodataset.org/#format-data)
- [CVAT User Guide](https://opencv.github.io/cvat/docs/)
- [SpheroSeg Export Documentation](../../README.md)
