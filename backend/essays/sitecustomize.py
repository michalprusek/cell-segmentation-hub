"""GPU memory cap for the Automated Essays worker.

CPython auto-imports ``sitecustomize`` from ``sys.path`` at interpreter startup
(before any user code runs). We use that hook to cap this process's share of the
shared A5000 *before* ``evaluate.py`` performs its first GPU allocation —
``set_per_process_memory_fraction`` only limits allocations made *after* it is
called, so it must run before the model loads and allocates.

The cap is applied ONLY when ``ESSAYS_APPLY_GPU_CAP=1`` so the long-lived FastAPI
server and the build-time import smoke don't pay the torch-import cost or hold
VRAM. The wrapper sets that flag exclusively on the ``evaluate.py`` subprocess it
launches on the GPU, so a batch can never grab more than its slice and starve
interactive segmentation running in the ``ml`` container on the same card.

**The cap must sit ABOVE the model's working set, not below it.** Measured
2026-08-13: a v7 forward pass on a 2048x2048 well wants 16.36 GiB, flat across
caps of 16.49 / 17.67 / 20.02 GiB. The original 0.6 (14.13 GiB) sat under that,
so torch hit the ceiling on every position, released ~3.7 GiB of cached blocks
to the driver and had to win them back from a shared card — losing that race is
an OutOfMemoryError, and it cost one folder 255 wells in one run and 68 in the
next. A cap set below the working set does not protect the other tenants; it
just hands them memory the batch will immediately try to take back.

Note this value CHANGES RESULTS: it sizes cuDNN's workspace and so its choice of
convolution algorithm. Measured over one 3-position well, 0.6 -> 0.75 left 71 of
73 microtubule rows byte-identical, moved one centerline by 1.10 px and shifted
one neighbour's background ring in consequence. Same magnitude as the
capped-vs-uncapped boundary already documented in CLAUDE.md — so when comparing
two runs, hold this constant.
"""
import os

if os.environ.get("ESSAYS_APPLY_GPU_CAP") == "1":
    try:
        fraction = float(os.environ.get("ESSAYS_GPU_MEM_FRACTION", "0.75"))
        import torch

        if torch.cuda.is_available() and 0.0 < fraction <= 1.0:
            torch.cuda.set_per_process_memory_fraction(fraction, 0)
    except Exception:
        # A failure here must never stop the batch — worst case it runs
        # uncapped (the start-gate in essays_api.py is the primary guard).
        pass
