/**
 * Export documentation generators — README, metrics guide, format-specific
 * setup guides for COCO/YOLO/JSON, and the main annotations index.
 *
 * Extracted from `exportService.ts` to keep the orchestrator focused on
 * job lifecycle. These are pure string generators and (for the format
 * guides) thin wrappers around `fs.writeFile`. No class state, no DB,
 * no logger — easy to reason about and test in isolation.
 */

import path from 'path';
import { promises as fs } from 'fs';
import type { ExportOptions, ProjectWithImages } from '../exportService';

export function generateReadme(
  project: ProjectWithImages,
  options: ExportOptions
): string {
  return `# Export - ${project.title}

## Export Information
- **Date**: ${new Date().toISOString()}
- **Total Images**: ${project.images?.length || 0}
- **Project ID**: ${project.id}
${
options.pixelToMicrometerScale && options.pixelToMicrometerScale > 0
  ? `- **Scale Conversion**: ${options.pixelToMicrometerScale} um/pixel (measurements converted to micrometers)`
  : '- **Units**: All measurements in pixels'
}

## Export Contents

### Images
${options.includeOriginalImages ? '✅ Original images included' : '❌ Original images not included'}
${options.includeVisualizations ? '✅ Visualizations with numbered polygons included' : '❌ Visualizations not included'}

### Annotations
${options.annotationFormats?.map(f => `- ${f.toUpperCase()} format`).join('\n') || 'No annotations included'}

### Metrics
${options.metricsFormats?.map(f => `- ${f.toUpperCase()} format`).join('\n') || 'No metrics included'}

## Folder Structure

* images/ - Original images
* visualizations/ - Images with numbered polygons
* annotations/ - Annotation files in various formats
* coco/ - COCO format annotations
* yolo/ - YOLO format annotations
* json/ - Custom JSON format
* metrics/ - Calculated metrics
* documentation/ - This folder

## Usage Instructions
1. Extract the ZIP archive to your desired location
2. Use the appropriate annotation format for your ML framework
3. Metrics are available in Excel, CSV, or JSON format
4. Visualizations show numbered polygons for easy reference

## Notes
- External polygons are numbered sequentially
- Metrics are calculated only for external polygons
- Internal polygon areas (holes) are automatically subtracted from their containing external polygons
- All coordinates are in pixel space relative to original image dimensions
`;
}

