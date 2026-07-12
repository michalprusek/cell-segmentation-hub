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
import {
  isMicrotubuleProject,
  type ProjectType,
} from '../../types/validation';

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
${
  isMicrotubuleProject(project.type)
    ? '* imagej/ - ImageJ/Fiji ROIs, one <video>_RoiSet.zip per video (each microtubule polyline on its own stack slice, named <type>_<n> per tubulin class (rename overrides; untyped_<n> otherwise), coloured per class/track, drawn at the MT thickness)\n'
    : ''
}* metrics/ - Calculated metrics
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

interface UnitContext {
  areaUnit: 'px^2' | 'um^2';
  lengthUnit: 'px' | 'um';
  scaleInfo: string;
}

function buildUnitContext(options?: ExportOptions): UnitContext {
  const isScaled =
    !!options?.pixelToMicrometerScale && options.pixelToMicrometerScale > 0;
  const areaUnit: UnitContext['areaUnit'] = isScaled ? 'um^2' : 'px^2';
  const lengthUnit: UnitContext['lengthUnit'] = isScaled ? 'um' : 'px';
  const scaleInfo = isScaled
    ? `\n## Scale Conversion\n\n- **Scale**: ${options?.pixelToMicrometerScale} um/pixel\n- **Linear measurements**: Converted from pixels to micrometers (um)\n- **Area measurements**: Converted from pixels^2 to square micrometers (um^2)\n- **Dimensionless ratios**: Remain unchanged (scale-invariant)\n`
    : '\n## Units\n\n- **All measurements are in pixel units**\n- **Linear measurements**: pixels (px)\n- **Area measurements**: square pixels (px^2)\n';
  return { areaUnit, lengthUnit, scaleInfo };
}

/**
 * Project-type-aware metrics guide generator.
 *
 * Each `ProjectType` exports a different Excel layout — the guide must
 * match. Fanning out by type prevents mismatches like "sperm export
 * lists Disintegration Index" (real bug, fixed here). The four
 * branches mirror the dispatch in `exportService.exportMetrics`.
 */
export function generateMetricsGuide(
  projectType: ProjectType,
  options?: ExportOptions
): string {
  const ctx = buildUnitContext(options);
  switch (projectType) {
    case 'sperm':
      return buildSpermGuide(ctx);
    case 'spheroid_invasive':
      return buildSpheroidInvasiveGuide(ctx);
    case 'wound':
      return buildWoundGuide(ctx);
    case 'microtubules':
      return buildMicrotubuleGuide(ctx);
    case 'microcapsule':
      return buildMicrocapsuleGuide(ctx);
    case 'spheroid':
    default:
      return buildSpheroidGuide(ctx);
  }
}

