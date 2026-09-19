# mt_sparse35 — reference fixture for the deployed microtubule model

| file | what |
|---|---|
| `mt_sparse35_synthetic_irm.png` | 1024 × 1024 uint16. One frame of the synthetic IRM generator the model was trained on (calibration `calib_V6_c070_narrow.json` + its `gen_overrides`, seed 20260924), composited on the real empty-field background `A_iris-open_50ms_006_f0230.tif`. |
| `gt_polylines.json` | the generator's exact centerlines, native px, `(x=col, y=row)`, 32 filaments |
| `reference_polylines.json` | what the research evaluation harness emits for this PNG with `SPARSE35 ep040`: 22 polylines at the 1.5× instancer scale, threshold 0.98, `params_a_derived.json`; F1 vs the exact GT 0.741 (tp 20 / fp 2 / fn 12) |
| `reference_prob_eval_scale.npz` | the harness's 1.5× probability map (float16, key `prob`, 1536 × 1536) |
| `manifest.json` | provenance: checkpoint / params sha256, tile, stride, torch, GPU, and the six candidate seeds with their scores |

Produced on tulen by `make_mt_fixture.py` (a copy is committed beside this README; the research repo
carries it as `scripts/make_mt_fixture.py`), which renders the frame, writes the PNG,
**reads it back**, and runs the measured path (`norm01` → `predict` at native scale →
`resample_to_eval` → `instance_a`) on the re-read image, so the quantisation the fixture carries is
the quantisation the reference saw.

Consumed by `tests/test_microtubule_reference.py` (pytest, marker `model`, skips without the
checkpoint) and `scripts/verify_microtubule_model.py` (in the container). Comparison logic in
`models/microtubule/reference_check.py`. See `models/microtubule/MODEL_CARD.md` §7.
