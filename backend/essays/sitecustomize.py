"""GPU memory cap for the Automated Essays worker.

CPython auto-imports ``sitecustomize`` from ``sys.path`` at interpreter startup
(before any user code runs). We use that hook to cap this process's share of the
shared A5000 *before* torch initialises CUDA — the only moment
``set_per_process_memory_fraction`` takes effect.

The cap is applied ONLY when ``ESSAYS_APPLY_GPU_CAP=1`` so the long-lived FastAPI
server and the build-time import smoke don't pay the torch-import cost or hold
VRAM. The wrapper sets that flag exclusively on the ``evaluate.py`` subprocess it
launches on the GPU, so a batch can never grab more than its slice and starve
interactive segmentation running in the ``ml`` container on the same card.
"""
import os

if os.environ.get("ESSAYS_APPLY_GPU_CAP") == "1":
    try:
        fraction = float(os.environ.get("ESSAYS_GPU_MEM_FRACTION", "0.6"))
        import torch

        if torch.cuda.is_available() and 0.0 < fraction <= 1.0:
            torch.cuda.set_per_process_memory_fraction(fraction, 0)
    except Exception:
        # A failure here must never stop the batch — worst case it runs
        # uncapped (the start-gate in essays_api.py is the primary guard).
        pass
