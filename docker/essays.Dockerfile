# Automated Essays worker — batch microtubule (MT) assay of ND2 wells.
#
# Wraps the essays module (a *script* tree, not a pip package) as a thin FastAPI
# job runner. It is based on the already-built ML image, so it inherits the EXACT
# validated model stack: torch 2.6.0+cu124 and transformers 4.57.1. This is
# load-bearing — the module's own requirements.txt pins transformers 4.57.6,
# which silently degrades the DINOv3 backbone into low-frequency blobs (303 real
# MTs -> 76 garbage). Inheriting the ML image means we NEVER install that pin,
# and every other module dependency (nd2, scikit-image, scipy, opencv, tifffile,
# Pillow, huggingface_hub) is already present at the same version, so nothing is
# reinstalled or recompiled.
#
# The module used to live in a separate private repo cloned at build time; it is
# now vendored at backend/essays/module and copied in like any other first-party
# source. No git, no build secret, no network at build time — and the module's
# microtubule model code is no longer a second copy: it imports the ML service's
# package, which this image already carries at /app/models (see MT_PACKAGE_DIR).
ARG ML_IMAGE=cell-segmentation-hub-ml:latest
FROM ${ML_IMAGE}

# The vendored module plus our integration glue (glue is NOT part of the module):
#   sitecustomize.py — GPU per-process memory cap (auto-imported at startup)
#   essays_api.py     — FastAPI job runner
COPY --chown=app:app backend/essays/module /app/essays_module
COPY --chown=app:app backend/essays/sitecustomize.py /app/sitecustomize.py
COPY --chown=app:app backend/essays/essays_api.py /app/essays_api.py

# Where the shared microtubule package lives in THIS image. The base ML image
# puts the ML service at /app, so its model packages sit under /app/models. Set
# explicitly rather than left to the resolver's fallback search, so a future move
# of the ML sources fails the build here instead of silently finding nothing.
ENV MT_PACKAGE_DIR=/app/models

# Build-time smoke: the module imports cleanly against this stack AND resolves
# the shared microtubule package. Fails the build early if a dependency is
# unexpectedly absent, or if MT_PACKAGE_DIR ever stops pointing at the model code
# — which would otherwise surface only when a user's batch job dies mid-run.
RUN cd /app/essays_module \
    && python -c "import evaluate, mt_pipeline, microtubule; \
print('essays module import OK; microtubule from', microtubule.__file__)"

USER app

# The base image's entrypoint checks for spheroseg's segmentation weights and
# exits if they are absent; the essays worker doesn't use them. Clear it.
ENTRYPOINT []

ENV PYTHONUNBUFFERED=1 \
    ESSAYS_MODULE_DIR=/app/essays_module \
    ESSAYS_WEIGHTS=/app/mt_weights/microtubule_v7.pt

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=15s --start-period=20s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health').raise_for_status()" || exit 1

CMD ["uvicorn", "essays_api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
