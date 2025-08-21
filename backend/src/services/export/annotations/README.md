# Annotation Export Formats

This directory contains annotation export utilities for various computer vision annotation formats. Each format has its own subdirectory with specific README instructions.

## Available Formats

- **COCO** - Microsoft Common Objects in Context format
- **YOLO** - You Only Look Once bounding box format  
- **JSON** - Custom JSON format with polygon coordinates

## Export Process

Annotations are generated during the export process and saved to the respective format directories:

```
annotations/
├── coco/           # COCO format files
├── yolo/           # YOLO format files
├── json/           # JSON format files
└── README.md       # This file
```

## Usage with Annotation Tools

Each format directory contains detailed instructions for:
- Setting up annotation projects in popular tools (CVAT, LabelMe, etc.)
- Importing the exported annotations
- Label configuration and mapping
- Workflow recommendations

## Supported Annotation Types

- **Polygons**: Cell boundary segmentation
- **Classification**: Cell type labeling (if configured)
- **Metadata**: Image dimensions, processing parameters

## Format Selection

Choose the appropriate format based on your target annotation tool or ML framework:

- **COCO**: Best for instance segmentation, object detection research
- **YOLO**: Lightweight format for real-time detection applications
- **JSON**: Custom format with full polygon detail preservation