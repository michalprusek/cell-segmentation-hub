# ML service API

The Python FastAPI process that runs the models. It sits **behind** the Node
backend and is not exposed publicly — the backend is its only client. This page
documents it for people debugging the pipeline or extending it.

- Dev: `http://localhost:8000` · Production: internal, port 4008
- Interactive spec: `http://localhost:8000/docs`
- Single worker (`uvicorn --workers 1`). Concurrent requests queue rather than
  parallelise; the export path serialises its calls for exactly this reason.

---

## Root and health

| Method | Path             | Purpose                                               |
| ------ | ---------------- | ----------------------------------------------------- |
| GET    | `/`              | Service name, version, status                         |
| GET    | `/health`        | Health check, including a **live GPU probe**          |
| GET    | `/api/v1/health` | Health with model-loading detail                      |
| GET    | `/api/v1/status` | Loaded models, current processing state, queue length |
| GET    | `/api/v1/models` | The available model catalogue                         |
| GET    | `/metrics`       | Prometheus metrics                                    |

> The health check does more than call `torch.cuda.is_available()` — it also
> opens `/dev/nvidiactl`. Once a CUDA context exists in the process,
> `is_available()` keeps returning `True` even after the container's device
> allowlist has been stripped by a cgroup re-apply; the device-node probe is the
> live check, and `EPERM` on a mode-0666 node is that failure's signature.

---

## Segmentation

### `POST /api/v1/segment`

`multipart/form-data`:

| Field            | Type   | Default | Notes                                                                                                         |
| ---------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `file`           | file   | —       | PNG, JPG, JPEG, TIFF, TIF or BMP. The extension of the filename is checked first                              |
| `model`          | string | `hrnet` | A model id from the registry — one of thirteen. An unknown id is a 400                                        |
| `threshold`      | float  | `0.5`   | Constrained to 0.1–0.99                                                                                       |
| `detect_holes`   | bool   | `true`  | Detect internal contours                                                                                      |
| `page`           | int    | `0`     | Zero-based page of a multi-page image. Past the end is a 400                                                  |
| `max_pixels`     | int    | none    | Refuse (413) an image with more pixels, judged from the header before anything decodes                        |
| `extra_channels` | files  | none    | Further channels of the same image, merged with `file` before segmentation. `neurite_soma_classical` **only** |

**`extra_channels`** exists for the one model that merges channels,
`neurite_soma_classical`: `file` is the first channel and each `extra_channels`
part is another channel of the same image. They are normalised and merged in
the ML service, at native bit depth, into the one greyscale image that is
segmented. For any other model the field is **refused with a 400**, not
ignored — a caller who sent three channels and got the segmentation of the
first one could not tell. At most 7 extra channels (8 merged in all); every
channel must have the same size as `file`. `neurite_soma_classical` also
answers 413 for an image over 64 megapixels.

Returns the polygons (and/or polylines), the model used, `image_size`, `page`,
`page_count` and timing. The app's queue sends neither `page` nor
`max_pixels`; the public API (`/api/v1/segment` on the **backend** — a
different service that happens to share the path) sends both.

**High-bit-depth input.** Ten of the thirteen models go through Pillow's
`convert('RGB')` / `convert('L')`, which **clips** a 16-bit, 32-bit or float
image at 255 instead of rescaling it. Until 2026-10-06 such a frame reached
those models as a white rectangle: on every such still in production (three,
of 3 475 in the affected project types) the model saw 1, 1 and 5 grey levels
and returned no polygons. They are now stretched first, from the frame's
0.1–99.9 percentile range to 0–255 (`api/input_depth.py`, which also records
why it is not min-max), and the response carries `input_conversion` with the
range used. `microtubule`, `neurite_soma` and `neurite_soma_classical` read
the native depth and are not converted. An 8-bit image is passed through as the
same object — verified on 62 real results across the twelve models that
existed on 2026-10-06, identical before and after.

**Six models ignore `threshold`**, because their cut is calibrated
differently from the generic one — or does not exist:

- **`sperm`** and **`sperm_2part`** use their own mask threshold (0.3) and
  score threshold (0.95);
- **`microtubule`** applies its own `prob_thr` of 0.98 (SPARSE35 ep040; v5H
  used 0.97) from its parameter file. The backend deliberately sends **no**
  threshold for it. Note that 0.98 is not even expressible through some
  callers' constraints, so forwarding a user value would either cut a very
  confident foreground at 0.5 and flood the instancer with noise, or fail
  validation;
- **`neurite_soma`** and **`spheroid_disintegration`** have no threshold at
  all: the classes are an **argmax**, so there is no probability cut to move.
  The request value is accepted and echoed in the response, and then ignored
  (`spheroid_disintegration` says so: `threshold_applies: false`);
- **`neurite_soma_classical`** cuts relative to each image's own noise, with
  the parameters in `PARAMS` in `models/neurite_classical.py`. The request
  value is echoed, not applied.

