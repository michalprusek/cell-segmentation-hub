# mt_v16 — reference fixture for the V16 DEB_S4 ep040 microtubule model

What the research path emits for the frame of `../mt_sparse35/` (reused through `frame_fixture` in the manifest, not committed twice).

| File | What |
|---|---|
| `reference_prob_eval_scale.npz` | float16 probability map at the 1.5x frame, key `prob`; `train_v5.predict(fusion="gauss")` + `resample_to_eval` |
| `reference_polylines.json` | polylines at the 1.5x frame `(x, y)` from `l_hyst2.hmask` + instancer L at reach 80, cut 0.995, F1 against the exact GT |
| `manifest.json` | checkpoint sha256, constants, torch and GPU of the run |
| `make_mt_fixture_v16.py` | the recipe; runs in the research tree on kajman |

Consumed by `tests/test_microtubule_reference_v16.py` (its decoder test needs no checkpoint) and `scripts/verify_microtubule_model.py` (in the container). Comparison logic in `models/microtubule/reference_check.py`. See `models/microtubule/MODEL_CARD.md` §0.
