# Export Metrics Definitions

## Overview

This document provides comprehensive definitions for all metrics calculated during the export process in the Cell Segmentation Hub. These metrics are computed for each segmented polygon and are available in all export formats (Excel, CSV, COCO, YOLO, JSON).

## Metric Categories

### 1. Area Measurements

#### **Area**
- **Formula**: Shoelace formula: `A = |Σ(x[i] * y[i+1] - x[i+1] * y[i])| / 2`
- **Description**: Total area of the polygon minus any internal holes (e.g., nuclei within cells)
- **Units**:
  - Default: px² (pixels squared)
  - Scaled: µm² (micrometers squared)
- **Implementation Note**: Uses the Shoelace (Gauss's area) formula for accurate polygon area calculation

### 2. Perimeter Measurements

#### **Perimeter**
- **Formula**: `P = Σ√((x[i+1] - x[i])² + (y[i+1] - y[i])²)`
- **Description**: Total boundary length of the external contour only (holes are excluded)
- **Units**:
  - Default: px (pixels)
  - Scaled: µm (micrometers)
- **Implementation Note**: Euclidean distance between consecutive vertices of the outer boundary

### 3. Diameter Measurements

#### **Equivalent Diameter**
- **Formula**: `D = √(4 * Area / π)`
- **Description**: Diameter of a circle with the same area as the polygon
- **Units**: px or µm when scaled
- **Use Case**: Provides a single size metric for comparing objects of different shapes

#### **Feret Diameters (Caliper Diameters)**

##### **Feret Diameter Max**
- **Algorithm**: Rotating calipers algorithm on convex hull
- **Description**: Maximum distance between any two points on the polygon boundary
- **Units**: px or µm when scaled
- **Use Case**: Maximum object length in any orientation

##### **Feret Diameter Orthogonal**
- **Formula**: Maximum perpendicular distance from the max Feret diameter line × 2
- **Description**: Width perpendicular to the maximum Feret diameter
- **Units**: px or µm when scaled
- **Use Case**: Object width perpendicular to its longest axis

##### **Feret Diameter Min**
- **Algorithm**: Minimum caliper width across all orientations
- **Description**: Minimum width when polygon is rotated through all angles
- **Units**: px or µm when scaled
- **Use Case**: Minimum object thickness

### 4. Shape Descriptors (Dimensionless)

#### **Circularity**
- **Formula**: `C = 4π * Area / Perimeter²`
- **Description**: Measure of how circular the shape is
- **Range**: 0 to 1
  - 1.0 = perfect circle
  - <1 = elongated or irregular shapes
- **Note**: Values are clamped to ≤1 to handle discretization artifacts

#### **Feret Aspect Ratio**
- **Formula**: `Feret Max / Feret Min`
- **Description**: Ratio of maximum to minimum Feret diameters
- **Range**: ≥1 (1 = circle/square, higher = more elongated)
- **Use Case**: Quantifies object elongation

#### **Extent**
- **Formula**: `Area / (BoundingBoxWidth * BoundingBoxHeight)`
- **Description**: Fraction of the axis-aligned bounding box filled by the shape
- **Range**: 0 to 1
- **Use Case**: Measures how well the object fills its bounding rectangle
- **Note**: Previously mislabeled as "Compactness" in earlier versions

#### **Convexity**
- **Formula**: `Convex Hull Perimeter / Polygon Perimeter`
- **Description**: Measure of boundary smoothness/convexity
- **Range**: 0 to 1
  - 1.0 = perfectly convex shape
  - <1 = presence of concavities
- **Use Case**: Detects irregular boundaries or protrusions

#### **Solidity**
- **Formula**: `Polygon Area / Convex Hull Area`
- **Description**: Measure of overall convexity and density
- **Range**: 0 to 1
  - 1.0 = solid convex shape
  - <1 = presence of concavities or indentations
- **Use Case**: Quantifies how "filled" or solid the shape appears

### 5. Bounding Box Measurements

#### **Bounding Box Width**
- **Formula**: `Width = max(x) - min(x)`
- **Description**: Width of the axis-aligned bounding rectangle
- **Units**: px or µm when scaled

#### **Bounding Box Height**
- **Formula**: `Height = max(y) - min(y)`
- **Description**: Height of the axis-aligned bounding rectangle
- **Units**: px or µm when scaled

## Scale Conversion

When a pixel-to-micrometer scale is provided:

### Linear Measurements (multiply by scale)
- Perimeter: `px → µm`
- Equivalent Diameter: `px → µm`
- Feret Diameters (Max, Min, Orthogonal): `px → µm`
- Bounding Box dimensions: `px → µm`

### Area Measurements (multiply by scale²)
- Area: `px² → µm²`

### Dimensionless Ratios (unchanged)
- Circularity
- Feret Aspect Ratio
- Extent
- Convexity
- Solidity

## Implementation Details

### Frontend Calculations
- **Location**: `/src/pages/segmentation/utils/metricCalculations.ts`
- **Features**:
  - Graham scan algorithm for convex hull
  - Rotating calipers for accurate Feret diameters
  - Handles polygons with holes correctly

### Backend Calculations
- **Location**: `/backend/src/services/metrics/metricsCalculator.ts`
- **Features**:
  - Primary: Python service with OpenCV for accurate calculations
  - Fallback: JavaScript implementation for basic metrics
  - Batch processing support for large datasets

### Python Service (ML Backend)
- **Endpoint**: `/api/calculate-metrics`
- **Libraries**: OpenCV, NumPy, SciPy
- **Advantages**: Hardware-accelerated geometric computations

## Performance Considerations

- **Batch Processing**: Supports up to 10,000 images per export
- **Optimization**: Metrics calculated in parallel where possible
- **Memory Management**: Streaming export for large datasets
- **Validation**: All polygon points validated before calculation

## Export Format Support

These metrics are available in:
- **Excel (.xlsx)**: Full metrics with summary statistics
- **CSV (.csv)**: Full metrics in tabular format
- **COCO JSON**: Subset of metrics in annotations
- **YOLO**: Bounding box metrics only
- **Custom JSON**: All metrics with full precision

## Quality Assurance

### Validation Rules
1. Polygons must have ≥3 vertices
2. All coordinates must be finite numbers
3. Holes are correctly associated with parent polygons
4. Degenerate polygons are skipped with warnings

### Error Handling
- Invalid polygons: Return zero metrics with warning
- Python service failure: Fallback to JavaScript calculations
- Scale validation: Automatic detection of invalid scales

## References

- **Shoelace Formula**: [Gauss's area formula](https://en.wikipedia.org/wiki/Shoelace_formula)
- **Graham Scan**: [Convex hull algorithm](https://en.wikipedia.org/wiki/Graham_scan)
- **Rotating Calipers**: [Feret diameter calculation](https://en.wikipedia.org/wiki/Rotating_calipers)
- **ImageJ Conventions**: [ImageJ shape analysis](https://imagej.nih.gov/ij/docs/guide/146-30.html)

## Version History

- **v2.0.0**: Added rotating calipers for accurate Feret diameters
- **v1.5.0**: Renamed "Compactness" to "Extent" for accuracy
- **v1.0.0**: Initial metric implementation

---

*Last Updated: 2025-09-13*
*For questions or improvements, please contact the development team.*