export function generateMetricsGuide(options?: ExportOptions): string {
  // Determine units based on scale
  const isScaled =
    options?.pixelToMicrometerScale && options.pixelToMicrometerScale > 0;
  const areaUnit = isScaled ? 'um^2' : 'px^2';
  const lengthUnit = isScaled ? 'um' : 'px';
  const scaleInfo = isScaled
    ? `\n## Scale Conversion\n\n- **Scale**: ${options.pixelToMicrometerScale} um/pixel\n- **Linear measurements**: Converted from pixels to micrometers (um)\n- **Area measurements**: Converted from pixels^2 to square micrometers (um^2)\n- **Dimensionless ratios**: Remain unchanged (scale-invariant)\n`
    : '\n## Units\n\n- **All measurements are in pixel units**\n- **Linear measurements**: pixels (px)\n- **Area measurements**: square pixels (px^2)\n';

  return `# Polygon Metrics Reference Guide
${scaleInfo}
## Calculated Metrics

### Area
- **Description**: Total enclosed area using the Shoelace formula with hole subtraction
- **Formula**: A = A_external - Sum(A_holes)
- **Implementation**: Shoelace formula: A = (1/2)|Sum(x_i * y_{i+1} - x_{i+1} * y_i)|
- **Units**: ${areaUnit}
- **Range**: [0, ∞)
- **ImageJ compatibility**: ✅ Matches ImageJ area calculation

### Perimeter
- **Description**: Total boundary length following ImageJ convention
- **Formula**: P = Sum(sqrt((x_{i+1} - x_i)^2 + (y_{i+1} - y_i)^2))
- **Implementation**: Euclidean distance between consecutive vertices
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)
- **ImageJ compatibility**: ✅ Includes only external boundary (holes excluded)

### Circularity
- **Description**: Measure of how closely the shape resembles a perfect circle
- **Formula**: C = 4*pi * Area / Perimeter^2
- **LaTeX**: $C = \\\\frac{4\\\\pi A}{P^2}$
- **Range**: [0, 1] where 1 = perfect circle
- **Implementation**: Clamped to prevent division by zero
- **ImageJ compatibility**: ✅ Identical formula

### Solidity
- **Description**: Ratio of polygon area to its convex hull area (measure of convexity)
- **Formula**: S = Area / ConvexHullArea
- **LaTeX**: $S = \\\\frac{A}{A_{hull}}$
- **Range**: [0, 1] where 1 = perfectly convex (no concavities)
- **Implementation**: Uses rotating calipers algorithm for convex hull
- **scikit-image compatibility**: ✅ Matches regionprops.solidity

### Extent
- **Description**: Ratio of polygon area to bounding box area (space-filling efficiency)
- **Formula**: E = Area / (BoundingBoxWidth * BoundingBoxHeight)
- **LaTeX**: $E = \\\\frac{A}{w_{bbox} \\\\times h_{bbox}}$
- **Range**: [0, 1] where 1 = fills entire bounding box
- **Implementation**: Axis-aligned bounding box (AABB)
- **scikit-image compatibility**: ✅ Matches regionprops.extent

### Compactness
- **Description**: Reciprocal of circularity, measures shape complexity
- **Formula**: K = Perimeter^2 / (4*pi * Area)
- **LaTeX**: $K = \\\\frac{P^2}{4\\\\pi A}$
- **Range**: [1, ∞) where 1 = perfect circle, higher = more complex
- **Implementation**: Inverse of circularity formula
- **Note**: Also called "form factor" in some literature

### Convexity
- **Description**: Ratio of convex hull perimeter to actual perimeter
- **Formula**: V = ConvexHullPerimeter / Perimeter
- **LaTeX**: $V = \\\\frac{P_{hull}}{P}$
- **Range**: [0, 1] where 1 = convex shape, lower = more concavities
- **Implementation**: Uses Graham scan for convex hull
- **ImageJ compatibility**: ✅ Similar to ImageJ convexity measure

### Equivalent Diameter
- **Description**: Diameter of a circle with the same area as the polygon
- **Formula**: D_eq = sqrt(4 * Area / pi) = 2*sqrt(Area / pi)
- **LaTeX**: $D_{eq} = 2\\\\sqrt{\\\\frac{A}{\\\\pi}}$
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)
- **ImageJ compatibility**: ✅ Matches ImageJ equivalent diameter

### Feret Diameters
- **Description**: Caliper diameters using rotating calipers algorithm
- **Maximum Feret**: Longest distance between any two boundary points
- **Formula**: F_max = max(||p_i - p_j||) for all boundary points
- **LaTeX**: $F_{max} = \\\\max_{i,j} ||p_i - p_j||$
- **Minimum Feret**: Smallest width between parallel supporting lines
- **Implementation**: Rotating calipers algorithm
- **LaTeX**: $F_{min} = \\\\min_{\\\\theta} w(\\\\theta)$
- **Aspect Ratio**: AR = F_max / F_min
- **Units**: ${lengthUnit}
- **Range**: F_max ≥ F_min ≥ 0, AR ≥ 1
- **ImageJ compatibility**: ✅ Uses same rotating calipers approach

### Bounding Box Metrics
- **Width/Height**: Axis-aligned bounding box dimensions
- **Formula**: W = max(x) - min(x), H = max(y) - min(y)
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)
- **Implementation**: Simple min/max coordinate calculation

### Sphericity
- **Description**: 2D projection of spherical similarity
- **Formula**: Sph = pi^(1/2) * (4 * Area)^(1/2) / Perimeter
- **LaTeX**: $Sph = \\\\frac{\\\\sqrt{\\\\pi} \\\\cdot 2\\\\sqrt{A}}{P}$
- **Range**: [0, 1] where 1 = perfect circle (sphere projection)
- **Implementation**: Normalized equivalent diameter by perimeter

## Hole Handling

### Area Calculation with Holes
1. **External polygon area** calculated using Shoelace formula
2. **Internal polygon (hole) areas** calculated individually
3. **Final area** = External area - Sum of hole areas
4. **Validation**: Ensures final area ≥ 0

### Perimeter Convention (ImageJ Standard)
- **Included**: Only external boundary perimeter
- **Excluded**: Internal hole boundaries are NOT added to perimeter
- **Rationale**: Follows ImageJ convention for biological analysis
- **Note**: Some tools include hole perimeters - this implementation does not

## Implementation Details

### Algorithms Used
- **Area**: Shoelace formula (Green's theorem)
- **Convex Hull**: Graham scan algorithm
- **Feret Diameters**: Rotating calipers algorithm
- **Point-in-polygon**: Ray casting algorithm
- **Hole detection**: Centroid-based containment test

### Computational Complexity
- **Area calculation**: O(n) where n = vertices
- **Convex hull**: O(n log n)
- **Feret diameters**: O(n^2) for accurate implementation
- **Overall complexity**: O(n^2) per polygon

### Accuracy & Precision
- **Floating-point precision**: Double precision (IEEE 754)
- **Numerical stability**: Guards against division by zero
- **Edge cases**: Handles degenerate polygons gracefully
- **Validation**: All metrics validated for finite values

## Software Compatibility

### ImageJ/FIJI
- ✅ **Area**: Identical Shoelace implementation
- ✅ **Perimeter**: Matches boundary-only convention
- ✅ **Circularity**: Same 4πA/P^2 formula
- ✅ **Equivalent Diameter**: Same √(4A/π) formula
- ✅ **Feret Diameters**: Compatible rotating calipers

### scikit-image (Python)
- ✅ **Solidity**: Matches regionprops.solidity
- ✅ **Extent**: Matches regionprops.extent
- ✅ **Area**: Compatible with region.area
- ✅ **Perimeter**: Compatible with region.perimeter

### Notes for Researchers
1. **Units**: Always verify scale conversion for physical measurements
2. **Holes**: Remember that hole areas are subtracted from total area
3. **Perimeter**: Only external boundary included (ImageJ convention)
4. **Dimensionless ratios**: Circularity, solidity, extent are scale-invariant
5. **Validation**: All metrics checked for mathematical validity (finite, non-negative where applicable)

## Quality Assurance
- **Algorithm validation**: Tested against ImageJ and scikit-image
- **Edge case handling**: Robust for degenerate and complex polygons
- **Performance monitoring**: Automatic warnings for large datasets
- **Error recovery**: Fallback calculations when advanced algorithms fail

---

# Per-Image Metrics: Disintegration Analysis

**Applies to projects with \`type='spheroid_invasive'\` only.** Standard
\`spheroid\` and \`wound\` projects get the per-polygon metrics report
described above; \`sperm\` projects get the head/midpiece/tail morphology
sheet. This section documents the disintegrated-spheroid Excel layout,
which is one row per image with the four numeric metrics
**Total Spheroid Area**, **Core Area**, **Invasion Area** (all in ${areaUnit})
and **Disintegration Index** (dimensionless). The metrics target spheroid
disintegration analysis (Lim, Kang, Lee 2020 — Sci. Rep. PMC6971071) but
apply equally to compact (t=0) and rozprsknuté (t>0) spheroids.

## Pipeline Overview

\`\`\`
ASPP segmentation  →  polygons[]  →  core detection (Otsu + 2-of-3 voting)
                                     ↓
                            partClass="core" polygon attached
                                     ↓
     ┌──────────────┬─────────────────┬──────────────────┐
     ↓              ↓                 ↓                  ↓
 Total Spheroid    Core Area     Invasion Area    Disintegration
 Area (Σ ext.    (largest       (Total − Core,    Index = tanh(W₁)
 non-core)        core CC)       clamped ≥ 0)     where W₁ compares
                                                  the empirical CDF of
                                                  distances of every
                                                  mask pixel against
                                                  every core pixel,
                                                  normalised by R_core
\`\`\`

## Core Detection (ASPP-only)

Performed in the Python ML service inside \`PostprocessingService.detect_core_polygons\`
(file \`backend/segmentation/services/postprocessing.py\`). Pipeline:

1. **Pick parent**: the **largest** external polygon detected by ASPP (\`A_all\`)
 that exceeds \`CORE_MIN_PARENT_AREA = 1000 px²\`. Smaller externals are
 noise/debris and don't get a core.

2. **Rasterise** the parent polygon into a binary mask matching the original
 image dimensions (\`cv2.fillPoly\` on a uint8 zero canvas).

3. **Local Otsu** on the grayscale intensities **inside the mask only**:
 \`thr = threshold_otsu(gray[mask>0])\`. The histogram restriction is essential
 — global Otsu sits between background and cells, which is the duality of
 the segmentation itself and yields no information about core vs. corona.

4. **2-of-3 compactness gate**. The spheroid is "compact" (= core covers the
 whole parent) when **at least two** of these indicators agree:
 - **mean_diff** < 45 grayscale levels: difference of \`mean(below_thr)\` and
   \`mean(above_thr)\` inside the mask. Small ⇒ unimodal interior.
 - **core_frac** > 0.75: fraction of mask pixels below Otsu. High ⇒ most of
   the spheroid is dense.
 - **solidity** > 0.85: \`area / convex_hull_area\` of the parent polygon.
   High ⇒ round, no invasion projections.

 Calibrated on user 12bprusek's *time_0h* (compact) vs *time_48h* (invasive)
 projects, April 2026. Cohen's *d* = 3.18 on \`mean_diff\`. Class constants
 are tunable in \`PostprocessingService\`.

5. **Compact path** (votes ≥ 2): return the **whole parent polygon** as the
 core. \`Core Area ≈ Total Spheroid Area\`.

6. **Bimodal path** (votes < 2): build \`core_raw = (gray ≤ thr) & mask\`, label
 connected components, return the **single largest CC** as the core polygon.
 The contour is extracted via \`cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)\`.

7. The returned core polygon carries \`partClass="core"\` and \`parent_id\` linking
 it to the parent spheroid.

## Total Spheroid Area (${areaUnit})

\`\`\`
TotalSpheroidArea = Σ area(external polygon)   for partClass ≠ "core"
\`\`\`

- **Sum of geometric areas** of every external polygon **excluding** the core.
The core sits *inside* the parent spheroid; including it would double-count
the same physical pixels.
- **Algorithm**: Shoelace (Gauss's area) formula on polygon vertices —
\`A = ½ |Σᵢ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|\`. Vertices wrap (i+1 mod n).
- **Unit conversion**: when a μm/px scale is configured at the project level,
\`A_μm² = A_px² × scale²\`. Otherwise pixel units are reported.
- **Multi-spheroid images**: smaller spheroids (those without a detected core)
are still summed in. So \`TotalSpheroidArea\` represents *all cell-covered
area* in the image, not just the largest.

## Core Area (${areaUnit})

\`\`\`
CoreArea = area(polygon with partClass="core")
\`\`\`

- Geometric area of the **single core polygon** (largest connected component
below Otsu threshold; or the whole parent in the compact case).
- Same Shoelace formula and same scale conversion as Total Spheroid Area.
- For a compact spheroid: \`CoreArea ≈ TotalSpheroidArea\` (whole parent = core).
- For a fully invasive spheroid: \`CoreArea\` is the dense central agglomerate
while the rest of \`TotalSpheroidArea\` is the diffuse invasion zone.
- **Reference**: Lim 2020 \`A_core\` (paper notation) corresponds directly.

## Invasion Area (${areaUnit})

\`\`\`
InvasionArea = max(0, TotalSpheroidArea − CoreArea)
\`\`\`

- Cell-covered area **outside** the dense core. Direct numeric proxy for the
invasion zone size: how much of the cell mass has migrated beyond the dense
central agglomerate.
- For a **compact** (t=0) spheroid: InvasionArea ≈ 0.
- For a **strongly invasive** spheroid: InvasionArea ≈ 0.5–0.8 × TotalSpheroidArea.
- Same Shoelace areas + same scale conversion. Clamped at zero to handle
edge cases where Core slightly exceeds Total due to numerical artefacts.
- Corresponds to Lim 2020 \`(A_all − A_core)\` numerator of the invasion index B.

## Disintegration Index (DI)

The DI is a scalar in \`[0, 1)\` that quantifies *how much spheroid mass has
escaped beyond a uniform-disk reference of equivalent core area*. Reported in
the Excel column **Disintegration Index** (4 decimal places, dimensionless).

Algorithm (implemented in
\`backend/segmentation/api/metrics_endpoint.py\` — POST \`/api/disintegration-index\`):

1. **Rasterise the union of every external polygon** (the whole ASPP segmentation
 mask, excluding cores) into a single binary canvas via repeated
 \`cv2.fillPoly\`. Collect the \`(x, y)\` of all \`N\` white pixels.

2. **Centroid anchor**:
 - If a core polygon is present, \`(cx, cy) = (mean(xᵢ_core), mean(yᵢ_core))\` —
   the centroid of the **core pixels**. The metric thus measures how far
   mass spread from the dense core, not from the smeared mass centroid
   that drifts toward the invasion zone (improvement A — biologically the
   core is the natural reference point for "how far did things go").
 - Otherwise (no core) fallback to mask centroid
   \`(cx, cy) = (mean(xᵢ), mean(yᵢ))\`.

 Distances \`dᵢ = √((xᵢ − cx)² + (yᵢ − cy)²)\` are computed for both
 sets (\`d_mask\` over all mask pixels and \`d_core\` over core pixels)
 relative to this single anchor.

3. **Reference radius**:
 - If a core polygon is present, \`R_ref = √(N_core / π)\` where \`N_core\` is
   the rasterised pixel count of the core.
 - Otherwise fallback to \`R_eff = √(N / π)\`.

4. **Reference distribution — empirical core CDF**. When a core polygon is
 present, the reference is the **empirical** distribution of distances
 \`d_core\` for every pixel inside the core, anchored on the **same
 centroid as d_mask** (the core centroid from step 2). This means the
 reference reflects the **actual radial profile of the dense core**,
 not an idealised disk. The fallback (no core) uses the analytical
 equivalent-disk CDF \`F_ref(d̃) = d̃²\` for \`d̃ ∈ [0, 1]\`.

5. **1-Wasserstein distance**:
 - **Core path**: \`W₁_px = wasserstein_distance(d_mask, d_core)\` via
   \`scipy.stats\`, computed exactly between the two empirical 1D
   distributions. Scale-normalised: \`W₁ = W₁_px / R_core\`, where
   \`R_core = √(N_core / π)\`.
 - **r_eff fallback**: bin-free quantile formula
   \`W₁ ≈ (1/N) · Σᵢ |d̃₍ᵢ₎ − √((i − 0.5) / N)|\` where d̃₍ᵢ₎ are sorted
   normalised distances \`d_mask / R_eff\`.

6. **Saturation**: \`DI = tanh(W₁)\`. Maps \`W₁ ∈ [0, ∞) → [0, 1)\`.

**Properties**: dimensionless, scale-invariant (all distances normalised by
\`R_ref\`), rotation-invariant, translation-invariant (centroid-relative).

**Calibrated thresholds** (user 12bprusek, April 2026):
- *time_0h* (compact): DI median ≈ 0.001
- *time_48h* (rozprsknuté): DI median ≈ 0.48
- 320× separation between groups

## Edge Cases & Caveats

- **No ASPP segmentation** (HRNet, CBAM-ResUNet, plain U-Net, sperm, wound):
no core polygon is generated. \`Core Area = 0\`, \`Total Spheroid Area\` still
reports the sum of all external polygons. Compatibility-safe for any model.
- **Image with no polygons or no externals**: both metrics report \`0\`.
- **Cropped spheroid touching image edge**: the centroid is biased, the
rasterised area is truncated. Detected via bbox of mask = canvas edge —
not auto-flagged in the export but visible by inspection.
- **Multiple spheroids, only the largest gets a core**: smaller spheroids
contribute to \`Total Spheroid Area\` only. By design — paper Lim 2020
treats each spheroid as its own experimental unit.
- **Hollow / necrotic core**: the central pixels may be lighter than the
surrounding ring, which inflates \`mean_diff\` and the algorithm may pick a
ring-shaped CC as the "core". Mathematically correct given the intensity
histogram, biologically ambiguous; manual inspection recommended for
spheroids known to have necrotic centres.

## Source Files

- **Core detection**: \`backend/segmentation/services/postprocessing.py\`
- **DI computation**: \`backend/segmentation/api/metrics_endpoint.py\`
- **Per-image area orchestration**: \`backend/src/services/metrics/metricsCalculator.ts\`
(\`calculateAllImageMetrics\`)
- **Excel writer**: same file (\`exportToExcel\` — emits Image Name, Image ID,
Total Spheroid Area, Core Area, Invasion Area, Disintegration Index)
`;
}

