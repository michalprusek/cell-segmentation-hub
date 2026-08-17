# Microtubule v5H — segmentation model internals

Reference for the bundled segmentation model. For the **batch well-recording
analysis** (the normal entry point) see [`README.md`](README.md); this document
covers the model itself and the single-frame `infer.py` CLI.

Given a single 2D microscopy frame (IRM / TIRF) it detects individual
microtubules as **open polylines** (centerlines).

The pipeline is **ResEnc-M → threshold → curvature-bounded instancer**:

| Stage | What it does |
| ----- | ------------ |
| **nnU-Net ResEnc-M** | 8 stages, features 32→512, seven successive /2 downsamplings so the bottleneck's receptive field spans the whole 512 px tile. That matters for filaments: evidence has to be integrated *along* a microtubule. Predicts ONE foreground channel. |
| **Instancer** | Contracts junction clusters, fits tangents over a window, and resolves each junction by a **min-cost perfect matching** over its arms with a priced "leave this arm open" option. No learned weights. |

Every join is constrained by

    κ = |dθ/ds| ≤ 0.25 rad/px

as a **hard** constraint — derived, not tuned: just above the 0.239 rad/px
maximum measured over 957 human-annotated microtubules at an 8 px baseline.
Microtubules bend; they do not kink.

No GPU is required (CPU works, just slower). No compiled/native dependency —
the instancer is pure NumPy/SciPy/scikit-image/networkx.

**No human annotation enters either stage.** The network is trained purely on
synthetic frames; the instancer's hyperparameters are fitted on synthetic data
with exact ground truth.

---

## Nothing is downloaded at run time

`microtubule_v5h.pth` is a complete `state_dict` — a bare `OrderedDict` of 1364
tensors and no other payload. There is no frozen backbone to fetch, so:

* **no `HF_TOKEN`**, no HuggingFace account, no license acceptance;
* **no network access** at model load, so the worker runs on an isolated host;
* nothing host-specific to unpickle, so the checkpoint loads on Windows as well
  as Linux (see `tests/test_checkpoint_portability.py` for why that sentence is
  worth writing down).

`dynamic_network_architectures`, which `net.py` builds the network from, is
**vendored** alongside the model code because the container does not have it
installed.

This replaced the v7 model (DINOv3-L + DPT + PySOAX) on 2026-08-17. **Numbers
produced before that date are not comparable with later ones** — it is a
different network with a different postprocessor.

---

## Single-frame CLI (`infer.py`)

```bash
# JSON next to the input
python infer.py --image path/to/frame.tif

# overlay preview + explicit output
python infer.py --image frame.png --output result.json --overlay overlay.png

# multi-page TIFF / ND2 stack: pick the frame
python infer.py --image stack.nd2 --frame 12

python infer.py --image frame.tif --device cpu        # CPU (default on Mac)
```

| Flag | Default | Meaning |
| ---- | ------- | ------- |
| `--image` | *(required)* | Input frame: PNG/JPG/BMP/TIFF/ND2/NPY. |
| `--weights` | auto-detected (see README §4) | Checkpoint path. |
| `--output` | `<image>.mt.json` | Output JSON path. |
| `--overlay` | *(off)* | Render centerlines over the frame to this PNG. |
| `--device` | `auto` | `auto` = CUDA if present else CPU. `cpu` / `cuda` / `mps`. |
| `--threshold` | `0.97` | Foreground probability threshold. Comes from the fitted params vector; the generic 0.5 used by other models would flood the instancer. |
| `--frame` | `0` | Frame index for multi-page TIFF / ND2 stacks. |

> **Input intensity:** do **not** pre-scale your images. The model
> percentile-normalizes (1st/99th) over the whole frame internally and expects
> raw 8-/16-bit intensities. An FOV-restricted normalization was tested
> upstream and lost on validation (0.412 vs 0.438) — do not "improve" it
> without re-measuring.