function buildMicrocapsuleGuide({
  areaUnit,
  lengthUnit,
  scaleInfo,
}: UnitContext): string {
  return `# Microcapsule Metrics Reference Guide
${scaleInfo}
## Metrics file (\`metrics.csv\` / \`metrics.xlsx\`)

The microcapsule model performs **instance segmentation**: each detected
capsule is one closed polygon and gets **one row** of size and shape descriptors
(below), plus identifiers.

> **Completeness filter** — capsules whose contour comes within **20 px** of any
> image border are treated as *cut off by the frame* and are **excluded from this
> report** (they are still drawn, in grey, in the visualisation export, so you can
> see what was skipped). Only whole capsules contribute to the metrics and the
> summary statistics.

### Columns

Every metric is derived from the capsule's **polygon contour** — the ordered
boundary points \`p_0 … p_{n-1}\` (each \`p_i = (x_i, y_i)\`), in ${lengthUnit}.
Values are computed by the metrics service with OpenCV directly on that contour
(a pure-JS convex-hull fallback is used only if that service is unavailable).

- **Image Name / Image ID** — source image identifiers.
- **Capsule ID** — 1-based index within the image (largest capsule first).
- **Area (${areaUnit})** — enclosed contour area (\`cv2.contourArea\`), equivalent
  to the **Shoelace formula** \`A = ½·|Σ_i (x_i·y_{i+1} − x_{i+1}·y_i)|\`.
- **Perimeter (${lengthUnit})** — closed-contour length (\`cv2.arcLength\`),
  \`P = Σ_i ||p_{i+1} − p_i||\` (Euclidean sum over the boundary edges).
- **Width / Height (${lengthUnit})** — axis-aligned bounding box
  (\`cv2.boundingRect\`): the pixel-inclusive \`max(x)−min(x)+1\` and
  \`max(y)−min(y)+1\`. Depend on how the capsule is oriented in the frame.
- **Diameter (${lengthUnit})** — mean of the max and min Feret diameters (below),
  \`(Feret_max + Feret_min) / 2\`. Rotation-invariant.
- **Feret Max (${lengthUnit})** — **longest** diameter (the capsule's long axis):
  the **longer side of the minimum-area bounding rectangle** of the contour
  (\`cv2.minAreaRect\`), \`Feret_max = max(w_rect, h_rect)\`.
- **Feret Min (${lengthUnit})** — **narrowest** width (the short axis): the
  **shorter side of that same minimum-area rectangle**, \`Feret_min = min(w_rect,
  h_rect)\`. (It is the min-*area* rectangle — a close approximation of the true
  minimum caliper width, not the exact min-width rectangle.)
- **Equivalent Diameter (${lengthUnit})** — diameter of the circle with the same
  area, \`d_eq = 2·sqrt(Area / π)\`. (For a round capsule Diameter ≈ Equivalent
  Diameter ≈ Width ≈ Height.)
- **Compactness** — circularity \`C = 4π·Area / Perimeter²\`, clamped to [0, 1]
  where **1.0 = a perfect circle**; lower values indicate an irregular/dented
  boundary.
- **Ovality** — elongation \`Ovality = Feret_max / Feret_min\` (≥ 1; **1.0 = a
  perfectly round capsule**, larger = more elongated/oval).
- **Confidence** — the model's detection score for the capsule, in [0, 1].

### Summary sheet
Aggregates over the **complete** capsules only: how many were analysed, plus
mean / min / max of area and compactness, and mean perimeter, width, height,
diameter, Feret max, Feret min, equivalent diameter and ovality.

## Visualisation
Complete capsules are drawn and numbered in the configured external colour;
capsules cut off by the image border are drawn **grey** and are not counted.

## Annotation exports (COCO / YOLO / JSON)
Every detected capsule — complete or cut-off — is exported as one instance
(the completeness filter applies to metrics only, not to the geometry
annotations).
`;
}

