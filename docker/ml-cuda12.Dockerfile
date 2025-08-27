# Use NVIDIA CUDA runtime base image with driver 570.133.20 compatible CUDA
FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

WORKDIR /app

# Install Python and pip
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    python3-dev \
    && ln -s /usr/bin/python3.11 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Set CUDA environment variables
ENV CUDA_HOME=/usr/local/cuda
ENV LD_LIBRARY_PATH=${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}
ENV PATH=${CUDA_HOME}/bin:${PATH}
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

# Install system dependencies including OpenGL for OpenCV and gosu
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libgomp1 \
    libgl1 \
    libfontconfig1 \
    libxrender1 \
    libxtst6 \
    libxi6 \
    curl \
    dumb-init \
    ca-certificates \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with same UID as host user for proper permissions
RUN groupadd -r -g 1001 appuser && useradd -r -g appuser -u 1001 appuser

# Copy requirements first for better caching
COPY requirements.txt .

# Install PyTorch with CUDA support first
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        torch==2.3.1+cu121 \
        torchvision==0.18.1+cu121 \
        --extra-index-url https://download.pytorch.org/whl/cu121

# Install other dependencies
RUN pip install --no-cache-dir \
        fastapi==0.104.1 \
        uvicorn[standard]==0.24.0 \
        python-multipart==0.0.18 \
        opencv-python-headless==4.8.1.78 \
        "pillow>=10.3.0" \
        scikit-image==0.22.0 \
        "numpy>=1.24.3,<2.0.0" \
        scipy==1.11.4 \
        pydantic==2.5.0 \
        python-json-logger==2.0.7 \
        "psutil>=5.9.0" \
        pytest==7.4.3 \
        pytest-asyncio==0.21.1 \
        pytest-cov==4.1.0 \
        pytest-mock==3.12.0 \
        httpx==0.25.2 \
        faker==20.1.0 \
        "gunicorn>=23.0.0"

# Debug Python and packages
RUN echo "Python version:" && python --version && \
    echo "Python path:" && python -c "import sys; print(sys.path)" && \
    echo "Installed packages:" && pip list | grep torch || echo "No torch packages found"

# Verify PyTorch installation (CUDA verification will happen at runtime with GPU access)  
RUN python -c "import torch; print(f'PyTorch version: {torch.__version__}'); print(f'CUDA version: {torch.version.cuda}'); print('CUDA availability will be tested at runtime with GPU access')"

# Copy application code
COPY . .

# Create required directories
RUN mkdir -p weights logs uploads

# Create proper entrypoint script with GPU environment setup
COPY <<'EOF' /entrypoint.sh
#!/bin/bash
set -e

# Set CUDA environment variables
export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES:-all}

# GPU memory optimization
export PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128

# Fix permissions for mounted volumes at runtime
if [ -w /app/weights ]; then
    chown -R appuser:appuser /app/weights 2>/dev/null || true
fi
if [ -w /app/logs ]; then
    chown -R appuser:appuser /app/logs 2>/dev/null || true
fi
if [ -w /app/uploads ]; then
    chown -R appuser:appuser /app/uploads 2>/dev/null || true
fi

# Print GPU info for debugging
echo "=== GPU Information ==="
if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits
else
    echo "nvidia-smi not available in container"
fi

# Test PyTorch CUDA
gosu appuser python -c "
import torch
print(f'PyTorch CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'GPU count: {torch.cuda.device_count()}')
    for i in range(torch.cuda.device_count()):
        print(f'GPU {i}: {torch.cuda.get_device_name(i)}')
else:
    print('No GPU detected - running in CPU mode')
" || echo "PyTorch check failed"

echo "========================"

# Handle conditional reload logic
if [ "$FASTAPI_RELOAD" = "true" ]; then
    exec gosu appuser uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
else
    exec gosu appuser "$@"
fi
EOF

RUN chmod +x /entrypoint.sh && chown root:root /entrypoint.sh

# Verify gosu installation
RUN gosu nobody true

# Set initial permissions
RUN chown -R appuser:appuser /app

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start FastAPI server with proper signal handling
ENTRYPOINT ["dumb-init", "--", "/entrypoint.sh"]
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]