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
    torch==2.0.1+cu118 torchvision==0.15.2+cu118 -f https://download.pytorch.org/whl/torch_stable.html && \
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

# Copy requirements.txt (needed for pip install)
COPY backend/segmentation/requirements.txt /app/requirements.txt

# Copy and install wheels from builder
COPY --from=wheel-builder /wheels /wheels
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --no-index --find-links /wheels \
    torch torchvision && \
    pip install --no-cache-dir --no-index --find-links /wheels \
    -r /app/requirements.txt && \
    rm -rf /wheels

# Copy application code
COPY --chown=app:app backend/segmentation/ .

# Copy entrypoint script for automatic weight management
COPY --chown=app:app <<'EOF' /app/docker-entrypoint.sh
#!/bin/bash
set -e

echo "=== SpheroSeg ML Service Initialization ==="

# Step 1: Check GPU availability
echo "Checking compute devices..."
python -c "
import torch
cuda = torch.cuda.is_available()
print(f'CUDA available: {cuda}')
if cuda:
    print(f'GPU: {torch.cuda.get_device_name(0)}')
    print(f'Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB')
else:
    print('Running in CPU mode')
" || echo "Warning: Device check failed"

# Step 2: Check/download model weights
WEIGHTS_DIR="${WEIGHTS_DIR:-/app/weights}"
echo "Weights directory: $WEIGHTS_DIR"

REQUIRED_WEIGHTS=(
    "hrnet_best_model.pth"
    "cbam_resunet_new.pth"
    "unet_spherohq_best.pth"
)

MISSING_WEIGHTS=0
for weight in "${REQUIRED_WEIGHTS[@]}"; do
    if [ ! -f "$WEIGHTS_DIR/$weight" ]; then
        echo "⚠️  Missing: $weight"
        MISSING_WEIGHTS=$((MISSING_WEIGHTS + 1))
    else
        SIZE=$(du -h "$WEIGHTS_DIR/$weight" 2>/dev/null | cut -f1 || echo "unknown")
        echo "✓ Found: $weight ($SIZE)"
    fi
done

# Step 3: Download missing weights if script is available
if [ $MISSING_WEIGHTS -gt 0 ]; then
    echo ""
    echo "⚠️  $MISSING_WEIGHTS model weight(s) missing!"

    if [ -f "/app/scripts/download_weights.py" ]; then
        echo "Attempting automatic download..."
        python /app/scripts/download_weights.py --weights-dir "$WEIGHTS_DIR" || {
            echo ""
            echo "❌ Automatic download failed!"
            echo "Please provide model weights in: $WEIGHTS_DIR"
            echo ""
            echo "Options:"
            echo "  1. Download manually and place in $WEIGHTS_DIR"
            echo "  2. Update URLs in /app/scripts/download_weights.py"
            echo "  3. Mount existing weights as volume: -v /path/to/weights:$WEIGHTS_DIR"
            echo ""
            exit 1
        }
    else
        echo ""
        echo "❌ Download script not found and weights are missing!"
        echo "Please provide model weights in: $WEIGHTS_DIR"
        echo "Mount as volume: -v /path/to/weights:$WEIGHTS_DIR"
        echo ""
        exit 1
    fi
fi

echo ""
echo "✅ All model weights present"
echo "=== Starting ML Service ==="
echo ""

# Execute the main command
exec "$@"
EOF

RUN chmod +x /app/docker-entrypoint.sh

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

# Use entrypoint for initialization, then run uvicorn
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

# ============================================
# Alternative: GPU-optimized version
# ============================================
# For GPU builds, create a separate file ml-gpu.optimized.Dockerfile
# Use nvidia/cuda base image and install CUDA-enabled PyTorch