function buildMicrotubuleGuide({ lengthUnit, scaleInfo }: UnitContext): string {
  return `# Microtubule Metrics Reference Guide
${scaleInfo}
## Metrics file (\`metrics.csv\` / \`metrics.xlsx\` / \`metrics.json\`)

The microtubule model produces **open polyline centerlines** (one polyline
per microtubule instance), not closed polygons — so the standard
closed-polygon report (area / perimeter) does not apply. Instead the metrics
file is a **long-format table with one row per (frame, polyline, channel)**.
Microtubule **length** is always present; the per-channel **intensity**
columns are filled only when a channel was selected in the export dialog
(otherwise they are blank and \`channel\` is empty).

### Columns
- **frameIndex** — 0-based frame index within the source video.
- **imageId** — frame image id.
- **instanceId** — unique per polyline (one MT = one instance).
- **trackId** — stable across frames for the same MT when cross-frame
  tracking ran; blank otherwise.
- **channel** — sampled channel machine name; blank on length-only rows.
- **lengthPx / lengthUm** — centerline arc length, Sum_i ||p_{i+1} - p_i||
  (the ${lengthUnit} column is filled when a pixel→µm scale was supplied).
- **areaPx / areaUm2** — area of the thickness-wide sampling band around the
  centerline (intensity exports only).
- **pixelCount** — number of pixels in the sampling band (intensity exports
  only).
- **sumIntensity / meanIntensity / stdIntensity** — raw 16-bit signal
  statistics inside the band for this channel (intensity exports only).
- **medianBackground / meanBackground** — median resp. mean signal in THIS
  microtubule's own LOCAL vicinity ring: the band within
  \`thickness * margin\` of its centerline, excluding every microtubule's signal
  band. Each MT therefore gets a background appropriate to where it sits — a
  bright neighbourhood no longer averages away a dim one (this changed from a
  single frame-global background; older exports are not directly comparable).
- **signalMinusBackground** — meanIntensity − medianBackground
  (background-corrected mean).

Intensity is derived from the **raw 16-bit** ND2/TIFF signal, not the 8-bit
display-normalised per-channel PNGs. The sampling band width (\`thickness\`)
and the background margin are set in the export dialog.

## JSON export

The JSON format preserves the full microtubule structure:

- \`geometry: "polyline"\` on every record
- \`instanceId\` — unique per polyline (one MT = one instance)
- \`trackId\` — set when tracking ran successfully; equal across frames
  for sibling polylines representing the same MT over time

## ImageJ / Fiji ROIs (\`annotations/imagej/\`)

Every microtubule export also bundles the polyline centerlines as native
ImageJ ROIs, so you can re-open them in ImageJ / Fiji for manual
re-measurement or line-based plugins. They are packaged as **one
\`<video>_RoiSet.zip\` per video** under \`annotations/imagej/\`, with each ROI
named **\`<type>_<n>\`** — the microtubule's tubulin type class plus a per-type
counter numbered from 1 (e.g. \`HeLa_1\`, \`HeLa_2\`, \`brain_1\`). A manually
renamed microtubule uses that name verbatim, and an untyped one reads
\`untyped_<n>\`. The name is keyed on the cross-frame trackId, so the same
microtubule keeps one name in every frame.

- Each ROI is placed on its own 1-based **stack slice** (its video frame) and
  coloured per track, matching the editor.
- Each polyline is drawn at the configured **MT thickness** (the "MT thickness
  (px)" export setting, default 5) as its stroke width — so ImageJ renders and
  measures each microtubule as a band of that width, not a hairline.
- Each microtubule also gets a companion **\`<name>_bg\`** ROI — the same
  polyline drawn at the wider **vicinity width** (\`thickness + 2*margin\`), so
  you can see the band its LOCAL background is sampled from (the ring between
  the signal band and this wider band). Omitted when the margin is 0.
- Geometry is stored with sub-pixel (float) precision, in image-pixel space.
- To load a video's ROIs: **drag its \`<video>_RoiSet.zip\` onto the ImageJ
  window**, or use *ROI Manager ▸ More ▸ Open…* and pick the \`.zip\` — either
  loads every microtubule across all frames into the ROI Manager at once.

## Kymograph velocity metrics

When "Velocity metrics" is enabled, \`kymographs/velocity_metrics.xlsx\` holds
**one worksheet per fluorescent channel** (channel = motor/protein, e.g. a
separate sheet for kinesin) with **one row per detected moving particle**
(trajectory) per microtubule:

- \`net_velocity_um_s\` / \`net_velocity_px_frame\` — net (displacement / time)
  velocity. Trajectories with \`|net| < 0.01 µm/s\` are dropped as
  non-processive and never appear.
- \`total_run_length_um\` — total directed distance over processive runs (≥6
  frames); \`total_run_time_s\` — total time in those runs (pauses excluded).
  Both blank when the container is uncalibrated.
- \`intensity_signal\` / \`intensity_background\` / \`intensity_minus_background\`
  — mean signal along the trajectory minus the median of a band beside it (raw
  pixel units). An empty \`intensity_*\` cell means no background band fit
  (kymograph narrower than the sampling band), distinct from an uncalibrated
  blank.
- \`bright\` — \`TRUE\` when the trajectory's signal is an intensity outlier
  (\`> median + 3.5·MAD\` of the other trajectories on the same kymograph),
  typically a multi-motor aggregate rather than a single motor.
- \`edge_touch\` — \`left\` / \`right\` / \`both\` / \`none\`: whether the
  trajectory reaches a kymograph end (the motor continues onto microtubule
  outside the imaged segment, so its run length is right-censored).

## Visualisation

Generated kymograph PNGs are stored alongside the metrics workbook when
any polyline was opened in the editor's kymograph modal during the
session.

## Known limitations

- PySOAX has a known wrong-pairing failure mode at MT crossings (~50 %
  resolved by the v7 embedding-guided postprocessing). Splits/merges
  may surface as multiple short tracks for one real MT.
- Tracking does not currently model catastrophe / rescue events
  explicitly — sharp drops in length within a single trackId are the
  best heuristic for now.
`;
}

