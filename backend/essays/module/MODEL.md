# Microtubule v7 — segmentation model internals

Reference for the bundled segmentation model. For the **batch well-recording
analysis** (the normal entry point) see [`README.md`](README.md); this document
covers the model itself and the single-frame `infer.py` CLI.

Given a single 2D microscopy frame (TIRF / IRM) it detects individual
microtubules as **open polylines** (centerlines) plus a per-pixel 32-d
embedding usable for cross-frame tracking.

The pipeline is **DINOv3-L → DPT decoder → PySOAX**:

| Stage | What it does |
| ----- | ------------ |
| **DINOv3-L ViT/16** | Vision-transformer backbone. |
| **DPT decoder + 2 heads** | Dense prediction: a *seed-probability* map + a 32-d L2-normalized *embedding* map. |
| **PySOAX** | Pure-Python Stretching Open Active Contours: grows snakes from the seed mask into per-instance centerlines; the embedding disambiguates crossings. |

No GPU is required (CPU works, just slower). No compiled/native dependency —
PySOAX is pure NumPy/SciPy/scikit-image.

---

## Backbone: offline (default here) vs. online

The v7 checkpoint `weights/microtubule_v7.pt` **contains the full DINOv3-L
backbone weights**. Two ways to construct the backbone:

* **Offline (default in this repo).** Set `MT_BACKBONE_CONFIG` to the bundled
  `config/dinov3_vitl16` directory; the backbone is built from that config with
  random weights and then fully overwritten by the checkpoint. **No HuggingFace
  token, no download, no network.** `evaluate.py` does this automatically.
* **Online.** Without `MT_BACKBONE_CONFIG`, the model calls
  `AutoModel.from_pretrained("facebook/dinov3-vitl16-pretrain-lvd1689m")`, which
  downloads the **gated** DINOv3 backbone from HuggingFace and needs `HF_TOKEN`
  set (or `~/.cache/huggingface/token`) plus acceptance of the model's license.
  Pass `--online-backbone` to `evaluate.py` to force this path.

Both paths yield identical results (verified: same MT count on a fixed frame).

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
| `--weights` | `weights/microtubule_v7.pt` | Checkpoint path. |
| `--output` | `<image>.mt.json` | Output JSON path. |
| `--overlay` | *(off)* | Render centerlines over the frame to this PNG. |
| `--device` | `auto` | `auto` = CUDA if present else CPU. `cpu` / `cuda` / `mps`. |
| `--threshold` | `0.5` | Seed-probability threshold for PySOAX initialization. |
| `--frame` | `0` | Frame index for multi-page TIFF / ND2 stacks. |

> **Input intensity:** do **not** pre-scale your images. The model
> percentile-normalizes (1st/99.5th) internally and expects raw 8-/16-bit
> intensities.

`infer.py` reads ND2 stacks by flattening all `(P, C)` frames and selecting by
`--frame`; it is **not** channel-aware. For channel-correct, per-position
measurement of well recordings, use `evaluate.py` instead.

---

## Output format (`infer.py`)

```jsonc
{
  "model_used": "microtubule",
  "threshold_used": 0.5,
  "image_size": { "width": 1024, "height": 1024 },
  "polygons": [],
  "polylines": [
    {
      "id": "polyline_1",
      "points": [ { "x": 12.0, "y": 34.0 }, … ],  // (x=col, y=row) px
      "class": "microtubule",
      "geometry": "polyline",
      "instanceId": "mt_1a2b3c4d",
      "vertices_count": 57,
      "_embedding": "<base64 float16 (M,32)>",
      "_embedding_dim": 32
    }
  ],
  "processing_info": { "device": "cpu", "num_polylines": 70, … }
}
```

### Library use

```python
from microtubule import MicrotubuleModel    # run from the repo root
model = MicrotubuleModel().load_weights("weights/microtubule_v7.pt", "cpu")
out = model.predict(frame_2d, seed_threshold=0.5)
out["centerlines_rc"]      # list of (M_i, 2) float64 (row, col) px
out["seed_prob"]           # (H, W) float32
out["embedding_samples"]   # list of (M_i, 32) float16
```

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `weights_only` load warning | Expected — the checkpoint embeds a small config object; the loader falls back to `weights_only=False`. Gate with `ALLOW_UNSAFE_WEIGHTS=0` to refuse. |
| `OSError: ... is a gated repo` / 401 | Only happens on the **online** backbone path; use the default offline path, or set `HF_TOKEN` and accept the DINOv3 license. |
| `ModuleNotFoundError: synth_irm` / `pysoax` | The `microtubule/` dir was moved/flattened — keep it intact and run from the repo root. |
| MPS error / odd results on Mac | Use `--device cpu`; `mps` is experimental for this model. |

## Provenance

Model microtubule **v7** (DINOv3-L + DPT, 32-d embedding head), checkpoint
`microtubule_v7.pt`. PySOAX hyperparameters are Optuna-tuned
(`PYSOAX_PARAMS_DEFAULT` in `microtubule/segment_mt.py`). Extracted from
`cell-segmentation-hub`.
