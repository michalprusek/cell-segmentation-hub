# Automated Essays worker — batch microtubule (MT) assay of ND2 wells.
#
# Wraps github.com/michalprusek/AutomatedEssaysModule (a *script* repo, not a pip
# package) as a thin FastAPI job runner. It is based on the already-built ML
# image, so it inherits the EXACT validated model stack: torch 2.6.0+cu124 and
# transformers 4.57.1. This is load-bearing — the module's own requirements.txt
# pins transformers 4.57.6, which silently degrades the DINOv3 backbone into
# low-frequency blobs (303 real MTs -> 76 garbage). Inheriting the ML image means
# we NEVER install that pin, and every other module dependency (nd2, scikit-image,
# scipy, opencv, tifffile, Pillow, huggingface_hub) is already present at the same
# version, so nothing is reinstalled or recompiled.
ARG ML_IMAGE=cell-segmentation-hub-ml:latest
FROM ${ML_IMAGE}

USER root
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Clone the module at build time. "Import as a git package": a rebuild re-clones
# the branch, so pushing to the module repo propagates into the app on the next
# `make build-service SERVICE=essays`. The repo is private -> a BuildKit secret
# supplies the gh token (never baked into a layer). MODULE_CACHE_BUST invalidates
# this layer so a rebuild always fetches the latest commit of MODULE_REF.
ARG MODULE_REF=main
ARG MODULE_CACHE_BUST=0
RUN --mount=type=secret,id=ghtoken,uid=0 \
    git clone --depth 1 --branch "${MODULE_REF}" \
      "https://x-access-token:$(cat /run/secrets/ghtoken)@github.com/michalprusek/AutomatedEssaysModule.git" \
      /app/essays_module \
    && rm -rf /app/essays_module/.git \
    && chown -R app:app /app/essays_module

# Our integration glue (NOT part of the module):
#   sitecustomize.py — GPU per-process memory cap (auto-imported at startup)
#   essays_api.py     — FastAPI job runner
COPY --chown=app:app backend/essays/sitecustomize.py /app/sitecustomize.py
COPY --chown=app:app backend/essays/essays_api.py /app/essays_api.py

# Build-time smoke: the module and its bundled packages import cleanly against
# this stack. Fails the build early if a dependency is unexpectedly absent.
RUN cd /app/essays_module \
    && python -c "import evaluate, mt_pipeline, microtubule; print('essays module import OK')"

USER app

# The base image's entrypoint checks for spheroseg's segmentation weights and
# exits if they are absent; the essays worker doesn't use them. Clear it.
ENTRYPOINT []

ENV PYTHONUNBUFFERED=1 \
    ESSAYS_MODULE_DIR=/app/essays_module \
    ESSAYS_WEIGHTS=/app/mt_weights/microtubule_v7.pt

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=15s --start-period=20s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "essays_api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