export async function generateAnnotationGuides(
  exportDir: string,
  options: ExportOptions
): Promise<void> {
  const annotationsDir = path.join(exportDir, 'annotations');

  // Only generate guides for formats that are being exported
  if (options.annotationFormats?.includes('coco')) {
    await generateCocoGuide(path.join(annotationsDir, 'coco'));
  }

  if (options.annotationFormats?.includes('yolo')) {
    await generateYoloGuide(path.join(annotationsDir, 'yolo'));
  }

  if (options.annotationFormats?.includes('json')) {
    await generateJsonGuide(path.join(annotationsDir, 'json'));
  }

  // Generate main annotations README
  await generateMainAnnotationGuide(annotationsDir, options);
}

export async function generateCocoGuide(cocoDir: string): Promise<void> {
  const guide = `# COCO Format - Quick Setup Guide

## CVAT Import Instructions

1. **Create CVAT Project**:
 - Name: "Cell Segmentation"
 - Labels: Add "cell" (polygon) and "cell_hole" (polygon)

2. **Upload Images**:
 - Create new task in your project
 - Upload the same images used in SpheroSeg

3. **Import Annotations**:
 - In task view: Actions → Upload annotations
 - Format: "COCO 1.0"
 - File: Select the annotations.json from this directory

4. **Verify Import**:
 - Check polygon boundaries match your expectations
 - Verify all images have annotations loaded

## Label Configuration for CVAT

\`\`\`yaml
Labels:
- name: "cell"
  type: "polygon"
  color: "#FF0000"
- name: "cell_hole"
  type: "polygon"
  color: "#0000FF"
\`\`\`

For detailed instructions, see the full README.md in this directory.
`;

  await fs.writeFile(path.join(cocoDir, 'QUICK_SETUP.md'), guide);
}

