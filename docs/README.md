# SpheroSeg / Cell Segmentation Hub — Documentation

SpheroSeg is a web platform for AI-assisted segmentation and measurement of
microscopy images and time-lapse videos. It ships **seven project types** backed
by **eleven segmentation models**, a polygon/polyline editor, cross-frame
microtubule tracking, and a batch export pipeline.

Live instance: <https://spherosegapp.utia.cas.cz> · Developed at
[UTIA AV CR](https://www.utia.cas.cz).

---

## How to find things in these docs

There is no docs site generator here — the tree is read as plain Markdown, on
GitHub or in an editor. Three ways to search it:

| You want to…                      | Do this                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search the **user manual**        | Open <https://spherosegapp.utia.cas.cz/documentation> and use the search box at the top (press <kbd>/</kbd> to focus it). It searches every section title and body in your own language. |
| Search **this tree** from a shell | `grep -rin "kymograph" docs/` — every page is plain Markdown with stable headings.                                                                                                       |
| Search **this tree** on GitHub    | Press <kbd>t</kbd> for the file finder, or use `path:docs/ <term>` in code search.                                                                                                       |

Every page below starts with a one-line summary so `grep -A1 '^# '` gives you a
table of contents. Cross-references between pages are relative links, and
`node scripts/check-doc-links.cjs` (also `make docs-links`) fails the build if
any of them rot.

---

## Start here

| I am a…                       | Read                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Researcher using the app      | [User guide](guides/user-guide.md) → then your [project type](guides/project-types.md)     |
| Researcher with videos / ND2  | [Videos, frames and channels](guides/videos-and-channels.md)                               |
| Researcher exporting data     | [Export and metrics](guides/export.md)                                                     |
| Developer joining the project | [Getting started](development/getting-started.md) → [Architecture](architecture/README.md) |
| Someone integrating over HTTP | [REST API](api/README.md) + [ML service API](api/ml-service.md)                            |
| Someone operating the server  | [Deployment](deployment/README.md) + [Troubleshooting](TROUBLESHOOTING.md)                 |

---

## User guides

Written for the person in front of the browser. No code knowledge assumed.

| Page                                                             | Covers                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [User guide](guides/user-guide.md)                               | Account, projects, folders, the full upload → segment → edit → export loop                           |
| [Project types](guides/project-types.md)                         | All seven types side by side: models, geometry, metrics, exports                                     |
| [Uploading data](guides/uploading-data.md)                       | Accepted formats, size limits, what becomes an image vs a video, calibration metadata                |
| [Videos, frames and channels](guides/videos-and-channels.md)     | Video containers, ND2/TIFF stacks, multi-channel display, window/level, registration, playback proxy |
| [Segmentation editor](guides/segmentation-editor.md)             | Every edit mode, every keyboard shortcut, polygons vs polylines, tracks                              |
| [Export and metrics](guides/export.md)                           | COCO / YOLO / JSON / XLSX / ImageJ ROI / CVAT, and how each metric is defined                        |
| [Automated Essays](guides/automated-essays.md)                   | Batch microtubule assay of ND2 wells                                                                 |
| [Segmenter (few-shot)](guides/segmenter.md)                      | The standalone class-based polygon annotation tool                                                   |
| [Sharing and collaboration](guides/sharing-and-collaboration.md) | Sharing by e-mail or link, permissions, project verification                                         |

### Per project type

| Type                | Guide                                                          | Model(s)                                                    | Output geometry              |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| `spheroid`          | [Spheroid](guides/project-types/spheroid.md)                   | HRNet, CBAM-ResUNet, UNet (SpheroHQ), SegFormer, Mamba-UNet | Closed polygons + holes      |
| `spheroid_invasive` | [Invasive spheroid](guides/project-types/spheroid-invasive.md) | Spheroid Disintegration (UNet++/EfficientNet-B5, 3-class)   | Core + corona polygons       |
| `wound`             | [Wound healing](guides/project-types/wound.md)                 | Wound Healing (U-Net / MiT-B5)                              | Closed polygons              |
| `sperm`             | [Sperm morphology](guides/project-types/sperm.md)              | Sperm Morphology                                            | Per-part polygons + skeleton |
| `microtubules`      | [Microtubules](guides/project-types/microtubules.md)           | Microtubule v5H (nnU-Net ResEnc-M + curvature instancer)    | **Open polylines**           |
| `microcapsule`      | [Microcapsules](guides/project-types/microcapsule.md)          | Microcapsule (distilled U-Net + watershed)                  | Closed polygons              |
| `neurite`           | [Neurites and somas](guides/project-types/neurite.md)          | Neurite / Soma (nnU-Net ResEnc-M, 3-fold)                   | Closed polygons, two classes |

---

## Reference

| Page                                                  | Covers                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| [ML models](reference/ml-models.md)                   | All eleven models: architecture, training data, speed, thresholds, limits |
| [Metrics](reference/metrics.md)                       | Exact formula and convention behind every measured number                 |
| [Keyboard shortcuts](reference/keyboard-shortcuts.md) | One table, whole app                                                      |
| [Database schema](reference/database-schema.md)       | Every Prisma model, column, index and its purpose                         |
| [Glossary](reference/glossary.md)                     | Container, frame, channel, track, polyline, IRM, DI, …                    |

## API

| Page                                          | Covers                                                         |
| --------------------------------------------- | -------------------------------------------------------------- |
| [REST API](api/README.md)                     | Every backend endpoint, grouped by resource                    |
| [Authentication](api/authentication.md)       | Cookie + bearer JWT, refresh flow, sessions                    |
| [WebSocket events](api/websocket.md)          | Socket.io rooms, event names and payloads                      |
| [ML service API](api/ml-service.md)           | The Python FastAPI service: segment, track, kymograph, metrics |
| [Swagger / OpenAPI](api/swagger-openapi.md)   | The generated spec and how to reach it                         |
| [Endpoint registry](api/endpoint-registry.md) | Runtime endpoint tracking and health monitoring                |

## Architecture

| Page                                                   | Covers                                                  |
| ------------------------------------------------------ | ------------------------------------------------------- |
| [Overview](architecture/README.md)                     | Services, data flow, deployment topology                |
| [Frontend](architecture/frontend.md)                   | React app structure, state, the editor                  |
| [Backend](architecture/backend.md)                     | Express layers, queue, storage, tracking                |
| [ML service](architecture/ml-service.md)               | FastAPI, model loading, GPU behaviour                   |
| [Project/image state flow](SSOT_DATA_FLOW_CURRENT.md)  | How dashboard and project state is owned and propagated |
| [Polygon rendering](polygon-rendering-optimization.md) | Canvas render path and its indices                      |

## Development

| Page                                                | Covers                                     |
| --------------------------------------------------- | ------------------------------------------ |
| [Getting started](development/getting-started.md)   | Local Docker stack, ports, first run       |
| [Contributing](development/contributing.md)         | Branching, commits, the local PR gate      |
| [Testing guide](testing-guide.md)                   | What each suite covers and its real health |
| [i18n guide](i18n-guide.md)                         | Six locales, the completeness checker      |
| [Git hooks](hooks-guide.md)                         | What pre-commit enforces                   |
| [Performance guidelines](PERFORMANCE_GUIDELINES.md) | Frontend and backend performance rules     |

## Operations

| Page                                                        | Covers                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [Deployment](deployment/README.md)                          | The single-stack production deploy, service by service |
| [Troubleshooting](TROUBLESHOOTING.md)                       | Symptom → cause → fix                                  |
| [Model weights setup](MODEL_WEIGHTS_SETUP.md)               | Downloading and staging checkpoints                    |
| [GPU configuration](GPU-CONFIGURATION.md)                   | Device access, fallback, memory budget                 |
| [Database backup](database-backup.md)                       | The backup timer and restore drill                     |
| [Access logging](ACCESS_LOGGING.md)                         | Request logging and retention                          |
| [Automatic cleanup](AUTOMATIC_CLEANUP.md)                   | Scheduled disk reclamation                             |
| [API monitoring](deployment/api-monitoring.md)              | Health checks, metrics, alerting                       |
| [Docker build system](deployment/DOCKER_BUILD_MIGRATION.md) | The optimized build targets                            |
| [Branch protection](setup-branch-protection.md)             | The `main` ruleset                                     |

## Design history

`docs/superpowers/` holds the design specs and implementation plans written
before each feature landed — `specs/` for the design, `plans/` for the
step-by-step. They are dated and **not maintained afterwards**: read them for
_why_ a thing works the way it does, and treat this tree (and the code) as the
authority on _how_ it works today.

`docs/research/` holds literature surveys behind unshipped work.

---

## A note on accuracy

Pages here are written against the code, not against their own previous
version. Where a page states a number (a threshold, a timing, a size limit) it
is either quoted from a constant in the repository or measured; where behaviour
is subtle or counter-intuitive the page says so explicitly rather than
smoothing it over. If a page and the code disagree, the code is right and the
page is a bug — please fix it in the same PR that revealed it.