> **Working scale:** inference runs at 1.5× upscale internally because that is
> the scale the model was trained and evaluated at. Output coordinates are
> mapped back, so callers never see the 1.5×.

`infer.py` reads ND2 stacks by flattening all `(P, C)` frames and selecting by
`--frame`; it is **not** channel-aware. For channel-correct, per-position
measurement of well recordings, use `evaluate.py` instead.

---

## Output format (`infer.py`)

```jsonc
{
  "model_used": "microtubule",
  "threshold_used": 0.97,
  "image_size": { "width": 1024, "height": 1024 },
  "polygons": [],
  "polylines": [
    {
      "id": "polyline_1",
      "points": [ { "x": 12.0, "y": 34.0 }, … ],  // (x=col, y=row) px
      "class": "microtubule",
      "geometry": "polyline",
      "instanceId": "mt_1a2b3c4d",
      "vertices_count": 57
    }
  ],
  "processing_info": { "device": "cpu", "num_polylines": 65, … }
}
```

There is no `_embedding` field. v7 sampled a 32-d embedding at each centerline
pixel for cross-frame tracking; v5H emits one channel and the tracker matches
filaments **geometrically** (symmetric curve distance + overlap gate, with
common-mode stage drift removed). The output still feeds the tracking pipeline
unchanged.

### Library use

```python
from _mt_package import default_weights, ensure_on_path
ensure_on_path()                            # shared package from the ML service
from microtubule import MicrotubuleModel
model = MicrotubuleModel().load_weights(str(default_weights()), "cpu")
out = model.predict(frame_2d)               # seed_threshold=None -> fitted 0.97
out["centerlines_rc"]      # list of (M_i, 2) float64 (row, col) px
out["prob"]                # (H, W) float32 foreground probability
```

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `checkpoint has no decoder.seg_layers.*.weight` | The file is not a ResEnc U-Net checkpoint — you are probably still pointing at `microtubule_v7.pt`. Stage the v5H weights. |
| `ModuleNotFoundError: dynamic_network_architectures` | The vendored library under `microtubule/vendor/` was not copied. Keep the shared package intact at `backend/segmentation/models/microtubule`, or point `MT_PACKAGE_DIR` at its parent. |
| Far too many tiny instances | The threshold was overridden to a generic 0.5. Leave `--threshold` unset so the fitted 0.97 is used. |
| Shape mismatch inside the residual adds | The tile size was changed. It must stay divisible by 128 (seven /2 stages); 512 is correct, and v4b's 518 is not. |
| MPS error / odd results on Mac | Use `--device cpu`; `mps` is experimental for this model. |

## Provenance

Model microtubule **v5H** (nnU-Net ResEnc-M, binary head), checkpoint
`microtubule_v5h.pth`; instancer hyperparameters `params_v5h.json`, fitted on
stratified synthetic frames with exact ground truth and re-ranked on a disjoint
synthetic set. Packaged 2026-08-17.

**On the evidence for this model.** Against v4b, its predecessor, strict
centerline-F1 on the real MT-34 validation split was 0.4953 vs 0.4655:
**+0.030 [−0.024, +0.097], p = 0.331**. That is not separable from zero, and
MT-34 TEST was deliberately not scored. Run-to-run training noise was measured
at SD 0.0040, so the spread is not seed variation — the benchmark simply cannot
resolve an effect this size at 17 frames. Neither v4b nor v5H was ever
benchmarked against the v7 model that was previously deployed here.

## Honest limits

- Dense, crossing-heavy fields remain much harder than sparse ones. The same
  instancer on a *perfect* foreground reaches 0.92, so the loss is upstream of
  the instancing.
- The benchmark's ground truth is human-corrected model output: it carries an
  agreement bias and is demonstrably incomplete on sparse frames.
- Trained and evaluated on **IRM**. TIRF is supported by the architecture but
  not validated — which matches this worker, since it segments IRM and measures
  TIRF.
- Tuned for ~2 px-wide filaments at this project's native pixel size. Very
  different magnifications need `prob_thr` and `min_length` revisited.
