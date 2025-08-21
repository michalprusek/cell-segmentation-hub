# Annotation Export Formats

This directory contains annotation export utilities for various computer vision annotation formats.

## 📚 Quick Start

**See [FORMATS_GUIDE.md](./FORMATS_GUIDE.md) for the complete consolidated guide covering all formats.**

## Available Formats

| Format | Directory | Best Use Case |
|--------|-----------|---------------|
| **COCO** | `coco/` | Instance segmentation, research datasets |
| **YOLO** | `yolo/` | Real-time object detection training |
| **JSON** | `json/` | Custom workflows, full detail preservation |

## Directory Structure

```
annotations/
├── FORMATS_GUIDE.md  # Complete guide (START HERE)
├── coco/            # COCO format with CVAT instructions
├── yolo/            # YOLO format with training examples
├── json/            # Custom JSON with conversion tools
└── README.md        # This overview file
```

## Scale Conversion Support

All formats support pixel-to-micrometer scale conversion:
- Linear measurements: px → µm
- Area measurements: px² → µm²
- Dimensionless ratios remain unchanged

## Quick Links

- [Complete Format Guide](./FORMATS_GUIDE.md)
- [COCO Detailed Instructions](./coco/README.md)
- [YOLO Training Setup](./yolo/README.md)
- [JSON Custom Workflows](./json/README.md)