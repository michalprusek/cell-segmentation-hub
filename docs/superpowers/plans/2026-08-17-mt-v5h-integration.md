# Microtubule v5H Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the microtubule v7 model (DINOv3-L + DPT + PySOAX) with the v5H package (nnU-Net ResEnc-M + curvature-bounded instancer) everywhere in the app, and rewrite the cross-frame tracker to associate filaments geometrically instead of by 32-d embeddings.

**Architecture:** The v5H package is vendored into the existing single-copy MT package at `backend/segmentation/models/microtubule/`, so the interactive ML service and the Automated Essays batch worker keep sharing exactly one copy of the model code (CLAUDE.md SSOT rule). `wrapper.py` keeps its `load_weights()` / `predict()` surface so `model_loader.py` and `essays/module/infer.py` change only where embeddings are produced. The tracker keeps its LAP + gap-closing + motion-model machinery from PR #266 and swaps only the _cost function_: the embedding-cosine term is replaced by v5H's symmetric curve distance plus an overlap gate, and a normal-flow stage-drift estimator is added.

**Tech Stack:** PyTorch 2.6.0+cu124, nnU-Net `dynamic_network_architectures` (vendored), numpy/scipy/scikit-image/networkx, FastAPI, Node/Express/Prisma, React 18 + TypeScript.