export async function generateYoloGuide(yoloDir: string): Promise<void> {
  const guide = `# YOLO Format - Quick Setup Guide

## Convert to COCO for CVAT

Since CVAT doesn't directly import YOLO segmentation format:

1. **Use conversion script** (see README.md in this directory)
2. **Generate COCO file** from YOLO annotations
3. **Import COCO file** to CVAT following COCO guide

## Training with YOLOv8

\`\`\`bash
# Install YOLOv8
pip install ultralytics

# Train model
yolo train data=data.yaml model=yolov8n-seg.pt epochs=100
\`\`\`

## Classes Configuration

\`\`\`
# classes.txt content:
cell
cell_hole
\`\`\`

For detailed conversion scripts and training setup, see the full README.md.
`;

  await fs.writeFile(path.join(yoloDir, 'QUICK_SETUP.md'), guide);
}

export async function generateJsonGuide(jsonDir: string): Promise<void> {
  const guide = `# JSON Format - Quick Setup Guide

## Convert to COCO for CVAT

1. **Use conversion script** (see README.md)
2. **Convert JSON to COCO** format
3. **Import to CVAT** as COCO format

## Direct Analysis

The JSON format preserves full SpheroSeg metadata:

- Processing confidence scores
- Model used for segmentation  
- Detailed polygon metrics
- Scale conversion information

## Python Integration

\`\`\`python
import json

# Load annotations
with open('annotations.json') as f:
  data = json.load(f)

# Access polygon data
for image in data['images']:
  for polygon in image['polygons']:
      confidence = polygon['processing']['confidence']
      area = polygon['metrics']['area']
      model = polygon['processing']['model']
\`\`\`

For detailed conversion and analysis scripts, see the full README.md.
`;

  await fs.writeFile(path.join(jsonDir, 'QUICK_SETUP.md'), guide);
}

