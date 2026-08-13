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
# microtubule model code is no longer a second copy: it shares the ML service's
# package (see MT_PACKAGE_DIR).
ARG ML_IMAGE=cell-segmentation-hub-ml:latest
FROM ${ML_IMAGE}

# The vendored module plus our integration glue (glue is NOT part of the module):
#   sitecustomize.py — GPU per-process memory cap (auto-imported at startup)
#   essays_api.py     — FastAPI job runner
COPY --chown=app:app backend/essays/module /app/essays_module
COPY --chown=app:app backend/essays/sitecustomize.py /app/sitecustomize.py
COPY --chown=app:app backend/essays/essays_api.py /app/essays_api.py

# The shared model code, taken from the REPO rather than inherited from the base
# image. The base image already carries a copy at /app/models/microtubule, but it
# is only as fresh as the last `make build-service SERVICE=ml` — so inheriting it
# silently ships whatever model code the ml image was last built with, which is
# not necessarily what is committed. Copying it here makes this image a function
# of the repo alone: `make build-essays` can no longer produce a worker running
# yesterday's model. Same single source in git; this just pins which revision of
# it lands in the image.
COPY --chown=app:app backend/segmentation/models/microtubule /app/models/microtubule
# The shared band/background measurement, for the same reason and from the same
# place the project export takes it. It sits BESIDE the package rather than
# inside it so importing it does not drag in the v7 wrapper and therefore torch —
# measuring pixels needs neither.
COPY --chown=app:app backend/segmentation/models/mt_measure.py /app/models/mt_measure.py

# Where that package lives in THIS image. Set explicitly rather than left to the
# resolver's fallback search, so a future move of the ML sources fails the build
# here instead of silently finding nothing.
ENV MT_PACKAGE_DIR=/app/models

# Build-time smoke: the module imports cleanly against this stack AND resolves
# the shared microtubule package. Fails the build early if a dependency is
# unexpectedly absent, or if MT_PACKAGE_DIR ever stops pointing at the model code
# — which would otherwise surface only when a user's batch job dies mid-run.
# The backbone config is checked explicitly: an import-only smoke passes without
# it, and the failure would surface on a user's first batch job instead of here.
RUN cd /app/essays_module \
    && python -c "import _mt_package; \
pkg = _mt_package.ensure_on_path(); \
import evaluate, mt_pipeline, microtubule, mt_measure; \
assert evaluate.BUNDLED_BACKBONE_CONFIG.joinpath('config.json').is_file(), \
    'offline backbone config missing: %s' % evaluate.BUNDLED_BACKBONE_CONFIG; \
assert mt_pipeline.measure.mt_measure is mt_measure, \
    'the essays measurement is not the shared one'; \
print('essays module import OK; microtubule from', microtubule.__file__); \
print('shared measurement from', mt_measure.__file__)"

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
