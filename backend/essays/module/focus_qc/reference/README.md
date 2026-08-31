# Reference calibration artefacts

Versioned so the regression test always runs and the published numbers can be
reproduced without the raw ND2 files (1.5 GB, not in the repo).

| file | what it is |
|---|---|
| `zstacks_oof_spec.json` | the five annotated z-stacks and their sharp planes (1-based) |
| `scores_cache.json` | per-plane focus statistics for all 205 planes × 2 channels |
| `calibration.json` | thresholds and acquisition domain fitted on all five stacks |
| `calibration_report.md` | leave-one-stack-out validation table |

| `compare_alternatives.py` | recomputes the variance-of-Laplacian comparison quoted in the README (needs the raw ND2) |

`zstacks_oof_spec.json` holds absolute paths to the raw stacks as they were on
the machine that produced this; edit them before re-running `calibrate` from
ND2, and point `--cache` at a fresh file — the cache records a fingerprint of the
channel spec, the stack list and the descriptor constants, and refuses to be
reused when any of them changed. The regression test only reads the cache, so it
is unaffected by the paths.