function buildSpheroidGuide({ areaUnit, lengthUnit, scaleInfo }: UnitContext): string {
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
`;
}

function buildSpheroidInvasiveGuide({ areaUnit, scaleInfo }: UnitContext): string {
  return `# Disintegration Analysis Metrics Guide
${scaleInfo}
This export is one row per image with four numeric metrics —
**Total Spheroid Area**, **Core Area**, **Invasion Area** (all in ${areaUnit})
and **Disintegration Index** (dimensionless). The metrics target spheroid
disintegration analysis (Lim, Kang, Lee 2020 — Sci. Rep. PMC6971071) but
apply equally to compact (t=0) and disintegrated (t>0) spheroids.

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

The DI is a scalar in \`[0, 1)\` that quantifies *how far the spheroid's radial
mass distribution has dispersed beyond its dense core*, in a size-invariant
way. It is **core-anchored** and **requires a core** — there is no
equivalent-disk fallback. Reported in the Excel column **Disintegration Index**
(4 decimal places, dimensionless); rendered as **N/A** when no core is present.

Algorithm (implemented in
\`backend/segmentation/api/metrics_endpoint.py\` — POST \`/api/disintegration-index\`):

1. **Rasterise the union of every external polygon** (the whole ASPP segmentation
 mask, excluding cores) into a single binary canvas via repeated
 \`cv2.fillPoly\`. Collect the \`(x, y)\` of all \`M\` foreground pixels.

2. **Core (required)**. Rasterise the union of the \`partClass="core"\` polygon(s)
 into \`N_C\` pixels with centroid \`c = (mean(xᵢ_core), mean(yᵢ_core))\` and
 effective radius \`R_C = √(N_C / π)\`. If no core rasterises to ≥ 1 pixel the
 DI is **undefined**: the endpoint returns \`reference="no_core"\` and the Excel
 cell shows \`N/A\` (never a computed 0).

3. **Core-anchored, core-normalised distances**. For each foreground pixel take
 the Euclidean distance to the **core centroid** \`c\`,
 \`rᵢ = √((xᵢ − cx)² + (yᵢ − cy)²)\`, and normalise by the core radius:
 \`d̃ᵢ = rᵢ / R_C\`. Anchoring on the core (not the mask centroid, which drifts
 toward the invasion zone) makes the metric measure how far mass spread *from
 the dense core*.

4. **Reference distribution — analytical uniform disk**. The reference is a
 filled disk of the core's size, \`F_ref(d̃) = min(d̃², 1)\`, whose inverse
 (quantile) is \`F_ref⁻¹(u) = √u\`. This is an *idealised* disk of radius
 \`R_C\`, independent of the core's actual shape.

5. **1-Wasserstein distance** in inverse-cumulative (quantile) form, estimated
 bin-free from the sorted normalised distances:
 \`W₁ = ∫₀¹ |d̃(u) − √u| du ≈ (1/M) · Σᵢ |d̃₍ᵢ₎ − √((i + 0.5) / M)|\`,
 where \`d̃₍ᵢ₎\` are the ascending \`d̃\` values. This is the paper's eq. (1).

6. **Saturation**: \`DI = tanh(W₁)\`. Maps \`W₁ ∈ [0, ∞) → [0, 1)\`. An intact
 spheroid (foreground ≈ core) gives \`d̃ ≤ 1\` distributed as a filled disk and
 \`DI ≈ 0\`; as mass disperses to \`d̃ ≫ 1\`, \`DI → 1\`.

**Properties**: dimensionless, scale-invariant (distances normalised by
\`R_C\`), rotation-invariant, translation-invariant (core-relative). Depends only
on the core's *size* (\`R_C\`), not its shape — the reference is an ideal disk.

**Calibrated thresholds** (user 12bprusek, April 2026):
- *time_0h* (compact): DI median ≈ 0.001
- *time_48h* (rozprsknuté): DI median ≈ 0.48
- 320× separation between groups

## Disintegration Metric Panel

Alongside DI the export reports a panel of companion metrics spanning the
*independent* ways a spheroid disintegrates, so redundancy with DI is explicit.
All are computed in the **same endpoint** from the same rasterised masks
(\`FG = C ∪ K\`, i.e. the foreground mask unioned with the core), and all are
**\`N/A\` unless a core anchored the computation** (\`reference="core"\`). Notation:
\`N_C\`/\`N_K\`/\`N_FG\` = pixel counts of core / corona / foreground; \`R_C\` = core
radius; \`d̃ = |p − c| / R_C\`.

| Metric (Excel column) | Axis | Formula | Reads as |
| --- | --- | --- | --- |
| **Radial Reach q95** | A — radial dispersal | 95th percentile of \`{d̃}\` | how far (in core radii) the leading 5 % of mass has travelled |
| **Dispersed-Mass Fraction** | B — mass partition | \`N_K / N_FG\` ∈ [0,1] | fraction of mass now outside the dense core |
| **Fragment Count** | C — fragmentation | connected components of FG after closing (\`r=2 px\`) with components \`< 30 px\` dropped | into how many pieces the spheroid has broken |
| **Largest-Fragment Fraction** | C — fragmentation | largest component ÷ de-speckled mass ∈ (0,1] | \`1\` = one mass, \`→0\` = fully fragmented |
| **Solidity** | D — porosity | \`N_FG / N_hull\` ∈ [0,1] | \`1\` = compact, \`→0\` = porous/dispersed |
| **Hole Count** | D — porosity | enclosed holes in FG (Betti-1, holes \`≥ 30 px\`) | internal porosity |
| **Core/Whole Equiv. Diameter** | E — absolute size | \`2·√(N/π)\` ×(µm/px) | absolute size context (not size-invariant) |

The **speckle guard** (closing radius \`2 px\`, min component/hole \`30 px\`) is fixed
and echoed by the endpoint (\`closing_radius_px\`, \`min_fragment_px\`) so results are
reproducible. Axis-A **Radius of gyration** and other second-moment descriptors
are deliberately *omitted* — their rank correlation with DI is ≈ 0.95 (same axis).

## Edge Cases & Caveats

- **No ASPP segmentation** (HRNet, CBAM-ResUNet, plain U-Net, sperm, wound):
no core polygon is generated. \`Core Area = 0\`, \`Total Spheroid Area\` still
reports the sum of all external polygons, but the **Disintegration Index is
\`N/A\`** (\`reference="no_core"\`) — DI is core-anchored and undefined without a
core. Area columns remain compatibility-safe for any model.
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
- **Excel writer**: same file (\`exportToExcel\` — emits Image Name, Total
Spheroid Area, Core Area, Invasion Area, Disintegration Index, and the metric
panel: Radial Reach q95, Dispersed-Mass Fraction, Fragment Count,
Largest-Fragment Fraction, Solidity, Hole Count, Core/Whole Equiv. Diameter)
`;
}

