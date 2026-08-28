# ML service architecture

Python + FastAPI + PyTorch. Loads models, runs inference, tracks microtubules
across frames, builds kymographs and measures intensities. Its only client is
the Node backend.

---

## Layout of `backend/segmentation/`

| Path                       | Contains                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `api/main.py`              | The FastAPI app: middleware, exception handlers, router mounting, Prometheus metrics |
| `api/routes.py`            | `/segment`, `/batch-segment`, `/models`, `/status`, `/health`                        |
| `api/tracker_kymograph.py` | `/track` and `/kymograph`                                                            |
| `api/mt_geometry_cost.py`  | The geometric matching cost used by the tracker                                      |
| `api/mt_metrics.py`        | `/mt-metrics` and `/mt-background-rois`                                              |
| `api/metrics_endpoint.py`  | Shape metrics and the disintegration index                                           |
| `api/monitoring.py`        | GPU status and memory endpoints                                                      |
| `api/frap_targets.py`      | FRAP target selection                                                                |
| `ml/model_loader.py`       | The model catalogue, loading, caching and unloading                                  |
| `models/`                  | One wrapper per model                                                                |
| `models/microtubule/`      | The v5H network, its instancer and its parameters                                    |
| `models/mt_measure.py`     | Band/ring rasterisation and ImageJ-convention statistics                             |
| `weights/`                 | Checkpoints; not in the repository                                                   |

Router prefixes: most are mounted under `/api/v1`; the metrics router carries
its own `/api` prefix. Endpoint list: [ML service API](../api/ml-service.md).

**`api/cancel.py` is not mounted.** Its endpoints do not exist at runtime.

---

## Two files that must stay single copies

**`models/microtubule/`** is imported by _both_ the ML service and the
[Automated Essays](../guides/automated-essays.md) worker, which resolves it on
its path at image build time rather than inheriting it from the ML image — so a
stale ML image cannot make the batch run older model code. Before this
unification the two copies drifted in opposite directions for months and neither
side received the other's fixes.

**`models/mt_measure.py`** is the only implementation of the microtubule
band/ring measurement, imported by the project export and the essays batch
alike. Before it existed they had drifted: band area by −7.8 %…+26.5 %, ring
area by 2.2×, and the **net signal by a median of +9.9 % (max +33.2 %)**.

Note that `mt_measure.py` sits **beside** the `microtubule` package, not inside
it: importing that package loads the model wrapper and therefore torch, which
measuring pixels does not need — and which would make the export's tests skip on
a machine with no GPU driver.

**Do not re-introduce a second copy of either.** Tests assert the sharing.

---

## Model loading

`ModelLoader.AVAILABLE_MODELS` maps each model id to its class and checkpoint
path. Models are loaded on first use, cached, reference-counted and unloaded
least-recently-used when memory is tight.

A wrapper whose optional dependency is missing resolves to `None` and the model
simply **does not appear in the catalogue** rather than failing at inference
time. That is why SegFormer disappears without `transformers`, Mamba-UNet
without the `mamba_ssm`/`causal-conv1d` CUDA kernels, the disintegration and
microcapsule models without `segmentation-models-pytorch`, and Neurite / Soma
without its own wrapper import.

Model identity is mirrored in three registries (Python, backend, frontend) and a
parity script fails CI on drift. Adding a model touches roughly nine files
across the stack.

---

## GPU behaviour

CUDA when available, CPU otherwise. Two things make that less simple than it
sounds:

- **A running container can lose its GPU.** Access is granted through
  `device_cgroup_rules`, and any cgroup re-apply — `docker update`, a systemd
  daemon reload — can silently strip the allowlist from a _running_ container.
  `torch.cuda.is_available()` keeps returning `True` because the CUDA context
  already exists in-process, so the health endpoint also **opens
  `/dev/nvidiactl`**: `EPERM` on a mode-0666 node is the signature. Recreating
  the container fixes it.
- **A CPU fallback is silent.** The loader logs an error when
  `NVIDIA_VISIBLE_DEVICES` is set but CUDA is unavailable, because otherwise
  segmentation simply becomes very slow with no visible change.

Never hold a CUDA exception object across a retry: the traceback pins the
forward pass's tensors and defeats the memory release you are retrying for.
`gc.collect()` is required, not optional.

See [GPU configuration](../GPU-CONFIGURATION.md) and
[GPU fallback behaviour](../GPU-FALLBACK-BEHAVIOR.md).

---

## Concurrency

The service runs a **single uvicorn worker**. Concurrent requests queue rather
than parallelise, which is why the export path serialises its ML calls behind
one semaphore. Microtubule inference is additionally serialised behind its own
lock.

Sync FastAPI routes execute on uvicorn's worker thread pool, so blocking inside
one blocks that thread, not the event loop.

---

## Microtubule specifics

- **v5H is IRM-only** and applies its own fitted foreground cut of 0.97; the
  `/segment` route passes no threshold for it. Lowering the threshold does not
  help — see
  [ML models](../reference/ml-models.md#microtubule--microtubule-v5h) for the
  measurement that settled it.
- **Tracking is geometric.** No embeddings; symmetric curve distance with
  normal-flow drift removal. There is **no hard gate** — `CURVE_SCALE_PX` is a
  saturation scale, and the only infinite cost is a centerline too degenerate to
  compare. `GATE_MIN_OVERLAP` / `OVERLAP_TOL` / `overlap_fraction` remain in
  `mt_geometry_cost.py` and are tested, but **the tracker does not import
  them**; tuning them changes nothing.
- The checkpoint is a complete `state_dict`, so **nothing is downloaded at run
  time**: no HuggingFace token and no network access are needed for microtubule
  work. (SegFormer and sperm still call `from_pretrained`, so their cache mount
  is load-bearing.)

---

## Testing

Python tests run inside a GPU-capable container: `make test-ml`. A GPU-free
subset runs in `make ci` via `make test-py`. See the
[testing guide](../testing-guide.md).

## Related

- [ML service API](../api/ml-service.md)
- [ML models](../reference/ml-models.md)
- [Model weights setup](../MODEL_WEIGHTS_SETUP.md)
- [Architecture overview](README.md)