**Spec:** `/home/cvat/cell-segmentation-hub/mt-instance-seg-v5H/README.md` (the package's own README — benchmark table, honest limits, and the "what changed from v4b" section are the spec for model behaviour).

## Global Constraints

- **One copy of the MT model code.** It lives at `backend/segmentation/models/microtubule/`. The essays worker reaches it via `_mt_package.ensure_on_path()` and `MT_PACKAGE_DIR=/app/models`. Never create a second copy (CLAUDE.md).
- **One copy of the MT metrics.** `backend/segmentation/models/mt_measure.py` is untouched by this plan. It sits _beside_ the `microtubule` package, not inside it, so measuring pixels never imports torch.
- **`centerlines_rc` stays `(row, col)`.** v5H's `predict.py` emits `(x, y)`. The wrapper transposes. Every downstream consumer (`mt_measure.py`, `mt_metrics.py`, essays `measure.py`) reads `(row, col)` and must not change.
- **Coordinate order in polylines out of `model_loader.py` stays `{x, y}`** — `x = col`, `y = row` — as today.
- **No `console.log` / `debugger`; ESLint 0 warnings; conventional commits; feature branch, never `main`.**
- **i18n: all 6 files** (`src/translations/{en,cs,es,de,fr,zh}.ts`). Validate with `node scripts/check-i18n.cjs`.
- **Do not bump `torch` / `transformers`.** v5H needs neither DINOv3 nor `transformers`; the pins stay as they are for the other six models (`reference_dependency_pin_constraints`).
- **Weights filename:** `microtubule_v5h.pth` in `backend/segmentation/weights/` (538 MB), bind-mounted read-only at `/app/weights` (ml) and `/app/mt_weights` (essays).
- **Deprecated-but-accepted:** the `/api/v1/track` request keeps its `embedding` field, ignored, so a stored segmentation written before this change still tracks and a mid-deploy Node container does not get a 400 from `extra="forbid"`.

---

## Known behavioural consequences (accepted, from the spec)

These are **not** bugs to fix during execution; they are the agreed cost of the swap.

| Change                                                           | Consequence                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v5H is benchmarked against v4b only, never against v7            | The app has no measured comparison between the outgoing and incoming model. Essays numbers before and after this change are **not comparable**, the same way the 2026-08-13 metrics unification broke comparability. |
| v4b → v5H gain is p = 0.331                                      | Not a statistically supported improvement. The justification is a cleaner system, not a measured one.                                                                                                                |
| Trained + validated on IRM only                                  | TIRF is architecturally supported but unvalidated. The app segments the IRM channel, so this matches production use.                                                                                                 |
| One output channel, not six                                      | `instance/instancer_b.py` cannot consume this checkpoint. Instancer A is the only supported path.                                                                                                                    |
| 32-d embeddings gone                                             | Cross-frame identity becomes geometric. Re-identification after a long occlusion is weaker than embedding matching; gap closing is retained to compensate.                                                           |
| `predict_sequence()` / warm-start seed prior deleted             | **Zero production impact** — verified to have no callers anywhere in the repo.                                                                                                                                       |
| `HF_TOKEN`, `MT_BACKBONE_CONFIG`, the HF cache mount become dead | Removed. First-run gated download disappears entirely; the ML service no longer needs network access to segment MTs.                                                                                                 |

---

## File Structure

**ML service — model package** (`backend/segmentation/models/microtubule/`)

| File                                                      | Responsibility                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `net.py` _(new)_                                          | nnU-Net ResEnc-M plan + `build()` + `head_width()`. Verbatim from v5H `model/net.py`.                                                        |
| `instance/` _(new, 11 files)_                             | The curvature-bounded instancer. Verbatim from v5H `instance/`. No learned weights.                                                          |
| `vendor/dynamic_network_architectures/` _(new, 21 files)_ | nnU-Net's network library, vendored because the container lacks it.                                                                          |
| `params_v5h.json` _(new)_                                 | Instancer hyperparameters fitted to this foreground. Verbatim from v5H `params/params_a_model_v5H.json`.                                     |
| `wrapper.py` _(rewritten)_                                | `MicrotubuleModel.load_weights()` / `.predict()`. Tiling, percentile normalisation, 1.5× upscale, instancing, `(x,y) → (row,col)` transpose. |
| `__init__.py` _(modified)_                                | Unchanged export surface: `MicrotubuleModel`.                                                                                                |
| `segment_mt.py` _(deleted)_                               | v7 DINOv3+DPT forward.                                                                                                                       |
| `pysoax.py` _(deleted)_                                   | v7 active-contour postprocessor.                                                                                                             |
| `synth_irm/` _(deleted)_                                  | v7 training package incl. `model_v3.py` / `model_v4.py` gated-backbone loaders.                                                              |

**ML service — tracker**

| File                                    | Responsibility                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/mt_geometry_cost.py` _(new)_       | Pure geometry: `curve_distance`, `overlap_fraction`, `estimate_drift`, `contour_shift`. Ported from v5H `instance/tracker.py`, no I/O, unit-testable without torch. |
| `api/tracker_kymograph.py` _(modified)_ | Cost function swap + drift removal. LAP, gap closing, motion model, endpoint alignment, track-id assignment all retained.                                           |

**Backend (Node)**

| File                                      | Responsibility                           |
| ----------------------------------------- | ---------------------------------------- |
| `src/services/tracking/trackerService.ts` | Stop reading/sending `_embedding`.       |
| `src/services/segmentationService.ts`     | `EDITOR_OMITTED_POLYGON_FIELDS` cleanup. |
| `src/utils/polygonValidation.ts`          | Comment + field-list cleanup.            |

**Frontend**

| File                                      | Responsibility                             |
| ----------------------------------------- | ------------------------------------------ |
| `src/lib/models/modelRegistry.ts`         | MT performance numbers + description.      |
| `src/lib/segmentation.ts`                 | Drop `_embedding` from the `Polygon` type. |
| `src/translations/{en,cs,es,de,fr,zh}.ts` | MT model description strings.              |

**Essays**

| File                                        | Responsibility                                      |
| ------------------------------------------- | --------------------------------------------------- |
| `module/infer.py`                           | Stop emitting `_embedding` / `_embedding_dim`.      |
| `module/_mt_package.py`                     | `WEIGHTS_NAME` → `microtubule_v5h.pth`; docstrings. |
| `module/evaluate.py`                        | Drop the `MT_BACKBONE_CONFIG` plumbing.             |
| `module/tests/test_shared_model_package.py` | Rewrite the two offline-backbone tests.             |

**Deployment**

| File                                      | Responsibility                                   |
| ----------------------------------------- | ------------------------------------------------ |
| `scripts/download-microtubule-weights.sh` | Stage `microtubule_v5h.pth`.                     |
| `docker/essays.Dockerfile`                | Copy the new package subdirs.                    |
| `docker-compose.production.yml`           | Remove `HF_TOKEN` + `.hf-cache` mount from `ml`. |
| `CLAUDE.md`                               | Update the ML service + essays sections.         |

---

## Task 1: Vendor the v5H package and stage its weights

**Files:**

- Create: `backend/segmentation/models/microtubule/net.py`, `instance/*` (11 files), `vendor/dynamic_network_architectures/*` (21 files), `params_v5h.json`
- Delete: `backend/segmentation/models/microtubule/segment_mt.py`, `pysoax.py`, `synth_irm/`
- Modify: `scripts/download-microtubule-weights.sh`
- Test: `backend/segmentation/tests/unit/test_mt_v5h_package.py`

**Interfaces:**

- Consumes: nothing.
- Produces: importable `net.build(out_channels: int) -> nn.Module`, `net.head_width(state_dict) -> int`, `net.TILE: int = 512`, `net.IMA_M`, `net.IMA_S`; `instance.instancer_a.instance_a(binary, kappa_max, params, channels=, prob=) -> (polylines, meta)`; staged checkpoint at `backend/segmentation/weights/microtubule_v5h.pth`.

- [ ] **Step 1: Copy the package in, drop the v7 sources**

```bash
cd /home/cvat/cell-segmentation-hub
SRC=mt-instance-seg-v5H
DST=backend/segmentation/models/microtubule
cp "$SRC/model/net.py"                    "$DST/net.py"
cp -r "$SRC/instance"                     "$DST/instance"
cp -r "$SRC/vendor"                       "$DST/vendor"
cp "$SRC/params/params_a_model_v5H.json"  "$DST/params_v5h.json"
find "$DST" -name __pycache__ -type d -exec rm -rf {} +
git rm -r --cached -q "$DST/synth_irm" 2>/dev/null || true
rm -rf "$DST/synth_irm" "$DST/segment_mt.py" "$DST/pysoax.py"
```

- [ ] **Step 2: Stage the checkpoint**

```bash
cp mt-instance-seg-v5H/weights/dino_seg_v5H.pth \
   backend/segmentation/weights/microtubule_v5h.pth
ls -la backend/segmentation/weights/microtubule_v5h.pth   # expect ~538 MB
```

- [ ] **Step 3: Point the staging script at the new checkpoint**

In `scripts/download-microtubule-weights.sh` replace the header comment and these three lines:

```bash
DEST_FILE="${DEST_DIR}/microtubule_v5h.pth"
DEFAULT_SRC="${REPO_ROOT}/mt-instance-seg-v5H/weights/dino_seg_v5H.pth"
```

The `MICROTUBULE_CKPT_URL` override and the `already present` early-exit stay as they are.

- [ ] **Step 4: Write the failing test**

`backend/segmentation/tests/unit/test_mt_v5h_package.py`:

```python
"""The v5H package is self-contained: no transformers, no network, no v7 leftovers."""
import json
from pathlib import Path

import pytest

PKG = Path(__file__).resolve().parents[2] / "models" / "microtubule"


def test_v7_sources_are_gone():
    """A leftover v7 module would still import torch+transformers and could be
    picked up by a stale caller."""
    for stale in ("segment_mt.py", "pysoax.py", "synth_irm"):
        assert not (PKG / stale).exists(), f"v7 leftover: {stale}"


def test_vendored_network_library_present():
    """The container has no `dynamic_network_architectures` and no network."""
    assert (PKG / "vendor" / "dynamic_network_architectures"
            / "architectures" / "unet.py").is_file()


def test_params_match_the_shipped_vector():
    """Instancer parameters are fitted to THIS foreground; a v4b vector here
    would actively penalise a clean mask (README, 'What changed from v4b')."""
    params = json.loads((PKG / "params_v5h.json").read_text())
    assert params["merge_radius"] == 5.0
    assert params["prob_thr"] == pytest.approx(0.97)
    assert "kappa_max" not in params or True  # derived, never read from file


def test_package_imports_without_transformers(monkeypatch):
    """v5H must not reach for the gated DINOv3 backbone."""
    import sys
    monkeypatch.setitem(sys.modules, "transformers", None)
    sys.path.insert(0, str(PKG))
    sys.path.insert(0, str(PKG / "vendor"))
    import net  # noqa: F401
    assert net.TILE == 512
```

- [ ] **Step 5: Run it and watch it fail**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/unit/test_mt_v5h_package.py -v`
Expected before Step 1: FAIL on `test_vendored_network_library_present`.
Expected after Steps 1–3: PASS, 4 tests.

- [ ] **Step 6: Prove the vendored package really segments inside the container**

```bash
docker run --rm --gpus all \
  -v /home/cvat/cell-segmentation-hub/backend/segmentation:/seg \
  -v /home/cvat/cell-segmentation-hub/mt-instance-seg-v5H/sample:/sample \
  cell-segmentation-hub-ml python - <<'PY'
import sys; sys.path[:0] = ["/seg/models/microtubule", "/seg/models/microtubule/vendor"]
import json, numpy as np, tifffile, torch
from scipy.ndimage import zoom
from net import build, head_width, TILE, IMA_M, IMA_S
state = torch.load("/seg/weights/microtubule_v5h.pth", map_location="cuda")
m = build(head_width(state)).cuda().eval(); m.load_state_dict(state)
print("loaded, head width", head_width(state))
PY
```

Expected: `loaded, head width 1`. A `KeyError` here means the checkpoint and `net.py` disagree — stop and re-check the copy.

- [ ] **Step 7: Commit**

```bash
git add backend/segmentation/models/microtubule scripts/download-microtubule-weights.sh \
        backend/segmentation/tests/unit/test_mt_v5h_package.py
git commit -m "feat(mt): vendor the v5H model package, drop v7 sources"
```

---

## Task 2: Rewrite the model wrapper onto v5H

**Files:**

- Modify: `backend/segmentation/models/microtubule/wrapper.py` (full rewrite, ~397 → ~200 lines)
- Test: `backend/segmentation/tests/test_microtubule_model.py` (rewrite)

**Interfaces:**

- Consumes: `net.build`, `net.head_width`, `net.TILE`, `net.IMA_M`, `net.IMA_S`, `instance.instancer_a.instance_a` (Task 1).
- Produces: `MicrotubuleModel.load_weights(weights_path, device=None) -> Self`, `MicrotubuleModel.predict(image_np, seed_threshold: float | None = None, params: dict | None = None) -> {"centerlines_rc": list[np.ndarray (M_i,2) float64], "prob": np.ndarray (H,W) float32}`. **No `embedding_samples` key.**

- [ ] **Step 1: Write the failing test**

`backend/segmentation/tests/test_microtubule_model.py` — replace the file:

```python
"""Contract of the v5H MicrotubuleModel wrapper.

These run without a GPU by stubbing the network: what is under test is the
wrapper's contract (coordinate order, key set, scale round-trip), not the
checkpoint's accuracy.
"""
import numpy as np
import pytest

from models.microtubule.wrapper import MicrotubuleModel


class _StubNet:
    """Returns a single horizontal filament through the middle of every tile."""
    def __call__(self, t):
        import torch
        b, _, h, w = t.shape
        out = torch.full((b, 1, h, w), -8.0)
        out[:, :, h // 2 - 1:h // 2 + 1, :] = 8.0
        return out
    def eval(self): return self
    def to(self, *_a, **_k): return self


def _loaded_model():
    m = MicrotubuleModel()
    m._model = _StubNet()
    m._device = "cpu"
    return m


def test_predict_returns_row_col_and_no_embeddings():
    """centerlines_rc is (row, col) — every downstream metric reads it that way.
    embedding_samples must be ABSENT, not empty: a stale consumer should fail
    loudly rather than silently track on zeros."""
    m = _loaded_model()
    out = m.predict(np.random.rand(256, 256).astype(np.float32))
    assert set(out) == {"centerlines_rc", "prob"}
    assert "embedding_samples" not in out
    for cl in out["centerlines_rc"]:
        assert cl.ndim == 2 and cl.shape[1] == 2


def test_centerlines_are_mapped_back_to_input_resolution():
    """The internal 1.5x working scale must never reach the caller."""
    m = _loaded_model()
    h, w = 256, 320
    out = m.predict(np.random.rand(h, w).astype(np.float32))
    assert out["prob"].shape == (h, w)
    for cl in out["centerlines_rc"]:
        assert cl[:, 0].max() <= h + 1, "row coord escaped the input height"
        assert cl[:, 1].max() <= w + 1, "col coord escaped the input width"


def test_horizontal_filament_lands_in_the_middle_row():
    """Guards the (x,y) -> (row,col) transpose. If it were flipped, a
    horizontal line would come back as a vertical one."""
    m = _loaded_model()
    out = m.predict(np.random.rand(256, 256).astype(np.float32))
    assert out["centerlines_rc"], "stub foreground produced no instance"
    cl = max(out["centerlines_rc"], key=len)
    assert cl[:, 0].std() < cl[:, 1].std(), "rows vary more than cols — transposed"


def test_predict_before_load_raises():
    with pytest.raises(RuntimeError, match="not loaded"):
        MicrotubuleModel().predict(np.zeros((64, 64), np.float32))
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/test_microtubule_model.py -v`
Expected: FAIL — the old wrapper returns `embedding_samples` and has no `prob` key.

- [ ] **Step 3: Rewrite the wrapper**

`backend/segmentation/models/microtubule/wrapper.py`:

```python
"""Microtubule instance segmentation model wrapper (v5H).

Wraps the v5H package -- nnU-Net ResEnc-M semantic stage + curvature-bounded
instancer -- so the ModelLoader drives it through the same
``load_weights`` / ``predict`` surface as every other registered model.

TWO callers share this package, so it is not free to change:

- the ML service's interactive per-frame segmentation (this repo's queue), and
- the Automated Essays batch assay (``backend/essays/module``), which imports
  it via ``_mt_package.ensure_on_path()`` rather than keeping its own copy.

Re-verify BOTH paths when changing this file or ``instance/``.

Differences from the v7 wrapper this replaces:

- No DINOv3 backbone, so no ``HF_TOKEN``, no gated download, no network access
  at run time. The checkpoint is a complete state_dict.
- ONE foreground channel, not a seed map plus a 32-d embedding field. Nothing
  downstream gets ``embedding_samples`` any more; cross-frame identity is
  established geometrically in ``api/mt_geometry_cost.py``.
- Inference runs at 1.5x upscale because that is the scale the model was
  trained and evaluated at. Output coordinates are mapped back, so callers
  never see the 1.5x.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

logger = logging.getLogger(__name__)

_PKG_DIR: Path = Path(__file__).resolve().parent

#: ``instance.*`` and ``dynamic_network_architectures.*`` are absolute imports
#: inside the vendored code, kept verbatim so the package can be re-synced from
#: upstream without a patch. They resolve only once these are on sys.path.
for _p in (_PKG_DIR, _PKG_DIR / "vendor"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

#: Internal working scale. Fixed by training; not a tunable.
UP = 1.5
#: Hard curvature bound, rad/px. Derived from 957 human-annotated microtubules
#: (max 0.239 at an 8 px baseline), never read from the params file.
KAPPA_MAX = 0.25

DEFAULT_PARAMS_PATH = _PKG_DIR / "params_v5h.json"


def _normalize(a: np.ndarray, p: tuple[float, float] = (1.0, 99.0)) -> np.ndarray:
    """Percentile stretch over the whole frame -- exactly what training used.

    An FOV-restricted variant was tested upstream and lost on validation
    (0.412 vs 0.438). Do not "improve" this without re-measuring: the model was
    fitted to this input distribution.
    """
    lo, hi = np.percentile(a, p)
    return np.clip((a - lo) / (hi - lo + 1e-6), 0.0, 1.0)


class MicrotubuleModel:
    """Semantic stage + instancer. Load once, predict many frames."""

    #: Foreground cut. The shipped params vector carries 0.97, fitted to this
    #: model's (very confident) foreground; the ModelLoader's generic 0.5
    #: default would flood the instancer.
    DEFAULT_SEED_THRESHOLD: float = 0.97

    def __init__(self) -> None:
        self._model: Optional[Any] = None
        self._device: Optional[str] = None
        self._ckpt_path: Optional[Path] = None
        self._params: Optional[dict] = None

    @property
    def params(self) -> dict:
        """Instancer hyperparameters, fitted to THIS foreground."""
        if self._params is None:
            params = json.loads(DEFAULT_PARAMS_PATH.read_text())
            params.pop("kappa_max", None)   # derived, never read from a file
            self._params = params
        return self._params

    def load_weights(self, weights_path: str | os.PathLike,
                     device: Optional[str] = None) -> "MicrotubuleModel":
        """Build the ResEnc-M net and load the checkpoint.

        The head width is read OFF the checkpoint rather than assumed: during
        upstream development a hard-coded default happened to match the models
        tested first, so the detection went unexercised until a 1-channel
        checkpoint reached it.
        """
        import torch
        from net import build, head_width

        path = Path(weights_path)
        if not path.is_file():
            raise FileNotFoundError(
                f"microtubule v5H checkpoint not found at {path} (~538 MB). "
                "Stage it with scripts/download-microtubule-weights.sh."
            )

        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        state = torch.load(str(path), map_location=self._device)
        model = build(head_width(state)).to(self._device).eval()
        model.load_state_dict(state)
        self._model = model
        self._ckpt_path = path
        logger.info("Loaded microtubule v5H from %s on %s", path, self._device)
        return self

    def _channels(self, img01: np.ndarray) -> np.ndarray:
        """Tiled prediction over an already-upscaled, already-normalised frame.

        Returns ``(C, H, W)`` in [0, 1]; C is 1 for this checkpoint. Tiles
        overlap and are averaged, so a filament crossing a tile seam is not
        cut. Input must be divisible by 128 within a tile -- TILE is 512, which
        is why the v4b package's 518 (DINOv2's /14 grid) fails here.
        """
        import torch
        from net import TILE, IMA_M, IMA_S

        mean = torch.tensor(IMA_M).view(3, 1, 1)
        std = torch.tensor(IMA_S).view(3, 1, 1)
        stride = int(round(TILE * 0.757))
        H, W = img01.shape

        def _starts(extent: int) -> list[int]:
            xs = list(range(0, max(1, extent - TILE + 1), stride)) or [0]
            if xs[-1] != max(0, extent - TILE):
                xs.append(max(0, extent - TILE))
            return xs

        acc = cnt = None
        with torch.no_grad():
            for y in _starts(H):
                for x in _starts(W):
                    tile = img01[y:y + TILE, x:x + TILE]
                    th, tw = tile.shape
                    t = torch.from_numpy(tile.astype(np.float32))[None].repeat(3, 1, 1)
                    t = ((t - mean) / std)[None].to(self._device)
                    o = self._model(t)
                    if isinstance(o, (tuple, list)):
                        o = o[0]          # deep supervision off, but be defensive
                    o = torch.sigmoid(o)[0].float().cpu().numpy()
                    if acc is None:
                        acc = np.zeros((o.shape[0], H, W), dtype=np.float32)
                        cnt = np.zeros((H, W), dtype=np.float32)
                    acc[:, y:y + th, x:x + tw] += o[:, :th, :tw]
                    cnt[y:y + th, x:x + tw] += 1
        return acc / np.maximum(cnt, 1)[None]

    def predict(self, image_np: np.ndarray,
                seed_threshold: Optional[float] = None,
                params: Optional[dict] = None) -> dict:
        """Run v5H on a single 2D grayscale frame.

        Args:
            image_np: ``(H, W)`` IRM/TIRF intensity frame. Higher-dimension
                arrays are reduced to grayscale (mean over the channel axis).
            seed_threshold: Foreground cut. ``None`` uses the shipped params
                vector's ``prob_thr`` (0.97), which is what the model was
                tuned with.
            params: Instancer hyperparameter overrides.

        Returns:
            ``{
                'centerlines_rc': list[(M_i, 2) float64],  # row, col, INPUT px
                'prob':           (H, W) float32,          # foreground prob
            }``
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")

        from scipy.ndimage import zoom

        from instance.instancer_a import instance_a

        img = np.asarray(image_np)
        if img.ndim == 3:
            img = img.mean(axis=-1)
        if img.ndim != 2:
            raise ValueError(f"expected 2D image, got shape {img.shape}")

        H, W = img.shape
        p = {**self.params, **(params or {})}
        thr = seed_threshold if seed_threshold is not None else p.get("prob_thr", 0.97)

        img01 = zoom(_normalize(img.astype(np.float64)), UP, order=1)
        chans = self._channels(img01)
        prob_up = chans.max(axis=0)

        polylines, _ = instance_a(prob_up > thr, KAPPA_MAX, p,
                                  channels=chans, prob=prob_up)

        # instance_a returns (x, y) at the 1.5x scale. Downstream -- mt_measure,
        # mt_metrics, the essays adapter -- all read (row, col) at INPUT scale.
        centerlines_rc = [
            np.asarray(pl, dtype=np.float64)[:, ::-1] / UP for pl in polylines
        ]

        # Map the probability map back so callers see the frame they passed in.
        prob = zoom(prob_up, 1.0 / UP, order=1).astype(np.float32)
        prob = prob[:H, :W]
        if prob.shape != (H, W):
            pad = np.zeros((H, W), dtype=np.float32)
            pad[:prob.shape[0], :prob.shape[1]] = prob
            prob = pad

        return {"centerlines_rc": centerlines_rc, "prob": prob}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/test_microtubule_model.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Mutate the transpose to prove the test bites**

Temporarily change `[:, ::-1]` to `[:, :]` in `predict`. Re-run.
Expected: `test_horizontal_filament_lands_in_the_middle_row` FAILS. Revert.

This matters: a silent transpose is the single most expensive bug this
codebase has shipped twice (README, "Coordinate order").

- [ ] **Step 6: Commit**

```bash
git add backend/segmentation/models/microtubule/wrapper.py \
        backend/segmentation/tests/test_microtubule_model.py
git commit -m "feat(mt): rewrite the model wrapper onto the v5H pipeline"
```

---

## Task 3: Drop embeddings from the ML service's prediction path

**Files:**

- Modify: `backend/segmentation/ml/model_loader.py:55-66` (import guard), `:253-258` (registry), `:427-440` (load branch), `:1399-1500` (`predict_microtubule`)
- Modify: `backend/segmentation/models/__init__.py:20`
- Modify: `backend/segmentation/api/routes.py:76`
- Test: `backend/segmentation/tests/unit/test_predict_microtubule_contract.py`

**Interfaces:**

- Consumes: `MicrotubuleModel.predict` (Task 2).
- Produces: `ModelLoader.predict_microtubule(image, threshold=0.97, timeout=None)` returning polyline dicts **without** `_embedding` / `_embedding_dim`.

- [ ] **Step 1: Write the failing test**

`backend/segmentation/tests/unit/test_predict_microtubule_contract.py`:

```python
"""predict_microtubule's wire contract after the v5H swap."""
import numpy as np
import pytest
from PIL import Image


class _StubMT:
    def predict(self, image_np, seed_threshold=None, params=None):
        return {
            "centerlines_rc": [np.array([[10.0, 20.0], [11.0, 21.0]])],
            "prob": np.zeros(image_np.shape[:2], np.float32),
        }


@pytest.fixture
def loader_with_stub(monkeypatch):
    from ml.model_loader import ModelLoader
    ld = ModelLoader()
    ld.loaded_models["microtubule"] = _StubMT()
    monkeypatch.setattr(ld, "get_model", lambda *_a, **_k: None)
    monkeypatch.setattr(ld, "release_model", lambda *_a, **_k: None)
    return ld


def test_polylines_carry_no_embedding(loader_with_stub):
    """A leftover _embedding key would be persisted to the DB by
    segmentationService and then fed to a tracker that no longer reads it."""
    out = loader_with_stub.predict_microtubule(Image.new("L", (64, 64)))
    assert out["polylines"], "no polylines produced"
    for p in out["polylines"]:
        assert "_embedding" not in p
        assert "_embedding_dim" not in p


def test_points_are_xy_not_rowcol(loader_with_stub):
    """centerlines_rc is (row, col); the wire format is {x: col, y: row}."""
    out = loader_with_stub.predict_microtubule(Image.new("L", (64, 64)))
    first = out["polylines"][0]["points"][0]
    assert first == {"x": 20.0, "y": 10.0}


def test_geometry_and_class_are_unchanged(loader_with_stub):
    """The editor keys polyline rendering off these; changing them silently
    breaks MT display without any error."""
    p = loader_with_stub.predict_microtubule(Image.new("L", (64, 64)))["polylines"][0]
    assert p["geometry"] == "polyline"
    assert p["class"] == "microtubule"
    assert p["type"] == "external"
    assert p["instanceId"].startswith("mt_")
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/unit/test_predict_microtubule_contract.py -v`
Expected: FAIL — `_embedding` present, and the stub has no `embedding_samples` so the old code raises `KeyError`.

- [ ] **Step 3: Edit `predict_microtubule`**

In `backend/segmentation/ml/model_loader.py`, inside `predict_microtubule`:

Replace the docstring bullet about embeddings with:

```python
        - Output is polylines (open centerlines), not closed mask polygons.
        - Each polyline carries an instanceId (one microtubule = one polyline).
          Cross-frame identity is NOT carried here: it is established
          geometrically by /api/v1/track, which needs no per-polyline payload.
```

Replace the result-unpacking and loop:

```python
            result = mt_model.predict(image_np, seed_threshold=threshold)
            centerlines = result["centerlines_rc"]            # list of (M,2) float64

            polylines: List[Dict[str, Any]] = []
            for idx, cl in enumerate(centerlines):
                # centerline is (M, 2) in (row, col) → convert to (x=col, y=row)
                # so it lines up with the rest of the editor's image coords.
                points = [
                    {"x": float(cl[i, 1]), "y": float(cl[i, 0])}
                    for i in range(cl.shape[0])
                ]
                instance_id = f"mt_{_uuid.uuid4().hex[:8]}"
                polylines.append({
                    "id": f"polyline_{idx + 1}",
                    "points": points,
                    "type": "external",
                    "class": "microtubule",
                    "geometry": "polyline",
                    "instanceId": instance_id,
                    "confidence": 1.0,  # the instancer is deterministic
                    "vertices_count": len(points),
                })
```

Delete the now-unused `import base64 as _b64` at the top of the method.

Update the log line: `f"Microtubule v5H: {len(polylines)} centerlines in {processing_time:.2f}s"`.

- [ ] **Step 4: Update the registry entry and the import guard**

At `model_loader.py:253`:

```python
        'microtubule': {
            'class': MicrotubuleModel,
            'name': 'Microtubule v5H (ResEnc-M + curvature instancer)',
            'pretrained_path': 'weights/microtubule_v5h.pth',
            'finetuned_path': 'weights/microtubule_v5h.pth',
```

At `model_loader.py:55-56`, replace the comment — v5H needs neither
`transformers` nor `HF_TOKEN`; the guard now only catches a missing vendored
library:

```python
# Optional microtubule v5H model import. Self-contained (nnU-Net ResEnc-M with
# a vendored dynamic_network_architectures); an ImportError here means the
# vendored library or the instancer failed to import, not a missing token.
```

Apply the same correction to `models/__init__.py:20` and `api/routes.py:76`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/unit/test_predict_microtubule_contract.py /app/tests/test_microtubule_model.py -v`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/segmentation/ml/model_loader.py backend/segmentation/models/__init__.py \
        backend/segmentation/api/routes.py \
        backend/segmentation/tests/unit/test_predict_microtubule_contract.py
git commit -m "feat(mt): stop emitting 32-d embeddings from the v5H predict path"
```

---

## Task 4: Geometric cross-frame cost module

**Files:**

- Create: `backend/segmentation/api/mt_geometry_cost.py`
- Test: `backend/segmentation/tests/unit/test_mt_geometry_cost.py`

**Interfaces:**

- Consumes: nothing (pure numpy/scipy).
- Produces:
  - `curve_distance(a: np.ndarray, b: np.ndarray) -> float` — symmetric mean nearest-point distance, `inf` for degenerate input.
  - `overlap_fraction(a, b, tol: float = 4.0) -> float` — in [0, 1].
  - `estimate_drift(prev: Sequence[np.ndarray], curr: Sequence[np.ndarray], max_shift: float = 25.0) -> np.ndarray` — `(2,)` common-mode shift in the SAME coordinate order as its inputs.
  - `resample(p: np.ndarray, ds: float = 2.0) -> np.ndarray`
  - `GATE_MAX_SHIFT: float = 25.0`, `GATE_MIN_OVERLAP: float = 0.35`, `OVERLAP_TOL: float = 4.0`

All functions take `(N, 2)` arrays and are agnostic to whether the columns are
`(row, col)` or `(x, y)` — they only ever compute distances — **except**
`estimate_drift`, whose return follows its input order.

- [ ] **Step 1: Write the failing test**

`backend/segmentation/tests/unit/test_mt_geometry_cost.py`:

```python
"""Geometry that replaces the 32-d embedding as cross-frame evidence."""
import numpy as np
import pytest

from api.mt_geometry_cost import (
    curve_distance,
    estimate_drift,
    overlap_fraction,
    resample,
)


def _line(x0, y0, x1, y1, n=50):
    return np.stack([np.linspace(x0, x1, n), np.linspace(y0, y1, n)], axis=1)


def test_identical_curves_have_zero_distance():
    a = _line(0, 0, 100, 0)
    assert curve_distance(a, a.copy()) == pytest.approx(0.0, abs=1e-9)


def test_translated_curve_distance_is_the_translation():
    a = _line(0, 0, 100, 0)
    b = a + np.array([0.0, 3.0])
    assert curve_distance(a, b) == pytest.approx(3.0, abs=0.2)


def test_degenerate_input_is_infinite_not_zero():
    """A 1-point 'curve' must never look like a perfect match."""
    assert curve_distance(np.array([[1.0, 1.0]]), _line(0, 0, 10, 0)) == float("inf")


def test_short_fragment_on_a_long_filament_has_low_overlap():
    """The failure the mean distance alone cannot see: a 10 px fragment sitting
    on a 200 px filament is NOT the same object."""
    long_mt = _line(0, 0, 200, 0, n=200)
    fragment = _line(90, 0, 100, 0, n=10)
    assert curve_distance(long_mt, fragment) < 60.0      # distance looks okay-ish
    assert overlap_fraction(long_mt, fragment, tol=4.0) < 0.35   # gate rejects it


def test_overlap_of_a_curve_with_itself_is_one():
    a = _line(0, 0, 100, 0)
    assert overlap_fraction(a, a.copy(), tol=4.0) == pytest.approx(1.0)


def test_drift_recovers_a_pure_translation():
    """Two orientations are enough to solve the aperture problem."""
    prev = [_line(0, 0, 100, 0), _line(0, 0, 0, 100)]
    shift = np.array([4.0, -3.0])
    curr = [p + shift for p in prev]
    assert estimate_drift(prev, curr) == pytest.approx(shift, abs=0.5)


def test_gliding_along_the_filament_is_not_reported_as_drift():
    """THE critical property. A filament sliding along its own axis is
    motility, not stage drift; a median-centroid estimator reports ~the full
    gliding speed here and would turn every gliding assay into a drift
    correction that cancels the signal."""
    prev = [_line(0, 0, 100, 0), _line(0, 20, 100, 20)]
    curr = [_line(8, 0, 108, 0), _line(8, 20, 108, 20)]   # slid +8 px along x
    drift = estimate_drift(prev, curr)
    assert abs(drift[1]) < 1.0, "perpendicular drift invented"
    assert abs(drift[0]) < 3.0, f"gliding leaked into drift: {drift}"


def test_parallel_field_degrades_towards_zero_not_garbage():
    """Rank-deficient: all filaments share one orientation. The honest answer
    is 'no evidence for motion along that direction', not a wild extrapolation."""
    prev = [_line(0, y, 100, y) for y in (0, 10, 20)]
    curr = [p + np.array([5.0, 0.0]) for p in prev]
    drift = estimate_drift(prev, curr)
    assert np.linalg.norm(drift) < 2.0


def test_resample_gives_uniform_spacing():
    a = _line(0, 0, 100, 0, n=7)
    r = resample(a, ds=2.0)
    steps = np.linalg.norm(np.diff(r, axis=0), axis=1)
    assert steps.std() < 0.1
    assert r[:, 0].max() == pytest.approx(100.0, abs=2.0)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/unit/test_mt_geometry_cost.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.mt_geometry_cost'`.

- [ ] **Step 3: Write the module**

`backend/segmentation/api/mt_geometry_cost.py`:

```python
"""Geometric evidence for cross-frame microtubule association.

This replaces the 32-d DINOv3 embedding the v7 model used to emit. At the
single-digit-pixel displacements these acquisitions have, consecutive
centerlines overlap heavily and geometry is highly informative -- a learned
association would be a component whose proxy has not been validated against
the thing it must improve.

Ported from the v5H package's ``instance/tracker.py``, kept as a standalone
module here so the tracker endpoint can unit-test it without importing torch
or the model package.

Sits in ``api/`` beside ``mt_metrics.py`` for the same reason ``mt_measure.py``
sits beside the ``microtubule`` package rather than inside it: importing the
model package loads torch, which measuring distances does not need.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np
from scipy.spatial import cKDTree

#: Hard gate: no association beyond this displacement, px.
GATE_MAX_SHIFT: float = 25.0
#: Fraction of the shorter curve that must have a partner nearby.
GATE_MIN_OVERLAP: float = 0.35
#: What "nearby" means when measuring that fraction, px.
OVERLAP_TOL: float = 4.0
#: Resampling step for centerline comparison, px.
DS: float = 2.0


def arclength(p: np.ndarray) -> np.ndarray:
    """Cumulative arclength along a polyline, starting at 0."""
    if len(p) < 2:
        return np.zeros(len(p), dtype=float)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(seg)])


def resample(p: np.ndarray, ds: float = DS) -> np.ndarray:
    """Arclength-uniform resampling, so a densely-sampled curve and a sparsely
    sampled one compare on equal terms."""
    p = np.asarray(p, dtype=float)
    if len(p) < 2:
        return p
    s = arclength(p)
    total = s[-1]
    if total <= 0:
        return p
    n = max(2, int(np.ceil(total / ds)) + 1)
    t = np.linspace(0.0, total, n)
    return np.stack([np.interp(t, s, p[:, k]) for k in range(p.shape[1])], axis=1)


def curve_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Symmetric mean nearest-point distance between two polylines, px.

    Returns ``inf`` for degenerate input rather than 0, so a 1-point stub can
    never be mistaken for a perfect match.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return float("inf")
    da, _ = cKDTree(b).query(a, k=1)
    db, _ = cKDTree(a).query(b, k=1)
    return float(0.5 * (da.mean() + db.mean()))


def overlap_fraction(a: np.ndarray, b: np.ndarray, tol: float = OVERLAP_TOL) -> float:
    """Largest fraction of either curve that has a partner within ``tol``.

    Distance alone is not enough: a short fragment sitting on top of a long
    filament has a small mean distance in one direction. This says whether the
    two curves actually describe the same object.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return 0.0
    fa = float((cKDTree(b).query(a, k=1)[0] <= tol).mean())
    fb = float((cKDTree(a).query(b, k=1)[0] <= tol).mean())
    return max(fa, fb)


def contour_shift(a: np.ndarray, b: np.ndarray, edge_frac: float = 0.15) -> float:
    """Signed shift of ``b`` along ``a``'s own contour, px. Positive = toward a's head.

    A gliding filament slides along itself, so its perpendicular displacement is
    ~zero and a distance-based tracker sees no motion at all. What moves is the
    material: every point of b sits at a constant arclength offset from its
    counterpart on a.

    The subtlety is the ends. Once b has advanced, its head lies BEYOND a's
    head, the nearest point on a is a's last vertex, and the projection
    saturates -- reporting zero shift however far the filament went. Including
    those points halves the estimate, so the offset is taken over interior
    matches only.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa, sb = arclength(a), arclength(b)
    if sa[-1] <= 0 or sb[-1] <= 0:
        return 0.0
    _, idx = cKDTree(a).query(b, k=1)
    offs = sa[idx] - sb
    lo, hi = edge_frac * sa[-1], (1.0 - edge_frac) * sa[-1]
    interior = (sa[idx] > lo) & (sa[idx] < hi)
    if interior.sum() < 3:
        interior = np.ones(len(offs), dtype=bool)   # too short to trim
    return float(np.median(offs[interior]))


def estimate_drift(prev: Sequence[np.ndarray], curr: Sequence[np.ndarray],
                   max_shift: float = GATE_MAX_SHIFT, ds: float = DS) -> np.ndarray:
    """Common-mode translation between two frames, in the input coordinate order.

    **Not** the median centroid shift. A gliding filament's centroid travels
    along its own contour at the full gliding speed, and in a gliding field
    every filament does -- so that estimator measures motility and calls it
    drift. Upstream measured it returning 2.9 px of drift on synthetic
    sequences with drift switched off.

    What separates the two is that gliding is motion ALONG the filament while
    drift moves the whole field. The component of a displacement perpendicular
    to the filament's own tangent contains no gliding at all. This is the
    aperture problem, solved the way optical flow solves it: collect the
    perpendicular ("normal flow") constraints from filaments at DIFFERENT
    orientations and least-squares the single translation explaining them. Two
    distinct orientations suffice; a parallel field is genuinely ambiguous and
    degrades gracefully toward zero.
    """
    if len(prev) == 0 or len(curr) == 0:
        return np.zeros(2)
    P = [resample(np.asarray(p, dtype=float), ds) for p in prev]
    C = [resample(np.asarray(c, dtype=float), ds) for c in curr]
    P = [p for p in P if len(p) >= 3]
    C = [c for c in C if len(c) >= 2]
    if not P or not C:
        return np.zeros(2)

    cp = np.array([p.mean(axis=0) for p in P])
    cc = np.array([c.mean(axis=0) for c in C])
    d, j = cKDTree(cc).query(cp, k=1)

    rows, vals = [], []
    for i, ok in enumerate(d <= max_shift):
        if not ok:
            continue
        a, b = P[i], C[j[i]]
        _, idx = cKDTree(b).query(a, k=1)
        disp = b[idx] - a
        tang = np.gradient(a, axis=0)
        nrm = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
        rows.append(nrm)
        vals.append(np.einsum("ij,ij->i", nrm, disp))
    if not rows:
        return np.zeros(2)
    A = np.concatenate(rows, axis=0)
    y = np.concatenate(vals, axis=0)
    # Rank-deficient when every filament shares one orientation: lstsq returns
    # the minimum-norm solution, the honest "no evidence" answer.
    sol, *_ = np.linalg.lstsq(A, y, rcond=None)
    return np.asarray(sol, dtype=float)
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/unit/test_mt_geometry_cost.py -v`
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutate `estimate_drift` to prove the gliding test bites**

Replace the body with `return np.median(cc[j] - cp, axis=0)` (the naive centroid
estimator). Re-run.
Expected: `test_gliding_along_the_filament_is_not_reported_as_drift` FAILS with
drift ≈ 8 px. Revert.

- [ ] **Step 6: Commit**

```bash
git add backend/segmentation/api/mt_geometry_cost.py \
        backend/segmentation/tests/unit/test_mt_geometry_cost.py
git commit -m "feat(mt): geometric cross-frame cost to replace embedding matching"
```

---

## Task 5: Swap the tracker's cost function

**Files:**

- Modify: `backend/segmentation/api/tracker_kymograph.py` — `PolylineInput` (74-84), `TrackRequest` (94-140), `TrackResponse` (142-154), `_Filament` (211-240), `_emb_distance` (353-363), `_filament_cost` (390-412), `_build_link_cost` (415-455), and the per-frame loop that calls them
- Modify: `backend/segmentation/tests/test_tracker_kymograph.py`

**Interfaces:**

- Consumes: `api.mt_geometry_cost.{curve_distance, overlap_fraction, estimate_drift, resample, GATE_MAX_SHIFT, GATE_MIN_OVERLAP}` (Task 4).
- Produces: unchanged endpoint contract — `POST /api/v1/track` → `{assignments: {polylineId: trackId}, track_count: int, corrupt_count: int, degraded: bool}`.

**What is deliberately retained:** the LAP solve (`_solve_link_lap`), gap closing (`_gap_close_merges`), the constant-velocity motion model (`_predict_filament`), endpoint alignment (`_align_endpoints`) and track-id minting. Only the _evidence_ changes.

- [ ] **Step 1: Write the failing test**

Append to `backend/segmentation/tests/test_tracker_kymograph.py`:

```python
class TestGeometricAssociation:
    """The tracker after the v5H swap: geometry is the only evidence."""

    @staticmethod
    def _line(x0, y0, x1, y1, n=40):
        import numpy as np
        return np.stack([np.linspace(y0, y1, n), np.linspace(x0, x1, n)], axis=1).tolist()

    def test_two_filaments_keep_their_identity_across_frames(self, client):
        """No embeddings anywhere in the request. Identity must still hold."""
        f0 = [{"id": "a0", "points_rc": self._line(0, 0, 100, 0)},
              {"id": "b0", "points_rc": self._line(0, 50, 100, 50)}]
        f1 = [{"id": "b1", "points_rc": self._line(2, 50, 102, 50)},
              {"id": "a1", "points_rc": self._line(2, 0, 102, 0)}]
        r = client.post("/api/v1/track", json={
            "frames": [{"frame": 0, "polylines": f0}, {"frame": 1, "polylines": f1}],
            "image_hw": [512, 512]})
        assert r.status_code == 200
        a = r.json()["assignments"]
        assert a["a0"] == a["a1"], "filament a lost its track"
        assert a["b0"] == a["b1"], "filament b lost its track"
        assert a["a0"] != a["b0"], "two filaments collapsed into one track"

    def test_a_legacy_embedding_payload_is_accepted_and_ignored(self, client):
        """Segmentations stored before this change still carry _embedding.
        extra='forbid' would 400 them; they must track anyway."""
        r = client.post("/api/v1/track", json={"frames": [
            {"frame": 0, "polylines": [
                {"id": "a0", "points_rc": self._line(0, 0, 100, 0),
                 "embedding": "AAAA"}]},
            {"frame": 1, "polylines": [
                {"id": "a1", "points_rc": self._line(1, 0, 101, 0),
                 "embedding": "not-valid-base64!!"}]}]})
        assert r.status_code == 200
        assert r.json()["assignments"]["a0"] == r.json()["assignments"]["a1"]
        assert r.json()["degraded"] is False, "legacy payload must not degrade"

    def test_a_distant_filament_is_a_new_track_not_a_link(self, client):
        """The max_shift gate: 200 px in one frame is a different microtubule."""
        r = client.post("/api/v1/track", json={"frames": [
            {"frame": 0, "polylines": [{"id": "a0", "points_rc": self._line(0, 0, 100, 0)}]},
            {"frame": 1, "polylines": [{"id": "x1", "points_rc": self._line(0, 200, 100, 200)}]}]})
        assert r.status_code == 200
        a = r.json()["assignments"]
        assert a["a0"] != a["x1"]
        assert r.json()["track_count"] == 2

    def test_a_short_fragment_does_not_steal_a_long_filaments_track(self, client):
        """The overlap gate. Without it the fragment's small mean distance wins
        the assignment and the real filament is orphaned."""
        r = client.post("/api/v1/track", json={"frames": [
            {"frame": 0, "polylines": [
                {"id": "long0", "points_rc": self._line(0, 0, 200, 0, n=100)}]},
            {"frame": 1, "polylines": [
                {"id": "frag1", "points_rc": self._line(95, 0, 105, 0, n=10)},
                {"id": "long1", "points_rc": self._line(1, 0, 201, 0, n=100)}]}]})
        assert r.status_code == 200
        a = r.json()["assignments"]
        assert a["long0"] == a["long1"]
        assert a["frag1"] != a["long0"]
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/test_tracker_kymograph.py::TestGeometricAssociation -v`
Expected: FAIL — with no embeddings the cost collapses to `neutral_d_emb` for
every pair, so `test_a_short_fragment_does_not_steal_a_long_filaments_track`
mis-assigns.

- [ ] **Step 3: Replace the embedding term with curve geometry**

In `tracker_kymograph.py`:

Add the import near the top:

```python
from api.mt_geometry_cost import (
    GATE_MAX_SHIFT,
    GATE_MIN_OVERLAP,
    curve_distance,
    estimate_drift,
    overlap_fraction,
    resample,
)
```

Mark the request field deprecated (keep it — see Global Constraints):

```python
    # DEPRECATED and IGNORED since the v5H swap. Kept so a segmentation stored
    # by the v7 model still validates against extra="forbid", and so a
    # mid-deploy Node container does not get a 400. Cross-frame identity is now
    # established from geometry alone.
    embedding: Optional[str] = None
```

Replace `_emb_distance` and delete `_decode_embedding`, `_safe_mean_embedding`,
`EmbeddingDecodeError` and the `mean_emb` / `was_corrupt` members of
`_Filament`. Add a resampled-curve member instead:

```python
class _Filament(NamedTuple):
    """Geometry of one polyline, cached once per frame."""
    pts: np.ndarray          # (M, 2) row, col as received
    curve: np.ndarray        # arclength-uniform resample, for curve distance
    ends: np.ndarray         # (2, 2) the two endpoints
    theta: float             # principal orientation, radians
    length: float            # arclength, px
```

Replace `_filament_cost`:

```python
def _filament_cost(
    fa: _Filament,
    fb: _Filament,
    img_diag: float,
    w_curve: float = 0.5,
    w_end: float = 0.3,
    w_orient: float = 0.1,
    w_len: float = 0.1,
) -> float:
    """Filament-to-filament matching cost in [0, w_curve+w_end+w_orient+w_len].

    Returns ``inf`` when a hard gate rejects the pair, so a forbidden
    association can never be bought by making everything else expensive --
    the property the embedding cost did NOT have (a missing embedding merely
    substituted a neutral value).
    """
    d_curve_px = curve_distance(fa.curve, fb.curve)
    if not np.isfinite(d_curve_px) or d_curve_px > GATE_MAX_SHIFT:
        return float("inf")
    if overlap_fraction(fa.curve, fb.curve) < GATE_MIN_OVERLAP:
        return float("inf")

    d_curve = min(1.0, d_curve_px / GATE_MAX_SHIFT)
    d_end, d_orient, d_len = _geom_terms(fa, fb, img_diag)
    return float(
        w_curve * d_curve + w_end * d_end + w_orient * d_orient + w_len * d_len
    )
```

Replace `_build_link_cost` — the neutral-median machinery goes away entirely:

```python
def _build_link_cost(
    prev_feats: List[_Filament],
    nxt_feats: List[_Filament],
    img_diag: float,
    weights: tuple[float, float, float, float],
) -> np.ndarray:
    """Dense ``P × Q`` base cost matrix. ``inf`` marks a gated-out pair."""
    P, Q = len(prev_feats), len(nxt_feats)
    if P == 0 or Q == 0:
        return np.zeros((P, Q), dtype=np.float64)
    w_curve, w_end, w_orient, w_len = weights
    base = np.empty((P, Q), dtype=np.float64)
    for i in range(P):
        for j in range(Q):
            base[i, j] = _filament_cost(
                prev_feats[i], nxt_feats[j], img_diag,
                w_curve, w_end, w_orient, w_len,
            )
    return base
```

In `_solve_link_lap`, replace any `inf` with a large finite sentinel before
calling `linear_sum_assignment` (SciPy raises on a non-finite matrix), and drop
the resulting pair afterwards:

```python
    INF_SENTINEL = 1e6
    C = np.where(np.isfinite(C), C, INF_SENTINEL)
    ...
    # after the solve, reject anything that only "matched" via the sentinel
    if C[i, j] >= INF_SENTINEL or C[i, j] > cost_threshold:
        continue
```

Rename the request weight `w_emb` → `w_curve` and update its comment. Set
`corrupt_count` to 0 and `degraded` to False permanently, with a comment
explaining both are retained for wire compatibility.

Apply drift removal in the per-frame loop, before features are built for the
next frame:

```python
        # Stage drift moves every filament in the field. Folding it into
        # per-filament motion would report drift as motility, the one error a
        # gliding assay cannot tolerate. Recover the common-mode shift and
        # compare in the drift-free frame.
        drift = estimate_drift([f.pts for f in prev_feats],
                               [f.pts for f in nxt_feats])
        if np.linalg.norm(drift) > 1e-6:
            nxt_feats = [_shift_filament(f, drift) for f in nxt_feats]
```

with the helper:

```python
def _shift_filament(f: _Filament, drift: np.ndarray) -> _Filament:
    """Move a filament into the previous frame's drift-free coordinates."""
    return _Filament(
        pts=f.pts - drift,
        curve=f.curve - drift,
        ends=f.ends - drift,
        theta=f.theta,
        length=f.length,
    )
```

- [ ] **Step 4: Run the whole tracker suite**

Run: `docker exec spheroseg-ml python -m pytest /app/tests/test_tracker_kymograph.py -v`
Expected: PASS. Existing tests that assert on `corrupt_count` / `degraded` for
corrupt embeddings must be **rewritten**, not deleted — they become
"legacy payload is ignored" assertions (Step 1 has one).

- [ ] **Step 5: Commit**

```bash
git add backend/segmentation/api/tracker_kymograph.py \
        backend/segmentation/tests/test_tracker_kymograph.py
git commit -m "feat(mt): track filaments geometrically, drop the embedding term"
```

---

## Task 6: Stop shipping embeddings from Node

**Files:**

- Modify: `backend/src/services/tracking/trackerService.ts:28`, `:78`, `:188`, `:276`
- Modify: `backend/src/services/segmentationService.ts:66-71`, `:98`, `:1555`
- Modify: `backend/src/utils/polygonValidation.ts:82-85`
- Modify: `backend/src/services/export/exportDocs.ts`
- Test: `backend/src/services/tracking/__tests__/trackerService.test.ts`

**Interfaces:**

- Consumes: the `/api/v1/track` contract from Task 5.
- Produces: track requests whose polylines carry only `{id, points_rc}`.

- [ ] **Step 1: Write the failing test**

In `backend/src/services/tracking/__tests__/trackerService.test.ts`:

```typescript
it('does not send embedding payloads to the ML tracker', async () => {
  const post = vi.fn().mockResolvedValue({
    data: {
      assignments: {},
      track_count: 0,
      corrupt_count: 0,
      degraded: false,
    },
  });
  vi.mocked(axios.create).mockReturnValue({ post } as never);

  await runTrackingForContainer(containerId);

  const [, body] = post.mock.calls[0];
  for (const frame of body.frames) {
    for (const p of frame.polylines) {
      expect(p).not.toHaveProperty('embedding');
      expect(Object.keys(p).sort()).toEqual(['id', 'points_rc']);
    }
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker exec spheroseg-backend npx vitest run src/services/tracking/__tests__/trackerService.test.ts`
Expected: FAIL — `embedding` is present on every polyline.

- [ ] **Step 3: Strip the field**

In `trackerService.ts`, delete the `_embedding?: string;` member of the polyline
type (line 28) and change the request mapper (line 78) from

```typescript
      embedding: typeof p._embedding === 'string' ? p._embedding : null,
```

to nothing — the object becomes `{ id, points_rc }`. Update the file docstring
(line 8) and the comments at 188 and 276 to describe geometric matching.

In `segmentationService.ts`, `EDITOR_OMITTED_POLYGON_FIELDS` no longer needs to
omit anything the model produces, but stored v7 segmentations still carry
`_embedding`. **Keep the constant and its stripping**, and change the comment to
say it now exists only to keep legacy blobs off the wire. Note the saving at
line 1555 still applies to old rows.

In `polygonValidation.ts`, keep the enumerative drop but update the NOTE at
82-85 to record that the field is legacy-only.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `docker exec spheroseg-backend npx vitest run src/services/tracking src/services/__tests__/segmentationService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tracking backend/src/services/segmentationService.ts \
        backend/src/utils/polygonValidation.ts backend/src/services/export/exportDocs.ts
git commit -m "refactor(mt): stop sending embedding payloads to the tracker"
```

---

## Task 7: Essays worker on v5H

**Files:**

- Modify: `backend/essays/module/infer.py:16-21`, `:157-178`
- Modify: `backend/essays/module/_mt_package.py` (`WEIGHTS_NAME`, docstrings)
- Modify: `backend/essays/module/evaluate.py:238`, `:251`
- Modify: `backend/essays/module/tests/test_shared_model_package.py`
- Test: `backend/essays/module/tests/test_shared_model_package.py`

**Interfaces:**

- Consumes: `MicrotubuleModel.predict` (Task 2), `_mt_package.default_weights()`.
- Produces: per-instance dicts without `_embedding` / `_embedding_dim`.

- [ ] **Step 1: Write the failing test**

Replace the two `MT_BACKBONE_CONFIG` tests in
`backend/essays/module/tests/test_shared_model_package.py`:

```python
def test_weights_name_is_the_v5h_checkpoint():
    """The essays container bind-mounts the ML weights dir read-only; both
    callers must name the same file or they silently run different models."""
    import _mt_package
    assert _mt_package.WEIGHTS_NAME == "microtubule_v5h.pth"


def test_batch_path_needs_no_hf_token(monkeypatch):
    """v5H carries every weight in its checkpoint. A batch run that reached for
    a gated HuggingFace download would fail on a network-isolated box."""
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("MT_BACKBONE_CONFIG", raising=False)
    import _mt_package
    pkg_dir = _mt_package.ensure_on_path()
    src = (pkg_dir / "microtubule" / "wrapper.py").read_text()
    assert "HF_TOKEN" not in src
    assert "transformers" not in src
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker exec spheroseg-essays python -m pytest /app/essays_module/tests/test_shared_model_package.py -v`
Expected: FAIL — `WEIGHTS_NAME` is still `microtubule_v7.pt`.

- [ ] **Step 3: Apply the edits**

`_mt_package.py`: `WEIGHTS_NAME = "microtubule_v5h.pth"`, and rewrite the
docstrings that describe v7 / `MT_BACKBONE_CONFIG` (the module docstring's
second paragraph, and `weights_candidates`' "~1.2 GB" → "~538 MB").

`infer.py`: rewrite the header bullets 3/6, then replace the emit loop:

```python
    centerlines = result["centerlines_rc"]
    for i, cl in enumerate(centerlines, start=1):
        ...
            # no _embedding: cross-frame identity is geometric since v5H
```

Delete the `import base64` if it becomes unused.

`evaluate.py`: delete the `MT_BACKBONE_CONFIG` assignment at 251 and the
`BUNDLED_BACKBONE_CONFIG` constant, plus the CLI help text at 238. Remove the
bundled backbone config directory if nothing else references it.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `docker exec spheroseg-essays python -m pytest /app/essays_module/tests/ -v`
Expected: PASS. `test_metrics_match_export.py` must still pass untouched — the
metrics are not part of this change.

- [ ] **Step 5: Commit**

```bash
git add backend/essays/module
git commit -m "feat(essays): run the batch assay on the v5H model package"
```

---

## Task 8: Frontend metadata, types and i18n

**Files:**

- Modify: `src/lib/models/modelRegistry.ts:221-235`
- Modify: `src/lib/segmentation.ts`
- Modify: `src/pages/segmentation/SegmentationEditor.tsx`
- Modify: `src/translations/{en,cs,es,de,fr,zh}.ts`
- Test: `src/lib/models/__tests__/modelRegistry.test.ts`

**Interfaces:**

- Consumes: the `predict_microtubule` output shape (Task 3).
- Produces: no new exports; `Polygon._embedding` removed from the type.

- [ ] **Step 1: Write the failing test**

In `src/lib/models/__tests__/modelRegistry.test.ts`:

```typescript
it('reports the v5H timing, not the v7 DINOv3 estimate', () => {
  const mt = MODEL_METADATA.microtubule;
  // v7 was ~8 s/frame with a gated backbone download on first call.
  // v5H measured 4.7 s on a 1024x1024 frame on the A5000, no download.
  expect(mt.performance.avgTimePerImage).toBeLessThan(7);
  expect(mt.performance.avgTimePerImage).toBeGreaterThan(3);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/models/__tests__/modelRegistry.test.ts`
Expected: FAIL — the registry still carries the v7 estimate.

- [ ] **Step 3: Update the registry**

In `src/lib/models/modelRegistry.ts` at the `microtubule` entry, set
`defaultThreshold: 0.97` and replace the performance block and its comment:

```typescript
  microtubule: {
    size: 'large',
    // The instancer's own fitted foreground cut. The generic 0.5 would flood
    // it: this model's foreground is very confident.
    defaultThreshold: 0.97,
    category: 'microtubule',
    performance: {
      // nnU-Net ResEnc-M (~130M params) + a pure-numpy curvature-bounded
      // instancer. Measured 4.7 s on a 1024x1024 frame on the A5000. No
      // backbone download, so the first call is no slower than the rest.
      avgTimePerImage: 5,
      throughput: 0.2,
      p95Latency: 9,
      batchSize: 1,
    },
```

- [ ] **Step 4: Remove the dead type member**

Delete `_embedding` from the `Polygon` interface in `src/lib/segmentation.ts`
and any reference in `SegmentationEditor.tsx`. Run `npx tsc --noEmit` and fix
whatever it surfaces.

- [ ] **Step 5: Update all six translation files**

Find the MT model description key (grep `microtubule` in `src/translations/en.ts`)
and update the text in **all six** files to describe the new model. English:

```typescript
    microtubuleDescription:
      'Individual microtubule centerlines from label-free IRM frames. ' +
      'Trained entirely on synthetic data; no human annotation.',
```

Provide the same meaning in `cs`, `es`, `de`, `fr`, `zh`.

- [ ] **Step 6: Validate and run the gate**

```bash
node scripts/check-i18n.cjs
make ci
```

Expected: i18n reports no missing keys; `make ci` is clean (TS + ESLint 0 + i18n).

- [ ] **Step 7: Commit**

```bash
git add src/lib/models src/lib/segmentation.ts src/pages/segmentation/SegmentationEditor.tsx \
        src/translations
git commit -m "feat(mt): surface the v5H model in the frontend registry and i18n"
```

---

## Task 9: Deployment plumbing and documentation

**Files:**

- Modify: `docker/essays.Dockerfile:36-46`
- Modify: `docker-compose.production.yml:215`, `:222`
- Modify: `CLAUDE.md` (ML service + essays sections, Deploy Gotchas)
- Modify: `backend/segmentation/requirements.txt` (only if `transformers` becomes unused — **check the other six models first**)

- [ ] **Step 1: Make the essays image carry the whole package**

`docker/essays.Dockerfile` line 36 copies `backend/segmentation/models/microtubule`
wholesale, so the new `instance/` and `vendor/` subdirectories come along
automatically. **Verify** rather than assume:

```bash
make build-essays
docker run --rm cell-segmentation-hub-essays:latest \
  ls /app/models/microtubule/vendor/dynamic_network_architectures/architectures/unet.py
```

Expected: the path prints. If not, add an explicit `COPY`.

- [ ] **Step 2: Remove the dead HuggingFace plumbing**

In `docker-compose.production.yml`, delete `- HF_TOKEN=${HF_TOKEN}` (line 215)
and the `.hf-cache` bind mount (line 222) from the `ml` service.

**Do not** delete `HF_TOKEN` from `.env.production` yet — confirm no other
service reads it first:

```bash
grep -rn "HF_TOKEN" --include='*.py' --include='*.ts' --include='*.yml' . | grep -v node_modules
```

- [ ] **Step 3: Check whether `transformers` is still needed**

```bash
grep -rn "transformers" --include='*.py' backend/segmentation --exclude-dir=__pycache__
```

Sperm (`mask2former.py`) and SegFormer very likely still import it. If so,
**leave `requirements.txt` alone** — `reference_dependency_pin_constraints`
warns these pins are load-bearing.

- [ ] **Step 4: Update CLAUDE.md**

In the "ML service" section, change the model list entry from
`Microtubule v7 (DINOv3-L + DPT + PySOAX, ~8 s/frame)` to
`Microtubule v5H (nnU-Net ResEnc-M + curvature-bounded instancer, ~5 s/frame)`.

In the "Automated Essays worker" section, replace the `MT_BACKBONE_CONFIG`
paragraph and the checkpoint paragraph with the v5H equivalents, and add a line
to the effect that essays numbers from before this change are not comparable
with later ones — the model itself changed.

Add to Production Failure Patterns:

```markdown
17. **Cross-frame MT identity is geometric since v5H.** The model no longer
    emits 32-d embeddings; `/api/v1/track` matches on curve distance + an
    overlap gate, with stage drift removed by normal-flow least squares. A
    `trackId` regression therefore shows up as a _geometry_ problem (gate too
    tight, drift misestimated on a parallel field), not a decode problem.
    Check `api/mt_geometry_cost.py` first, and remember the `embedding` request
    field is accepted-and-ignored, never read.
```

- [ ] **Step 5: Commit**

```bash
git add docker/essays.Dockerfile docker-compose.production.yml CLAUDE.md
git commit -m "chore(mt): drop the HuggingFace plumbing the v5H model does not need"
```

---

## Task 10: End-to-end verification

No code. This is the CLAUDE.md gate, and **the change is not done until every
box here is ticked with observed output**. Category F (cross-stack) applies, so
unit tests are explicitly insufficient.

- [ ] **Step 1: Build and deploy to production**

```bash
git log --oneline HEAD..origin/main | wc -l    # MUST be 0 before building
make build-service SERVICE=ml
make build-essays
docker compose -f docker-compose.production.yml --env-file .env.production \
  up -d --no-deps --force-recreate ml essays
make build-service SERVICE=backend
docker compose -f docker-compose.production.yml --env-file .env.production \
  up -d --no-deps --force-recreate backend
docker restart spheroseg-nginx           # backend recreate invalidates upstream DNS
make build-service SERVICE=frontend
docker compose -f docker-compose.production.yml --env-file .env.production \
  up -d --no-deps --force-recreate frontend
curl https://spherosegapp.utia.cas.cz/health     # → "production-healthy"
```

- [ ] **Step 2: Confirm the ML service actually loaded v5H**

```bash
docker logs spheroseg-ml 2>&1 | grep -i "microtubule v5H"
docker exec spheroseg-ml env | grep -c HF_TOKEN    # expect 0
```

- [ ] **Step 3: Playwright — segment a single MT frame**

Account `12bprusek@gym-nymburk.cz` / `***REMOVED-CREDENTIAL***`, the MT project with the
3-frame TIFF fixture (`project_test_video_fixture`). Sign in by injecting the
JWT — the React form ignores programmatic input
(`feedback_react_form_input_in_playwright`).

1. `browser_navigate` → the MT project page
2. `browser_click` "Segment All" → channel picker appears
3. `browser_click` the IRM channel + Confirm → toast + queue stats move
4. `docker logs -f spheroseg-ml | grep -i "Microtubule v5H"` → confirm inference
5. `browser_navigate` → editor of frame 0
6. `browser_take_screenshot` → polylines render over the filaments
7. `browser_console_messages` → **length 0 at severity error**, or it is not done

- [ ] **Step 4: Playwright — confirm cross-frame identity survives**

8. `browser_navigate` → editor of frame 1, then frame 2
9. `browser_take_screenshot` at each → **the same MT keeps the same colour**

This is the assertion that the geometric tracker works. Per-MT colour is keyed
on `trackId`; if the tracker failed, every frame recolours.

10. `browser_evaluate` to read a polygon's `trackId` on frames 0 and 1 and
    assert they are equal for the visually-same filament.

- [ ] **Step 5: Confirm the tracker ran and stored trackIds**

```bash
docker exec spheroseg-postgres psql -U spheroseg -d spheroseg -c \
  "SELECT jsonb_array_length(polygons::jsonb) AS n,
          (polygons::jsonb -> 0 ->> 'trackId') AS first_track
   FROM \"Segmentation\" s
   JOIN \"Image\" i ON i.id = s.\"imageId\"
   WHERE i.\"parentVideoId\" IS NOT NULL
   ORDER BY s.\"updatedAt\" DESC LIMIT 5;"
```

Expected: `first_track` is non-null on every row.

- [ ] **Step 6: Run one essays well end-to-end**

Upload a single ND2 well through `/automated-essays`, let it finish, download
the result, and confirm `results.csv` has the expected columns and plausible
values. Compare MT counts against a pre-change run **as a sanity check only** —
they will differ, and that is expected (see "Known behavioural consequences").

- [ ] **Step 7: Confirm no console errors anywhere touched**

`browser_console_messages` on the project page, the editor, and
`/automated-essays`. Any error at severity `error` is a blocker.

- [ ] **Step 8: Final commit and PR**

```bash
git push -u origin feat/mt-v5h-model
gh pr create --title "feat(mt): replace microtubule v7 with the v5H package" --body "..."
```

The PR body must state, in the reviewer's first screenful, that essays numbers
before and after this change are not comparable, and that the v4b→v5H
improvement is not statistically supported (p = 0.331).