function buildWoundGuide({ areaUnit, lengthUnit, scaleInfo }: UnitContext): string {
  return `# Wound Healing Metrics Reference Guide
${scaleInfo}
Wound projects export a single morphological metric per polygon —
**Area** — together with an automatically generated **time-series chart**
of wound area progression across the imaged time points. Other geometric
quantities (perimeter, circularity, Feret, etc.) are not relevant for
wound-closure analysis and are intentionally not included.

## Area

- **Description**: Total enclosed area of the wound polygon using the
Shoelace formula with hole subtraction
- **Formula**: A = A_external - Sum(A_holes)
- **Implementation**: Shoelace formula:
A = (1/2)|Sum(x_i * y_{i+1} - x_{i+1} * y_i)|
- **Units**: ${areaUnit}
- **Range**: [0, ∞)
- **ImageJ compatibility**: ✅ Matches ImageJ area calculation
- **Hole handling**: Internal polygon (hole) areas are subtracted from
the external polygon area; final area is clamped at zero

## Time-Series Analysis

The wound export includes an automatically generated time-series chart
embedded as an additional sheet of \`metrics.xlsx\`.

### Time-Point Detection

Each input image's filename is parsed for a numeric time-point token
(e.g. \`wound_0h.png\`, \`wound_24h.png\`, \`wound_48h.png\`). Recognised
suffixes include \`h\` (hours), \`min\` (minutes) and bare integers.
Images are sorted by the parsed time value before charting; images
without a parseable time are excluded from the chart but still appear
in the per-polygon Area column.

### Wound Area Series

For each image, the wound area is computed as the **sum of all external
polygon areas** in ${areaUnit}. The series is plotted as a line chart with
time on the X-axis and wound area on the Y-axis. A scale conversion
(if configured at project level) is applied uniformly across the
series.

### Chart Embedding

The chart is rendered server-side via node-canvas and inserted into
the Excel workbook as an additional sheet — no client-side rendering
is required. Source: \`backend/src/services/export/woundTimeSeries.ts\`.

### Edge Cases

- **Single time point**: chart is omitted (no curve to draw); polygon
Area still exported in the main sheet.
- **Mixed parseable / unparseable filenames**: the chart includes only
parseable rows; unparseable rows are listed in the Excel as Area-only.
- **No external polygons in an image**: that image's wound area is
reported as 0 in the time series.

## Source Files

- **Wound time-series builder**: \`backend/src/services/export/woundTimeSeries.ts\`
- **Per-polygon area orchestration**: \`backend/src/services/metrics/metricsCalculator.ts\`
- **Excel writer**: \`exportPolygonMetricsToExcel\` — emits Image Name,
Polygon ID, Area (${areaUnit}); time-series sheet appended afterwards.

## Notes for Researchers

1. **Units**: Always verify scale conversion (${lengthUnit}) for
physical-length comparisons across imaging sessions.
2. **Holes**: Internal polygons are treated as holes — useful when
re-epithelialised islands appear inside the wound.
3. **Time parsing**: Use consistent filename conventions (\`<name>_<N>h.png\`
or similar) for clean time-series plots.
`;
}

