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

| Field          | Type   | Default | Notes                            |
| -------------- | ------ | ------- | -------------------------------- |
| `file`         | file   | —       | PNG, JPG, JPEG, TIFF, TIF or BMP |
| `model`        | string | `hrnet` | A model id from the registry     |
| `threshold`    | float  | `0.5`   | Constrained to 0.1–0.99          |
| `detect_holes` | bool   | `true`  | Detect internal contours         |

Returns the polygons, the model used, and timing.

**Four models ignore `threshold` on purpose**, because their cut is calibrated
differently from the generic one — or does not exist:

- **`sperm`** uses its own mask threshold (0.3) and score threshold (0.95);
- **`wound`** does its own grayscale pre-processing;
- **`microtubule`** applies the fitted `prob_thr` of 0.97 from its parameter
  file. The backend deliberately sends **no** threshold for it. Note that 0.97
  is not even expressible through some callers' constraints, so forwarding a
  user value would either cut a very confident foreground at 0.5 and flood the
  instancer with noise, or fail validation.
- **`neurite_soma`** has no threshold at all: background / neurite / soma is an
  **argmax** over averaged logits, so there is no probability cut to move. The
  request value is accepted and echoed in the response, and then ignored.

Microtubule and neurite/soma inference are additionally serialised behind a
lock.

### `POST /api/v1/batch-segment`

Batch form of the above.

### `GET /api/v1/segment/{task_id}`

Poll a previously submitted task.

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
