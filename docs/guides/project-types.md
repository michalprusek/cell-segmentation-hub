# Project types

Every project has a **type**, chosen when you create it. The type decides which
models you may run, what geometry they produce, which panels the editor shows,
which metrics are computed, and which export artifacts you get.

There are seven. Pick the one that matches your specimen — the type is not a
label, it changes behaviour end to end.

| Type (in the dialog)        | Guide                                                   | Specimen                                            |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| **Spheroids (standard)**    | [spheroid](project-types/spheroid.md)                   | Cellular spheroids in bright field / phase contrast |
| **Disintegrated spheroids** | [spheroid-invasive](project-types/spheroid-invasive.md) | Spheroids dispersing into a matrix; core + corona   |
| **Wound healing**           | [wound](project-types/wound.md)                         | Scratch-assay time-lapses                           |
| **Sperm**                   | [sperm](project-types/sperm.md)                         | Spermatozoa, per-part morphology                    |
| **Microtubules**            | [microtubules](project-types/microtubules.md)           | IRM microtubule time-lapses                         |
| **Microcapsules**           | [microcapsule](project-types/microcapsule.md)           | Round microcapsules in bright field                 |
| **Neurites & somas**        | [neurite](project-types/neurite.md)                     | Cultured neurons in fluorescence, tubulin channel   |

---

## Choosing a type

Create a project from the dashboard: give it a title, an optional description,
and pick the type from the dropdown. The type can be changed later by the
project owner from the project's settings, but be aware that changing it changes
which models are allowed — existing segmentations produced by a now-incompatible
model stay on disk but cannot be re-run.

---

## Side by side

|                                    | spheroid                      | spheroid_invasive           | wound                                 | sperm                     | microtubules                             | microcapsule                       | neurite                              |
| ---------------------------------- | ----------------------------- | --------------------------- | ------------------------------------- | ------------------------- | ---------------------------------------- | ---------------------------------- | ------------------------------------ |
| **Models available**               | 5                             | 1                           | 1                                     | 1                         | 1                                        | 1                                  | 1                                    |
| **Model choice honoured**          | yes                           | forced                      | forced                                | forced                    | forced                                   | forced                             | forced                               |
| **Threshold**                      | 0.5                           | 0.2                         | 0.5                                   | 0.5 (model overrides it)  | **0.97**                                 | 0.5                                | **none — the decision is an argmax** |
| **Output geometry**                | closed polygons + holes       | closed polygons, core class | closed polygons                       | open polylines, 3 parts   | **open polylines**                       | closed polygons                    | closed polygons, two classes         |
| **Per-shape fields**               | —                             | `partClass: core`           | —                                     | `partClass`, `instanceId` | `trackId`, `mtType`                      | `complete`                         | `partClass: neurite \| soma`         |
| **Video / multi-channel**          | supported                     | supported                   | typical                               | supported                 | **central**                              | supported                          | supported                            |
| **Cross-frame tracking**           | no                            | no                          | no                                    | no                        | **yes, automatic**                       | no                                 | no                                   |
| **Type-specific editor panel**     | —                             | core drawn green            | —                                     | Sperm Instances           | Microtubule Instances + type labels      | —                                  | class colours in the shape list      |
| **"Add channel"**                  | no                            | no                          | no                                    | no                        | **yes**                                  | no                                 | no                                   |
| **Channel registration at upload** | no                            | no                          | no                                    | no                        | **yes**                                  | no                                 | no                                   |
| **Metrics sheet**                  | `Polygon Metrics` + `Summary` | `Image Metrics` (DI)        | `Polygon Metrics` + `WoundTimeSeries` | `Sperm Metrics`           | `Microtubule Metrics` + `Channel Totals` | `Microcapsule Metrics` + `Summary` | `Polygon Metrics` + `Summary`        |
| **COCO / YOLO / JSON**             | yes                           | yes                         | yes                                   | yes                       | **no**                                   | yes                                | yes — but YOLO loses the class       |
| **ImageJ ROI + CVAT**              | no                            | no                          | no                                    | no                        | **yes, always**                          | no                                 | no                                   |
| **Kymographs**                     | no                            | no                          | no                                    | no                        | **yes**                                  | no                                 | no                                   |

---

## Thresholds are not a setting

The threshold row above lists a **per-model constant**, not something you can
dial. `ModelContext` derives it read-only from the model registry, and no screen
renders a control for it — Settings offers the model and hole detection only. To
change a threshold you change the model, or the registry.

---

## What every project type shares

Regardless of type you get:

- **Projects and folders** — a per-user folder tree to organise projects.
- **Upload** of images and of videos / ND2 / multi-page TIFF, with per-frame
  channel handling. See [Uploading data](uploading-data.md).
- **A queue** with live progress over a WebSocket, batch segmentation of up to
  10 000 images, and fairness scheduling so one long video cannot monopolise the
  GPU.
- **The segmentation editor** with all seven edit modes. See
  [Segmentation editor](segmentation-editor.md).
- **Export** to a ZIP with images, visualisations, annotations, metrics and
  documentation. See [Export](export.md).
- **Sharing** by e-mail or link, and a project "verified" flag.
  See [Sharing](sharing-and-collaboration.md).

Two tools sit **outside** the project system entirely:
[Automated Essays](automated-essays.md) (batch microtubule assay of ND2 wells)
and the [Segmenter](segmenter.md) (standalone class-based annotation).

## Related

- [ML models](../reference/ml-models.md) — what each model is and how it behaves
- [Metrics](../reference/metrics.md) — every formula
