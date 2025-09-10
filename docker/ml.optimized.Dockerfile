# Optimized multi-stage build for ML service with minimal size
# This is the most critical optimization as ML images are the largest

# Stage 1: Python wheels builder
FROM python:3.10-slim AS wheel-builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /wheels

# Copy requirements and build wheels with cache mount
COPY backend/segmentation/requirements.txt .

# Build wheels for all dependencies (cached for reuse)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip wheel --no-cache-dir --wheel-dir /wheels \
    torch==2.0.1+cpu torchvision==0.15.2+cpu -f https://download.pytorch.org/whl/torch_stable.html && \
    pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# Stage 2: Minimal runtime base
FROM python:3.10-slim AS runtime-base

# Install only essential runtime libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Stage 3: Optimized production image
FROM runtime-base AS production

WORKDIR /app

# Create non-root user
RUN useradd --create-home --shell /bin/bash app

# Copy and install wheels from builder
COPY --from=wheel-builder /wheels /wheels
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --no-index --find-links /wheels \
    torch torchvision && \
    pip install --no-cache-dir --no-index --find-links /wheels \
    fastapi uvicorn pillow opencv-python-headless numpy scipy scikit-image && \
    rm -rf /wheels

# Copy application code
COPY --chown=app:app backend/segmentation/ .

# Download and cache models at build time (optional)
# This increases image size but improves startup time
# Comment out if you prefer to download models at runtime
RUN python -c "import torch; \
    from models.hrnet import HRNet; \
    from models.resunet import ResUNet; \
    model = HRNet(); \
    model = ResUNet();" || true

# Add labels for image management
LABEL maintainer="Cell Segmentation Hub Team"
LABEL stage="production"
LABEL service="ml-service"
LABEL variant="cpu-optimized"
LABEL build-date="${BUILD_DATE}"
LABEL version="${VERSION}"

# Clean up any unnecessary files
RUN find /usr/local/lib/python3.10 -name "*.pyc" -delete && \
    find /usr/local/lib/python3.10 -name "*.pyo" -delete && \
    find /usr/local/lib/python3.10 -name "__pycache__" -type d -delete && \
    rm -rf /root/.cache/pip

# Switch to non-root user
USER app

# Environment variables
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV OMP_NUM_THREADS=4
ENV MKL_NUM_THREADS=4

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Run with uvicorn for better performance
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

# ============================================
# Alternative: GPU-optimized version
# ============================================
# For GPU builds, create a separate file ml-gpu.optimized.Dockerfile
# Use nvidia/cuda base image and install CUDA-enabled PyTorch