function buildSpermGuide({ lengthUnit, scaleInfo }: UnitContext): string {
  return `# Sperm Morphology Metrics Reference Guide
${scaleInfo}
Sperm projects export **per-instance morphology** — one row per detected
sperm cell, with separate length measurements for each anatomical part
(head, midpiece, tail) plus the combined total length. Geometric polygon
metrics (area, circularity, Feret, etc.) are not applicable to the
polyline-based sperm representation and are not included.

## Calculated Metrics

### Head Length
- **Description**: Total Euclidean length of the sperm head polyline
- **Formula**: L = Sum(sqrt((x_{i+1} - x_i)^2 + (y_{i+1} - y_i)^2))
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)

### Midpiece Length
- **Description**: Total Euclidean length of the midpiece polyline
- **Formula**: same as Head Length, applied to midpiece vertices
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)

### Tail Length
- **Description**: Total Euclidean length of the tail polyline
- **Formula**: same as Head Length, applied to tail vertices
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)

### Total Length
- **Description**: Sum of head + midpiece + tail lengths for the same
sperm instance
- **Formula**: TotalLength = HeadLength + MidpieceLength + TailLength
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)
- **Missing parts**: A part not detected on a given instance contributes
zero to the total. The row is still emitted (e.g. head + tail without
detected midpiece is valid output).

## Polyline Geometry

Sperm anatomical parts are represented as **open polylines**, not closed
polygons. A polyline is an ordered sequence of vertices [(x_1, y_1), …,
(x_n, y_n)] with no edge connecting (x_n, y_n) back to (x_1, y_1).
Length is the cumulative Euclidean distance between consecutive
vertices.

## Instance Grouping

Each sperm instance carries an \`instanceId\` field. Polylines sharing
the same \`instanceId\` are grouped together and contribute to the
**same row** of the Excel sheet. The \`partClass\` field on each
polyline declares which anatomical part it represents:

\`\`\`
partClass ∈ { "head", "midpiece", "tail" }
\`\`\`

Polylines without an \`instanceId\` are excluded from the per-instance
sheet (a warning is logged but the export does not fail). Polylines
with an unrecognised \`partClass\` are ignored.

## Edge Cases

- **Image with no detected sperm**: that image contributes no rows.
The export still succeeds.
- **No sperm detected across the entire project**: \`metrics.xlsx\` is
not written. The export falls back to the standard polygon metrics
report, which will be empty for this project type.
- **Multiple instances in one image**: each instance gets its own row
keyed by the unique \`instanceId\` value.
- **Duplicate \`partClass\` for the same instance**: only the first
polyline of each part is used; subsequent ones are silently skipped.

## Source Files

- **Polyline length**: \`backend/src/services/metrics/polylineLength.ts\`
- **Instance grouping**: \`backend/src/services/metrics/spermGrouping.ts\`
- **Excel writer**: \`backend/src/services/metrics/metricsCalculator.ts\`
(\`exportSpermToExcel\` — emits Image Name, Instance ID, Head/Midpiece/Tail/Total Length)

## Notes for Researchers

1. **Units**: Always verify scale conversion for cross-microscope or
cross-magnification comparisons.
2. **Manual completion**: A sperm cell with one missing part is still
exported with the present parts — useful for partially occluded cells.
3. **Polyline ordering**: Length is order-independent (Euclidean
distance is symmetric), but the source-of-truth for which vertex is
"start" vs. "end" is determined by user annotation.
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