`wound`, `microcapsule` and the five spheroid models **do** apply it. (This
page used to list `wound` among the models that ignore it; `WoundModel`
thresholds its probability map with the request value.)

`detect_holes` changes the output of the five spheroid models, `wound` and
`neurite_soma_classical` only. `neurite_soma_classical` emits a hole (for
example the inside of a neurite loop) as its own polygon of `type: 'internal'`
with a `parent_id` and no class. It is forwarded to `spheroid_disintegration`
and `neurite_soma` but their polygoniser keeps one outer contour per region, so
no hole is ever emitted.

All inference is serialised behind one loader-wide lock on a single-slot
executor.

### `POST /api/v1/batch-segment`

Batch form of the above, built on `predict_batch`, which has only the generic
(ImageNet-normalised, single sigmoid) path and no per-model dispatch — so it
is meaningful for the five spheroid models only. The backend does not use it.

---

## Microtubule tracking and kymographs

### `POST /api/v1/track`

Assigns cross-frame `trackId`s by Hungarian matching on **geometry**: symmetric
curve distance, with common-mode stage drift removed by a normal-flow
least-squares fit.

There is **no hard rejection gate**. `CURVE_SCALE_PX` is a saturation _scale_,
not a threshold — a distant pair is expensive, never impossible. The only
infinite cost is a centerline too degenerate to compare (fewer than two points),
where a distance of zero would otherwise read as a perfect match.

The request still accepts `embedding` and `emb_template_alpha`; both are
**accepted and ignored**, because rows written by the previous model version
still carry an embedding and strict validation would reject them. The response's
`corrupt_count` and `degraded` fields are pinned to `0` and `false` for the same
compatibility reason.

`GATE_MIN_OVERLAP`, `OVERLAP_TOL` and `overlap_fraction` still exist in
`api/mt_geometry_cost.py` and are tested, but **the tracker does not import
them** — as a hard gate, overlap fragmented tracks 3.14×, and folded in as a
cost term it measured no better while doubling wall-clock. Treat them as a
geometry library, not as tuning knobs: changing them changes nothing.

### `POST /api/v1/kymograph`

Builds a space × time matrix by sampling the given centerline through a stack of
per-frame channel PNGs, opened at native bit depth. Sampling is
arc-length-uniform with nearest-neighbour interpolation and reads 0 outside the
frame. Optionally detects trajectories and returns velocity metrics, and can
render the raw intensity profile per frame instead.

Trajectory detection is **KymoButler** (Jakobs, Dimitracopoulos & Franze, eLife
2019), vendored at `backend/segmentation/models/kymobutler`. A U-Net segments
the whole (t, x) plane at once, so a crossing is a shape it was trained on
rather than a frame-to-frame association guess; `kymobutler_mode` picks between
`bidirectional` (default — a decision module resolves every remaining fork) and
`unidirectional`. The response shape is unchanged from the DoG-blob detector it
replaced: same per-track fields, same units (kymograph **columns** per frame,
which the Node backend scales by px-per-column before applying the µm
calibration). Detection failure — including weights that were never staged —
degrades to `tracks: []` plus `velocity_error`, never a 500.

### `POST /api/v1/kymograph/batch`

`{ "items": [ <KymographRequest>, ... ] }` → `{ "results": [ { "kymograph": … }
| { "error": … }, ... ] }`, one result per item, in request order, up to 64
items.

A **transport, not a second renderer**: the items are ordinary
`/api/v1/kymograph` bodies and each result is byte-identical to what that
endpoint returns for the same body. What changes is the loop order — the
endpoint decodes each distinct frame ONCE (keyed on its stat identity) and
samples every polyline that wants a row from it, instead of decoding the whole
stack per polyline.

That is what the MT export needs. It builds one kymograph per (microtubule ×
channel) over one container's frames, so a 300-frame, 3-channel, 60-microtubule
container did 54 000 decodes of 900 distinct files; the sampled-row cache cannot
help, because every job carries a different polyline and so a different key (a
real production export, 2026-09-01: 61 requests, **0** frames from cache, 69
decoded). Measured on 60 microtubules × 300 frames of container 4972cad8:
186.2 s and 18 000 decodes → **13.2 s and 300**.

Memory does not scale with the item count — the frames resident stay one per
decode thread — so the bound on `items` exists only because the **response** is
O(items). Errors are per item: one polyline with a single vertex, or a channel
missing one frame PNG, costs that microtubule its kymograph and nothing else.

**Deploy the ML service before any backend that calls this.** The route does not
exist on an older `ml` container, and the export's kymograph stage degrades to
"no kymograph output" on a 404.

---

## Microtubule measurement

### `POST /api/v1/mt-metrics`

Per-microtubule, per-channel intensity. Given the original ND2/TIFF path and the
centerlines, it reopens the **raw file** at full bit depth and measures a band
along each centerline plus a background ring that excludes every other
microtubule. Channels added after upload are read from their per-frame PNGs
instead, since that is the only place their pixels exist.

