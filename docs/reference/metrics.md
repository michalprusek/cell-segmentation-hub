# Metrics reference

Exactly how every measured number is computed, and where the implementation
deviates from what its name suggests. If you are publishing numbers from this
platform, read the [caveats](#caveats--read-before-publishing).

Two implementations exist and they are **not identical**:

| Implementation | Used by                                                            | Source                                               |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| **Backend**    | The project export ZIP (`metrics.xlsx` / `.csv` / `.json`)         | `backend/src/services/metrics/`                      |
| **Frontend**   | The metrics panel in the editor and the editor's single-image XLSX | `src/pages/segmentation/utils/metricCalculations.ts` |

They agree on area, perimeter, extent, solidity and the Feret family. They
**disagree on circularity, compactness and convexity for polygons with holes** —
see [caveats](#caveats--read-before-publishing).

---

## Shape metrics

Let _A_ be the area, _P_ the perimeter, and _H_ the convex hull.

| Metric                          | Formula                                                                                                          | Notes                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Area**                        | Shoelace: `\|Σ(xᵢ·yⱼ − xⱼ·yᵢ)\| / 2`, wrapping to the first vertex                                               | Hole areas are subtracted; the result is clamped at 0                                |
| **Perimeter**                   | Sum of edge lengths, closing back to the first vertex                                                            | **External boundary only**                                                           |
| **Perimeter with holes**        | External perimeter + the perimeter of every hole                                                                 |                                                                                      |
| **Equivalent diameter**         | `√(4A/π)`                                                                                                        | Diameter of a circle with the same area                                              |
| **Circularity**                 | `min(1, 4πA / P²)`                                                                                               | 1 for a perfect circle. Clamped, because discretisation can push it slightly above 1 |
| **Compactness**                 | `P² / (4πA)`                                                                                                     | The reciprocal of circularity. 1 for a circle, unbounded above                       |
| **Extent**                      | `A / (bbox width × bbox height)`                                                                                 | How much of the axis-aligned bounding box is filled, 0–1                             |
| **Convexity**                   | `perimeter(H) / P`                                                                                               | 1 for a convex shape                                                                 |
| **Solidity**                    | `A / area(H)`                                                                                                    | How "filled" the shape is                                                            |
| **Feret diameter max**          | Largest distance between any two hull vertices                                                                   |                                                                                      |
| **Feret diameter min**          | For each hull edge, the largest perpendicular distance to any other hull vertex; then the **minimum** over edges | The minimum caliper width                                                            |
| **Feret diameter orthogonal**   | 2 × the largest one-sided perpendicular distance from the max-Feret axis                                         | **An approximation** — see caveats                                                   |
| **Feret aspect ratio**          | `FeretMax / FeretMin`                                                                                            |                                                                                      |
| **Bounding box width / height** | Axis-aligned extents                                                                                             |                                                                                      |
| **Polyline length**             | Sum of consecutive segment lengths, **not** closing the loop                                                     | The measure for all open geometry                                                    |

### Scaling to micrometres

When you give a pixel size _s_ (µm/px) at export:

| Scaled by _s²_ | Scaled by _s_                                                                                                                            | Not scaled (dimensionless)                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Area           | Perimeter, perimeter with holes, equivalent diameter, all Feret diameters, major/minor axis, bounding box width/height, polyline lengths | Circularity, compactness, extent, convexity, solidity, Feret aspect ratio, sphericity |

An out-of-range or unparseable scale (outside 0.001–1000) causes a **silent
fallback to pixel units**. The unit is always in the column header — check it.

---

## Disintegration Index (DI)

`spheroid_invasive` projects only. The paper's **core-anchored** index.

Every foreground pixel's distance from the **core centroid** is normalised by the
core's effective radius `R_C = √(N_core / π)`, giving `d̃ = d / R_C`. The
empirical distribution of `d̃` is compared to the analytic distribution of a
uniform filled disk, `F_ref(d̃) = min(d̃², 1)` (inverse `√u`), by the
1-Wasserstein distance in quantile form:

```
W1 = ∫₀¹ |d̃(u) − √u| du  ≈  (1/N) Σᵢ |d̃₍ᵢ₎ − √((i + 0.5)/N)|
DI = tanh(W1)   ∈ [0, 1)
```

An intact spheroid (foreground ≈ core) is distributed like a filled disk and
gives **DI ≈ 0**; as mass disperses to `d̃ ≫ 1`, **DI → 1**.

Foreground is the **union of every external polygon**, with the core included so
`FG = corona ∪ core`.

> **A core is required. There is deliberately no fallback.** Without a usable
> core polygon the index is undefined and every DI-derived column is reported as
> the literal string `N/A` — never as a computed zero. An earlier
> equivalent-disk fallback was removed because it produced plausible-looking
> numbers from nothing.

### The panel metrics beside it

| Metric                         | Definition                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Radial Reach q95 (R_core)`    | 95th percentile of `d/R_C` over the foreground                                                       |
| `Dispersed-Mass Fraction`      | corona pixels / foreground pixels                                                                    |
| `Fragment Count`               | 8-connected components after an elliptical morphological close, dropping specks below a minimum size |
| `Largest-Fragment Fraction`    | largest kept component / all kept components                                                         |
| `Solidity`                     | `min(1, foreground pixels / convex hull area)`                                                       |
| `Hole Count`                   | enclosed background contours above a minimum size                                                    |
| `Core / Whole Equiv. Diameter` | `2√(N/π)` for the core and for the whole foreground                                                  |

If the index calculation fails outright the areas are still computed locally and
reported; only the DI columns drop out.

---

## Wound closure

`Wound area (%) = (Σ external area − Σ hole area) / (image width × height) × 100`,
clamped at 0. A polygon counts as a hole only if it is typed internal **and**
has a parent. The time series is ordered by the images' display order, and the
chart is embedded in the workbook as well as written to
`wound_healing/wound_area_chart.png`.

---

## Microtubule intensity

Microtubule intensity has **one implementation**, in
`backend/segmentation/models/mt_measure.py`, shared by the project export and
the [Automated Essays](../guides/automated-essays.md) batch. Before that module
existed the two had drifted: band area by −7.8 %…+26.5 %, ring area by 2.2×, and
the **net signal by a median of +9.9 % (max +33.2 %)**. Only length agreed.

### The signal band

Reproduces ImageJ's **`Roi.convertLineToArea`** — what `Analyzer.measureLength`
uses for a wide line — rather than a distance transform:

- half-width = `max(1, thickness) / 2`;
- per segment, a quadrilateral offset perpendicular to the segment;
- both ends extended **0.5 px** along the line — **butt caps**, ImageJ's
  convention, not round caps;
- a triangular filler at each interior joint;
- rasterised with ImageJ's top-left scanline fill rule.

Measured against ImageJ: **IoU 1.000 at width 5**, area difference 0.0 %. The
round-capped distance-transform band it replaced over-counted area by about 8 %
at width 5 and 14 % at width 8.

### The background ring

```
margin_radius = round(thickness × margin_multiplier)
ring(i) = dilate(band(i), margin_radius)  AND NOT  (union of ALL bands in the frame)
```

The ring reaches `margin_radius` out from the microtubule's own band and
**excludes the band of every other microtubule in the frame**, so a neighbouring
filament can never be counted as background. This is why the ring cannot be
computed one microtubule at a time.

Defaults: thickness **5 px**, margin multiplier **2** → a **10 px** reach.

### The statistics

- **Median** uses ImageJ's histogram tie rule — `sorted[n // 2]`, the _upper_ of
  the two central values — **not** NumPy's average of the two. On integer 16-bit
  data this reproduces ImageJ to the exact grey level.
- **Standard deviation** is the **sample** SD (`ddof = 1`), as ImageJ reports,
  and is `0.0` for a single pixel.
- An **empty region** yields a null/blank result, and the caller decides how to
  render it — never a zero.

### Signal minus background

| Name                                                | Definition                    | Where it appears                  |
| --------------------------------------------------- | ----------------------------- | --------------------------------- |
| `signalMinusBackground` / `signal_minus_background` | mean(band) − **median**(ring) | Project export **and** essays CSV |
| `net_mean_intensity`                                | mean(band) − **mean**(ring)   | Essays CSV only                   |

The median is preferred because it resists a neighbouring filament's halo in a
way the mean does not. `net_mean_intensity` survives only for continuity with
essays runs from before August 2026.

Both are **null when the ring is empty, never 0** — a zero background would
silently inflate the net signal by the entire signal.

> **A negative `signalMinusBackground` on an IRM channel is correct, not a
> bug.** In interference reflection microscopy a microtubule is _darker_ than
> its surround, so band mean minus background median is genuinely below zero.
> The fluorescence channels of the same container come out positive. If you see
> one negative column and one positive column side by side, that is the two
> modalities behaving as they should — the sign tells you which channel you are
> looking at.

Intensity is measured for **every channel of the container**, not just the
segmentation source, and it is read from the **raw 16-bit ND2/TIFF volume**
rather than from any display image. A real two-channel container therefore
produces `frames × microtubules × 2` rows.

### The two consumers name the same numbers differently

| Concept          | Project export          | Essays `results.csv`      |
| ---------------- | ----------------------- | ------------------------- |
| band mean        | `meanIntensity`         | `mt_mean_intensity`       |
| band median      | `medianIntensity`       | `mt_median_intensity`     |
| band SD          | `stdIntensity`          | `mt_std_intensity`        |
| band sum         | `sumIntensity`          | `mt_sum_intensity`        |
| ring mean        | `meanBackground`        | `bg_mean_intensity`       |
| ring median      | `medianBackground`      | `bg_median_intensity`     |
| band pixel count | `pixelCount` / `areaPx` | `n_px_mt`                 |
| ring pixel count | —                       | `n_px_bg`                 |
| mean − median    | `signalMinusBackground` | `signal_minus_background` |
| mean − mean      | —                       | `net_mean_intensity`      |

---

## Kymograph velocity

Blob trajectories are detected in the space × time matrix and their slope gives
velocity. Reported per track: net velocity in µm/s and in px/frame, signal-to-noise
ratio, total run length and time, the signal and background intensities and
their difference, and two flags — `bright` (a brightness outlier) and
`edge_touch` (the trajectory reaches the edge of the kymograph, so the run may be
truncated).

Sampling along the centerline is **arc-length-uniform** with nearest-neighbour
interpolation (no blending) and reads 0 outside the frame; detection runs on the
raw, un-normalised matrix. Velocities depend on `pixel_size_um` and
`frame_interval_ms`, both carried in the output so a result can be re-derived.

---

## Caveats — read before publishing

These are real properties of the implementation, not hypotheticals.

1. **`Sphericity` is `circularity × 0.8`.** It is a flat multiplier standing in
   for a 3D-like quantity, not a measured geometric property. Do not report it
   as sphericity.
2. **`Major Axis Length` and `Minor Axis Length` are the Feret max and min**, not
   the axes of an ellipse fitted through the centroid, despite the names.
3. **The orthogonal Feret diameter is an approximation.** It doubles the largest
   one-sided perpendicular distance from the max-Feret axis. A true orthogonal
   caliper width measures between two parallel supporting lines and is not in
   general twice the one-sided distance.
4. **Feret diameters are found by brute-force pairwise search** over the convex
   hull, not by rotating calipers. The result is correct for the maximum; the
   cost is O(n²) in hull vertices.
5. **Circularity, compactness and convexity differ between the export and the
   editor for polygons with holes.** The export divides by the **external**
   perimeter; the editor divides by the perimeter **including holes**. For a
   solid polygon the two agree exactly.
6. **"ImageJ convention" for perimeter means only "external contour only"** — it
   is a plain vertex-to-vertex Euclidean sum, _not_ ImageJ's corner-corrected
   boundary tracing. The genuine ImageJ alignment work exists only in the
   microtubule band/ring module described above.
7. **COCO hole association is by spatial containment only** and is marked as
   simplified in the code.
8. **The microcapsule sheet's `Compactness` column contains circularity**, and
   `Ovality` is the Feret aspect ratio.
9. **Border-clipped microcapsules are excluded** from every microcapsule metric.
10. **Neurite/soma output carries no per-class metric.** Both classes land in
    the generic `Polygon Metrics` sheet as plain polygons, and the sheet has no
    column saying which is which. To split soma from neurite you need the
    **COCO or custom-JSON** export, where they are separate categories — the
    YOLO writer emits class id `0` for every polygon and loses the split.
11. **Neurite/soma soma counts are only validated at ~0.180 µm/px.** At about
    half that pixel size each soma tends to be returned split into two pieces,
    which inflates any count or per-soma average taken from it.
12. **Essays numbers from before 2026-08-13 are not comparable** with later ones
    — the band and ring geometry changed with the unification.

## Related

- [Export](../guides/export.md) — which columns land in which file
- [ML models](ml-models.md) — what each model outputs to measure
- [Automated Essays](../guides/automated-essays.md)