export async function generateMainAnnotationGuide(
  annotationsDir: string,
  options: ExportOptions
): Promise<void> {
  const exportedFormats = options.annotationFormats || [];
  const scaleInfo = options.pixelToMicrometerScale
    ? `- **Scale**: ${options.pixelToMicrometerScale} um/pixel (measurements in micrometers)`
    : '- **Units**: All measurements in pixels';

  const guide = `# Annotation Export Guide

This export contains cell segmentation annotations in multiple formats for easy integration with annotation tools and ML pipelines.

## Exported Formats

${exportedFormats.map(format => `- **${format.toUpperCase()}**: See ${format}/ directory for format-specific instructions`).join('\n')}

## Scale Information

${scaleInfo}

## Quick Start with CVAT

### 1. Choose Your Format
- **COCO**: Best for most annotation workflows ✅ Recommended
- **YOLO**: For object detection training (requires conversion)
- **JSON**: For custom analysis workflows

### 2. CVAT Setup (COCO Format)

1. **Create Project** in CVAT:
 - Name: "Cell Segmentation - [Your Project Name]"
 - Add labels: "cell" (polygon), "cell_hole" (polygon)

2. **Create Task**:
 - Upload your original images
 - Ensure filenames match the exported annotations

3. **Import Annotations**:
 - Actions → Upload annotations
 - Format: "COCO 1.0" 
 - File: coco/annotations.json

### 3. Verification Checklist

- [ ] All images loaded correctly
- [ ] Polygon boundaries appear accurate
- [ ] Cell count matches expectations
- [ ] Labels assigned correctly (cell vs cell_hole)

## Format-Specific Instructions

Each format directory contains:
- **README.md**: Detailed setup instructions
- **QUICK_SETUP.md**: Fast-track guide
- **Conversion scripts**: For format conversion

## Troubleshooting

### Common Issues
- **"No annotations imported"**: Check image filenames match exactly
- **"Invalid format"**: Verify CVAT supports the annotation format version
- **"Missing labels"**: Ensure labels are created in CVAT before import

### Getting Help
- Check format-specific README files
- Verify image dimensions and file paths
- Test with a single image first

## Integration Examples

### Research Workflow
1. Export → COCO format
2. Import → CVAT for manual review/editing
3. Export → Enhanced COCO for training

### Training Pipeline  
1. Export → YOLO format
2. Train → YOLOv8 segmentation model
3. Deploy → Real-time cell detection

### Analysis Pipeline
1. Export → JSON format  
2. Analyze → Custom Python scripts
3. Visualize → Metrics and quality reports

## Support

For detailed instructions, see the README.md file in each format directory:
${exportedFormats.map(format => `- ${format}/README.md`).join('\n')}
`;

  await fs.writeFile(path.join(annotationsDir, 'README.md'), guide);
}