A channel the microscope refreshed only every N-th frame leaves the timepoints
in between as a constant fill in the raw file, so the caller passes
`sparse_fill` (gap frame → the frame it reads from) and those frames are
measured on the plane that stands in for them rather than on the fill. Every row
reports `source_frame_index`, the frame its intensity actually came from, so a
repeat is never mistaken for an independent observation; the whole-video channel
totals count only the frames that exposed the channel.

### `POST /api/v1/mt-background-rois`

Returns the exact background region each measurement used, as an ImageJ
composite ROI — the vicinity ring with all microtubules cut out. Used to embed
the `_bg` ROIs in the exported `RoiSet.zip`. A **missing key is authoritative**:
no ROI is emitted rather than a misleading one.

Both are subject to a **workload-scaled timeout** rather than a fixed one; a
previously hard-coded five-minute limit silently degraded real exports to
geometry-only sheets.

---

## Neurite measurement

### `POST /api/v1/neurite-intensity`

Intensity of the soma and neurite classes of one frame, one row per
(channel, class). Called by the neurite export for its `Intensity` table; it
runs no segmentation — it is handed the stored polygons. JSON body:

| Field              | Type                   | Notes                                                                     |
| ------------------ | ---------------------- | ------------------------------------------------------------------------- |
| `frame`            | string                 | Echoed back; the caller's label for the frame                             |
| `width`, `height`  | int                    | Size of the frame the polygons were drawn on                              |
| `soma_polygons`    | polygons               | Each a ring of points, with optional `holes`                              |
| `neurite_polygons` | polygons               | Same shape                                                                |
| `channels`         | `[{ "name", "path" }]` | 1–16 channels: a label, and the path of that channel's image of the frame |

Response: `{ "frame": …, "rows": [ … ] }`, each row carrying `channel`,
`class`, `area_px`, `mean_intensity`, `median_intensity`, `std_intensity`,
`sum_intensity`, `background_median`, `background_area_px` and
`mean_minus_background`.

- Each class is the union of its polygons with holes subtracted; soma wins
  where the two overlap. Background is the median of the pixels more than 5 px
  from any polygon.
- Channels are read at their native bit depth. A channel file that is a genuine
  colour image is a 400 rather than an average of its planes, and so is one
  whose size differs from `width` × `height`; a missing file is a 404.
- CPU work on a one-slot executor, like `/kymograph`, so it does not block
  `/health`.

The definitions are in [Metrics](../reference/metrics.md#neurite-projects).

---

## Metrics

Mounted at `/api` (no `v1`):

| Method | Path                           | Purpose                                    |
| ------ | ------------------------------ | ------------------------------------------ |
| POST   | `/api/calculate-metrics`       | Shape metrics for a set of polygons        |
| POST   | `/api/batch-calculate-metrics` | Batch form                                 |
| POST   | `/api/disintegration-index`    | The core-anchored DI and its panel metrics |
| GET    | `/api/metrics-info`            | Metric definitions                         |

`disintegration-index` returns `reference: "no_core"` with `di: 0.0` as an **N/A
sentinel** when no usable core is supplied. Callers must render that as N/A,
never as a computed zero. There is deliberately no equivalent-disk fallback.
See [Metrics](../reference/metrics.md#disintegration-index-di).

---

## FRAP targeting

`POST /api/v1/frap/targets` — synchronous segment-and-select for a microscope
control call.

## GPU monitoring

Under `/api/v1/monitoring`: `gpu/status`, `gpu/summary`, `gpu/batch-metrics`,
`gpu/memory-pressure`, and the actions `gpu/export-metrics` and
`gpu/clear-cache`.

---

## Not mounted

`api/cancel.py` defines `/api/v1/cancel/{job_id}`, `/api/v1/jobs/active` and
`/api/v1/cancel-all`, but **its router is not included in the application**.
Those endpoints do not exist at runtime.

---

## The Automated Essays worker

A separate FastAPI process (`backend/essays`), built from the ML image so it
inherits the identical model stack. Reachable only on the internal network and
loopback, **with no authentication layer**.

| Method | Path               | Purpose                                         |
| ------ | ------------------ | ----------------------------------------------- |
| GET    | `/health`          | `{ status, queued, gpu, gpuFreeMib }`           |
| POST   | `/process`         | Accept a job; returns 202 with a queue position |
| GET    | `/status/{job_id}` | Job status                                      |

A single worker thread drains an in-process queue, so exactly one essays job
runs at a time and the queue does not survive a restart. Progress is handed to
the Node backend through an atomically written `status.json` that the backend
reconciles on a 5-second timer. See
[Automated Essays](../guides/automated-essays.md).

## Related

- [ML service architecture](../architecture/ml-service.md)
- [ML models](../reference/ml-models.md)
- [REST API](README.md)
